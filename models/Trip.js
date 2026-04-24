const mongoose = require("mongoose");

const tripSchema = new mongoose.Schema(
  {
    train: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Train",
      required: true,
      index: true,
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
    },

    arrivalDate: {
      type: Date,
      required: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    status: {
      type: String,
      enum: ["scheduled", "cancelled", "completed"],
      default: "scheduled",
      index: true,
    },
  },
  { timestamps: true },
);

tripSchema.pre("save", async function () {
  if (this.fromStation.toString() === this.toStation.toString()) {
    throw new Error("From and To station cannot be same");
  }

  if (this.arrivalDate <= this.departureDate) {
    throw new Error("Arrival must be after departure");
  }
});

tripSchema.index({
  fromStation: 1,
  toStation: 1,
  departureDate: 1,
});

module.exports = mongoose.model("Trip", tripSchema);
