class User {
  constructor(name, hoursAv) {
    this.name = name;
    this.days = [];
    this.points = 0;
    this.priority = 0;
    this.hours = [];

    for (let i = 0; i < hoursAv.length; i++) { //creates the available hours
      this.hours.push([]);

      let isSaturday = hoursAv[i][0].toLowerCase() === "saturday";
      let defaultHours = isSaturday
        ? ["10", "10:30", "11", "11:30", "12", "12:30", "1", "1:30", "2"]
        : ["4", "4:30", "5", "5:30", "6", "6:30", "7", "7:30", "8"];

      if (!(hoursAv[i].length < 3)) {//if hours are specified
        for (let hour = hoursAv[i][1]; hour <= hoursAv[i][2]; hour++) {
          if (isSaturday ? hour >= 10 && hour <= 14 : hour >= 3 && hour <= 8) {
            let displayHour = hour > 12 ? hour - 12 : hour; //if hour is greater than 12, convert to pm form (like 1 pm instead of 13)
            this.hours[i].push(displayHour.toString());
            if (hour < hoursAv[i][2]) {
              this.hours[i].push(displayHour + ":30"); 
            }
          }
        }
      } else {
        for (let item of defaultHours) this.hours[i].push(item); // adds each of the default hours
      }

      this.days.push(hoursAv[i][0].toLowerCase());
    }

    for (let i = 0; i < this.hours.length; i++) {
      this.points += this.hours[i].length * 0.5;
    }

    this.working = Array.from({ length: this.days.length }, () => []);
  }

  uppercaseName(user) {//changes the first letter of a name to uppercase
    let name = user.name;
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return name;
  }

  hoursWorking(user, day) {
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
    this.priority = level;
    this.applyPriority();
  }

  applyPriority() {
    if (this.priority === 1) {
      this.points = 0;
    } else if (this.priority === 2) {
      this.points = -10;
    }
  }
}

module.exports = User;
