const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// 🔐 Generate JWT Token
const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// 🔢 Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// 🔒 Hash OTP (never store plain OTP)
const hashOTP = (otp) => {
  return crypto
    .createHmac("sha256", process.env.EMAIL_SECRET)
    .update(otp)
    .digest("hex");
};

module.exports = {
  generateToken,
  generateOTP,
  hashOTP,
};
