const User = require("../models/User");
const Booking = require("../models/Booking");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendEmail } = require("../services/emailService");
const { OAuth2Client } = require("google-auth-library");
const { verifyGoogleToken } = require("../services/googleService");
const { verifyFacebookToken } = require("../services/facebookService");
const { sendSMS } = require("../services/smsService");
const {
  generateToken,
  generateOTP,
  hashOTP,
  compareOTP,
} = require("../utils/authHelpers");

// ----------------------
// Helpers
// ----------------------
const sendRes = (res, status, success, msg, data = null) => {
  res.status(status).json({ success, msg, data });
};

const includeOtpIfDev = (otp) =>
  process.env.NODE_ENV === "production" ? { otp } : {};

const loginAttempts = new Map();
const otpAttempts = new Map();

// ----------------------
// Signup by Admin
// ----------------------
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

    let user = await User.findOne({ email: normalizedEmail });
    if (user && user.isVerified) {
      return sendRes(res, 400, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 12);
    const otp = generateOTP();

    const otpData = {
      otp: hashOTP(String(otp).trim()),
      otpExpires: Date.now() + 5 * 60 * 1000,
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
        isActive: true,
        oauthProvider: "local",
      });
    } else {
      user.name = name.trim();
      user.password = hashedPassword;
      Object.assign(user, otpData);
      await user.save();
    }

    await sendEmail(
      normalizedEmail,
      "Verify your account",
      `Your OTP is: ${otp}`,
    );

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
    console.error("SignupByAdmin Error:", err);
    return sendRes(res, 500, false, err.message);
  }
};

// ----------------------
// Signup
// ----------------------
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
    let user = await User.findOne({ email: normalizedEmail });

    if (user && user.isVerified) {
      return sendRes(res, 400, false, "User already exists");
    }
    if (user && user.otp && Date.now() < user.otpExpires) {
      return sendRes(res, 400, false, "OTP already sent. Verify first.");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = generateOTP();

    const otpData = {
      otp: hashOTP(otp),
      otpExpires: Date.now() + 10 * 60 * 1000,
      otpPurpose: "signup",
    };

    if (!user) {
      user = await User.create({
        name,
        email: normalizedEmail,
        phone,
        password: hashedPassword,
        role: "user",
        isVerified: false,
        ...otpData,
      });
    } else {
      user.name = name;
      user.password = hashedPassword;
      Object.assign(user, otpData);
      await user.save();
    }

    await sendEmail(normalizedEmail, "Verify your account", `OTP: ${otp}`);

    return sendRes(res, 200, true, "OTP sent", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

// ----------------------
// Resend OTP
// ----------------------
exports.resendOTP = async (req, res) => {
  try {
    const { email, type } = req.body;

    if (!email || !type) {
      return sendRes(res, 400, false, "Missing fields");
    }

    if (!["signup", "reset"].includes(type)) {
      return sendRes(res, 400, false, "Invalid type");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    // ⏱ cooldown 30 sec
    if (user.otpSentAt && Date.now() - user.otpSentAt < 30 * 1000) {
      return sendRes(res, 429, false, "Wait 30 seconds");
    }

    const otp = generateOTP();

    user.otp = hashOTP(otp);
    user.otpExpires = Date.now() + 10 * 60 * 1000;
    user.otpPurpose = type;
    user.otpSentAt = Date.now();
    user.otpAttempts = 0; // 🔥 reset attempts

    await user.save();

    await sendEmail({
      to: user.email,
      subject: "OTP Code",
      text: `Your OTP is: ${otp}`,
    });
    return sendRes(res, 200, true, "OTP resent", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};
// ----------------------
// Verify OTP
// ----------------------
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp, type } = req.body;

    if (!email || !otp || !type) {
      return sendRes(res, 400, false, "Missing fields");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    if (!user.otp || !user.otpExpires || !user.otpPurpose) {
      return sendRes(res, 400, false, "No OTP found");
    }

    if (user.otpPurpose !== type) {
      return sendRes(res, 400, false, "OTP type mismatch");
    }

    // 🚫 block after 5 attempts
    if (user.otpAttempts >= 5) {
      return sendRes(res, 429, false, "Too many attempts, request new OTP");
    }

    // ⏳ expired
    if (Date.now() > new Date(user.otpExpires).getTime()) {
      return sendRes(res, 400, false, "OTP expired");
    }

    const hashedIncoming = hashOTP(otp);
    const isMatch = compareOTP(user.otp, hashedIncoming);

    if (!isMatch) {
      user.otpAttempts += 1;
      await user.save();

      return sendRes(res, 400, false, "Invalid OTP");
    }

    // ✅ success
    if (type === "signup") {
      user.isVerified = true;
    }

    // 🔥 clear everything
    user.otp = null;
    user.otpExpires = null;
    user.otpPurpose = null;
    user.otpSentAt = null;
    user.otpAttempts = 0;

    await user.save();

    return sendRes(res, 200, true, "OTP verified successfully", {
      ...(type === "signup" && { token: generateToken(user) }),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};
// ----------------------
// باقي الدوال (login, forgotPassword, resetPassword, loginWithGoogle, loginWithFacebook, getAccount, updateAccount, deleteAccount)
// ----------------------
// نفس الـ logic الأساسي زي ما عندك، بس مرتب ومنظم بنفس الأسلوب أعلاه.

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    if (!loginAttempts.has(normalizedEmail)) {
      loginAttempts.set(normalizedEmail, { count: 0 });
    }

    const attempt = loginAttempts.get(normalizedEmail);

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password",
    );

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

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    // ⏱ cooldown
    if (user.otpSentAt && Date.now() - user.otpSentAt < 30 * 1000) {
      return sendRes(res, 429, false, "Wait 30 seconds");
    }

    const otp = generateOTP();

    user.otp = hashOTP(otp);
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    user.otpPurpose = "reset";
    user.otpSentAt = Date.now();
    user.otpAttempts = 0;

    await user.save();
    await sendEmail({
      to: user.email,
      subject: "Reset OTP",
      text: `Your OTP code is: ${otp}`,
    });
    return sendRes(res, 200, true, "OTP sent", {
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return sendRes(res, 404, false, "User not found");
    }

    if (!user.otp || !user.otpExpires || user.otpPurpose !== "reset") {
      return sendRes(res, 400, false, "Invalid OTP state");
    }

    if (user.otpAttempts >= 5) {
      return sendRes(res, 429, false, "Too many attempts");
    }

    if (Date.now() > new Date(user.otpExpires).getTime()) {
      return sendRes(res, 400, false, "OTP expired");
    }

    const hashedIncoming = hashOTP(otp);
    const isMatch = compareOTP(user.otp, hashedIncoming);

    if (!isMatch) {
      user.otpAttempts += 1;
      await user.save();
      return sendRes(res, 400, false, "Invalid OTP");
    }

    if (!newPassword || newPassword.length < 8) {
      return sendRes(res, 400, false, "Password must be at least 8 characters");
    }

    user.password = await bcrypt.hash(newPassword, 12);

    // 🔥 clear OTP
    user.otp = null;
    user.otpExpires = null;
    user.otpPurpose = null;
    user.otpSentAt = null;
    user.otpAttempts = 0;

    await user.save();

    return sendRes(res, 200, true, "Password reset successful");
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};

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

    if (user.role === "admin") {
      return sendRes(res, 403, false, "Admin account cannot be deleted");
    }

    const hasBookings = await Booking.exists({
      userId: userId,
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

    // ✅ حذف نهائي
    await User.findByIdAndDelete(userId);

    return sendRes(res, 200, true, "Account permanently deleted");
  } catch (err) {
    console.error("DeleteAccount Error:", err.message, err);
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
