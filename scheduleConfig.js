// ── scheduleConfig.js ───────────────────────────────────────────────────────
// Shared, server-side source of truth for a center's operating schedule.
//
// Time format: EVERY time is stored as minutes since midnight, 24-hour.
//   9:00 AM = 540, 3:00 PM = 900, 8:00 PM = 1200, 11:30 PM = 1410.
// There is no AM/PM in the data — that is purely a display concern.
//
// A center has two named schedule "variants": schoolYear and summer. Each
// variant is a map of the seven weekdays. Each day is { open, blocks } where
// blocks is a list of { start, end } (minutes). One block = a normal day;
// two blocks = a two-block day with a gap in the middle (max 2).
//
// Which variant is "active" right now is resolved by resolveActiveName():
//   - mode "manual": manualActive wins.
//   - mode "auto":   today's month/day is compared against the recurring
//                    summer date range (summerStart / summerEnd, stored as
//                    { month, day } so it repeats every year).
// ─────────────────────────────────────────────────────────────────────────────

const DAY_KEYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

const DAY_FULL = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

// blocks ([{start,end}] minutes) → flat array of slot-start minutes (30-min steps).
function slotsForBlocks(blocks) {
  const slots = [];
  for (const b of (blocks || []).slice().sort((a, b) => a.start - b.start)) {
    for (let m = b.start; m < b.end; m += 30) slots.push(m);
  }
  return slots;
}

// A schedule variant's `days` map → the day configs the engine builds a week
// from: one entry per OPEN day, in weekday order, each with sorted operating
// blocks, the flattened slot-start minutes, and the candidate shift-start
// minutes used to build shift templates. Shift starts include the per-priority
// default window starts on Mon–Fri only (weekends start everyone at open).
function variantToDayConfigs(variant) {
  variant = variant || {};
  const defs = Array.isArray(variant.defaults) ? variant.defaults : [];
  const defaultStarts = [...new Set(defs.map((w) => w.start))].sort((a, b) => a - b);

  const out = [];
  for (const dk of DAY_KEYS) {
    const d = variant[dk];
    if (!d || !d.open || !(d.blocks || []).length) continue;
    const blocks = d.blocks.map((b) => ({ start: b.start, end: b.end })).sort((a, b) => a.start - b.start);
    const shiftStarts = isWeekendDay(dk) ? [] : defaultStarts;
    out.push({ dayKey: dk, dayName: DAY_FULL[dk], blocks, slots: slotsForBlocks(blocks), shiftStarts });
  }
  return out;
}

const MIN_TIME = 0;      // 12:00 AM
const MAX_TIME = 1440;   // 12:00 AM next day (end-exclusive upper bound)
const STEP = 30;         // half-hour granularity

// Default operating window reproduces the app's original hardcoded behavior:
//   Mon–Thu 3:00 PM – 8:00 PM, Saturday 10:00 AM – 2:00 PM, Fri/Sun closed.
const WEEKDAY_BLOCK = { start: 15 * 60, end: 20 * 60 }; // 900 – 1200
const SAT_BLOCK = { start: 10 * 60, end: 14 * 60 };     // 600 – 840

// Per-priority default availability windows, indexed by priority level
// (0 = Normal, 1 = Priority, 2 = High Priority). These define what "available
// all day" expands to. The START of the window is an after-school floor that
// applies Monday–Friday only; weekends (Sat/Sun) always use the full operating
// blocks. Defaults reproduce the app's original behavior: Normal/Priority start
// at 4:00 PM, High Priority at 3:00 PM (opening).
const DEFAULT_PRIORITY_WINDOWS = [
  { start: 16 * 60, end: 20 * 60 }, // Normal        4:00 PM – 8:00 PM
  { start: 16 * 60, end: 20 * 60 }, // Priority      4:00 PM – 8:00 PM
  { start: 15 * 60, end: 20 * 60 }, // High Priority 3:00 PM – 8:00 PM
];

function defaultPriorityWindows() {
  return DEFAULT_PRIORITY_WINDOWS.map((w) => ({ ...w }));
}

function defaultVariant() {
  return {
    monday:    { open: true,  blocks: [{ ...WEEKDAY_BLOCK }] },
    tuesday:   { open: true,  blocks: [{ ...WEEKDAY_BLOCK }] },
    wednesday: { open: true,  blocks: [{ ...WEEKDAY_BLOCK }] },
    thursday:  { open: true,  blocks: [{ ...WEEKDAY_BLOCK }] },
    friday:    { open: false, blocks: [] },
    saturday:  { open: true,  blocks: [{ ...SAT_BLOCK }] },
    sunday:    { open: false, blocks: [] },
    defaults:  defaultPriorityWindows(),
  };
}

function isWeekendDay(dayKey) {
  return dayKey === "saturday" || dayKey === "sunday";
}

// Expands "available all day" for one day into concrete blocks (canonical
// minutes), given the day's operating blocks and one priority window.
// Mon–Fri: each operating block is clipped to the priority window (empty
// clips are dropped). Sat/Sun: the full operating blocks are used unchanged.
function defaultBlocksFor(dayKey, operatingBlocks, priorityWindow) {
  const ops = (operatingBlocks || []).map((b) => ({ start: b.start, end: b.end }));
  if (isWeekendDay(dayKey) || !priorityWindow) return ops;
  const out = [];
  for (const b of ops) {
    const s = Math.max(b.start, priorityWindow.start);
    const e = Math.min(b.end, priorityWindow.end);
    if (s < e) out.push({ start: s, end: e });
  }
  return out;
}

// A fresh default schedule object (deep, so callers can mutate freely).
function defaultSchedule() {
  return {
    mode: "auto",
    manualActive: "schoolYear",
    summerStart: null, // { month, day } or null
    summerEnd: null,
    schoolYear: defaultVariant(),
    summer: defaultVariant(),
  };
}

// Encodes a { month, day } as a comparable integer (month * 100 + day).
function mdValue(md) {
  return md.month * 100 + md.day;
}

// Resolves which variant name ("schoolYear" | "summer") is active at `now`.
function resolveActiveName(schedule, now = new Date()) {
  if (!schedule) return "schoolYear";

  if (schedule.mode === "manual") {
    return schedule.manualActive === "summer" ? "summer" : "schoolYear";
  }

  // auto: compare today against the recurring summer range
  const s = schedule.summerStart;
  const e = schedule.summerEnd;
  if (!s || !e || s.month == null || e.month == null) return "schoolYear";

  const today = (now.getMonth() + 1) * 100 + now.getDate();
  const start = mdValue(s);
  const end = mdValue(e);

  // Normal case start <= end (e.g. Jun 1 – Aug 31). Wrap case (e.g. a range
  // that crosses New Year) is handled defensively even though summer won't.
  const inRange =
    start <= end ? today >= start && today <= end : today >= start || today <= end;

  return inRange ? "summer" : "schoolYear";
}

// Returns { name, variant } for the active variant, falling back to defaults.
function getActiveVariant(schedule, now = new Date()) {
  const name = resolveActiveName(schedule, now);
  const variant = (schedule && schedule[name]) || defaultVariant();
  return { name, variant };
}

// Validates a schedule object coming from the admin UI. Returns an error
// string (safe to show the admin) or null if valid.
function validateSchedule(sched) {
  if (!sched || typeof sched !== "object") return "Schedule data is missing.";

  if (sched.mode !== "auto" && sched.mode !== "manual") {
    return "Choose whether the summer schedule switches automatically or manually.";
  }

  if (sched.mode === "manual") {
    if (sched.manualActive !== "schoolYear" && sched.manualActive !== "summer") {
      return "Choose which schedule is currently active.";
    }
  } else {
    const hasStart = sched.summerStart && sched.summerStart.month != null;
    const hasEnd = sched.summerEnd && sched.summerEnd.month != null;
    if (hasStart !== hasEnd) {
      return "Set both a summer start and end date, or leave both empty.";
    }
    if (hasStart) {
      for (const md of [sched.summerStart, sched.summerEnd]) {
        const okMonth = Number.isInteger(md.month) && md.month >= 1 && md.month <= 12;
        const okDay = Number.isInteger(md.day) && md.day >= 1 && md.day <= 31;
        if (!okMonth || !okDay) return "Summer dates are invalid.";
      }
    }
  }

  for (const vName of ["schoolYear", "summer"]) {
    const v = sched[vName];
    if (!v || typeof v !== "object") return "A schedule variant is missing.";

    let anyOpen = false;
    for (const dk of DAY_KEYS) {
      const d = v[dk];
      if (!d || !d.open) continue;
      anyOpen = true;

      const blocks = Array.isArray(d.blocks) ? d.blocks : [];
      if (blocks.length < 1) return "Open days need at least one time block.";
      if (blocks.length > 2) return "A day can have at most two blocks.";

      let prevEnd = -1;
      for (const b of blocks) {
        if (typeof b.start !== "number" || typeof b.end !== "number") {
          return "A block is missing its start or end time.";
        }
        if (b.start % STEP !== 0 || b.end % STEP !== 0) {
          return "Times must fall on the half hour.";
        }
        if (b.start < MIN_TIME || b.end > MAX_TIME) {
          return "Times must be within a single day.";
        }
        if (b.start >= b.end) return "A block's start must be before its end.";
        if (b.start < prevEnd) {
          return "Blocks can't overlap — the second block must start after the first ends.";
        }
        prevEnd = b.end;
      }
    }
    if (!anyOpen) {
      return `The ${vName === "summer" ? "summer" : "school-year"} schedule needs at least one open day.`;
    }

    const defs = v.defaults;
    if (defs !== undefined) {
      if (!Array.isArray(defs) || defs.length !== 3) {
        return "Default hours must be set for all three priority levels.";
      }
      for (const w of defs) {
        if (!w || typeof w.start !== "number" || typeof w.end !== "number") {
          return "Default hours are incomplete.";
        }
        if (w.start % STEP !== 0 || w.end % STEP !== 0) {
          return "Default hours must fall on the half hour.";
        }
        if (w.start < MIN_TIME || w.end > MAX_TIME) {
          return "Default hours must be within a day.";
        }
        if (w.start >= w.end) return "A default level's start must be before its end.";
      }
    }
  }

  return null;
}

// Produces a clean copy: drops blocks on closed days, sorts blocks by start,
// and keeps only the recognized fields. Assumes validateSchedule already passed.
function normalizeSchedule(sched) {
  const out = {
    mode: sched.mode,
    manualActive: sched.manualActive === "summer" ? "summer" : "schoolYear",
    summerStart: null,
    summerEnd: null,
    schoolYear: {},
    summer: {},
  };

  if (sched.mode === "auto" && sched.summerStart && sched.summerStart.month != null) {
    out.summerStart = { month: sched.summerStart.month, day: sched.summerStart.day };
    out.summerEnd = { month: sched.summerEnd.month, day: sched.summerEnd.day };
  }

  for (const vName of ["schoolYear", "summer"]) {
    const v = sched[vName] || {};
    for (const dk of DAY_KEYS) {
      const d = v[dk] || {};
      const open = !!d.open;
      const blocks = open && Array.isArray(d.blocks)
        ? d.blocks
            .map((b) => ({ start: b.start, end: b.end }))
            .sort((a, b) => a.start - b.start)
        : [];
      out[vName][dk] = { open, blocks };
    }
    // Per-priority default windows (fall back to the built-in defaults).
    const defs = Array.isArray(v.defaults) && v.defaults.length === 3
      ? v.defaults.map((w) => ({ start: w.start, end: w.end }))
      : defaultPriorityWindows();
    out[vName].defaults = defs;
  }

  return out;
}

// ── Time display helpers (also mirrored client-side where needed) ────────────
function minToLabel(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 && h < 24 ? "PM" : "AM";
  let dh = h % 12;
  if (dh === 0) dh = 12;
  return `${dh}:${mm === 0 ? "00" : "30"} ${ampm}`;
}

module.exports = {
  DAY_KEYS,
  DAY_FULL,
  MIN_TIME,
  MAX_TIME,
  STEP,
  slotsForBlocks,
  variantToDayConfigs,
  defaultVariant,
  defaultSchedule,
  defaultPriorityWindows,
  isWeekendDay,
  defaultBlocksFor,
  resolveActiveName,
  getActiveVariant,
  validateSchedule,
  normalizeSchedule,
  minToLabel,
};
