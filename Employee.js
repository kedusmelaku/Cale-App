const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
  centerId: { type: String, required: true },
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
  // 4-digit PIN set by the manager, used by the employee to access the
  // public availability submission form. Stored as a string to preserve
  // leading zeros (e.g. "0042").
  pin: { type: String, default: "" },
});

employeeSchema.index({ centerId: 1 });
const Employee = mongoose.model("Employee", employeeSchema);

module.exports = Employee;