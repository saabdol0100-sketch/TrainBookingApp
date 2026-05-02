const mongoose = require("mongoose");

const seatSchema = new mongoose.Schema(
  {
    trip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trip",
      required: true,
      index: true,
    },

    seatNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    classType: {
      type: String,
      enum: ["VIP", "First", "Second"],
      required: true,
      index: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["available", "reserved", "booked"],
      default: "available",
      index: true,
    },

    reservedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    reservedAt: Date,

    expireAt: {
      type: Date,
      index: true, // 🔥 used for TTL
    },

    bookedAt: Date,
  },
  { timestamps: true },
);

// ✅ UNIQUE seat per trip
seatSchema.index({ trip: 1, seatNumber: 1 }, { unique: true });

// ✅ fast filtering
seatSchema.index({ trip: 1, status: 1 });
seatSchema.index({ trip: 1, classType: 1 });

module.exports = mongoose.model("Seat", seatSchema);
