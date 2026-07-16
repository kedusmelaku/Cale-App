const mongoose = require("mongoose");

// One document per center. Stores the center's display name, unique centerId
// slug, and bcrypt-hashed manager password.

const centerSchema = new mongoose.Schema({
  centerId: { type: String, required: true, unique: true },
  name:     { type: String, required: true },
  passwordHash: { type: String, required: true },
  // True whenever the CURRENT passwordHash was chosen by the admin (new
  // center creation, or an admin-triggered password reset) rather than by
  // the manager themselves. While true, /api/login will not issue a normal
  // session -- it issues a short-lived change-password token instead, and
  // the manager must set their own password before reaching the dashboard.
  // Defaults to false, which is what every pre-existing document reads as
  // (Mongoose applies schema defaults for missing fields at read time), so
  // this is safe to add without any migration.
  mustChangePassword: { type: Boolean, default: false },
});

const Center = mongoose.model("Center", centerSchema);

module.exports = Center;
