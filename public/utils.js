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
