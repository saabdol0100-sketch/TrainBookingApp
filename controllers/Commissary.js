const Booking = require("../models/Booking");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

exports.verifyQRCode = async (req, res) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode || typeof qrCode !== "string") {
      return send(res, {
        success: false,
        msg: "Valid QR Code required",
        status: 400,
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(qrCode, process.env.QR_SECRET);
    } catch (err) {
      return send(res, {
        success: false,
        msg: "Invalid or expired QR Code",
        status: 401,
      });
    }

    const { bookingId } = decoded;

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return send(res, {
        success: false,
        msg: "Invalid QR data",
        status: 400,
      });
    }

    const booking = await Booking.findById(bookingId)
      .populate("user", "name")
      .populate("seat", "seatNumber")
      .populate({
        path: "trip",
        populate: {
          path: "train_id",
          select: "name",
        },
      })
      .lean();

    if (!booking) {
      return send(res, {
        success: false,
        msg: "Booking not found",
        status: 404,
      });
    }

    if (booking.status === "cancelled") {
      return send(res, {
        success: false,
        msg: "Booking is cancelled",
        status: 400,
      });
    }

    if (booking.paymentStatus !== "paid") {
      return send(res, {
        success: false,
        msg: "Payment not completed",
        status: 400,
      });
    }

    if (booking.used === true) {
      return send(res, {
        success: false,
        msg: "Ticket already used",
        status: 409,
      });
    }

    if (!booking.trip || new Date(booking.trip.departureDate) < new Date()) {
      return send(res, {
        success: false,
        msg: "Trip already passed",
        status: 400,
      });
    }

    const updated = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        used: { $ne: true },
      },
      {
        used: true,
        usedAt: new Date(),
      },
      { new: true },
    );

    if (!updated) {
      return send(res, {
        success: false,
        msg: "Ticket already used",
        status: 409,
      });
    }

    return send(res, {
      success: true,
      msg: "Ticket verified successfully",
      data: {
        bookingId: booking._id,
        passenger: booking.user?.name,
        train: booking.trip?.train_id?.name,
        seat: booking.seat?.seatNumber,
        tripDate: booking.trip?.departureDate,
      },
    });
  } catch (err) {
    console.error("QR VERIFY ERROR:", err);

    return send(res, {
      success: false,
      msg: "Error verifying QR Code",
      status: 500,
    });
  }
};
//-----------------
//! 1 Methods :
//------------------
// ?verifyQRCode
//------------------
