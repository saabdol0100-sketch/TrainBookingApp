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

    // 🔥 REAL train types
    type: {
      type: String,
      enum: ["VIP", "Spanish", "French", "Russian", "Talgo"],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "maintenance", "disabled"],
      default: "active",
      index: true,
    },

    // 🔥 seats per class (CRITICAL)
    classes: {
      VIP: { type: Number, default: 0 },
      First: { type: Number, default: 0 },
      Second: { type: Number, default: 0 },
    },

    // 🔥 layout system
    layout: {
      type: String,
      enum: ["standard", "talgo_first", "talgo_second"],
      default: "standard",
    },
  },
  { timestamps: true },
);

// display helper
trainSchema.virtual("displayName").get(function () {
  return `${this.name} (#${this.number})`;
});

trainSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Train", trainSchema);
