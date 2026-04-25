const express = require("express");
const router = express.Router();
const usersController = require("../controllers/User");
const { authMiddleware, authorizeRole } = require("../middleware/auth");

const userOnly = [authMiddleware, authorizeRole(["user", "commissary"])];

router.get("/bookings", ...userOnly, usersController.getMyBooks);
router.delete("/bookings/:id", ...userOnly, usersController.deleteBookById);
router.post("/bookings/pay", ...userOnly, usersController.confirmPayment);
router.get("/stations", ...userOnly, usersController.getAllStations);
router.get("/stations/search", ...userOnly, usersController.getStationByName);
router.get("/trips/search", ...userOnly, usersController.getTripByStations);
router.get(
  "/trips/by-station",
  ...userOnly,
  usersController.getAllTripsByStationId,
);
router.get("/trips/:tripId/route", ...userOnly, usersController.getTripRoute);
router.get("/trips/:tripId/seats", ...userOnly, usersController.getSeatsByTrip);
router.post("/seats/:seatId/hold", ...userOnly, usersController.holdSeat);
module.exports = router;

//----------------
//! NumberOfMethods :- 11
//----------------
//? 1-deleteBookById
//? 2-getMyBooks
//? 3-confirmPayment
//? 4-createBooking
//? 5-holdSeat
//? 6-getAllTripsByStationId
//? 7-getSeatsByTrip
//? 8-getTripRoute
//? 9-getTripByStations
//? 10-getStationByName
//? 11-getAllStations
//----------------
