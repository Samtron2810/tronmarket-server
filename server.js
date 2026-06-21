import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import connectDB from "./config/db.js";
import { connectRedis } from "./config/redis.js";
import getAllowedOrigins from "./config/allowedOrigins.js";
import errorMiddleware from "./middlewares/errorMiddleware.js";

import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

// connect database first
await connectDB();

// connect Redis (non-blocking — app works without it)
connectRedis().catch(() => {});

const app = express();

// middleware
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
  }),
);

// increase body size limits to allow large uploads (base64 fallback) and form data

// Modify your existing express.json middleware configuration to capture raw body
app.use(
  express.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "TronMarket API running" });
});

// routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/admin", adminRoutes);

// error handler (always last)
app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
