const express = require("express");
const path    = require("path");
const User          = require("./User");
const Week          = require("./Week");
const Day           = require("./Day");
const SimplifiedWeek = require("./SimplifiedWeek");
const SimplifiedDay  = require("./SimplifiedDay");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Google OAuth setup ────────────────────────────────────────────────────
// We lazy-load auth so the server still starts even if GOOGLE_CREDENTIALS
// is missing (which would cause auth.js to throw on require).
function getAuth() {
  return require("./auth").auth;
}

// ── /oauth/start — send the user to Google's consent screen ───────────────
app.get("/oauth/start", (req, res) => {
  try {
    const { google } = require("googleapis");
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const { client_id, client_secret, redirect_uris } =
      credentials.web || credentials.installed;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",          // force refresh_token every time
      scope: "https://www.googleapis.com/auth/calendar.readonly",
    });

    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /oauth/callback — Google redirects here after the user approves ───────
app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  try {
    const { google } = require("googleapis");
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const { client_id, client_secret, redirect_uris } =
      credentials.web || credentials.installed;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Update the in-memory auth instance so calendar calls work immediately
    const authModule = require("./auth");
    authModule.auth.setCredentials(tokens);

    // Send a self-closing page that passes the token back to the opener
    const tokenJson = JSON.stringify(tokens);
    res.send(`<!doctype html>
<html>
<head><title>Connected</title>
<style>
  body { font-family: sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#f5f5f2; }
  .card { background:white; border-radius:10px; padding:32px 36px; max-width:520px; width:100%; box-shadow:0 4px 20px rgba(0,0,0,.1); }
  h2 { color:#2a5fad; margin:0 0 12px; }
  p  { color:#555; line-height:1.6; margin:0 0 16px; }
  .token-box { background:#f5f5f2; border:1px solid #ddd; border-radius:6px; padding:12px; font-size:0.78rem; font-family:monospace; word-break:break-all; max-height:120px; overflow-y:auto; margin:12px 0; }
  .steps { background:#edf2fc; border-radius:6px; padding:16px 20px; }
  .steps ol { margin:8px 0 0 18px; line-height:2; }
  .steps code { background:rgba(0,0,0,.06); padding:1px 5px; border-radius:3px; font-size:0.85em; }
</style>
</head>
<body>
<div class="card">
  <h2>✅ Google Calendar connected!</h2>
  <p>The scheduler can now read your calendar. This connection will last until you revoke access in Google.</p>
  <p><strong>To make this permanent on Render</strong>, copy the token below and paste it as the <code>GOOGLE_TOKEN</code> environment variable:</p>
  <div class="token-box" id="tok">${tokenJson}</div>
  <div class="steps">
    <strong>One-time Render setup:</strong>
    <ol>
      <li>Go to your service on <a href="https://render.com" target="_blank">render.com</a></li>
      <li>Click <strong>Environment</strong> → find <code>GOOGLE_TOKEN</code></li>
      <li>Replace its value with the token above</li>
      <li>Click <strong>Save Changes</strong> (no redeploy needed)</li>
    </ol>
  </div>
  <p style="margin-top:16px; color:#27ae60; font-weight:600;">You can close this tab — the scheduler is ready to use.</p>
</div>
<script>
  // Tell the opener that auth succeeded so it can update the UI
  if (window.opener) {
    window.opener.postMessage({ type: "oauth_success" }, "*");
  }
</script>
</body>
</html>`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send(`Auth failed: ${err.message}`);
  }
});

// ── /events/mock ───────────────────────────────────────────────────────────
app.get("/events/mock", (req, res) => {
  const studentData = {
    monday:    { "4": 3, "4:30": 4, "5": 6, "5:30": 5, "6": 4, "6:30": 3, "7": 2, "7:30": 1 },
    tuesday:   { "4": 2, "4:30": 3, "5": 5, "5:30": 6, "6": 5, "6:30": 4, "7": 3, "7:30": 2 },
    wednesday: { "3": 1, "3:30": 2, "4": 4, "4:30": 5, "5": 4, "5:30": 3, "6": 5, "6:30": 6, "7": 3 },
    thursday:  { "4": 3, "4:30": 5, "5": 6, "5:30": 5, "6": 4, "6:30": 6, "7": 4, "7:30": 2 },
    saturday:  { "10": 4, "10:30": 5, "11": 6, "11:30": 5, "12": 4, "12:30": 3, "1": 4, "1:30": 3 },
  };
  const oneOnOneData = {
    monday:    { "5": true, "5:30": true },
    tuesday:   {},
    wednesday: { "6": true, "6:30": true },
    thursday:  {},
    saturday:  { "11": true, "11:30": true },
  };
  res.json({ studentData, oneOnOneData });
});

// ── /events ────────────────────────────────────────────────────────────────
app.get("/events", async (req, res) => {
  const { monday, calendarId } = req.query;
  if (!monday) return res.status(400).json({ error: "monday date required" });
  try {
    const { getWeekEvents } = require("./calendar");
    const mondayDate = new Date(monday + "T00:00:00");
    const { studentData, oneOnOneData } = await getWeekEvents(mondayDate, calendarId || "primary");
    res.json({ studentData, oneOnOneData });
  } catch (err) {
    console.error("Calendar error:", err.message);
    const isAuthError =
      err.code === 401 ||
      err.message?.includes("invalid_grant") ||
      err.message?.includes("unauthorized") ||
      err.message?.includes("No refresh token");
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? "auth" : "calendar_error",
      message: err.message,
    });
  }
});

// ── /cal-status ───────────────────────────────────────────────────────────
app.get("/cal-status", (req, res) => {
  try {
    const auth = getAuth();
    const creds = auth.credentials;
    const connected = !!(creds && (creds.access_token || creds.refresh_token));
    res.json({ connected });
  } catch {
    // auth.js couldn't load (no GOOGLE_CREDENTIALS env var)
    res.json({ connected: false });
  }
});

// ── /generate ──────────────────────────────────────────────────────────────
app.post("/generate", (req, res) => {
  const { workers, studentData, oneOnOneData, mode } = req.body;

  const users = workers.map((w) => {
    const hoursAv = w.days.map((d) => {
      if (d.allDay) {
        const isSaturday   = d.day === "saturday";
        const defaultStart = isSaturday ? 10 : (w.defaultStart ?? (w.priority === 2 ? 3 : 4));
        const defaultEnd   = isSaturday ? 14 : (w.defaultEnd   ?? 8);
        return [d.day, defaultStart, defaultEnd];
      }
      const start = d.start + ((d.startMinute || 0) === 30 ? 0.5 : 0);
      const end   = d.end   + ((d.endMinute   || 0) === 30 ? 0.5 : 0);
      return [d.day, start, end];
    });
    const user = new User(w.name, hoursAv);
    if (w.priority) user.setPriority(w.priority);
    return user;
  });

  const isUltra = mode === "ultra";
  const week    = isUltra ? new Week(users) : new SimplifiedWeek(users);

  if (studentData) {
    for (const day of week.week) {
      const dayKey   = day.dayName.toLowerCase();
      const daySData = studentData[dayKey] || {};
      const dayOData = oneOnOneData ? (oneOnOneData[dayKey] || {}) : {};
      for (const slot of day.slots) {
        slot.students = daySData[slot.time] || 0;
        slot.oneOnOne = dayOData[slot.time] || false;
      }
    }
    if (isUltra) {
      const tempDay = new Day("");
      tempDay.canWork(week.week, users);
      tempDay.willWork(week.week);
    } else {
      const tempDay = new SimplifiedDay("");
      tempDay.canWork(week.week, users);
      tempDay.willWork(week.week);
    }
  } else {
    week.createSchedule();
  }

  const schedule = week.week.map((day) => {
    const assignments = [];
    for (let worker of day.totalWorkers) {
      let di = worker.days.indexOf(day.dayName.toLowerCase());
      if (worker.working[di][0] === undefined) continue;
      assignments.push({
        name:     worker.name,
        start:    worker.working[di][0],
        end:      worker.working[di][1],
        priority: worker.priority,
      });
    }
    return { day: day.dayName, assignments };
  });

  let text = "";
  for (let day of week.week) {
    const hasWorkers = day.totalWorkers.some((w) => {
      const di = w.days.indexOf(day.dayName.toLowerCase());
      return w.working[di][0] !== undefined;
    });
    if (!hasWorkers) continue;
    text += `Hours for ${day.dayName}:\n`;
    for (let worker of day.totalWorkers) {
      const di = worker.days.indexOf(day.dayName.toLowerCase());
      if (worker.working[di][0] === undefined) continue;
      const name = worker.name.charAt(0).toUpperCase() + worker.name.slice(1);
      text += `${name}: ${worker.working[di][0]}-${worker.working[di][1]}\n`;
    }
    text += "\n";
  }

  res.json({ schedule, text });
});

app.listen(3000, () => console.log("Running on http://localhost:3000"));
