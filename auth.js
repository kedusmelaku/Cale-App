const { google } = require("googleapis");
const OAuthToken = require("./OAuthToken");

// We build the OAuth2 client once and reuse it. It's created lazily so the
// server doesn't crash on startup if GOOGLE_CREDENTIALS isn't set yet.
//
// Token persistence: the user's Google OAuth token is stored in MongoDB
// (keyed by CENTER_ID) so the connection survives Vercel cold starts and is
// shared across all serverless instances. The in-memory auth client is just a
// cache; the database is the source of truth.

let _auth = null;

function buildClient() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error("GOOGLE_CREDENTIALS env var is not set");

  const credentials = JSON.parse(raw);
  const { client_id, client_secret, redirect_uris } =
    credentials.web || credentials.installed;

  const redirectUri = process.env.OAUTH_REDIRECT_URI || redirect_uris[0];
  const client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // When googleapis silently refreshes the access token it emits this event.
  // Persist the refreshed token back to MongoDB so it's never lost — this
  // replaces the old "copy the token to Vercel by hand" step entirely.
  client.on("tokens", async (newTokens) => {
    try {
      const merged = { ...client.credentials, ...newTokens };
      // centerId is stored on the client object when loadTokensFromDB sets it up
      if (client._centerId) {
        await saveTokenToDB(client._centerId, merged);
        console.log("Refreshed Google token saved to database");
      }
    } catch (e) {
      console.error("Failed to persist refreshed token:", e.message);
    }
  });

  return client;
}

// Returns the (synchronously built) OAuth2 client. Does NOT load the token —
// call loadTokensFromDB() before using the client to read calendar data.
function getAuth() {
  if (_auth) return _auth;
  _auth = buildClient();
  return _auth;
}

async function saveTokenToDB(centerId, token) {
  await OAuthToken.findOneAndUpdate(
    { centerId },
    { centerId, token, updatedAt: new Date() },
    { upsert: true, returnDocument: "after" },
  );
}

// Loads the stored token for this center onto the auth client. Falls back to
// the GOOGLE_TOKEN env var (one-time seed) if the database has none yet.
// Returns true if a token was loaded, false otherwise.
async function loadTokensFromDB(centerId) {
  const auth = getAuth();
  auth._centerId = centerId; // store so the token-refresh event handler can use it
  try {
    const doc = await OAuthToken.findOne({ centerId });
    if (doc && doc.token) {
      auth.setCredentials(doc.token);
      return true;
    }
  } catch (e) {
    console.error("Failed to load token from DB:", e.message);
  }
  return false;
}

// Called by server.js after a successful OAuth callback. Persists to DB and
// sets the in-memory client.
async function applyTokens(centerId, tokens) {
  const auth = getAuth();
  auth._centerId = centerId;
  auth.setCredentials(tokens);
  await saveTokenToDB(centerId, tokens);
  console.log("New OAuth tokens applied and saved to database");
}

// Clears tokens from both the database and the in-memory client.
async function clearTokens(centerId) {
  try {
    await OAuthToken.deleteOne({ centerId });
  } catch (e) {
    console.error("Failed to delete token from DB:", e.message);
  }
  if (_auth) {
    try {
      _auth.setCredentials({});
      _auth.credentials = {};
      _auth._centerId = null;
    } catch (e) {
      console.log("Error clearing in-memory tokens:", e.message);
    }
  }
  console.log("OAuth tokens cleared from database and memory");
}

// Is this token actually still usable, according to Google right now -- not
// just "do we have a token row in the database"? A center's stored token
// stays byte-for-byte unchanged if the person revokes access from their
// Google Account settings (myaccount.google.com) instead of disconnecting
// from inside Cale -- Google invalidates it on their end, but nothing tells
// our database, so a presence-only check (does a token object exist / does
// it have an access_token field) keeps reporting "connected" forever after
// a revocation. This makes one cheap, real call to Google
// (calendarList.list with maxResults 1, the same call /calendars already
// relies on to detect this) and trusts THAT answer instead. On an auth
// failure it also clears the now-dead token from the DB, so the center
// self-heals to a correct "disconnected" state instead of needing every
// future status check to independently rediscover the same revocation.
async function verifyConnection(centerId) {
  const { google } = require("googleapis");
  const hasToken = await loadTokensFromDB(centerId);
  if (!hasToken) return false;
  const auth = getAuth();
  try {
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.calendarList.list({ maxResults: 1 });
    return true;
  } catch (err) {
    const isAuth =
      [401, 403].includes(err.code) ||
      [
        "invalid_grant",
        "unauthorized",
        "No refresh token",
        "Token has been expired",
        "invalid_client",
      ].some((s) => err.message?.includes(s));
    if (isAuth) {
      await clearTokens(centerId);
      return false;
    }
    // Not an auth problem (e.g. Google's API is briefly down) -- don't wipe
    // a token that might still be perfectly valid over a transient error.
    throw err;
  }
}

module.exports = { getAuth, loadTokensFromDB, applyTokens, clearTokens, saveTokenToDB, verifyConnection };
