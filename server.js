const express = require("express");
const path    = require("path");
const User           = require("./User");
const Week           = require("./Week");
const Day            = require("./Day");
const SimplifiedWeek = require("./SimplifiedWeek");
const SimplifiedDay  = require("./SimplifiedDay");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE OAUTH
//
// Flow:
//   1. Browser hits GET /oauth/start  → server returns a Google consent URL
//   2. Browser opens that URL in a new tab
//   3. User approves → Google redirects to GET /oauth/callback?code=...
//   4. Server exchanges code for tokens, stores them on the auth client
//   5. Callback page posts "oauth_success" to the opener window
//   6. App shows success, prompts user to save token to Render env var
// ─────────────────────────────────────────────────────────────────────────────

app.get("/oauth/start", (req, res) => {
  try {
    const { getAuth } = require("./auth");
    const auth = getAuth();
    const url  = auth.generateAuthUrl({
      access_type: "offline",
      prompt:      "consent",  // ensures we always get a refresh_token
      scope:       "https://www.googleapis.com/auth/calendar.readonly",
    });
    res.json({ url });
  } catch (err) {
    console.error("/oauth/start:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code parameter from Google.");

  try {
    const { getAuth, applyTokens } = require("./auth");
    const auth = getAuth();
    const { tokens } = await auth.getToken(code);
    applyTokens(tokens);

    const tokenJson = JSON.stringify(tokens);

    // Show a simple page — tells user to copy the token to Render, then close tab
    res.send(`<!doctype html><html><head><title>Connected</title>
<style>
  body{font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;background:#f5f5f2;}
  h2{color:#217a4a;}
  pre{background:#fff;border:1px solid #ccc;padding:12px;border-radius:6px;word-break:break-all;white-space:pre-wrap;font-size:0.8rem;}
  ol{line-height:2.2;}
  .done{color:#217a4a;font-weight:bold;}
</style></head><body>
<h2>✅ Google Calendar connected!</h2>
<p>The scheduler is connected and working. Close this tab and return to the app.</p>
<hr>
<h3>Save this token to Render (one-time setup)</h3>
<p>This connection only lasts until the server restarts. To make it permanent:</p>
<ol>
  <li>Go to <strong>render.com</strong> → your service → <strong>Environment</strong></li>
  <li>Find <code>GOOGLE_TOKEN</code> and replace its value with the text below</li>
  <li>Click <strong>Save Changes</strong> — no redeploy needed</li>
</ol>
<p><strong>Copy this entire value:</strong></p>
<pre id="t">${tokenJson}</pre>
<p class="done">Done? Close this tab — the app is ready.</p>
<script>
  if(window.opener){ try{ window.opener.postMessage({type:'oauth_success'},'*'); }catch(e){} }
</script>
</body></html>`);
  } catch (err) {
    console.error("/oauth/callback:", err.message);
    res.status(500).send(`<h2 style="font-family:sans-serif;color:red;padding:40px;">
      Connection failed: ${err.message}<br><br>
      <a href="javascript:history.back()">Go back and try again</a>
    </h2>`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CAL STATUS — used by the frontend to show connected/disconnected dot
// ─────────────────────────────────────────────────────────────────────────────
app.get("/cal-status", (req, res) => {
  try {
    const { getAuth } = require("./auth");
    const auth  = getAuth();
    const creds = auth.credentials;
    const connected = !!(creds && (creds.access_token || creds.refresh_token));
    res.json({ connected });
  } catch {
    res.json({ connected: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/events/mock", (req, res) => {
  res.json({
    studentData: {
      monday:    { "4":3,"4:30":4,"5":6,"5:30":5,"6":4,"6:30":3,"7":2,"7:30":1 },
      tuesday:   { "4":2,"4:30":3,"5":5,"5:30":6,"6":5,"6:30":4,"7":3,"7:30":2 },
      wednesday: { "3":1,"3:30":2,"4":4,"4:30":5,"5":4,"5:30":3,"6":5,"6:30":6,"7":3 },
      thursday:  { "4":3,"4:30":5,"5":6,"5:30":5,"6":4,"6:30":6,"7":4,"7:30":2 },
      saturday:  { "10":4,"10:30":5,"11":6,"11:30":5,"12":4,"12:30":3,"1":4,"1:30":3 },
    },
    oneOnOneData: {
      monday:{  "5":true,"5:30":true },
      tuesday:{},
      wednesday:{ "6":true,"6:30":true },
      thursday:{},
      saturday:{ "11":true,"11:30":true },
    },
  });
});

app.get("/events", async (req, res) => {
  const { monday, calendarId } = req.query;
  if (!monday) return res.status(400).json({ error: "monday date required" });
  try {
    const { getWeekEvents } = require("./calendar");
    const { studentData, oneOnOneData } = await getWeekEvents(
      new Date(monday + "T00:00:00"),
      calendarId || "primary"
    );
    res.json({ studentData, oneOnOneData });
  } catch (err) {
    console.error("/events error:", err.message);
    const isAuth = [401, 403].includes(err.code) ||
      ["invalid_grant","unauthorized","No refresh token","Token has been expired","invalid_client"]
        .some((s) => err.message?.includes(s));
    res.status(isAuth ? 401 : 500).json({
      error:   isAuth ? "auth" : "calendar_error",
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────
app.post("/generate", (req, res) => {
  const { workers, studentData, oneOnOneData, mode } = req.body;

  const users = workers.map((w) => {
    const hoursAv = w.days.map((d) => {
      if (d.allDay) {
        const sat = d.day === "saturday";
        return [d.day,
          sat ? 10 : (w.defaultStart ?? (w.priority === 2 ? 3 : 4)),
          sat ? 14 : (w.defaultEnd   ?? 8),
        ];
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
      const dk  = day.dayName.toLowerCase();
      const sdt = studentData[dk] || {};
      const odt = oneOnOneData ? (oneOnOneData[dk] || {}) : {};
      for (const slot of day.slots) {
        slot.students = sdt[slot.time] || 0;
        slot.oneOnOne = odt[slot.time] || false;
      }
    }
    const tmp = isUltra ? new Day("") : new SimplifiedDay("");
    tmp.canWork(week.week, users);
    tmp.willWork(week.week);
  } else {
    week.createSchedule();
  }

  const schedule = week.week.map((day) => ({
    day: day.dayName,
    assignments: day.totalWorkers
      .filter((w) => w.working[w.days.indexOf(day.dayName.toLowerCase())][0] !== undefined)
      .map((w) => {
        const di = w.days.indexOf(day.dayName.toLowerCase());
        return { name: w.name, start: w.working[di][0], end: w.working[di][1], priority: w.priority };
      }),
  }));

  res.json({ schedule, text: "" });
});

app.listen(3000, () => console.log("Server running on port 3000"));
