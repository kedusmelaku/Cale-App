const mongoose = require("mongoose");

// One document per center. Stores the availability submission window
// (when employees can submit their availability for the upcoming week)
// and any other per-center configuration that doesn't belong in env vars.

// ── Operating-schedule subdocuments ──────────────────────────────────────────
// All times are minutes since midnight, 24-hour (see scheduleConfig.js).
// A block is a contiguous open window; a day may have up to two blocks
// (a "two-block day" with a gap in the middle).
const blockSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true }, // minutes since midnight
    end: { type: Number, required: true },
  },
  { _id: false },
);

const daySchema = new mongoose.Schema(
  {
    open: { type: Boolean, default: false },
    blocks: { type: [blockSchema], default: [] },
  },
  { _id: false },
);

// A recurring open window used for per-priority default hours (minutes).
const windowSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true },
    end: { type: Number, required: true },
  },
  { _id: false },
);

// A full week for one variant (school-year or summer).
const variantSchema = new mongoose.Schema(
  {
    monday: { type: daySchema, default: () => ({}) },
    tuesday: { type: daySchema, default: () => ({}) },
    wednesday: { type: daySchema, default: () => ({}) },
    thursday: { type: daySchema, default: () => ({}) },
    friday: { type: daySchema, default: () => ({}) },
    saturday: { type: daySchema, default: () => ({}) },
    sunday: { type: daySchema, default: () => ({}) },
    // Per-priority default availability windows, indexed by priority level
    // (0 = Normal, 1 = Priority, 2 = High Priority). Applied Mon–Fri when an
    // employee marks a day "available all day"; weekends use full hours.
    defaults: { type: [windowSchema], default: undefined },
  },
  { _id: false },
);

// Recurring month/day marker for the summer date range (repeats every year).
const monthDaySchema = new mongoose.Schema(
  {
    month: { type: Number, min: 1, max: 12 },
    day: { type: Number, min: 1, max: 31 },
  },
  { _id: false },
);

const scheduleSchema = new mongoose.Schema(
  {
    // "auto" resolves the active variant from the summer date range below;
    // "manual" forces whichever variant `manualActive` names.
    mode: { type: String, enum: ["auto", "manual"], default: "auto" },
    manualActive: {
      type: String,
      enum: ["schoolYear", "summer"],
      default: "schoolYear",
    },
    summerStart: { type: monthDaySchema, default: null },
    summerEnd: { type: monthDaySchema, default: null },
    schoolYear: { type: variantSchema, default: () => ({}) },
    summer: { type: variantSchema, default: () => ({}) },
  },
  { _id: false },
);

// Keyword lists used to classify Google Calendar event titles (see
// calendar.js). lessonKeywords is the primary classifier; oneOnOneKeywords
// is optional since not every center runs one-on-one lessons.
const calendarKeywordsSchema = new mongoose.Schema(
  {
    lessonKeywords: { type: [String], default: [] },
    oneOnOneKeywords: { type: [String], default: [] },
    // Per-list case sensitivity. Default false (case-insensitive) — most
    // centers don't need it, but short codes like "HS" can occasionally
    // collide with ordinary words, so this is here for when a center does.
    lessonCaseSensitive: { type: Boolean, default: false },
    oneOnOneCaseSensitive: { type: Boolean, default: false },
  },
  { _id: false },
);

const centerSettingsSchema = new mongoose.Schema({
  centerId: { type: String, required: true, unique: true },

  // Availability submission window
  // windowOpen / windowClose are stored as Date objects (UTC).
  // null means no window has been configured yet.
  windowOpen: { type: Date, default: null },
  windowClose: { type: Date, default: null },

  // Per-center operating schedule (operating days, hours, and blocks).
  // null on legacy documents created before this feature — callers should
  // fall back to scheduleConfig.defaultSchedule() when this is absent.
  schedule: { type: scheduleSchema, default: null },

  // Per-center Google Calendar event-title keywords. null on legacy
  // documents (and any center that hasn't configured this yet) — callers
  // should fall back to calendar.js's built-in defaults (HS/MS/ES,
  // "1-on-1"/"one-on-one") when this is absent.
  calendarKeywords: { type: calendarKeywordsSchema, default: null },

  // Tutorial completion status for the center's onboarding tour.
  tutorialCompleted: { type: Boolean, default: false },

  // Whether the first-time intro modal has already been dismissed or taken.
  introSeen: { type: Boolean, default: false },
});

const CenterSettings = mongoose.model("CenterSettings", centerSettingsSchema);

module.exports = CenterSettings;
