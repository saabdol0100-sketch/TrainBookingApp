const mongoose = require("mongoose");

const stationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    location: {
      type: String,
      trim: true,
    },

    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

stationSchema.index({ coordinates: "2dsphere" });

stationSchema.virtual("displayName").get(function () {
  return this.name.charAt(0).toUpperCase() + this.name.slice(1);
});

stationSchema.set("toJSON", { virtuals: true });
stationSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Station", stationSchema);
