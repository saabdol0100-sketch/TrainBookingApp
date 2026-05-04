const mongoose = require("mongoose");
const Trip = require("../models/Trip");
const Station = require("../models/Station");
const Seat = require("../models/Seat");
const bcrypt = require("bcryptjs");
const Train = require("../models/Train");
const User = require("../models/User");
const Booking = require("../models/Booking");
const { sendEmail } = require("../services/emailService");
const { sendSMS } = require("../services/smsService");

const {
  generateOTP,
  hashOTP,
  extractDOBFromNationalId,
} = require("../utils/authHelpers");

// 🔧 helper
const send = (
  res,
  { success = true, msg = "", data = null, count, status = 200 } = {},
) => {
  const safeStatus = Number.isInteger(status) ? status : 200;

  return res.status(safeStatus).json({
    success,
    msg,
    ...(count !== undefined && { count }),
    data,
  });
};

const generateTalgoSeats = (train, tripId, basePrice = 0) => {
  let seatNumber = 1;
  const seats = [];

  // زيادات السعر حسب نوع القطار أو الكلاس
  const priceMap = {
    VIP: basePrice + 200,
    Spanish: basePrice + 150,
    French: basePrice + 100,
    Russian: basePrice + 50,
    Talgo: basePrice,
    First: basePrice + 100,
    Second: basePrice,
  };

  // دالة مساعدة لإضافة كرسي
  const pushSeat = (classType, row, position) => {
    seats.push({
      trip: tripId,
      number: seatNumber++,
      classType,
      status: "available",
      price: priceMap[classType] || basePrice,
      row,
      position,
      trainType: train.type,
    });
  };

  // ✅ توليد المقاعد الأساسية حسب العدد الكلي للقطار
  if (train.seats && train.seats > 0) {
    for (let i = 1; i <= train.seats; i++) {
      pushSeat(train.type, Math.ceil(i / 4), i % 4 === 0 ? "aisle" : "window");
    }
  }

  // =====================
  // SECOND CLASS (Talgo 2-2 zigzag)
  // =====================
  if (train.classes?.Second) {
    const total = train.classes.Second;
    let created = 0;
    let row = 1;

    while (created < total) {
      const isReversed = row % 2 === 0;
      const layout = isReversed
        ? ["window", "aisle", "aisle", "window"].reverse()
        : ["window", "aisle", "aisle", "window"];

      for (let pos of layout) {
        if (created >= total) break;
        pushSeat("Second", row, pos);
        created++;
      }
      row++;
    }
  }

  // =====================
  // FIRST CLASS (Talgo 2+1)
  // =====================
  if (train.classes?.First) {
    const total = train.classes.First;
    let created = 0;
    let row = 1;

    while (created < total) {
      const layout = ["window", "aisle", "window"];
      for (let pos of layout) {
        if (created >= total) break;
        pushSeat("First", row, pos);
        created++;
      }
      row++;
    }
  }

  // =====================
  // VIP (simple 1-1)
  // =====================
  if (train.classes?.VIP) {
    const total = train.classes.VIP;
    for (let i = 0; i < total; i++) {
      pushSeat("VIP", Math.floor(i / 2) + 1, i % 2 === 0 ? "window" : "aisle");
    }
  }

  return seats;
};

// ===== Create =====
exports.createStations = async (req, res) => {
  try {
    const { stations } = req.body;

    if (!Array.isArray(stations) || stations.length === 0) {
      return send(res, {
        success: false,
        msg: "Stations array required",
        status: 400,
      });
    }

    const ops = [];

    for (const s of stations) {
      if (!s.name?.trim()) continue;

      const normalizedName = s.name.trim().toLowerCase();

      const validCoords =
        Array.isArray(s.coordinates) &&
        s.coordinates.length === 2 &&
        typeof s.coordinates[0] === "number" &&
        typeof s.coordinates[1] === "number";

      ops.push({
        updateOne: {
          filter: { normalizedName },
          update: {
            $set: {
              name: s.name.trim(),
              normalizedName,
              location: s.location?.trim() || "",
              coordinates: validCoords
                ? { type: "Point", coordinates: s.coordinates }
                : undefined,
              status: s.status || "active",
            },
          },
          upsert: true,
        },
      });
    }

    if (!ops.length) {
      return send(res, {
        success: false,
        msg: "No valid stations",
        status: 400,
      });
    }

    const result = await Station.bulkWrite(ops);

    // رجّع المحطات نفسها بعد التعديل
    const names = stations.map((s) => s.name.trim());
    const updatedStations = await Station.find({ name: { $in: names } });

    return send(res, {
      success: true,
      msg: "Stations upserted",
      count: result.upsertedCount + result.modifiedCount,
      data: updatedStations,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.createStation = async (req, res) => {
  try {
    const { name, location, coordinates, status } = req.body;

    if (!name?.trim()) {
      return send(res, {
        success: false,
        msg: "Station name required",
        status: 400,
      });
    }

    const normalizedName = name.trim().toLowerCase();

    const validCoords =
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number";

    // 🔥 ATOMIC UPSERT (no race condition)
    const station = await Station.findOneAndUpdate(
      { normalizedName },
      {
        $setOnInsert: {
          name: name.trim(),
          normalizedName,
          location: location?.trim() || "",
          coordinates: validCoords
            ? {
                type: "Point",
                coordinates,
              }
            : undefined,
          status: status || "active",
        },
      },
      {
        new: true,
        upsert: true,
      },
    );

    return send(res, {
      success: true,
      msg: "Station created",
      data: station,
      status: 201,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.createTrains = async (req, res) => {
  try {
    const { trains } = req.body;

    if (!Array.isArray(trains) || !trains.length) {
      return send(res, {
        success: false,
        msg: "Invalid trains array",
        status: 400,
      });
    }

    const ops = [];

    for (const t of trains) {
      if (!t.number || !t.name || !t.type) continue;

      ops.push({
        updateOne: {
          filter: { number: t.number },
          update: {
            $set: {
              name: t.name.trim(),
              type: t.type,
              status: t.status || "active",

              // ✅ classes instead of seats
              classes: {
                VIP: t.classes?.VIP || 0,
                First: t.classes?.First || 0,
                Second: t.classes?.Second || 0,
              },

              layout: t.layout || "standard",
            },
          },
          upsert: true,
        },
      });
    }

    const result = await Train.bulkWrite(ops);

    return send(res, {
      success: true,
      msg: "Trains upserted",
      count: result.upsertedCount + result.modifiedCount,
    });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.createTrain = async (req, res) => {
  try {
    const { number, name, type, classes, layout, status } = req.body;

    if (!number || !name || !type) {
      return send(res, { success: false, msg: "Invalid input", status: 400 });
    }

    const train = await Train.findOneAndUpdate(
      { number },
      {
        $setOnInsert: {
          name: name.trim(),
          type,
          status: status || "active",

          classes: {
            VIP: classes?.VIP || 0,
            First: classes?.First || 0,
            Second: classes?.Second || 0,
          },

          layout: layout || "standard",
        },
      },
      {
        new: true,
        upsert: true,
      },
    );

    return send(res, {
      success: true,
      msg: "Train created",
      data: train,
      status: 201,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.createTrips = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!Array.isArray(req.body.trips) || req.body.trips.length === 0) {
      throw new Error("Invalid trips array");
    }

    const createdTrips = [];

    for (const item of req.body.trips) {
      const {
        train,
        fromStation,
        toStation,
        departureDate,
        arrivalDate,
        price,
        stops, // ✅ إضافة stops
      } = item;

      if (
        !train ||
        !fromStation ||
        !toStation ||
        !departureDate ||
        !arrivalDate ||
        !price ||
        price <= 0
      ) {
        throw new Error("Missing required fields or invalid price");
      }

      const foundTrain = await Train.findById(train).session(session);
      if (!foundTrain) throw new Error("Train not found");

      const exists = await Trip.findOne({
        train,
        fromStation,
        toStation,
        departureDate: new Date(departureDate),
      }).session(session);

      if (exists) throw new Error("Trip already exists");

      // حساب مدة الرحلة
      const durationMinutes = Math.floor(
        (new Date(arrivalDate) - new Date(departureDate)) / 60000,
      );
      const duration = `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;

      const trip = await Trip.create(
        [
          {
            train,
            fromStation,
            toStation,
            departureDate,
            arrivalDate,
            price,
            duration,
            stops: stops || [], // ✅ تخزين المحطات الوسيطة
          },
        ],
        { session },
      );

      // 🔥 generate seats مع نوع القطار
      const seats = generateTalgoSeats(foundTrain, trip[0]._id, price);

      await Seat.insertMany(seats, { session });

      createdTrips.push({
        trip: trip[0],
        seatsCreated: seats.length,
        trainType: foundTrain.type,
        seatPriceRange: {
          min: Math.min(...seats.map((s) => s.price)),
          max: Math.max(...seats.map((s) => s.price)),
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    return send(res, {
      success: true,
      msg: "Trips created with seats",
      count: createdTrips.length,
      data: createdTrips,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};

exports.createTrip = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      train,
      fromStation,
      toStation,
      departureDate,
      arrivalDate,
      price,
      stops,
    } = req.body;

    if (
      !train ||
      !fromStation ||
      !toStation ||
      !departureDate ||
      !arrivalDate ||
      !price ||
      price <= 0
    ) {
      throw new Error("Missing required fields or invalid price");
    }

    if (
      !mongoose.Types.ObjectId.isValid(train) ||
      !mongoose.Types.ObjectId.isValid(fromStation) ||
      !mongoose.Types.ObjectId.isValid(toStation)
    ) {
      throw new Error("Invalid IDs");
    }

    if (fromStation === toStation) {
      throw new Error("From and To station cannot be same");
    }

    if (new Date(arrivalDate) <= new Date(departureDate)) {
      throw new Error("Arrival must be after departure");
    }

    const foundTrain = await Train.findById(train).session(session);
    if (!foundTrain) throw new Error("Train not found");

    const exists = await Trip.findOne({
      train,
      fromStation,
      toStation,
      departureDate: new Date(departureDate),
    }).session(session);

    if (exists) throw new Error("Trip already exists");

    const durationMinutes = Math.floor(
      (new Date(arrivalDate) - new Date(departureDate)) / 60000,
    );
    const duration = `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;

    const trip = await Trip.create(
      [
        {
          train,
          fromStation,
          toStation,
          departureDate,
          arrivalDate,
          price,
          duration,
          stops: stops || [], // ✅ هنا بيتخزن الـ stops
        },
      ],
      { session },
    );

    const seats = generateTalgoSeats(foundTrain, trip[0]._id, price);
    await Seat.insertMany(seats, { session });

    await session.commitTransaction();
    session.endSession();

    return send(res, {
      success: true,
      msg: "Trip created with seats",
      data: trip[0],
      seatsCreated: seats.length,
      trainType: foundTrain.type,
      seatPriceRange: {
        min: Math.min(...seats.map((s) => s.price)),
        max: Math.max(...seats.map((s) => s.price)),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return send(res, {
      success: false,
      msg: err.message,
      status: 400,
    });
  }
};

exports.adminManageSeats = async (req, res) => {
  try {
    const { seats } = req.body;

    if (!Array.isArray(seats) || seats.length === 0) {
      return sendRes(res, 400, false, "Seats array required");
    }

    const operations = [];

    for (const s of seats) {
      const { seatId, tripId, updates } = s;

      // ✅ Validate
      if (!seatId || !mongoose.Types.ObjectId.isValid(seatId)) {
        throw new Error("Invalid seatId");
      }

      const existingSeat = await Seat.findById(seatId);
      if (!existingSeat) throw new Error("Seat not found");

      // 🔒 Protect critical fields (IMPORTANT)
      const forbiddenFields = ["seatNumber", "trip", "classType", "row"];

      for (const key of Object.keys(updates)) {
        if (forbiddenFields.includes(key)) {
          throw new Error(`Cannot update protected field: ${key}`);
        }
      }

      operations.push({
        updateOne: {
          filter: { _id: seatId },
          update: { $set: updates },
        },
      });
    }

    const result = await Seat.bulkWrite(operations);

    return sendRes(res, 200, true, "Seats updated", {
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error("adminManageSeats:", err);
    return sendRes(res, 500, false, err.message);
  }
};
//==========  Get  =========
exports.getTripById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, {
        success: false,
        msg: "Invalid ID",
        status: 400,
      });
    }

    const trip = await Trip.findById(id)
      .populate("train fromStation toStation")
      .populate("stops.station", "name")
      .lean();

    if (!trip) {
      return send(res, {
        success: false,
        msg: "Trip not found",
        status: 404,
      });
    }

    const durationMs =
      new Date(trip.arrivalDate) - new Date(trip.departureDate);

    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    return send(res, {
      msg: "Trip fetched",
      data: {
        ...trip,
        duration: `${hours}h ${minutes}m`,
      },
    });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.getTripRoute = async (req, res) => {
  try {
    const { tripId } = req.params;

    if (!tripId || !mongoose.Types.ObjectId.isValid(tripId)) {
      return send(res, {
        success: false,
        msg: "Valid tripId required",
        status: 400,
      });
    }

    const trip = await Trip.findById(tripId)
      .populate("fromStation toStation")
      .populate("stops.station", "name")
      .lean();

    if (!trip) {
      return send(res, {
        success: false,
        msg: "Trip not found",
        status: 404,
      });
    }

    const route = [
      { name: trip.fromStation.name },
      ...(trip.stops || []).map((s) => ({
        name: s.station?.name,
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
      })),
      { name: trip.toStation.name },
    ];

    return send(res, {
      success: true,
      msg: "Trip route fetched",
      count: route.length,
      data: {
        tripId: trip._id,
        route,
      },
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.getAllTrips = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

    const query = { status: "scheduled" };

    const trips = await Trip.find(query)
      .populate("train fromStation toStation")
      .sort({ departureDate: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const count = await Trip.countDocuments(query);

    return send(res, {
      msg: "Trips fetched",
      count,
      page,
      pages: Math.ceil(count / limit),
      data: trips,
    });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.getAllTrains = async (req, res) => {
  try {
    const trains = await Train.find().lean();
    const count = await Train.countDocuments();

    return send(res, {
      msg: "Trains fetched",
      count,
      data: trains,
    });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.getTrainById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, {
        success: false,
        msg: "Invalid ID",
        status: 400,
      });
    }

    const train = await Train.findById(id).lean();

    if (!train) {
      return send(res, {
        success: false,
        msg: "Train not found",
        status: 404,
      });
    }

    return send(res, { msg: "Train fetched", data: train });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.getAllStations = async (req, res) => {
  try {
    const stations = await Station.find({ status: "active" })
      .sort({ name: 1 })
      .lean();

    const count = await Station.countDocuments({ status: "active" });

    return send(res, {
      msg: "Stations fetched",
      count,
      data: stations,
    });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.getStationById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, {
        success: false,
        msg: "Invalid ID",
        status: 400,
      });
    }

    const station = await Station.findById(id).lean();

    if (!station) {
      return send(res, {
        success: false,
        msg: "Station not found",
        status: 404,
      });
    }

    return send(res, { msg: "Station fetched", data: station });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.getAllUsers = async (req, res) => {
  try {
    const page = Math.max(+req.query.page || 1, 1);
    const limit = Math.min(+req.query.limit || 10, 100);

    const users = await User.find()
      .select("-password -signupOtp -tempOtp")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const count = await User.countDocuments();

    return send(res, {
      msg: "Users fetched",
      count,
      page,
      pages: Math.ceil(count / limit),
      data: users,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.getSeatsByTrainId = async (req, res) => {
  try {
    const { trainId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(trainId)) {
      return send(res, {
        success: false,
        msg: "Invalid trainId",
        status: 400,
      });
    }

    const seats = await Seat.find({ train: trainId })
      .populate("trip", "fromStation toStation departureDate")
      .populate("reservedBy", "-password")
      .sort({ seatNumber: 1 })
      .lean();

    return send(res, {
      msg: "Seats fetched",
      count: seats.length,
      data: seats,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.getSeatsByTripId = async (req, res) => {
  try {
    const { tripId } = req.params;

    if (!tripId || !mongoose.Types.ObjectId.isValid(tripId)) {
      return send(res, {
        success: false,
        msg: "Valid tripId required",
        status: 400,
      });
    }

    const seats = await Seat.find({ trip: tripId })
      .populate("train", "number type")
      .populate("reservedBy", "-password")
      .sort({ seatNumber: 1 })
      .lean();

    return send(res, {
      msg: "Seats fetched",
      count: seats.length,
      data: seats,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
// ===== Update =====
exports.updateTripById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, { success: false, msg: "Invalid ID", status: 400 });
    }

    delete req.body._id;
    delete req.body.createdAt;
    delete req.body.updatedAt;

    if (
      req.body.fromStation &&
      req.body.toStation &&
      req.body.fromStation === req.body.toStation
    ) {
      return send(res, {
        success: false,
        msg: "From and To station cannot be same",
        status: 400,
      });
    }

    if (
      req.body.departureDate &&
      req.body.arrivalDate &&
      new Date(req.body.arrivalDate) <= new Date(req.body.departureDate)
    ) {
      return send(res, {
        success: false,
        msg: "Arrival must be after departure",
        status: 400,
      });
    }

    const trip = await Trip.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate("train fromStation toStation")
      .populate("stops.station", "name");

    if (!trip) {
      return send(res, { success: false, msg: "Trip not found", status: 404 });
    }

    return send(res, { msg: "Trip updated", data: trip });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};

exports.updateTrainById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, { success: false, msg: "Invalid ID", status: 400 });
    }

    delete req.body._id;
    delete req.body.createdAt;
    delete req.body.updatedAt;

    const train = await Train.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!train) {
      return send(res, { success: false, msg: "Train not found", status: 404 });
    }

    return send(res, { msg: "Train updated", data: train });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};

exports.updateStationById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, { success: false, msg: "Invalid ID", status: 400 });
    }

    delete req.body._id;
    delete req.body.createdAt;
    delete req.body.updatedAt;

    if (req.body.name) {
      req.body.name = req.body.name.trim();
    }

    const station = await Station.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!station) {
      return send(res, {
        success: false,
        msg: "Station not found",
        status: 404,
      });
    }

    return send(res, { msg: "Station updated", data: station });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};

exports.updateSeatById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, { success: false, msg: "Invalid ID", status: 400 });
    }

    delete req.body._id;
    delete req.body.createdAt;
    delete req.body.updatedAt;

    // prevent changing booked seats
    const existingSeat = await Seat.findById(id);
    if (!existingSeat) {
      return send(res, { success: false, msg: "Seat not found", status: 404 });
    }

    if (existingSeat.status === "booked") {
      return send(res, {
        success: false,
        msg: "Cannot update booked seat",
        status: 400,
      });
    }

    const seat = await Seat.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate("train", "number type")
      .populate("trip", "fromStation toStation departureDate")
      .populate("reservedBy", "-password");

    return send(res, { msg: "Seat updated", data: seat });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
//==== Delete =========
exports.deleteAllTrains = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return send(res, {
        success: false,
        msg: "Not allowed in production",
        status: 403,
      });
    }

    await Promise.all([
      Train.deleteMany({}),
      Trip.deleteMany({}),
      Seat.deleteMany({}),
      Booking.deleteMany({}), // 🔥 added
    ]);

    return send(res, {
      success: true,
      msg: "All trains, trips, seats and bookings deleted successfully",
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.deleteTrainById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, {
        success: false,
        msg: "Invalid ID",
        status: 400,
      });
    }

    const train = await Train.findById(id);

    if (!train) {
      return send(res, {
        success: false,
        msg: "Train not found",
        status: 404,
      });
    }

    const hasTrips = await Trip.exists({ train: id });

    if (hasTrips) {
      return send(res, {
        success: false,
        msg: "Cannot delete train used in trips",
        status: 400,
      });
    }

    await train.deleteOne();

    return send(res, {
      success: true,
      msg: "Train deleted successfully",
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.deleteTrip = async (req, res) => {
  let session = null;

  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new Error("Invalid ID");
    }

    if (process.env.USE_TRANSACTION === "true") {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const trip = session
      ? await Trip.findById(id).session(session)
      : await Trip.findById(id);

    if (!trip) throw new Error("Trip not found");

    const hasBookings = await Booking.exists({ trip: trip._id });
    if (hasBookings) throw new Error("Cannot delete trip with bookings");

    if (session) {
      await Seat.deleteMany({ trip: trip._id }).session(session);
      await trip.deleteOne({ session });

      await session.commitTransaction();
      session.endSession();
    } else {
      await Seat.deleteMany({ trip: trip._id });
      await trip.deleteOne();
    }

    return send(res, { msg: "Trip deleted successfully" });
  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    return send(res, {
      success: false,
      msg: err.message,
      status: 400,
    });
  }
};
exports.deleteAllTrips = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return send(res, {
        success: false,
        msg: "Forbidden in production",
        status: 403,
      });
    }

    await Promise.all([
      Trip.deleteMany({}),
      Seat.deleteMany({}),
      Booking.deleteMany({}), // 🔥 added
    ]);

    return send(res, {
      msg: "All trips, seats and bookings deleted",
    });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.deleteStationById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, { success: false, msg: "Invalid ID", status: 400 });
    }

    const used = await Trip.exists({
      $or: [{ fromStation: id }, { toStation: id }],
    });

    if (used) {
      return send(res, {
        success: false,
        msg: "Cannot delete station used in trips",
        status: 400,
      });
    }

    const station = await Station.findByIdAndDelete(id);

    if (!station) {
      return send(res, {
        success: false,
        msg: "Station not found",
        status: 404,
      });
    }

    return send(res, { msg: "Station deleted successfully" });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.deleteAllStations = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return send(res, {
        success: false,
        msg: "Not allowed in production",
        status: 403,
      });
    }

    const used = await Trip.exists({});
    if (used) {
      return send(res, {
        success: false,
        msg: "Cannot delete stations while trips exist",
        status: 400,
      });
    }

    await Station.deleteMany({});

    return send(res, { msg: "All stations deleted successfully" });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.deleteSeatById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return send(res, { success: false, msg: "Invalid ID", status: 400 });
    }

    const seat = await Seat.findById(id);

    if (!seat) {
      return send(res, { success: false, msg: "Seat not found", status: 404 });
    }

    if (seat.status === "reserved" || seat.status === "booked") {
      return send(res, {
        success: false,
        msg: "Cannot delete reserved or booked seat",
        status: 400,
      });
    }

    const hasBooking = await Booking.exists({ seats: seat._id });
    if (hasBooking) {
      return send(res, {
        success: false,
        msg: "Cannot delete seat with booking history",
        status: 400,
      });
    }

    await seat.deleteOne();

    return send(res, { msg: "Seat deleted successfully" });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.deleteUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return send(res, {
        success: false,
        msg: "Invalid user ID",
        status: 400,
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return send(res, {
        success: false,
        msg: "User not found",
        status: 404,
      });
    }

    const hasBookings = await Booking.exists({ user: id });
    if (hasBookings) {
      return send(res, {
        success: false,
        msg: "Cannot delete user with bookings",
        status: 400,
      });
    }

    await User.findByIdAndDelete(id);

    return send(res, {
      success: true,
      msg: "User deleted successfully",
      data: user,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.databaseFreeUp = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return send(res, {
        success: false,
        msg: "Forbidden in production",
        status: 403,
      });
    }

    await Promise.all([
      Booking.deleteMany({}),
      Seat.deleteMany({}),
      Trip.deleteMany({}),
      Train.deleteMany({}),
      Station.deleteMany({}),
      User.deleteMany({ role: { $ne: "Admin" } }),
    ]);

    return send(res, { msg: "Database cleared successfully" });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
//----------------------
//! ADMIN METHODS (25)
//----------------------
//? CREATE
//? createStations
//? createStation
//? createTrains
//? createTrain
//? createTrips
//? createTrip
//? createSeats
//? createSeat
//? getAllTrains
//? getTrainById
//? getAllTrips
//? getTripById
//? getAllStations
//? getStationById
//? getAllUsers
//? getSeatsByTrainId
//? getSeatsByTripId
//? updateTripById
//? updateTrainById
//? updateStationById
//? updateSeatById
//? deleteTrip
//? deleteTrainById
//? deleteStationById
//? deleteSeatById
//? deleteAllTrips
//? deleteAllTrains
//? deleteAllStations
//? deleteAllSeats
//? databaseFreeUp
//---------------------
