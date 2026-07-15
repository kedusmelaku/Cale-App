const mongoose = require("mongoose");

// One document per rate-limit key (e.g. "login:1.2.3.4:arlington-heights").
//
// WHY THIS IS IN MONGO AND NOT IN MEMORY
// --------------------------------------
// express-rate-limit's default store keeps counters in process memory. That is
// fine on a long-lived server and useless here: this app runs as Vercel
// serverless functions, so
//   - every cold start begins with an empty counter, and
//   - concurrent instances each keep their own counter, multiplying the real
//     limit by however many instances happen to be warm.
// An attacker doesn't even need to try to defeat that; ordinary traffic
// patterns do it by accident. So counters live in MongoDB for the same reason
// OAuthToken does: it's the only state all instances share.
//
// The TTL index below lets MongoDB delete expired windows on its own, so the
// collection self-cleans and we never have to sweep it.

const rateLimitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  hits: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
});

// TTL index: Mongo removes each document once expiresAt passes.
// NOTE: Mongo's TTL monitor runs about once a minute, so documents linger
// briefly after expiry. That's harmless — increment() below compares
// expiresAt itself and starts a fresh window regardless of whether the old
// document has actually been reaped yet.
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit = mongoose.model("RateLimit", rateLimitSchema);

module.exports = RateLimit;
