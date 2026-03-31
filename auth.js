const { google } = require("googleapis");

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const { client_id, client_secret, redirect_uris } =
  credentials.web || credentials.installed;

const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

if (process.env.GOOGLE_TOKEN) {
  const tokens = JSON.parse(process.env.GOOGLE_TOKEN);
  auth.setCredentials(tokens);
  console.log("Loaded existing token");
} else {
  const authUrl = auth.generateAuthUrl({
    access_type: "offline",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
  });
  console.log("─────────────────────────────────────────");
  console.log("Google Calendar authorization required.");
  console.log("Open this URL in your browser:");
  console.log(authUrl);
  console.log("─────────────────────────────────────────");
}

function saveToken(tokens) {
  auth.setCredentials(tokens);
  console.log(
    "Token received. On a hosted server, set GOOGLE_TOKEN env var manually.",
  );
}

module.exports = { auth, saveToken };
