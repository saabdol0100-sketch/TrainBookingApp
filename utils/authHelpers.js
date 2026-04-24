const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
};

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const hashOTP = (otp) =>
  crypto
    .createHmac("sha256", process.env.EMAIL_SECRET)
    .update(otp)
    .digest("hex");

function extractDOBFromNationalId(nationalId) {
  const centuryCode = nationalId[0];

  let century = "";
  if (centuryCode === "2") century = "19";
  else if (centuryCode === "3") century = "20";
  else throw new Error("Invalid National ID");

  const year = nationalId.slice(1, 3);
  const month = nationalId.slice(3, 5);
  const day = nationalId.slice(5, 7);

  return new Date(`${century}${year}-${month}-${day}`);
}

module.exports = {
  generateToken,
  generateOTP,
  hashOTP,
  extractDOBFromNationalId,
};
