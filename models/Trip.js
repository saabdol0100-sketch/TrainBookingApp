const mongoose = require("mongoose");

const tripSchema = new mongoose.Schema(
  {
    train: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Train",
      required: true,
    },

    fromStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Station",
      required: true,
    },

    toStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Station",
      required: true,
    },

    departureDate: {
      type: Date,
      required: true,
      index: true,
    },

    arrivalDate: {
      type: Date,
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["scheduled", "cancelled", "completed"],
      default: "scheduled",
      index: true,
    },

    stops: [
      {
        station: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Station",
        },
        arrivalTime: Date,
        departureTime: Date,
      },
    ],
  },
  { timestamps: true },
);

tripSchema.index({
  fromStation: 1,
  toStation: 1,
  departureDate: 1,
});

module.exports = mongoose.model("Trip", tripSchema);
