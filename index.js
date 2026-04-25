require("dotenv").config({
  path: __dirname + "/.env",
  override: true,
});
//? override: true يعني لو فيه متغير موجود بالفعل في النظام، يتم استبداله بالقيمة من .env
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

// --- Test Email Route ---
app.get("/test-email", async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // your Gmail address
        pass: process.env.EMAIL_PASS, // your Gmail App Password
      },
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // send to yourself
      subject: "Test Email from TrainBookingApp",
      text: "This is a test email to confirm Gmail SMTP with App Password works.",
    });

    res
      .status(200)
      .json({ success: true, msg: "Email sent", response: info.response });
  } catch (err) {
    console.error("❌ Email error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// --- Your existing server setup ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}/api/v1`);
});

// 🔒 Helmet (secure headers)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// 🔒 CORS (tighten in production)
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);
app.set("trust proxy", 1);
// 🔒 Global Rate Limit (basic protection)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});
app.use(globalLimiter);
console.log(process.env.EMAIL_USER);
console.log(process.env.EMAIL_PASS);
// 🔒 Auth Rate Limit (strict)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    msg: "Too many requests, try again later",
  },
});

app.use("/api/v1/email", authLimiter);

// ================= MIDDLEWARE =================

app.use(express.json({ limit: "10kb" })); // 🔥 prevent large payload attacks
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(compression()); // 🔥 faster responses

// ================= ROUTES =================

const API_PREFIX = "/api/v1";
app.use(`${API_PREFIX}/users`, usersRoutes);
app.use(`${API_PREFIX}/email`, emailRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/commissary`, commissaryRoutes);

// ================= ENV CHECK =================

if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET missing");
  process.exit(1);
}

const requiredEnv = ["JWT_SECRET", "EMAIL_USER", "EMAIL_PASS", "EMAIL_SECRET"];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Missing env: ${key}`);
    process.exit(1);
  }
});

console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log("EMAIL_PASS:", process.env.EMAIL_PASS);

// ================= DATABASE =================

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/trainbooking";

mongoose
  .connect(MONGO_URI, {
    autoIndex: true, // 🔥 helpful in dev
  })
  .then(() => {
    console.log("✅ MongoDB connected");

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}${API_PREFIX}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB error:", err.message);
    process.exit(1);
  });

// ================= CLEANUP JOBS =================

// 🔥 Cancel unpaid bookings (optimized)
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

      // bulk update bookings
      await Booking.updateMany(
        { _id: { $in: bookingIds } },
        { status: "cancelled" },
      );

      // release seats
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

// 🔥 Release expired seat holds (optimized)
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

// ================= ERROR HANDLING =================

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    msg: "Route not found",
  });
});

// Global Error Handler (clean + safe)
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);

  res.status(err.status || 500).json({
    success: false,
    msg: err.message, // ✅ Always show actual error message
    stack: err.stack, // ✅ Optional: include stack trace for debugging
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

//? 211 lines
/*


app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);

  res.status(err.status || 500).json({
    success: false,
    msg:
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message,
  });
});


*/
