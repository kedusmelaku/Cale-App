const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  priority: { type: Number, default: 1 },
  days: [
    {
      day: { type: String, required: true },
      selected: { type: Boolean, default: false },
      start: { type: Number },
      end: { type: Number },
      startMinute: { type: Number, default: 0 },
      endMinute: { type: Number, default: 0 },
      allDay: { type: Boolean, default: false },
    },
  ],
  defaultStart: { type: Number },
  defaultEnd: { type: Number },
});

const Employee = mongoose.model("Employee", employeeSchema);

module.exports = Employee;