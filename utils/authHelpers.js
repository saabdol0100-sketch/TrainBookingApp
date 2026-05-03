const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// 🔐 Generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );
};

// 🔢 Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const hashOTP = (otp) => {
  return crypto
    .createHmac("sha256", process.env.EMAIL_SECRET)
    .update(String(otp).trim()) // ✅ ALWAYS SAME FORMAT
    .digest("hex");
};

const compareOTP = (stored, incoming) => {
  try {
    return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(incoming));
  } catch {
    return false;
  }
};

module.exports = {
  generateToken,
  generateOTP,
  hashOTP,
  compareOTP,
};
