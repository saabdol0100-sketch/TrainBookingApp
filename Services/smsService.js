let client = null;

if (
  process.env.TWILIO_SID &&
  process.env.TWILIO_SID.startsWith("AC") &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER
) {
  const twilio = require("twilio");
  client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
}

exports.sendSMS = async (to, message) => {
  if (!client) {
    console.warn("Twilio not configured");
    return;
  }

  return client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
};
