import dotenv from "dotenv";
dotenv.config();

const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET", "PAYSTACK_SECRET_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Optional — emails silently skipped if missing
if (!process.env.RESEND_API_KEY) {
  console.warn("WARN: RESEND_API_KEY not set — email sending is disabled");
}

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";

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
import sellerApplicationRoutes from "./routes/sellerApplicationRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import payoutRoutes from "./routes/payoutRoutes.js";
import disputeRoutes from "./routes/disputeRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import deliveryStateRoutes from "./routes/deliveryStateRoutes.js";
import { generalLimiter } from "./middlewares/rateLimiter.js";
import { startOrderExpirySweeper } from "./services/orderExpiryService.js";
import { startOrderLifecycleSweeper } from "./services/orderLifecycleService.js";
import { startRecoveryEmailJob } from "./services/opsEmailService.js";
import { startImageCleanupJob } from "./services/imageCleanupService.js";
import { startProductRankingJob } from "./services/productRankingService.js";

await connectDB();
connectRedis().catch(() => {});
startOrderExpirySweeper();
startOrderLifecycleSweeper();
startRecoveryEmailJob();
startImageCleanupJob();
startProductRankingJob();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(cookieParser());
app.use(generalLimiter);

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "TronMarket API running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/seller-applications", sellerApplicationRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/delivery-states", deliveryStateRoutes);

app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
