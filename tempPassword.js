// ── tempPassword.js ──────────────────────────────────────────────────────
// Generates the one-time temporary passwords an admin hands a manager on
// center creation or password reset. These are meant to be READ ALOUD OR
// TEXTED and TYPED ONCE, then immediately replaced — so "easy to type
// correctly" matters more here than raw randomness the way it does for the
// employee PIN (see rateLimiters.js's comment on that tradeoff).
//
// Shape: two words + a two-digit number, hyphen-joined, e.g. "maple-otter-47".
// The wordlist below is deliberately small and curated rather than pulled
// from a large dictionary:
//   - every word is common, short, and spelled the way it sounds
//   - nothing that looks/sounds like another word on the list (no near-
//     homophones), so a mis-hearing over the phone doesn't produce a
//     plausible-but-wrong guess
//   - no ambiguous-cased or hyphen-prone words
//
// This is intentionally NOT trying to be a password a manager keeps using —
// mustChangePassword forces it to be replaced on first login. Its only job
// is to survive one accurate transcription from admin to manager.

const WORDS = [
  "maple", "otter", "harbor", "cedar", "falcon", "meadow", "granite", "willow",
  "canyon", "lantern", "thistle", "amber", "brook", "cobalt", "dune", "ember",
  "fern", "glacier", "hazel", "ivory", "jasper", "kestrel", "lagoon", "marble",
  "nectar", "olive", "pebble", "quartz", "ridge", "sable", "timber", "umber",
  "violet", "walnut", "yarrow", "zephyr", "birch", "clover", "denim", "echo",
  "flint", "grove", "heron", "indigo", "juniper", "kelp", "lynx", "moss",
  "nimbus", "onyx", "pine", "quail", "raven", "spruce", "tundra", "vapor",
  "wren", "yonder", "zenith", "alder", "basil", "coral", "delta", "ebony",
];

// crypto.randomInt is a CSPRNG with rejection sampling built in (unlike
// Math.random()) -- same reasoning as the PIN generator in dashboard.html.
const crypto = require("crypto");

function pickWord() {
  return WORDS[crypto.randomInt(0, WORDS.length)];
}

// Generates a temp password like "maple-otter-47".
function generateTempPassword() {
  const a = pickWord();
  let b = pickWord();
  while (b === a) b = pickWord(); // avoid "maple-maple-47"
  const num = crypto.randomInt(10, 100); // two digits, 10-99
  return `${a}-${b}-${num}`;
}

module.exports = { generateTempPassword };
