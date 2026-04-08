const { google } = require("googleapis");

// We build the OAuth2 client once and reuse it.
// It's created lazily so the server doesn't crash on startup
// if GOOGLE_CREDENTIALS isn't set yet.

let _auth = null;

function getAuth() {
  if (_auth) return _auth;

  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error("GOOGLE_CREDENTIALS env var is not set");

  const credentials = JSON.parse(raw);
  const { client_id, client_secret, redirect_uris } =
    credentials.web || credentials.installed;

  const redirectUri = process.env.OAUTH_REDIRECT_URI || redirect_uris[0];
  _auth = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // When googleapis silently refreshes the access token it emits this event.
  // We log the new tokens so you can update GOOGLE_TOKEN on Vercel if needed.
  _auth.on("tokens", (newTokens) => {
    console.log(
      "=== Token refreshed — update GOOGLE_TOKEN on Vercel with: ===",
    );
    // Merge with existing credentials so refresh_token isn't lost
    const merged = { ..._auth.credentials, ...newTokens };
    console.log(JSON.stringify(merged));
  });

  // Load saved token if present
  const savedToken = process.env.GOOGLE_TOKEN;
  if (savedToken) {
    _auth.setCredentials(JSON.parse(savedToken));
    console.log("Loaded GOOGLE_TOKEN from environment");
  } else {
    console.log("No GOOGLE_TOKEN set — run OAuth flow from the app to connect");
  }

  return _auth;
}

// Called by server.js after a successful OAuth callback
function applyTokens(tokens) {
  const auth = getAuth(); // ensures _auth exists
  auth.setCredentials(tokens);
  console.log("New OAuth tokens applied to auth client");
}

module.exports = { getAuth, applyTokens };
