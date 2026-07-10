// ── Day.js ──────────────────────────────────────────────────────────────────
// Base day for the "ultra" (demand-curve-driven) scheduling mode. Built from
// config:
//   new Day(dayKey, dayName, slots, minShiftLength)
//   slots = [startMin, ...] (canonical minutes since midnight)
//   minShiftLength = minutes; the shortest shift the algorithm is allowed to
//     produce (0/undefined = no minimum enforced). Per-center config, threaded
//     in from scheduleConfig.js via Week's constructor -- see the class
//     hierarchy note in the handoff doc: this is a new OPTIONAL trailing
//     constructor param specifically so SimplifiedDay's existing 3-arg
//     super() call keeps working unmodified.
//
// A day may be built from one or two operating blocks; the flattened `slots`
// list simply omits the gap between two-block days (scheduleConfig.js's
// slotsForBlocks never emits gap minutes), so a "block" for this algorithm's
// purposes is just a maximal run of slots whose times increase by exactly 30 --
// no separate operatingBlocks list needs to be passed in to find them.
//
// willWork()'s redesign, in one sentence: for each block, decompose the
// demand curve into levels (like stacking a bar chart into horizontal
// strips), suppress blips that are too brief to be worth staffing for
// (duration-based margin), extend any window left too short by suppression or
// by block-edge trimming, then assign one real worker per surviving window --
// which structurally guarantees exactly one contiguous shift per worker per
// block, since a worker IS a window.
// ─────────────────────────────────────────────────────────────────────────────

class Day {
  constructor(dayKey = "", dayName = "", slots = [], minShiftLength = 0) {
    this.dayKey = (dayKey || "").toLowerCase();
    this.dayName = dayName || "";
    this.totalWorkers = [];
    this.minShiftLength = minShiftLength || 0;
    this.slots = (slots || []).map((min) => ({
      time: min, // canonical minutes since midnight
      students: 0,
      workers: [],
      oneOnOne: false,
      oneOnOneWorker: null,
      workersNeeded: 0, // decided target headcount for this slot -- NOT a
                        // naive recompute of ceil(students/3); it's however
                        // many workers the algorithm actually decided this
                        // slot needs, so it never false-flags a deliberate
                        // one-on-one "stress" moment as understaffing. The
                        // understaffing signal itself is just this compared
                        // against slot.workers.length, computed directly in
                        // server.js -- no separate window list needed.
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

  // Raw per-slot target headcount, before any margin/hysteresis smoothing.
  // A one-on-one slot pulls one instructor off the floor; the group students
  // that instructor would have covered are passed onto the rest of the team --
  // so the target is the normal 1:3 ratio PLUS the number of instructors
  // pulled (numberOfInstructorsPulled is always 1 today, since
  // calendar.js's oneOnOneData is a boolean, not a count -- see the handoff
  // doc's known gap re: simultaneous one-on-ones).
  _rawTarget(slot) {
    const base = Math.ceil(slot.students / 3);
    return slot.oneOnOne ? base + 1 : base;
  }

  // For one demand level L, finds every window (as [startIdx, endIdx) into
  // `blockSlots`) where at least L workers are needed -- after applying the
  // duration-based margin. An INTERIOR run shorter than marginSlots is
  // treated as a fleeting blip, not worth staffing for, and dropped (this IS
  // the hysteresis mechanism: a level requirement has to persist for
  // marginSlots to be honored). A run touching either edge of the block is
  // NEVER dropped this way -- edge trimming is real, observed behavior
  // ("all the time, sometimes by a lot"), not noise, and gets handled by
  // _extendToMinimum below instead of being suppressed.
  _levelWindows(blockSlots, target, level, marginSlots) {
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
    return runs.filter(([s, e]) => {
      const touchesEdge = s === 0 || e === blockSlots.length;
      return touchesEdge || e - s >= marginSlots;
    });
  }

  // Extends a too-short window up to minSlots, growing one slot at a time
  // toward whichever adjacent slot is closer to actually needing this level
  // (the "almost needed" side) -- so the extension itself keeps minimizing
  // overstaffing rather than picking a direction arbitrarily. Stops early if
  // the window has nowhere left to grow (the whole block is shorter than
  // the configured minimum).
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

  willWork(week) {
    for (const day of week) {
      const minSlots = day.minShiftLength ? Math.max(1, Math.round(day.minShiftLength / 30)) : 1;
      // The margin/hysteresis duration is anchored to the same configured
      // minimum shift length rather than being a second, separate dial --
      // per the "configure the facts, decide the philosophy" principle,
      // this is a judgment call Kedus is making once, not a new per-center
      // setting.
      const marginSlots = minSlots;

      const blocks = day._splitIntoBlocks();

      for (const blockSlots of blocks) {
        // canWork() left every AVAILABLE worker in slot.workers; that's the
        // candidate pool the assignment step below reads from via
        // day.totalWorkers/worker.availableAt(), not from here. Clear it now
        // so it holds only the workers actually ASSIGNED once this block is
        // done, matching what every other part of the app (and the old
        // per-slot-trim code) expects slot.workers to mean.
        for (const slot of blockSlots) slot.workers = [];

        const target = blockSlots.map((slot) => day._rawTarget(slot));
        const maxLevel = target.length ? Math.max(0, ...target) : 0;

        // Decompose the demand curve into levels; each surviving window
        // (after margin suppression + minimum-length extension) is one
        // worker-shift the algorithm has decided this block needs.
        const windows = [];
        for (let level = 1; level <= maxLevel; level++) {
          const raw = day._levelWindows(blockSlots, target, level, marginSlots);
          for (const [s, e] of raw) {
            const [es, ee] = day._extendToMinimum(blockSlots, target, s, e, minSlots);
            windows.push({ start: es, end: ee, level, assignedWorker: null });
          }
        }
        // Earliest windows get first pick of available workers. When two
        // windows share a start (very common: a demand spike right at
        // block-open produces both the wide base window and a narrower
        // supplemental one starting at the same moment), the WIDER window
        // is processed first, not the higher level. Processing the
        // narrower one first would let it grab a broadly-available worker
        // before the wide window gets a turn, locking that worker out of
        // covering their own full availability and leaving the wide
        // window's remainder falsely flagged as understaffed -- exactly
        // the "available 3-8, assigned 3-5, and 5-8 shows as needing
        // someone" bug this fixes.
        windows.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

        // Assign workers per window via a HANDOFF RELAY, not "one worker
        // must cover the whole thing or the window goes entirely unfilled".
        // Two people with perfectly ordinary partial availability (e.g.
        // one available 3-6, another 4:30-8) covering a window together via
        // a normal shift handoff is completely realistic scheduling -- the
        // old one-worker-only rule treated that as a total failure even
        // though the floor was genuinely fully covered. A worker already
        // used anywhere in this block (in this window or an earlier one)
        // is excluded everywhere else -- still the structural guarantee
        // that a worker gets at most one contiguous shift per block.
        const usedInBlock = new Set();

        // Covers as much of [win.start, win.end) as possible with a relay:
        // at the current position, pick whichever available (not yet used)
        // worker's contiguous availability reaches furthest past it -- the
        // standard optimal greedy for minimum interval covering, so a full
        // relay gets found whenever the worker pool actually allows one.
        // Ties go to whoever's higher priority (fewer points). Returns a
        // list of segments, each either {worker} (filled) or {worker:null}
        // (a genuine gap -- nobody available for that stretch, period).
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
              // Nobody available starting here. Scan forward to wherever
              // someone (still unused) next becomes available, marking
              // everything in between as a real, unavoidable gap.
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

        // Carry the decided target through to each slot (count of windows
        // covering it, independent of whether a worker was actually found).
        // Combined with slot.workers (already populated above with whoever
        // actually got assigned there, relay segments included), this is
        // everything the understaffing signal needs -- computed directly
        // in server.js as workersNeeded vs workers.length, no separate
        // window list required.
        for (let i = 0; i < blockSlots.length; i++) {
          blockSlots[i].workersNeeded = windows.filter((w) => i >= w.start && i < w.end).length;
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
