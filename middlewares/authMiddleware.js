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
      return res.status(401).json({ message: "Not authorized" });
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

    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res.status(401).json({ message: "User no longer exists" });
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
