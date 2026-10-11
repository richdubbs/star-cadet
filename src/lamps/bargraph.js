/**
 * src/lamps/bargraph.js
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 6.1, 6.4; SPEC 5.5 (TLightBargraph), 5.13.6 (bargraph sketch)
 * class LightBargraph implements the Bargraph typedef (src/types.js) AND is a LightGroup (the original bargraph is a group subtype), so
 * lamps.group('fuel_bargraph') === lamps.fuel and the group verbs (broadcast, ...) work on the six fuel lamps.
 *
 * Fuel gauge (SPEC 5.5): LEVEL is an integer 0..11; lit lamps = floor(level / 2) + 1; the top lit lamp flashes at every EVEN level. Seconds spent at
 * each level (index = level): [3, 14, 3, 12, 3, 10, 3, 8, 3, 6, 3, 4] (sum 72). After setLevel(11) at t = 0 the level drops at t = 4, 7, 13, 16, 24, 27,
 * 37, 40, 52, 55, 69 s and everything goes dark with the "ended" hook at 72 s.
 *
 * setLevel(L): hooks.beforeSetLevel(L) (BEFORE the lamps / level change: SPEC callback-order quirk), cancel the level timer; L < 0: all off, level 0, no
 * timer; else split = floor(L / 2); members above split steady off, members 0..split steady on (cancels flashes); L even: indefinite flash on the top lit
 * lamp; start the timer durations[L]; level = L.
 * Timer expiry: level > 0 -> the same as setLevel(level - 1) (beforeSetLevel runs for it too) and then hooks.tick(newLevel) AFTER the update;
 * level == 0 -> all members off, level stays 0, hooks.ended().
 * Every hook is raised only after the bargraph has finished its own state update (re-entrancy: a hook may call setLevel / reset / any lamp verb).
 *
 * ASSUMPTIONS (gap protocol):
 *  - Quirk kept: lamps may be lit independently of `level` (at ball start the rules light all six lamps with lamps.on while level stays 0, no countdown).
 *  - setLevel(L) with L > 11 is clamped to 11; fractional L is floored; NaN / non-number throws TypeError (programmer error).
 *  - reset() = all six lamps steady off, level 0, no timer, group animation state dropped; it raises no hook.
 *  - setHooks(h) REPLACES the previous hook set (missing members clear that hook).
 *  - tiltStop() (called by lamps.tiltOff, SPEC 5.2.8 "the fuel bargraph level is reset to 0 on tilt"): level 0 and countdown cancelled WITHOUT touching the
 *    lamps' steady flags (they are held dark by the tilt overlay anyway) and without hooks.
 *  - playerChanged: level saved / restored as a number only (no countdown is restarted, lamps come back through their own per-player slots); the rules'
 *    end-of-ball block wipes it right afterwards (SPEC 5.13.5).
 */
import { LightGroup } from './group.js';
import { secondsToMs } from './wheel.js';

export class LightBargraph extends LightGroup {
  /**
   * @param {import('./wheel.js').TimerWheel} wheel
   * @param {{name:string, step?:number, durations:number[]}} def FUEL_BARGRAPH
   * @param {import('./lamp.js').Lamp[]} lamps the six fuel lamps, member 0 = the last one to go dark
   * @param {() => number} rand
   */
  constructor(wheel, def, lamps, rand) {
    super(wheel, def.name, lamps, def.step || 0.2, rand);
    /** seconds per level, index = level (copy) */
    this.durations = Array.from(def.durations);
    this._durMs = this.durations.map((d) => Math.max(1, secondsToMs(d)));
    this._maxLevel = this._durMs.length - 1;
    this._level = 0;
    this._levelH = 0;
    this._levelSlots = [0, 0, 0, 0];
    /** @type {{beforeSetLevel: null|((L:number)=>void), tick: null|((level:number)=>void), ended: null|(()=>void)}} */
    this._hooks = { beforeSetLevel: null, tick: null, ended: null };
    this._onLevelTimerFn = () => this._onLevelTimer();
  }

  /** Current level 0..11 (read-only). @returns {number} */
  get level() { return this._level; }

  /** A countdown timer is pending (false at ball start with the lamps lit but level 0, and after the countdown ended). @returns {boolean} */
  get running() { return this._levelH !== 0; }

  /**
   * Register the three callbacks (replaces the previous set).
   * @param {{beforeSetLevel?: (L:number)=>void, tick?: (level:number)=>void, ended?: ()=>void} | null} [h]
   */
  setHooks(h) {
    const src = h || {};
    this._hooks = {
      beforeSetLevel: typeof src.beforeSetLevel === 'function' ? src.beforeSetLevel : null,
      tick: typeof src.tick === 'function' ? src.tick : null,
      ended: typeof src.ended === 'function' ? src.ended : null,
    };
  }

  /**
   * ToggleSplitIndex (SPEC 5.5): set the fuel level and (re)start the countdown. L < 0 = all off, level 0, no timer.
   * @param {number} L
   */
  setLevel(L) {
    if (typeof L !== 'number' || Number.isNaN(L)) throw new TypeError('fuel.setLevel: level must be a number');
    const v = Math.min(Math.floor(L), this._maxLevel);
    const before = this._hooks.beforeSetLevel;
    if (before) before(v);
    this._apply(v);
  }

  /** All six lamps steady off, level 0, no countdown, animation state dropped (end-of-ball reset). No hook is raised. */
  reset() {
    this._dropState();
    const lamps = this._lamps;
    for (let i = lamps.length - 1; i >= 0; i--) lamps[i].off();
  }

  /** Tilt: level 0 and countdown cancelled, lamps untouched, no hooks (see ASSUMPTIONS). */
  tiltStop() {
    if (this._levelH) { this._wheel.cancel(this._levelH); this._levelH = 0; }
    this._level = 0;
  }

  // ---- internals -------------------------------------------------------------------------------------------------------------------------
  /** The lamp / level / timer update of setLevel, without the beforeSetLevel hook. @param {number} L already floored and clamped to <= max */
  _apply(L) {
    if (this._levelH) { this._wheel.cancel(this._levelH); this._levelH = 0; }
    const lamps = this._lamps;
    if (L < 0) {
      for (let i = lamps.length - 1; i >= 0; i--) lamps[i].off();
      this._level = 0;
      return;
    }
    const split = Math.min(L >> 1, lamps.length - 1);
    for (let i = lamps.length - 1; i >= 0; i--) {
      if (i > split) lamps[i].off(); else lamps[i].on();
    }
    if ((L & 1) === 0) lamps[split].flasherStart();
    this._level = L;
    this._levelH = this._wheel.schedule(this._durMs[L], this._onLevelTimerFn, 0);
  }

  _onLevelTimer() {
    this._levelH = 0;
    const hooks = this._hooks;
    if (this._level > 0) {
      const next = this._level - 1;
      if (hooks.beforeSetLevel) hooks.beforeSetLevel(next);
      this._apply(next);
      const tick = this._hooks.tick;
      if (tick) tick(this._level);
    } else {
      const lamps = this._lamps;
      for (let i = lamps.length - 1; i >= 0; i--) lamps[i].off();
      this._level = 0;
      const ended = this._hooks.ended;
      if (ended) ended();
    }
  }

  /** Group state plus the countdown (no lamp is touched). */
  _dropState() {
    super._dropState();
    if (this._levelH) { this._wheel.cancel(this._levelH); this._levelH = 0; }
    this._level = 0;
  }

  /** New game: everything dropped, saved per-player levels cleared. Registered hooks are kept. */
  hardReset() {
    super.hardReset();
    this._levelSlots.fill(0);
  }

  /**
   * PlayerChanged: save the level, drop the countdown, restore the incoming player's level (number only).
   * @param {number} outgoing @param {number} incoming
   */
  playerChanged(outgoing, incoming) {
    this._levelSlots[outgoing] = this._level;
    super.playerChanged(outgoing, incoming);
    this._level = this._levelSlots[incoming] | 0;
  }
}
