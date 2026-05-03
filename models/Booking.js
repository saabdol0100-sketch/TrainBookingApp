const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    trip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trip",
      required: true,
      index: true,
    },

    // ✅ MULTI SEATS
    seats: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Seat",
        required: true,
      },
    ],

    // ✅ MULTI PASSENGERS
    passengers: [
      {
        name: { type: String, required: true },
        middleName: String,
        phone: String,
        email: String,
        nationalId: String,
        nationality: String,
        profileType: String,
      },
    ],

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

    qrCode: String,

    used: {
      type: Boolean,
      default: false,
      index: true,
    },

    usedAt: Date,

    bookingRef: {
      type: String,
      unique: true,
      index: true,
    },

    transactionId: {
      type: String,
      unique: true, // 🔥 prevents duplicate payment usage
      sparse: true,
    },

    paidAt: Date,
  },
  { timestamps: true },
);

// 🔥 IMPORTANT: NO unique index on seats array

bookingSchema.pre("save", function () {
  if (!this.bookingRef) {
    this.bookingRef = "BK-" + randomUUID();
  }
});

module.exports = mongoose.model("Booking", bookingSchema);
