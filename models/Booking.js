const mongoose = require("mongoose");

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
    this.bookingRef =
      "BK-" +
      Date.now().toString().slice(-6) +
      "-" +
      Math.floor(Math.random() * 1000);
  }
});

bookingSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Booking", bookingSchema);
