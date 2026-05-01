const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email"],
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    role: {
      type: String,
      enum: ["user", "admin", "commissary"],
      default: "user",
      index: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    otp: {
      type: String,
      default: null,
    },

    otpExpires: {
      type: Date,
      default: null,
    },
    otpPurpose: {
      type: String,
      enum: ["signup", "reset", "verify"],
      default: null,
    },
    oauthProvider: {
      type: String,
      enum: ["local", "google", "facebook"],
      default: "local",
    },
  },
  { timestamps: true },
);
userSchema.index({ email: 1, phone: 1 });
userSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.otp;
    delete ret.otpExpires;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
