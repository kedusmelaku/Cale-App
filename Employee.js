const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
  centerId: { type: String, required: true },
  name: { type: String, required: true },
  priority: { type: Number, default: 1 },
  // Availability per day, in canonical minutes since midnight (24-hour).
  // Same shape as Submission.days. `blocks` is the source of truth for the
  // scheduling engine; `allDay` is a UI hint for "the whole operating window".
  days: [
    {
      _id:      false,
      day:      { type: String, required: true },
      selected: { type: Boolean, default: false },
      allDay:   { type: Boolean, default: false },
      blocks: [
        {
          _id:   false,
          start: { type: Number, required: true }, // minutes since midnight
          end:   { type: Number, required: true },
        },
      ],
    },
  ],
  // Legacy engine inputs — still read by the current /generate route as a
  // fallback. Retired in the engine-migration section.
  defaultStart: { type: Number },
  defaultEnd: { type: Number },
  pin: { type: String, default: "" },
});

employeeSchema.index({ centerId: 1 });
const Employee = mongoose.model("Employee", employeeSchema);

module.exports = Employee;