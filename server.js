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
const OAuthToken = require("./OAuthToken");
const Center = require("./Center");
const mongoose = require("mongoose");
const {
  defaultSchedule,
  getActiveVariant,
  resolveActiveName,
  validateSchedule,
  normalizeSchedule,
  variantToDayConfigs,
} = require("./scheduleConfig");

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET env var is not set");
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.error("FATAL: ADMIN_PASSWORD env var is not set");
  process.exit(1);
}
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);

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
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.centerId = payload.centerId;
      return next();
    } catch {
      /* invalid or expired — fall through */
    }
  }
  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"))
  ) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  res.redirect("/login");
}

// Admin-only middleware — uses a separate ADMIN_PASSWORD, no centerId needed
function requireAdmin(req, res, next) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.admin) return next();
    } catch {}
  }
  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"))
  ) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  res.redirect("/admin/login");
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get("/login", (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.centerId) return res.redirect("/");
    } catch {}
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
    await connectDB();
    const { centerId, password } = req.body;
    if (!centerId || !password)
      return res
        .status(400)
        .json({ error: "Center ID and password required." });

    const center = await Center.findOne({
      centerId: centerId.trim().toLowerCase(),
    });
    if (!center)
      return res
        .status(401)
        .json({ error: "Incorrect Center ID or password." });

    const match = await bcrypt.compare(password, center.passwordHash);
    if (!match)
      return res
        .status(401)
        .json({ error: "Incorrect Center ID or password." });

    const token = jwt.sign(
      { centerId: center.centerId },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.setHeader(
      "Set-Cookie",
      `token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("/api/login:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post("/api/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
  );
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
    await connectDB();
    const { getAuth, applyTokens } = require("./auth");
    const auth = getAuth();
    const { tokens } = await auth.getToken(code);
    await applyTokens(req.centerId, tokens);

    // Connection is now persisted in MongoDB — no manual env var step needed.
    res.send(`<!doctype html><html><head><title>Connected</title>
<style>
  body{font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;background:#f5f5f2;}
  h2{color:#217a4a;}
  .done{color:#217a4a;font-weight:bold;margin-top:20px;}
  .muted{color:#666;}
</style></head><body>
<h2>✅ Google Calendar connected!</h2>
<p>Cale is connected and ready. This connection is saved and will
persist automatically — there's nothing else you need to do.</p>
<p class="done">You can close this tab and return to the app.</p>
<p class="muted">This tab will try to close itself in a moment.</p>
<script>
  // Notify the original tab (dashboard/scheduler) that OAuth succeeded so it
  // can refresh its calendar status, then try to close this tab automatically.
  (function () {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'oauth_success' }, '*');
        setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
      }
    } catch (e) {}
  })();
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
app.get("/cal-status", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { getAuth, loadTokensFromDB } = require("./auth");
    await loadTokensFromDB(req.centerId);
    const auth = getAuth();
    const creds = auth.credentials;
    const connected = !!(creds && (creds.access_token || creds.refresh_token));
    res.json({ connected });
  } catch {
    res.json({ connected: false });
  }
});

app.post("/oauth/disconnect", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { clearTokens } = require("./auth");
    await clearTokens(req.centerId);
    res.json({ disconnected: true });
  } catch (err) {
    console.error("/oauth/disconnect:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALENDARS — lists every calendar the authenticated account can see, so the
// user can pick which one Cale reads student bookings from.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/calendars", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { google } = require("googleapis");
    const { getAuth, loadTokensFromDB } = require("./auth");
    await loadTokensFromDB(req.centerId);
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
  // Keyed by dayKey then canonical minute since midnight (24-hour), matching
  // the default operating slots (Mon–Thu 3–8 PM = 900–1170, Sat 10–2 = 600–810).
  res.json({
    studentData: {
      monday: {
        960: 3,
        990: 4,
        1020: 6,
        1050: 5,
        1080: 4,
        1110: 3,
        1140: 2,
        1170: 1,
      },
      tuesday: {
        960: 2,
        990: 3,
        1020: 5,
        1050: 6,
        1080: 5,
        1110: 4,
        1140: 3,
        1170: 2,
      },
      wednesday: {
        900: 1,
        930: 2,
        960: 4,
        990: 5,
        1020: 4,
        1050: 3,
        1080: 5,
        1110: 6,
        1140: 3,
      },
      thursday: {
        960: 3,
        990: 5,
        1020: 6,
        1050: 5,
        1080: 4,
        1110: 6,
        1140: 4,
        1170: 2,
      },
      saturday: {
        600: 4,
        630: 5,
        660: 6,
        690: 5,
        720: 4,
        750: 3,
        780: 4,
        810: 3,
      },
    },
    oneOnOneData: {
      monday: { 1020: true, 1050: true },
      tuesday: {},
      wednesday: { 1080: true, 1110: true },
      thursday: {},
      saturday: { 660: true, 690: true },
    },
  });
});

app.get("/events", requireAuth, async (req, res) => {
  const { monday, calendarId } = req.query;
  if (!monday) return res.status(400).json({ error: "monday date required" });
  try {
    await connectDB();
    const { loadTokensFromDB } = require("./auth");
    await loadTokensFromDB(req.centerId);
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
app.get("/employees", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const result = await Employee.find({ centerId: req.centerId });
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/employees", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const employee = new Employee({ ...req.body, centerId: req.centerId });
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
    const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
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
    let doc = await CenterSettings.findOne({ centerId: req.centerId });
    if (!doc)
      doc = {
        centerId: req.centerId,
        windowOpen: null,
        windowClose: null,
        tutorialCompleted: false,
        introSeen: false,
      };
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/center-settings", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const doc = await CenterSettings.findOneAndUpdate(
      { centerId: req.centerId },
      { ...req.body, centerId: req.centerId },
      { new: true, upsert: true },
    );
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public read-only center settings — used by the availability form (no auth)
app.get("/center-settings/:centerId", async (req, res) => {
  try {
    await connectDB();
    const { centerId } = req.params;
    let doc = await CenterSettings.findOne({ centerId });
    if (!doc)
      doc = {
        centerId,
        windowOpen: null,
        windowClose: null,
        tutorialCompleted: false,
        introSeen: false,
      };
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
    const query = { centerId: req.centerId };
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
    const { centerId, employeeId, employeeName, weekOf, days } = req.body;

    if (!centerId || !employeeId || !weekOf || !days) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Check submission window is currently open
    const settings = await CenterSettings.findOne({ centerId });
    const now = new Date();
    if (settings && settings.windowOpen && settings.windowClose) {
      if (
        now < new Date(settings.windowOpen) ||
        now > new Date(settings.windowClose)
      ) {
        return res
          .status(403)
          .json({ error: "The availability window is not currently open." });
      }
    }

    // Upsert — replace any existing submission for this employee+week
    const submission = await Submission.findOneAndUpdate(
      { centerId, employeeId, weekOf },
      {
        centerId,
        employeeId,
        employeeName,
        weekOf,
        days,
        submittedAt: new Date(),
      },
      { new: true, upsert: true },
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
// Served at /availability/:centerId — employees enter their PIN and submit.
// ─────────────────────────────────────────────────────────────────────────────

app.get("/availability/:centerId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "availability.html"));
});

// PIN lookup — given a PIN and centerId, returns the matching employee
app.post("/availability/lookup", async (req, res) => {
  try {
    await connectDB();
    const { pin, centerId } = req.body;
    if (!pin || !centerId)
      return res.status(400).json({ error: "PIN and center ID required." });

    const employee = await Employee.findOne({ centerId, pin: pin.toString() });
    if (!employee)
      return res
        .status(404)
        .json({ error: "No employee found with that PIN." });

    res.json({
      data: {
        _id: employee._id,
        name: employee.name,
        priority: employee.priority,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { workers, studentData, oneOnOneData, mode } = req.body;

    // Build the week from the center's active operating schedule.
    const settings = await CenterSettings.findOne({ centerId: req.centerId });
    const schedule = (settings && settings.schedule) || defaultSchedule();
    const { variant } = getActiveVariant(schedule);
    const dayConfigs = variantToDayConfigs(variant);

    // Workers arrive with availability as per-day blocks in canonical minutes:
    //   days: [ { day, blocks: [{start,end}] } ]
    const users = (workers || []).map((w) => {
      const user = new User(w.name, w.days || [], w.submittedAt || null);
      if (w.priority) user.setPriority(w.priority);
      return user;
    });

    const isUltra = mode === "ultra";
    const week = isUltra
      ? new Week(users, dayConfigs)
      : new SimplifiedWeek(users, dayConfigs);

    if (studentData) {
      // studentData / oneOnOneData are keyed by dayKey then canonical minute.
      for (const day of week.week) {
        const sdt = studentData[day.dayKey] || {};
        const odt = oneOnOneData ? oneOnOneData[day.dayKey] || {} : {};
        for (const slot of day.slots) {
          slot.students = sdt[slot.time] || 0;
          slot.oneOnOne = !!odt[slot.time];
        }
      }
      const tmp = isUltra ? new Day() : new SimplifiedDay();
      tmp.canWork(week.week, users);
      tmp.willWork(week.week);
    } else {
      week.createSchedule();
    }

    const scheduleOut = week.week.map((day, i) => {
      const assignments = [];
      for (const w of day.totalWorkers) {
        const di = w.days.indexOf(day.dayKey);
        for (const shift of w.working[di] || []) {
          assignments.push({
            name: w.name,
            start: shift.start, // canonical minutes
            end: shift.end,
            priority: w.priority,
          });
        }
      }
      return {
        dayKey: day.dayKey,
        dayName: day.dayName,
        blocks: dayConfigs[i].blocks,
        slots: dayConfigs[i].slots,
        assignments,
      };
    });

    res.json({ schedule: scheduleOut, text: "" });
  } catch (err) {
    console.error("/generate:", err.message);
    res.status(500).json({ error: "Could not generate the schedule." });
  }
});

// Returns the centerId for the currently logged-in manager — used by the
// dashboard to construct the center-specific availability link.
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const center = await Center.findOne(
      { centerId: req.centerId },
      { name: 1 },
    );
    res.json({
      centerId: req.centerId,
      centerName: center ? center.name : req.centerId,
    });
  } catch {
    res.json({ centerId: req.centerId, centerName: req.centerId });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — super-manager routes, protected by ADMIN_PASSWORD env var
// Only used by you to create/manage centers. Centers cannot access these.
// ─────────────────────────────────────────────────────────────────────────────

app.get("/admin/login", (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.admin) return res.redirect("/admin");
    } catch {}
  }
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required." });
    const match = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!match) return res.status(401).json({ error: "Incorrect password." });
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.setHeader(
      "Set-Cookie",
      `token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("/api/admin/login:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// List all centers
app.get("/api/admin/centers", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const centers = await Center.find({}, { passwordHash: 0 }); // never send hashes
    res.json({ data: centers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new center
app.post("/api/admin/centers", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { centerId, name, password } = req.body;
    if (!centerId || !name || !password) {
      return res
        .status(400)
        .json({ error: "centerId, name, and password are required." });
    }
    const existing = await Center.findOne({
      centerId: centerId.trim().toLowerCase(),
    });
    if (existing)
      return res
        .status(409)
        .json({ error: "A center with that ID already exists." });

    // Schedule is set at creation. Fall back to the default (which reproduces
    // the app's original Mon–Thu 3–8 / Sat 10–2 behavior) if none was sent.
    let schedule = req.body.schedule || defaultSchedule();
    const schedErr = validateSchedule(schedule);
    if (schedErr) return res.status(400).json({ error: schedErr });
    schedule = normalizeSchedule(schedule);

    const cleanId = centerId.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);
    const center = new Center({ centerId: cleanId, name, passwordHash });
    await center.save();

    // Create the settings document up front so the schedule exists immediately.
    await CenterSettings.findOneAndUpdate(
      { centerId: cleanId },
      { centerId: cleanId, schedule },
      { upsert: true, new: true },
    );

    res.json({ data: { centerId: center.centerId, name: center.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a center's name or password
app.put("/api/admin/centers/:centerId", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { name, password } = req.body;
    const update = {};
    if (name) update.name = name;
    if (password) update.passwordHash = await bcrypt.hash(password, 10);
    const center = await Center.findOneAndUpdate(
      { centerId: req.params.centerId },
      update,
      { new: true, projection: { passwordHash: 0 } },
    );
    if (!center) return res.status(404).json({ error: "Center not found." });
    res.json({ data: center });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a center (and all its data)
app.delete("/api/admin/centers/:centerId", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { centerId } = req.params;
    await Center.deleteOne({ centerId });
    await Employee.deleteMany({ centerId });
    await Submission.deleteMany({ centerId });
    await CenterSettings.deleteOne({ centerId });
    await OAuthToken.deleteOne({ centerId });
    res.json({ deleted: centerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Center detail view — returns everything the admin needs in one call
app.get(
  "/api/admin/centers/:centerId/details",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;

      const center = await Center.findOne({ centerId }, { passwordHash: 0 });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const employees = await Employee.find({ centerId });
      const settings = await CenterSettings.findOne({ centerId });
      const oauthDoc = await OAuthToken.findOne({ centerId });

      // Current week's Monday (same logic as the frontend uses)
      const now = new Date();
      const day = now.getDay();
      const diffToMon = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMon);
      const weekOf = monday.toISOString().slice(0, 10);

      const submissions = await Submission.find({ centerId, weekOf }).sort({
        submittedAt: 1,
      });
      const lastSub =
        submissions.length > 0
          ? submissions[submissions.length - 1].submittedAt
          : null;

      // Also check last submission across all weeks for "last activity"
      const anyLastSub = await Submission.findOne({ centerId }).sort({
        submittedAt: -1,
      });

      res.json({
        data: {
          center,
          employees: employees.map((e) => ({
            _id: e._id,
            name: e.name,
            priority: e.priority,
            hasPin: !!(e.pin && e.pin.trim()),
            pin: e.pin,
          })),
          settings: settings || null,
          tutorialCompleted: !!(settings && settings.tutorialCompleted),
          introSeen: !!(settings && settings.introSeen),
          calendarConnected: !!(
            oauthDoc &&
            oauthDoc.token &&
            (oauthDoc.token.access_token || oauthDoc.token.refresh_token)
          ),
          weekOf,
          submissionCount: submissions.length,
          lastActivityAt: anyLastSub ? anyLastSub.submittedAt : null,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

app.put(
  "/api/admin/centers/:centerId/intro",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const { introSeen } = req.body;

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, introSeen: !!introSeen },
        { new: true, upsert: true },
      );

      res.json({
        data: { centerId, introSeen: !!doc.introSeen },
      });
    } catch (err) {
      console.error("PUT intro status:", err.message);
      res.status(500).json({ error: "Could not update intro status." });
    }
  },
);

app.put(
  "/api/admin/centers/:centerId/tutorial",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const { tutorialCompleted } = req.body;

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, tutorialCompleted: !!tutorialCompleted },
        { new: true, upsert: true },
      );

      res.json({
        data: { centerId, tutorialCompleted: !!doc.tutorialCompleted },
      });
    } catch (err) {
      console.error("PUT tutorial status:", err.message);
      res.status(500).json({ error: "Could not update tutorial status." });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

// Admin: read a center's full schedule config (both variants).
app.get(
  "/api/admin/centers/:centerId/schedule",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const center = await Center.findOne({ centerId });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const settings = await CenterSettings.findOne({ centerId });
      const schedule = (settings && settings.schedule) || defaultSchedule();
      res.json({
        data: { schedule, activeVariant: resolveActiveName(schedule) },
      });
    } catch (err) {
      console.error("GET schedule:", err.message);
      res.status(500).json({ error: "Could not load the schedule." });
    }
  },
);

// Admin: save a center's full schedule config.
app.put(
  "/api/admin/centers/:centerId/schedule",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const center = await Center.findOne({ centerId });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const schedErr = validateSchedule(req.body.schedule);
      if (schedErr) return res.status(400).json({ error: schedErr });
      const schedule = normalizeSchedule(req.body.schedule);

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, schedule },
        { new: true, upsert: true },
      );
      res.json({
        data: {
          schedule: doc.schedule,
          activeVariant: resolveActiveName(doc.schedule),
        },
      });
    } catch (err) {
      console.error("PUT schedule:", err.message);
      res.status(500).json({ error: "Could not save the schedule." });
    }
  },
);

// Manager-facing: the current center's resolved active operating schedule.
// Used by the dashboard and scheduler to build days/hours dynamically.
app.get("/center-schedule", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const settings = await CenterSettings.findOne({ centerId: req.centerId });
    const schedule = (settings && settings.schedule) || defaultSchedule();
    const { name, variant } = getActiveVariant(schedule);
    res.json({ data: { activeVariant: name, days: variant, schedule } });
  } catch (err) {
    console.error("GET /center-schedule:", err.message);
    res.status(500).json({ error: "Could not load the schedule." });
  }
});

// Public: resolved active operating schedule for a center. Used by the
// availability form (no auth) so employees only see days/hours the center runs.
app.get("/center-schedule/:centerId", async (req, res) => {
  try {
    await connectDB();
    const { centerId } = req.params;
    const settings = await CenterSettings.findOne({ centerId });
    const schedule = (settings && settings.schedule) || defaultSchedule();
    const { name, variant } = getActiveVariant(schedule);
    res.json({ data: { activeVariant: name, days: variant } });
  } catch (err) {
    console.error("GET /center-schedule/:centerId:", err.message);
    res.status(500).json({ error: "Could not load the schedule." });
  }
});

// Warm up auth client on startup
try {
  const { getAuth } = require("./auth");
  getAuth();
} catch (err) {
  console.log("Auth warmup:", err.message);
}

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
