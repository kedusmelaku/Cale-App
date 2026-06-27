require("dotenv").config();
const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./User");
const Week = require("./Week");
const Day = require("./Day");
const SimplifiedWeek = require("./SimplifiedWeek");
const SimplifiedDay = require("./SimplifiedDay");
const Employee = require("./Employee");
const CenterSettings = require("./CenterSettings");
const Submission = require("./Submission");
const mongoose = require("mongoose");

if (!process.env.MANAGER_PASSWORD) {
  console.error("FATAL: MANAGER_PASSWORD env var is not set");
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET env var is not set");
  process.exit(1);
}
const PASSWORD_HASH = bcrypt.hashSync(process.env.MANAGER_PASSWORD, 10);

// On Vercel, each request may hit a fresh function instance with no persistent
// connection. connectDB() reuses an existing connection when possible and
// establishes a new one when needed — safe to await at the top of every route.
let _mongoConnected = false;
async function connectDB() {
  if (_mongoConnected && mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI);
  _mongoConnected = true;
  console.log("MongoDB connected");
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// Reads a signed JWT from the "token" cookie. Each serverless function
// instance verifies it independently — no shared session store needed.
// Page routes redirect to /login. API routes return 401 JSON.
// ─────────────────────────────────────────────────────────────────────────────
function getTokenFromRequest(req) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? match[1] : null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch { /* invalid or expired — fall through */ }
  }
  if (req.xhr || (req.headers.accept && req.headers.accept.includes("application/json"))) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  res.redirect("/login");
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get("/login", (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try { jwt.verify(token, process.env.JWT_SECRET); return res.redirect("/"); } catch {}
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/scheduler", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "scheduler.html"));
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required." });
    const match = await bcrypt.compare(password, PASSWORD_HASH);
    if (!match) return res.status(401).json({ error: "Incorrect password." });
    const token = jwt.sign({ auth: true }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.setHeader("Set-Cookie", `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("/api/login:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE OAUTH
//
// Flow:
//   1. Browser hits GET /oauth/start  → server returns a Google consent URL
//   2. Browser opens that URL in a new tab
//   3. User approves → Google redirects to GET /oauth/callback?code=...
//   4. Server exchanges code for tokens, stores them on the auth client
//   5. Callback page posts "oauth_success" to the opener window
//   6. App shows success, prompts user to save token to Vercel env var
// ─────────────────────────────────────────────────────────────────────────────

app.get("/oauth/start", requireAuth, (req, res) => {
  try {
    const { getAuth } = require("./auth");
    const auth = getAuth();
    const crypto = require("crypto");
    const state = crypto.randomBytes(16).toString("hex");
    const url = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      state,
    });
    res.json({ url });
  } catch (err) {
    console.error("/oauth/start:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/oauth/callback", requireAuth, async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("Missing code parameter from Google.");
  if (!state)
    return res
      .status(400)
      .send("Missing state parameter — possible CSRF attack.");

  try {
    const { getAuth, applyTokens } = require("./auth");
    const auth = getAuth();
    const { tokens } = await auth.getToken(code);
    applyTokens(tokens);

    const tokenJson = JSON.stringify(tokens);

    // Show a simple page — tells user to copy the token to Vercel, then close tab
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
<h3>Save this token to Vercel (one-time setup)</h3>
<p>This connection only lasts until the server restarts. To make it permanent:</p>
<ol>
  <li>Go to <strong>vercel.com</strong> → your service → <strong>Environment</strong></li>
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
    res.status(500)
      .send(`<h2 style="font-family:sans-serif;color:red;padding:40px;">
      Connection failed: ${err.message}<br><br>
      <a href="javascript:history.back()">Go back and try again</a>
    </h2>`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CAL STATUS — used by the frontend to show connected/disconnected dot
// ─────────────────────────────────────────────────────────────────────────────
app.get("/cal-status", requireAuth, (req, res) => {
  try {
    const { getAuth } = require("./auth");
    const auth = getAuth();
    const creds = auth.credentials;
    const connected = !!(creds && (creds.access_token || creds.refresh_token));
    res.json({ connected });
  } catch {
    res.json({ connected: false });
  }
});

// Disconnect: clear in-memory OAuth tokens so the app is no longer connected
app.post("/oauth/disconnect", requireAuth, (req, res) => {
  try {
    const { clearTokens } = require("./auth");
    clearTokens();
    res.json({ disconnected: true });
  } catch (err) {
    console.error("/oauth/disconnect:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALENDARS — lists every calendar the authenticated account can see, so the
// user can pick which one Scheduler reads student bookings from.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/calendars", requireAuth, async (req, res) => {
  try {
    const { google } = require("googleapis");
    const { getAuth } = require("./auth");
    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.calendarList.list();
    const items = response.data.items || [];

    const calendars = items.map((c) => ({
      id: c.id,
      name: c.summaryOverride || c.summary || c.id,
      primary: !!c.primary,
      accessRole: c.accessRole,
    }));

    res.json({ calendars });
  } catch (err) {
    console.error("/calendars error:", err.message);
    const isAuth =
      [401, 403].includes(err.code) ||
      [
        "invalid_grant",
        "unauthorized",
        "No refresh token",
        "Token has been expired",
        "invalid_client",
      ].some((s) => err.message?.includes(s));
    res.status(isAuth ? 401 : 500).json({
      error: isAuth ? "auth" : "calendar_error",
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/events/mock", requireAuth, (req, res) => {
  res.json({
    studentData: {
      monday: {
        4: 3,
        "4:30": 4,
        5: 6,
        "5:30": 5,
        6: 4,
        "6:30": 3,
        7: 2,
        "7:30": 1,
      },
      tuesday: {
        4: 2,
        "4:30": 3,
        5: 5,
        "5:30": 6,
        6: 5,
        "6:30": 4,
        7: 3,
        "7:30": 2,
      },
      wednesday: {
        3: 1,
        "3:30": 2,
        4: 4,
        "4:30": 5,
        5: 4,
        "5:30": 3,
        6: 5,
        "6:30": 6,
        7: 3,
      },
      thursday: {
        4: 3,
        "4:30": 5,
        5: 6,
        "5:30": 5,
        6: 4,
        "6:30": 6,
        7: 4,
        "7:30": 2,
      },
      saturday: {
        10: 4,
        "10:30": 5,
        11: 6,
        "11:30": 5,
        12: 4,
        "12:30": 3,
        1: 4,
        "1:30": 3,
      },
    },
    oneOnOneData: {
      monday: { 5: true, "5:30": true },
      tuesday: {},
      wednesday: { 6: true, "6:30": true },
      thursday: {},
      saturday: { 11: true, "11:30": true },
    },
  });
});

app.get("/events", requireAuth, async (req, res) => {
  const { monday, calendarId } = req.query;
  if (!monday) return res.status(400).json({ error: "monday date required" });
  try {
    const { getWeekEvents } = require("./calendar");
    const { studentData, oneOnOneData } = await getWeekEvents(
      new Date(monday + "T00:00:00"),
      calendarId || "arlingtonheights@mathnasium.com",
    );
    res.json({ studentData, oneOnOneData });
  } catch (err) {
    console.error("/events error:", err.message);
    const isAuth =
      [401, 403].includes(err.code) ||
      [
        "invalid_grant",
        "unauthorized",
        "No refresh token",
        "Token has been expired",
        "invalid_client",
      ].some((s) => err.message?.includes(s));
    res.status(isAuth ? 401 : 500).json({
      error: isAuth ? "auth" : "calendar_error",
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────
app.get("/employees", requireAuth, async (req,res) => {
  try{  
    await connectDB();
    const centerId = process.env.CENTER_ID;
    const result = await Employee.find({ centerId });
    res.json({data: result})
  } catch (err) {
    res.status(500).json({error: err.message});
  }

});

app.post("/employees", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const centerId = process.env.CENTER_ID;
    const employee = new Employee({ ...req.body, centerId });
    await employee.save();
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/employees/:id", requireAuth, async (req, res) => {
  try {
    await connectDB();
    await Employee.findByIdAndDelete(req.params.id);
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/employees/:id", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CENTER SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/center-settings", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const centerId = process.env.CENTER_ID;
    let doc = await CenterSettings.findOne({ centerId });
    if (!doc) doc = { centerId, windowOpen: null, windowClose: null };
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/center-settings", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const centerId = process.env.CENTER_ID;
    const doc = await CenterSettings.findOneAndUpdate(
      { centerId },
      { ...req.body, centerId },
      { new: true, upsert: true }
    );
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

// Get all submissions for the current center, optionally filtered by weekOf
app.get("/submissions", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const centerId = process.env.CENTER_ID;
    const query = { centerId };
    if (req.query.weekOf) query.weekOf = req.query.weekOf;
    const submissions = await Submission.find(query).sort({ submittedAt: 1 });
    res.json({ data: submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee submits availability via the public form
app.post("/submissions", async (req, res) => {
  try {
    await connectDB();
    const centerId = process.env.CENTER_ID;
    const { employeeId, employeeName, weekOf, days } = req.body;

    if (!employeeId || !weekOf || !days) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Check submission window is currently open
    const settings = await CenterSettings.findOne({ centerId });
    const now = new Date();
    if (settings && settings.windowOpen && settings.windowClose) {
      if (now < new Date(settings.windowOpen) || now > new Date(settings.windowClose)) {
        return res.status(403).json({ error: "The availability window is not currently open." });
      }
    }

    // Upsert — replace any existing submission for this employee+week
    const submission = await Submission.findOneAndUpdate(
      { centerId, employeeId, weekOf },
      { centerId, employeeId, employeeName, weekOf, days, submittedAt: new Date() },
      { new: true, upsert: true }
    );
    res.json({ data: submission });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a submission (manager override)
app.delete("/submissions/:id", requireAuth, async (req, res) => {
  try {
    await connectDB();
    await Submission.findByIdAndDelete(req.params.id);
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC AVAILABILITY FORM
// Served at /availability — employees enter their PIN and submit availability.
// This is intentionally public (no auth) — the PIN is the only gate.
// ─────────────────────────────────────────────────────────────────────────────

app.get("/availability", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "availability.html"));
});

// PIN lookup — given a PIN, returns the matching employee (name + id only)
// so the form can show "Hi [name]" before submission.
app.post("/availability/lookup", async (req, res) => {
  try {
    await connectDB();
    const centerId = process.env.CENTER_ID;
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN required." });

    const employee = await Employee.findOne({ centerId, pin: pin.toString() });
    if (!employee) return res.status(404).json({ error: "No employee found with that PIN." });

    res.json({ data: { _id: employee._id, name: employee.name, priority: employee.priority } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/generate", requireAuth, (req, res) => {
  const { workers, studentData, oneOnOneData, mode } = req.body;

  const users = workers.map((w) => {
    const hoursAv = w.days.map((d) => {
      if (d.allDay) {
        const sat = d.day === "saturday";
        return [
          d.day,
          sat ? 10 : (w.defaultStart ?? (w.priority === 2 ? 3 : 4)),
          sat ? 14 : (w.defaultEnd ?? 8),
        ];
      }
      const start = d.start + ((d.startMinute || 0) === 30 ? 0.5 : 0);
      const end = d.end + ((d.endMinute || 0) === 30 ? 0.5 : 0);
      return [d.day, start, end];
    });
    const user = new User(w.name, hoursAv, w.submittedAt || null);
    if (w.priority) user.setPriority(w.priority);
    return user;
  });

  const isUltra = mode === "ultra";
  const week = isUltra ? new Week(users) : new SimplifiedWeek(users);

  if (studentData) {
    for (const day of week.week) {
      const dk = day.dayName.toLowerCase();
      const sdt = studentData[dk] || {};
      const odt = oneOnOneData ? oneOnOneData[dk] || {} : {};
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
      .filter(
        (w) =>
          w.working[w.days.indexOf(day.dayName.toLowerCase())][0] !== undefined,
      )
      .map((w) => {
        const di = w.days.indexOf(day.dayName.toLowerCase());
        return {
          name: w.name,
          start: w.working[di][0],
          end: w.working[di][1],
          priority: w.priority,
        };
      }),
  }));

  res.json({ schedule, text: "" });
});

// Warm up auth client on startup
try {
  const { getAuth } = require("./auth");
  getAuth();
} catch (err) {
  console.log("Auth warmup:", err.message);
}

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
