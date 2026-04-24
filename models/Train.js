const mongoose = require("mongoose");

const trainSchema = new mongoose.Schema(
  {
    number: {
      type: Number,
      unique: true,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    route: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    seats: {
      type: Number,
      required: true,
      min: [1, "Train must have at least 1 seat"],
      max: [2000, "Too many seats"],
    },

    status: {
      type: String,
      enum: ["active", "maintenance", "disabled"],
      default: "active",
      index: true,
    },

    type: {
      type: String,
      enum: ["express", "vip", "normal"],
      default: "normal",
    },
  },
  { timestamps: true },
);

trainSchema.virtual("displayName").get(function () {
  return `${this.name} (#${this.number})`;
});

trainSchema.set("toJSON", { virtuals: true });
trainSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Train", trainSchema);
