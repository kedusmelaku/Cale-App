const { google } = require("googleapis");
const fs = require("fs");

const credentials = JSON.parse(fs.readFileSync("credentials.json"));
const { client_id, client_secret, redirect_uris } =
  credentials.web || credentials.installed;

const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

if (fs.existsSync("token.json")) {
  const tokens = JSON.parse(fs.readFileSync("token.json"));
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
  fs.writeFileSync("token.json", JSON.stringify(tokens));
  auth.setCredentials(tokens);
  console.log("Token saved successfully.");
}

module.exports = { auth, saveToken };
