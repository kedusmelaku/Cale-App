require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./User");
const Week = require("./Week");
const Day = require("./Day");
// SimplifiedWeek/SimplifiedDay ("normal" mode): dormant. Not reachable from
// either UI anymore (see /generate below), but left imported and wired so
// normal mode can be reconnected without re-deriving this plumbing.
const SimplifiedWeek = require("./SimplifiedWeek");
const SimplifiedDay = require("./SimplifiedDay");
const Employee = require("./Employee");
const CenterSettings = require("./CenterSettings");
const Submission = require("./Submission");
const OAuthToken = require("./OAuthToken");
const Center = require("./Center");
const mongoose = require("mongoose");
const {
  defaultSchedule,
  getActiveVariant,
  resolveActiveName,
  validateSchedule,
  normalizeSchedule,
  variantToDayConfigs,
} = require("./scheduleConfig");

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET env var is not set");
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.error("FATAL: ADMIN_PASSWORD env var is not set");
  process.exit(1);
}
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);

let _mongoConnected = false;
async function connectDB() {
  if (_mongoConnected && mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI);
  _mongoConnected = true;
  console.log("MongoDB connected");
}

const app = express();

// ── Security headers (helmet) ───────────────────────────────────────────────
// Headers are instructions to the BROWSER: "refuse to do X". They cost nothing
// at runtime and close off categories of attack server-side code can't reach.
//
// Mounted before express.static so the static pages get them too.
//
// A NOTE ON script-src 'unsafe-inline'
// ------------------------------------
// The biggest thing CSP can do about XSS is refuse to execute inline script.
// This app can't take that today: every page carries its logic in one large
// inline <script> (~100KB on the dashboard), there are ~119 inline onclick=
// handlers in the static markup, and the OAuth callback page below is an inline
// script too. Turning inline script off would blank every page.
//
// So 'unsafe-inline' is here deliberately, with eyes open: this CSP is NOT an
// XSS backstop. That's an acceptable trade because XSS is already fixed at the
// source -- public/safe-html.js escapes every interpolation by default, and no
// generated markup carries inline handlers. CSP would have been defence in
// depth on a bug class already closed.
//
// To upgrade later: move each page's inline <script> into its own .js file and
// convert the static onclick= handlers to addEventListener (the generated ones
// are already done). Then drop 'unsafe-inline' from scriptSrc -- nothing else
// here needs to change.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        // Same-origin scripts (/safe-html.js, /utils.js, /analytics.js,
        // /_vercel/insights/script.js) are all covered by 'self'.
        scriptSrc: ["'self'", "'unsafe-inline'"],

        // SEPARATE directive from scriptSrc, and helmet defaults it to 'none'.
        // script-src-attr governs inline EVENT HANDLER ATTRIBUTES specifically,
        // and 'unsafe-inline' on scriptSrc does not cover it. Left at helmet's
        // default, this would silently kill all ~119 static onclick= handlers:
        // pages would render perfectly and no button would do anything.
        // Delete this line at the same time as the scriptSrc 'unsafe-inline' —
        // i.e. once the static handlers become addEventListener calls.
        scriptSrcAttr: ["'unsafe-inline'"],

        // styles.css does @import url(https://fonts.googleapis.com/...), and
        // login.html links it directly, so that origin must be allowed.
        // 'unsafe-inline' is needed for style="" attributes -- the scheduler
        // timeline computes style="top:...;height:..." per shift block, so it
        // can't be dropped without rewriting layout. Style injection is a far
        // weaker primitive than script injection, so this concession is much
        // cheaper than the script one.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],

        // Google serves the font FILES from a different host than the CSS.
        fontSrc: ["'self'", "https://fonts.gstatic.com"],

        imgSrc: ["'self'", "data:"], // logo.svg, login-bg.png
        connectSrc: ["'self'"], // every fetch() targets our own API
        objectSrc: ["'none'"], // no plugins/embeds, ever
        frameAncestors: ["'none'"], // nobody may iframe Cale -- blocks clickjacking
        baseUri: ["'self'"], // an injected <base> can't repoint relative URLs
        formAction: ["'self'"], // a form can't be aimed at another origin
        upgradeInsecureRequests: [],
      },
    },

    // MUST be same-origin-allow-popups, NOT helmet's same-origin default.
    //
    // The Google Calendar flow opens a popup (window.open -> accounts.google.com)
    // and the callback page at /oauth/callback calls
    //   window.opener.postMessage({ type: 'oauth_success' }, '*')
    // to tell the dashboard it worked. COOP: same-origin severs window.opener
    // as soon as the popup goes cross-origin, so that message would never
    // arrive: the popup opens, the manager approves access, and the dashboard
    // just sits there -- a silent failure with nothing in the logs.
    // same-origin-allow-popups keeps the opener link for popups this app opens
    // itself, while still stopping other sites getting a handle on our windows.
    // privacy.html's "Back to app" button relies on window.opener too.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

// ── Proxy trust ─────────────────────────────────────────────────────────────
// This app runs behind Vercel's proxy, so the TCP peer is always Vercel, not
// the visitor. Without this, req.ip is the proxy's address for EVERY request,
// which would make the rate limiters below count all users as one person: a
// single attacker would lock out every real customer at once.
//
// The value is 1 (trust exactly one hop), NOT `true`. `true` tells Express to
// take the leftmost X-Forwarded-For entry as the client IP — but that header is
// just a request header, so an attacker can send any value they like and get a
// fresh rate-limit bucket per request, bypassing the limiter completely. With
// 1, Express takes the entry Vercel itself appended and ignores anything the
// client tried to prepend.
//
// If this app is ever moved off Vercel, or another proxy/CDN is put in front of
// it, this number must change to match the real number of hops — see
// https://expressjs.com/en/guide/behind-proxies.html
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// The rate limiters read and write counters in MongoDB, and they run BEFORE
// the route handlers that would normally call connectDB(). On a cold start
// that ordering means the store would issue a query with no connection open,
// and mongoose would buffer it until it timed out. Gating the limited routes
// on this keeps the connection setup in one place instead of duplicating
// connectDB() into every limiter.
async function ensureDB(req, res, next) {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("ensureDB:", err.message);
    res.status(503).json({ error: "Service temporarily unavailable." });
  }
}

const {
  clearRateLimit,
  loginLimiter,
  adminLoginLimiter,
  pinLookupLimiter,
  changePasswordLimiter,
} = require("./rateLimiters");
const { generateTempPassword } = require("./tempPassword");

// Issues the normal 7-day manager session cookie. Pulled out of /api/login
// so /api/change-password can issue the exact same cookie once a manager
// finishes setting their own password.
function issueSessionCookie(res, centerId) {
  const token = jwt.sign({ centerId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  res.setHeader(
    "Set-Cookie",
    `token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// Reads a signed JWT from the "token" cookie. Each serverless function
// instance verifies the SIGNATURE independently — no shared session store.
// Page routes redirect to /login. API routes return 401 JSON.
//
// A NOTE ON THE DATABASE READ BELOW
// ---------------------------------
// This middleware used to be pure crypto with zero I/O. It isn't anymore,
// because freezing a center has to take effect IMMEDIATELY, and these
// sessions are stateless 7-day JWTs: there is no session row to delete, so
// a frozen manager's existing cookie stays cryptographically valid for up
// to a week. The only way to revoke it is to check something authoritative
// on each request. That's the cost freeze buys, and it's paid here.
//
// In practice the marginal cost is small: nearly every route behind this
// middleware already opens a Mongo connection and queries. The exceptions
// are the two page routes (/ and /scheduler), which now do one small
// indexed lookup before sending a static file.
// ─────────────────────────────────────────────────────────────────────────────
function getTokenFromRequest(req) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? match[1] : null;
}

// Clears the session cookie. Used when a frozen center's session is
// rejected, so the browser stops replaying a cookie that will never work
// again — otherwise every subsequent request re-does the DB lookup just to
// be told no.
function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
  );
}

function denyAuth(req, res, { frozen } = {}) {
  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"))
  ) {
    return res.status(401).json(
      frozen
        ? { error: "This account has been frozen.", frozen: true }
        : { error: "Not authenticated." },
    );
  }
  res.redirect(frozen ? "/login?frozen=1" : "/login");
}

async function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return denyAuth(req, res);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
    // A valid signature is not enough — it must be a CENTER token.
    //
    // The admin session uses the same cookie name and the same signing
    // secret, so an admin JWT verifies perfectly here. Without this check it
    // fell straight through to next() with req.centerId === undefined, and
    // every downstream query ran with centerId: undefined. The result was a
    // dashboard that rendered but stayed permanently empty — and because the
    // token really was valid, reloading never redirected to /login, so the
    // only escape was signing out by hand.
    //
    // It's benign today only because centerId is `required` in every schema,
    // so { centerId: null } matches nothing. Any future query where a missing
    // centerId means "match everything" would turn this into a cross-tenant
    // leak. Fail closed here instead of relying on that.
    if (!payload.centerId) throw new Error("Not a center token");
  } catch {
    /* invalid, expired, or an admin token */
    return denyAuth(req, res);
  }

  // The token is good. Now: is this center frozen right now?
  try {
    await connectDB();
    const center = await Center.findOne(
      { centerId: payload.centerId },
      { frozen: 1 },
    ).lean();

    // The center was deleted out from under a live session.
    if (!center) {
      clearSessionCookie(res);
      return denyAuth(req, res);
    }

    if (center.frozen) {
      clearSessionCookie(res);
      return denyAuth(req, res, { frozen: true });
    }
  } catch (err) {
    // FAIL OPEN, deliberately — same reasoning as passOnStoreError in
    // rateLimiters.js, and bought by the same outage (see the handoff's
    // "incident worth remembering").
    //
    // The trade: if Mongo is unreachable, a frozen center gets through this
    // check. But EVERY route behind this middleware reads its data from
    // Mongo, so what they get through to is a dashboard that can't load
    // anything — the freeze's actual purpose (the app is unusable to them)
    // still holds incidentally. Failing closed instead would bounce every
    // legitimate manager to /login during a transient blip, and /login
    // needs Mongo too, so they couldn't get back in. That's the exact
    // shape of the outage this codebase already learned from once.
    //
    // NOTE this makes a failure here SILENT. If freeze enforcement ever
    // becomes load-bearing (a hostile ex-customer rather than a billing
    // nudge), this is the line to revisit.
    console.error("requireAuth frozen-check:", err.message);
  }

  req.centerId = payload.centerId;
  next();
}

// Admin-only middleware — uses a separate ADMIN_PASSWORD, no centerId needed
function requireAdmin(req, res, next) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.admin) return next();
    } catch {}
  }
  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"))
  ) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  res.redirect("/admin/login");
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get("/login", (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.centerId) return res.redirect("/");
    } catch {}
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/scheduler", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "scheduler.html"));
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/login", ensureDB, loginLimiter, async (req, res) => {
  try {
    await connectDB();
    const { centerId, password } = req.body;
    if (!centerId || !password)
      return res
        .status(400)
        .json({ error: "Center ID and password required." });

    const center = await Center.findOne({
      centerId: centerId.trim().toLowerCase(),
    });
    if (!center)
      return res
        .status(401)
        .json({ error: "Incorrect Center ID or password." });

    const match = await bcrypt.compare(password, center.passwordHash);
    if (!match)
      return res
        .status(401)
        .json({ error: "Incorrect Center ID or password." });

    // Correct password — wipe this key's failed-attempt counter. Someone who
    // fumbles their password twice and then gets it right shouldn't spend the
    // next 15 minutes one mistake from a lockout. This applies regardless of
    // mustChangePassword below: they still proved they hold the credential.
    clearRateLimit(loginLimiter, req);

    // Frozen: the password is correct, but this account is switched off.
    // Checked AFTER the password so a frozen center's ID can't be used as
    // an oracle by someone who doesn't hold the credential. The manager is
    // told the account is frozen but never sees frozenReason — that note is
    // admin-only (see Center.js).
    if (center.frozen) {
      return res.status(403).json({
        error:
          "This account has been frozen. Please contact support to restore access.",
        frozen: true,
      });
    }

    // The password just checked out is a temp one the admin chose (new
    // center, or an admin-triggered reset). Do NOT issue the normal session
    // cookie — that would let them reach the dashboard on a credential only
    // the admin has ever seen. Instead issue a short-lived, single-purpose
    // token that can only be used against /api/change-password. It's
    // returned in the JSON body, not a cookie, so it lives only in the
    // login page's memory and dies with the tab if unused.
    if (center.mustChangePassword) {
      const changeToken = jwt.sign(
        { centerId: center.centerId, purpose: "password-change" },
        process.env.JWT_SECRET,
        { expiresIn: "15m" },
      );
      return res.json({ mustChangePassword: true, changeToken });
    }

    issueSessionCookie(res, center.centerId);
    res.json({ ok: true });
  } catch (err) {
    console.error("/api/login:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Redeems a change-password token (issued by /api/login above, only when
// mustChangePassword is true) for a permanent password, then issues the
// same session cookie a normal login would. This is the only path that
// clears mustChangePassword — both "first login on a new center" and
// "manager forgot their password" (admin resets it, which sets
// mustChangePassword again) end up here. A voluntary password change from
// an already-logged-in session is a separate concern, out of scope for now.
app.post(
  "/api/change-password",
  ensureDB,
  changePasswordLimiter,
  async (req, res) => {
    try {
      await connectDB();
      const { changeToken, newPassword } = req.body;
      if (!changeToken || !newPassword) {
        return res
          .status(400)
          .json({ error: "Change token and new password are required." });
      }
      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ error: "New password must be at least 8 characters." });
      }

      let payload;
      try {
        payload = jwt.verify(changeToken, process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({
          error: "This session has expired. Please sign in again with your temporary password.",
        });
      }
      // The purpose claim is load-bearing: everything is signed with the
      // same JWT_SECRET, so without checking this a manager's normal login
      // cookie (or anything else signed with the same secret) would be
      // accepted here too. Same pattern as the availability-submit token.
      if (payload.purpose !== "password-change" || !payload.centerId) {
        return res.status(401).json({ error: "Invalid change token." });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      const center = await Center.findOneAndUpdate(
        // Frozen centers are excluded from the match, not checked
        // afterwards: a change token issued moments BEFORE a freeze is
        // still signature-valid for its full 15 minutes, and redeeming it
        // would mint a fresh session cookie for an account that's supposed
        // to be switched off. Filtering here closes that window atomically
        // rather than read-then-write.
        { centerId: payload.centerId, frozen: { $ne: true } },
        {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
        { new: true },
      );
      if (!center) {
        // Either the center is gone, or it's frozen. Don't distinguish.
        return res.status(403).json({
          error: "This account is not available. Please contact support.",
        });
      }

      issueSessionCookie(res, center.centerId);
      res.json({ ok: true });
    } catch (err) {
      console.error("/api/change-password:", err.message);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  },
);

app.post("/api/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE OAUTH
//
// Flow:
//   1. Browser hits GET /oauth/start  → server returns a Google consent URL
//   2. Browser opens that URL in a new tab
//   3. User approves → Google redirects to GET /oauth/callback?code=...
//   4. Server exchanges code for tokens, stores them on the auth client
//   5. Callback page posts "oauth_success" to the opener window
//   6. App shows success, prompts user to save token to Vercel env var
// ─────────────────────────────────────────────────────────────────────────────

app.get("/oauth/start", requireAuth, (req, res) => {
  try {
    const { getAuth } = require("./auth");
    const auth = getAuth();
    const crypto = require("crypto");
    const state = crypto.randomBytes(16).toString("hex");
    const url = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      state,
    });
    res.json({ url });
  } catch (err) {
    console.error("/oauth/start:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/oauth/callback", requireAuth, async (req, res) => {
  // ── Cross-Origin-Opener-Policy: unsafe-none, ONLY on this route ──────────
  //
  // helmet's app.use() above is global and unscoped, so every response --
  // including this one -- gets `COOP: same-origin-allow-popups`. That value
  // is correct for the DASHBOARD (the opener), but wrong for THIS page (the
  // popup), and it silently breaks the whole connect flow.
  //
  // Per the COOP rules: two `same-origin-allow-popups` documents share a
  // browsing context group only if they are same-origin AND both set it.
  // This page is navigated to FROM accounts.google.com -- cross-origin --
  // so it lands in a NEW browsing context group and `window.opener` is null.
  // The script below is guarded on window.opener, so nothing is posted to
  // the dashboard and window.close() never runs: the tab just sits on the
  // success screen forever and the dashboard never flips to its own success
  // state. Before helmet was added there was no COOP header at all, this
  // page was unsafe-none, and it worked.
  //
  // `unsafe-none` documents CAN join the opener's group when the opener is
  // same-origin-allow-popups -- which the dashboard is -- so this restores
  // the link. Scoped to this route only: every other page keeps the strict
  // header. The exposure is limited to this page, which holds no data of
  // its own, renders a fixed success message, and immediately closes.
  //
  // If the connect flow ever silently stops closing the tab again, check
  // this header first.
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");

  const { code, state } = req.query;
  if (!code) return res.status(400).send("Missing code parameter from Google.");
  if (!state)
    return res
      .status(400)
      .send("Missing state parameter — possible CSRF attack.");

  try {
    await connectDB();
    const { getAuth, applyTokens } = require("./auth");
    const auth = getAuth();
    const { tokens } = await auth.getToken(code);
    await applyTokens(req.centerId, tokens);

    // Connection is now persisted in MongoDB — no manual env var step needed.
    res.send(`<!doctype html><html><head><title>Connected</title>
<style>
  body{font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;background:#f5f5f2;}
  h2{color:#217a4a;}
  .done{color:#217a4a;font-weight:bold;margin-top:20px;}
  .muted{color:#666;}
</style></head><body>
<h2>✅ Google Calendar connected!</h2>
<p>Cale is connected and ready. This connection is saved and will
persist automatically — there's nothing else you need to do.</p>
<p class="done">You can close this tab and return to the app.</p>
<p class="muted">This tab will try to close itself in a moment.</p>
<script>
  // Notify the original tab (dashboard/scheduler) that OAuth succeeded so it
  // can refresh its calendar status, then try to close this tab automatically.
  (function () {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'oauth_success' }, '*');
        setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
      }
    } catch (e) {}
  })();
</script>
</body></html>`);
  } catch (err) {
    // The raw error stays here, in the server log, where it's useful. It is
    // deliberately NOT rendered into the page: this screen is read by a
    // center director, and Google's error text ("invalid_grant", "redirect
    //_uri_mismatch") tells them nothing they can act on. Interpolating it
    // also put unescaped text straight into HTML, which is the pattern
    // safe-html.js exists to eliminate everywhere else.
    console.error("/oauth/callback:", err.message);
    res.status(500)
      .send(`<h2 style="font-family:sans-serif;color:red;padding:40px;">
      We couldn't finish connecting your Google Calendar.<br><br>
      Nothing on your account was changed. Please close this tab and try
      connecting again from Cale.<br><br>
      <a href="javascript:history.back()">Go back and try again</a>
    </h2>`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CAL STATUS — used by the frontend to show connected/disconnected dot
// ─────────────────────────────────────────────────────────────────────────────
// Is this center's Google Calendar connection actually usable RIGHT NOW?
//
// This is the single source of truth for every connection indicator in the
// app -- the settings dot, the dashboard pill, the warning banner, the
// calendar picker, the readiness check. They all read _calConnected, which
// comes from here, so this route's answer propagates to all of them.
//
// It used to answer a DIFFERENT question: "do we hold a token?"
//     !!(creds && (creds.access_token || creds.refresh_token))
// That is not the same thing. When someone revokes Cale's access from
// myaccount.google.com, Google invalidates the token on their end and tells
// us nothing -- our stored token stays byte-for-byte identical. So the
// presence check kept answering "connected" forever after a revocation,
// while /calendars (which makes a real call) correctly reported the
// disconnect. That's why the calendar dropdown said "reconnect" and every
// other indicator still claimed connected.
//
// verifyConnection() makes one cheap real call to Google and trusts THAT,
// and clears the dead token so the center self-heals. It already existed in
// auth.js, written for exactly this -- it just was never wired up here.
//
// THREE outcomes, not two:
//   true  -- verified live against Google
//   false -- verified dead (revoked, or no token at all)
//   null  -- COULDN'T verify (Google unreachable, DB down, creds missing)
//
// null matters. verifyConnection deliberately THROWS rather than returning
// false on a non-auth error, so a transient Google outage can't wipe a
// perfectly good token. Collapsing that into `false` here would undo the
// point: it would turn a 30-second Google hiccup into a red "Not connected"
// banner telling the manager to reconnect -- an action that requires an
// OAuth round-trip to the very service that's down, so it's guaranteed to
// fail. null renders as a neutral "Unknown" instead, and raises no alarm.
app.get("/cal-status", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { verifyConnection } = require("./auth");
    const connected = await verifyConnection(req.centerId);
    res.json({ connected });
  } catch (err) {
    // Non-auth failure. We genuinely don't know -- say so rather than
    // guessing in either direction.
    console.error("/cal-status:", err.message);
    res.json({ connected: null });
  }
});

app.post("/oauth/disconnect", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { clearTokens } = require("./auth");
    await clearTokens(req.centerId);
    res.json({ disconnected: true });
  } catch (err) {
    console.error("/oauth/disconnect:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALENDARS — lists every calendar the authenticated account can see, so the
// user can pick which one Cale reads student bookings from.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/calendars", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { google } = require("googleapis");
    const { getAuth, loadTokensFromDB } = require("./auth");
    await loadTokensFromDB(req.centerId);
    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.calendarList.list();
    const items = response.data.items || [];

    const calendars = items.map((c) => ({
      id: c.id,
      name: c.summaryOverride || c.summary || c.id,
      primary: !!c.primary,
      accessRole: c.accessRole,
    }));

    res.json({ calendars });
  } catch (err) {
    console.error("/calendars error:", err.message);
    const isAuth =
      [401, 403].includes(err.code) ||
      [
        "invalid_grant",
        "unauthorized",
        "No refresh token",
        "Token has been expired",
        "invalid_client",
      ].some((s) => err.message?.includes(s));
    res.status(isAuth ? 401 : 500).json({
      error: isAuth ? "auth" : "calendar_error",
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/events", requireAuth, async (req, res) => {
  const { monday, calendarId } = req.query;
  if (!monday) return res.status(400).json({ error: "monday date required" });
  try {
    await connectDB();
    const { loadTokensFromDB } = require("./auth");
    await loadTokensFromDB(req.centerId);
    const {
      getWeekEvents,
      DEFAULT_LESSON_KEYWORDS,
      DEFAULT_ONE_ON_ONE_KEYWORDS,
    } = require("./calendar");

    const settings = await CenterSettings.findOne({ centerId: req.centerId });
    const kw = settings && settings.calendarKeywords;
    // kw is only present once a center has actually configured this — a
    // center that HAS configured it but left one-on-one blank should get an
    // empty oneOnOneKeywords (that's the "we don't run those" signal), not
    // silently fall back to the hardcoded defaults.
    const lessonKeywords =
      kw && kw.lessonKeywords && kw.lessonKeywords.length
        ? kw.lessonKeywords
        : DEFAULT_LESSON_KEYWORDS;
    const oneOnOneKeywords = kw
      ? kw.oneOnOneKeywords || []
      : DEFAULT_ONE_ON_ONE_KEYWORDS;
    const lessonCaseSensitive = kw ? !!kw.lessonCaseSensitive : false;
    const oneOnOneCaseSensitive = kw ? !!kw.oneOnOneCaseSensitive : false;

    const { studentData, oneOnOneData } = await getWeekEvents(
      new Date(monday + "T00:00:00"),
      calendarId || "arlingtonheights@mathnasium.com",
      lessonKeywords,
      oneOnOneKeywords,
      lessonCaseSensitive,
      oneOnOneCaseSensitive,
    );
    res.json({ studentData, oneOnOneData });
  } catch (err) {
    console.error("/events error:", err.message);
    const isAuth =
      [401, 403].includes(err.code) ||
      [
        "invalid_grant",
        "unauthorized",
        "No refresh token",
        "Token has been expired",
        "invalid_client",
      ].some((s) => err.message?.includes(s));
    res.status(isAuth ? 401 : 500).json({
      error: isAuth ? "auth" : "calendar_error",
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────
app.get("/employees", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const result = await Employee.find({ centerId: req.centerId });
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/employees", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const employee = new Employee({ ...req.body, centerId: req.centerId });
    await employee.save();
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/employees/:id", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const deleted = await Employee.findOneAndDelete({
      _id: req.params.id,
      centerId: req.centerId,
    });
    if (!deleted) return res.status(404).json({ error: "Employee not found." });
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/employees/:id", requireAuth, async (req, res) => {
  try {
    await connectDB();
    // Strip centerId/_id from the payload so a request can never move a
    // record to another tenant, even if those fields are present in req.body.
    const { centerId, _id, ...updates } = req.body;
    const employee = await Employee.findOneAndUpdate(
      { _id: req.params.id, centerId: req.centerId },
      updates,
      // runValidators is required here: unlike .save(), findOneAndUpdate skips
      // schema validators by default. Without it, Employee's 6-digit PIN check
      // would apply when an employee is CREATED and be silently ignored every
      // time one is EDITED — which is exactly the path a stale 4-digit PIN
      // would come back through.
      { new: true, runValidators: true },
    );
    if (!employee) return res.status(404).json({ error: "Employee not found." });
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CENTER SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

app.get("/center-settings", requireAuth, async (req, res) => {
  try {
    await connectDB();
    let doc = await CenterSettings.findOne({ centerId: req.centerId });
    if (!doc)
      doc = {
        centerId: req.centerId,
        windowOpen: null,
        windowClose: null,
        tutorialCompleted: false,
        introSeen: false,
      };
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/center-settings", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const doc = await CenterSettings.findOneAndUpdate(
      { centerId: req.centerId },
      { ...req.body, centerId: req.centerId },
      { new: true, upsert: true },
    );
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public read-only center settings — used by the availability form (no auth)
app.get("/center-settings/:centerId", async (req, res) => {
  try {
    await connectDB();
    const { centerId } = req.params;
    let doc = await CenterSettings.findOne({ centerId });
    if (!doc)
      doc = {
        centerId,
        windowOpen: null,
        windowClose: null,
        tutorialCompleted: false,
        introSeen: false,
      };
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

// Get all submissions for the current center, optionally filtered by weekOf
app.get("/submissions", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const query = { centerId: req.centerId };
    if (req.query.weekOf) query.weekOf = req.query.weekOf;
    const submissions = await Submission.find(query).sort({ submittedAt: 1 });
    res.json({ data: submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee submits availability via the public form
app.post("/submissions", async (req, res) => {
  try {
    await connectDB();
    const { submitToken, weekOf, days } = req.body;

    // Identity comes from the TOKEN, never from the body.
    //
    // This is the whole point of the change. The body used to supply
    // centerId, employeeId AND employeeName, all unverified, so:
    //   - anyone with an employeeId could overwrite that employee's week
    //   - employeeName was free text, which is how attacker-chosen markup
    //     reached the manager's submissions list in the first place
    // Reading all three from the signed token means the client can only
    // choose WHAT they're available for, never WHO they are.
    if (!submitToken) {
      return res.status(401).json({
        error: "Please enter your PIN again before submitting.",
      });
    }

    let claims;
    try {
      claims = jwt.verify(submitToken, process.env.JWT_SECRET);
    } catch {
      // Covers both a tampered token and the ordinary case of the form
      // sitting open past the 2-hour expiry.
      return res.status(401).json({
        error: "Your session expired. Please enter your PIN again.",
      });
    }

    // A token minted for something else must not work here. Every token in
    // this app is signed with the same secret, so without this check a center
    // manager's login cookie would be accepted as a submission credential.
    if (claims.purpose !== "availability-submit") {
      return res.status(401).json({ error: "Invalid submission token." });
    }

    const centerId = claims.centerId;
    const employeeId = claims.employeeId;
    const employeeName = claims.name;

    if (!weekOf || !days) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Check submission window is currently open
    const settings = await CenterSettings.findOne({ centerId });
    const now = new Date();
    if (settings && settings.windowOpen && settings.windowClose) {
      if (
        now < new Date(settings.windowOpen) ||
        now > new Date(settings.windowClose)
      ) {
        return res
          .status(403)
          .json({ error: "The availability window is not currently open." });
      }
    }

    // Upsert — replace any existing submission for this employee+week
    const submission = await Submission.findOneAndUpdate(
      { centerId, employeeId, weekOf },
      {
        centerId,
        employeeId,
        employeeName,
        weekOf,
        days,
        submittedAt: new Date(),
      },
      { new: true, upsert: true },
    );
    res.json({ data: submission });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a submission (manager override)
app.delete("/submissions/:id", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const deleted = await Submission.findOneAndDelete({
      _id: req.params.id,
      centerId: req.centerId,
    });
    if (!deleted) return res.status(404).json({ error: "Submission not found." });
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC AVAILABILITY FORM
// Served at /availability/:centerId — employees enter their PIN and submit.
// ─────────────────────────────────────────────────────────────────────────────

app.get("/availability/:centerId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "availability.html"));
});

// PIN lookup — given a PIN and centerId, returns the matching employee
// PIN lookup — the most brute-forceable route in the app, and a clean oracle
// (404 vs 200 confirms a guess). Rate limited per IP; see rateLimiters.js for
// what that does and doesn't buy.
app.post("/availability/lookup", ensureDB, pinLookupLimiter, async (req, res) => {
  try {
    await connectDB();
    const { pin, centerId } = req.body;
    if (!pin || !centerId)
      return res.status(400).json({ error: "PIN and center ID required." });

    const employee = await Employee.findOne({ centerId, pin: pin.toString() });
    if (!employee)
      return res
        .status(404)
        .json({ error: "No employee found with that PIN." });

    // The PIN has now been proven. Issue a short-lived signed token carrying
    // WHO this is, so /submissions doesn't have to take the client's word for
    // it. Before this, the PIN guarded only the lookup: /submissions accepted
    // whatever employeeId and employeeName were in the request body, so anyone
    // who obtained an employeeId could overwrite that person's availability
    // forever, under any name they liked, without ever knowing a PIN.
    //
    // Deliberately NOT a cookie: the employee's browser may be shared, and this
    // is not a login. It lives in memory on the form's page and dies with the
    // tab. 2 hours is enough to fill the form out with interruptions, and short
    // enough that a stale token isn't a lingering credential.
    const submitToken = jwt.sign(
      {
        employeeId: employee._id.toString(),
        centerId: employee.centerId,
        name: employee.name,
        purpose: "availability-submit",
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );

    res.json({
      submitToken,
      data: {
        _id: employee._id,
        name: employee.name,
        priority: employee.priority,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { workers, studentData, oneOnOneData, mode } = req.body;

    // studentData must come from real calendar data (or the client's demo-mode
    // generator, which sends real-shaped fake data explicitly). There is no
    // legitimate case where /generate should invent its own random demand --
    // that used to happen silently via week.createSchedule()'s dev-era stub,
    // producing a fully plausible-looking but entirely fake schedule with no
    // indication anything was wrong.
    if (!studentData) {
      return res.status(400).json({
        error: "Missing student data. Fetch calendar events before generating a schedule.",
      });
    }

    // Build the week from the center's active operating schedule.
    const settings = await CenterSettings.findOne({ centerId: req.centerId });
    const schedule = (settings && settings.schedule) || defaultSchedule();
    const { variant } = getActiveVariant(schedule);
    const dayConfigs = variantToDayConfigs(variant);

    // Workers arrive with availability as per-day blocks in canonical minutes:
    //   days: [ { day, blocks: [{start,end}] } ]
    const users = (workers || []).map((w) => {
      const user = new User(w.name, w.days || [], w.submittedAt || null);
      if (w.priority) user.setPriority(w.priority);
      return user;
    });

    // Cale's main engine is the unified algorithm (Day.js/Week.js) --
    // SimplifiedWeek/SimplifiedDay ("normal" mode) are no longer exposed in
    // either UI (scheduler.html/dashboard.html always send mode: "ultra" as
    // of the mode-toggle removal) but are DELIBERATELY left wired here,
    // untouched, in case normal mode gets reconnected later.
    //
    // The mode check is written as an explicit opt-IN to normal mode, not an
    // opt-in to ultra -- this is intentionally the reverse of how it used to
    // read. With the old `mode === "ultra"` check, any request missing the
    // mode field (a stray/older client, a bug, a future caller) would
    // silently fall through to the old normal-mode engine with no error and
    // no indication anything unusual happened. Flipping it so "ultra" is
    // the default and "simplified" must be explicitly requested closes that
    // silent-fallback path -- normal mode can only ever run if something
    // asks for it by name.
    const isUltra = mode !== "simplified";
    const week = isUltra
      ? new Week(users, dayConfigs)
      : new SimplifiedWeek(users, dayConfigs);

    // studentData / oneOnOneData are keyed by dayKey then canonical minute.
    for (const day of week.week) {
      const sdt = studentData[day.dayKey] || {};
      const odt = oneOnOneData ? oneOnOneData[day.dayKey] || {} : {};
      for (const slot of day.slots) {
        slot.students = sdt[slot.time] || 0;
        slot.oneOnOne = !!odt[slot.time];
      }
    }
    const tmp = isUltra ? new Day() : new SimplifiedDay();
    tmp.canWork(week.week, users);
    tmp.willWork(week.week);

    const scheduleOut = week.week.map((day, i) => {
      const assignments = [];
      for (const w of day.totalWorkers) {
        const di = w.days.indexOf(day.dayKey);
        for (const shift of w.working[di] || []) {
          assignments.push({
            name: w.name,
            start: shift.start, // canonical minutes
            end: shift.end,
            priority: w.priority,
          });
        }
      }

      // Understaffing signal, computed directly per 30-minute slot: exactly
      // where workersNeeded (the algorithm's own decided target -- NOT a
      // naive ratio recheck, so a deliberate one-on-one adjustment never
      // false-flags) exceeds how many people actually ended up assigned
      // there. No intermediate "window" abstraction -- a real shortfall
      // might only last one slot before it's fine again, and reporting
      // some larger enclosing shift-block or demand-window as
      // "understaffed" would say something untrue about when help is
      // actually needed. Adjacent slots that share the same shortfall
      // amount are merged into one span; a two-block day's gap between
      // blocks breaks the merge naturally, since slot times aren't
      // contiguous across it.
      const understaffed = [];
      for (const slot of day.slots) {
        const shortBy = Math.max(0, (slot.workersNeeded || 0) - (slot.workers || []).length);
        if (shortBy === 0) continue;
        const last = understaffed[understaffed.length - 1];
        if (last && last.end === slot.time && last.shortBy === shortBy) {
          last.end = slot.time + 30;
        } else {
          understaffed.push({ start: slot.time, end: slot.time + 30, shortBy });
        }
      }

      return {
        dayKey: day.dayKey,
        dayName: day.dayName,
        blocks: dayConfigs[i].blocks,
        slots: dayConfigs[i].slots,
        assignments,
        understaffed,
      };
    });

    const understaffed = [];
    for (const day of scheduleOut) {
      for (const seg of day.understaffed) {
        understaffed.push({ dayKey: day.dayKey, dayName: day.dayName, ...seg });
      }
    }

    res.json({ schedule: scheduleOut, understaffed, text: "" });
  } catch (err) {
    console.error("/generate:", err.message);
    res.status(500).json({ error: "Could not generate the schedule." });
  }
});

// Returns the centerId for the currently logged-in manager — used by the
// dashboard to construct the center-specific availability link.
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const center = await Center.findOne(
      { centerId: req.centerId },
      { name: 1 },
    );
    res.json({
      centerId: req.centerId,
      centerName: center ? center.name : req.centerId,
    });
  } catch {
    res.json({ centerId: req.centerId, centerName: req.centerId });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — super-manager routes, protected by ADMIN_PASSWORD env var
// Only used by you to create/manage centers. Centers cannot access these.
// ─────────────────────────────────────────────────────────────────────────────

app.get("/admin/login", (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.admin) return res.redirect("/admin");
    } catch {}
  }
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/admin/login", ensureDB, adminLoginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required." });
    const match = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!match) return res.status(401).json({ error: "Incorrect password." });

    // Correct password — wipe this key's counter. This limiter is only 5 per
    // HOUR, so without a reset here, signing in and out a few times while
    // working on the app locks you out of your own admin panel.
    clearRateLimit(adminLoginLimiter, req);

    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.setHeader(
      "Set-Cookie",
      `token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("/api/admin/login:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// List all centers
app.get("/api/admin/centers", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const centers = await Center.find({}, { passwordHash: 0 }); // never send hashes
    // tutorialCompleted lives on CenterSettings, a separate collection keyed
    // by the same centerId string (see the handoff notes on why this isn't
    // a real relational reference) — so the list-view status needs a second
    // query and a merge rather than a single find().
    const settingsRows = await CenterSettings.find(
      {},
      { centerId: 1, tutorialCompleted: 1 },
    );
    const tutByCenter = new Map(
      settingsRows.map((s) => [s.centerId, !!s.tutorialCompleted]),
    );
    const data = centers.map((c) => ({
      centerId: c.centerId,
      name: c.name,
      mustChangePassword: !!c.mustChangePassword,
      frozen: !!c.frozen,
      tutorialCompleted: tutByCenter.get(c.centerId) || false,
    }));
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new center
app.post("/api/admin/centers", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { centerId, name } = req.body;
    if (!centerId || !name) {
      return res
        .status(400)
        .json({ error: "centerId and name are required." });
    }
    const existing = await Center.findOne({
      centerId: centerId.trim().toLowerCase(),
    });
    if (existing)
      return res
        .status(409)
        .json({ error: "A center with that ID already exists." });

    // Schedule is set at creation. Fall back to the default (which reproduces
    // the app's original Mon–Thu 3–8 / Sat 10–2 behavior) if none was sent.
    let schedule = req.body.schedule || defaultSchedule();
    const schedErr = validateSchedule(schedule);
    if (schedErr) return res.status(400).json({ error: schedErr });
    schedule = normalizeSchedule(schedule);

    const {
      DEFAULT_LESSON_KEYWORDS,
      validateCalendarKeywords,
      normalizeCalendarKeywords,
    } = require("./calendar");
    let calendarKeywords = req.body.calendarKeywords || {
      lessonKeywords: [...DEFAULT_LESSON_KEYWORDS],
      oneOnOneKeywords: [],
    };
    const kwErr = validateCalendarKeywords(calendarKeywords);
    if (kwErr) return res.status(400).json({ error: kwErr });
    calendarKeywords = normalizeCalendarKeywords(calendarKeywords);

    const cleanId = centerId.trim().toLowerCase();
    // The admin no longer chooses the password — it's generated here and
    // shown exactly once in this response. See tempPassword.js for why it's
    // two words + a number rather than random characters: it only has to
    // survive one accurate read-and-type before mustChangePassword forces
    // it to be replaced.
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const center = new Center({
      centerId: cleanId,
      name,
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
    });
    await center.save();

    // Create the settings document up front so the schedule exists immediately.
    await CenterSettings.findOneAndUpdate(
      { centerId: cleanId },
      { centerId: cleanId, schedule, calendarKeywords },
      { upsert: true, new: true },
    );

    res.json({
      data: { centerId: center.centerId, name: center.name, tempPassword },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a center's display name. Password changes are a separate, more
// consequential action now — see /reset-password below — and centerId
// renames are deferred (they'd require rewriting the key across Employee,
// Submission, CenterSettings, and OAuthToken too; not a name-field edit).
app.put("/api/admin/centers/:centerId", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Display name is required." });
    }
    const center = await Center.findOneAndUpdate(
      { centerId: req.params.centerId },
      { name: name.trim() },
      { new: true, projection: { passwordHash: 0 } },
    );
    if (!center) return res.status(404).json({ error: "Center not found." });
    res.json({ data: center });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates a brand-new temp password for an existing center and forces a
// change on next login — the same mechanism as center creation, and also
// the app's entire "forgot password" story: the admin re-runs this,
// re-sends the credential the way they always contact this center anyway,
// and the manager is walked through set-your-own-password on next login.
app.post(
  "/api/admin/centers/:centerId/reset-password",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const center = await Center.findOneAndUpdate(
        { centerId: req.params.centerId },
        {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
        },
        { new: true },
      );
      if (!center) return res.status(404).json({ error: "Center not found." });
      res.json({ data: { centerId: center.centerId, tempPassword } });
    } catch (err) {
      console.error("POST reset-password:", err.message);
      res.status(500).json({ error: "Could not reset the password." });
    }
  },
);

// Freeze a center: the manager can no longer sign in, and any live session
// is rejected on its next request (see requireAuth). Reversible and
// non-destructive — nothing is deleted, and the center's employees can
// still submit availability, because that path is PIN-based and never goes
// through requireAuth. Use DELETE for the permanent version.
app.post(
  "/api/admin/centers/:centerId/freeze",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const reason = String(req.body?.reason || "").trim().slice(0, 500);
      const center = await Center.findOneAndUpdate(
        { centerId: req.params.centerId },
        { frozen: true, frozenAt: new Date(), frozenReason: reason },
        { new: true, projection: { passwordHash: 0 } },
      );
      if (!center) return res.status(404).json({ error: "Center not found." });
      res.json({ data: center });
    } catch (err) {
      console.error("POST freeze:", err.message);
      res.status(500).json({ error: "Could not freeze the center." });
    }
  },
);

// Unfreeze. Clears the note too — it described a state that no longer
// applies, and a stale reason on an active center is worse than none.
app.post(
  "/api/admin/centers/:centerId/unfreeze",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const center = await Center.findOneAndUpdate(
        { centerId: req.params.centerId },
        { frozen: false, frozenAt: null, frozenReason: "" },
        { new: true, projection: { passwordHash: 0 } },
      );
      if (!center) return res.status(404).json({ error: "Center not found." });
      res.json({ data: center });
    } catch (err) {
      console.error("POST unfreeze:", err.message);
      res.status(500).json({ error: "Could not unfreeze the center." });
    }
  },
);

// Delete a center (and all its data)
app.delete("/api/admin/centers/:centerId", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { centerId } = req.params;
    await Center.deleteOne({ centerId });
    await Employee.deleteMany({ centerId });
    await Submission.deleteMany({ centerId });
    await CenterSettings.deleteOne({ centerId });
    await OAuthToken.deleteOne({ centerId });
    res.json({ deleted: centerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Center detail view — returns everything the admin needs in one call
app.get(
  "/api/admin/centers/:centerId/details",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;

      const center = await Center.findOne({ centerId }, { passwordHash: 0 });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const employees = await Employee.find({ centerId });
      const settings = await CenterSettings.findOne({ centerId });
      const oauthDoc = await OAuthToken.findOne({ centerId });

      // Current week's Monday (same logic as the frontend uses)
      const now = new Date();
      const day = now.getDay();
      const diffToMon = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMon);
      const weekOf = monday.toISOString().slice(0, 10);

      const submissions = await Submission.find({ centerId, weekOf }).sort({
        submittedAt: 1,
      });
      const lastSub =
        submissions.length > 0
          ? submissions[submissions.length - 1].submittedAt
          : null;

      // Also check last submission across all weeks for "last activity"
      const anyLastSub = await Submission.findOne({ centerId }).sort({
        submittedAt: -1,
      });

      res.json({
        data: {
          center,
          employees: employees.map((e) => ({
            _id: e._id,
            name: e.name,
            priority: e.priority,
            hasPin: !!(e.pin && e.pin.trim()),
            pin: e.pin,
          })),
          settings: settings || null,
          tutorialCompleted: !!(settings && settings.tutorialCompleted),
          introSeen: !!(settings && settings.introSeen),
          calendarConnected: !!(
            oauthDoc &&
            oauthDoc.token &&
            (oauthDoc.token.access_token || oauthDoc.token.refresh_token)
          ),
          weekOf,
          submissionCount: submissions.length,
          lastActivityAt: anyLastSub ? anyLastSub.submittedAt : null,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

app.put(
  "/api/admin/centers/:centerId/intro",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const { introSeen } = req.body;

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, introSeen: !!introSeen },
        { new: true, upsert: true },
      );

      res.json({
        data: { centerId, introSeen: !!doc.introSeen },
      });
    } catch (err) {
      console.error("PUT intro status:", err.message);
      res.status(500).json({ error: "Could not update intro status." });
    }
  },
);

app.put(
  "/api/admin/centers/:centerId/tutorial",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const { tutorialCompleted } = req.body;

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, tutorialCompleted: !!tutorialCompleted },
        { new: true, upsert: true },
      );

      res.json({
        data: { centerId, tutorialCompleted: !!doc.tutorialCompleted },
      });
    } catch (err) {
      console.error("PUT tutorial status:", err.message);
      res.status(500).json({ error: "Could not update tutorial status." });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

// Admin: read a center's full schedule config (both variants).
app.get(
  "/api/admin/centers/:centerId/schedule",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const center = await Center.findOne({ centerId });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const settings = await CenterSettings.findOne({ centerId });
      const rawSchedule = (settings && settings.schedule) || defaultSchedule();
      // Normalize before sending: a variant that's never been explicitly
      // saved (or predates a field like minShiftLength existing at all)
      // can be sitting on schema defaults like `null` in the database.
      // Sending that raw means the tab the admin ISN'T looking at can fail
      // validation on save with an error about a field they never touched.
      const schedule = normalizeSchedule(rawSchedule);
      res.json({
        data: { schedule, activeVariant: resolveActiveName(schedule) },
      });
    } catch (err) {
      console.error("GET schedule:", err.message);
      res.status(500).json({ error: "Could not load the schedule." });
    }
  },
);

// Admin: save a center's full schedule config.
app.put(
  "/api/admin/centers/:centerId/schedule",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const center = await Center.findOne({ centerId });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const schedErr = validateSchedule(req.body.schedule);
      if (schedErr) return res.status(400).json({ error: schedErr });
      const schedule = normalizeSchedule(req.body.schedule);

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, schedule },
        { new: true, upsert: true },
      );
      res.json({
        data: {
          schedule: doc.schedule,
          activeVariant: resolveActiveName(doc.schedule),
        },
      });
    } catch (err) {
      console.error("PUT schedule:", err.message);
      res.status(500).json({ error: "Could not save the schedule." });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

// Admin: read a center's calendar event-title keywords.
app.get(
  "/api/admin/centers/:centerId/keywords",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const center = await Center.findOne({ centerId });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const {
        DEFAULT_LESSON_KEYWORDS,
        DEFAULT_ONE_ON_ONE_KEYWORDS,
      } = require("./calendar");
      const settings = await CenterSettings.findOne({ centerId });
      const calendarKeywords = (settings && settings.calendarKeywords) || {
        lessonKeywords: DEFAULT_LESSON_KEYWORDS,
        oneOnOneKeywords: DEFAULT_ONE_ON_ONE_KEYWORDS,
        lessonCaseSensitive: false,
        oneOnOneCaseSensitive: false,
      };
      res.json({ data: { calendarKeywords } });
    } catch (err) {
      console.error("GET keywords:", err.message);
      res.status(500).json({ error: "Could not load calendar keywords." });
    }
  },
);

// Admin: save a center's calendar event-title keywords.
app.put(
  "/api/admin/centers/:centerId/keywords",
  requireAdmin,
  async (req, res) => {
    try {
      await connectDB();
      const { centerId } = req.params;
      const center = await Center.findOne({ centerId });
      if (!center) return res.status(404).json({ error: "Center not found." });

      const {
        validateCalendarKeywords,
        normalizeCalendarKeywords,
      } = require("./calendar");
      const kwErr = validateCalendarKeywords(req.body.calendarKeywords);
      if (kwErr) return res.status(400).json({ error: kwErr });
      const calendarKeywords = normalizeCalendarKeywords(
        req.body.calendarKeywords,
      );

      const doc = await CenterSettings.findOneAndUpdate(
        { centerId },
        { centerId, calendarKeywords },
        { new: true, upsert: true },
      );
      res.json({ data: { calendarKeywords: doc.calendarKeywords } });
    } catch (err) {
      console.error("PUT keywords:", err.message);
      res.status(500).json({ error: "Could not save calendar keywords." });
    }
  },
);

// Manager-facing: the current center's resolved active operating schedule.
// Used by the dashboard and scheduler to build days/hours dynamically.
app.get("/center-schedule", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const settings = await CenterSettings.findOne({ centerId: req.centerId });
    const schedule = (settings && settings.schedule) || defaultSchedule();
    const { name, variant } = getActiveVariant(schedule);
    res.json({ data: { activeVariant: name, days: variant, schedule } });
  } catch (err) {
    console.error("GET /center-schedule:", err.message);
    res.status(500).json({ error: "Could not load the schedule." });
  }
});

// Public: resolved active operating schedule for a center. Used by the
// availability form (no auth) so employees only see days/hours the center runs.
app.get("/center-schedule/:centerId", async (req, res) => {
  try {
    await connectDB();
    const { centerId } = req.params;
    const settings = await CenterSettings.findOne({ centerId });
    const schedule = (settings && settings.schedule) || defaultSchedule();
    const { name, variant } = getActiveVariant(schedule);
    res.json({ data: { activeVariant: name, days: variant } });
  } catch (err) {
    console.error("GET /center-schedule/:centerId:", err.message);
    res.status(500).json({ error: "Could not load the schedule." });
  }
});

// Warm up auth client on startup
try {
  const { getAuth } = require("./auth");
  getAuth();
} catch (err) {
  console.log("Auth warmup:", err.message);
}

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
