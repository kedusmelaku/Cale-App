const mongoose = require("mongoose");

// One document per center. Stores the availability submission window
// (when employees can submit their availability for the upcoming week)
// and any other per-center configuration that doesn't belong in env vars.

const centerSettingsSchema = new mongoose.Schema({
  centerId: { type: String, required: true, unique: true },

  // Availability submission window
  // windowOpen / windowClose are stored as Date objects (UTC).
  // null means no window has been configured yet.
  windowOpen:  { type: Date, default: null },
  windowClose: { type: Date, default: null },
});

const CenterSettings = mongoose.model("CenterSettings", centerSettingsSchema);

module.exports = CenterSettings;
