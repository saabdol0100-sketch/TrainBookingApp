const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const Station = require("../models/Station");
const Trip = require("../models/Trip");
const Seat = require("../models/Seat");
const Booking = require("../models/Booking");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const sendRes = (res, status, success, msg, data = null) => {
  res.status(status).json({ success, msg, data });
};
exports.getAllStations = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const stations = await Station.find()
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Station.countDocuments();

    sendRes(res, 200, true, "Stations fetched", {
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      stations,
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Error fetching stations");
  }
};
exports.searchTrips = async (req, res) => {
  try {
    const { from, to, date, page = 1, limit = 10 } = req.query;

    if (!from || !to) {
      return sendRes(res, 400, false, "from & to required");
    }

    const query = {
      fromStation: from,
      toStation: to,
    };

    if (date) {
      const parsed = new Date(date);
      if (isNaN(parsed)) {
        return sendRes(res, 400, false, "Invalid date");
      }

      const nextDay = new Date(parsed);
      nextDay.setDate(nextDay.getDate() + 1);

      query.departureDate = {
        $gte: parsed,
        $lt: nextDay,
      };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const trips = await Trip.find(query)
      .populate("train_id", "name number route")
      .populate("fromStation", "name")
      .populate("toStation", "name")
      .sort({ departureDate: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Trip.countDocuments(query);

    sendRes(res, 200, true, "Trips fetched", {
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      trips,
    });
  } catch (err) {
    console.log(err);
    sendRes(res, 500, false, "Error fetching trips");
  }
};
exports.getStationByName = async (req, res) => {
  try {
    const { name } = req.query;

    if (!name?.trim()) {
      return sendRes(res, 400, false, "Station name required");
    }

    const stations = await Station.find({
      name: { $regex: name.trim(), $options: "i" },
    })
      .sort({ name: 1 })
      .select("-__v")
      .lean();

    return sendRes(res, 200, true, "Stations fetched", stations);
  } catch (err) {
    console.error("getStationByName:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.getTripRoute = async (req, res) => {
  try {
    const { tripId } = req.params;

    if (!tripId || !mongoose.Types.ObjectId.isValid(tripId)) {
      return sendRes(res, 400, false, "Valid tripId required");
    }

    const trip = await Trip.findById(tripId)
      .populate("train fromStation toStation")
      .lean();

    if (!trip) {
      return sendRes(res, 404, false, "Trip not found");
    }

    const stations = await Station.find().sort({ createdAt: 1 }).lean();

    const fromIndex = stations.findIndex(
      (s) => s._id.toString() === trip.fromStation._id.toString(),
    );

    const toIndex = stations.findIndex(
      (s) => s._id.toString() === trip.toStation._id.toString(),
    );

    let route = [];

    if (fromIndex <= toIndex) {
      route = stations.slice(fromIndex, toIndex + 1);
    } else {
      route = stations.slice(toIndex, fromIndex + 1).reverse();
    }

    return sendRes(res, 200, true, "Trip route fetched", {
      tripId: trip._id,
      train: trip.train,
      count: route.length,
      route,
    });
  } catch (err) {
    return sendRes(res, 500, false, err.message);
  }
};
exports.getTripByStations = async (req, res) => {
  try {
    const { from, to, startDate, endDate, page = 1, limit = 10 } = req.query;

    if (!from || !to) {
      return sendRes(res, 400, false, "from & to required");
    }

    // Build query dynamically
    const query = {
      fromStation: from,
      toStation: to,
    };

    // 🔹 Date range filter
    if (startDate || endDate) {
      query.departureDate = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.departureDate.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.departureDate.$lte = end;
      }
    }

    // 🔹 Pagination setup
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // 🔹 Fetch data
    const [trips, total] = await Promise.all([
      Trip.find(query)
        .populate("train fromStation toStation")
        .sort({ departureDate: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Trip.countDocuments(query),
    ]);

    return sendRes(res, 200, true, "Trips fetched", {
      trips,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("getTripByStations:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.getAllTripsByStationId = async (req, res) => {
  try {
    const { stationId } = req.query;

    if (!stationId || !mongoose.Types.ObjectId.isValid(stationId)) {
      return sendRes(res, 400, false, "Invalid stationId");
    }

    const trips = await Trip.find({
      $or: [{ fromStation: stationId }, { toStation: stationId }],
    })
      .populate("train fromStation toStation")
      .sort({ departureDate: 1 })
      .lean();

    return sendRes(res, 200, true, "Trips fetched", trips);
  } catch (err) {
    console.error("getAllTripsByStationId:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.getSeatsByTrip = async (req, res) => {
  try {
    const { tripId } = req.params;

    if (!tripId || !mongoose.Types.ObjectId.isValid(tripId)) {
      return sendRes(res, 400, false, "Invalid tripId");
    }

    const seats = await Seat.find({ trip: tripId })
      .select("-__v")
      .sort({ seatNumber: 1 })
      .limit(200)
      .lean();

    return sendRes(res, 200, true, "Seats fetched", seats);
  } catch (err) {
    console.error("getSeatsByTrip:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.holdSeat = async (req, res) => {
  try {
    const { seatId } = req.params;

    if (!seatId || !mongoose.Types.ObjectId.isValid(seatId)) {
      return sendRes(res, 400, false, "Invalid seatId");
    }

    const now = new Date();

    const seat = await Seat.findOneAndUpdate(
      {
        _id: seatId,
        $or: [
          { status: "available" },
          { status: "reserved", expireAt: { $lte: now } },
          { status: "reserved", reservedBy: req.user.id },
        ],
      },
      {
        status: "reserved",
        reservedBy: req.user.id,
        expireAt: new Date(Date.now() + 5 * 60 * 1000),
      },
      { new: true },
    );

    if (!seat) {
      return sendRes(res, 400, false, "Seat already reserved or booked");
    }

    return sendRes(res, 200, true, "Seat held", seat);
  } catch (err) {
    console.error("holdSeat:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.confirmPayment = async (req, res) => {
  try {
    const { seatId, transactionId } = req.body;

    if (!seatId || !mongoose.Types.ObjectId.isValid(seatId)) {
      return sendRes(res, 400, false, "Invalid seatId");
    }

    if (!transactionId) {
      return sendRes(res, 400, false, "Transaction ID required");
    }

    // 1) Auth with Paymob
    const authResponse = await axios.post(
      "https://accept.paymob.com/api/auth/tokens",
      {
        api_key: process.env.PAYMOB_API_KEY,
      },
    );

    const token = authResponse.data.token;

    // 2) Verify transaction
    const transactionResponse = await axios.get(
      `https://accept.paymob.com/api/acceptance/transactions/${transactionId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const payment = transactionResponse.data;

    if (!payment || payment.success !== true) {
      return sendRes(res, 400, false, "Payment not verified");
    }

    const seat = await Seat.findById(seatId);

    if (!seat) {
      return sendRes(res, 404, false, "Seat not found");
    }

    if (seat.status === "booked") {
      return sendRes(res, 400, false, "Seat already booked");
    }

    if (
      seat.status === "reserved" &&
      seat.reservedBy?.toString() !== req.user.id &&
      seat.expireAt > new Date()
    ) {
      return sendRes(res, 400, false, "Seat reserved by another user");
    }

    const existingBooking = await Booking.findOne({
      seat: seat._id,
      trip: seat.trip,
      status: { $ne: "cancelled" },
    });

    if (existingBooking) {
      return sendRes(res, 400, false, "Seat already booked");
    }

    const booking = await Booking.create({
      user: req.user.id,
      seat: seat._id,
      trip: seat.trip,
      paymentStatus: "paid",
      status: "active",
      paidAt: new Date(),
      transactionId,
    });

    seat.status = "booked";
    seat.reservedBy = null;
    seat.expireAt = null;

    await seat.save();

    const qrToken = jwt.sign(
      { bookingId: booking._id },
      process.env.QR_SECRET,
      { expiresIn: "6h" },
    );

    const qr = await QRCode.toDataURL(qrToken);

    booking.qrCode = qr;
    await booking.save();

    return sendRes(res, 200, true, "Payment confirmed & booking created", {
      booking,
      qr,
    });
  } catch (err) {
    console.error("confirmPayment:", err.response?.data || err.message);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.getMyBooks = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user.id })
      .populate("trip")
      .populate("seat")
      .sort({ createdAt: -1 })
      .lean();

    return sendRes(res, 200, true, "Bookings fetched", bookings);
  } catch (err) {
    console.error("getMyBooks:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.deleteBookById = async (req, res) => {
  try {
    const { id } = req.params;

    // validate booking id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return sendRes(res, 400, false, "Invalid booking id");
    }

    // find booking for logged-in user
    const booking = await Booking.findOne({
      _id: id,
      user: req.user.id,
    });

    if (!booking) {
      return sendRes(res, 404, false, "Booking not found");
    }

    // release seat if booking is active
    if (booking.status !== "cancelled") {
      await Seat.findByIdAndUpdate(booking.seat, {
        status: "available",
        reservedBy: null,
        expireAt: null,
      });
    }

    // delete booking
    await booking.deleteOne();

    return sendRes(res, 200, true, "Booking deleted", booking);
  } catch (err) {
    console.error("deleteBookById:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
//----------------
//! 11 Methods :
//----------------
// deleteBookById
// getMyBooks
// confirmPayment
// createBooking
// holdSeat
// getAllTripsByStationId
// getSeatsByTrip
// getTripRoute
// getTripByStations
// getStationByName
// getAllStations
//----------------
