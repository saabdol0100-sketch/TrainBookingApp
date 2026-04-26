require("dotenv").config({
  path: __dirname + "/.env",
  override: true,
});

const mongoose = require("mongoose");
const express = require("express");
const helmet = require("helmet");
const nodemailer = require("nodemailer");
const morgan = require("morgan");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const compression = require("compression");

const Booking = require("./models/Booking");
const Seat = require("./models/Seat");

const usersRoutes = require("./routes/Users");
const emailRoutes = require("./routes/Email");
const adminRoutes = require("./routes/Admin");
const commissaryRoutes = require("./routes/Commissary");

const app = express();
const API_PREFIX = "/api/v1";

// --- Test Email Route ---
app.get("/test-email", async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "Test Email from TrainBookingApp",
      text: "This is a test email to confirm Gmail SMTP works.",
    });

    res.status(200).json({
      success: true,
      msg: "Email sent",
      response: info.response,
    });
  } catch (err) {
    console.error("❌ Email error:", err);
    res.status(500).json({
      success: false,
      msg: err.message,
    });
  }
});

// Security
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);

app.set("trust proxy", 1);

// Rate limit
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    msg: "Too many requests, try again later",
  },
});
app.use("/api/v1/email", authLimiter);

// Middleware
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(compression());

// Routes
app.use(`${API_PREFIX}/users`, usersRoutes);
app.use(`${API_PREFIX}/email`, emailRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/commissary`, commissaryRoutes);

// ENV CHECK
const requiredEnv = ["JWT_SECRET", "EMAIL_USER", "EMAIL_PASS", "EMAIL_SECRET"];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Missing env: ${key}`);
    process.exit(1);
  }
});

// DATABASE
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/trainbooking";

mongoose
  .connect(MONGO_URI, {
    autoIndex: true,
  })
  .then(() => {
    console.log("✅ MongoDB connected");

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}${API_PREFIX}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB error:", err.message);
    process.exit(1);
  });

// Cleanup unpaid bookings
setInterval(
  async () => {
    try {
      const expired = await Booking.find({
        paymentStatus: "pending",
        status: "active",
        createdAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
      }).lean();

      if (!expired.length) return;

      const bookingIds = expired.map((b) => b._id);
      const seatIds = expired.map((b) => b.seat);

      await Booking.updateMany(
        { _id: { $in: bookingIds } },
        { status: "cancelled" },
      );

      await Seat.updateMany(
        { _id: { $in: seatIds } },
        {
          status: "available",
          reservedBy: null,
          expireAt: null,
        },
      );

      console.log(`🧹 Cancelled ${expired.length} unpaid bookings`);
    } catch (err) {
      console.error("Cleanup booking error:", err.message);
    }
  },
  5 * 60 * 1000,
);

// Cleanup expired seats
setInterval(async () => {
  try {
    const result = await Seat.updateMany(
      {
        status: "reserved",
        expireAt: { $lt: new Date() },
      },
      {
        status: "available",
        reservedBy: null,
        expireAt: null,
      },
    );

    if (result.modifiedCount > 0) {
      console.log(`🧹 Released ${result.modifiedCount} expired seats`);
    }
  } catch (err) {
    console.error("Seat cleanup error:", err.message);
  }
}, 60 * 1000);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    msg: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);

  res.status(err.status || 500).json({
    success: false,
    msg: err.message,
    stack: err.stack,
  });
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

module.exports = app;
