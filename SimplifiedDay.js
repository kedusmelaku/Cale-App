const Day = require("./Day");

class SimplifiedDay extends Day {
  constructor(dayName, isSaturday = false) {
    super(dayName, isSaturday); // calls Day's constructor which sets up slots

    // define shift blocks based on day type
    if (!isSaturday) {
      // weekdays — wider blocks first so workers aren't locked into short shifts
      // before the algorithm has a chance to assign them to a longer block
      this.blocks = [
        { name: "adult", start: "3", end: "8" },
        { name: "full", start: "4", end: "8" },
        { name: "early", start: "4", end: "6" },
        { name: "late", start: "6", end: "8" },
      ];
    } else {
      // saturday — full block first for same reason
      this.blocks = [
        { name: "full", start: "10", end: "2" },
        { name: "early", start: "10", end: "12" },
        { name: "late", start: "12", end: "2" },
      ];
    }
  }

  findPeak(day, block) {
    let peak = 0;

    for (let slot of day.slots) {
      // check if this slot falls within the block's time range
      let toNum = day.isSaturday
        ? (t) => this.saturdayTimeToNum(t)
        : (t) => this.timeToNum(t);

      let slotNum = toNum(slot.time);
      let blockStart = toNum(block.start);
      let blockEnd = toNum(block.end);

      if (slotNum >= blockStart && slotNum < blockEnd) {
        let students = slot.students;
        let workersNeeded;

        if (slot.oneOnOne) {
          // one on one detected - one worker is pulled out for the one on one
          // check if remaining workers can cover at 1:4 ratio
          let remainingWorkers = peak - 1;
          if (remainingWorkers * 4 < students) peak++; // remaining can't cover, need extra
          workersNeeded = Math.ceil(students / 4); // use 1:4 ratio for remaining workers
        } else {
          // normal ratio 1:3
          workersNeeded = Math.ceil(students / 3);
        }

        if (workersNeeded > peak) {
          peak = workersNeeded; // update peak if this slot needs more workers
        }
      }
    }

    return peak;
  }

  saturdayTimeToNum(t) {
    let [h, m] = t.split(":");
    let hour = parseInt(h);
    // saturday afternoon hours 1-2 are PM, convert to 13-14
    if (hour < 10) hour += 12;
    return hour + (m === "30" ? 0.5 : 0);
  }

  willWork(week) {
    for (let k = 0; k < week.length; k++) {
      // for each day
      let day = week[k];

      // use correct time conversion based on day type
      let toNum = day.isSaturday
        ? (t) => this.saturdayTimeToNum(t)
        : (t) => this.timeToNum(t);

      for (let block of day.blocks) {
        // for each shift block
        let peak = this.findPeak(day, block);
        if (peak === 0) continue; // skip blocks with no students

        // count how many already-assigned workers cover this block
        let alreadyCovered = day.totalWorkers.filter((worker) => {
          let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
          if (worker.working[dayIndex][0] === undefined) return false;
          let assignedStart = toNum(worker.working[dayIndex][0]);
          let assignedEnd = toNum(worker.working[dayIndex][1]);
          return (
            assignedStart <= toNum(block.start) &&
            assignedEnd >= toNum(block.end)
          );
        }).length;

        if (alreadyCovered >= peak) continue; // block already staffed, skip it
        let stillNeeded = peak - alreadyCovered;

        // find workers available for this entire block and not yet assigned
        let availableWorkers = [];
        for (let worker of day.totalWorkers) {
          let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
          let workerStart = toNum(worker.hours[dayIndex][0]);
          let workerEnd = toNum(
            worker.hours[dayIndex][worker.hours[dayIndex].length - 1],
          );

          let blockStart = toNum(block.start);
          let blockEnd = toNum(block.end);

          // check if worker covers the entire block AND is not yet assigned
          if (
            workerStart <= blockStart &&
            workerEnd >= blockEnd &&
            worker.working[dayIndex][0] === undefined
          ) {
            availableWorkers.push(worker); // only add if both conditions met
          }
        }

        // sort by points so highest priority workers are first
        availableWorkers.sort((a, b) => a.points - b.points);

        // assign workers up to stillNeeded
        let assigned = 0;
        for (let worker of availableWorkers) {
          if (assigned >= stillNeeded) break; // stop if we have enough workers
          let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
          worker.working[dayIndex][0] = block.start; // set start time
          worker.working[dayIndex][1] = block.end; // set end time
          assigned++;
        }
      }

      // assign one-on-one workers to flagged slots
      for (let slot of day.slots) {
        if (!slot.oneOnOne) continue;
        // find lowest points worker already assigned to this day (priority 2 first)
        let candidates = day.totalWorkers
          .filter((w) => {
            let di = w.days.indexOf(day.dayName.toLowerCase());
            return w.working[di][0] !== undefined; // only already assigned workers
          })
          .sort((a, b) => a.points - b.points);
        if (candidates.length > 0) slot.oneOnOneWorker = candidates[0]; // assign highest priority worker
      }
    }
  }
}

module.exports = SimplifiedDay;
