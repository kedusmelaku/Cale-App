// ── rateLimiters.js ─────────────────────────────────────────────────────────
// Rate limiting for the endpoints an attacker can hammer without credentials:
// the two login routes and the employee PIN lookup.
//
// WHAT THIS IS AND ISN'T
// ----------------------
// Every limiter here is keyed on IP, because before a caller has authenticated
// the IP is the only signal about who they are. The alternatives are worse:
// keying on centerId means anyone can lock a center out of its own form by
// spamming wrong PINs, and the PIN itself is the secret being guessed.
//
// IP is a weak identifier, and this is a speed bump rather than a lock. An
// attacker rotating through cheap proxies gets a fresh bucket per address and
// walks straight past it. What this stops is a script hammering from a single
// address. What actually secures the PIN endpoint is the PIN's own length —
// see dashboard.html's generateUniquePin.
//
// Every request counts, successes included — a limiter that refunded successes
// would let anyone holding one valid credential farm the endpoint. Instead, the
// two LOGIN routes call clearRateLimit() once a password actually checks out,
// which wipes that key's counter entirely. So honest users who fumble their
// password a few times and then get in carry no penalty, while a guesser — who
// never succeeds — keeps accumulating. See clearRateLimit() at the bottom for
// why the PIN lookup deliberately does NOT do this.
//
// TUNING: the numbers in LIMITS are the knobs. They're deliberately in one
// place — raise them if real users ever hit a wall.
// ────────────────────────────────────────────────────────────────────────────

const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const RateLimit = require("./RateLimit");

const MINUTE = 60 * 1000;

const LIMITS = {
  // Manager login. Five wrong passwords in 15 minutes is far past honest
  // mistyping and well short of useful for guessing.
  login: { windowMs: 15 * MINUTE, max: 5 },

  // Admin login. Only ever used by you, from a handful of devices, so this can
  // be much tighter than a customer-facing route.
  adminLogin: { windowMs: 60 * MINUTE, max: 5 },

  // PIN lookup. The most brute-forceable endpoint in the app: the route is a
  // clean oracle (404 vs 200 tells the caller whether a guess was right). With
  // 6-digit PINs the space is 900,000 wide, so 10 guesses per 10 minutes from
  // one address is nowhere near enough to search it.
  //
  // Be clear about what this does and doesn't buy: it's keyed on IP, and IP is
  // the only signal available before authentication. An attacker rotating
  // through cheap proxies gets a fresh bucket per address and walks straight
  // past it. This stops a script hammering from one place; it is a speed bump,
  // not a lock. The PIN's own length is what actually secures this endpoint —
  // which is why it's 6 digits and generated with a CSPRNG (see
  // dashboard.html's generateUniquePin and migrate-pins.js).
  pinLookup: { windowMs: 10 * MINUTE, max: 10 },

  // Change-password. Reached either right after login (holding a valid
  // change-password token) or from the dashboard. It isn't a credential
  // oracle the way login/PIN are -- the token itself isn't guessable -- but
  // it's still an unauthenticated-by-cookie endpoint an attacker could hit
  // if they somehow obtained a token, so it gets the same speed-bump
  // treatment as the others.
  changePassword: { windowMs: 15 * MINUTE, max: 8 },
};

// ── Mongo-backed store ──────────────────────────────────────────────────────
// Implements the express-rate-limit v7 Store interface against MongoDB, so all
// serverless instances share one counter. See RateLimit.js for why memory
// won't do.
class MongoStore {
  // Tells express-rate-limit this store is shared across instances (as opposed
  // to MemoryStore), so its double-counting validator doesn't misfire.
  localKeys = false;

  init(options) {
    this.windowMs = options.windowMs;
  }

  // Atomically bump the counter for `key`, starting a new window if the old
  // one has lapsed.
  //
  // This is a single aggregation-pipeline update rather than a read-then-write
  // precisely because it has to be atomic: two instances handling two guesses
  // at the same moment must not both read "hits: 4" and both write "hits: 5",
  // which is how a limit of 5 quietly becomes a limit of 10 under exactly the
  // concurrent load an attacker generates. $$NOW is evaluated by the server, so
  // the window comparison doesn't depend on any instance's clock either.
  async increment(key) {
    const resetTime = new Date(Date.now() + this.windowMs);
    const doc = await RateLimit.findOneAndUpdate(
      { key },
      [
        {
          $set: {
            // Still inside the window → add one. Otherwise this is the first
            // hit of a fresh window.
            hits: {
              $cond: [
                { $gt: ["$expiresAt", "$$NOW"] },
                { $add: [{ $ifNull: ["$hits", 0] }, 1] },
                1,
              ],
            },
            // Keep the existing deadline while the window is live; a lapsed
            // window (or a brand-new key) gets a fresh one. Note this makes the
            // window fixed, not sliding — it does not extend on every request.
            expiresAt: {
              $cond: [{ $gt: ["$expiresAt", "$$NOW"] }, "$expiresAt", resetTime],
            },
          },
        },
      ],
      {
        upsert: true,
        new: true,
        // REQUIRED by Mongoose 9. Passing an aggregation pipeline (an array)
        // to findOneAndUpdate silently worked in Mongoose 8 and earlier; 9
        // throws unless you opt in explicitly:
        //   "Cannot pass an array to query updates unless the
        //    `updatePipeline` option is set."
        // Without this every call to increment() throws, which — because the
        // limiter sits in front of both login routes — took the whole app's
        // auth down. See lib/query.js:3528 in mongoose 9.
        updatePipeline: true,
      },
    );
    return { totalHits: doc.hits, resetTime: doc.expiresAt };
  }

  // Required by the Store interface. Nothing calls it while every limiter
  // counts all requests, but a future limiter using skipSuccessfulRequests
  // would need it.
  async decrement(key) {
    await RateLimit.findOneAndUpdate(
      { key, hits: { $gt: 0 } },
      { $inc: { hits: -1 } },
    );
  }

  async resetKey(key) {
    await RateLimit.deleteOne({ key });
  }

  async resetAll() {
    await RateLimit.deleteMany({});
  }
}

// ── Key generation ──────────────────────────────────────────────────────────
// req.ip is only trustworthy because server.js sets `trust proxy` to 1 — see
// the comment there. Anything that reads req.ip depends on that being right.
//
// Every key runs the address through ipKeyGenerator() rather than using req.ip
// raw. This is not cosmetic: an IPv6 client is normally allocated a whole /64
// prefix, so keying on the full address would let one attacker walk through
// billions of "different" IPs from a single machine and never hit a limit —
// IPv6 traffic would be effectively unlimited. ipKeyGenerator() collapses the
// address to its subnet so the whole allocation shares one bucket. IPv4
// addresses pass through unchanged.
//
// Login keys include the account being targeted as well as the IP. Keying on
// IP alone would let one attacker's failures against center A eat the budget
// for an innocent user at center B who happens to share an office IP. Keying
// on the account alone would be worse: anyone could lock a center out of their
// own app by failing logins against it on purpose. IP+account means an attacker
// can only ever lock out the pair they're actually attacking.
const ipKey = (prefix) => (req) => `${prefix}:${ipKeyGenerator(req.ip)}`;
const ipAccountKey = (prefix, field) => (req) => {
  const account = String(req.body?.[field] || "unknown")
    .trim()
    .toLowerCase()
    .slice(0, 64); // bound the key: the body is attacker-controlled
  return `${prefix}:${ipKeyGenerator(req.ip)}:${account}`;
};

function build({ windowMs, max }, keyGenerator, message) {
  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator,
    store: new MongoStore(),
    // Every request counts, successes included — see the header. Note this
    // means the store never needs decrement(), which is only called by
    // skipSuccessfulRequests; it stays implemented to satisfy the Store
    // interface.
    standardHeaders: true, // RateLimit-* headers, so the client can see limits
    legacyHeaders: false,
    message: { error: message },
    // Fail OPEN if the store itself errors. This is a deliberate tradeoff, and
    // it was bought the hard way: a bug in MongoStore.increment() made every
    // call throw, and because express-rate-limit fails closed by default, that
    // turned a rate-limiting bug into a total auth outage — nobody could log in
    // at all.
    //
    // The reasoning: this limiter is a speed bump against casual guessing, not
    // the thing securing the PIN (its length does that). Trading "an attacker
    // gets un-throttled while Mongo is unreachable" against "no customer can
    // sign in while Mongo is unreachable" is not a close call — and if Mongo is
    // down, login is broken anyway, since it needs the DB to check the password.
    //
    // NOTE: this only covers STORE failures. Actually hitting the limit still
    // returns 429 as normal.
    passOnStoreError: true,
    // Deliberately NOT disabling the trustProxy validator: if `trust proxy`
    // is ever misconfigured, we want the loud startup error rather than a
    // limiter that silently keys every user to the same proxy IP.
  });
}

const loginLimiter = build(
  LIMITS.login,
  ipAccountKey("login", "centerId"),
  "Too many sign-in attempts. Please wait 15 minutes and try again.",
);

const adminLoginLimiter = build(
  LIMITS.adminLogin,
  ipKey("admin-login"),
  "Too many sign-in attempts. Please wait an hour and try again.",
);

const pinLookupLimiter = build(
  LIMITS.pinLookup,
  ipAccountKey("pin", "centerId"),
  "Too many attempts. Please wait a few minutes, then check your PIN with your manager.",
);

// Keyed on IP alone: at this point the caller only holds an opaque token,
// not a centerId we can trust from the body without first verifying it.
const changePasswordLimiter = build(
  LIMITS.changePassword,
  ipKey("change-password"),
  "Too many attempts. Please wait 15 minutes and try again.",
);

// ── Clearing a counter after a successful sign-in ───────────────────────────
// Call this from a route once the credential has actually checked out. It
// wipes the counter rather than refunding a single request, which is the
// difference that matters: someone who mistypes their password three times and
// then gets it right should be back to a clean slate, not sitting one mistake
// away from a lockout for the next 15 minutes.
//
// This is safe for the LOGIN routes specifically, because each of their keys
// maps to exactly one credential (IP+centerId → that center's password;
// IP → the single admin password). Succeeding proves you hold that credential,
// so there is nothing left for the counter to protect.
//
// It is deliberately NOT used on the PIN lookup. That key is (IP, centerId),
// and MANY PINs are valid under it — one per employee. An employee attacking
// their own center could guess nine times, look up their OWN PIN to wipe the
// counter, and repeat forever. Resetting there would hand unlimited guesses to
// exactly the person most likely to be attacking.
function clearRateLimit(limiter, req) {
  if (req.rateLimit && req.rateLimit.key) {
    limiter.resetKey(req.rateLimit.key);
  }
}

module.exports = {
  LIMITS,
  MongoStore,
  clearRateLimit,
  loginLimiter,
  adminLoginLimiter,
  pinLookupLimiter,
  changePasswordLimiter,
};
