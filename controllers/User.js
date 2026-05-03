const crypto = require("crypto");
const { randomUUID } = require("crypto");
const Station = require("../models/Station");
const Trip = require("../models/Trip");
const Seat = require("../models/Seat");
const Booking = require("../models/Booking");
const { sendEmail, sendTicketEmail } = require("../services/emailService");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User"); // ✅ adjust path if needed
const sendRes = (res, status, success, msg, data = null) => {
  res.status(status).json({ success, msg, data });
};

exports.searchTrips = async (req, res) => {
  try {
    const { from, to, date, page = 1, limit = 10, classType } = req.query;

    if (!from || !to) {
      return sendRes(res, 400, false, "from & to required");
    }

    // ✅ validate ObjectId
    if (
      !mongoose.Types.ObjectId.isValid(from) ||
      !mongoose.Types.ObjectId.isValid(to)
    ) {
      return sendRes(res, 400, false, "Invalid station IDs");
    }

    const fromId = new mongoose.Types.ObjectId(from);
    const toId = new mongoose.Types.ObjectId(to);

    const pageNum = Number(page);
    const limitNum = Number(limit);

    // ✅ DATE FILTER (SAFE)
    let dateMatch = {};
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);

      if (isNaN(start) || isNaN(end)) {
        return sendRes(res, 400, false, "Invalid date");
      }

      dateMatch = {
        departureDate: { $gte: start, $lte: end },
      };
    }

    // ✅ class filter
    let classFilter = [];
    if (classType) {
      classFilter = Array.isArray(classType) ? classType : [classType];
    }

    const result = await Trip.aggregate([
      {
        $match: {
          fromStation: fromId,
          toStation: toId,
          status: "scheduled",
          ...dateMatch,
        },
      },

      // 🔗 seats
      {
        $lookup: {
          from: "seats",
          localField: "_id",
          foreignField: "trip",
          as: "seats",
        },
      },

      {
        $addFields: {
          totalSeats: { $size: "$seats" },
          availableSeats: {
            $size: {
              $filter: {
                input: "$seats",
                as: "s",
                cond: { $eq: ["$$s.status", "available"] },
              },
            },
          },
        },
      },

      // ✅ class filter (only if provided)
      ...(classFilter.length
        ? [
            {
              $addFields: {
                filteredSeats: {
                  $filter: {
                    input: "$seats",
                    as: "s",
                    cond: {
                      $and: [
                        { $in: ["$$s.classType", classFilter] },
                        { $eq: ["$$s.status", "available"] },
                      ],
                    },
                  },
                },
              },
            },
            {
              $match: {
                "filteredSeats.0": { $exists: true },
              },
            },
          ]
        : []),

      // 🔗 train
      {
        $lookup: {
          from: "trains",
          localField: "train",
          foreignField: "_id",
          as: "train",
        },
      },
      { $unwind: "$train" },

      // 🔗 stations (for names in response)
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
      const durationMs =
        new Date(trip.arrivalDate) - new Date(trip.departureDate);

      return {
        tripId: trip._id,
        trainNumber: trip.train?.number,
        trainType: trip.train?.type,
        from: trip.fromStation?.name,
        to: trip.toStation?.name,
        departureTime: formatTime(trip.departureDate),
        arrivalTime: formatTime(trip.arrivalDate),
        duration: `${Math.floor(durationMs / 3600000)}h ${Math.floor(
          (durationMs % 3600000) / 60000,
        )}m`,
        price: trip.price,
        availableTickets: trip.availableSeats,
        totalSeats: trip.totalSeats,
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
    console.error("SEARCH ERROR:", err);
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

    const route = [
      trip.fromStation && { name: trip.fromStation.name },

      ...(trip.stops || [])
        .filter((s) => s.station)
        .sort((a, b) => new Date(a.arrivalTime) - new Date(b.arrivalTime))
        .map((s) => ({
          name: s.station.name,
          arrivalTime: s.arrivalTime,
          departureTime: s.departureTime,
        })),

      trip.toStation && { name: trip.toStation.name },
    ].filter(Boolean);

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
    const stations = await Station.find({ status: "active" })
      .select("_id name")
      .sort({ name: 1 }) // ✅ sorted alphabetically
      .lean();

    return res.status(200).json({
      success: true,
      msg: "Stations fetched successfully",
      data: stations.map((s) => ({
        id: s._id,
        name: s.name,
      })),
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

    // ✅ limit holds per user
    const activeHolds = await Seat.countDocuments({
      reservedBy: req.user.id,
      status: "reserved",
      expireAt: { $gt: now },
    });

    if (activeHolds >= 5) {
      return sendRes(res, 400, false, "Hold limit reached (max 5)");
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
    ).lean();

    if (!seat) {
      return sendRes(res, 400, false, "Seat not available");
    }

    return sendRes(res, 200, true, "Seat held", {
      seatId: seat._id,
      status: seat.status,
      expiresAt: seat.expireAt,
    });
  } catch (err) {
    return sendRes(res, 500, false, "Server error");
  }
};
exports.confirmPayment = async (req, res) => {
  const session = await mongoose.startSession();
  let committed = false; // 🔥 track commit state

  const SKIP_PAYMENT = process.env.SKIP_PAYMENT === "true";

  try {
    session.startTransaction();

    let { seatIds, passengers, transactionId } = req.body;

    // 🔴 VALIDATION
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      throw new Error("seatIds required");
    }

    if (!passengers || !Array.isArray(passengers)) {
      throw new Error("Passengers array required");
    }

    if (passengers.length !== seatIds.length) {
      throw new Error("Passengers must match number of seats");
    }

    for (const p of passengers) {
      if (!p.name) throw new Error("Passenger name required");
    }

    if (!transactionId && !SKIP_PAYMENT) {
      throw new Error("Transaction ID required");
    }

    if (SKIP_PAYMENT && !transactionId) {
      transactionId = "TEST_" + Date.now();
    }

    const now = new Date();

    // 🚨 prevent replay attack (ONLY real mode)
    if (!SKIP_PAYMENT) {
      const existingBooking = await Booking.findOne({ transactionId }).session(
        session,
      );
      if (existingBooking) throw new Error("Transaction already used");
    }

    // 🔒 GET SEATS
    const seats = await Seat.find({
      _id: { $in: seatIds },
    }).session(session);

    if (seats.length !== seatIds.length) {
      throw new Error("Invalid seats");
    }

    // 🚨 same trip check
    const tripId = seats[0].trip.toString();
    if (!seats.every((s) => s.trip.toString() === tripId)) {
      throw new Error("Seats must belong to same trip");
    }

    // 🔥 FLEXIBLE VALIDATION
    for (const s of seats) {
      if (s.status === "booked") {
        throw new Error(`Seat ${s.seatNumber} already booked`);
      }

      if (s.status === "reserved") {
        if (s.expireAt < now) {
          throw new Error(`Seat ${s.seatNumber} reservation expired`);
        }

        if (s.reservedBy?.toString() !== req.user.id) {
          throw new Error(`Seat ${s.seatNumber} reserved by another user`);
        }
      }
    }

    // 💰 PRICE
    const totalPrice = seats.reduce((sum, s) => sum + s.price, 0);

    // 💳 PAYMENT CHECK
    if (!SKIP_PAYMENT) {
      const auth = await axios.post(
        "https://accept.paymob.com/api/auth/tokens",
        { api_key: process.env.PAYMOB_API_KEY },
      );

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
    } else {
      console.log("⚠️ TEST MODE: Payment skipped");
    }

    // 🔥 ATOMIC UPDATE (CORE LOGIC)
    const updated = await Seat.updateMany(
      {
        _id: { $in: seatIds },
        $or: [
          { status: "available" },
          {
            status: "reserved",
            reservedBy: req.user.id,
            expireAt: { $gt: now },
          },
        ],
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
      throw new Error("Some seats are no longer available");
    }

    // 🎟️ CREATE BOOKING
    const [booking] = await Booking.create(
      [
        {
          user: req.user.id,
          trip: tripId,
          seats: seatIds,

          passengers: passengers.map((p, i) => ({
            name: p.name,
            age: p.age || null,
            gender: p.gender || null,
            nationalId: p.nationalId || null,
            phone: p.phone || null,
            email: p.email || null,
            seatId: seatIds[i],
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
      { bookingId: booking._id },
      process.env.QR_SECRET,
      { expiresIn: "6h" },
    );

    booking.qrCode = await QRCode.toDataURL(qrToken);
    await booking.save({ session });

    // 🗂️ USER HISTORY
    await User.findByIdAndUpdate(
      req.user.id,
      { $push: { history: booking._id } },
      { session },
    );

    // ✅ COMMIT
    await session.commitTransaction();
    committed = true;
    console.log("USER OBJECT:", req.user);
    console.log("EMAIL VALUE:", req.user?.email);
    // 📧 EMAIL AFTER COMMIT
    // 📨 collect emails
    const emails = passengers
      .map((p) => p.email)
      .filter((email) => email && email.trim() !== "");

    if (emails.length === 0 && req.user?.email) {
      emails.push(req.user.email);
    }

    // 🚨 safety check
    if (emails.length === 0) {
      console.warn("⚠️ No email recipients found — skipping email");
    } else {
      try {
        await sendTicketEmail(emails.join(","), {
          userName: req.user?.name || "Passenger",
          seatNumbers: seats.map((s) => s.seatNumber),
          passengers,
          totalPrice,
          qrCode: booking.qrCode,
        });
      } catch (emailErr) {
        console.error("❌ Email failed:", emailErr.message);
      }
    }
    return sendRes(res, 200, true, "Booking confirmed", {
      booking: {
        id: booking._id,
        trip: booking.trip,
        seats: booking.seats,
        passengers: booking.passengers,
        totalPrice,
      },
    });
  } catch (err) {
    // ❌ abort ONLY if not committed
    if (!committed) {
      await session.abortTransaction();
    }

    console.error("CONFIRM PAYMENT ERROR:", err);

    return sendRes(res, 500, false, err.message);
  } finally {
    session.endSession(); // 🔥 ALWAYS end session
  }
};
exports.getMyBooks = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const bookings = await Booking.find({ user: req.user.id })
      .populate({
        path: "trip",
        select: "departureDate arrivalDate",
        populate: [
          { path: "fromStation", select: "name" },
          { path: "toStation", select: "name" },
          { path: "train", select: "number type" },
        ],
      })
      .populate({
        path: "seats",
        select: "seatNumber class coach price status",
      })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const total = await Booking.countDocuments({ user: req.user.id });

    const formatTime = (d) =>
      new Date(d).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

    const formatted = bookings.map((b) => ({
      bookingId: b._id,
      tripId: b.trip?._id,
      trainNumber: b.trip?.train?.number,
      trainType: b.trip?.train?.type,
      from: b.trip?.fromStation?.name,
      to: b.trip?.toStation?.name,
      departureTime: formatTime(b.trip?.departureDate),
      arrivalTime: formatTime(b.trip?.arrivalDate),

      // ✅ seats بشكل أوضح
      seats: (b.seats || []).map((s) => ({
        id: s._id,
        number: s.seatNumber,
        class: s.class,
        coach: s.coach,
        price: s.price,
        status: s.status,
      })),

      passengers: b.passengers,
      totalSeats: b.seats?.length || 0,
      paymentStatus: b.paymentStatus,
      bookedAt: b.createdAt,
    }));

    return sendRes(res, 200, true, "Bookings fetched", {
      bookings: formatted,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
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
    })
      .populate("trip")
      .session(session);

    if (!booking) {
      throw new Error("Booking not found");
    }

    // ✅ prevent double cancel
    if (booking.status === "cancelled") {
      throw new Error("Booking already cancelled");
    }

    // 🚨 prevent cancel after trip start
    const now = new Date();
    if (booking.trip && new Date(booking.trip.departureDate) <= now) {
      throw new Error("Cannot cancel after trip departure");
    }

    // 🔥 release ONLY booked seats safely
    const updated = await Seat.updateMany(
      {
        _id: { $in: booking.seats },
        status: "booked",
      },
      {
        $set: {
          status: "available",
          reservedBy: null,
          reservedAt: null,
          expireAt: null,
          bookedAt: null,
        },
      },
      { session },
    );

    if (updated.modifiedCount === 0) {
      throw new Error("Seats already released or invalid");
    }

    // 💰 refund logic (safe)
    if (booking.paymentStatus === "paid") {
      booking.paymentStatus = "refunded";
      booking.refundedAt = now;
    }

    // 🔥 mark cancelled
    booking.status = "cancelled";
    booking.cancelledAt = now;

    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    return sendRes(res, 200, true, "Booking cancelled", {
      bookingId: booking._id,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      cancelledAt: booking.cancelledAt,
    });
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
