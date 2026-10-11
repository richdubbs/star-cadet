/**
 * src/rules/textbox.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7.4; SPEC 5.11
 * TextBoxQueue: FIFO of {text, seconds|-1}; push(text, seconds), clear(), tick(dt), current() -> string.
 * Semantics (SPEC 5.11 / research rules.md 11.1):
 *   - only the head of the queue is shown; empty text is ignored;
 *   - a message with seconds < 0 is persistent: it stays until a NEWER, different message is queued behind it;
 *   - a repeat of the NEWEST queued message only refreshes its timer (same slot, no duplicate);
 *   - a different message is appended; it expires `seconds` after it was ADDED (not after it became visible), so a message that had to wait
 *     behind a long head may only be visible briefly;
 *   - EXTENSION (gap protocol): a persistent message that is appended while the newest queued message is a persistent one that has not been
 *     shown yet replaces it (counter texts such as "Roll Flags: 74", "73", ... arrive faster than the 0.25 s minimum display; without this the
 *     visible text would lag by seconds);
 *   - a queued timed message that is already overdue by more than `skipOverdue` (2 s) when its turn comes is skipped;
 *   - every message that reaches the head is visible for at least `minDisplay` (0.25 s);
 *   - `\n` line breaks are the renderer's job; numbers are formatted by the callers (plain decimals).
 * The queue keeps its own clock (sum of tick(dt)); it never reads a wall clock.
 * ASSUMPTIONS: a non-finite `seconds` is treated as persistent; seconds === 0 behaves like "minimum display only"; see the EXTENSION above.
 */

const EPS = 1e-9;

export class TextBoxQueue {
  /** @param {{minDisplay?:number, skipOverdue?:number}} [opts] */
  constructor(opts = {}) {
    this._min = opts.minDisplay === undefined ? 0.25 : opts.minDisplay;
    this._skip = opts.skipOverdue === undefined ? 2.0 : opts.skipOverdue;
    this._now = 0;
    /** @type {{text:string, persistent:boolean, due:number, shownAt:number|null}[]} */
    this._q = [];
  }

  /**
   * @param {string} text
   * @param {number} seconds  -1 (any negative) = persistent
   */
  push(text, seconds) {
    if (text === undefined || text === null) return;
    const str = String(text);
    if (str === '') return;
    const persistent = !(Number.isFinite(seconds) && seconds >= 0);
    const due = persistent ? Infinity : this._now + seconds;
    const last = this._q[this._q.length - 1];
    if (last && last.text === str) {            // repeat of the newest queued message: refresh its timer only
      last.persistent = persistent;
      last.due = due;
      this._settle();
      return;
    }
    if (persistent && last && last.persistent && last.shownAt === null) {      // superseded before it was ever shown: replace it
      last.text = str;
      this._settle();
      return;
    }
    this._q.push({ text: str, persistent, due, shownAt: null });
    this._settle();
  }

  clear() { this._q.length = 0; }

  /** @param {number} dt seconds */
  tick(dt) {
    if (!(dt > 0)) return;
    this._now += dt;
    this._settle();
  }

  /** @returns {string} the visible message ('' when empty) */
  current() {
    const h = this._q[0];
    return h ? h.text : '';
  }

  /** @returns {number} queued messages including the visible one (diagnostics / tests) */
  size() { return this._q.length; }

  _settle() {
    const q = this._q;
    for (;;) {
      const h = q[0];
      if (!h) return;
      if (h.shownAt === null) {
        if (!h.persistent && this._now - h.due > this._skip + EPS) { q.shift(); continue; }   // overdue by more than 2 s: skipped
        h.shownAt = this._now;
      }
      const expired = h.persistent ? q.length > 1 : this._now >= h.due - EPS;
      if (expired && this._now - h.shownAt >= this._min - EPS) { q.shift(); continue; }
      return;
    }
  }
}
