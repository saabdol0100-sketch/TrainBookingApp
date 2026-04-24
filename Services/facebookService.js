const fetch = require("node-fetch");

exports.verifyFacebookToken = async (accessToken) => {
  if (!accessToken) throw new Error("Access token required");

  const res = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`,
  );

  const data = await res.json();

  if (data.error) {
    throw new Error("Invalid Facebook token");
  }

  if (!data.email) {
    throw new Error("Facebook email not available");
  }

  return data;
};
