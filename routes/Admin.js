const express = require("express");
const router = express.Router();
const AdminController = require("../controllers/Admin");
const { authMiddleware, authorizeRole } = require("../middleware/auth");

const adminOnly = [authMiddleware, authorizeRole(["admin"])];

// ===== Create =====
router.post("/trains", ...adminOnly, AdminController.createTrains);
router.post("/train", ...adminOnly, AdminController.createTrain);
router.post("/trips", ...adminOnly, AdminController.createTrips);
router.post("/trip", ...adminOnly, AdminController.createTrip);
router.post("/seats", ...adminOnly, AdminController.createSeats);
router.post("/seat", ...adminOnly, AdminController.createSeat);
router.post("/stations", ...adminOnly, AdminController.createStations);
router.post("/station", ...adminOnly, AdminController.createStation);
router.get("/trip-route/:tripId", authMiddleware, AdminController.getTripRoute);
// ===== Get =====
router.get(
  "/trains/:trainId/seats",
  ...adminOnly,
  AdminController.getSeatsByTrainId,
);

router.get("/trips", ...adminOnly, AdminController.getAllTrips);
router.get("/users", ...adminOnly, AdminController.getAllUsers);
router.get("/trip/:id", ...adminOnly, AdminController.getTripById);

router.get("/trains", ...adminOnly, AdminController.getAllTrains);
router.get("/train/:id", ...adminOnly, AdminController.getTrainById);

router.get("/stations", ...adminOnly, AdminController.getAllStations);
router.get("/station/:id", ...adminOnly, AdminController.getStationById);

// ✅ FIXED
router.get(
  "/seats/trip/:tripId",
  ...adminOnly,
  AdminController.getSeatsByTripId,
);

// ===== Update =====
router.put("/trip/:id", ...adminOnly, AdminController.updateTripById);
router.put("/train/:id", ...adminOnly, AdminController.updateTrainById);
router.put("/station/:id", ...adminOnly, AdminController.updateStationById);
router.put("/seat/:id", ...adminOnly, AdminController.updateSeatById);

// ===== Delete =====
router.delete("/trip/:id", ...adminOnly, AdminController.deleteTrip);
router.delete("/station/:id", ...adminOnly, AdminController.deleteStationById);
router.delete("/seat/:id", ...adminOnly, AdminController.deleteSeatById);
router.delete("/train/:id", ...adminOnly, AdminController.deleteTrainById);
router.delete("/stations", ...adminOnly, AdminController.deleteAllStations);
router.delete("/trips", ...adminOnly, AdminController.deleteAllTrips);
router.delete("/trains", ...adminOnly, AdminController.deleteAllTrains);
router.delete("/database/freeup", ...adminOnly, AdminController.databaseFreeUp);
router.delete("/users/:id", ...adminOnly, AdminController.deleteUserById);

module.exports = router;

//----------------------
//! NumberOfMethods :- 25
//----------------------

// ===== CREATE =====
//? 1- createStations
//? 2- createStation
//? 3- createTrains
//? 4- createTrain
//? 5- createTrips
//? 6- createTrip
//? 7- createSeats
//? 8- createSeat

// ===== GET =====
//? 9- getAllTrains
//? 10- getTrainById
//? 11- getAllTrips
//? 12- getTripById
//? 13- getAllStations
//? 14- getStationById
//? 15- getAllUsers
//? 16- getSeatsByTrainId
//? 17- getSeatsByTripId

// ===== UPDATE =====
//? 18- updateTripById
//? 19- updateTrainById
//? 20- updateStationById
//? 21- updateSeatById

// ===== DELETE =====
//? 22- deleteTrip
//? 23- deleteStationById
//? 24- deleteSeatById
//? 25- deleteAllTrips
//? 26- deleteAllStations
//? 27- deleteAllSeats

// ===== SYSTEM =====
//? 28- databaseFreeUp
//----------------------
