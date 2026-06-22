/**
 * Express middleware factory for Zod v4 schema validation.
 *
 * Usage:
 *   import { validate } from "../middlewares/validate.js";
 *   import { registerSchema } from "../validations/authSchemas.js";
 *
 *   router.post("/register", validate(registerSchema), registerUser);
 *
 * By default validates req.body. Pass "query" or "params" as second arg
 * to validate other parts of the request.
 */

export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      // Zod v4: errors live on result.error.issues
      const issues = result.error?.issues ?? [];
      const errors = issues.map((issue) => ({
        field: Array.isArray(issue.path)
          ? issue.path.join(".")
          : String(issue.path ?? ""),
        message: issue.message,
      }));

      // Fallback: if issues is empty, surface the raw error message
      const message =
        errors.length > 0
          ? errors.map((e) => e.message).join(", ")
          : result.error?.message || "Validation failed";

      return res.status(400).json({
        message,
        errors,
      });
    }

    // Replace with parsed (and transformed) data
    req[source] = result.data;
    next();
  };
}
