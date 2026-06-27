const mongoose = require("mongoose");

// One document per employee per week. Records the availability an employee
// submitted via the public /availability form for a given week.
// submittedAt is used as the first-come-first-served tiebreaker within the
// same priority level in the scheduling algorithm.

const submissionSchema = new mongoose.Schema({
  centerId:     { type: String, required: true },
  employeeId:   { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Employee" },
  employeeName: { type: String, required: true },

  // ISO date string for the Monday of the week this submission covers
  // e.g. "2026-06-30"
  weekOf: { type: String, required: true },

  // Same shape as Employee.days — array of day availability objects
  days: [
    {
      day:         { type: String, required: true },
      selected:    { type: Boolean, default: false },
      start:       { type: Number },
      end:         { type: Number },
      startMinute: { type: Number, default: 0 },
      endMinute:   { type: Number, default: 0 },
      allDay:      { type: Boolean, default: false },
    },
  ],

  // When the employee submitted — used for first-come-first-served ordering
  submittedAt: { type: Date, default: Date.now },
});

// One submission per employee per week per center
submissionSchema.index({ centerId: 1, employeeId: 1, weekOf: 1 }, { unique: true });

const Submission = mongoose.model("Submission", submissionSchema);

module.exports = Submission;
