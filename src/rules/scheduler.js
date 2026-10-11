/**
 * src/rules/scheduler.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7.1
 * Scheduler (float seconds): after(seconds, fn) -> handle, cancel(handle), cancelAll(), advance(dt), now().
 * Fires due callbacks in (due time, insertion) order. Re-entrant: callbacks may schedule or cancel timers, and a timer that is already due
 * when it is scheduled (delay <= 0, or short enough to land inside the span being advanced) fires within the SAME advance() call.
 * While a callback runs, now() reports that timer's own due time, so chained `after()` calls are exact (no drift from the step size).
 * A callback that throws is NOT swallowed (the timer is already removed, the clock stays consistent for the caller that catches).
 * No setTimeout / Date: time enters only through advance(dt). The game "pauses" simply by not calling advance().
 * ASSUMPTIONS: a non-finite or negative delay is treated as 0; due comparisons use a 1e-9 s tolerance so 120 Hz float accumulation never
 * delays a timer by a whole step.
 */

const EPS = 1e-9;

export class Scheduler {
  constructor() {
    this._now = 0;
    this._seq = 0;
    /** @type {{id:number, due:number, fn:() => void}[]} sorted by (due, id) */
    this._timers = [];
  }

  /**
   * @param {number} seconds delay from now()
   * @param {() => void} fn
   * @returns {number} handle (positive integer, never reused)
   */
  after(seconds, fn) {
    if (typeof fn !== 'function') throw new TypeError('Scheduler.after: fn must be a function');
    const delay = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const t = { id: ++this._seq, due: this._now + delay, fn };
    const a = this._timers;
    let i = a.length;
    while (i > 0 && a[i - 1].due > t.due) i--;     // after every timer with due <= t.due (insertion order among equals)
    a.splice(i, 0, t);
    return t.id;
  }

  /** @param {number|null|undefined} handle  unknown / already fired handles are ignored */
  cancel(handle) {
    if (handle === null || handle === undefined) return;
    const a = this._timers;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id === handle) { a.splice(i, 1); return; }
    }
  }

  cancelAll() { this._timers.length = 0; }

  /** @param {number} dt seconds to move the clock forward */
  advance(dt) {
    if (!(dt > 0)) return;
    const target = this._now + dt;
    for (;;) {
      const t = this._timers[0];
      if (!t || t.due > target + EPS) break;
      this._timers.shift();
      if (t.due > this._now) this._now = t.due;
      t.fn();
    }
    if (target > this._now) this._now = target;
  }

  /** @returns {number} seconds advanced so far */
  now() { return this._now; }

  /** @returns {number} number of pending timers (diagnostics / tests) */
  pending() { return this._timers.length; }

  /** @param {number} handle @returns {boolean} true while the timer is still pending */
  isPending(handle) {
    for (const t of this._timers) if (t.id === handle) return true;
    return false;
  }
}
