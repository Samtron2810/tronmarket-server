import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isTokenBlacklisted } from "../config/redis.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ message: "Please log in first" });
    }

    // FIX #3: isTokenBlacklisted now throws if Redis goes down after being up.
    // We surface that as a 503 rather than silently allowing the request through.
    let blacklisted;
    try {
      blacklisted = await isTokenBlacklisted(token);
    } catch (redisErr) {
      return res.status(503).json({ message: redisErr.message });
    }

    if (blacklisted) {
      return res.status(401).json({
        message: "Token expired. Please log in again.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Only short-lived access tokens authenticate API calls. (Refresh
    // tokens are opaque cookies, never Bearer tokens; pre-refresh-token
    // 7-day JWTs have no `typ` and are rejected too — one re-login is
    // required after this upgrade.)
    if (decoded.typ !== "access") {
      return res
        .status(401)
        .json({ message: "Invalid session token. Please log in again." });
    }

    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    // Soft-deleted accounts lose access immediately.
    if (req.user.accountStatus === "deleted") {
      return res.status(401).json({ message: "Account no longer exists" });
    }

    // Password reset/change bumps tokenVersion; tokens minted before that
    // are rejected even though their 7-day expiry has not passed.
    if ((decoded.tv ?? 0) !== (req.user.tokenVersion || 0)) {
      return res.status(401).json({
        message: "Session expired. Please log in again.",
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Admin access only" });
  }
};

export const sellerOnly = (req, res, next) => {
  if (req.user && (req.user.role === "seller" || req.user.role === "admin")) {
    next();
  } else {
    res.status(403).json({ message: "Seller access only" });
  }
};

export const sellerOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === "seller" || req.user.role === "admin")) {
    next();
  } else {
    res.status(403).json({
      message: "Unauthorized. Seller or Admin access only.",
    });
  }
};

// Attaches req.user when a valid access token is present, but never blocks
// anonymous traffic (used where owners/admins may preview hidden listings).
export const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer")) return next();
    const token = header.split(" ")[1];
    if (!token) return next();
    if (await isTokenBlacklisted(token).catch(() => false)) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.typ !== "access") return next();
    const user = await User.findById(decoded.id).select("-password");
    if (user && user.accountStatus !== "deleted" && (decoded.tv ?? 0) === (user.tokenVersion || 0)) {
      req.user = user;
    }
  } catch {
    // Anonymous by design.
  }
  return next();
};
