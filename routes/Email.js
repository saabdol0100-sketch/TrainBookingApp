const express = require("express");
const router = express.Router();
const EmailController = require("../controllers/Email");
const { authMiddleware, authorizeRole } = require("../middleware/auth");
router.post(
  "/UserCreate/admin",
  authMiddleware,
  authorizeRole(["Admin"]),
  EmailController.signupByAdmin,
);
router.post("/signup", EmailController.signup);
router.post("/verifyOTP", EmailController.verifyOTP);
router.post("/resend-otp", EmailController.resendOTP);
router.post("/login", EmailController.login);
router.post("/login/google", EmailController.loginWithGoogle);
router.post("/login/facebook", EmailController.loginWithFacebook);
router.post("/forgot-password", EmailController.forgotPassword);
router.post("/reset-password", EmailController.resetPassword);
router.get("/account", authMiddleware, EmailController.getAccount);
router.put("/account", authMiddleware, EmailController.updateAccount);
router.delete("/account", authMiddleware, EmailController.deleteAccount);

module.exports = router;

//----------------------
//! NumberOfRoutes :- 12
//----------------------
//? signup
//? verifyEmail
//? resendOTP
//? login
//? forgotPassword
//? resetPassword
//? getAccount
//? updateAccount
//? deleteAccount
//? loginWithGoogle
//? loginWithFacebook
//? verifyResetOTP
//----------------------
