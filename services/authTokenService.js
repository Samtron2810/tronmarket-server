import crypto from "crypto";
import jwt from "jsonwebtoken";
import RefreshToken from "../models/RefreshToken.js";
import User from "../models/User.js";
import { blacklistToken } from "../config/redis.js";

// ─── Access + refresh token sessions ────────────────────────────────────────
// Access tokens are short-lived JWTs kept by the SPA (15 minutes by
// default). Refresh tokens are opaque, rotating, httpOnly-cookie tokens
// (30 days by default) whose hashes live in the RefreshToken collection.
// The 7-day single-token setup this replaces is gone: a stolen access
// token now expires in minutes, and a stolen refresh token is detected
// when the real client rotates (or vice versa) — see rotateSession.

export const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || "15m";
export const REFRESH_COOKIE_NAME = "tronmarket_rt";

const MAX_ACTIVE_SESSIONS = 10;
// A revoked token replayed within this window is treated as a benign
// concurrent refresh (two tabs racing), not an attack.
const REUSE_GRACE_MS = 10 * 1000;

function refreshTtlMs() {
  const days = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);
  const clamped = Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 30;
  return clamped * 24 * 60 * 60 * 1000;
}

export function authError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function issueAccessToken(user) {
  return jwt.sign(
    { id: user._id, tv: user.tokenVersion || 0, typ: "access" },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function cookieOptions() {
  const sameSite =
    process.env.COOKIE_SAMESITE ||
    (process.env.NODE_ENV === "production" ? "none" : "lax");
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    path: "/api/auth",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

function setRefreshCookie(res, raw, expiresAt) {
  res.cookie(REFRESH_COOKIE_NAME, raw, {
    ...cookieOptions(),
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
}

async function pruneSessions(userId) {
  const active = await RefreshToken.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort("-createdAt")
    .select("_id");
  const stale = active.slice(MAX_ACTIVE_SESSIONS);
  if (stale.length) {
    await RefreshToken.updateMany(
      { _id: { $in: stale.map((s) => s._id) } },
      { $set: { revokedAt: new Date() } },
    );
  }
}

// Start a session: mint an access token and persist a new refresh token,
// sending the raw refresh token to the browser as an httpOnly cookie.
export async function startSession(req, res, user) {
  const raw = crypto.randomBytes(64).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(raw),
    tokenVersion: user.tokenVersion || 0,
    expiresAt,
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 300),
    ip: req.ip || "",
  });
  await pruneSessions(user._id);
  setRefreshCookie(res, raw, expiresAt);
  return issueAccessToken(user);
}

// Exchange the refresh cookie for a fresh access token, rotating the
// refresh token in the process. Throws authError(401) on any problem.
export async function rotateSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw) throw authError("No refresh session. Please log in again.");

  const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!doc) {
    clearRefreshCookie(res);
    throw authError("Refresh session is no longer valid. Please log in again.");
  }

  if (doc.revokedAt) {
    const withinGrace =
      doc.replacedBy &&
      Date.now() - new Date(doc.revokedAt).getTime() < REUSE_GRACE_MS;
    if (!withinGrace) {
      // A rotated-out token was replayed — assume theft and sign the user
      // out everywhere rather than guess which copy is legitimate.
      await revokeAllSessions(doc.user);
    }
    clearRefreshCookie(res);
    throw authError("Refresh session has been revoked. Please log in again.");
  }

  if (doc.expiresAt <= new Date()) {
    doc.revokedAt = new Date();
    await doc.save();
    clearRefreshCookie(res);
    throw authError("Refresh session has expired. Please log in again.");
  }

  const user = await User.findById(doc.user);
  if (!user || user.accountStatus === "deleted") {
    await revokeAllSessions(doc.user);
    clearRefreshCookie(res);
    throw authError("Account no longer exists. Please log in again.");
  }
  if ((user.tokenVersion || 0) !== (doc.tokenVersion || 0)) {
    doc.revokedAt = new Date();
    await doc.save();
    clearRefreshCookie(res);
    throw authError("Session expired. Please log in again.");
  }

  // Rotate: the presented token dies here and is replaced by a new one.
  const newRaw = crypto.randomBytes(64).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  const replacement = await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(newRaw),
    tokenVersion: user.tokenVersion || 0,
    expiresAt,
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 300),
    ip: req.ip || "",
  });
  doc.revokedAt = new Date();
  doc.replacedBy = replacement._id;
  await doc.save();
  await pruneSessions(user._id);
  setRefreshCookie(res, newRaw, expiresAt);

  return { user, accessToken: issueAccessToken(user) };
}

// Revoke the session identified by the refresh cookie (logout).
export async function revokeSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (raw) {
    await RefreshToken.updateOne(
      { tokenHash: hashToken(raw), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
  clearRefreshCookie(res);
}

export async function revokeAllSessions(userId) {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

// Blacklist an access token for whatever life it has left (logout).
export async function blacklistAccessToken(token) {
  if (!token) return;
  try {
    const decoded = jwt.decode(token);
    const ttl = decoded?.exp
      ? decoded.exp - Math.floor(Date.now() / 1000)
      : 15 * 60;
    if (ttl > 0) await blacklistToken(token, ttl);
  } catch {
    // Blacklisting is best-effort; the refresh session is already revoked.
  }
}
