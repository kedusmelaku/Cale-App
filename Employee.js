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
  // Employee PIN for the public availability form. 6 digits, stored as a
  // String (not Number) so a leading zero can never be silently dropped.
  //
  // "" is a valid, meaningful state — the admin and dashboard both render a
  // "No PIN" badge for it — so the validator below only applies to non-empty
  // values. This is the ONLY server-side check on PIN shape: the PIN is
  // generated client-side in dashboard.html and POSTed here, so without this a
  // 4-digit (or arbitrary) PIN would still be accepted regardless of what the
  // form says.
  pin: {
    type: String,
    default: "",
    validate: {
      validator: (v) => v === "" || /^\d{6}$/.test(v),
      message: "PIN must be exactly 6 digits.",
    },
  },
});

employeeSchema.index({ centerId: 1 });
const Employee = mongoose.model("Employee", employeeSchema);

module.exports = Employee;