//const Day = require('./Day');
//const User = require('./User');
//const Week = require('./Week');
class Day{
    constructor(dayName){
        this.dayName = dayName;
        this.totalWorkers = []
        this.slots = [
            {
                time: "3",
                students: 0,
                workers: [],
            },
            {
                time: "3:30",
                students: 0,
                workers: [],
            },
            {
                time: "4",
                students: 0,
                workers: [],
            },
            {
                time: "4:30",
                students: 0,
                workers: [],
            },
            {
                time: "5",
                students: 0,
                workers: [],
            },
            {
                time: "5:30",
                students: 0,
                workers: [],
            },
            {
                time: "6",
                students: 0,
                workers: [],
            },
            {
                time: "6:30",
                students: 0,
                workers: [],
            },
            {
                time: "7",
                students: 0,
                workers: [],
            },
            {
                time: "7:30",
                students: 0,
                workers: [],
            },
            {
                time: "8",
                students: 0,
                workers: [],
            },
        ];
    
    }

    canWork(week, users){
        for (let k = 0; k < week.length;k++){//for each day
            let day = week[k];
            for (let u = 0; u < users.length; u++){
                let user = users[u];
                let dayIndex = user.days.indexOf(day.dayName.toLowerCase());
                if (dayIndex !== -1) {
                    for (let i = 0; i < day.slots.length; i++) {//for each slot
                        const time = day.slots[i].time;

                        if (user.hours[dayIndex].includes(time)) {//if the user's hours includes the current time, add them to that slot
                            day.slots[i].workers.push(user);//add to slot
                            user.points += 0.5;//add points if added to slot, 0.5 to represent every half hour

                            if (!(day.totalWorkers.includes(user))){//add to total workers of the day
                                day.totalWorkers.push(user);
                            }
                            //console.log(user.name + " added to slot");
                        }

                        day.slots[i].workers.sort(function(a, b) { return a.points - b.points });//sort from least to greatest based on points

                    }
                }
            }
        }
    }

    willWork(week){
    for (let k = 0; k < week.length; k++){// for each day
        let day = week[k];
        let prevWorkers = 0;//stores the amount of workers from previous slot in order to be able to detect a change
        for (let i = 0; i < day.slots.length; i++){//for each slot
            let workersTemp = day.slots[i].workers;//creates a copy of the array so it only adds the workers needed to the actual array
            day.slots[i].workers = [];
            let workersNeeded = Math.ceil(day.slots[i].students / 3); //number of instructors needed based on the ratio of 1:3 instructors to students
            let current = 0; //amount of current workers; defined before the loop so it doesnt add workers if the number of workers is the same
            for (; current < workersNeeded && current < workersTemp.length; current++){//keep adding workers until worker amount satisfied or run out of workers
                day.slots[i].workers.push(workersTemp[current]);//add instructors from the list of workers available that hour
            }
            if (prevWorkers > workersNeeded + 2){//checks if the workers needed changes drastically (change in 2 or more), if so end the extra workers' shifts
                for (let w = current; w < workersTemp.length && w < prevWorkers; w++){
                    workersTemp[w].working[workersTemp[w].days.indexOf(day.dayName.toLowerCase())][1] = day.slots[i].time;
                }
            }
            prevWorkers = current;//update prevWorkers for next slot
        }
        for (let worker of day.totalWorkers) {//for each worker that worked that day, assign their start and end times
            let dayIndex = worker.days.indexOf(day.dayName.toLowerCase());
            let times = [];
            for (let slot of day.slots) {//find all slots the worker was assigned to
                if (slot.workers.includes(worker)) times.push(timeToNum(slot.time));
            }
            if (times.length > 0) {//if the worker was assigned to any slots, set their start and end times
                worker.working[dayIndex][0] = numToTime(Math.min(...times));//set start time to earliest slot
                worker.working[dayIndex][1] = numToTime(Math.max(...times) + 0.5);//set end time to latest slot + 0.5 (end of that half hour block)
            }
        }
    }
}

    timeToNum(t) {
    let [h, m] = t.split(':');
    return parseInt(h) + (m === '30' ? 0.5 : 0);
    }

    numToTime(n) {
    let h = Math.floor(n);
    return n % 1 === 0.5 ? h + ":30" : h.toString();
    }

    resetAllWorkers(){
        for (let i = 0; i < this.slots.length; i++) {
            this.slots[i].workers = [];
        }
    }

    resetWorkers(hour){ //to signify a half hour, use .5 (ex. 6.5 for 6:30)
        if (Number(hour) >= 3 && Number(hour) <= 8){
       let index = Math.floor(hour * 2) - 6; // adjust calculation to match array index
        this.slots[index].workers = [];
        }

    }

    resetAllStudents(){
        for (let i = 0; i < this.slots.length; i++) {
            this.slots[i].students = 0;
        }
    }

    resetStudents(hour){ //to signify a half hour, use .5 (ex. 6.5 for 6:30)
        if (Number(hour) >= 3 && Number(hour) <= 8){
       let index = Math.floor(hour * 2) - 6; // adjust calculation to match array index
        this.slots[index].students = 0;
        }

    }

    resetAllHours(){ 
        this.resetAllWorkers();
        this.resetAllStudents();
    }
}

module.exports = Day;

