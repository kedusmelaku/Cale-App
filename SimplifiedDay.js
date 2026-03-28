const Day = require("./Day");

class SimplifiedDay extends Day {
  constructor(dayName, isSaturday = false) {
    super(dayName, isSaturday); // calls Day's constructor which sets up slots

    // define shift blocks based on day type
    if (isSaturday) {
      this.blocks = [
        { name: "full", start: "10", end: "2" },
        { name: "early", start: "10", end: "12" },
        { name: "late", start: "12", end: "2" },
      ];
    } else {
      this.blocks = [
        { name: "adult", start: "3", end: "8" },
        { name: "full", start: "4", end: "8" },
        { name: "early", start: "4", end: "6" },
        { name: "late", start: "6", end: "8" },
      ];
    }
  }

  findPeak(day, block) {
    let peak = 0;

    for (let slot of day.slots) {
      // check if this slot falls within the block's time range
      let slotNum = this.timeToNum(slot.time);
      let blockStart = this.timeToNum(block.start);
      let blockEnd = this.timeToNum(block.end);

      if (slotNum >= blockStart && slotNum < blockEnd) {
        let students = slot.students;
        let workersNeeded;

        if (slot.oneOnOne) {
          // one on one detected - use 1:4 ratio and one less worker available
          workersNeeded = Math.ceil(students / 4);
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

  willWork(week) {
    for (let k = 0; k < week.length; k++) {
      // for each day
      let day = week[k];

      for (let block of this.blocks) {
        // for each shift block
        let peak = this.findPeak(day, block);
        if (peak === 0) continue; // skip blocks with no students

        // count how many already-assigned workers cover this block
        let alreadyCovered = day.totalWorkers.filter((worker) => {
          let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
          if (worker.working[dayIndex][0] === undefined) return false;
          let assignedStart = this.timeToNum(worker.working[dayIndex][0]);
          let assignedEnd = this.timeToNum(worker.working[dayIndex][1]);
          return (
            assignedStart <= this.timeToNum(block.start) &&
            assignedEnd >= this.timeToNum(block.end)
          );
        }).length;

        if (alreadyCovered >= peak) continue; // block already staffed, skip it
        let stillNeeded = peak - alreadyCovered;

        // find workers available for this entire block and not yet assigned
        let availableWorkers = [];
        for (let worker of day.totalWorkers) {
          let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
          let workerStart = this.timeToNum(worker.hours[dayIndex][0]);
          let workerEnd = this.timeToNum(
            worker.hours[dayIndex][worker.hours[dayIndex].length - 1],
          );

          let blockStart = this.timeToNum(block.start);
          let blockEnd = this.timeToNum(block.end);

          // check if worker covers the entire block AND is not yet assigned
          if (
            workerStart <= blockStart &&
            workerEnd >= blockEnd &&
            worker.working[dayIndex][0] === undefined
          ) {
            availableWorkers.push(worker);
          }
        }

        // sort by points so highest priority workers are first
        availableWorkers.sort((a, b) => a.points - b.points);

        // assign workers up to stillNeeded
        let assigned = 0;
        for (let worker of availableWorkers) {
          if (assigned >= stillNeeded) break;
          let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
          worker.working[dayIndex][0] = block.start;
          worker.working[dayIndex][1] = block.end;
          assigned++;
        }
      }
    }
  }
}

module.exports = SimplifiedDay;
