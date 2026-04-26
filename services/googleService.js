const { OAuth2Client } = require("google-auth-library");

let client = null;

if (process.env.GOOGLE_CLIENT_ID) {
  client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
}

exports.verifyGoogleToken = async (token) => {
  if (!client) throw new Error("Google auth not configured");
  if (!token) throw new Error("Token required");

  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  return ticket.getPayload();
};
