# Cale

Cale is a staff-scheduling web app for tutoring centers. It reads a center's lessons from Google Calendar, collects weekly availability from employees, and builds a weekly shift schedule that matches staffing to student demand.

Each center has a manager account. Employees submit availability through a public form using a PIN, and an admin console manages all centers.

---

## Features

- **Demand-driven scheduling.** Student counts per 30-minute slot come from the center's Google Calendar. The engine targets a 1:3 instructor-to-student ratio and adds one extra instructor for each slot with a one-on-one session.
- **Employee availability form.** Employees go to `/availability/<centerId>`, enter their 6-digit PIN, and submit their availability for the upcoming week. Submissions are only accepted while the center's submission window is open.
- **Priority levels.** Employees can be Normal, Priority, or High Priority. Higher priority means they get assigned first. Among Normal workers, those with less availability go first, and earlier submissions win ties.
- **Configurable operating hours.** Each center sets which days it is open and its hours, with up to two blocks per day (for a day with a gap in the middle). There are separate **school-year** and **summer** schedules, chosen automatically by a recurring summer date range or set by hand.
- **Understaffing warnings.** The generated schedule lists every 30-minute span where fewer workers are assigned than needed, and by how many.
- **Per-center calendar keywords.** Each center sets which event-title keywords count as a lesson (defaults: `HS`, `MS`, `ES`) or a one-on-one (defaults: `1-on-1`, `one-on-one`), with optional case-sensitive matching.
- **Admin console.** Create, edit, freeze, or delete centers, reset manager passwords with temporary passwords, and view each center's settings and Google Calendar connection status.
- **Security.** bcrypt-hashed passwords, JWT session cookies (HttpOnly, Secure), helmet security headers, MongoDB-backed IP rate limiting on logins and PIN lookups, and HTML escaping in the front end (`public/safe-html.js`).

---

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Server    | Node.js, Express 5 |
| Database  | MongoDB via Mongoose |
| Auth      | `jsonwebtoken`, `bcryptjs` |
| Calendar  | Google Calendar API (`googleapis`, OAuth 2.0) |
| Security  | `helmet`, `express-rate-limit` |
| Front end | Static HTML/CSS/JS in `public/` (no build step) |
| Hosting   | Built for Vercel (serverless); also runs as a regular Node server |

---

## Getting started

### Prerequisites

- Node.js 18+
- A MongoDB database (for example, MongoDB Atlas)
- A Google Cloud OAuth 2.0 client (type "Web application") with the Google Calendar API enabled

### Install

```bash
git clone https://github.com/kedusmelaku/Cale-App.git
cd Cale-App
npm install
```

### Environment variables

Create a `.env` file in the project root (it is already in `.gitignore`):

```env
# Required
MONGODB_URI=mongodb+srv://user:pass@cluster.example.mongodb.net/cale
JWT_SECRET=a-long-random-string
ADMIN_PASSWORD=your-admin-console-password

# Google OAuth client JSON (the downloaded credentials file, as one line)
GOOGLE_CREDENTIALS={"web":{"client_id":"...","client_secret":"...","redirect_uris":["http://localhost:3000/oauth/callback"]}}

# Optional: overrides the first redirect URI in GOOGLE_CREDENTIALS
OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback
```

The server will not start if `JWT_SECRET` or `ADMIN_PASSWORD` is missing.

### Run

```bash
npm start
```

The app runs at <http://localhost:3000>. Session cookies are set with the `Secure` flag, so use `localhost` (which browsers treat as secure) or HTTPS.

---

## Usage

1. **Create a center.** Sign in to the admin console at `/admin/login` with `ADMIN_PASSWORD` and create a center. You get a temporary manager password.
2. **Manager sign-in.** The manager signs in at `/login` and must set their own password the first time.
3. **Connect Google Calendar.** From the dashboard, connect the center's Google account and pick the calendar that holds its lessons.
4. **Set up the center.** Set operating hours, the submission window, and calendar keywords, then add employees (each one gets a unique PIN).
5. **Collect availability.** Share the center's link, `/availability/<centerId>`, with employees.
6. **Generate the schedule.** Open `/scheduler`, choose a week, and generate. Cale pulls that week's calendar events, combines them with the submitted availability, and returns the shifts plus any understaffed spans.

---

## How the scheduling engine works

All times are stored as **minutes since midnight** (24-hour), for example `540` = 9:00 AM. AM/PM only exists in the display.

The main engine is in `Day.js` / `Week.js`:

1. **Demand.** Each 30-minute slot needs `ceil(students / 3)` workers, plus 1 if the slot has a one-on-one.
2. **Decomposition.** Each operating block's demand curve is split into horizontal levels, one per worker needed.
3. **Smoothing:**
   - *Dip merge:* within a level, two runs separated by a short gap are merged, so one person stays through a brief lull instead of two people splitting the coverage.
   - *Capped absorption:* a single-slot spike of +1 can be absorbed (the ratio briefly stretches to about 3.5:1). The absorbed amount is tracked so the understaffing report stays accurate.
   - *Extend and snap:* windows are extended to the minimum shift length, and their edges snap outward to standard start times (block open/close and the configured default starts).
4. **Assignment.** Windows are filled earliest-first and widest-first in priority order, with handoffs between workers allowed. A worker gets at most one continuous shift per block.

`SimplifiedDay.js` / `SimplifiedWeek.js` hold an older block-template ("normal") mode. It is still wired into `/generate` (send `mode: "simplified"`) but the UI no longer uses it.

---

## Project structure

```
├── server.js            # Express app: routes, auth middleware, DB connection
├── auth.js              # Google OAuth2 client; tokens stored in MongoDB
├── calendar.js          # Fetches calendar events and turns them into per-slot demand
├── scheduleConfig.js    # Operating-schedule defaults, validation, active-variant logic
├── Day.js / Week.js     # Main scheduling engine
├── SimplifiedDay.js / SimplifiedWeek.js  # Older block-based engine (not used by the UI)
├── User.js              # Engine representation of an employee
├── rateLimiters.js      # Rate limiters for logins and PIN lookups
├── tempPassword.js      # Temporary-password generator for admin resets
├── pull_calendar.js     # Offline script: exports calendar data for testing the algorithm
├── rosters.json         # Historical roster data used by pull_calendar.js
│
├── Center.js            # Mongoose model: center, manager password, freeze state
├── CenterSettings.js    # Mongoose model: submission window, schedule, keywords
├── Employee.js          # Mongoose model: employee, PIN, priority, default availability
├── Submission.js        # Mongoose model: one employee's availability for one week
├── OAuthToken.js        # Mongoose model: stored Google OAuth tokens per center
├── RateLimit.js         # Mongoose model: rate-limit counters
│
└── public/
    ├── login.html           # Manager sign-in
    ├── dashboard.html       # Manager dashboard (employees, settings, calendar)
    ├── scheduler.html       # Schedule generation and view
    ├── availability.html    # Public employee availability form
    ├── admin-login.html     # Admin sign-in
    ├── admin.html           # Admin console
    ├── privacy.html         # Privacy policy
    ├── safe-html.js         # HTML-escaping template helper
    ├── utils.js             # Shared front-end helpers
    ├── analytics.js         # Vercel Web Analytics stub
    └── styles.css
```

---

## Main routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /login`, `POST /api/login` | none | Manager sign-in |
| `GET /`, `GET /scheduler` | manager | Dashboard and scheduler pages |
| `GET /oauth/start`, `GET /oauth/callback` | manager | Connect Google Calendar |
| `GET /calendars`, `GET /events` | manager | List calendars, get weekly demand |
| `GET/POST/PUT/DELETE /employees` | manager | Manage employees |
| `GET/PUT /center-settings` | manager | Submission window, schedule, keywords |
| `GET /submissions`, `DELETE /submissions/:id` | manager | Review availability submissions |
| `POST /generate` | manager | Generate a schedule |
| `GET /availability/:centerId` | none | Employee availability form |
| `POST /availability/lookup` | none (rate-limited) | PIN lookup |
| `POST /submissions` | short-lived PIN token | Submit availability |
| `GET /admin`, `/api/admin/*` | admin | Admin console and center management |

---

## Utility script: `pull_calendar.js`

Exports a center's Google Calendar demand for every week listed in `rosters.json`, writing `calendar_pull.json`. This is useful for testing the scheduling algorithm against real history. It uses the app's own calendar classification, so results match `/events` and `/generate`.

```bash
MONGODB_URI=... GOOGLE_CREDENTIALS=... CENTER_ID=<centerId> \
  CALENDAR_ID=<calendar id> node pull_calendar.js
```

Optional: `ROSTERS` (input path) and `OUT` (output path).

---

## Deployment

Cale is built for **Vercel**:

- MongoDB connections are reused across warm invocations (`connectDB()` in `server.js`).
- Google OAuth tokens are stored in MongoDB, not in memory, so the calendar connection survives cold starts and is shared across instances.
- Rate-limit counters are stored in MongoDB for the same reason.

Set the environment variables above in your Vercel project, and add your production `/oauth/callback` URL to the Google OAuth client's authorized redirect URIs.

---

## License

ISC
