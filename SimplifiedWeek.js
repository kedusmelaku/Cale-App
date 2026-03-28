const Week = require("./Week");
const SimplifiedDay = require("./SimplifiedDay");

class SimplifiedWeek extends Week {
  constructor(users) {
    super(users); // calls Week's constructor
    // override the week array with SimplifiedDay objects
    this.week = [
      new SimplifiedDay("Monday"),
      new SimplifiedDay("Tuesday"),
      new SimplifiedDay("Wednesday"),
      new SimplifiedDay("Thursday"),
      new SimplifiedDay("Saturday", true),
    ];
  }

  toString() {
    let str = "";
    for (let k = 0; k < this.week.length; k++) {
      //for each day
      let day = this.week[k];
      str += "Hours for " + day.dayName + ": \n\n";

      for (let worker of day.totalWorkers) {
        //for each worker that worked that day
        let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
        if (worker.working[dayIndex][0] === undefined) continue; //skip unassigned workers
        str +=
          worker.uppercaseName(worker) +
          ": " +
          worker.working[dayIndex][0] +
          "-" +
          worker.working[dayIndex][1] +
          "\n";
      }

      str += "\nBlock summary: \n";
      for (let block of day.blocks) {
        //for each block show peak workers needed
        let peak = day.findPeak(day, block);
        if (peak === 0) continue; //skip empty blocks
        str +=
          block.name +
          " (" +
          block.start +
          "-" +
          block.end +
          "): " +
          peak +
          " workers needed\n";
      }
      str += "\n";
    }
    return str;
  }

  createSchedule() {
    let day = new SimplifiedDay("");
    this.addStudents();
    day.canWork(this.week, this.users);
    day.willWork(this.week);
  }
}


module.exports = SimplifiedWeek;
