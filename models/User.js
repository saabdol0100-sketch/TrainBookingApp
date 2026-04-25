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

    NationalId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    country: {
      type: String,
      trim: true,
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

    signupOtp: {
      type: String,
      default: null,
    },

    signupOtpExpires: {
      type: Date,
      default: null,
    },

    resetOtp: {
      type: String,
      default: null,
    },

    resetOtpExpires: {
      type: Date,
      default: null,
    },

    otp: {
      type: String,
      default: null,
    },

    otpExpires: {
      type: Date,
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

const countryPhoneCodes = {
  Egypt: "+20",
  "Saudi Arabia": "+966",
  USA: "+1",
  UK: "+44",
  France: "+33",
  Germany: "+49",
  India: "+91",
  Canada: "+1",
  UAE: "+971",
  Qatar: "+974",
  Kuwait: "+965",
  Jordan: "+962",
  Morocco: "+212",
  Algeria: "+213",
  Tunisia: "+216",
};

userSchema.pre("save", async function () {
  const expectedCode = countryPhoneCodes[this.country];
  if (expectedCode && !this.phone.startsWith(expectedCode)) {
    throw new Error(
      `Phone number must start with ${expectedCode} for ${this.country}`,
    );
  }
});

userSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.signupOtp;
    delete ret.signupOtpExpires;
    delete ret.resetOtp;
    delete ret.resetOtpExpires;
    delete ret.otp;
    delete ret.otpExpires;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
