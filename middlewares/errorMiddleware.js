// FIX #7: Never leak raw error.message in production.
// Log internally, return a safe generic message.
const errorMiddleware = (err, req, res, next) => {
  // A malformed Mongo ObjectId is a missing resource from the client's
  // point of view, not a server fault.
  if (err?.name === "CastError" && err?.kind === "ObjectId") {
    return res.status(404).json({
      success: false,
      message: "Resource not found",
    });
  }

  const statusCode = err.statusCode || 500;

  // Always log the real error server-side for debugging
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);

  // In production, return a safe generic message for 500s
  const message =
    statusCode < 500 || process.env.NODE_ENV !== "production"
      ? err.message || "Internal Server Error"
      : "Something went wrong. Please try again.";

  res.status(statusCode).json({
    success: false,
    message,
  });
};

export default errorMiddleware;
