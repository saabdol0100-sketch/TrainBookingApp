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

exports.searchTrips = async (req, res) => {
  try {
    const {
      from,
      to,
      date,
      page = 1,
      limit = 10,
      classType, // optional
    } = req.query;

    if (!from || !to) {
      return sendRes(res, 400, false, "from & to required");
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);

    // ✅ prepare class filter
    let classFilter = [];
    if (classType) {
      classFilter = Array.isArray(classType) ? classType : [classType];
    }

    // ✅ safer date filter
    let dateMatch = {};
    if (date) {
      const parsed = new Date(date + "T00:00:00.000Z");
      if (isNaN(parsed)) {
        return sendRes(res, 400, false, "Invalid date");
      }

      const nextDay = new Date(parsed);
      nextDay.setDate(nextDay.getDate() + 1);

      dateMatch = {
        departureDate: {
          $gte: parsed,
          $lt: nextDay,
        },
      };
    }

    // 🔍 البحث بالاسم (Case-insensitive)
    const fromStation = await Station.findOne({
      name: new RegExp("^" + from + "$", "i"),
    });
    const toStation = await Station.findOne({
      name: new RegExp("^" + to + "$", "i"),
    });

    if (!fromStation || !toStation) {
      return sendRes(res, 404, false, "Stations not found");
    }

    // 🔥 SINGLE AGGREGATION with pagination + count
    const result = await Trip.aggregate([
      {
        $match: {
          fromStation: fromStation._id,
          toStation: toStation._id,
          status: "scheduled",
          ...dateMatch,
        },
      },

      // 🔗 seats lookup
      {
        $lookup: {
          from: "seats",
          let: { tripId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$trip", "$$tripId"] },
                ...(classFilter.length && {
                  classType: { $in: classFilter },
                }),
              },
            },
            {
              $group: {
                _id: "$trip",
                total: { $sum: 1 },
                available: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "available"] }, 1, 0],
                  },
                },
              },
            },
          ],
          as: "seatStats",
        },
      },

      {
        $addFields: {
          seatStats: { $arrayElemAt: ["$seatStats", 0] },
        },
      },

      ...(classFilter.length
        ? [
            {
              $match: {
                "seatStats.available": { $gt: 0 },
              },
            },
          ]
        : []),

      // 🔗 train lookup
      {
        $lookup: {
          from: "trains",
          localField: "train",
          foreignField: "_id",
          as: "train",
        },
      },
      { $unwind: { path: "$train", preserveNullAndEmptyArrays: true } },

      // 🔗 stations
      {
        $lookup: {
          from: "stations",
          localField: "fromStation",
          foreignField: "_id",
          as: "fromStation",
        },
      },
      { $unwind: "$fromStation" },

      {
        $lookup: {
          from: "stations",
          localField: "toStation",
          foreignField: "_id",
          as: "toStation",
        },
      },
      { $unwind: "$toStation" },

      {
        $facet: {
          data: [
            { $sort: { departureDate: 1 } },
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const trips = result[0].data;
    const total = result[0].totalCount[0]?.count || 0;

    const formatTime = (d) =>
      new Date(d).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

    const formattedTrips = trips.map((trip) => {
      const stats = trip.seatStats || { total: 0, available: 0 };

      const durationMs =
        new Date(trip.arrivalDate) - new Date(trip.departureDate);

      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

      return {
        tripId: trip._id,
        trainNumber: trip.train?.number,
        trainType: trip.train?.type || "VIP",
        from: trip.fromStation?.name,
        to: trip.toStation?.name,
        departureTime: formatTime(trip.departureDate),
        arrivalTime: formatTime(trip.arrivalDate),
        duration: `${hours}h ${minutes}m`,
        price: trip.price || 350,
        availableTickets: stats.available,
        stops: trip.stops?.length || 0,
      };
    });

    return sendRes(res, 200, true, "Trips fetched", {
      trips: formattedTrips,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error(err);
    return sendRes(res, 500, false, "Error fetching trips");
  }
};
exports.getTripRoute = async (req, res) => {
  try {
    const { tripId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return sendRes(res, 400, false, "Invalid tripId");
    }

    const trip = await Trip.findById(tripId)
      .populate("fromStation toStation train")
      .populate("stops.station", "name")
      .lean();

    if (!trip) {
      return sendRes(res, 404, false, "Trip not found");
    }

    // ✅ Build route using stops (NOT global stations)
    const route = [
      { name: trip.fromStation.name },
      ...(trip.stops || []).map((s) => ({
        name: s.station?.name,
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
      })),
      { name: trip.toStation.name },
    ];

    return sendRes(res, 200, true, "Route fetched", {
      tripId,
      stopsCount: route.length,
      stops: route,
    });
  } catch (err) {
    return sendRes(res, 500, false, "Server error");
  }
};
exports.getAllStations = async (req, res) => {
  try {
    const stations = await Station.find().select("_id name");
    return res.status(200).json({
      success: true,
      msg: "Stations fetched successfully",
      data: stations,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Server error",
      error: err.message,
    });
  }
};
exports.getSeatsByTrip = async (req, res) => {
  try {
    const { tripId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return sendRes(res, 400, false, "Invalid tripId");
    }

    // 🔥 optional filter by class
    const { classType } = req.query;

    const seatQuery = { trip: tripId };

    if (classType) {
      seatQuery.classType = classType;
    }

    const seats = await Seat.find(seatQuery).sort({ seatNumber: 1 }).lean();

    const formattedSeats = seats.map((seat) => ({
      seatId: seat._id,
      number: seat.seatNumber,
      status: seat.status,
      classType: seat.classType,
      price: seat.price || 0,

      // optional layout helpers
      row: Math.ceil(seat.seatNumber / 4),
      position:
        seat.seatNumber % 4 === 1
          ? "window"
          : seat.seatNumber % 4 === 2
            ? "aisle"
            : seat.seatNumber % 4 === 3
              ? "aisle"
              : "window",
    }));

    return sendRes(res, 200, true, "Seats fetched", {
      tripId,
      totalSeats: formattedSeats.length,
      seats: formattedSeats,
    });
  } catch (err) {
    console.error(err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.holdSeat = async (req, res) => {
  try {
    const { seatId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(seatId)) {
      return sendRes(res, 400, false, "Invalid seatId");
    }

    const now = new Date();

    // limit holds
    const activeHolds = await Seat.countDocuments({
      reservedBy: req.user.id,
      status: "reserved",
      expireAt: { $gt: now },
    });

    if (activeHolds >= 5) {
      return sendRes(res, 400, false, "Hold limit reached");
    }

    const seat = await Seat.findOneAndUpdate(
      {
        _id: seatId,
        status: { $ne: "booked" },
        $or: [
          { status: "available" },
          { status: "reserved", expireAt: { $lte: now } },
          { status: "reserved", reservedBy: req.user.id },
        ],
      },
      {
        $set: {
          status: "reserved",
          reservedBy: req.user.id,
          reservedAt: now,
          expireAt: new Date(now.getTime() + 5 * 60 * 1000),
        },
      },
      { new: true },
    );

    if (!seat) {
      return sendRes(res, 400, false, "Seat not available");
    }

    return sendRes(res, 200, true, "Seat held", seat);
  } catch (err) {
    return sendRes(res, 500, false, "Server error");
  }
};
exports.confirmPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let { seatIds, passengers, transactionId } = req.body;

    if (!seatIds || !Array.isArray(seatIds) || !seatIds.length) {
      throw new Error("seatIds required");
    }

    if (!passengers || passengers.length !== seatIds.length) {
      throw new Error("Passengers must match seats");
    }

    if (!transactionId) {
      throw new Error("Transaction ID required");
    }

    const now = new Date();

    // 🔒 get seats
    const seats = await Seat.find({
      _id: { $in: seatIds },
    }).session(session);

    if (seats.length !== seatIds.length) {
      throw new Error("Invalid seats");
    }

    // 🔒 validate
    for (const s of seats) {
      if (
        s.status !== "reserved" ||
        s.reservedBy?.toString() !== req.user.id ||
        s.expireAt < now
      ) {
        throw new Error("Seat expired or not yours");
      }
    }

    // 💰 total price
    const totalPrice = seats.reduce((sum, s) => sum + s.price, 0);

    // 💳 VERIFY PAYMENT
    const auth = await axios.post("https://accept.paymob.com/api/auth/tokens", {
      api_key: process.env.PAYMOB_API_KEY,
    });

    const token = auth.data.token;

    const trx = await axios.get(
      `https://accept.paymob.com/api/acceptance/transactions/${transactionId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const payment = trx.data;

    if (!payment || !payment.success || payment.pending) {
      throw new Error("Payment not valid");
    }

    if (payment.amount_cents !== totalPrice * 100) {
      throw new Error("Amount mismatch");
    }

    // 🔥 ATOMIC UPDATE
    const updated = await Seat.updateMany(
      {
        _id: { $in: seatIds },
        status: "reserved",
        reservedBy: req.user.id,
        expireAt: { $gt: now },
      },
      {
        $set: {
          status: "booked",
          reservedBy: null,
          expireAt: null,
          bookedAt: now,
        },
      },
      { session },
    );

    if (updated.modifiedCount !== seatIds.length) {
      throw new Error("Seats no longer available");
    }

    // 🎟️ create booking with extended passenger info
    const booking = await Booking.create(
      [
        {
          user: req.user.id,
          trip: seats[0].trip,
          seats: seatIds,
          passengers: passengers.map((p) => ({
            fullName: p.fullName,
            middleName: p.middleName,
            phoneNumber: p.phoneNumber,
            nationalId: p.nationalId,
            profileType: p.profileType,
            email: p.email,
            nationality: p.nationality,
          })),
          paymentStatus: "paid",
          transactionId,
          paidAt: now,
        },
      ],
      { session },
    );

    // 🎫 QR
    const qrToken = jwt.sign(
      { bookingId: booking[0]._id },
      process.env.QR_SECRET,
      { expiresIn: "6h" },
    );

    booking[0].qrCode = await QRCode.toDataURL(qrToken);
    await booking[0].save({ session });

    // 🗂️ add booking to user history
    await User.findByIdAndUpdate(req.user.id, {
      $push: { history: booking[0]._id },
    });

    // 📧 send ticket email (يمكنك تضمين الحقول الجديدة هنا لو عايز)
    await sendTicketEmail(req.user.email, {
      userName: req.user.name,
      trainNumber: seats[0].trainNumber,
      fromStation: seats[0].fromStation,
      toStation: seats[0].toStation,
      seatNumbers: seats.map((s) => s.seat_number),
      date: seats[0].tripDate,
      price: totalPrice,
      qrCode: booking[0].qrCode,
    });

    await session.commitTransaction();
    session.endSession();

    return sendRes(res, 200, true, "Booking confirmed", {
      booking: booking[0],
      totalPrice,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return sendRes(res, 500, false, err.message);
  }
};

exports.getMyBooks = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user.id })
      .populate("trip")
      .populate("seats") // ✅ FIX
      .sort({ createdAt: -1 })
      .lean();

    return sendRes(res, 200, true, "Bookings fetched", bookings);
  } catch (err) {
    console.error("getMyBooks:", err);
    return sendRes(res, 500, false, "Server error");
  }
};
exports.cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new Error("Invalid booking id");
    }

    const booking = await Booking.findOne({
      _id: id,
      user: req.user.id,
    }).session(session);

    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.status === "cancelled") {
      throw new Error("Booking already cancelled");
    }

    // 🔥 release ALL seats
    await Seat.updateMany(
      { _id: { $in: booking.seats } },
      {
        $set: {
          status: "available",
          reservedBy: null,
          reservedAt: null,
          expireAt: null,
        },
      },
      { session },
    );

    // 🔥 mark booking cancelled
    booking.status = "cancelled";
    booking.paymentStatus = "refunded"; // optional depending on logic

    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    return sendRes(res, 200, true, "Booking cancelled", booking);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error("cancelBooking:", err);
    return sendRes(res, 500, false, err.message);
  }
};

//! 7 Methods :
//?----------------
//todo searchTrips
//todo cancelBooking
//todo getMyBooks
//todo holdSeat
//todo getSeatsByTrip
//todo getTripRoute
//todo confirmPayment
//?----------------
