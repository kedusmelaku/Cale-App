const express = require("express");
const path = require("path");
const { auth, saveToken } = require("./auth");
const User = require("./User");
const SimplifiedWeek = require("./SimplifiedWeek");

const app = express();
app.use(express.json());
// ── /oauth/callback ────────────────────────────────────────────────────────
// Google redirects here after the user approves access.
// Exchanges the code for a token and saves it.
app.get("/oauth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing authorization code.");
  try {
    const { auth, saveToken } = require("./auth");
    const { tokens } = await auth.getToken(code);
    saveToken(tokens);
    res.send(`
      <html><body style="font-family:sans-serif; padding:40px;">
        <h2>✅ Authorization successful</h2>
        <p>Google Calendar access has been granted. You can close this tab and return to the app.</p>
        <p><a href="http://localhost:3000">Go back to Scheduler</a></p>
      </body></html>
    `);
  } catch (err) {
    console.error("OAuth error:", err.message);
    res.status(500).send("Authorization failed: " + err.message);
  }
});
app.use(express.static(path.join(__dirname, "public")));

// ── /events/mock ───────────────────────────────────────────────────────────
// Returns fake student data mimicking what the real /events route would return.
// Switch the frontend to fetch /events/mock instead of /events to use this.
app.get("/events/mock", (req, res) => {
  const studentData = {
    monday: {
      "4": 3, "4:30": 4, "5": 6, "5:30": 5, "6": 4, "6:30": 3, "7": 2, "7:30": 1
    },
    tuesday: {
      "4": 2, "4:30": 3, "5": 5, "5:30": 6, "6": 5, "6:30": 4, "7": 3, "7:30": 2
    },
    wednesday: {
      "3": 1, "3:30": 2, "4": 4, "4:30": 5, "5": 4, "5:30": 3, "6": 5, "6:30": 6, "7": 3
    },
    thursday: {
      "4": 3, "4:30": 5, "5": 6, "5:30": 5, "6": 4, "6:30": 6, "7": 4, "7:30": 2
    },
    saturday: {
      "10": 4, "10:30": 5, "11": 6, "11:30": 5, "12": 4, "12:30": 3, "1": 4, "1:30": 3
    },
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
// Fetches and classifies calendar events for the selected week.
// Returns studentData and oneOnOneData keyed by day name.
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
    // auth errors come through as 401 or with specific messages
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

// ── /generate ──────────────────────────────────────────────────────────────
// Accepts workers and optional studentData/oneOnOneData from the frontend.
// If studentData is provided, uses it instead of random numbers.
app.post("/generate", (req, res) => {
  const { workers, studentData, oneOnOneData } = req.body;

  // build users from frontend data
  const users = workers.map((w) => {
    const hoursAv = w.days.map((d) => {
      if (d.allDay) return [d.day];
      return [d.day, d.start, d.end];
    });
    const user = new User(w.name, hoursAv);
    if (w.priority) user.setPriority(w.priority);
    return user;
  });

  const week = new SimplifiedWeek(users);

  if (studentData) {
    // apply calendar data to slots instead of random numbers
    for (const day of week.week) {
      const dayKey = day.dayName.toLowerCase();
      const daySData = studentData[dayKey] || {};
      const dayOData = oneOnOneData ? (oneOnOneData[dayKey] || {}) : {};

      for (const slot of day.slots) {
        slot.students = daySData[slot.time] || 0;
        slot.oneOnOne = dayOData[slot.time] || false;
      }
    }

    // run schedule without addStudents()
    const tempDay = new (require("./SimplifiedDay"))("");
    tempDay.canWork(week.week, users);
    tempDay.willWork(week.week);
  } else {
    // fall back to random student counts
    week.createSchedule();
  }

  // build response
  const schedule = week.week.map((day) => {
    const assignments = [];
    for (let worker of day.totalWorkers) {
      let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
      if (worker.working[dayIndex][0] === undefined) continue;
      assignments.push({
        name: worker.name,
        start: worker.working[dayIndex][0],
        end: worker.working[dayIndex][1],
        priority: worker.priority,
      });
    }
    return { day: day.dayName, assignments };
  });

  // build plain text
  let text = "";
  for (let day of week.week) {
    let hasWorkers = day.totalWorkers.some((w) => {
      let di = w.days.indexOf(day.dayName.toLowerCase());
      return w.working[di][0] !== undefined;
    });
    if (!hasWorkers) continue;
    text += `Hours for ${day.dayName}:\n`;
    for (let worker of day.totalWorkers) {
      let di = worker.days.indexOf(day.dayName.toLowerCase());
      if (worker.working[di][0] === undefined) continue;
      let name = worker.name.charAt(0).toUpperCase() + worker.name.slice(1);
      text += `${name}: ${worker.working[di][0]}-${worker.working[di][1]}\n`;
    }
    text += "\n";
  }

  res.json({ schedule, text });
});

app.listen(3000, () => console.log("Running on http://localhost:3000"));
