// module.exports = (err, req, res, next) => {
//   console.error(err.stack);
//   res.status(500).json({ message: err.message || "Server Error" });
// };

//changed to this:
const errorMiddleware = (err, req, res, next) => {
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
};

export default errorMiddleware;
