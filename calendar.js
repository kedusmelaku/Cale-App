const { google } = require("googleapis");
const { getAuth } = require("./auth");

// Google Calendar → student/one-on-one counts bucketed by day and by canonical
// minute since midnight (24-hour). No AM/PM inference: the slot minute is taken
// straight from the event's local wall-clock time. The scheduling engine maps
// these onto whatever slots the center's config actually defines, so events
// outside operating hours are simply ignored downstream.
//
// Which keywords count as a lesson (vs a one-on-one, vs neither) is
// per-center config now — see CenterSettings.calendarKeywords, set via the
// admin UI. DEFAULT_LESSON_KEYWORDS/DEFAULT_ONE_ON_ONE_KEYWORDS below are
// only the fallback for centers that haven't configured this yet.

const DEFAULT_LESSON_KEYWORDS = ["HS", "MS", "ES"];
const DEFAULT_ONE_ON_ONE_KEYWORDS = ["1-on-1", "one-on-one"];
const DAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

// Both keyword lists default to case-insensitive matching, but each can be
// switched to case-sensitive independently (e.g. a center whose "HS" code
// keeps colliding with ordinary words can turn that back on for lessons).
function classifyEvent(
  title,
  lessonKeywords,
  oneOnOneKeywords,
  lessonCaseSensitive,
  oneOnOneCaseSensitive,
) {
  if (!title) return "other";
  const lower = title.toLowerCase();
  const matches = (keywords, caseSensitive) =>
    (keywords || []).some((k) =>
      caseSensitive ? title.includes(k) : lower.includes(k.toLowerCase()),
    );
  if (matches(oneOnOneKeywords, oneOnOneCaseSensitive)) return "oneOnOne";
  if (matches(lessonKeywords, lessonCaseSensitive)) return "lesson";
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

async function getWeekEvents(
  mondayDate,
  calendarId = "primary",
  lessonKeywords = DEFAULT_LESSON_KEYWORDS,
  oneOnOneKeywords = DEFAULT_ONE_ON_ONE_KEYWORDS,
  lessonCaseSensitive = false,
  oneOnOneCaseSensitive = false,
) {
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
    const type = classifyEvent(
      event.summary,
      lessonKeywords,
      oneOnOneKeywords,
      lessonCaseSensitive,
      oneOnOneCaseSensitive,
    );
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

// Validates keyword config coming from the admin UI. Returns an error string
// (safe to show the admin) or null if valid. lessonKeywords must have at
// least one entry; oneOnOneKeywords may be empty (not every center runs
// one-on-ones).
function validateCalendarKeywords(kw) {
  if (!kw || typeof kw !== "object") return "Calendar keyword data is missing.";
  const lessonKeywords = Array.isArray(kw.lessonKeywords) ? kw.lessonKeywords : [];
  const oneOnOneKeywords = Array.isArray(kw.oneOnOneKeywords) ? kw.oneOnOneKeywords : [];
  const cleanLesson = lessonKeywords.map((k) => String(k).trim()).filter(Boolean);
  if (cleanLesson.length === 0) return "Add at least one lesson keyword.";
  for (const k of [...lessonKeywords, ...oneOnOneKeywords]) {
    if (typeof k !== "string") return "Keywords must be text.";
  }
  return null;
}

// Cleans a keyword config: trims, drops empties, and dedupes — each list
// dedupes according to its OWN case-sensitivity flag, since "HS" and "hs"
// are meaningfully different entries once a list is case-sensitive.
function normalizeCalendarKeywords(kw) {
  const dedupe = (arr, caseSensitive) => {
    const seen = new Set();
    const out = [];
    for (const raw of arr || []) {
      const s = String(raw).trim();
      if (!s) continue;
      const key = caseSensitive ? s : s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  };
  const lessonCaseSensitive = !!kw.lessonCaseSensitive;
  const oneOnOneCaseSensitive = !!kw.oneOnOneCaseSensitive;
  return {
    lessonKeywords: dedupe(kw.lessonKeywords, lessonCaseSensitive),
    oneOnOneKeywords: dedupe(kw.oneOnOneKeywords, oneOnOneCaseSensitive),
    lessonCaseSensitive,
    oneOnOneCaseSensitive,
  };
}

module.exports = {
  getWeekEvents,
  DEFAULT_LESSON_KEYWORDS,
  DEFAULT_ONE_ON_ONE_KEYWORDS,
  validateCalendarKeywords,
  normalizeCalendarKeywords,
};
