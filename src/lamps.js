/**
 * src/lamps.js
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 6; type Lamps (src/types.js); SPEC 5.13 (lamp engine), 5.5 (fuel), 5.2.8 (tilt), 5.13.5 (per-player save)
 * Facade: createLamps(opts) -> Lamps. Pure Node module (imports only src/data and src/lamps/*). All timers are integer ms on a private TimerWheel
 * advanced ONLY by advance(dt) / advanceMs(ms) - no wall clock, no setTimeout, no Math.random (the injected `rand` is the only randomness, used by the
 * light-show and game-over animations).
 *
 * Objects: 140 Lamp (TLight), 18 LightGroup + the hidden 'all' group + the LightBargraph 'fuel_bargraph' (also reachable as lamps.fuel).
 * Names are the strings of LAMP_NAMES / LAMP_GROUP_NAMES; unknown names throw TypeError (programmer error).
 *
 * ASSUMPTIONS (gap protocol; details in the module headers of src/lamps/*.js):
 *  - advance(dt): dt seconds are converted to ms with the fractional part carried (1e-6 ms tolerance so 120 steps of 1/120 s are exactly 1000 ms).
 *  - fillView: the first call on a fresh view counts as a change (version 0 -> 1); a view is compared with its own previous contents, so several views
 *    can be filled independently.
 *  - onLampTimer(name, null) clears the hook; the hook set is LAMP_HOOK_NAMES of the injected data (default: lite17 lite59 lite60 lite200).
 *  - tiltOff() = TurnOffTimed(0) on all lamps (last member first), lite77 FlasherStart, and the fuel countdown / level are cleared (SPEC 5.2.8)
 *    without touching any steady flag. clearTiltLock() = ResetTimed on all lamps.
 *  - playerChanged(outgoing, incoming): players are 0..3; a player that was never saved starts from the blank (reset) state; resetAll() forgets all saves.
 *  - Extra (additive) API: lamps.group('fuel_bargraph') === lamps.fuel; group.broadcast also accepts 'setField' and 'setOnIdx'.
 */
import * as defaultData from './data/index.js';
import { TimerWheel } from './lamps/wheel.js';
import { Lamp } from './lamps/lamp.js';
import { LightGroup } from './lamps/group.js';
import { LightBargraph } from './lamps/bargraph.js';

const PLAYER_SLOTS = 4;
const TILT_LAMP = 'lite77';

/**
 * @param {import('./types.js').CreateLampsOpts} [opts]
 * @returns {import('./types.js').Lamps}
 */
export function createLamps(opts = {}) {
  const data = opts.data || defaultData;
  const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
  const wheel = new TimerWheel();

  // ---- build the objects ----------------------------------------------------------------------------------------------------------------
  const defs = data.LAMPS;
  /** @type {Lamp[]} */
  const lampList = defs.map((def, i) => new Lamp(wheel, def, i));
  /** @type {Map<string, Lamp>} */
  const byName = new Map();
  for (const l of lampList) byName.set(l.name, l);
  const names = lampList.map((l) => l.name);

  /** @param {string} name @returns {Lamp} */
  function L(name) {
    const lamp = byName.get(name);
    if (lamp === undefined) throw new TypeError(`unknown lamp "${String(name)}"`);
    return lamp;
  }

  /** @param {string} groupName @param {string[]} members */
  const memberLamps = (groupName, members) => members.map((m) => {
    const lamp = byName.get(m);
    if (lamp === undefined) throw new TypeError(`group "${groupName}" has unknown member lamp "${m}"`);
    return lamp;
  });

  /** @type {Map<string, LightGroup>} */
  const groups = new Map();
  for (const g of data.LAMP_GROUPS) groups.set(g.name, new LightGroup(wheel, g.name, memberLamps(g.name, g.members), g.step, rand));
  const allName = data.ALL_LAMPS_GROUP_NAME || 'all';
  groups.set(allName, new LightGroup(wheel, allName, lampList, 0.08, rand));
  const fuel = new LightBargraph(wheel, data.FUEL_BARGRAPH, memberLamps(data.FUEL_BARGRAPH.name, data.FUEL_BARGRAPH.members), rand);
  groups.set(fuel.name, fuel);
  /** @type {LightGroup[]} */
  const groupList = Array.from(groups.values());

  const hookNames = new Set(data.LAMP_HOOK_NAMES);

  // ---- clock ----------------------------------------------------------------------------------------------------------------------------
  let carryMs = 0;

  // ---- per-player slots (SPEC 5.13.5) ---------------------------------------------------------------------------------------------------
  const n = lampList.length;
  const slots = Array.from({ length: PLAYER_SLOTS }, () => ({
    valid: false,
    flash: new Uint8Array(n),
    steady: new Uint8Array(n),
    onIdx: new Uint8Array(n),
    field: new Int32Array(n),
  }));

  /** @param {number} p @param {string} what */
  function checkPlayer(p, what) {
    if (!Number.isInteger(p) || p < 0 || p >= PLAYER_SLOTS) throw new TypeError(`playerChanged: ${what} must be an integer 0..${PLAYER_SLOTS - 1}`);
  }

  const lamps = {
    // ---- clock --------------------------------------------------------------------------------------------------------------------------
    /** @param {number} dt seconds */
    advance(dt) {
      if (!(dt > 0) || !Number.isFinite(dt)) return;
      carryMs += dt * 1000;
      const whole = Math.floor(carryMs + 1e-6);
      if (whole > 0) {
        carryMs -= whole;
        lamps.advanceMs(whole);
      }
    },
    /** @param {number} ms */
    advanceMs(ms) { wheel.advance(ms); },
    nowMs() { return wheel.now(); },

    // ---- queries ------------------------------------------------------------------------------------------------------------------------
    isLit(name) { return L(name).isLit(); },
    lightOn(name) { return L(name).lightOn(); },
    steady(name) { return L(name).S; },
    overlay(name) { return L(name).overlay; },
    getField(name) { return L(name).field; },
    getOnIdx(name) { return L(name).onIdx; },

    // ---- registers ----------------------------------------------------------------------------------------------------------------------
    setField(name, v) { L(name).setField(v); },
    setOnIdx(name, i) { L(name).setOnIdx(i); },

    // ---- verbs --------------------------------------------------------------------------------------------------------------------------
    on(name) { L(name).on(); },
    off(name) { L(name).off(); },
    turnOn(name) { L(name).turnOn(); },
    turnOff(name) { L(name).turnOff(); },
    flash(name, t) { L(name).flash(t); },
    flasherStart(name) { L(name).flasherStart(); },
    flashThenOn(name, t) { L(name).flashThenOn(t); },
    flashThenOff(name, t) { L(name).flashThenOff(t); },
    timedOn(name, t) { L(name).timedOn(t); },
    timedOff(name, t) { L(name).timedOff(t); },
    resetTimed(name) { L(name).resetTimed(); },
    toggleValue(name, v) { L(name).toggleValue(v); },
    resetAndToggleValue(name, v) { L(name).resetAndToggleValue(v); },

    // ---- groups, fuel, hooks ------------------------------------------------------------------------------------------------------------
    /** @param {string} name one of LAMP_GROUP_NAMES, 'all' or 'fuel_bargraph' */
    group(name) {
      const g = groups.get(name);
      if (g === undefined) throw new TypeError(`unknown lamp group "${String(name)}"`);
      return g;
    },
    fuel,

    /**
     * ControlTimerExpired hook of a lamp (only LAMP_HOOK_NAMES). Replaces any previous hook; null clears it.
     * @param {string} name @param {null | ((lamp:string)=>void)} fn
     */
    onLampTimer(name, fn) {
      const lamp = L(name);
      if (!hookNames.has(name)) throw new TypeError(`lamp "${name}" has no timer hook (hooks exist only on ${Array.from(hookNames).join(', ')})`);
      if (fn !== null && fn !== undefined && typeof fn !== 'function') throw new TypeError('onLampTimer: fn must be a function or null');
      lamp.hook = fn || null;
    },

    // ---- tilt ---------------------------------------------------------------------------------------------------------------------------
    /** Tilt: TurnOffTimed(0) on all lamps, lite77 flashes indefinitely, fuel level reset (SPEC 5.2.8). */
    tiltOff() {
      for (let i = n - 1; i >= 0; i--) lampList[i].tiltBlackout();
      fuel.tiltStop();
      const tiltLamp = byName.get(TILT_LAMP);
      if (tiltLamp) tiltLamp.flasherStart();
    },
    /** ClearTiltLock: ResetTimed broadcast to all lamps (every overlay / timeout / flash cancelled; steady flags kept). */
    clearTiltLock() {
      for (let i = n - 1; i >= 0; i--) lampList[i].resetTimed();
    },

    // ---- new game / players -------------------------------------------------------------------------------------------------------------
    /** Reset(): S = false, everything cancelled, onIdx = 0, field = 0 on lamps, groups and bargraph; saved players forgotten. Hooks are kept. */
    resetAll() {
      for (let i = 0; i < n; i++) lampList[i].reset();
      for (const g of groupList) g.hardReset();
      for (const s of slots) s.valid = false;
    },

    /**
     * PlayerChanged (SPEC 5.13.5): every lamp saves {flashing, onIdx, S, field} into the OUTGOING slot, resets completely, then loads the incoming
     * slot (onIdx, S, field and - if it was flashing - an INDEFINITE flash; timed remainders, FORCE overlays and offAfter are lost).
     * Groups save / reset / load their register (a running animation is not resumed); the bargraph saves its level.
     * @param {number} outgoing 0..3 @param {number} incoming 0..3
     */
    playerChanged(outgoing, incoming) {
      checkPlayer(outgoing, 'outgoing');
      checkPlayer(incoming, 'incoming');
      const out = slots[outgoing];
      for (let i = 0; i < n; i++) {
        const l = lampList[i];
        out.flash[i] = l.overlay === 'flash' ? 1 : 0;
        out.steady[i] = l.S ? 1 : 0;
        out.onIdx[i] = l.onIdx;
        out.field[i] = l.field;
        l.reset();
      }
      out.valid = true;
      for (const g of groupList) g.playerChanged(outgoing, incoming);
      const inc = slots[incoming];
      if (inc.valid) {
        for (let i = 0; i < n; i++) {
          const l = lampList[i];
          l.onIdx = inc.onIdx[i];
          l.field = inc.field[i];
          if (inc.steady[i]) l.turnOn();
          if (inc.flash[i]) l.flasherStart();
        }
      }
    },

    // ---- view for render ----------------------------------------------------------------------------------------------------------------
    /**
     * Fill all lamp names into view.lit (VISUAL state) and view.onIdx in place; view.version += 1 when any value differs from what the view held.
     * @param {import('./types.js').LampsView} view
     * @returns {import('./types.js').LampsView}
     */
    fillView(view) {
      const lit = view.lit;
      const onIdx = view.onIdx;
      let changed = false;
      for (let i = 0; i < n; i++) {
        const l = lampList[i];
        const v = l.isLit();
        if (lit[l.name] !== v) { lit[l.name] = v; changed = true; }
        if (onIdx[l.name] !== l.onIdx) { onIdx[l.name] = l.onIdx; changed = true; }
      }
      if (changed) view.version = (Number.isFinite(view.version) ? view.version : 0) + 1;
      return view;
    },

    names,
  };

  return /** @type {import('./types.js').Lamps} */ (/** @type {unknown} */ (lamps));
}
