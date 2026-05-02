const User = require("../models/User");
const Booking = require("../models/Booking");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendEmail } = require("../services/emailService");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
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

const includeOtpIfDev = (otp) => {
  if (process.env.NODE_ENV === "development") {
    return { otp };
  }
  return {};
};
exports.signupByAdmin = async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword, role } = req.body;

    if (!name || !email || !phone || !password || !confirmPassword || !role) {
      return sendRes(res, 400, false, "Missing required fields");
    }

    if (password !== confirmPassword) {
      return sendRes(res, 400, false, "Passwords do not match");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
      return sendRes(res, 400, false, "Invalid phone number");
    }

    const allowedRoles = ["user", "admin", "commissary"];
    if (!allowedRoles.includes(role.toLowerCase())) {
      return sendRes(res, 400, false, "Invalid role");
    }

    let user = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone }],
    });

    if (user && user.isVerified) {
      return sendRes(res, 400, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = generateOTP();

    const otpData = {
      otp: hashOTP(otp),
      otpExpires:
        Date.now() + Number(process.env.OTP_EXPIRES_MINUTES || 5) * 60 * 1000,
      otpPurpose: "signup",
    };

    if (!user) {
      user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        phone,
        role: role.toLowerCase(),
        password: hashedPassword,
        ...otpData,
        isVerified: false,
        oauthProvider: "local",
      });
    } else {
      user.name = name.trim();
      user.password = hashedPassword;
      Object.assign(user, otpData);
      user.isVerified = false;
      await user.save();
    }

    await Promise.all([
      sendEmail(normalizedEmail, "Verify your account", `OTP: ${otp}`),
      sendSMS(phone, `Your OTP is ${otp}`),
    ]);

    return sendRes(res, 200, true, "OTP sent successfully", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

exports.signup = async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    if (!name || !email || !phone || !password || !confirmPassword) {
      return sendRes(res, 400, false, "Missing required fields");
    }

    if (password !== confirmPassword) {
      return sendRes(res, 400, false, "Passwords do not match");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const userExists = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone }],
    });

    if (userExists && userExists.isVerified) {
      return sendRes(res, 400, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = generateOTP();

    const otpData = {
      otp: hashOTP(otp),
      otpExpires: Date.now() + 5 * 60 * 1000,
      otpPurpose: "signup",
    };

    let user;

    if (!userExists) {
      user = await User.create({
        name,
        email: normalizedEmail,
        phone,
        password: hashedPassword,
        role: "user",
        ...otpData,
        isVerified: false,
      });
    } else {
      userExists.name = name;
      userExists.password = hashedPassword;
      Object.assign(userExists, otpData);
      userExists.isVerified = false;
      await userExists.save();
      user = userExists;
    }

    await sendEmail(normalizedEmail, "OTP", `OTP: ${otp}`);

    return sendRes(res, 200, true, "OTP sent", {
      ...includeOtpIfDev(otp),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

exports.resendOTP = async (req, res) => {
  try {
    const { email, type } = req.body;

    if (!type || !["signup", "reset"].includes(type)) {
      return sendRes(res, 400, false, "Invalid OTP type");
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return sendRes(res, 404, false, "User not found");

    if (user.otpExpires && Date.now() < user.otpExpires - 4.5 * 60 * 1000) {
      return sendRes(res, 429, false, "Wait 30 seconds");
    }

    const otp = generateOTP();

    user.otp = hashOTP(otp);
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    user.otpPurpose = type;

    await user.save();

    await sendEmail(user.email, "OTP", `OTP: ${otp}`);

    return sendRes(res, 200, true, "OTP resent", {
      ...includeOtpIfDev(otp),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp, type } = req.body;

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return sendRes(res, 404, false, "User not found");

    const key = email;

    if (!otpAttempts.has(key)) otpAttempts.set(key, 0);

    if (otpAttempts.get(key) >= 5) {
      return sendRes(res, 429, false, "Too many attempts");
    }

    if (
      !user.otp ||
      user.otp !== hashOTP(String(otp).trim()) ||
      Date.now() > user.otpExpires ||
      user.otpPurpose !== type
    ) {
      otpAttempts.set(key, otpAttempts.get(key) + 1);
      return sendRes(res, 400, false, "Invalid or expired OTP");
    }

    otpAttempts.delete(key);

    if (type === "signup") {
      user.isVerified = true;
    }

    user.otp = null;
    user.otpExpires = null;
    user.otpPurpose = null;

    await user.save();

    if (type === "signup") {
      return sendRes(res, 200, true, "Account verified", {
        token: generateToken(user),
      });
    }

    return sendRes(res, 200, true, "OTP verified");
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    if (!loginAttempts.has(normalizedEmail)) {
      loginAttempts.set(normalizedEmail, { count: 0 });
    }

    const attempt = loginAttempts.get(normalizedEmail);

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      attempt.count++;
      if (attempt.count >= 5) {
        return sendRes(res, 429, false, "Too many attempts");
      }
      return sendRes(res, 400, false, "Invalid credentials");
    }

    loginAttempts.delete(normalizedEmail);

    if (!user.isVerified) {
      return sendRes(res, 403, false, "Verify email first");
    }

    return sendRes(res, 200, true, "Login success", {
      token: generateToken(user),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return sendRes(res, 404, false, "User not found");

    const otp = generateOTP();

    user.otp = hashOTP(otp);
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    user.otpPurpose = "reset";

    await user.save();

    await sendEmail(user.email, "Reset OTP", `OTP: ${otp}`);

    return sendRes(res, 200, true, "OTP sent", {
      ...includeOtpIfDev(otp),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return sendRes(res, 404, false, "User not found");

    if (!user.otp || user.otpPurpose !== "reset") {
      return sendRes(res, 400, false, "OTP not verified");
    }

    if (newPassword.length < 8) {
      return sendRes(res, 400, false, "Password too short");
    }

    user.password = await bcrypt.hash(newPassword, 12);

    user.otp = null;
    user.otpExpires = null;
    user.otpPurpose = null;

    await user.save();

    return sendRes(res, 200, true, "Password reset successful");
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};
const loginAttempts = new Map();
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

    const normalizedEmail = payload.email.toLowerCase().trim();

    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({
        name: payload.name,
        email: normalizedEmail,
        role: "user",
        oauthProvider: "google",
        isVerified: true,
        isActive: true,
      });
    }

    if (!user.isActive) {
      return sendRes(res, 403, false, "Account disabled");
    }

    return sendRes(res, 200, true, "Google login success", {
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.log(err);
    return sendRes(res, 500, false, "Google login failed");
  }
};
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

    const normalizedEmail = profile.email.toLowerCase().trim();

    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({
        name: profile.name,
        email: normalizedEmail,
        role: "user",
        oauthProvider: "facebook",
        isVerified: true,
        isActive: true,
      });
    }

    if (!user.isActive) {
      return sendRes(res, 403, false, "Account disabled");
    }

    return sendRes(res, 200, true, "Facebook login success", {
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.log(err);
    return sendRes(res, 500, false, "Facebook login failed");
  }
};
exports.getAccount = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendRes(res, 401, false, "Unauthorized");
    }

    const user = await User.findById(req.user.id).select(
      "-password -otp -otpExpires -otpPurpose",
    );

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    return sendRes(res, 200, true, "Account fetched", user);
  } catch (err) {
    console.log(err);
    return sendRes(res, 500, false, "Error fetching account");
  }
};
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
      updateData.isVerified = false;
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
    }).select("-password -otp -otpExpires -otpPurpose");

    return sendRes(res, 200, true, "Account updated", user);
  } catch (err) {
    console.log(err);
    return sendRes(res, 500, false, "Error updating account");
  }
};
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendRes(res, 401, false, "Unauthorized");
    }

    const user = await User.findById(userId);

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    if (!user.isActive) {
      return sendRes(res, 400, false, "Account already deleted");
    }

    if (user.role === "admin") {
      return sendRes(res, 403, false, "Admin account cannot be deleted");
    }

    const hasBookings = await Booking.exists({
      user_id: userId,
      status: { $in: ["active", "reserved"] },
    });

    if (hasBookings) {
      return sendRes(
        res,
        400,
        false,
        "Cannot delete account with active bookings",
      );
    }

    user.isActive = false;
    user.isVerified = false;

    user.email = `deleted_${Date.now()}_${user.email}`;
    user.phone = null;

    user.otp = null;
    user.otpExpires = null;
    user.otpPurpose = null;

    await user.save();

    return sendRes(res, 200, true, "Account deleted successfully");
  } catch (err) {
    console.log(err);
    return sendRes(res, 500, false, "Error deleting account");
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
