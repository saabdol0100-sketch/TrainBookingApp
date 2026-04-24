const express = require("express");
const router = express.Router();
const CommissaryController = require("../controllers/Commissary");
const { authMiddleware, authorizeRole } = require("../middleware/auth");

// ✅ Commissary OR Admin can verify tickets
const staffOnly = [authMiddleware, authorizeRole(["Commissary", "Admin"])];

// ===== QR CODE VERIFICATION =====
router.post("/verify-qr", ...staffOnly, CommissaryController.verifyQRCode);

module.exports = router;

//---------------
// ✅ COMMISSARY ROUTES
//---------------
// ✔ 1 Route only (as required)
// ✔ Secure (JWT + Role-based)
// ✔ Used for scanning tickets at station
//---------------
