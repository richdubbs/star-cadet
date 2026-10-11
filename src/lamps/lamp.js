/**
 * src/lamps/lamp.js
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 6.1, 6.2; SPEC 5.13.1-5.13.2, 5.13.6 (TLight)
 * class Lamp: S, overlay, phase, offAfter, timeout, flash timer, field, onIdx + all verbs.
 *
 * State (SPEC 5.13.1): `S` steady flag; `overlay` 'none'|'flash'|'on'|'off' (mutually exclusive; 'on' = FORCE_ON, 'off' = FORCE_OFF); `phase` current flash
 * phase (true = lit); `offAfter` (clear S when the shared timeout fires); ONE shared timeout (every timed verb replaces it); the flash toggle timer;
 * `field` scratch register; `onIdx` which ON image (lite2/3/4 have 3).
 *
 * Visual vs rules state: isLit() is overlay-aware (render); lightOn() = S || FORCE_ON || FLASH (every rule test - FORCE_OFF does not count as off).
 *
 * Re-entrancy: the lamp finishes its own state update BEFORE it raises the ControlTimerExpired hook; the hook may call any verb on any lamp,
 * including this one. Nothing here holds an iterator while calling out.
 *
 * ASSUMPTIONS (gap protocol):
 *  - Timeout and flash-phase durations are whole ms (secondsToMs); a positive duration is at least 1 ms; flash phases are at least 1 ms.
 *  - `ResetTimed` keeps `offAfter` exactly as SPEC 5.13.2 says (only Reset() and the flash verbs clear it).
 *  - `tiltHold`: set by tiltBlackout() (the tilt broadcast TurnOffTimed(0)). While it is set the lamp ignores the group-animation layer
 *    (_animSet/_animReset), so group chases keep running but stay invisible during a tilt (SPEC 5.2.8: "animations keep running but are invisible").
 *    Any change of overlay away from FORCE_OFF clears it. It affects nothing else.
 *  - Non-finite numeric arguments: durations <= 0 / NaN mean "none"; field / onIdx / toggle values that are not finite count as 0.
 */
import { secondsToMs, timeoutMs } from './wheel.js';

/** @typedef {'none'|'flash'|'on'|'off'} Overlay */

/** Priority of flash toggles on the TimerWheel: after any other timer due at the same millisecond (timeout beats flash toggle). */
const FLASH_PRIORITY = 1;

export class Lamp {
  /**
   * @param {import('./wheel.js').TimerWheel} wheel
   * @param {{name:string, flash?:{off:number,on:number}, nStates?:number}} def  a LampDef (only name / flash / nStates are read)
   * @param {number} index position in LAMP_NAMES
   */
  constructor(wheel, def, index) {
    this.name = def.name;
    this.index = index;
    this._wheel = wheel;
    this.nStates = Math.max(1, Math.floor(def.nStates || 1));
    const flash = def.flash || { off: 0.1, on: 0.1 };
    /** dark-phase length ms (attr 900) */ this._offMs = Math.max(1, secondsToMs(flash.off));
    /** lit-phase length ms (attr 901) */ this._onMs = Math.max(1, secondsToMs(flash.on));
    /** steady flag */ this.S = false;
    /** @type {Overlay} */ this.overlay = 'none';
    /** current flash phase (true = lit) */ this.phase = false;
    /** clear S when the timeout fires */ this.offAfter = false;
    /** scratch register */ this.field = 0;
    /** which ON image */ this.onIdx = 0;
    /** true while the tilt FORCE_OFF blackout owns the lamp */ this.tiltHold = false;
    /** @type {null | ((lamp:string)=>void)} ControlTimerExpired hook */ this.hook = null;
    this._timeoutH = 0;
    this._flashH = 0;
    this._onTimeoutFn = () => this._onTimeout();
    this._onFlashFn = () => this._onFlash();
  }

  // ---- queries ---------------------------------------------------------------------------------------------------------------------------
  /** Visual state: FLASH -> phase, FORCE_ON -> true, FORCE_OFF -> false, else S. @returns {boolean} */
  isLit() {
    switch (this.overlay) {
      case 'flash': return this.phase;
      case 'on': return true;
      case 'off': return false;
      default: return this.S;
    }
  }

  /** light_on(): S || FORCE_ON || FLASH - the test every rule uses. @returns {boolean} */
  lightOn() { return this.S || this.overlay === 'on' || this.overlay === 'flash'; }

  /** @returns {boolean} a timeout is pending */
  hasTimeout() { return this._timeoutH !== 0; }

  // ---- internal helpers ------------------------------------------------------------------------------------------------------------------
  /** @param {Overlay} overlay */
  _setOverlay(overlay) {
    this.overlay = overlay;
    if (overlay !== 'off') this.tiltHold = false;
  }

  /** SetTimeout(t): cancel the timeout; t > 0 schedules a new one. @param {number} seconds */
  _setTimeout(seconds) {
    if (this._timeoutH) { this._wheel.cancel(this._timeoutH); this._timeoutH = 0; }
    const ms = timeoutMs(seconds);
    if (ms > 0) this._timeoutH = this._wheel.schedule(ms, this._onTimeoutFn, 0);
  }

  _cancelFlash() {
    if (this._flashH) { this._wheel.cancel(this._flashH); this._flashH = 0; }
  }

  /** Begin the waveform: the first phase is the OPPOSITE of S and is shown immediately. */
  _startFlash() {
    this._cancelFlash();
    this.phase = !this.S;
    this._setOverlay('flash');
    this._flashH = this._wheel.schedule(this.phase ? this._onMs : this._offMs, this._onFlashFn, FLASH_PRIORITY);
  }

  _onFlash() {
    this._flashH = 0;
    this.phase = !this.phase;
    this._flashH = this._wheel.schedule(this.phase ? this._onMs : this._offMs, this._onFlashFn, FLASH_PRIORITY);
  }

  /** Timeout expiry (SPEC 5.13.1): finish ALL state changes, then raise the hook. */
  _onTimeout() {
    this._timeoutH = 0;
    if (this.overlay === 'flash') this._cancelFlash();
    this._setOverlay('none');
    if (this.offAfter) { this.offAfter = false; this.S = false; }
    const hook = this.hook;
    if (hook) hook(this.name);
  }

  // ---- verbs (SPEC 5.13.2) ---------------------------------------------------------------------------------------------------------------
  /** TurnOn: raw S = true (overlays untouched). */
  turnOn() { this.S = true; }

  /** TurnOff: raw S = false (overlays untouched). */
  turnOff() { this.S = false; }

  /** ResetTimed: cancel timeout + flash, overlay NONE; S, offAfter, field, onIdx kept. */
  resetTimed() {
    if (this._timeoutH) { this._wheel.cancel(this._timeoutH); this._timeoutH = 0; }
    this._cancelFlash();
    this._setOverlay('none');
  }

  /** ResetAndTurnOn (`lit`): S = true then ResetTimed. */
  on() { this.S = true; this.resetTimed(); }

  /** ResetAndTurnOff (`unlit`): S = false then ResetTimed. */
  off() { this.S = false; this.resetTimed(); }

  /** FlasherStart: cancel the timeout; flash indefinitely (an already running waveform is not restarted). */
  flasherStart() {
    this._setTimeout(0);
    if (this.overlay !== 'flash' || !this._flashH) {
      this._setOverlay('flash');
      this.offAfter = false;
      this._startFlash();
    }
  }

  /** FlasherStartTimed(t) (`flash`): start the waveform if not flashing; timeout t (t <= 0: none, flashes until reset). @param {number} [seconds] */
  flash(seconds) {
    if (this.overlay !== 'flash') this._startFlash();
    this._setOverlay('flash');
    this.offAfter = false;
    this._setTimeout(seconds);
  }

  /** flashThenOn: S = true now (it counts), flash t seconds, end steady lit. @param {number} seconds */
  flashThenOn(seconds) {
    this.offAfter = false;
    this.S = true;
    this.flash(seconds);
  }

  /** flashThenOff: flash t seconds, then S = false (t <= 0 flashes forever). @param {number} seconds */
  flashThenOff(seconds) {
    this.flash(seconds);
    this.offAfter = true;
  }

  /** TurnOnTimed(t): FORCE_ON overlay for t seconds (stops any flash), then back to S. t <= 0: until reset. @param {number} seconds */
  timedOn(seconds) {
    if (this.overlay !== 'on') {
      if (this.overlay === 'flash') this._cancelFlash();
      this._setOverlay('on');
    }
    this._setTimeout(seconds);
  }

  /** TurnOffTimed(t): FORCE_OFF overlay for t seconds. t <= 0: until reset (tilt). @param {number} seconds */
  timedOff(seconds) {
    if (this.overlay !== 'off') {
      if (this.overlay === 'flash') this._cancelFlash();
      this._setOverlay('off');
    }
    this._setTimeout(seconds);
  }

  /** ToggleValue(v): S = floor(v) != 0. @param {number} v */
  toggleValue(v) { this.S = Number.isFinite(v) && Math.floor(v) !== 0; }

  /** ResetAndToggleValue(v): ToggleValue then ResetTimed. @param {number} v */
  resetAndToggleValue(v) { this.toggleValue(v); this.resetTimed(); }

  /** SetMessageField(v): field = floor(v). @param {number} v */
  setField(v) { this.field = Number.isFinite(v) ? Math.floor(v) : 0; }

  /** SetOnStateBmpIndex(i): onIdx = clamp(floor(i), 0, nStates - 1). @param {number} i */
  setOnIdx(i) {
    const n = Number.isFinite(i) ? Math.floor(i) : 0;
    this.onIdx = n < 0 ? 0 : n > this.nStates - 1 ? this.nStates - 1 : n;
  }

  /** Reset() (new game / player change): S = false, everything cancelled, overlay NONE, offAfter = false, onIdx = 0, field = 0. The hook is kept. */
  reset() {
    this.S = false;
    this.offAfter = false;
    this.resetTimed();
    this.phase = false;
    this.onIdx = 0;
    this.field = 0;
    this.tiltHold = false;
  }

  // ---- tilt ------------------------------------------------------------------------------------------------------------------------------
  /** The tilt broadcast: TurnOffTimed(0) and remember that the blackout owns this lamp (see ASSUMPTIONS). */
  tiltBlackout() {
    this.timedOff(0);
    this.tiltHold = true;
  }

  // ---- group animation layer -------------------------------------------------------------------------------------------------------------
  /** Group chase / light-show layer: FORCE_ON / FORCE_OFF without timeout; ignored while the tilt blackout owns the lamp. @param {boolean} lit */
  _animSet(lit) {
    if (this.tiltHold) return;
    if (lit) this.timedOn(0); else this.timedOff(0);
  }

  /** Undo the group animation layer (ResetTimed), except on lamps held dark by the tilt blackout. */
  _animReset() {
    if (this.tiltHold) return;
    this.resetTimed();
  }
}
