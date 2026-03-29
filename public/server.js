const express = require("express");
const path = require("path");
const User = require("../User");
const SimplifiedWeek = require("../SimplifiedWeek");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post("/generate", (req, res) => {
  const { workers } = req.body;

  // build users from frontend data
  const users = workers.map((w) => {
    const hoursAv = w.days.map((d) => {
      if (d.allDay) return [d.day]; // no hours specified, use defaults
      return [d.day, d.start, d.end];
    });
    const user = new User(w.name, hoursAv);
    if (w.priority) user.setPriority(w.priority);
    return user;
  });

  const week = new SimplifiedWeek(users);
  week.createSchedule();

  // build response — one entry per day per worker
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
    return {
      day: day.dayName,
      assignments,
    };
  });

  // build plain text for clipboard
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
