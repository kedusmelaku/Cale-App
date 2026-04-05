const { google } = require("googleapis");
const { getAuth }  = require("./auth");

const LESSON_KEYWORDS     = ["HS", "MS", "ES"];
const ONE_ON_ONE_KEYWORDS = ["1-on-1", "one-on-one"];

function classifyEvent(title) {
  if (!title) return "other";
  const lower = title.toLowerCase();
  if (ONE_ON_ONE_KEYWORDS.some((k) => lower.includes(k))) return "oneOnOne";
  if (LESSON_KEYWORDS.some((k) => title.includes(k))) return "lesson"; // case-sensitive for HS/MS/ES
  return "other";
}

function parseEventTime(dateTimeStr) {
  // Parse the local time directly from the string (e.g. "2026-04-07T16:00:00-05:00")
  // so it works regardless of what timezone the server is running in
  const [datePart, timePart] = dateTimeStr.split("T");
  const [hourStr, minuteStr] = timePart.split(":");
  const hour = parseInt(hourStr);
  const minute = parseInt(minuteStr);

  // Get the day from the date part directly, accounting for the UTC offset
  const date = new Date(dateTimeStr);
  const offsetMatch = dateTimeStr.match(/([+-]\d{2}):(\d{2})$/);
  let localDate;
  if (offsetMatch) {
    const offsetMins = parseInt(offsetMatch[1]) * 60 + parseInt(offsetMatch[2]);
    localDate = new Date(
      date.getTime() + offsetMins * 60000 - date.getTimezoneOffset() * 60000,
    );
  } else {
    localDate = date;
  }

  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "saturday",
  ];
  return { day: days[localDate.getDay()], hour, minute };
}

function toSlotTime(hour, minute, isSaturday) {
  let h = hour;
  if (isSaturday && h > 12) h -= 12;
  if (!isSaturday && h > 12) h -= 12; // ← add this line
  return minute >= 30 ? `${h}:30` : `${h}`;
}

async function getWeekEvents(mondayDate, calendarId = "primary") {
  const auth     = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const timeMin = new Date(mondayDate);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(mondayDate);
  timeMax.setDate(timeMax.getDate() + 6);
  timeMax.setHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.data.items || [];
  const validDays = ["monday","tuesday","wednesday","thursday","saturday"];
  const studentData  = Object.fromEntries(validDays.map((d) => [d, {}]));
  const oneOnOneData = Object.fromEntries(validDays.map((d) => [d, {}]));

  for (const event of events) {
    console.log(
      "EVENT:",
      event.summary,
      "|",
      event.start?.dateTime,
      "| type:",
      classifyEvent(event.summary),
    );
    if (!event.start?.dateTime) continue;
    const type = classifyEvent(event.summary);
    if (type === "other") continue;

    const { day, hour, minute } = parseEventTime(event.start.dateTime);
    if (!validDays.includes(day)) continue;

    const isSat    = day === "saturday";
    const slotTime = toSlotTime(hour, minute, isSat);

    if (type === "lesson") {
      studentData[day][slotTime] = (studentData[day][slotTime] || 0) + 1;
    } else {
      oneOnOneData[day][slotTime] = true;
      const nh = minute >= 30 ? hour + 1 : hour;
      const nm = minute >= 30 ? 0 : 30;
      oneOnOneData[day][toSlotTime(nh, nm, isSat)] = true;
    }
  }

  return { studentData, oneOnOneData };
}

module.exports = { getWeekEvents };
