
const Day = require('./Day');
const User = require('./User');
//const Week = require('./Week');
class Week{
    constructor(users){
        this.users = users;
    this.week = [
    new Day("Monday"),
    new Day("Tuesday"),
    new Day("Wednesday"),
    new Day("Thursday"),
    new Day("Saturday"),
]

    }

    addStudents(){//temporary method to add a random number of students until I figure out the Google Calendar stuff
        for (let i = 0; i < this.week.length; i++){
            let day = this.week[i];
            for (let j = 0; j < day.slots.length; j++){
                day.slots[j].students = Math.floor(Math.random() * 8) + 1;
            }
        }
    }
    createSchedule(){
        let day = new Day("");
        this.addStudents();
        day.canWork(this.week, this.users);
        day.willWork(this.week);
    }

    toString(){
        let str = ""
        for (let k = 0; k < this.week.length; k++){//for each day
            let day = this.week[k]
            str += "Hours for " + day.dayName + ": \n";
            str += "\n";
            for (let i = 0; i < day.totalWorkers.length; i++){//for each person working that day
               let end = day.totalWorkers[i].hoursWorking(day.totalWorkers[i], day) || "8";
                str += day.totalWorkers[i].uppercaseName(day.totalWorkers[i]) + ": " + end + "\n";
            }
            str += "\n";
        }
        return str;
    }
}

module.exports = Week;