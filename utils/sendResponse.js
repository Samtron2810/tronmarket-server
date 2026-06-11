exports.sendResponse = (res, status = 200, data = {}) => {
  return res.status(status).json({ success: status < 400, ...data });
};
