const express = require("express");
const path = require("path");
const User = require("./User");
const SimplifiedWeek = require("./SimplifiedWeek");
const SimplifiedDay = require("./SimplifiedDay");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── /events/mock ───────────────────────────────────────────────────────────
app.get("/events/mock", (req, res) => {
  const studentData = {
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
  };
  const oneOnOneData = {
    monday: { 5: true, "5:30": true },
    tuesday: {},
    wednesday: { 6: true, "6:30": true },
    thursday: {},
    saturday: { 11: true, "11:30": true },
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
    const { studentData, oneOnOneData } = await getWeekEvents(
      mondayDate,
      calendarId || "primary",
    );
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

// ── /generate ──────────────────────────────────────────────────────────────
app.post("/generate", (req, res) => {
  const { workers, studentData, oneOnOneData } = req.body;

  const users = workers.map((w) => {
    const hoursAv = w.days.map((d) => {
      if (d.allDay) {
        // Use the worker's stored default hours rather than letting User.js
        // fall back to its hardcoded 4-8 default. This ensures high-priority
        // workers (defaultStart: 3) actually start at 3.
        const isSaturday = d.day === "saturday";
        const defaultStart = isSaturday
          ? 10
          : (w.defaultStart ?? (w.priority === 2 ? 3 : 4));
        const defaultEnd = isSaturday ? 14 : (w.defaultEnd ?? 8);
        return [d.day, defaultStart, defaultEnd];
      }
      // support half-hour start/end via startMinute/endMinute
      const start = d.start + ((d.startMinute || 0) === 30 ? 0.5 : 0);
      const end = d.end + ((d.endMinute || 0) === 30 ? 0.5 : 0);
      return [d.day, start, end];
    });
    const user = new User(w.name, hoursAv);
    if (w.priority) user.setPriority(w.priority);
    return user;
  });

  const week = new SimplifiedWeek(users);

  if (studentData) {
    for (const day of week.week) {
      const dayKey = day.dayName.toLowerCase();
      const daySData = studentData[dayKey] || {};
      const dayOData = oneOnOneData ? oneOnOneData[dayKey] || {} : {};
      for (const slot of day.slots) {
        slot.students = daySData[slot.time] || 0;
        slot.oneOnOne = dayOData[slot.time] || false;
      }
    }
    const tempDay = new SimplifiedDay("");
    tempDay.canWork(week.week, users);
    tempDay.willWork(week.week);
  } else {
    week.createSchedule();
  }

  const schedule = week.week.map((day) => {
    const assignments = [];
    for (let worker of day.totalWorkers) {
      let di = worker.days.indexOf(day.dayName.toLowerCase());
      if (worker.working[di][0] === undefined) continue;
      assignments.push({
        name: worker.name,
        start: worker.working[di][0],
        end: worker.working[di][1],
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
