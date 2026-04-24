const User = require("../models/User");
const Booking = require("../models/Booking");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendEmail } = require("../services/emailService");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const fetch = require("node-fetch");
const { verifyGoogleToken } = require("../services/googleService");
const { verifyFacebookToken } = require("../services/facebookService");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { sendSMS } = require("../services/smsService");
const {
  generateToken,
  generateOTP,
  hashOTP,
  extractDOBFromNationalId,
} = require("../utils/authHelpers");
const sendRes = (res, status, success, msg, data = null) => {
  res.status(status).json({ success, msg, data });
};
const otpAttempts = new Map();

exports.signup = async (req, res) => {
  try {
    const { name, phone, email, password, NationalId, country } = req.body;

    if (!name || !email || !password || !phone || !NationalId) {
      return sendRes(res, 400, false, "Missing required fields");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
      return sendRes(res, 400, false, "Invalid phone number");
    }

    const nationalIdRegex = /^[0-9]{14}$/;
    if (!nationalIdRegex.test(NationalId)) {
      return sendRes(res, 400, false, "Invalid National ID");
    }

    const dateOfBirth = extractDOBFromNationalId(NationalId);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone }, { NationalId }],
    });

    if (existingUser && existingUser.isVerified) {
      return sendRes(res, 400, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = generateOTP();

    const user = await User.findOneAndUpdate(
      {
        $or: [{ email: normalizedEmail }, { phone }, { NationalId }],
      },
      {
        name: name.trim(),
        email: normalizedEmail,
        phone,
        role: "user",
        password: hashedPassword,
        NationalId,
        country,
        dateOfBirth,
        signupOtp: hashOTP(otp),
        signupOtpExpires:
          Date.now() + Number(process.env.OTP_EXPIRES_MINUTES || 5) * 60 * 1000,
        isVerified: false,
        oauthProvider: "local",
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );

    // send email only for testing
    await sendEmail(normalizedEmail, "Verify your account", `OTP: ${otp}`);

    // later use this if Twilio configured
    // await sendSMS(phone, `Your OTP is ${otp}`);

    sendRes(res, 200, true, "OTP sent successfully", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, err.message);
  }
};
exports.signupByAdmin = async (req, res) => {
  try {
    const { name, phone, email, password, NationalId, country, role } =
      req.body;

    if (!name || !email || !password || !phone || !NationalId || !role) {
      return sendRes(res, 400, false, "Missing required fields");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
      return sendRes(res, 400, false, "Invalid phone number");
    }

    const nationalIdRegex = /^[0-9]{14}$/;
    if (!nationalIdRegex.test(NationalId)) {
      return sendRes(res, 400, false, "Invalid National ID");
    }

    const allowedRoles = ["user", "admin", "commissary"];
    if (!allowedRoles.includes(role.toLowerCase())) {
      return sendRes(res, 400, false, "Invalid role");
    }

    const dateOfBirth = extractDOBFromNationalId(NationalId);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone }, { NationalId }],
    });

    if (existingUser && existingUser.isVerified) {
      return sendRes(res, 400, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = generateOTP();

    const user = await User.findOneAndUpdate(
      {
        $or: [{ email: normalizedEmail }, { phone }, { NationalId }],
      },
      {
        name: name.trim(),
        email: normalizedEmail,
        phone,
        role: role.toLowerCase(),
        password: hashedPassword,
        NationalId,
        country,
        dateOfBirth,
        signupOtp: hashOTP(otp),
        signupOtpExpires:
          Date.now() + Number(process.env.OTP_EXPIRES_MINUTES || 5) * 60 * 1000,
        isVerified: false,
        oauthProvider: "local",
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );

    await Promise.all([
      sendEmail(normalizedEmail, "Verify your account", `OTP: ${otp}`),
      sendSMS(phone, `Your OTP is ${otp}`),
    ]);

    sendRes(res, 200, true, "OTP sent successfully", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
      user,
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, err.message);
  }
};
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) return sendRes(res, 400, false, "Email required");

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) return sendRes(res, 404, false, "User not found");

    // 30 sec cooldown
    if (
      user.signupOtpExpires &&
      Date.now() < user.signupOtpExpires - 4.5 * 60 * 1000
    ) {
      return sendRes(
        res,
        429,
        false,
        "Wait 30 seconds before requesting new OTP",
      );
    }

    const otp = generateOTP();

    user.signupOtp = hashOTP(otp);
    user.signupOtpExpires =
      Date.now() + Number(process.env.OTP_EXPIRES_MINUTES || 5) * 60 * 1000;

    await user.save();

    await Promise.all([
      sendEmail(normalizedEmail, "Verify your account", `OTP: ${otp}`),
      sendSMS(user.phone, `Your OTP is ${otp}`),
    ]);

    sendRes(res, 200, true, "OTP resent", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Error resending OTP");
  }
};

// ================= VERIFY OTP =================
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp, type } = req.body;

    if (!email || !otp || !type) {
      return sendRes(res, 400, false, "Missing required fields");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) return sendRes(res, 404, false, "User not found");

    const key = normalizedEmail;
    if (!otpAttempts.has(key)) otpAttempts.set(key, 0);

    if (otpAttempts.get(key) >= 5) {
      return sendRes(res, 429, false, "Too many wrong OTP attempts");
    }

    let storedOtp;
    let expires;

    if (type === "signup") {
      storedOtp = user.signupOtp;
      expires = user.signupOtpExpires;
    } else if (type === "reset") {
      storedOtp = user.resetOtp;
      expires = user.resetOtpExpires;
    } else {
      return sendRes(res, 400, false, "Invalid type");
    }

    if (storedOtp !== hashOTP(String(otp).trim()) || Date.now() > expires) {
      otpAttempts.set(key, otpAttempts.get(key) + 1);
      return sendRes(res, 400, false, "Invalid or expired OTP");
    }

    otpAttempts.delete(key);

    if (type === "signup") {
      user.isVerified = true;
      user.signupOtp = null;
      user.signupOtpExpires = null;
      await user.save();

      const token = generateToken(user);

      return sendRes(res, 200, true, "Account verified", {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    }

    return sendRes(res, 200, true, "OTP valid");
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, err.message);
  }
};
const loginAttempts = new Map();
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendRes(res, 400, false, "Missing credentials");
    }

    const normalizedEmail = email.toLowerCase().trim();

    // brute force protection
    if (!loginAttempts.has(normalizedEmail)) {
      loginAttempts.set(normalizedEmail, { count: 0, lockUntil: null });
    }

    const attempt = loginAttempts.get(normalizedEmail);

    if (attempt.lockUntil && Date.now() < attempt.lockUntil) {
      return sendRes(res, 429, false, "Too many attempts. Try later");
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) return sendRes(res, 400, false, "Invalid credentials");

    if (!user.isVerified) {
      return sendRes(res, 403, false, "Email not verified");
    }

    if (!user.isActive) {
      return sendRes(res, 403, false, "Account disabled");
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      attempt.count += 1;

      if (attempt.count >= 5) {
        attempt.lockUntil = Date.now() + 15 * 60 * 1000;
      }

      loginAttempts.set(normalizedEmail, attempt);

      return sendRes(res, 400, false, "Invalid credentials");
    }

    loginAttempts.delete(normalizedEmail);

    const token = generateToken(user);

    sendRes(res, 200, true, "Login successful", {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Login error");
  }
};

// ================= FORGOT PASSWORD =================
exports.forgotPassword = async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email && !phone) {
      return sendRes(res, 400, false, "Email or phone required");
    }

    const normalizedEmail = email?.toLowerCase().trim();

    const user = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone }],
    });

    if (!user) return sendRes(res, 404, false, "User not found");

    const otp = String(generateOTP());

    user.resetOtp = hashOTP(otp);
    user.resetOtpExpires = Date.now() + 5 * 60 * 1000;

    await user.save();

    await Promise.all([
      normalizedEmail
        ? sendEmail(normalizedEmail, "Reset Password OTP", `OTP: ${otp}`)
        : Promise.resolve(),
      phone ? sendSMS(phone, `Your OTP is ${otp}`) : Promise.resolve(),
    ]);

    sendRes(res, 200, true, "OTP sent", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, err.message);
  }
};

// ================= RESET PASSWORD =================
exports.resetPassword = async (req, res) => {
  try {
    const { email, phone, otp, newPassword } = req.body;

    if ((!email && !phone) || !otp || !newPassword) {
      return sendRes(res, 400, false, "Missing required fields");
    }

    const normalizedEmail = email?.toLowerCase().trim();

    const user = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone }],
    });

    if (!user) return sendRes(res, 404, false, "User not found");

    if (
      user.resetOtp !== hashOTP(String(otp).trim()) ||
      Date.now() > user.resetOtpExpires
    ) {
      return sendRes(res, 400, false, "Invalid or expired OTP");
    }

    // password validation
    if (newPassword.length < 8) {
      return sendRes(res, 400, false, "Password must be at least 8 characters");
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetOtp = null;
    user.resetOtpExpires = null;

    await user.save();

    sendRes(res, 200, true, "Password reset successful");
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Reset failed");
  }
};
// ================= LOGIN WITH GOOGLE =================
exports.loginWithGoogle = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return sendRes(res, 400, false, "Google token required");
    }

    const payload = await verifyGoogleToken(token);

    if (!payload?.email) {
      return sendRes(res, 400, false, "Invalid Google account");
    }

    let user = await User.findOne({ email: payload.email });

    if (!user) {
      user = await User.create({
        name: payload.name,
        email: payload.email.toLowerCase().trim(),
        role: "User",
        oauthProvider: "google",
        isVerified: true,
        isActive: true,
      });
    }

    if (!user.isActive) {
      return sendRes(res, 403, false, "Account disabled");
    }

    const appToken = generateToken(user);

    sendRes(res, 200, true, "Google login success", {
      token: appToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Google login failed");
  }
};

// ================= LOGIN WITH FACEBOOK =================
exports.loginWithFacebook = async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return sendRes(res, 400, false, "Facebook token required");
    }

    const profile = await verifyFacebookToken(accessToken);

    if (!profile?.email) {
      return sendRes(res, 400, false, "Invalid Facebook account");
    }

    let user = await User.findOne({ email: profile.email });

    if (!user) {
      user = await User.create({
        name: profile.name,
        email: profile.email.toLowerCase().trim(),
        role: "User",
        oauthProvider: "facebook",
        isVerified: true,
        isActive: true,
      });
    }

    if (!user.isActive) {
      return sendRes(res, 403, false, "Account disabled");
    }

    const appToken = generateToken(user);

    sendRes(res, 200, true, "Facebook login success", {
      token: appToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Facebook login failed");
  }
};
exports.getAccount = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendRes(res, 401, false, "Unauthorized");
    }

    const user = await User.findById(req.user.id).select(
      "-password -signupOtp -resetOtp",
    );

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    sendRes(res, 200, true, "Account fetched", user);
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Error fetching account");
  }
};
// ================= UPDATE ACCOUNT =================
exports.updateAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) return sendRes(res, 401, false, "Unauthorized");

    const { name, email, password, phone, NationalId, country, role } =
      req.body;

    if (
      !name &&
      !email &&
      !password &&
      !phone &&
      !NationalId &&
      !country &&
      !role
    ) {
      return sendRes(res, 400, false, "No data provided");
    }

    const updateData = {};

    if (name) updateData.name = name.trim();

    if (email) {
      const normalizedEmail = email.toLowerCase().trim();

      const exists = await User.findOne({ email: normalizedEmail });

      if (exists && exists._id.toString() !== userId) {
        return sendRes(res, 400, false, "Email already in use");
      }

      updateData.email = normalizedEmail;
      updateData.isVerified = false; // force reverify on email change
    }

    if (phone) {
      const phoneRegex = /^01[0125][0-9]{8}$/;
      if (!phoneRegex.test(phone)) {
        return sendRes(res, 400, false, "Invalid phone number");
      }

      const exists = await User.findOne({ phone });

      if (exists && exists._id.toString() !== userId) {
        return sendRes(res, 400, false, "Phone already in use");
      }

      updateData.phone = phone;
    }

    if (NationalId) {
      const nationalIdRegex = /^[0-9]{14}$/;
      if (!nationalIdRegex.test(NationalId)) {
        return sendRes(res, 400, false, "Invalid National ID");
      }

      const exists = await User.findOne({ NationalId });

      if (exists && exists._id.toString() !== userId) {
        return sendRes(res, 400, false, "National ID already in use");
      }

      updateData.NationalId = NationalId;
      updateData.dateOfBirth = extractDOBFromNationalId(NationalId);
    }

    if (country) updateData.country = country;

    // prevent self role escalation
    if (role) {
      return sendRes(res, 403, false, "Role cannot be updated here");
    }

    if (password) {
      if (password.length < 8) {
        return sendRes(
          res,
          400,
          false,
          "Password must be at least 8 characters",
        );
      }

      updateData.password = await bcrypt.hash(password, 12);
    }

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select("-password -signupOtp -resetOtp");

    sendRes(res, 200, true, "Account updated", user);
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Error updating account");
  }
};

// ================= DELETE ACCOUNT =================
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) return sendRes(res, 401, false, "Unauthorized");

    const user = await User.findById(userId);

    if (!user) return sendRes(res, 404, false, "User not found");

    if (user.role === "Admin") {
      return sendRes(res, 403, false, "Admin account cannot be deleted");
    }

    const hasBookings = await Booking.exists({
      user_id: userId,
      status: "active",
    });

    if (hasBookings) {
      return sendRes(
        res,
        400,
        false,
        "Cannot delete account with active bookings",
      );
    }

    // soft delete better for production
    user.isActive = false;
    user.email = `deleted_${Date.now()}_${user.email}`;
    user.phone = null;
    await user.save();

    sendRes(res, 200, true, "Account deleted successfully");
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Error deleting account");
  }
};

//----------------------
//! NumberOfMethods :- 11
//----------------------
//? signup
//? verifyotp
//? resendOTP
//? login
//? forgotPassword
//? resetPassword
//? loginWithGoogle
//? loginWithFacebook
//? getAccount
//? updateAccount
//? deleteAccount
//----------------------
