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

            for (let i = 0; i < day.slots.length; i++){//for each slot
                let workersTemp = day.slots[i].workers;//creates a copy of the array so it only adds the workers needed to the actual array
                day.slots[i].workers = [];
                let workersNeeded = Math.ceil(day.slots[i].students /3); //number of instructors needed based on the ratio of 1:3 instructors to students
                let current = 0; //defined before the loop so it doesnt add workers if the number of workers is the same
                    for (; current < workersNeeded && current < workersTemp.length; current++){
                        day.slots[i].workers.push(workersTemp[current]);//add instructors from the list of workers available that hour
                        workersTemp[current].working[workersTemp[current].days.indexOf(day.dayName.toLowerCase())][0] = day.slots[i].time; //for each of the workers, set the time they start
                    }
                if (workersNeeded + 2 < current){//checks if the workers needed changes drastically (change in 2 or more), if so remove until satisfied
                    while (workersNeeded + 2 < current){
                        let removed = day.slots[i].workers.pop();
                        removed.working[removed.days.indexOf(day.dayName.toLowerCase())][1] = day.slots[i].time;
                        current--;
                    }
                }

            }
    }
        
    }


    createSchedule(week, users){
        for(let i = 0; i < this.week.length; i++){
            for (let j = 0; j < users.length; j++){
                this.week.canWork[users[j]];
            }
            week.week[i].willWork
        }
        

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
            this.slots[i].students = [];
        }
    }

    resetStudents(hour){ //to signify a half hour, use .5 (ex. 6.5 for 6:30)
        if (Number(hour) >= 3 && Number(hour) <= 8){
       let index = Math.floor(hour * 2) - 6; // adjust calculation to match array index
        this.slots[index].students = [];
        }

    }

    resetAllHours(){ 
        this.resetAllWorkers();
        this.resetAllStudents();
    }
}

module.exports = Day;

