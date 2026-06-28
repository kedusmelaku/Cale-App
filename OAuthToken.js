const mongoose = require("mongoose");

// Stores the Google OAuth token for a center so the connection survives
// Vercel cold starts and works across all serverless instances. One document
// per center, keyed by centerId. The token JSON is whatever googleapis
// returns from getToken()/refresh (access_token, refresh_token, expiry_date,
// scope, token_type, etc.) — stored as a flexible object.

const oauthTokenSchema = new mongoose.Schema({
  centerId: { type: String, required: true, unique: true },
  // The full token object from googleapis. Mixed type so we don't have to
  // mirror Google's exact shape (which can vary).
  token: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});

const OAuthToken = mongoose.model("OAuthToken", oauthTokenSchema);

module.exports = OAuthToken;
