/**
 * src/lamps/group.js
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 6.1, 6.3; SPEC 5.13.3 (TLightGroup)
 * class LightGroup implements the LampGroup typedef (src/types.js): an ordered list of Lamp members plus the group verbs, the chase / light-show /
 * game-over animations (one shared step timer) and the decay "notify" timer.
 *
 * Layers: S (steady) is the rules' layer: nextOn / dropTop / offsetForward / stepForward / stepBackward / flashWhenOn / broadcast work on it.
 * The animations work on the OVERLAY layer (FORCE_ON / FORCE_OFF on every member, mirroring S when they start); groupReset() removes it again.
 * gameOver() is the exception: it writes the steady layer (ResetAndToggleValue), as the original does.
 *
 * ASSUMPTIONS (gap protocol):
 *  - Direction names: Backward = the pattern moves toward HIGHER member index (same as stepBackward); Forward = toward lower index, both with wrap.
 *  - animationForward/Backward always re-mirror S and restart the step timer (SPEC: "if an animation is running or none: mirror()"), the first frame is
 *    already shifted by one and runs synchronously inside the call.
 *  - lightShow's first pulse tick happens one period after the call (SPEC 5.2.1 "every 0.2 s"); gameOver's first tick runs immediately (SPEC 5.2.7).
 *  - The "29 %" test is the original's `floor(rand()*100) > 70` (29 of 100 values), one rand() per member per tick (index order), one more rand()
 *    for the pulse length u in lightShow when the member is hit.
 *  - The group "register" of SPEC 5.13.5 is always 0 in this build; it is kept as an internal integer that playerChanged saves / restores. A running
 *    animation is never resumed after a player change, so isAnimating() is false afterwards.
 *  - onNotifyExpired() may be registered on any group (the rules use it on hyperspace_lights, bumper_target_lights, top_target_lights).
 *    restartNotifyTimer(t <= 0) only cancels. The notify timer is NOT touched by groupReset() (SPEC) but is cancelled by resetAll / playerChanged.
 *  - Group animations skip lamps held dark by the tilt blackout (Lamp.tiltHold): they keep running invisibly during a tilt (SPEC 5.2.8).
 *  - broadcast() accepts the LampVerbName verbs plus 'setField' and 'setOnIdx' (rules use field(group) = 0, SPEC 5.2.4).
 */
import { secondsToMs, timeoutMs } from './wheel.js';

/** Probability test of the original: `floor(rand * 100) > 70` is true for 29 of the 100 values. */
const HIT_PERCENT_THRESHOLD = 70;

/** @type {Record<string, (lamp: import('./lamp.js').Lamp, arg: number) => void>} verb table of broadcast() */
const VERBS = {
  turnOn: (l) => l.turnOn(),
  turnOff: (l) => l.turnOff(),
  on: (l) => l.on(),
  off: (l) => l.off(),
  flash: (l, a) => l.flash(a),
  flasherStart: (l) => l.flasherStart(),
  flashThenOn: (l, a) => l.flashThenOn(a),
  flashThenOff: (l, a) => l.flashThenOff(a),
  timedOn: (l, a) => l.timedOn(a),
  timedOff: (l, a) => l.timedOff(a),
  resetTimed: (l) => l.resetTimed(),
  toggleValue: (l, a) => l.toggleValue(a),
  resetAndToggleValue: (l, a) => l.resetAndToggleValue(a),
  setField: (l, a) => l.setField(a),
  setOnIdx: (l, a) => l.setOnIdx(a),
};

export class LightGroup {
  /**
   * @param {import('./wheel.js').TimerWheel} wheel
   * @param {string} name
   * @param {import('./lamp.js').Lamp[]} lamps members in group order
   * @param {number} defaultStep default animation period in seconds (attr 903)
   * @param {() => number} rand injected Rand01
   */
  constructor(wheel, name, lamps, defaultStep, rand) {
    this.name = name;
    this._wheel = wheel;
    this._lamps = lamps;
    /** @type {string[]} member lamp names, group order */
    this.members = lamps.map((l) => l.name);
    this._rand = rand;
    this._defaultStepMs = Math.max(1, secondsToMs(defaultStep > 0 ? defaultStep : 0.08));
    /** @type {'none'|'chase'|'lightShow'|'gameOver'} */ this._kind = 'none';
    /** +1: pattern moves toward higher index (Backward), -1: toward lower index (Forward) */ this._dir = 1;
    this._stepH = 0;
    this._stepMs = this._defaultStepMs;
    this._stepSeconds = 0.2;
    this._pat = new Uint8Array(lamps.length);
    this._notifyH = 0;
    /** @type {null | ((group:string)=>void)} */ this._notifyFn = null;
    this._register = 0;
    this._slots = [0, 0, 0, 0];
    this._onStepFn = () => this._onStep();
    this._onNotifyFn = () => this._onNotify();
  }

  // ---- queries ---------------------------------------------------------------------------------------------------------------------------
  /** GetOnCount: members whose steady flag S is true. @returns {number} */
  count() {
    let n = 0;
    const lamps = this._lamps;
    for (let i = 0; i < lamps.length; i++) if (lamps[i].S) n++;
    return n;
  }

  /** An animation (chase / light show / game over) is running. @returns {boolean} */
  isAnimating() { return this._kind !== 'none'; }

  /** The LAST member is flashing. @returns {boolean} */
  lastFlashing() {
    const n = this._lamps.length;
    return n > 0 && this._lamps[n - 1].overlay === 'flash';
  }

  // ---- steady-layer verbs ----------------------------------------------------------------------------------------------------------------
  /**
   * ResetAndTurnOn(t): the first unlit member (lowest index, S false) does flashThenOn(t).
   * @param {number} [t] seconds (default 2.0; 5.0 for a rank promotion)
   * @returns {boolean} false (and nothing happens) when every member is lit
   */
  nextOn(t = 2.0) {
    const lamps = this._lamps;
    for (let i = 0; i < lamps.length; i++) {
      if (!lamps[i].S) {
        if (this._kind !== 'none') this.groupReset();            // research/rules.md L5 #41: "if an animation is running: GroupReset" first
        lamps[i].flashThenOn(t);
        return true;
      }
    }
    return false;
  }

  /**
   * OffsetAnimationBackward: steady-off (no flash) the highest-index lit member. While an overlay animation (chase / light show) runs the group
   * re-mirrors its steady layer afterwards (research/rules.md L5 #33), otherwise the stale animation pattern would keep showing the dropped lamp.
   * @returns {boolean} false if none is lit
   */
  dropTop() {
    const lamps = this._lamps;
    for (let i = lamps.length - 1; i >= 0; i--) {
      if (lamps[i].S) { lamps[i].off(); this._resync(); return true; }
    }
    return false;
  }

  /** OffsetAnimationForward: steady-on (no flash) the first unlit member (re-mirrors a running overlay animation like dropTop). @returns {boolean} false if every member is lit */
  offsetForward() {
    const lamps = this._lamps;
    for (let i = 0; i < lamps.length; i++) {
      if (!lamps[i].S) { lamps[i].on(); this._resync(); return true; }
    }
    return false;
  }

  /** The steady layer changed under a running overlay animation (chase / light show): mirror() again so the pattern follows S. */
  _resync() {
    if (this._kind === 'chase' || this._kind === 'lightShow') this._mirror();
  }

  /** StepBackward(0): rotate the steady layer (S, field) toward HIGHER index with wrap; no-op while the last member is flashing / in any overlay. */
  stepBackward() {
    const lamps = this._lamps;
    const n = lamps.length;
    if (n < 2 || lamps[n - 1].overlay !== 'none') return;
    const lastS = lamps[n - 1].S;
    const lastF = lamps[n - 1].field;
    for (let i = n - 1; i > 0; i--) { lamps[i].S = lamps[i - 1].S; lamps[i].field = lamps[i - 1].field; }
    lamps[0].S = lastS;
    lamps[0].field = lastF;
  }

  /** StepForward(0): rotate the steady layer (S, field) toward LOWER index with wrap; no-op while the last member is flashing / in any overlay. */
  stepForward() {
    const lamps = this._lamps;
    const n = lamps.length;
    if (n < 2 || lamps[n - 1].overlay !== 'none') return;
    const firstS = lamps[0].S;
    const firstF = lamps[0].field;
    for (let i = 0; i < n - 1; i++) { lamps[i].S = lamps[i + 1].S; lamps[i].field = lamps[i + 1].field; }
    lamps[n - 1].S = firstS;
    lamps[n - 1].field = firstF;
  }

  /**
   * FlashWhenOn(t): every lit member (S true) gets S = false now and then blinks t seconds and ends off (skill-shot award, t = 1.0).
   * @param {number} t seconds
   */
  flashWhenOn(t) {
    const lamps = this._lamps;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      if (!l.S) continue;
      l.S = false;
      l.flashThenOff(t);
    }
  }

  /**
   * Apply a lamp verb to every member, LAST member first (SPEC 5.13: unhandled group messages are broadcast to every member).
   * @param {import('../types.js').LampVerbName | 'setField' | 'setOnIdx'} verb
   * @param {number} [arg] seconds for the timed verbs, the value for toggleValue / setField / setOnIdx
   */
  broadcast(verb, arg) {
    if (typeof verb !== 'string' || !Object.prototype.hasOwnProperty.call(VERBS, verb)) {
      throw new TypeError(`unknown lamp verb "${String(verb)}"`);
    }
    const fn = VERBS[verb];
    const lamps = this._lamps;
    for (let i = lamps.length - 1; i >= 0; i--) fn(lamps[i], /** @type {number} */ (arg));
  }

  // ---- animations (overlay layer) --------------------------------------------------------------------------------------------------------
  /** @param {number|undefined} step seconds; <= 0 / omitted = group default @returns {number} ms */
  _periodMs(step) { return step !== undefined && step > 0 ? timeoutMs(step) : this._defaultStepMs; }

  _cancelStep() {
    if (this._stepH) { this._wheel.cancel(this._stepH); this._stepH = 0; }
  }

  /** mirror(): give every member a FORCE_ON / FORCE_OFF overlay that mirrors its S and remember that pattern. */
  _mirror() {
    const lamps = this._lamps;
    for (let i = lamps.length - 1; i >= 0; i--) {
      this._pat[i] = lamps[i].S ? 1 : 0;
      lamps[i]._animSet(lamps[i].S);
    }
  }

  /** Rotate the remembered overlay pattern one place in `_dir` and write it to the members. */
  _rotateOverlay() {
    const p = this._pat;
    const n = p.length;
    if (n > 1) {
      if (this._dir > 0) {
        const last = p[n - 1];
        for (let i = n - 1; i > 0; i--) p[i] = p[i - 1];
        p[0] = last;
      } else {
        const first = p[0];
        for (let i = 0; i < n - 1; i++) p[i] = p[i + 1];
        p[n - 1] = first;
      }
    }
    const lamps = this._lamps;
    for (let i = 0; i < n; i++) lamps[i]._animSet(p[i] === 1);
  }

  /** @param {1|-1} dir @param {number|undefined} step */
  _startChase(dir, step) {
    this._cancelStep();
    this._mirror();
    this._kind = 'chase';
    this._dir = dir;
    this._stepMs = this._periodMs(step);
    this._rotateOverlay();
    this._stepH = this._wheel.schedule(this._stepMs, this._onStepFn, 0);
  }

  /**
   * AnimationBackward(step): chase on the overlay layer, the pattern moves toward higher index every `step` seconds until groupReset().
   * @param {number} [step] seconds; <= 0 / omitted = the group default (attr 903)
   */
  animationBackward(step) { this._startChase(1, step); }

  /**
   * AnimationForward(step): like animationBackward but the pattern moves toward lower index.
   * @param {number} [step] seconds; <= 0 / omitted = the group default
   */
  animationForward(step) { this._startChase(-1, step); }

  /**
   * LightShowAnimation: mirror(); every `step` seconds each member has a 29 % chance of TurnOnTimed(0.1 + u * 3 * step).
   * @param {number} [step] seconds (default 0.2)
   */
  lightShow(step = 0.2) {
    const s = step > 0 ? step : 0.2;
    this._cancelStep();
    this._mirror();
    this._kind = 'lightShow';
    this._stepSeconds = s;
    this._stepMs = timeoutMs(s);
    this._stepH = this._wheel.schedule(this._stepMs, this._onStepFn, 0);
  }

  /**
   * GameOverAnimation: immediately and every `step` seconds each member gets ResetAndToggleValue(1 with 29 %, else 0).
   * @param {number} [step] seconds (default 1.4)
   */
  gameOver(step = 1.4) {
    const s = step > 0 ? step : 1.4;
    this._cancelStep();
    this._kind = 'gameOver';
    this._stepMs = timeoutMs(s);
    this._gameOverTick();
    this._stepH = this._wheel.schedule(this._stepMs, this._onStepFn, 0);
  }

  _gameOverTick() {
    const lamps = this._lamps;
    for (let i = 0; i < lamps.length; i++) {
      lamps[i].resetAndToggleValue(Math.floor(this._rand() * 100) > HIT_PERCENT_THRESHOLD ? 1 : 0);
    }
  }

  _lightShowTick() {
    const lamps = this._lamps;
    for (let i = 0; i < lamps.length; i++) {
      if (Math.floor(this._rand() * 100) > HIT_PERCENT_THRESHOLD) {
        const u = this._rand();
        if (!lamps[i].tiltHold) lamps[i].timedOn(0.1 + u * 3 * this._stepSeconds);
      }
    }
  }

  _onStep() {
    this._stepH = 0;
    switch (this._kind) {
      case 'chase': this._rotateOverlay(); break;
      case 'lightShow': this._lightShowTick(); break;
      case 'gameOver': this._gameOverTick(); break;
      default: return;
    }
    if (this._kind !== 'none' && !this._stepH) this._stepH = this._wheel.schedule(this._stepMs, this._onStepFn, 0);
  }

  /** GroupReset: cancel the step timer; if an OVERLAY animation (chase / light show) was running remove its overlays (ResetTimed broadcast). S untouched. */
  groupReset() {
    this._cancelStep();
    const overlayAnimation = this._kind === 'chase' || this._kind === 'lightShow';
    this._kind = 'none';
    if (overlayAnimation) {
      const lamps = this._lamps;
      for (let i = lamps.length - 1; i >= 0; i--) lamps[i]._animReset();
    }
  }

  // ---- decay (notify) timer --------------------------------------------------------------------------------------------------------------
  /**
   * RestartNotifyTimer(t): (re)start the decay timer. On expiry the group ONLY raises the handler (rules do dropTop(), restart, lower the multiplier).
   * t <= 0 just cancels it.
   * @param {number} t seconds
   */
  restartNotifyTimer(t) {
    if (this._notifyH) { this._wheel.cancel(this._notifyH); this._notifyH = 0; }
    const ms = timeoutMs(t);
    if (ms > 0) this._notifyH = this._wheel.schedule(ms, this._onNotifyFn, 0);
  }

  /** ControlNotifyTimerExpired handler; replaces any previous one. @param {null | ((group:string)=>void)} fn */
  onNotifyExpired(fn) {
    if (fn !== null && fn !== undefined && typeof fn !== 'function') throw new TypeError('onNotifyExpired: fn must be a function or null');
    this._notifyFn = fn || null;
  }

  _onNotify() {
    this._notifyH = 0;
    const fn = this._notifyFn;
    if (fn) fn(this.name);
  }

  // ---- reset / per-player (used by the Lamps facade) --------------------------------------------------------------------------------------
  /** Drop all timers and animation state (no lamp is touched). Bargraph extends this. */
  _dropState() {
    this._cancelStep();
    this._kind = 'none';
    if (this._notifyH) { this._wheel.cancel(this._notifyH); this._notifyH = 0; }
    this._register = 0;
  }

  /** Reset() for a new game: all group state dropped, saved per-player registers cleared. Members are reset by the facade. Registered hooks are kept. */
  hardReset() {
    this._dropState();
    this._slots.fill(0);
  }

  /**
   * PlayerChanged (SPEC 5.13.5): save the register into the outgoing slot, Reset(), load the incoming slot. A running animation is not resumed.
   * @param {number} outgoing 0..3 @param {number} incoming 0..3
   */
  playerChanged(outgoing, incoming) {
    this._slots[outgoing] = this._register;
    this._dropState();
    this._register = this._slots[incoming] | 0;
  }
}
