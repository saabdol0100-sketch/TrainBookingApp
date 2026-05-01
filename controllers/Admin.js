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

// ===== Create =====
exports.createStations = async (req, res) => {
  try {
    if (!Array.isArray(req.body.stations) || req.body.stations.length === 0) {
      return send(res, {
        success: false,
        msg: "Stations array required",
        status: 400,
      });
    }

    const ops = req.body.stations.map((s) => {
      if (!s.name) throw new Error("Station name required");

      return {
        updateOne: {
          filter: { name: s.name.trim().toLowerCase() },
          update: {
            $set: {
              name: s.name.trim(),
              location: s.location?.trim() || "",
              coordinates: {
                type: "Point",
                coordinates:
                  Array.isArray(s.coordinates) && s.coordinates.length === 2
                    ? s.coordinates
                    : [0, 0],
              },
              status: s.status || "active",
            },
          },
          upsert: true,
        },
      };
    });

    const result = await Station.bulkWrite(ops);

    return send(res, {
      success: true,
      msg: "Stations upserted",
      count: result.upsertedCount + result.modifiedCount,
      data: result,
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

    if (!name) {
      return send(res, {
        success: false,
        msg: "Station name required",
        status: 400,
      });
    }

    const exists = await Station.findOne({
      name: name.trim().toLowerCase(),
    });

    if (exists) {
      return send(res, {
        success: false,
        msg: "Station already exists",
        status: 400,
      });
    }

    const station = await Station.create({
      name: name.trim(),
      location: location?.trim() || "",
      coordinates: {
        type: "Point",
        coordinates:
          Array.isArray(coordinates) && coordinates.length === 2
            ? coordinates
            : [0, 0],
      },
      status: status || "active",
    });

    const count = await Station.countDocuments();

    return send(res, {
      success: true,
      msg: "Station created",
      count,
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
    if (!Array.isArray(req.body.trains) || req.body.trains.length === 0) {
      return send(res, {
        success: false,
        msg: "Invalid trains array",
        status: 400,
      });
    }

    const ops = req.body.trains.map((t) => {
      if (!t.number || !t.name || !t.route || !t.seats || t.seats <= 0) {
        throw new Error("Missing or invalid train fields");
      }

      return {
        updateOne: {
          filter: { number: t.number },
          update: {
            $set: {
              name: t.name.trim(),
              route: t.route.trim(),
              seats: t.seats,
              status: t.status || "active",
              type: t.type || "normal",
            },
          },
          upsert: true,
        },
      };
    });

    const result = await Train.bulkWrite(ops);

    return send(res, {
      success: true,
      msg: "Trains upserted",
      count: result.upsertedCount + result.modifiedCount,
      data: result,
    });
  } catch (err) {
    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.createTrain = async (req, res) => {
  try {
    const { number, name, route, seats, status, type } = req.body;

    if (!number || !name || !route || !seats || seats <= 0) {
      return send(res, {
        success: false,
        msg: "Invalid input",
        status: 400,
      });
    }

    const cleanName = name.trim();

    const exists = await Train.findOne({
      $or: [{ number }, { name: cleanName }],
    });

    if (exists) {
      return send(res, {
        success: false,
        msg: "Train already exists",
        status: 400,
      });
    }

    const train = await Train.create({
      number,
      name: cleanName,
      route: route.trim(),
      seats,
      status: status || "active",
      type: type || "normal",
    });

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
  let session = null;

  try {
    if (!Array.isArray(req.body.trips) || req.body.trips.length === 0) {
      return send(res, {
        success: false,
        msg: "Invalid trips array",
        status: 400,
      });
    }

    if (process.env.USE_TRANSACTION === "true") {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const createdTrips = [];

    for (const item of req.body.trips) {
      const {
        train,
        fromStation,
        toStation,
        departureDate,
        arrivalDate,
        price = 0,
      } = item;

      if (
        !train ||
        !fromStation ||
        !toStation ||
        !departureDate ||
        !arrivalDate
      ) {
        throw new Error("Missing required fields");
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

      const foundTrain = session
        ? await Train.findById(train).session(session)
        : await Train.findById(train);

      if (!foundTrain) throw new Error("Train not found");

      const [from, to] = await Promise.all([
        session
          ? Station.findById(fromStation).session(session)
          : Station.findById(fromStation),

        session
          ? Station.findById(toStation).session(session)
          : Station.findById(toStation),
      ]);

      if (!from || !to) throw new Error("Station not found");

      const exists = session
        ? await Trip.findOne({
            train,
            fromStation,
            toStation,
            departureDate: new Date(departureDate),
          }).session(session)
        : await Trip.findOne({
            train,
            fromStation,
            toStation,
            departureDate: new Date(departureDate),
          });

      if (exists) throw new Error("Trip already exists");

      const tripData = {
        train,
        fromStation,
        toStation,
        departureDate,
        arrivalDate,
        price,
      };

      const newTrip = new Trip(tripData);

      if (session) {
        await newTrip.save({ session });
      } else {
        await newTrip.save();
      }

      createdTrips.push(newTrip);

      const seats = Array.from({ length: foundTrain.seats }, (_, i) => ({
        train,
        trip: newTrip._id,
        seatNumber: i + 1,
      }));

      if (session) {
        await Seat.insertMany(seats, { session });
      } else {
        await Seat.insertMany(seats);
      }
    }

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return send(res, {
      success: true,
      msg: "Trips created with seats",
      count: createdTrips.length,
      data: createdTrips,
    });
  } catch (err) {
    console.error("FULL ERROR:", err);
    console.error("STACK:", err.stack);

    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    return send(res, {
      success: false,
      msg: err.message,
      status: 500,
    });
  }
};
exports.createTrip = async (req, res) => {
  let session = null;

  try {
    const {
      train,
      fromStation,
      toStation,
      departureDate,
      arrivalDate,
      price = 0,
    } = req.body;

    if (
      !train ||
      !fromStation ||
      !toStation ||
      !departureDate ||
      !arrivalDate
    ) {
      throw new Error("Missing required fields");
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

    if (process.env.USE_TRANSACTION === "true") {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const foundTrain = session
      ? await Train.findById(train).session(session)
      : await Train.findById(train);

    if (!foundTrain) throw new Error("Train not found");

    const [from, to] = await Promise.all([
      session
        ? Station.findById(fromStation).session(session)
        : Station.findById(fromStation),

      session
        ? Station.findById(toStation).session(session)
        : Station.findById(toStation),
    ]);

    if (!from || !to) throw new Error("Station not found");

    const exists = session
      ? await Trip.findOne({
          train,
          fromStation,
          toStation,
          departureDate: new Date(departureDate),
        }).session(session)
      : await Trip.findOne({
          train,
          fromStation,
          toStation,
          departureDate: new Date(departureDate),
        });

    if (exists) throw new Error("Trip already exists");

    const tripData = {
      train,
      fromStation,
      toStation,
      departureDate,
      arrivalDate,
      price,
    };

    const trip = new Trip(tripData);

    if (session) {
      await trip.save({ session });
    } else {
      await trip.save();
    }

    const seats = Array.from({ length: foundTrain.seats }, (_, i) => ({
      train,
      trip: trip._id,
      seatNumber: i + 1,
    }));

    if (session) {
      await Seat.insertMany(seats, { session });
      await session.commitTransaction();
      session.endSession();
    } else {
      await Seat.insertMany(seats);
    }

    return send(res, {
      success: true,
      msg: "Trip created with seats",
      data: trip,
      status: 201,
    });
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
exports.createSeats = async (req, res) => {
  try {
    if (!Array.isArray(req.body.seats) || req.body.seats.length === 0) {
      return send(res, {
        success: false,
        msg: "Invalid seats array",
        status: 400,
      });
    }

    const cleaned = [];

    for (const s of req.body.seats) {
      const { train, trip, seatNumber } = s;

      if (!train || !trip || !seatNumber) {
        throw new Error("Missing required fields");
      }

      if (
        !mongoose.Types.ObjectId.isValid(train) ||
        !mongoose.Types.ObjectId.isValid(trip)
      ) {
        throw new Error("Invalid IDs");
      }

      const foundTrain = await Train.findById(train);
      if (!foundTrain) throw new Error("Train not found");

      const foundTrip = await Trip.findById(trip);
      if (!foundTrip) throw new Error("Trip not found");

      const exists = await Seat.findOne({
        trip,
        seatNumber,
      });

      if (exists) throw new Error(`Seat ${seatNumber} already exists`);

      cleaned.push({
        train,
        trip,
        seatNumber,
      });
    }

    const seats = await Seat.insertMany(cleaned, { ordered: false });

    return send(res, {
      success: true,
      msg: "Seats created",
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
exports.createSeat = async (req, res) => {
  try {
    const { train, trip, seatNumber } = req.body;

    if (!train || !trip || !seatNumber) {
      return send(res, {
        success: false,
        msg: "Missing required fields",
        status: 400,
      });
    }

    if (
      !mongoose.Types.ObjectId.isValid(train) ||
      !mongoose.Types.ObjectId.isValid(trip)
    ) {
      return send(res, {
        success: false,
        msg: "Invalid IDs",
        status: 400,
      });
    }

    const foundTrain = await Train.findById(train);
    if (!foundTrain) {
      return send(res, {
        success: false,
        msg: "Train not found",
        status: 404,
      });
    }

    const foundTrip = await Trip.findById(trip);
    if (!foundTrip) {
      return send(res, {
        success: false,
        msg: "Trip not found",
        status: 404,
      });
    }

    const exists = await Seat.findOne({
      trip,
      seatNumber,
    });

    if (exists) {
      return send(res, {
        success: false,
        msg: "Seat already exists in this trip",
        status: 400,
      });
    }

    const seat = await Seat.create({
      train,
      trip,
      seatNumber,
    });

    const count = await Seat.countDocuments();

    return send(res, {
      success: true,
      msg: "Seat created",
      count,
      data: seat,
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
      .lean();

    if (!trip) {
      return send(res, {
        success: false,
        msg: "Trip not found",
        status: 404,
      });
    }

    return send(res, { msg: "Trip fetched", data: trip });
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
      .populate("train fromStation toStation")
      .lean();

    if (!trip) {
      return send(res, {
        success: false,
        msg: "Trip not found",
        status: 404,
      });
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

    return send(res, {
      success: true,
      msg: "Trip route fetched",
      count: route.length,
      data: {
        tripId: trip._id,
        train: trip.train,
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

    const trips = await Trip.find()
      .populate("train fromStation toStation")
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const count = await Trip.countDocuments();

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
    const stations = await Station.find().lean();
    const count = await Station.countDocuments();

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
      .populate("trip reservedBy", "-password")
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
      .populate("train trip reservedBy", "-password")
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

    const trip = await Trip.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    }).populate("train fromStation toStation");

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

    const seat = await Seat.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    }).populate("train trip reservedBy");

    if (!seat) {
      return send(res, { success: false, msg: "Seat not found", status: 404 });
    }

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
    ]);

    return send(res, {
      success: true,
      msg: "All trains, trips and seats deleted successfully",
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

    await Promise.all([Trip.deleteMany({}), Seat.deleteMany({})]);

    return send(res, { msg: "All trips and related seats deleted" });
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

    await seat.deleteOne();

    return send(res, { msg: "Seat deleted successfully" });
  } catch (err) {
    return send(res, { success: false, msg: err.message, status: 500 });
  }
};
exports.deleteUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return send(res, {
        success: false,
        msg: "User ID is required",
        status: 400,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
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
      Station.deleteMany({}),
      Train.deleteMany({}),
      Trip.deleteMany({}),
      Seat.deleteMany({}),
      Booking.deleteMany({}),
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
