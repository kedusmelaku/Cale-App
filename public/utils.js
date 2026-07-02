// ── utils.js ──────────────────────────────────────────────────────────────
// Shared constants and pure helpers used by both dashboard.html and
// scheduler.html. Must be loaded before either page's inline script.
// ─────────────────────────────────────────────────────────────────────────

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "saturday"];
const DAY_FULL = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  saturday: "Saturday",
};
const PRIORITY_LABELS = ["Normal", "Priority", "High Priority"];
const PRIORITY_CLASSES = ["", "p1", "p2"];
const PRIORITY_TOOLTIP_HTML =
  '<strong>Normal:</strong> High schoolers or people with limited availability. Default hours: 4–8.<br><strong>Priority:</strong> Adults with moderate availability. Default hours: 4–8.<br><strong>High Priority:</strong> Adults who are usually fully available. Default hours: 3–8.';
const PRIORITY_TOOLTIP_ARIA_LABEL =
  "Priority level info: Normal is for high schoolers or people with limited availability, default hours 4 to 8. Priority is for adults with moderate availability, default hours 4 to 8. High Priority is for adults who are usually fully available, default hours 3 to 8.";
const WORKER_COLORS = [
  "#4f86c6",
  "#e05c5c",
  "#3aaa72",
  "#e08c2a",
  "#8a6bbf",
  "#2aaab4",
  "#c47a2a",
  "#5a8a5a",
  "#c45a8a",
  "#2a7ac4",
  "#7aaa3a",
];
const WEEKDAY_SLOTS = [
  "3", "3:30", "4", "4:30", "5", "5:30", "6", "6:30", "7", "7:30",
];
const SAT_SLOTS = [
  "10", "10:30", "11", "11:30", "12", "12:30", "1", "1:30",
];
const SLOT_H = 40;

// Returns the color assigned to a worker by name, given the current workers array.
function getWorkerColor(name, workers) {
  const sorted = [...workers].map((w) => w.name).sort();
  return WORKER_COLORS[sorted.indexOf(name) % WORKER_COLORS.length];
}

// Returns the workers array sorted by priority descending, then name ascending.
function sortedWorkers(workers) {
  return [...workers].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.name.localeCompare(b.name);
  });
}

// Returns the slot list for a Saturday or weekday.
function slotList(isSat) {
  return isSat ? SAT_SLOTS : WEEKDAY_SLOTS;
}

// Converts a time string (e.g. "4", "4:30") to a slot index.
function timeToIndex(time, isSat) {
  const parts = time.split(":");
  let hour = parseInt(parts[0]);
  const mins = parts[1] ? parseInt(parts[1]) : 0;
  if (isSat && hour < 10) hour += 12;
  return (hour - (isSat ? 10 : 3)) * 2 + (mins === 30 ? 1 : 0);
}

// Converts a slot index back to a time string.
function indexToTime(idx, isSat) {
  const base = isSat ? 10 : 3;
  const totalHalfHours = base * 2 + idx;
  const h = Math.floor(totalHalfHours / 2);
  const m = totalHalfHours % 2 === 1 ? 30 : 0;
  const maxH = isSat ? 14 : 8;
  if (h >= maxH) return isSat ? "2" : "8";
  if (isSat && h > 12) return h - 12 + (m ? ":30" : "");
  return h + (m ? ":30" : "");
}

// ─────────────────────────────────────────────────────────────────────────
// CANONICAL SCHEDULE LAYER (config-driven; minutes since midnight, 24-hour)
//
// Added for per-center schedules. Everything above this line is the LEGACY
// fixed-window API (DAYS, WEEKDAY_SLOTS, SAT_SLOTS, slotList, timeToIndex,
// indexToTime) that assumes Mon–Thu 3–8 PM + Sat 10–2. It stays in place until
// every page is migrated to buildSchedule(); Section 8 removes it once unused.
//
// New model: a "variant" is the `days` object returned by /center-schedule —
//   { monday: { open, blocks: [{start,end}] }, … sunday }
// with all times in minutes since midnight (9:00 AM = 540, 3:30 PM = 930).
// A day may have up to two blocks (a two-block day with a gap). AM/PM lives
// only in display, never in data.
// ─────────────────────────────────────────────────────────────────────────

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_FULL_ALL = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};
const DAY_ABBR = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

// minutes since midnight → "3:30 PM"
function minToLabel(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const ampm = h >= 12 && h < 24 ? "PM" : "AM";
  let dh = h % 12; if (dh === 0) dh = 12;
  return dh + ":" + (m === 0 ? "00" : String(m).padStart(2, "0")) + " " + ampm;
}

// compact form for dense grids → "3" or "3:30" (no AM/PM)
function minToClock(min) {
  const h = Math.floor(min / 60), m = min % 60;
  let dh = h % 12; if (dh === 0) dh = 12;
  return m === 0 ? String(dh) : dh + ":" + String(m).padStart(2, "0");
}

// blocks ([{start,end}] in minutes) → flat array of slot-start minutes (30-min steps).
// The gap between two blocks produces no slots, which is what makes two-block
// days fall out naturally.
function slotsForBlocks(blocks) {
  const slots = [];
  for (const b of (blocks || []).slice().sort((a, b) => a.start - b.start)) {
    for (let m = b.start; m < b.end; m += 30) slots.push(m);
  }
  return slots;
}

// Builds a runtime view of one schedule variant. This is the single helper the
// dashboard, availability form, and scheduler use to render days/hours instead
// of the hardcoded DAYS / slot arrays.
function buildSchedule(variant) {
  variant = variant || {};
  const days = DAY_ORDER.filter(
    (k) => variant[k] && variant[k].open && (variant[k].blocks || []).length,
  );

  const blocksByDay = {}, slotsByDay = {};
  for (const k of days) {
    const blocks = (variant[k].blocks || []).slice().sort((a, b) => a.start - b.start);
    blocksByDay[k] = blocks;
    slotsByDay[k] = slotsForBlocks(blocks);
  }

  const allFirst = days.map((k) => slotsByDay[k][0]);
  const allLast = days.map((k) => slotsByDay[k][slotsByDay[k].length - 1] + 30);
  const rangeMin = days.length ? Math.min(...allFirst) : 0;
  const rangeMax = days.length ? Math.max(...allLast) : 0;

  return {
    variant,
    days,                                   // ordered open day keys
    isOpen: (k) => days.includes(k),
    dayFull: (k) => DAY_FULL_ALL[k] || k,
    dayAbbr: (k) => DAY_ABBR[k] || k,
    blocks: (k) => blocksByDay[k] || [],
    blockCount: (k) => (blocksByDay[k] || []).length,
    slots: (k) => slotsByDay[k] || [],      // slot-start minutes for the day
    slotCount: (k) => (slotsByDay[k] || []).length,
    slotLabel: (min) => minToLabel(min),
    // flattened slot index ↔ canonical minute, per day
    timeToSlotIndex: (k, min) => (slotsByDay[k] || []).indexOf(min),
    slotIndexToTime: (k, idx) => (slotsByDay[k] || [])[idx],
    // which block (0-based) a minute falls in for a day, or -1 if in a gap/closed
    blockIndexAt: (k, min) => (blocksByDay[k] || []).findIndex((b) => min >= b.start && min < b.end),
    // true when a visual gap follows this flattened slot index (block boundary)
    gapAfterSlot: (k, idx) => {
      const s = slotsByDay[k] || [];
      if (idx < 0 || idx >= s.length - 1) return false;
      return s[idx + 1] !== s[idx] + 30;
    },
    // widest time window across all open days (for a shared grid axis, if used)
    range: () => ({ min: rangeMin, max: rangeMax }),
    axis: () => { const out = []; for (let m = rangeMin; m < rangeMax; m += 30) out.push(m); return out; },
  };
}

// Allow Node (the scheduling engine + tests) to require these; harmless in the
// browser where `module` is undefined and the functions stay global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAY_ORDER, DAY_FULL_ALL, DAY_ABBR,
    minToLabel, minToClock, slotsForBlocks, buildSchedule,
  };
}
