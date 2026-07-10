// ── Day.js ──────────────────────────────────────────────────────────────────
// UNIFIED scheduling algorithm (formerly the "ultra" mode engine). Built from
// config:
//   new Day(dayKey, dayName, slots, minShiftLength, shiftStarts)
//   slots = [startMin, ...] (canonical minutes since midnight)
//   minShiftLength = minutes; shortest shift the algorithm may produce
//     (0/undefined = no minimum). Per-variant config via scheduleConfig.js.
//   shiftStarts = [min, ...] the per-priority default start times (same list
//     SimplifiedDay's block templates are built from). Used ONLY as snap
//     anchors so shift edges land on human-standard start times -- they never
//     create or remove demand.
//
// The unified design, in one paragraph: decompose each block's demand curve
// into levels (stack of horizontal strips), exactly as before. Then, instead
// of the old margin rule that silently DELETED any short interior strip --
// the root cause of "scheduled 1 when 3 were needed", because a genuine
// 2-slot spike of +2 lost BOTH its strips and never even hit the
// understaffing banner (workersNeeded was derived from surviving windows) --
// three rules apply:
//
//   1. DIP MERGE: within one level, two runs separated by a gap shorter than
//      the margin merge into one window. This is the correct use of
//      hysteresis: keep a person through a brief lull rather than splitting
//      the coverage into fragments for two different workers. (Deliberate
//      slight overstaffing of the dip.)
//   2. CAPPED ABSORPTION: a short interior run may be dropped ONLY if it is
//      the topmost strip of the spike at every slot it covers (target ===
//      level) and no slot has already absorbed a drop -- i.e. total absorbed
//      demand is capped at ABSORB_CAP (1) worker per slot. That's the human
//      judgment "let the ratio stretch to ~3.5:1 for half an hour". Anything
//      deeper is REAL demand and falls through to rule 3. Absorbed demand is
//      tracked in dropped[] and subtracted from workersNeeded, so the signal
//      stays honest: nothing can be silently hidden from the banner anymore.
//   3. EXTEND + SNAP: every surviving window is extended to minShiftLength
//      (toward the "almost needed" side, as before), then its edges snap
//      OUTWARD to the nearest anchor within SNAP_TOLERANCE -- anchors being
//      the block open/close and the configured default shift starts. Snapping
//      only ever widens a window (never trims below demand), trading a little
//      overstaffing for shifts that read like shifts: 4:00-8:00, not
//      4:30-7:30.
//
// Assignment is unchanged: earliest-first / widest-first window order, relay
// (handoff) covering per window, at most one contiguous shift per worker per
// block. slot.workersNeeded = raw target - deliberate absorption; server.js
// compares that against slot.workers.length directly, same as before.
// ─────────────────────────────────────────────────────────────────────────────

// How much demand a short interior blip is allowed to absorb (workers per
// slot). 1 = "a human lets the ratio stretch briefly"; 0 = never absorb,
// staff every strip.
const ABSORB_CAP = 1;

// How LONG (in slots) a blip may be and still qualify for absorption. 1 = only
// a single 30-minute +1 wobble is ever absorbed; anything that persists a full
// hour is real demand and gets staffed (with a minimum-length shift). This is
// deliberately NOT the margin/minShiftLength dial -- absorbing demand and
// merging dips are different judgments with different safe durations.
const ABSORB_MAX_SLOTS = 1;

// How far (minutes) a window edge may snap outward to reach a standard shift
// start / block edge. 60 = an edge within an hour of an anchor lands on it.
const SNAP_TOLERANCE = 60;

class Day {
  constructor(dayKey = "", dayName = "", slots = [], minShiftLength = 0, shiftStarts = []) {
    this.dayKey = (dayKey || "").toLowerCase();
    this.dayName = dayName || "";
    this.totalWorkers = [];
    this.minShiftLength = minShiftLength || 0;
    this.shiftStarts = (shiftStarts || []).slice().sort((a, b) => a - b);
    this.slots = (slots || []).map((min) => ({
      time: min, // canonical minutes since midnight
      students: 0,
      workers: [],
      oneOnOne: false,
      oneOnOneWorker: null,
      workersNeeded: 0, // decided target headcount for this slot: the raw
                        // demand-curve target MINUS any deliberate capped
                        // absorption (never more than ABSORB_CAP). Unlike the
                        // old design, suppression can no longer hide demand
                        // from this number -- an unstaffable spike shows up
                        // in the banner instead of silently disappearing.
    }));
  }

  // Sort helper: fewer points first, then earliest submission, then unknown last.
  _sortByPriority(list) {
    list.sort((a, b) => {
      if (a.points !== b.points) return a.points - b.points;
      if (a.submittedAt && b.submittedAt) return new Date(a.submittedAt) - new Date(b.submittedAt);
      if (a.submittedAt) return -1;
      if (b.submittedAt) return 1;
      return 0;
    });
  }

  // Assign every available worker to every slot they can cover.
  canWork(week, users) {
    for (const day of week) {
      for (const user of users) {
        const di = user.days.indexOf(day.dayKey);
        if (di === -1) continue;
        for (const slot of day.slots) {
          if (user.availableAt(di, slot.time)) {
            slot.workers.push(user);
            if (!day.totalWorkers.includes(user)) day.totalWorkers.push(user);
          }
        }
      }
      for (const slot of day.slots) this._sortByPriority(slot.workers);
    }
  }

  // Splits `this.slots` into maximal contiguous runs (a two-block day has a
  // real gap in the time sequence between blocks, which is exactly where
  // this splits).
  _splitIntoBlocks() {
    const blocks = [];
    let current = [];
    for (const slot of this.slots) {
      if (current.length && slot.time !== current[current.length - 1].time + 30) {
        blocks.push(current);
        current = [];
      }
      current.push(slot);
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  // Raw per-slot target headcount. A one-on-one slot pulls one instructor off
  // the floor; the group students that instructor would have covered are
  // passed onto the rest of the team -- so the target is the normal 1:3 ratio
  // PLUS the number of instructors pulled (always 1 today; calendar.js's
  // oneOnOneData is a boolean, not a count).
  _rawTarget(slot) {
    const base = Math.ceil(slot.students / 3);
    return slot.oneOnOne ? base + 1 : base;
  }

  // All runs (as [startIdx, endIdx) into blockSlots) where at least `level`
  // workers are needed. No filtering here -- merging/absorption/extension
  // decide each run's fate downstream.
  _levelRuns(blockSlots, target, level) {
    const runs = [];
    let runStart = null;
    for (let i = 0; i <= blockSlots.length; i++) {
      const needed = i < blockSlots.length && target[i] >= level;
      if (needed && runStart === null) runStart = i;
      if (!needed && runStart !== null) {
        runs.push([runStart, i]);
        runStart = null;
      }
    }
    return runs;
  }

  // DIP MERGE: two same-level runs separated by a gap shorter than
  // marginSlots become one window -- keep the person through the lull
  // instead of fragmenting the level across two workers. Runs arrive sorted
  // by start (guaranteed by _levelRuns' left-to-right sweep).
  _mergeCloseRuns(runs, marginSlots) {
    if (runs.length <= 1) return runs.map((r) => r.slice());
    const out = [runs[0].slice()];
    for (let i = 1; i < runs.length; i++) {
      const prev = out[out.length - 1];
      const [s, e] = runs[i];
      if (s - prev[1] < marginSlots) prev[1] = e;
      else out.push([s, e]);
    }
    return out;
  }

  // CAPPED ABSORPTION: may this short interior run be absorbed (not staffed)?
  // Only if it's the topmost strip of the spike everywhere it stands
  // (target === level -- so at most one strip per slot can ever qualify), no
  // slot in it has already absorbed its cap, and the blip is genuinely brief
  // (ABSORB_MAX_SLOTS). Edge-touching runs are never absorbed (edge trimming
  // is real observed demand, handled by extension/snapping).
  _canAbsorb(blockSlots, target, dropped, level, s, e) {
    if (s === 0 || e === blockSlots.length) return false; // touches an edge
    if (e - s > ABSORB_MAX_SLOTS) return false; // persists too long to ignore
    for (let i = s; i < e; i++) {
      if (target[i] !== level) return false; // deeper demand exists above this strip
      if (dropped[i] >= ABSORB_CAP) return false;
    }
    return true;
  }

  // Extends a too-short window up to minSlots, growing one slot at a time
  // toward whichever adjacent slot is closer to actually needing this level
  // (the "almost needed" side). Stops early if the window has nowhere left
  // to grow (the whole block is shorter than the configured minimum).
  _extendToMinimum(blockSlots, target, start, end, minSlots) {
    let s = start;
    let e = end;
    while (e - s < minSlots && (s > 0 || e < blockSlots.length)) {
      const leftVal = s > 0 ? target[s - 1] : -Infinity;
      const rightVal = e < blockSlots.length ? target[e] : -Infinity;
      if (s > 0 && leftVal >= rightVal) s--;
      else if (e < blockSlots.length) e++;
      else s--;
    }
    return [s, e];
  }

  // SNAP: moves a window's edges OUTWARD onto the nearest anchor within
  // SNAP_TOLERANCE. Anchors = block open, block close, and any configured
  // default shift start inside the block. Only ever widens the window (start
  // can move earlier, end can move later), so demand coverage is never
  // reduced -- the cost is a little deliberate overstaffing in exchange for
  // shifts that look like shifts (4:00-8:00, not 4:30-7:30). An edge already
  // sitting on an anchor stays put (distance 0 picks itself).
  _snapToAnchors(blockSlots, start, end) {
    const blockStart = blockSlots[0].time;
    const blockEnd = blockSlots[blockSlots.length - 1].time + 30;
    const anchors = [
      blockStart,
      blockEnd,
      ...this.shiftStarts.filter((a) => a > blockStart && a < blockEnd),
    ];
    const st = blockSlots[start].time;
    const en = blockSlots[end - 1].time + 30;

    let bestStart = st;
    let cand = -Infinity;
    for (const a of anchors) if (a <= st && st - a <= SNAP_TOLERANCE && a > cand) cand = a;
    if (cand !== -Infinity) bestStart = cand;

    let bestEnd = en;
    cand = Infinity;
    for (const a of anchors) if (a >= en && a - en <= SNAP_TOLERANCE && a < cand) cand = a;
    if (cand !== Infinity) bestEnd = cand;

    return [(bestStart - blockStart) / 30, (bestEnd - blockStart) / 30];
  }

  willWork(week) {
    for (const day of week) {
      const minSlots = day.minShiftLength ? Math.max(1, Math.round(day.minShiftLength / 30)) : 1;
      // Margin (dip-merge distance + "short run" threshold) stays anchored to
      // the same configured minimum shift length -- one dial, not two.
      const marginSlots = minSlots;

      const blocks = day._splitIntoBlocks();

      for (const blockSlots of blocks) {
        // canWork() left every AVAILABLE worker in slot.workers; clear so it
        // holds only workers actually ASSIGNED once this block is done.
        for (const slot of blockSlots) slot.workers = [];

        const target = blockSlots.map((slot) => day._rawTarget(slot));
        const maxLevel = target.length ? Math.max(0, ...target) : 0;
        // Per-slot count of deliberately absorbed demand (0 or ABSORB_CAP).
        const dropped = new Array(blockSlots.length).fill(0);

        const windows = [];
        for (let level = 1; level <= maxLevel; level++) {
          const raw = day._levelRuns(blockSlots, target, level);
          const merged = day._mergeCloseRuns(raw, marginSlots);
          for (const [s, e] of merged) {
            if (day._canAbsorb(blockSlots, target, dropped, level, s, e)) {
              for (let i = s; i < e; i++) dropped[i] += 1;
              continue;
            }
            // Snap FIRST so the widening the snap already does counts toward
            // the minimum shift length (extending first and snapping after
            // stacks both widenings -- up to 4-hour shifts for a 1-hour
            // spike). Then extend only whatever's still short, and snap once
            // more in case extension pushed an edge off its anchor.
            let [es, ee] = day._snapToAnchors(blockSlots, s, e);
            if (ee - es < minSlots) {
              [es, ee] = day._extendToMinimum(blockSlots, target, es, ee, minSlots);
              [es, ee] = day._snapToAnchors(blockSlots, es, ee);
            }
            windows.push({ start: es, end: ee, level, segments: null });
          }
        }

        // Earliest windows get first pick of workers; ties on start go to the
        // WIDER window (see the ordering-bug writeup in the handoff doc).
        windows.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

        // RELAY COVERING (unchanged): cover each window with a handoff chain,
        // furthest-reach greedy, one contiguous shift per worker per block.
        const usedInBlock = new Set();

        function coverWindow(win) {
          const segments = [];
          let cursor = win.start;
          while (cursor < win.end) {
            const time = blockSlots[cursor].time;
            const candidates = [];
            for (const worker of day.totalWorkers) {
              if (usedInBlock.has(worker)) continue;
              const di = worker.days.indexOf(day.dayKey);
              if (!worker.availableAt(di, time)) continue;
              let reach = cursor;
              while (reach < win.end && worker.availableAt(di, blockSlots[reach].time)) reach++;
              candidates.push({ worker, reach });
            }
            if (candidates.length === 0) {
              let gapEnd = cursor + 1;
              while (gapEnd < win.end) {
                const t2 = blockSlots[gapEnd].time;
                const anyAvail = day.totalWorkers.some(
                  (w) => !usedInBlock.has(w) && w.availableAt(w.days.indexOf(day.dayKey), t2),
                );
                if (anyAvail) break;
                gapEnd++;
              }
              segments.push({ start: cursor, end: gapEnd, worker: null });
              cursor = gapEnd;
              continue;
            }
            candidates.sort((a, b) => b.reach - a.reach || a.worker.points - b.worker.points);
            const pick = candidates[0];
            segments.push({ start: cursor, end: pick.reach, worker: pick.worker });
            usedInBlock.add(pick.worker);
            cursor = pick.reach;
          }
          return segments;
        }

        for (const win of windows) {
          win.segments = coverWindow(win);
          for (const seg of win.segments) {
            if (!seg.worker) continue;
            const wStart = blockSlots[seg.start].time;
            const wEnd = blockSlots[seg.end - 1].time + 30;
            const di = seg.worker.days.indexOf(day.dayKey);
            seg.worker.working[di].push({ start: wStart, end: wEnd });
            for (let i = seg.start; i < seg.end; i++) {
              blockSlots[i].workers.push(seg.worker);
            }
          }
        }

        // Honest decided target: raw demand minus deliberate capped
        // absorption. NOT derived from surviving-window counts (extension and
        // snapping widen windows past demand -- unfilled padding is not a
        // shortfall), and no longer able to lose real demand the way the old
        // suppression could.
        for (let i = 0; i < blockSlots.length; i++) {
          blockSlots[i].workersNeeded = Math.max(0, target[i] - dropped[i]);
        }

        // The highest-priority worker actually present in a one-on-one slot
        // does the 1-on-1.
        for (const slot of blockSlots) {
          if (slot.oneOnOne && slot.workers.length > 0) {
            day._sortByPriority(slot.workers);
            slot.oneOnOneWorker = slot.workers[0];
          }
        }
      }
    }
  }

  resetAllWorkers() {
    for (const slot of this.slots) slot.workers = [];
  }

  resetAllStudents() {
    for (const slot of this.slots) slot.students = 0;
  }

  resetAllHours() {
    this.resetAllWorkers();
    this.resetAllStudents();
  }
}

module.exports = Day;
module.exports.ABSORB_CAP = ABSORB_CAP;
module.exports.SNAP_TOLERANCE = SNAP_TOLERANCE;
