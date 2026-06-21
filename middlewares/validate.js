/**
 * Express middleware factory for Zod schema validation.
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
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return res.status(400).json({
        message: "Validation failed",
        errors,
      });
    }

    // Replace with parsed (and transformed) data
    req[source] = result.data;
    next();
  };
}
