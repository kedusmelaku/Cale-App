// pull_calendar.js — RUN THIS IN YOUR REPO ROOT (beside server.js/auth.js/calendar.js).
//
//   MONGODB_URI=...  GOOGLE_CREDENTIALS=...  CENTER_ID=<Patrick's centerId> \
//     node pull_calendar.js
//
// It reuses the app's OWN modules (auth.loadTokensFromDB + calendar.getWeekEvents),
// so the classification here is identical to what /events and /generate use — no
// separate keyword logic to drift out of sync. Reads the week list straight from
// rosters.json (place it beside this script) so it pulls exactly the 49 weeks we
// have rosters for, and writes calendar_pull.json for compute_demand.js.
//
// Env:
//   MONGODB_URI         (required) same as the app
//   GOOGLE_CREDENTIALS  (required) same as the app — auth.js reads it
//   CENTER_ID           (required) Patrick's centerId in your DB
//   CALENDAR_ID         (optional) defaults to arlingtonheights@mathnasium.com
//   ROSTERS / OUT       (optional) file paths

const fs = require("fs");
const mongoose = require("mongoose");
const { loadTokensFromDB } = require("./auth");
const {
  getWeekEvents,
  DEFAULT_LESSON_KEYWORDS,
  DEFAULT_ONE_ON_ONE_KEYWORDS,
} = require("./calendar");
const CenterSettings = require("./CenterSettings");

const CENTER_ID = process.env.CENTER_ID;
const CALENDAR_ID = process.env.CALENDAR_ID || "arlingtonheights@mathnasium.com";
const ROSTERS = process.env.ROSTERS || "rosters.json";
const OUT = process.env.OUT || "calendar_pull.json";

(async () => {
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI.");
  if (!CENTER_ID) throw new Error("Set CENTER_ID to Patrick's centerId.");

  await mongoose.connect(process.env.MONGODB_URI);
  await loadTokensFromDB(CENTER_ID); // primes the shared auth client with the stored token

  const settings = await CenterSettings.findOne({ centerId: CENTER_ID });
  const schedule = (settings && settings.schedule) || null; // null => compute step uses defaults
  const kw = settings && settings.calendarKeywords;
  // Mirror /events exactly: a configured-but-empty one-on-one list means "we
  // don't run those", NOT fall back to defaults.
  const lessonKeywords =
    kw && kw.lessonKeywords && kw.lessonKeywords.length ? kw.lessonKeywords : DEFAULT_LESSON_KEYWORDS;
  const oneOnOneKeywords = kw ? kw.oneOnOneKeywords || [] : DEFAULT_ONE_ON_ONE_KEYWORDS;
  const lessonCaseSensitive = kw ? !!kw.lessonCaseSensitive : false;
  const oneOnOneCaseSensitive = kw ? !!kw.oneOnOneCaseSensitive : false;

  const rosters = JSON.parse(fs.readFileSync(ROSTERS, "utf8"));
  const mondays = Object.keys(rosters.weeks).sort();

  const weeks = {};
  for (const monday of mondays) {
    try {
      const { studentData, oneOnOneData } = await getWeekEvents(
        new Date(monday + "T00:00:00"),
        CALENDAR_ID,
        lessonKeywords,
        oneOnOneKeywords,
        lessonCaseSensitive,
        oneOnOneCaseSensitive,
      );
      weeks[monday] = { studentData, oneOnOneData };
      const n = Object.values(studentData).reduce((a, d) => a + Object.keys(d).length, 0);
      console.error(`pulled ${monday}  (${n} lesson slot-hits)`);
    } catch (e) {
      console.error(`FAILED ${monday}: ${e.message}`);
      weeks[monday] = { error: e.message };
    }
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        centerId: CENTER_ID,
        calendarId: CALENDAR_ID,
        schedule,
        calendarKeywords: kw || {
          lessonKeywords,
          oneOnOneKeywords,
          lessonCaseSensitive,
          oneOnOneCaseSensitive,
        },
        weeks,
      },
      null,
      2,
    ),
  );
  console.error(`\nwrote ${OUT} — ${mondays.length} weeks`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
