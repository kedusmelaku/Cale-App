// ── User.js ─────────────────────────────────────────────────────────────────
// A scheduling "user" (employee) as the engine sees it. Availability is stored
// as per-day blocks in canonical minutes since midnight (24-hour), matching the
// Submission/Employee data shape.
//
//   days = [ { day: "monday", blocks: [ { start, end }, ... ] }, ... ]
//
// `points` drives scheduling order (lower = assigned first). For Normal
// (level 0) workers it is the total available hours, so workers with LESS
// availability sort first. Priority levels flatten points to fixed low values
// (see applyPriority), matching the original behavior.
// ─────────────────────────────────────────────────────────────────────────────

class User {
  constructor(name, days, submittedAt = null) {
    this.name = name;
    this.submittedAt = submittedAt;
    this.priority = 0;

    this.days = [];
    this.blocksByDay = [];
    for (const d of days || []) {
      this.days.push(d.day.toLowerCase());
      const blocks = (d.blocks || [])
        .map((b) => ({ start: b.start, end: b.end }))
        .sort((a, b) => a.start - b.start);
      this.blocksByDay.push(blocks);
    }

    // Availability-based points = total available hours across the week.
    this.points = 0;
    for (const blocks of this.blocksByDay) {
      for (const b of blocks) this.points += (b.end - b.start) / 30 * 0.5;
    }

    // working[i] = list of assigned shifts [{start, end}, ...] on day i.
    // A two-block day can hold two shifts for the same worker.
    this.working = Array.from({ length: this.days.length }, () => []);
  }

  dayIndex(dayKey) {
    return this.days.indexOf(dayKey.toLowerCase());
  }

  // Is this worker available for the 30-minute slot starting at `min` on day di?
  availableAt(di, min) {
    if (di < 0 || di >= this.blocksByDay.length) return false;
    return this.blocksByDay[di].some((b) => min >= b.start && min < b.end);
  }

  // Does the worker cover an entire [start, end) window on day di?
  coversWindow(di, start, end) {
    if (di < 0 || di >= this.blocksByDay.length) return false;
    return this.blocksByDay[di].some((b) => b.start <= start && b.end >= end);
  }

  // Does the worker already have an assigned shift overlapping [start, end) on day di?
  hasShiftOverlapping(di, start, end) {
    const shifts = this.working[di] || [];
    return shifts.some((s) => s.start < end && s.end > start);
  }

  uppercaseName(user) {
    const name = (user || this).name;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  hoursWorking(user, day) {
    const u = user || this;
    const di = u.days.indexOf(day.dayName.toLowerCase());
    const shifts = u.working[di] || [];
    if (!shifts.length) return "not assigned";
    return shifts.map((s) => s.start + "-" + s.end).join(", ");
  }

  setPriority(level) {
    this.priority = level;
    this.applyPriority();
  }

  applyPriority() {
    // Preserves original semantics: Priority and High Priority flatten points
    // to fixed low values so they sort ahead of availability-based Normals.
    if (this.priority === 1) {
      this.points = 0;
    } else if (this.priority === 2) {
      this.points = -10;
    }
  }
}

module.exports = User;
