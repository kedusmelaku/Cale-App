
const Day = require('./src/Day');
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
            let worker = day.totalWorkers[i];
            let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
            if (worker.working[dayIndex][0] === undefined) continue; //skip workers that were never assigned to a slot
            if (worker.working[dayIndex][0] === worker.working[dayIndex][1]) continue; //skip workers assigned to only one slot
            let end = worker.hoursWorking(worker, day) || "not assigned";
            str += worker.uppercaseName(worker) + ": " + end + "\n";
        }
        str += "\n";
        str += "Student counts: \n";
        for (let i = 0; i < day.slots.length; i++){//for each slot, print students and workers assigned
            str += day.slots[i].time + ": " + day.slots[i].students + " students, " + day.slots[i].workers.length + " workers (needs " + Math.ceil(day.slots[i].students / 3) + ")\n";
        }
        str += "\n";
    }
    return str;
}
}

module.exports = Week;