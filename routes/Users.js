const express = require("express");
const router = express.Router();
const usersController = require("../controllers/User");
const { authMiddleware, authorizeRole } = require("../middleware/auth");

const userOnly = [authMiddleware, authorizeRole(["user", "commissary"])];

router.get("/trips/search", ...userOnly, usersController.searchTrips);

router.get("/trips/:tripId/route", ...userOnly, usersController.getTripRoute);
router.get("/stations", ...userOnly, usersController.getAllStations);
router.get("/trips/:tripId/seats", ...userOnly, usersController.getSeatsByTrip);
router.post("/seats/:seatId/hold", ...userOnly, usersController.holdSeat);

router.post("/bookings/pay", ...userOnly, usersController.confirmPayment);
router.get("/bookings", ...userOnly, usersController.getMyBooks);
router.delete("/bookings/:id", ...userOnly, usersController.cancelBooking);

module.exports = router;

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
