//const Day = require('./Day');
//const User = require('./User');
//const Week = require('./Week');
class User{
    constructor(name, hoursAv){
        let defaultHours = ["4","4:30","5","5:30","6","6:30","7","7:30","8"];
        this.name = name;
        this.days = [];
        this.points = 0;
        this.hours = [];
        
        for (let i = 0; i < hoursAv.length; i++) {
            this.hours.push([]);
            if(!(hoursAv[i].length < 3)){ //check if hours are specified
            for (let hour = hoursAv[i][1]; hour <= hoursAv[i][2]; hour++) { //if hours are specified, add them
            if (hour >= 3 && hour <= 8){
            this.hours[i].push(hour.toString());
            this.hours[i].push(hour+":30");
            }
            }
        }else{
            for (let item of defaultHours)
            this.hours[i].push(item);//if no hours are specified, assume all hours
        }
        
            this.days.push(hoursAv[i][0].toLowerCase()); //inititialize 2d array of days with available hours
        }


        this.working = Array.from({ length: this.days.length }, () => []); //hours working, [0] is start time, []
    }

    uppercaseName(user){//returns the name with the first letter capitalized for final schedule purposes
        let name = user.name
        name = name.charAt(0).toUpperCase() + name.slice(1);
        return name
    }

    hoursWorking(user, day){//returns a string of the range of hours working (ie 4-6)
        let dayIndex = user.days.indexOf(day.dayName.toLowerCase());
        let str = "";
        let start = user.working[dayIndex][0];
        let end = user.working[dayIndex][1];
        if (end === undefined) {
            end = "8";
        }
        str += start + "-" + end;
        return str;
    }



}

module.exports = User;