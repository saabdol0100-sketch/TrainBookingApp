const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// دالة عامة لإرسال الإيميل
exports.sendEmail = async (to, subject, text, attachments = []) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      attachments, // تقدر تبعت QR code أو PDF هنا
    });

    console.log("Email sent:", info.response);
    return info;
  } catch (err) {
    console.error("Email error:", err.message);
    throw err;
  }
};
