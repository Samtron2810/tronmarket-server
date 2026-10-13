import AuditLog from "../models/AuditLog.js";

const SENSITIVE_KEY = /password|token|secret|authorization|otp/i;

// Audit details must be useful without becoming a second place where
// secrets are stored. Keep this intentionally conservative.
export function sanitizeAuditDetails(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAuditDetails(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .slice(0, 30)
        .map(([key, item]) => [key, sanitizeAuditDetails(item, depth + 1)]),
    );
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
}

export async function recordAudit(req, action, target = {}, details = {}) {
  try {
    if (!req?.user?._id) return null;
    return await AuditLog.create({
      actor: req.user._id,
      actorEmail: req.user.email || "",
      actorRole: req.user.role || "",
      action,
      targetType: target.type || "",
      targetId: target.id ? String(target.id) : "",
      details: sanitizeAuditDetails(details),
      ip: req.ip || req.headers?.["x-forwarded-for"] || "",
    });
  } catch (error) {
    // Auditing must never turn an otherwise successful admin action into a
    // 500, but failures are visible in server logs.
    console.error("Audit log failed:", error?.message || error);
    return null;
  }
}
