/**
 * src/physics/components.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.3, 5.2, 5.3; SPEC 2 (component table), 4.7.2, 4.9.1 - 4.9.15, 4.10
 * Every component handler of the table. A component owns its edges (edge.comp === component), its small state machine and its timers
 * (scheduled on the engine's physics-time queue). Handlers are called from the ray cast of the engine:
 *     comp.onHit(ball, edge, hx, hy, nx, ny)      (hx,hy = contact point on the ray, (nx,ny) = unit contact normal)
 * Plain bounces go through basicCollision. Pass-through triggers move the ball onto the hit point, remember the edge (ignored on the
 * next cast) and emit an event. Nothing here scores, plays a sound or touches a lamp: components only emit events (ARCHITECTURE 5.3).
 * The engine contract used here (`eng`): time, tilt, rand, data, P (PHYS), Z, T (TIMING), timers, emit(ev), drainBall(ball, via),
 * ballAtPlunger(), exactBug.
 *
 * ASSUMPTIONS (documented decisions where SPEC/ARCHITECTURE are silent):
 *  - Hard hit test is `rebound >= threshold` everywhere (the same test basicCollision uses to apply the boost); events carry `impact` = rebound.
 *  - blockerHit is emitted for impacts > 0.2 (the "soft sound" threshold of the default handler) at most once per 0.1 s (a wedged ball rattles),
 *    onewaySide for impacts > 0.2 (ARCHITECTURE 5.3).
 *  - The inflated end wall of the hidden tube (shell 106) lies on the far-end exit seam and is switched off at build time (openFarEnd): the seam is
 *    the end of the tube, the wall used to bounce every ball back down.
 *  - A pop-up target that is already up ignores popupReenable (no popupUp event); a pending re-raise is not duplicated.
 *  - Tilt is an OVERLAY on kickouts and the blocker (effective = requested && !tilt), so lifting the lock restores the rules' state.
 *  - flagLoop is emitted whenever the sprite frame becomes 0 (once per full turn, either direction).
 *  - A spinner crossing while the spinner still turns only refreshes speed and direction; the running frame timer is kept.
 *  - Rollover: a ball removed while a rollover is "pressed" is repaired by rearmAllRollovers() (called when the last ball leaves).
 *  - The second ball reaching an occupied kickout / ramp hole is not captured: it passes the capture circle ("already hit" trick).
 *  - A ball in the 0.3 margin of the ramp footprint keeps the plane of the last seam; its height is clamped (ramps.js).
 *  - The plunger kicks at most once per release (the window closes after the first contact); the window is 0.3 s instead of 0.025 s when a
 *    ball sits at / just above the feed point at the release (see FIRE_WINDOW).
 */
import { EV } from '../data/events.js';
import { basicCollision, throwBall } from './collision.js';
import { edgesFromPlain, makeLine, installWall, installLine } from './edges.js';
import { buildRamp, planeZ } from './ramps.js';

const NEVER = 8.9999999e10;
const EPS = 1e-9;
/**
 * Plunger kicker window after a release. SPEC 4.9.14 says 0.025 s; a resting ball is hit within the first step either way, but a ball that is
 * still bouncing on the plunger after the feed would be missed by a 25 ms window, so when a ball is at / just above the feed point at the
 * moment of the release the window is 0.3 s (the kick happens at its first contact). Otherwise the SPEC window applies.
 */
const FIRE_WINDOW = 0.3;
const SOFT = 0.2;           // impact below which a contact is silent
const BLOCKER_GAP = 0.1;    // minimum time between two blockerHit events

const arr = (x) => (Array.isArray(x) ? x : []);

/** Plain bounce honouring the tilt rule (SPEC 4.7.2). Returns the rebound (impact). */
function bounce(eng, b, hx, hy, nx, ny, mat, T, B) {
  if (eng.tilt) { T = 1e9; B = 0; }
  return basicCollision(b, hx, hy, nx, ny, mat.elasticity, mat.smoothness, T, B);
}

// ====================================================================================================================================
// Walls, posts, outline, rebounders
// ====================================================================================================================================
export class WallComp {
  constructor(eng, name, material, kicker) {
    this.eng = eng; this.name = name; this.mat = material;
    this.T = kicker ? kicker.threshold : NEVER;
    this.B = kicker ? kicker.boost : 0;
    this.edges = [];
  }

  onHit(b, edge, hx, hy, nx, ny) {
    bounce(this.eng, b, hx, hy, nx, ny, this.mat, this.T, this.B);
  }
}

/** v_rebo1-4: wall + kicker 468 (threshold 1.0, boost 18) + 0.1 s flash (SPEC 4.9.1). */
export class ReboundComp extends WallComp {
  constructor(eng, name, material, kicker) {
    super(eng, name, material, kicker);
    this.flashUntil = -1;
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    const reb = bounce(eng, b, hx, hy, nx, ny, this.mat, this.T, this.B);
    if (!eng.tilt && reb >= this.T) {
      this.flashUntil = eng.time + eng.T.rebounderFlash;
      eng.emit({ type: EV.REBOUNDER_HIT, t: eng.time, name: this.name, impact: reb });
    }
  }

  reset() { this.flashUntil = -1; }
}

// ====================================================================================================================================
// Bumpers
// ====================================================================================================================================
export class BumperComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.mat = def.material;
    this.T = def.kicker.threshold; this.B = def.kicker.boost; this.hold = def.hitSeconds;
    this.lockUntil = -1;      // after a hard hit the threshold is 1e9 for 0.1 s
    this.hitUntil = -1;       // sprite hit frame
    this.edges = [];
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    if (eng.tilt) { bounce(eng, b, hx, hy, nx, ny, this.mat, 1e9, 0); return; }
    const locked = eng.time < this.lockUntil - EPS;
    const T = locked ? 1e9 : this.T;
    const reb = basicCollision(b, hx, hy, nx, ny, this.mat.elasticity, this.mat.smoothness, T, this.B);
    if (!locked && reb >= T) {
      this.lockUntil = eng.time + this.hold;
      this.hitUntil = eng.time + this.hold;
      eng.emit({ type: EV.BUMPER_HIT, t: eng.time, name: this.name, impact: reb });
    }
  }

  reset() { this.lockUntil = -1; this.hitUntil = -1; }
}

// ====================================================================================================================================
// Pop-up (drop) targets and solo (spot) targets
// ====================================================================================================================================
export class PopupComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.mat = def.material;
    this.T = def.kicker.threshold; this.B = def.kicker.boost; this.repop = def.repopSeconds;
    this.up = true;
    this.timer = 0;
    this.edges = [];
  }

  _setActive(on) {
    for (const e of this.edges) e.active = on;
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    if (eng.tilt) { bounce(eng, b, hx, hy, nx, ny, this.mat, 1e9, 0); return; }
    const reb = basicCollision(b, hx, hy, nx, ny, this.mat.elasticity, this.mat.smoothness, this.T, this.B);
    if (reb >= this.T) {
      this.up = false;
      this._setActive(false);
      eng.emit({ type: EV.POPUP_HIT, t: eng.time, name: this.name });
    }
  }

  /** Re-raise after `repop` seconds (or now). No-op when already up or already pending (unless immediate). */
  reenable(immediate) {
    if (this.up) return;
    if (immediate) { this._raise(); return; }
    if (this.timer) return;
    this.timer = this.eng.timers.schedule(this.eng.time + this.repop, () => { this.timer = 0; this._raise(); });
  }

  _raise() {
    this.eng.timers.cancel(this.timer);
    this.timer = 0;
    if (this.up) return;
    this.up = true;
    this._setActive(true);
    this.eng.emit({ type: EV.POPUP_UP, t: this.eng.time, name: this.name });
  }

  reset() { this.timer = 0; this.up = true; this._setActive(true); }
}

export class SoloComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.mat = def.material;
    this.T = def.kicker.threshold; this.B = def.kicker.boost; this.rearm = def.rearmSeconds;
    this.hitTime = -1e9;
    this.timer = 0;
    this.edges = [];
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    if (eng.tilt) { bounce(eng, b, hx, hy, nx, ny, this.mat, 1e9, 0); return; }
    const reb = basicCollision(b, hx, hy, nx, ny, this.mat.elasticity, this.mat.smoothness, this.T, this.B);
    if (reb >= this.T) {
      this.hitTime = eng.time;
      for (const e of this.edges) e.active = false;
      eng.timers.cancel(this.timer);
      this.timer = eng.timers.schedule(eng.time + this.rearm, () => {
        this.timer = 0;
        for (const e of this.edges) e.active = true;
      });
      eng.emit({ type: EV.SOLO_HIT, t: eng.time, name: this.name, impact: reb });
    }
  }

  /** 1 at a hard hit, decaying linearly to 0 over the 0.1 s. */
  flash(time) {
    const f = 1 - (time - this.hitTime) / this.rearm;
    return f > 0 ? Math.min(1, f) : 0;
  }

  reset() { this.timer = 0; this.hitTime = -1e9; for (const e of this.edges) e.active = true; }
}

// ====================================================================================================================================
// Gates, blocker, drain
// ====================================================================================================================================
export class GateComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.id = def.id; this.mat = def.material;
    this.enabled = true;
    this.edges = [];
  }

  setEnabled(on) {
    this.enabled = !!on;
    for (const e of this.edges) e.active = this.enabled;
  }

  onHit(b, edge, hx, hy, nx, ny) {
    bounce(this.eng, b, hx, hy, nx, ny, this.mat, NEVER, 0);
  }

  reset() { this.setEnabled(true); }
}

export class BlockerComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.mat = def.material;
    this.requested = false;
    this.lastHit = -1e9;       // time of the last blockerHit event (see BLOCKER_GAP)
    this.edges = [];
  }

  get up() { return this.requested && !this.eng.tilt; }

  sync() { for (const e of this.edges) e.active = this.up; }

  setEnabled(on) { this.requested = !!on; this.sync(); }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    const reb = bounce(eng, b, hx, hy, nx, ny, this.mat, NEVER, 0);
    // A ball wedged between the post and a flipper tip rattles at 20+ micro-bounces per second, each one above the 0.2 "soft" threshold: one
    // blockerHit (= one sound) per BLOCKER_GAP is plenty for real bounces and keeps the rattle from machine-gunning the sound.
    if (reb > SOFT && eng.time - this.lastHit >= BLOCKER_GAP) {
      this.lastHit = eng.time;
      eng.emit({ type: EV.BLOCKER_HIT, t: eng.time, impact: reb });
    }
  }

  reset() { this.requested = false; this.lastHit = -1e9; this.sync(); }
}

export class DrainComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name;
    this.edges = [];
  }

  onHit(b, edge, hx, hy) {
    b.x = hx; b.y = hy;
    this.eng.drainBall(b, 'drain');
  }
}

// ====================================================================================================================================
// Plunger (SPEC 4.9.14)
// ====================================================================================================================================
export class PlungerComp {
  constructor(eng, def) {
    this.eng = eng; this.def = def; this.mat = def.material;
    this.maxBoost = def.maxBoost; this.tick = def.tickSeconds; this.feed = def.feed; this.feedDelay = def.feedDelay;
    this.boost = 0;
    this.charging = false;
    this.tickId = 0;
    this.interval = def.tickSeconds;
    this.autoRelease = false;       // relaunch: release by itself at full charge
    this.fireUntil = -1;            // contact window after a release
    this.fireBoost = 0;
    this.fireJitter = 0;
    this.kicked = true;
    this.releasedAt = -1e9;
    this.releasedBoost = 0;
    this.edges = [];
  }

  /** Start charging: Boost := 0, +1 now, then +1 every `interval` s up to max. Emits plungerPull. */
  press(interval = this.tick, autoRelease = false) {
    const eng = this.eng;
    if (this.charging) return;
    this.charging = true;
    this.autoRelease = autoRelease;
    this.interval = interval;
    this.boost = 0;
    this.fireUntil = -1;
    eng.emit({ type: EV.PLUNGER_PULL, t: eng.time });
    this._increment();
  }

  /** One charge tick; the next one is scheduled from the DUE time so intervals shorter than a step (relaunch: 0.025/4) keep their rate. */
  _increment(due) {
    const eng = this.eng;
    this.boost += 1;
    if (this.boost >= this.maxBoost) {
      this.boost = this.maxBoost;
      this.tickId = 0;
      if (this.autoRelease) this.release(true);
      return;
    }
    const at = (due === undefined ? eng.time : due) + this.interval;
    this.tickId = eng.timers.schedule(at, (d) => { this.tickId = 0; if (this.charging) this._increment(d); });
  }

  /**
   * Release: the plunger becomes a live kicker (T=0, B = Boost + rand*Boost*0.1) for FIRE_WINDOW (SPEC: 0.025 s). `openEnded` (ball-save
   * relaunch, which has no player timing) keeps the kicker live until the first contact.
   */
  release(openEnded = false) {
    const eng = this.eng;
    if (!this.charging) return;
    this.charging = false;
    this.autoRelease = false;
    eng.timers.cancel(this.tickId);
    this.tickId = 0;
    this.fireBoost = this.boost;
    this.releasedBoost = this.boost;
    this.releasedAt = eng.time;
    this.fireJitter = eng.rand();
    this.fireUntil = openEnded ? Infinity : eng.time + (eng.ballNearPlunger() ? FIRE_WINDOW : this.tick);
    this.kicked = false;
    this.boost = 0;
    eng.emit({ type: EV.PLUNGER_RELEASE, t: eng.time, boost: this.fireBoost, hitBall: eng.ballAtPlunger() });
  }

  /** Menu "Launch Ball": full power at once (the caller checked that a ball is at the plunger). */
  launchNow() {
    const eng = this.eng;
    this.cancelCharge();
    this.fireBoost = this.maxBoost;
    this.releasedBoost = this.maxBoost;
    this.releasedAt = eng.time;
    this.fireJitter = eng.rand();
    this.fireUntil = Infinity;      // the caller checked that a ball rests at the plunger; it is kicked on its next contact
    this.kicked = false;
    eng.emit({ type: EV.PLUNGER_RELEASE, t: eng.time, boost: this.maxBoost, hitBall: true });
  }

  cancelCharge() {
    this.eng.timers.cancel(this.tickId);
    this.tickId = 0;
    this.charging = false;
    this.autoRelease = false;
    this.boost = 0;
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    const m = this.mat;
    if (eng.tilt) {
      // auto-plunger: a contact fires at full power at once
      const B = this.maxBoost + eng.rand() * 10;
      basicCollision(b, hx, hy, nx, ny, m.elasticity, m.smoothness, 0, B);
      this.releasedBoost = this.maxBoost;
      this.releasedAt = eng.time;
      this.kicked = true;
      eng.emit({ type: EV.PLUNGER_RELEASE, t: eng.time, boost: this.maxBoost, hitBall: true });
      return;
    }
    if (!this.kicked && eng.time <= this.fireUntil + EPS) {
      const B = this.fireBoost + this.fireJitter * this.fireBoost * 0.1;
      basicCollision(b, hx, hy, nx, ny, m.elasticity, m.smoothness, 0, B);
      this.kicked = true;
      return;
    }
    basicCollision(b, hx, hy, nx, ny, m.elasticity, m.smoothness, 1e9, 0);
  }

  reset() {
    this.cancelCharge();
    this.fireUntil = -1; this.fireBoost = 0; this.kicked = true; this.releasedAt = -1e9; this.releasedBoost = 0;
  }

  /** Visual pull-back 0..1 (eases back to 0 in 0.1 s after a release). */
  pull(time) {
    if (this.charging) return this.boost / this.maxBoost;
    const f = 1 - (time - this.releasedAt) / 0.1;
    return f > 0 ? (this.releasedBoost / this.maxBoost) * f : 0;
  }

  fired(time) {
    return time - this.releasedAt < 0.1 - EPS && this.releasedAt > -1e8;
  }
}

// ====================================================================================================================================
// Kickbacks (SPEC 4.9.5)
// ====================================================================================================================================
export class KickbackComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.id = def.id; this.mat = def.material;
    this.kick = def.kicker.boost; this.armed0 = def.kicker.threshold;
    this.arm = def.armSeconds; this.tick = def.tickSeconds;
    this.threshold = NEVER;
    this.active = false;      // a cycle is running
    this.armed = false;       // the 0.7 s wait is over: a touch kicks
    this.kicked = false;      // from the kick until the final 0.1 s timer
    this.armTimer = 0; this.tickTimer = 0;
    this.edges = [];
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    const m = this.mat;
    if (eng.tilt) {
      basicCollision(b, hx, hy, nx, ny, m.elasticity, m.smoothness, 0, this.kick);
      this._fire();
      return;
    }
    if (!this.active) {
      // first touch while idle: plain bounce, start the 0.7 s wait
      this.threshold = NEVER;
      this.active = true;
      this.armed = false;
      eng.timers.cancel(this.armTimer);
      this.armTimer = eng.timers.schedule(eng.time + this.arm, () => this._armDone());
      basicCollision(b, hx, hy, nx, ny, m.elasticity, m.smoothness, NEVER, 0);
      return;
    }
    const T = this.threshold;
    basicCollision(b, hx, hy, nx, ny, m.elasticity, m.smoothness, T, this.kick);
    if (T <= 0) this._fire();
  }

  _armDone() {
    this.armTimer = 0;
    if (!this.active) return;
    this.threshold = this.armed0;
    this.armed = true;
    this._ensureTick();
  }

  _ensureTick() {
    const eng = this.eng;
    if (this.tickTimer) return;
    this.tickTimer = eng.timers.schedule(eng.time + this.tick, () => this._tick());
  }

  _tick() {
    const eng = this.eng;
    this.tickTimer = 0;
    if (this.kicked) {
      this.kicked = false;
      eng.emit({ type: EV.KICKBACK_TIMER_EXPIRED, t: eng.time, id: this.id });
    } else if (this.active) {
      this._ensureTick();
    }
  }

  _fire() {
    const eng = this.eng;
    this.active = false;
    this.armed = false;
    this.kicked = true;
    eng.emit({ type: EV.KICKBACK_FIRED, t: eng.time, id: this.id });
    this._ensureTick();
  }

  reset() {
    const t = this.eng.timers;
    t.cancel(this.armTimer); t.cancel(this.tickTimer);
    this.armTimer = 0; this.tickTimer = 0;
    this.threshold = NEVER; this.active = false; this.armed = false; this.kicked = false;
  }
}

// ====================================================================================================================================
// Kickouts (SPEC 4.9.6): gravity well, hyperspace chute, black hole
// ====================================================================================================================================
export class KickoutComp {
  constructor(eng, def) {
    this.eng = eng; this.def = def; this.name = def.name; this.id = def.id;
    this.cx = def.c[0]; this.cy = def.c[1];
    this.mask = def.mask;
    this.fieldRadius = def.fieldRadius; this.pull = def.pull;
    this.requested = def.startsActive;
    this.ball = null;
    this.releaseTimer = 0; this.rearmTimer = 0;
    this.edges = [];
  }

  get active() { return this.requested && !this.eng.tilt; }

  sync() { for (const e of this.edges) e.active = this.active; }

  setActive(on) {
    this.requested = !!on;
    this.eng.timers.cancel(this.rearmTimer);
    this.rearmTimer = 0;
    this.sync();
  }

  /** Attraction well test (SPEC 4.4 #3): active, nothing held, masks overlap and the ball centre inside the well radius. */
  inField(b) {
    if (!this.active || this.ball || (b.mask & this.mask) === 0) return false;
    const dx = this.cx - b.x, dy = this.cy - b.y;
    return dx * dx + dy * dy < this.fieldRadius * this.fieldRadius;
  }

  onHit(b, edge, hx, hy) {
    const eng = this.eng;
    if (this.ball) { b.x = hx; b.y = hy; b.remember(edge); return; }      // occupied: pushed through ("already hit" trick)
    this.ball = b;
    b.heldBy = this;
    b.x = this.cx; b.y = this.cy; b.z = this.def.heldZ;
    b.speed = 0;
    b.cdisabled = true;
    this.releaseTimer = eng.timers.schedule(eng.time + this.def.defaultHold, () => this.release());
    eng.emit({ type: EV.KICKOUT_CAPTURE, t: eng.time, id: this.id });
  }

  /** Restart the hold timer of the captured ball: release `seconds` from now (0 = at the next step). */
  setHold(seconds) {
    if (!this.ball) return;
    const eng = this.eng;
    eng.timers.cancel(this.releaseTimer);
    this.releaseTimer = eng.timers.schedule(eng.time + Math.max(0, seconds), () => this.release());
  }

  release() {
    const eng = this.eng;
    const b = this.ball;
    this.releaseTimer = 0;
    if (!b) return;
    this.ball = null;
    const d = this.def;
    b.z = eng.Z.ball;
    throwBall(b, d.throwDir[0], d.throwDir[1], d.angleMult, d.boost, d.throwMult * 0.01, eng.rand, eng.exactBug);
    this.requested = false;
    this.sync();
    eng.emit({ type: EV.KICKOUT_EJECT, t: eng.time, id: this.id });
    if (d.rearms) {
      this.rearmTimer = eng.timers.schedule(eng.time + eng.T.kickoutRearm, () => { this.rearmTimer = 0; this.requested = true; this.sync(); });
    }
  }

  fieldEffect() { /* a held kickout ball does not move */ }

  forget(b) {
    if (this.ball !== b) return;
    this.ball = null;
    this.eng.timers.cancel(this.releaseTimer);
    this.releaseTimer = 0;
  }

  reset() {
    const t = this.eng.timers;
    t.cancel(this.releaseTimer); t.cancel(this.rearmTimer);
    this.releaseTimer = 0; this.rearmTimer = 0; this.ball = null;
    this.requested = this.def.startsActive;
    this.sync();
  }
}

// ====================================================================================================================================
// Sinks / wormholes (SPEC 4.9.7)
// ====================================================================================================================================
export class SinkComp {
  constructor(eng, def, table) {
    this.eng = eng; this.def = def; this.name = def.name; this.id = def.id; this.table = table;
    this.count = 0;           // balls currently captured here
    this.edges = [];
  }

  get occupied() { return this.count > 0; }

  onHit(b, edge, hx, hy) {
    const eng = this.eng;
    b.x = hx; b.y = hy;
    if (eng.tilt) { eng.drainBall(b, 'sinkTilt'); return; }
    b.active = false;
    b.speed = 0;
    b.cdisabled = true;
    this.count++;
    const rec = { from: this.id, exit: this.id, hold: this.def.holdSeconds, timer: 0 };
    b.sink = rec;
    rec.timer = eng.timers.schedule(eng.time + rec.hold, () => this.table.ejectBall(b));
    eng.emit({ type: EV.SINK_CAPTURE, t: eng.time, id: this.id });
  }

  reset() { this.count = 0; }
}

// ====================================================================================================================================
// Ramp hole (SPEC 4.9.8)
// ====================================================================================================================================
export class HoleComp {
  constructor(eng, def) {
    this.eng = eng; this.def = def; this.name = def.name;
    this.cx = def.c[0]; this.cy = def.c[1]; this.mask = def.mask;
    this.fieldRadius = def.fieldRadius; this.pull = def.pull;
    this.ball = null;
    this.stage = 0;           // 0 empty, 1 hold, 2 drop
    this.dropStart = 0; this.zStart = 0; this.drop = 0;
    this.timer = 0;
    this.edges = [];
  }

  get active() { return true; }

  inField(b) {
    if (this.ball || (b.mask & this.mask) === 0) return false;
    const dx = this.cx - b.x, dy = this.cy - b.y;
    return dx * dx + dy * dy < this.fieldRadius * this.fieldRadius;
  }

  onHit(b, edge, hx, hy) {
    const eng = this.eng;
    if (this.ball) { b.x = hx; b.y = hy; b.remember(edge); return; }
    this.ball = b;
    b.heldBy = this;
    b.x = this.cx; b.y = this.cy;
    b.speed = 0;
    b.cdisabled = true;
    this.stage = 1; this.drop = 0; this.zStart = b.z;
    this.timer = eng.timers.schedule(eng.time + this.def.holdSeconds, () => this._startDrop());
    eng.emit({ type: EV.RAMP_HOLE_CAPTURED, t: eng.time });
  }

  _startDrop() {
    const eng = this.eng;
    this.stage = 2;
    this.dropStart = eng.time;
    this.timer = eng.timers.schedule(eng.time + eng.T.rampHoleDrop, () => this._release());
  }

  fieldEffect(b) {
    if (this.stage !== 2) return;
    const dur = this.eng.T.rampHoleDrop;
    let p = (this.eng.time - this.dropStart) / dur;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    this.drop = p * p;
    b.z = this.zStart + (this.def.releaseZ - this.zStart) * this.drop;
  }

  _release() {
    const eng = this.eng;
    const b = this.ball;
    this.timer = 0;
    if (!b) return;
    this.ball = null; this.stage = 0; this.drop = 0;
    b.heldBy = null;
    b.z = this.def.releaseZ;
    b.mask = this.def.releaseMask;
    b.speed = 0;
    b.onRamp = false; b.plane = null;
    eng.emit({ type: EV.RAMP_HOLE_RELEASED, t: eng.time });
  }

  forget(b) {
    if (this.ball !== b) return;
    this.ball = null; this.stage = 0; this.drop = 0;
    this.eng.timers.cancel(this.timer);
    this.timer = 0;
  }

  reset() {
    this.eng.timers.cancel(this.timer);
    this.timer = 0; this.ball = null; this.stage = 0; this.drop = 0;
  }
}

// ====================================================================================================================================
// One-ways, tripwires (SPEC 4.9.9, 4.9.10)
// ====================================================================================================================================
const TAG_WALL = 1;
const TAG_TRIGGER = 2;

export class OnewayComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.mat = def.material; this.side = !!def.sideSound;
    this.edges = [];
  }

  onHit(b, edge, hx, hy, nx, ny) {
    const eng = this.eng;
    if (edge.tag === TAG_TRIGGER) {
      b.x = hx; b.y = hy;
      b.remember(edge);
      eng.emit({ type: EV.ONEWAY, t: eng.time, name: this.name });
      return;
    }
    const reb = bounce(eng, b, hx, hy, nx, ny, this.mat, NEVER, 0);
    if (this.side && reb > SOFT) eng.emit({ type: EV.ONEWAY_SIDE, t: eng.time, name: this.name, impact: reb });
  }
}

export class TripwireComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name;
    this.edges = [];
  }

  onHit(b, edge, hx, hy) {
    b.x = hx; b.y = hy;
    b.remember(edge);
    this.eng.emit({ type: EV.TRIPWIRE, t: this.eng.time, name: this.name });
  }
}

// ====================================================================================================================================
// Rollovers (+ light rollover a_roll9)
// ====================================================================================================================================
export class RolloverComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name; this.light = !!def.light; this.sprite = def.spriteSeconds || 0;
    this.pressed = false;
    this.timer = 0;
    this.litUntil = -1;
    this.edges = [];
  }

  _setGates(entry, exit) {
    for (const e of this.edges) e.active = e.gate === 'rolloverflag' ? exit : entry;
  }

  onHit(b, edge, hx, hy) {
    const eng = this.eng;
    b.x = hx; b.y = hy;
    b.remember(edge);
    if (edge.gate === 'rolloverflag') {
      if (!this.pressed) return;
      this.pressed = false;
      this._setGates(false, false);               // entry stays disarmed for 0.1 s
      if (this.light) this.litUntil = eng.time + this.sprite;
      eng.timers.cancel(this.timer);
      this.timer = eng.timers.schedule(eng.time + eng.T.rolloverRearm, () => { this.timer = 0; if (!this.pressed) this._setGates(true, false); });
      return;
    }
    if (this.pressed) return;
    this.pressed = true;
    eng.timers.cancel(this.timer);
    this.timer = 0;
    this._setGates(false, true);
    eng.emit({ type: EV.ROLLOVER_ENTER, t: eng.time, name: this.name });
  }

  /** Back to the armed state without events (reset / repair). */
  rearm() {
    this.eng.timers.cancel(this.timer);
    this.timer = 0;
    this.pressed = false;
    this._setGates(true, false);
  }

  reset() { this.rearm(); this.litUntil = -1; }
}

// ====================================================================================================================================
// Flag spinners (SPEC 4.9.11)
// ====================================================================================================================================
export class FlagComp {
  constructor(eng, def) {
    this.eng = eng; this.name = def.name;
    this.maxSpeed = def.maxSpeed; this.minSpeed = def.minSpeed; this.decay = def.decay;
    this.frame = 0; this.dir = 1; this.spinSpeed = 0; this.spinning = false;
    this.timer = 0;
    this.edges = [];
  }

  onHit(b, edge, hx, hy) {
    const eng = this.eng;
    b.x = hx; b.y = hy;
    b.remember(edge);
    this.dir = edge.tag < 0 ? -1 : 1;
    let s = b.speed * 20;
    s = s < this.minSpeed ? this.minSpeed : s > this.maxSpeed ? this.maxSpeed : s;
    this.spinSpeed = s;
    if (!this.spinning) {
      this.spinning = true;
      this.timer = eng.timers.schedule(eng.time + 1 / s, (due) => this._frame(due));
    }
  }

  _frame(due) {
    const eng = this.eng;
    this.timer = 0;
    this.frame = (this.frame + this.dir + 8) % 8;
    eng.emit({ type: EV.FLAG_FRAME, t: eng.time, name: this.name, frame: this.frame, dir: this.dir });
    if (this.frame === 0) eng.emit({ type: EV.FLAG_LOOP, t: eng.time, name: this.name });
    this.spinSpeed *= this.decay;
    if (this.spinSpeed >= this.minSpeed) {
      this.timer = eng.timers.schedule(due + 1 / this.spinSpeed, (d) => this._frame(d));
    } else {
      this.spinning = false;
      this.spinSpeed = 0;
    }
  }

  reset() {
    this.eng.timers.cancel(this.timer);
    this.timer = 0; this.frame = 0; this.dir = 1; this.spinSpeed = 0; this.spinning = false;
  }
}

// ====================================================================================================================================
// Demo triggers (SPEC 2.19)
// ====================================================================================================================================
export class DemoComp {
  constructor(eng, def) {
    this.eng = eng; this.id = def.id; this.name = 'demo' + def.id;
    this.edges = [];
  }

  onHit(b, edge, hx, hy) {
    b.x = hx; b.y = hy;
    b.remember(edge);
    this.eng.emit({ type: EV.DEMO_TRIGGER, t: this.eng.time, id: this.id });
  }
}

// ====================================================================================================================================
// Ramp seams (SPEC 4.10)
// ====================================================================================================================================
export class RampSeamComp {
  constructor(eng, ramp, seam) {
    this.eng = eng; this.ramp = ramp; this.seam = seam;
  }

  onHit(b, edge, hx, hy) {
    const eng = this.eng;
    const s = this.seam;
    b.x = hx; b.y = hy;
    b.remember(edge);
    switch (s.kind) {
      case 'plane':
        b.plane = s.plane; b.onRamp = true;
        b.z = planeZ(s.plane, hx, hy) + eng.R;
        break;
      case 'enter':
      case 'enterUpper':
        b.mask = s.newMask; b.onRamp = true; b.plane = s.plane;
        b.z = planeZ(s.plane, hx, hy) + eng.R;
        eng.emit({ type: EV.RAMP_ENTER, t: eng.time, ramp: this.ramp.name });
        break;
      case 'exit':
      case 'exitUpper':
      case 'exitFar':
        b.onRamp = false; b.plane = null; b.mask = s.newMask;
        b.z = s.newMask === 4 ? eng.Z.ballOnDeck : eng.Z.ball;
        eng.emit({ type: EV.RAMP_EXIT, t: eng.time, ramp: this.ramp.name, mask: s.newMask });
        break;
      case 'line1':
        eng.emit({ type: EV.RAMP_LINE1, t: eng.time });
        break;
      default:
        break;
    }
  }
}

// ====================================================================================================================================
// Table builder
// ====================================================================================================================================
/**
 * Create every component from the data tables, register all edges in `world`, and return the registry.
 * @param {any} eng the engine
 * @param {any} data the data module (opts.data)
 * @param {import('./world.js').World} world
 */
export function buildTable(eng, data, world) {
  const table = {
    comps: [],
    wells: [],                    // kickouts + hole (attraction fields)
    kickouts: {}, sinks: {}, gates: {}, kickbacks: {},
    kickoutList: [], gateList: [], kickbackList: [],
    popups: [], solos: [], bumpers: [], rebounders: [], flags: [], rollovers: [], demo: [],
    plunger: null, drain: null, blocker: null, hole: null,
    ramps: [], rampPlanes: [],
    sinkList: [],
    ejectBall: null,
  };

  const attach = (comp, plainEdges, mask, owner, tag) => {
    const edges = edgesFromPlain(plainEdges, mask, owner);
    for (const e of edges) {
      e.comp = comp;
      if (tag !== undefined) e.tag = tag;
      comp.edges.push(e);
      world.add(e);
    }
    table.comps.push(comp);
    return edges;
  };

  // ---- walls, rebounders, posts, outline ----------------------------------------------------------------------------------------
  for (const w of arr(data.WALLS)) {
    const isRebo = w.name.startsWith('v_rebo');
    const comp = isRebo ? new ReboundComp(eng, w.name, w.material, w.kicker) : new WallComp(eng, w.name, w.material, w.kicker);
    attach(comp, w.edges, w.mask, w.name);
    if (isRebo) table.rebounders.push(comp);
  }
  for (const p of arr(data.POSTS)) attach(new WallComp(eng, p.name, p.material, null), p.edges, p.mask, p.name);
  if (data.TABLE_OUTLINE) {
    const o = data.TABLE_OUTLINE;
    attach(new WallComp(eng, 'table', o.material, o.kicker), o.edges, o.mask, 'table');
  }

  // ---- bumpers, targets ----------------------------------------------------------------------------------------------------------
  for (const d of arr(data.BUMPERS)) { const c = new BumperComp(eng, d); attach(c, d.edges, d.mask, d.name); table.bumpers.push(c); }
  for (const d of arr(data.POPUP_TARGETS)) { const c = new PopupComp(eng, d); attach(c, d.edges, d.mask, d.name); table.popups.push(c); }
  for (const d of arr(data.SOLO_TARGETS)) { const c = new SoloComp(eng, d); attach(c, d.edges, d.mask, d.name); table.solos.push(c); }

  // ---- kickbacks, gates, blocker, drain, plunger ---------------------------------------------------------------------------------
  for (const d of arr(data.KICKBACKS)) {
    const c = new KickbackComp(eng, d);
    attach(c, d.edges, d.mask, d.name);
    table.kickbacks[d.id] = c;
    table.kickbackList.push(c);
  }
  for (const d of arr(data.GATES)) {
    const c = new GateComp(eng, d);
    attach(c, d.edges, d.mask, d.name);
    table.gates[d.id] = c;
    table.gateList.push(c);
  }
  if (data.BLOCKER) {
    const d = data.BLOCKER;
    table.blocker = new BlockerComp(eng, d);
    attach(table.blocker, d.edges, d.mask, d.name);
    table.blocker.sync();
  }
  if (data.DRAIN) {
    const d = data.DRAIN;
    table.drain = new DrainComp(eng, d);
    attach(table.drain, d.edges, d.mask, d.name);
  }
  if (data.PLUNGER) {
    const d = data.PLUNGER;
    table.plunger = new PlungerComp(eng, d);
    attach(table.plunger, d.edges, d.mask, d.name);
  }

  // ---- kickouts, sinks, ramp hole --------------------------------------------------------------------------------------------------
  for (const d of arr(data.KICKOUTS)) {
    const c = new KickoutComp(eng, d);
    attach(c, d.edges, d.mask, d.name);
    c.sync();
    table.kickouts[d.id] = c;
    table.kickoutList.push(c);
    table.wells.push(c);
  }
  for (const d of arr(data.SINKS)) {
    const c = new SinkComp(eng, d, table);
    attach(c, d.edges, d.mask, d.name);
    table.sinks[d.id] = c;
    table.sinkList.push(c);
  }
  if (data.RAMP_HOLE) {
    const c = new HoleComp(eng, data.RAMP_HOLE);
    attach(c, data.RAMP_HOLE.edges, data.RAMP_HOLE.mask, data.RAMP_HOLE.name);
    table.hole = c;
    table.wells.push(c);
  }

  // Sink eject (timer callback): the ball leaves from the sink chosen by sinkSetRoute, or waits 0.5 s while another ball blocks the exit.
  table.ejectBall = (b) => {
    const rec = b.sink;
    if (!rec || b.dead) return;
    const exit = table.sinks[rec.exit] || table.sinks[rec.from];
    const d = exit.def;
    const balls = eng.balls;
    for (let i = 0; i < balls.length; i++) {
      const o = balls[i];
      if (o === b || o.dead || !o.active) continue;
      if (Math.hypot(o.x - d.reemit[0], o.y - d.reemit[1]) < 2 * eng.R) {
        rec.timer = eng.timers.schedule(eng.time + eng.T.sinkBusyRetry, () => table.ejectBall(b));
        return;
      }
    }
    const from = table.sinks[rec.from];
    if (from) from.count = Math.max(0, from.count - 1);
    b.sink = null;
    b.x = d.reemit[0]; b.y = d.reemit[1]; b.z = eng.Z.ball; b.mask = 1;
    b.onRamp = false; b.plane = null; b.active = true; b.cdisabled = false;
    throwBall(b, d.throwDir[0], d.throwDir[1], 0, d.boost, d.throwMult * 0.01, eng.rand, eng.exactBug);
    eng.emit({ type: EV.SINK_EJECT, t: eng.time, id: d.id, from: rec.from });
  };

  // ---- one-ways, tripwires, rollovers, flags ---------------------------------------------------------------------------------------
  for (const d of arr(data.ONEWAYS)) {
    const c = new OnewayComp(eng, d);
    const edges = attach(c, d.edges, d.mask, d.name);
    edges.forEach((e) => { e.tag = e.role === 'passthrough' ? TAG_TRIGGER : TAG_WALL; });
  }
  for (const d of arr(data.TRIPWIRES)) attach(new TripwireComp(eng, d), d.edges, d.mask, d.name);
  for (const d of arr(data.ROLLOVERS)) {
    const c = new RolloverComp(eng, d);
    attach(c, d.edges, d.mask, d.name);
    c.rearm();
    table.rollovers.push(c);
  }
  for (const d of arr(data.FLAGS)) {
    const c = new FlagComp(eng, d);
    const edges = attach(c, d.edges, d.mask, d.name);
    edges.forEach((e) => { e.tag = String(e.role).startsWith('side_b') ? -1 : 1; });
    table.flags.push(c);
  }

  // ---- demo triggers (off until setDemoTriggers(true)); offset 0 (ARCHITECTURE 4.2) ------------------------------------------------
  for (const d of arr(data.DEMO_TRIGGERS)) {
    const c = new DemoComp(eng, d);
    const plain = d.shape === 'line' ? installLine(d.pts[0], d.pts[1], 0) : installWall(d.pts, 0);
    const edges = attach(c, plain, 1, c.name);
    for (const e of edges) e.active = false;
    table.demo.push(c);
  }

  // ---- ramps -------------------------------------------------------------------------------------------------------------------------
  const oneway12 = arr(data.ONEWAYS).find((o) => o.name === 's_onewy12');
  const pass = oneway12 ? oneway12.normal : [0.826529, 0.562895];
  if (data.RAMPS) {
    for (const key of ['ramp', 'tube']) {
      const def = data.RAMPS[key];
      if (!def) continue;
      const ramp = buildRamp(def, { pass });
      table.ramps.push(ramp);
      for (const p of ramp.planes) table.rampPlanes.push(p);
      for (const s of ramp.seams) {
        const comp = new RampSeamComp(eng, ramp, s);
        const edge = makeLine(s.p0[0], s.p0[1], s.p1[0], s.p1[1], s.mask, ramp.name, 'seam:' + s.kind);
        edge.comp = comp;
        world.add(edge);
        table.comps.push(comp);
        if (s.kind === 'exitFar') openFarEnd(world, edge, ramp.mask);
      }
    }
  }
  return table;
}

/**
 * The far-end exit seam of the hidden tube lies on top of the inflated end wall of shell 106 (SPEC 3.5.3: 0.3034 from the raw end line, the
 * wall is inflated by 0.3) and is tilted by about 8 degrees against it, so for roughly the middle half of the lane the wall is hit BEFORE the
 * seam: the ball bounced back down the tube instead of coming out. The seam IS the end of the tube, so the coincident end-wall edge(s) of the
 * same layer are switched off (same-facing, parallel within ~15 degrees, both end points within 0.1 of the seam line, overlapping it).
 */
function openFarEnd(world, seam, rampMask) {
  const dist = (x, y) => Math.abs((x - seam.x0) * seam.nx + (y - seam.y0) * seam.ny);
  const along = (x, y) => (x - seam.x0) * seam.dx + (y - seam.y0) * seam.dy;
  for (const e of world.edges) {
    if (e === seam || e.k !== 'line' || !(e.mask & rampMask) || !(e.comp instanceof WallComp)) continue;
    if (e.nx * seam.nx + e.ny * seam.ny < 0.96) continue;                   // same facing, within ~16 degrees
    if (dist(e.x0, e.y0) > 0.1 || dist(e.x1, e.y1) > 0.1) continue;
    const a0 = along(e.x0, e.y0), a1 = along(e.x1, e.y1);
    if (Math.min(Math.max(a0, a1), seam.len) - Math.max(Math.min(a0, a1), 0) < 0.05) continue;
    e.active = false;
  }
}

/** Re-arm every rollover without events (called when the last ball leaves the table). */
export function rearmAllRollovers(table) {
  for (const r of table.rollovers) if (r.pressed) r.rearm();
}

/** Reset every component to its start state (resetTable). */
export function resetTable(table) {
  for (const c of table.comps) if (typeof c.reset === 'function') c.reset();
  for (const d of table.demo) for (const e of d.edges) e.active = false;
}
