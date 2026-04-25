const mongoose = require("mongoose");

const seatSchema = new mongoose.Schema(
  {
    train: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Train",
      required: true,
      index: true,
    },

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
    status: {
      type: String,
      enum: ["available", "reserved", "booked", "cancelled"],
      default: "available",
      index: true,
    },

    reservedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    reservedAt: {
      type: Date,
      default: null,
    },

    expireAt: {
      type: Date,
      default: null,
    },

    bookedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

seatSchema.index({ trip: 1, seatNumber: 1 }, { unique: true });
seatSchema.index({ trip: 1, status: 1 });

seatSchema.methods.isExpired = function () {
  return this.expireAt && this.expireAt < new Date();
};

seatSchema.methods.isAvailable = function () {
  return this.status === "available" || this.isExpired();
};

module.exports = mongoose.model("Seat", seatSchema);
