
const Day = require('./Day');
const User = require('./User');
const Week = require('./Week');

const hoursOfKedus = [
["monday", 6,8],
["tuesday"],
]

const hoursOfBob = [
["Monday", 3,8],
["tuesday", 4,6],
]

const hoursOfAlice = [
["monday", 4,7],
["wednesday", 5,8],
["thursday", 3,6],
]

const hoursOfCharlie = [
["tuesday", 3,5],
["wednesday", 6,8],
["saturday", 4,7],
]

const hoursOfDiana = [
["monday", 5,8],
["thursday", 4,8],
["saturday", 3,6],
]

const hoursOfEve = [
["tuesday", 4,8],
["wednesday", 3,7],
["saturday", 5,8],
]

const users = [
new User("Kedus", hoursOfKedus),
new User("Bob", hoursOfBob),
new User("Alice", hoursOfAlice),
new User("Charlie", hoursOfCharlie),
new User("Diana", hoursOfDiana),
new User("Eve", hoursOfEve),
]

const week = new Week(users);


week.createSchedule(users);
console.log(week.toString());

//Make a proper test by creating more than 2 users and more than two days
//check logic for 104-115 and willWork() in general within Day , for some reason people are being assinged "8-8" which doesnt make sense
//^theory for logic error - "current" loop isnt adding on the workers each hour because it isnt being reset to fufill the workersNeeded each slot
//try creating two variables with similar logic, maybe set them to eachother idk i dont want to think abt it rn just check it