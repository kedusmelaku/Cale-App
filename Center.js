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
  // When passwordHash was last written — by either the manager setting
  // their own password or an admin generating a temp one. null on documents
  // that predate this field (we can't know retroactively), which the admin
  // UI renders as "Unknown" rather than guessing.
  passwordChangedAt: { type: Date, default: null },

  // ── Freeze ──────────────────────────────────────────────────────────
  // A frozen center's manager cannot sign in, and any existing session is
  // rejected on its next request (see requireAuth in server.js). Freezing
  // is the REVERSIBLE counterpart to deleting a center: nothing is
  // destroyed, and the center's employees can still submit availability
  // via the PIN form -- that path never goes through requireAuth. That's
  // deliberate: freeze/unfreeze must not cause permanent data loss, and a
  // missed submission window can't be recovered by unfreezing later.
  frozen: { type: Boolean, default: false },
  frozenAt: { type: Date, default: null },
  // ADMIN-ONLY. Never sent to a manager or included in any non-admin
  // response -- it's a private note about why this center was frozen
  // (billing, dispute, etc.), not a message for the customer.
  frozenReason: { type: String, default: "" },
});

const Center = mongoose.model("Center", centerSchema);

module.exports = Center;
