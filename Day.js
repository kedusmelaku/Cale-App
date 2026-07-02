// ── Day.js ──────────────────────────────────────────────────────────────────
// Base day for the "ultra" (slot-by-slot) scheduling mode. Built from config:
//   new Day(dayKey, dayName, slots)   slots = [startMin, ...] (canonical minutes)
// Each slot's `time` is its start minute. A day may be built from one or two
// operating blocks; the flattened `slots` list simply omits the gap between
// two-block days, so the algorithm never assigns across a gap.
// ─────────────────────────────────────────────────────────────────────────────

class Day {
  constructor(dayKey = "", dayName = "", slots = []) {
    this.dayKey = (dayKey || "").toLowerCase();
    this.dayName = dayName || "";
    this.totalWorkers = [];
    this.slots = (slots || []).map((min) => ({
      time: min, // canonical minutes since midnight
      students: 0,
      workers: [],
      oneOnOne: false,
      oneOnOneWorker: null,
    }));
  }

  // Sort helper: fewer points first, then earliest submission, then unknown last.
  _sortByPriority(list) {
    list.sort((a, b) => {
      if (a.points !== b.points) return a.points - b.points;
      if (a.submittedAt && b.submittedAt) return new Date(a.submittedAt) - new Date(b.submittedAt);
      if (a.submittedAt) return -1;
      if (b.submittedAt) return 1;
      return 0;
    });
  }

  // Assign every available worker to every slot they can cover.
  canWork(week, users) {
    for (const day of week) {
      for (const user of users) {
        const di = user.days.indexOf(day.dayKey);
        if (di === -1) continue;
        for (const slot of day.slots) {
          if (user.availableAt(di, slot.time)) {
            slot.workers.push(user);
            if (!day.totalWorkers.includes(user)) day.totalWorkers.push(user);
          }
        }
      }
      for (const slot of day.slots) this._sortByPriority(slot.workers);
    }
  }

  // Trim each slot to the number of workers actually needed (1:3 ratio), then
  // derive each worker's shift as [firstAssignedSlot, lastAssignedSlot + 30].
  willWork(week) {
    for (const day of week) {
      for (const slot of day.slots) {
        const workersTemp = [...slot.workers];
        slot.workers = [];
        const workersNeeded = Math.ceil(slot.students / 3);
        let current = 0;
        for (; current < workersNeeded && current < workersTemp.length; current++) {
          slot.workers.push(workersTemp[current]);
        }
        // Excess workers simply drop out of later slots; each worker's final
        // shift(s) are derived from the slots they remain in (below).
      }

      for (const worker of day.totalWorkers) {
        const di = worker.days.indexOf(day.dayKey);
        const times = [];
        for (const slot of day.slots) {
          if (slot.workers.includes(worker)) times.push(slot.time);
        }
        if (times.length === 0) continue;
        times.sort((a, b) => a - b);
        // Split into maximal contiguous runs (breaks at gaps / two-block seams).
        worker.working[di] = [];
        let runStart = times[0];
        let prev = times[0];
        for (let k = 1; k < times.length; k++) {
          if (times[k] === prev + 30) { prev = times[k]; continue; }
          worker.working[di].push({ start: runStart, end: prev + 30 });
          runStart = times[k];
          prev = times[k];
        }
        worker.working[di].push({ start: runStart, end: prev + 30 });
      }
    }
  }

  resetAllWorkers() {
    for (const slot of this.slots) slot.workers = [];
  }

  resetAllStudents() {
    for (const slot of this.slots) slot.students = 0;
  }

  resetAllHours() {
    this.resetAllWorkers();
    this.resetAllStudents();
  }
}

module.exports = Day;
