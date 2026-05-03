const nodemailer = require("nodemailer");

// 🔐 transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // ⚠️ must be App Password (not Gmail password)
  },
});

// ✅ base sender
const baseMailOptions = {
  from: `"Train Booking" <${process.env.EMAIL_USER}>`,
};

// ----------------------
// GENERIC EMAIL
// ----------------------
exports.sendEmail = async ({ to, subject, text, html, attachments = [] }) => {
  try {
    const info = await transporter.sendMail({
      ...baseMailOptions,
      to,
      subject,
      text,
      html,
      attachments,
    });
    console.log("SENDING EMAIL TO:", to);
    console.log("✅ Email sent:", info.response);
    return info;
  } catch (err) {
    console.error("❌ Email error:", err.message);
    throw err;
  }
};

// ---

// # ----------------------
// # OTP EMAIL
// # ----------------------
exports.sendOTPEmail = async (to, otp) => {
  return this.sendEmail({
    to,
    subject: "Verify your account",
    text: `Your OTP is: ${otp}`,
    html: `
      <h2>Verify Your Account</h2>
      <p>Your OTP code is:</p>
      <h1 style="color:#2e86de">${otp}</h1>
      <p>This code expires in a few minutes.</p>
    `,
  });
};

// ---

// # ----------------------
// # TICKET EMAIL
// # ----------------------
exports.sendTicketEmail = async (to, data) => {
  const { userName, seatNumbers, passengers, totalPrice, qrCode } = data;
  console.log("SENDING EMAIL TO:", to);
  const passengerRows = passengers
    .map(
      (p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.name}</td>
          <td>${p.age || "-"}</td>
          <td>${p.gender || "-"}</td>
          <td>${seatNumbers[i]}</td>
        </tr>
      `,
    )
    .join("");
  return this.sendEmail({
    to,
    subject: "🎟️ Your Train Ticket",
    text: `Your booking is confirmed. Seats: ${seatNumbers.join(", ")}`,
    html: `
      <div style="font-family:Arial;padding:20px">
        <h2>🎟️ Train Ticket Confirmation</h2>

        <p>Hello <b>${userName}</b>,</p>
        <p>Your booking has been confirmed.</p>

        <h3>🪑 Seats</h3>
        <p>${seatNumbers.join(", ")}</p>

        <h3>👥 Passengers</h3>
        <table border="1" cellpadding="8" cellspacing="0">
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Age</th>
            <th>Gender</th>
            <th>Seat</th>
          </tr>
          ${passengerRows}
        </table>

        <h3>💰 Total Price: ${totalPrice} EGP</h3>

        <h3>📱 QR Code</h3>
        <img src="${qrCode}" width="200"/>

        <p>Thank you for choosing our service 🚆</p>
      </div>
    `,
    attachments: [
      {
        filename: "ticket-qr.png",
        path: qrCode, // base64 QR
      },
    ],
  });
};
