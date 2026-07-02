// ── SimplifiedWeek.js ───────────────────────────────────────────────────────
// The block-based week. Built from config-derived day configs:
//   new SimplifiedWeek(users, dayConfigs)
//   dayConfigs = [ { dayKey, dayName, blocks, slots }, ... ]  (open days only)
// ─────────────────────────────────────────────────────────────────────────────

const Week = require("./Week");
const SimplifiedDay = require("./SimplifiedDay");

class SimplifiedWeek extends Week {
  constructor(users, dayConfigs = []) {
    super(users, dayConfigs); // sets this.users; day array replaced below
    this.week = dayConfigs.map(
      (dc) => new SimplifiedDay(dc.dayKey, dc.dayName, dc.slots, dc.blocks, dc.shiftStarts),
    );
  }

  createSchedule() {
    const tmp = new SimplifiedDay();
    this.addStudents();
    tmp.canWork(this.week, this.users);
    tmp.willWork(this.week);
  }
}

module.exports = SimplifiedWeek;
