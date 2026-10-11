/**
 * src/physics/timers.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.3 (timers fire first inside step(), in due-time / insertion order)
 * A tiny physics-time timer queue. Time is the engine's `time` in seconds (advanced only by step()). Pure, no clocks.
 *
 * - `schedule(due, fn, arg)` -> id. `due` is an ABSOLUTE physics time.
 * - `run(now)` fires every timer with due <= now + EPS, earliest first, ties by insertion order. Callbacks may schedule more timers
 *   (re-entrant); a timer scheduled during run() whose due time is already reached fires in the same run().
 * - `cancel(id)` is safe for unknown / already fired ids.
 * EPS absorbs floating point drift of accumulated 1/120 s steps (3 steps === 0.025 s exactly).
 */
export const TIMER_EPS = 1e-9;

export class Timers {
  constructor() {
    /** @type {{id:number, due:number, seq:number, fn:(due:number, arg:any)=>void, arg:any}[]} */
    this.items = [];
    this.nextId = 1;
    this.seq = 0;
  }

  /** @returns {number} timer id (always > 0) */
  schedule(due, fn, arg) {
    const id = this.nextId++;
    this.items.push({ id, due, seq: this.seq++, fn, arg });
    return id;
  }

  /** @param {number} id */
  cancel(id) {
    if (!id) return false;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) { items.splice(i, 1); return true; }
    }
    return false;
  }

  /** True while the id is still pending. */
  pending(id) {
    if (!id) return false;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].id === id) return true;
    return false;
  }

  /** Due time of a pending timer, or -1. */
  dueOf(id) {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].id === id) return this.items[i].due;
    return -1;
  }

  clear() {
    this.items.length = 0;
  }

  get size() {
    return this.items.length;
  }

  /** Fire everything due at `now`. */
  run(now) {
    const items = this.items;
    for (let guard = 0; guard < 100000; guard++) {
      let best = -1;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.due > now + TIMER_EPS) continue;
        if (best < 0 || it.due < items[best].due || (it.due === items[best].due && it.seq < items[best].seq)) best = i;
      }
      if (best < 0) return;
      const it = items[best];
      items.splice(best, 1);
      it.fn(it.due, it.arg);
    }
  }
}
