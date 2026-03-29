const { google } = require('googleapis');
const { auth } = require('./auth');

const calendar = google.calendar({ version: 'v3', auth });

// keywords that identify a student lesson event
// add to this list once you see real event formats
const LESSON_KEYWORDS = ['lesson', 'class', 'training', 'session'];
const ONE_ON_ONE_KEYWORDS = ['one on one', '1 on 1', '1on1'];

// classify an event title
function classifyEvent(title) {
  if (!title) return 'other';
  const lower = title.toLowerCase();
  if (ONE_ON_ONE_KEYWORDS.some(k => lower.includes(k))) return 'oneOnOne';
  if (LESSON_KEYWORDS.some(k => lower.includes(k))) return 'lesson';
  return 'other';
}

// parse a dateTime string into { day, hour, minute }
function parseEventTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return {
    day: days[date.getDay()],
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

// convert hour/minute to a slot time string matching Day.js slot format
// slots are every 30 min. times < 13 are kept as-is, times >= 13 are converted to 12hr for saturday
function toSlotTime(hour, minute, isSaturday) {
  let h = hour;
  if (isSaturday && h > 12) h = h - 12;
  return minute >= 30 ? `${h}:30` : `${h}`;
}

// fetch and classify events for a given week
// mondayDate: JS Date object representing the Monday of the week
// calendarId: which calendar to fetch from (default 'primary')
async function getWeekEvents(mondayDate, calendarId = 'primary') {
  // week runs Monday to Saturday (end of Saturday)
  const timeMin = new Date(mondayDate);
  timeMin.setHours(0, 0, 0, 0);

  const timeMax = new Date(mondayDate);
  timeMax.setDate(timeMax.getDate() + 6); // Saturday
  timeMax.setHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];

  // build studentData: { monday: { "4": 2, "4:30": 1, ... }, tuesday: {...}, ... }
  // and oneOnOneData: { monday: { "4": true, ... }, ... }
  const studentData = {};
  const oneOnOneData = {};

  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'saturday'];
  for (const day of validDays) {
    studentData[day] = {};
    oneOnOneData[day] = {};
  }

  for (const event of events) {
    if (!event.start || !event.start.dateTime) continue; // skip all-day events
    const type = classifyEvent(event.summary);
    if (type === 'other') continue; // not a student event

    const { day, hour, minute } = parseEventTime(event.start.dateTime);
    if (!validDays.includes(day)) continue; // not a scheduled day

    const isSat = day === 'saturday';
    const slotTime = toSlotTime(hour, minute, isSat);

    if (type === 'lesson') {
      studentData[day][slotTime] = (studentData[day][slotTime] || 0) + 1;
    } else if (type === 'oneOnOne') {
      oneOnOneData[day][slotTime] = true;
      // also flag the next 30-min slot since one on ones are 1 hour
      const nextHour = minute >= 30 ? hour + 1 : hour;
      const nextMinute = minute >= 30 ? 0 : 30;
      const nextSlot = toSlotTime(nextHour, nextMinute, isSat);
      oneOnOneData[day][nextSlot] = true;
    }
  }

  return { studentData, oneOnOneData };
}

module.exports = { getWeekEvents };
