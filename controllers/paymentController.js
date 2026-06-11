export const processPayment = async (req, res, next) => {
  try {
    res.json({
      success: true,
      message: "Payment processed (stub)",
    });
  } catch (err) {
    next(err);
  }
};
