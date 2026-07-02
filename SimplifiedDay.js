// ── SimplifiedDay.js ────────────────────────────────────────────────────────
// Block-based scheduling mode. Extends Day. Shift-block templates are derived
// from the day's OPERATING blocks plus the per-priority default start times
// (passed as shiftStarts, weekday-only). For each operating block [s, e]:
//   - a long shift [st, e] for each candidate start st (s and any default
//     start strictly inside the block) — longest first, so e.g. a 3–8 block
//     yields both 3–8 (adults) and 4–8 (after-school) shifts
//   - early/late halves of the "common" (latest-start) long shift
// A worker may be assigned to at most one shift per operating block, but CAN be
// assigned in more than one operating block on a two-block day. working[di] is
// a list of assigned shifts. All times are canonical minutes since midnight.
// ─────────────────────────────────────────────────────────────────────────────

const Day = require("./Day");

class SimplifiedDay extends Day {
  constructor(dayKey = "", dayName = "", slots = [], operatingBlocks = [], shiftStarts = []) {
    super(dayKey, dayName, slots);
    this.operatingBlocks = (operatingBlocks || []).map((b) => ({ start: b.start, end: b.end }));
    this.blocks = SimplifiedDay.buildShiftBlocks(this.operatingBlocks, shiftStarts || []);
  }

  static buildShiftBlocks(operatingBlocks, shiftStarts = []) {
    const out = [];
    for (const b of operatingBlocks) {
      // Candidate starts: operating open + any default start strictly inside.
      const starts = [...new Set([b.start, ...shiftStarts.filter((s) => s > b.start && s < b.end)])]
        .sort((a, z) => a - z);
      // Long shifts from each start to the block end (longest first).
      for (const st of starts) out.push({ name: "full", start: st, end: b.end });
      // Early/late halves based on the common (latest) start.
      const primary = starts[starts.length - 1];
      if (b.end - primary > 120) {
        let mid = primary + Math.round(((b.end - primary) / 2) / 30) * 30;
        if (mid <= primary) mid = primary + 30;
        if (mid >= b.end) mid = b.end - 30;
        out.push({ name: "early", start: primary, end: mid });
        out.push({ name: "late", start: mid, end: b.end });
      }
    }
    return out;
  }

  // Peak simultaneous workers needed anywhere inside a shift block.
  findPeak(day, block) {
    let peak = 0;
    for (const slot of day.slots) {
      if (slot.time >= block.start && slot.time < block.end) {
        const students = slot.students;
        let workersNeeded;
        if (slot.oneOnOne) {
          const remaining = peak - 1;
          if (remaining * 4 < students) peak++;
          workersNeeded = Math.ceil(students / 4);
        } else {
          workersNeeded = Math.ceil(students / 3);
        }
        if (workersNeeded > peak) peak = workersNeeded;
      }
    }
    return peak;
  }

  willWork(week) {
    for (const day of week) {
      for (const block of day.blocks) {
        const peak = this.findPeak(day, block);
        if (peak === 0) continue;

        // Workers already assigned a shift that fully covers this block.
        const alreadyCovered = day.totalWorkers.filter((worker) => {
          const di = worker.days.indexOf(day.dayKey);
          return (worker.working[di] || []).some((s) => s.start <= block.start && s.end >= block.end);
        }).length;
        if (alreadyCovered >= peak) continue;

        const stillNeeded = peak - alreadyCovered;

        // Unassigned-for-this-block workers whose availability covers the whole block.
        const available = [];
        for (const worker of day.totalWorkers) {
          const di = worker.days.indexOf(day.dayKey);
          if (worker.hasShiftOverlapping(di, block.start, block.end)) continue;
          if (worker.coversWindow(di, block.start, block.end)) available.push(worker);
        }

        this._sortByPriority(available);

        let assigned = 0;
        for (const worker of available) {
          if (assigned >= stillNeeded) break;
          const di = worker.days.indexOf(day.dayKey);
          worker.working[di].push({ start: block.start, end: block.end });
          assigned++;
        }
      }

      // Assign one-on-one slots to the highest-priority worker already on that day.
      for (const slot of day.slots) {
        if (!slot.oneOnOne) continue;
        const candidates = day.totalWorkers
          .filter((w) => {
            const di = w.days.indexOf(day.dayKey);
            return (w.working[di] || []).length > 0;
          })
          .sort((a, b) => a.points - b.points);
        if (candidates.length > 0) slot.oneOnOneWorker = candidates[0];
      }
    }
  }
}

module.exports = SimplifiedDay;
