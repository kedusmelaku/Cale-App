const Day = require("./Day");
const User = require("./User");
const SimplifiedWeek = require("./SimplifiedWeek");

// original users
const hoursOfKedus = [["monday", 6, 8], ["tuesday"]];

const hoursOfBob = [
  ["monday", 3, 8],
  ["tuesday", 4, 6],
];

const hoursOfAlice = [
  ["monday", 4, 7],
  ["wednesday", 5, 8],
  ["thursday", 3, 6],
];

const hoursOfCharlie = [
  ["tuesday", 3, 5],
  ["wednesday", 6, 8],
  ["saturday", 10, 14], // 10am - 2pm
];

const hoursOfDiana = [
  ["monday", 5, 8],
  ["thursday", 4, 8],
  ["saturday", 10, 14], // 10am - 2pm
];

const hoursOfEve = [
  ["tuesday", 4, 8],
  ["wednesday", 3, 7],
  ["saturday", 10, 14], // 10am - 2pm
];

// additional test users
const hoursOfFrank = [
  ["monday", 3, 8],
  ["wednesday", 3, 8],
  ["thursday", 3, 8],
];

const hoursOfGrace = [
  ["tuesday", 3, 8],
  ["thursday", 3, 8],
  ["saturday", 10, 14], // 10am - 2pm
];

const hoursOfHenry = [
  ["monday", 3, 6],
  ["tuesday", 3, 6],
  ["wednesday", 3, 6],
];

const hoursOfIvy = [
  ["thursday", 3, 8],
  ["saturday", 10, 14], // 10am - 2pm
];

const hoursOfJack = [
  ["monday", 3, 8],
  ["tuesday", 3, 8],
  ["wednesday", 3, 8],
  ["thursday", 3, 8],
  ["saturday", 10, 14], // 10am - 2pm — every day full coverage
];

const users = [
  new User("Kedus", hoursOfKedus),
  new User("Bob", hoursOfBob),
  new User("Alice", hoursOfAlice),
  new User("Charlie", hoursOfCharlie),
  new User("Diana", hoursOfDiana),
  new User("Eve", hoursOfEve),
  new User("Frank", hoursOfFrank), // wide availability mon/wed/thu
  new User("Grace", hoursOfGrace), // wide availability tue/thu/sat
  new User("Henry", hoursOfHenry), // early hours only mon/tue/wed
  new User("Ivy", hoursOfIvy), // thu/sat only, full coverage
  new User("Jack", hoursOfJack), // every day, full hours - stress tests point balancing
];

users[10].setPriority(2); // Jack - high priority
users[7].setPriority(1); // Grace - priority

const week = new SimplifiedWeek(users);
week.createSchedule(users);
console.log(week.toString());
