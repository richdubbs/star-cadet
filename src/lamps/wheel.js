/**
 * src/lamps/wheel.js
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 6.1; SPEC 5.13.1 (integer-ms timer wheel)
 * TimerWheel: schedule(ms, fn)->id, cancel(id), advance(ms) fires due timers ONE AT A TIME in (time, priority, insertion) order; callbacks may
 * schedule/cancel more timers (re-entrant); a timer scheduled during advance that is already due fires within the same advance. now() = ms elapsed.
 *
 * The wheel never reads a wall clock: time moves only through advance(). While a callback runs, now() is the DUE time of the timer that is firing
 * (not the end of the advance), so "after(5 s)" scheduled from inside a callback that was due at 5000 ms lands at 10000 ms even when the whole advance was
 * one big call.
 *
 * ASSUMPTIONS:
 *  - schedule() takes an optional third argument `priority` (default 0). Timers due at the same millisecond fire by ascending priority, then by insertion
 *    order. The lamp flash toggles use priority 1, every other timer 0, which implements "a timeout and a flash toggle on the same ms: the timeout wins"
 *    (SPEC 5.13.1) even when the toggle was inserted first.
 *  - A callback that calls advance() (misuse) does not recurse: the extra time is added to the running advance.
 *  - Delays are truncated to whole milliseconds; negative / NaN delays mean 0 (fires within the current advance, or at the next advance).
 *  - Timer records are pooled: after warm-up a schedule/fire cycle allocates nothing.
 */

/**
 * Seconds -> integer milliseconds exactly as the lamp verbs do: Math.trunc(seconds * 1000), with a 1e-6 ms guard so that values such as 0.57 s
 * (569.9999999999999 in floating point) do not lose a whole millisecond. Non-positive and non-finite input gives 0.
 * @param {number} seconds
 * @returns {number}
 */
export function secondsToMs(seconds) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
  return Math.trunc(seconds * 1000 + 1e-6);
}

/**
 * Seconds -> a timer delay in ms for a verb that takes a positive duration: 0 means "none" (t <= 0), any positive duration is at least 1 ms so that a
 * tiny positive time can never be mistaken for the "indefinite" value 0.
 * @param {number} seconds
 * @returns {number}
 */
export function timeoutMs(seconds) {
  if (!(seconds > 0)) return 0;
  const ms = secondsToMs(seconds);
  return ms > 0 ? ms : 1;
}

/** @typedef {{id:number, time:number, prio:number, seq:number, fn:(null|(()=>void))}} TimerRec */

export class TimerWheel {
  constructor() {
    this._now = 0;
    this._nextId = 1;
    this._seq = 0;
    /** @type {TimerRec[]} binary min-heap ordered by (time, prio, seq); cancelled records stay until they reach the top (fn === null) */
    this._heap = [];
    /** @type {Map<number, TimerRec>} live timers by id */
    this._live = new Map();
    /** @type {TimerRec[]} recycled records */
    this._pool = [];
    this._running = false;
    this._target = 0;
  }

  /**
   * Schedule `fn` to run `ms` milliseconds from now().
   * @param {number} ms delay (truncated; <= 0 or NaN = 0)
   * @param {() => void} fn
   * @param {number} [priority] ties at the same millisecond fire by ascending priority, then insertion order (default 0)
   * @returns {number} id (> 0)
   */
  schedule(ms, fn, priority = 0) {
    if (typeof fn !== 'function') throw new TypeError('TimerWheel.schedule: fn must be a function');
    const delay = ms > 0 && Number.isFinite(ms) ? Math.trunc(ms) : 0;
    const rec = this._pool.pop() || { id: 0, time: 0, prio: 0, seq: 0, fn: null };
    rec.id = this._nextId++;
    rec.time = this._now + delay;
    rec.prio = priority;
    rec.seq = this._seq++;
    rec.fn = fn;
    this._live.set(rec.id, rec);
    this._push(rec);
    return rec.id;
  }

  /**
   * Cancel a pending timer. Unknown / already fired / already cancelled ids (and 0) are ignored.
   * @param {number} id
   */
  cancel(id) {
    if (!id) return;
    const rec = this._live.get(id);
    if (!rec) return;
    this._live.delete(id);
    rec.fn = null;
  }

  /**
   * Move time forward by `ms` whole milliseconds, firing every timer that falls due, one at a time, in (time, priority, insertion) order.
   * @param {number} ms
   */
  advance(ms) {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    const whole = Math.trunc(ms);
    if (whole <= 0) return;
    if (this._running) { this._target += whole; return; }
    this._running = true;
    this._target = this._now + whole;
    try {
      for (;;) {
        const rec = this._heap[0];
        if (rec === undefined) break;
        if (rec.fn === null) { this._pop(); this._pool.push(rec); continue; }
        if (rec.time > this._target) break;
        this._pop();
        const fn = rec.fn;
        const time = rec.time;
        this._live.delete(rec.id);
        rec.fn = null;
        this._pool.push(rec);
        if (time > this._now) this._now = time;
        fn();
      }
      this._now = this._target;
    } finally {
      this._running = false;
    }
  }

  /** @returns {number} milliseconds elapsed (inside a callback: the due time of the firing timer) */
  now() { return this._now; }

  /** @returns {number} number of pending (live) timers */
  size() { return this._live.size; }

  /** Cancel every pending timer (time is kept). */
  clear() {
    for (const rec of this._live.values()) rec.fn = null;
    this._live.clear();
  }

  // ---- binary heap -------------------------------------------------------------------------------------------------------------------------
  /** @param {TimerRec} a @param {TimerRec} b */
  static _less(a, b) {
    if (a.time !== b.time) return a.time < b.time;
    if (a.prio !== b.prio) return a.prio < b.prio;
    return a.seq < b.seq;
  }

  /** @param {TimerRec} rec */
  _push(rec) {
    const h = this._heap;
    let i = h.length;
    h.push(rec);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!TimerWheel._less(rec, h[p])) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = rec;
  }

  _pop() {
    const h = this._heap;
    const last = h.pop();
    if (h.length === 0 || last === undefined) return;
    let i = 0;
    const n = h.length;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && TimerWheel._less(h[c + 1], h[c])) c++;
      if (!TimerWheel._less(h[c], last)) break;
      h[i] = h[c];
      i = c;
    }
    h[i] = last;
  }
}
