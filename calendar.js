const { google } = require("googleapis");
const { getAuth } = require("./auth");

// Google Calendar → student/one-on-one counts bucketed by day and by canonical
// minute since midnight (24-hour). No AM/PM inference: the slot minute is taken
// straight from the event's local wall-clock time. The scheduling engine maps
// these onto whatever slots the center's config actually defines, so events
// outside operating hours are simply ignored downstream.

const LESSON_KEYWORDS = ["HS", "MS", "ES"];
const ONE_ON_ONE_KEYWORDS = ["1-on-1", "one-on-one"];
const DAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

function classifyEvent(title) {
  if (!title) return "other";
  const lower = title.toLowerCase();
  if (ONE_ON_ONE_KEYWORDS.some((k) => lower.includes(k))) return "oneOnOne";
  if (LESSON_KEYWORDS.some((k) => title.includes(k))) return "lesson"; // case-sensitive HS/MS/ES
  return "other";
}

// Returns { day: "monday", minutes: <canonical minutes since midnight> }.
// hour/minute come directly from the local wall-clock in the dateTime string;
// the UTC offset is only used to resolve the day of week.
function parseEventTime(dateTimeStr) {
  const [, timePart] = dateTimeStr.split("T");
  const [hourStr, minuteStr] = timePart.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const date = new Date(dateTimeStr);
  const offsetMatch = dateTimeStr.match(/([+-]\d{2}):(\d{2})$/);
  let localDate;
  if (offsetMatch) {
    const offsetMins = parseInt(offsetMatch[1], 10) * 60 + parseInt(offsetMatch[2], 10);
    localDate = new Date(
      date.getTime() + offsetMins * 60000 - date.getTimezoneOffset() * 60000,
    );
  } else {
    localDate = date;
  }

  return { day: DAYS[localDate.getDay()], minutes: hour * 60 + minute };
}

// Floors a canonical minute to its 30-minute slot start.
function toSlot(minutes) {
  return Math.floor(minutes / 30) * 30;
}

async function getWeekEvents(mondayDate, calendarId = "primary") {
  const auth = getAuth();
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
  const studentData = {};
  const oneOnOneData = {};
  for (const d of DAYS) {
    studentData[d] = {};
    oneOnOneData[d] = {};
  }

  for (const event of events) {
    if (!event.start?.dateTime) continue;
    const type = classifyEvent(event.summary);
    if (type === "other") continue;

    const { day, minutes } = parseEventTime(event.start.dateTime);
    const slot = toSlot(minutes);

    if (type === "lesson") {
      // All lessons are 60 min → occupy this slot and the next half hour.
      studentData[day][slot] = (studentData[day][slot] || 0) + 1;
      studentData[day][slot + 30] = (studentData[day][slot + 30] || 0) + 1;
    } else {
      oneOnOneData[day][slot] = true;
      oneOnOneData[day][slot + 30] = true;
    }
  }

  return { studentData, oneOnOneData };
}

module.exports = { getWeekEvents };
