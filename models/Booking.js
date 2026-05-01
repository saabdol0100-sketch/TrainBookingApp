const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    seat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seat",
      required: true,
      index: true,
    },

    trip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trip",
      required: true,
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "cancelled", "completed"],
      default: "active",
      index: true,
    },

    qrCode: {
      type: String,
      default: null,
    },

    used: {
      type: Boolean,
      default: false,
      index: true,
    },

    usedAt: {
      type: Date,
      default: null,
    },
    passenger: {
      name: { type: String, required: true }, // اسم الراكب
      middleName: { type: String }, // الاسم الأوسط (اختياري)
      phone: { type: String }, // رقم الهاتف
      email: { type: String }, // البريد الإلكتروني
      nationalId: { type: String }, // الرقم القومي أو جواز السفر
      nationality: { type: String }, // الجنسية
      profileType: { type: String }, // نوع الملف (مثلاً: بالغ/طفل)
    },
    bookingRef: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true },
);

bookingSchema.index({ seat: 1, trip: 1 }, { unique: true });
bookingSchema.pre("save", function () {
  if (!this.bookingRef) {
    this.bookingRef = "BK-" + uuidv4();
  }
});

bookingSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});
// todo  auto-generated + safe + production-ready booking reference .
module.exports = mongoose.model("Booking", bookingSchema);
