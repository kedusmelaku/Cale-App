const mongoose = require("mongoose");

// One document per center. Stores the center's display name, unique centerId
// slug, and bcrypt-hashed manager password.

const centerSchema = new mongoose.Schema({
  centerId: { type: String, required: true, unique: true },
  name:     { type: String, required: true },
  passwordHash: { type: String, required: true },
});

const Center = mongoose.model("Center", centerSchema);

module.exports = Center;
