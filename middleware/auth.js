const jwt = require("jsonwebtoken");

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;

  return parts[1];
};

//? ExtractToken = gets JWT from Authorization header safely

const authMiddleware = (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET not defined");
    }

    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        msg: "Unauthorized",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      msg: "Invalid or expired token",
    });
  }
};

const authorizeRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        msg: "Access denied",
      });
    }

    next();
  };
};

const checkOwner = (paramKey = "id") => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const resourceId = req.params[paramKey];

    if (!resourceId) {
      return res.status(400).json({
        success: false,
        msg: "Resource ID missing",
      });
    }

    if (req.user.id !== resourceId) {
      return res.status(403).json({
        success: false,
        msg: "Forbidden",
      });
    }

    next();
  };
};

const errorHandler = (err, req, res, next) => {
  console.error("❌ Error:", err.stack);

  const isProd = process.env.NODE_ENV === "production";

  res.status(err.status || 500).json({
    success: false,
    msg: isProd ? "Internal Server Error" : err.message,
  });
};

module.exports = {
  authMiddleware,
  authorizeRole,
  checkOwner,
  errorHandler,
};
