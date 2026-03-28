//const Day = require('./Day');
//const User = require('./User');
//const Week = require('./Week');
class User {
  constructor(name, hoursAv) {
    let defaultHours = [
      "4",
      "4:30",
      "5",
      "5:30",
      "6",
      "6:30",
      "7",
      "7:30",
      "8",
    ];
    this.name = name;
    this.days = [];
    this.points = 0;
    this.priority = 0; // 0 = normal, 1 = priority, 2 = high priority
    this.hours = [];

    for (let i = 0; i < hoursAv.length; i++) {
      this.hours.push([]);

      let isSaturday = hoursAv[i][0].toLowerCase() === "saturday"; // check if saturday
      let defaultHours = isSaturday
        ? ["10", "10:30", "11", "11:30", "12", "12:30", "1", "1:30", "2"] // saturday defaults
        : ["4", "4:30", "5", "5:30", "6", "6:30", "7", "7:30", "8"]; // weekday defaults

      if (!(hoursAv[i].length < 3)) {
        //check if hours are specified
        for (let hour = hoursAv[i][1]; hour <= hoursAv[i][2]; hour++) {
          //if hours are specified, add them
          if (isSaturday ? hour >= 10 && hour <= 14 : hour >= 3 && hour <= 8) {
            let displayHour = hour > 12 ? hour - 12 : hour; // convert 13 to 1, 14 to 2
            this.hours[i].push(displayHour.toString());
            if (hour < hoursAv[i][2]) {
              this.hours[i].push(hour + ":30");
            }
          }
        }
      } else {
        for (let item of defaultHours) this.hours[i].push(item); //if no hours are specified, assume all hours
      }

      this.days.push(hoursAv[i][0].toLowerCase()); //initialize 2d array of days with available hours
    }

    for (let i = 0; i < this.hours.length; i++) {
      //calculate points from total availability
      this.points += this.hours[i].length * 0.5;
    }

    this.working = Array.from({ length: this.days.length }, () => []); //hours working, [0] is start time, [1] is end time
  }

  uppercaseName(user) {
    //returns the name with the first letter capitalized for final schedule purposes
    let name = user.name;
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return name;
  }

  hoursWorking(user, day) {
    //returns a string of the range of hours working (ie 4-6)
    let dayIndex = user.days.indexOf(day.dayName.toLowerCase());
    let str = "";
    let start = user.working[dayIndex][0];
    let end = user.working[dayIndex][1];
    if (end === undefined) {
      end = "not assigned";
    }
    str += start + "-" + end;
    return str;
  }

  setPriority(level) {
    // sets priority level 0-2
    this.priority = level;
    this.applyPriority();
  }

  applyPriority() {
    // applies priority to points
    if (this.priority === 1) {
      this.points = 0;
    } else if (this.priority === 2) {
      this.points = -10;
    }
    // priority 0 keeps the availability-calculated points
  }
}

module.exports = User;