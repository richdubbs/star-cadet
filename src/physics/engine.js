/**
 * src/physics/engine.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4 + 5 (update loop, commands, events); SPEC 4.3 - 4.5, 4.7.3, 4.11, 4.12
 * The fixed-step simulation. One Engine = one table: the edge world, the component registry (components.js), the flippers, the balls,
 * the physics-time timer queue, the nudge/tilt state and the event queue. src/physics.js wraps it in the public `Physics` facade.
 *
 * step(dt):  time += dt -> timers due -> update(dt) -> nudge counter. update(dt) is SPEC 4.3 literally:
 *     stuck bookkeeping; per ball forces (table field + ramp plane + wells) and the number of 0.15-unit sub-steps; flipper sub-steps;
 *     for every sub-step: balls first (ray cast against the active edges + the flipper shapes + other balls), then moving flippers.
 * Randomness (determinism contract): rand() is called once per free active ball per step (lateral jitter), twice per throwBall,
 * once per plunger release / auto-fire, and in the stuck re-throw. Nothing else.
 *
 * ASSUMPTIONS:
 *  - Time (`snapshot.time`) is monotonic over the lifetime of the engine: resetTable() does not rewind it.
 *  - The nudge counter only decays while positive (the -2 feed grace persists until nudged), otherwise it follows SPEC 4.11 literally.
 *  - nudge(dir, true) with the same direction twice before a release stacks (and a release undoes the whole stack); the shared 0.4 s timer
 *    undoes everything.
 *  - Tilt (setTiltLock(true)) undoes pending nudges, retracts the flippers (byKey:false), cancels plunger charging and shortens a running
 *    kickout hold to 0.1 s.
 *  - Sink-captured balls stay in `balls` with active === false (they are in play); drained / removed balls leave the array.
 *  - A ball that stays stuck (SPEC 4.12) is removed WITHOUT a drain event; stuckRelaunch is emitted and a relaunch (feed + self-charging
 *    plunger) is issued.
 *  - Ball-to-ball collisions (dead in the original build) are implemented from SPEC 4.7.3 for spawnBall / cheat 'b'.
 *  - Safety net (not in the SPEC): on a real table (drain + outline present) a ball that is found outside x [-9,9] x y [-15,15.5] after an update
 *    (it can only have slipped out of a mask-2 / mask-4 shell or through a wall) is drained with via 'drain' instead of flying on for ever.
 *  - Stuck check (SPEC 4.12): the flipper box exempts a ball only while that flipper is raised, held or moving (the cradle); a ball slow in the box
 *    of an idle flipper at rest (balanced on the pivot crest) is re-thrown like any other.
 *  - Debug drag: a grabbed ball is steered toward the target at up to 60 u/s through the normal sub-stepped collision (no gravity, no
 *    jitter).
 */
import * as DEFAULT_DATA from '../data/index.js';
import { EV } from '../data/events.js';
import { NO_HIT, Edge, setCircle, rayCircle } from './edges.js';
import { throwBall } from './collision.js';
import { Timers } from './timers.js';
import { World } from './world.js';
import { Flipper } from './flipper.js';
import { Ball } from './ball.js';
import { createSnapshot, fillSnapshot } from './snapshot.js';
import { buildTable, rearmAllRollovers, resetTable as resetComponents } from './components.js';
import { inTriangle, planeZ } from './ramps.js';

const NUDGE = {
  left: { vx: 1.0, vy: 0.5, shakeX: 2, shakeY: -1 },
  right: { vx: -1.0, vy: 0.5, shakeX: -2, shakeY: -1 },
  bottom: { vx: 0.0, vy: 0.5, shakeX: 0, shakeY: -1 },
};
const STUCK_RETHROW_ANGLE = 90;      // +-90 rad: effectively random (SPEC 4.12)
const ESCAPE = { minX: -9, maxX: 9, minY: -15, maxY: 15.5 };   // outside this a ball is lost (safety net, see Engine._escaped)

export class Engine {
  /** @param {import('../types.js').CreatePhysicsOpts} opts */
  constructor(opts = {}) {
    const data = opts.data || DEFAULT_DATA;
    this.data = data;
    this.rand = opts.rand || Math.random;
    this.P = data.PHYS;
    this.Z = data.Z;
    this.T = data.TIMING;
    this.R = data.TABLE.R;
    this.exactBug = !!this.P.exactThrowBug;

    this.time = 0;
    this.tilt = false;
    /** @type {any[]} */ this.events = [];
    this.timers = new Timers();
    this.world = new World(this.P.grid);
    /** @type {Ball[]} the live ball list (identity never changes) */
    this.balls = [];
    this.nextBallId = 1;
    this.nDead = 0;
    this.inUpdate = false;

    this.table = buildTable(this, data, this.world);
    /** the lost-ball safety net only makes sense on a real table (partial / empty test tables have no drain and no outline) */
    this.safetyNet = !!(this.table.drain && data.TABLE_OUTLINE);
    this.flippers = (data.FLIPPERS || []).map((d) => new Flipper(d, this.R));
    this.flipEnabled = true;

    this.feedTimer = 0;
    this.feedMode = 'normal';
    this.feedPos = data.PLUNGER ? data.PLUNGER.feed : [-7.020939, 10.084854];

    // nudge / tilt counter
    this.nudgeCount = 0;
    this.nudgeApplied = { left: 0, right: 0, bottom: 0 };
    this.nudgeTimer = 0;
    this.nudgeLast = null;
    this.warned = false;
    this.tiltedFlag = false;
    this.shake = { x: 0, y: 0 };

    this.bbEdge = new Edge();        // scratch circle for ball-to-ball tests
    this.snap = createSnapshot(data);
    this.stuckBoxes = this._stuckBoxes();
  }

  // ==================================================================================================================================
  // helpers
  // ==================================================================================================================================
  emit(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  snapshot() {
    return fillSnapshot(this.snap, this);
  }

  liveCount() {
    return this.balls.length - this.nDead;
  }

  ballsInPlay() {
    return this.liveCount();
  }

  _stuckBoxes() {
    const R2 = this.R / 2;
    const boxes = [];
    const pl = this.data.PLUNGER;
    if (pl) {
      const x0 = Math.min(pl.face[0][0], pl.face[1][0]), x1 = Math.max(pl.face[0][0], pl.face[1][0]);
      const yFace = pl.face[0][1];
      boxes.push({ x0: x0 - R2, x1: x1 + R2, y0: yFace - this.R - this.R - R2, y1: yFace + R2 });
    }
    return boxes;
  }

  _inStuckExempt(b) {
    // A flipper box exempts a ball (it may legitimately cradle on a raised / moving flipper) - but not while that flipper sits idle at rest:
    // a ball that stays slow there is balanced on the pivot crest and would never move again (the player's flip dislodges it, a demo or an
    // absent player cannot).
    for (const f of this.flippers) if ((f.button || f.cur !== 0 || f.flag !== 0) && f.near(b.x, b.y, this.R / 2)) return true;
    for (const bx of this.stuckBoxes) if (b.x >= bx.x0 && b.x <= bx.x1 && b.y >= bx.y0 && b.y <= bx.y1) return true;
    return false;
  }

  newBall(x, y) {
    const b = new Ball(this.nextBallId++, x, y);
    this.balls.push(b);
    return b;
  }

  /** Remove the bookkeeping that ties a ball to a holder (kickout, hole, sink). */
  detach(b) {
    if (b.heldBy && typeof b.heldBy.forget === 'function') b.heldBy.forget(b);
    b.heldBy = null;
    if (b.sink) {
      this.timers.cancel(b.sink.timer);
      const s = this.table.sinks[b.sink.from];
      if (s) s.count = Math.max(0, s.count - 1);
      b.sink = null;
    }
    b.grabbed = false;
  }

  /** Remove a ball from play; emits `drain` (via) unless `via` is null. Safe inside update (compaction is deferred). */
  drainBall(b, via) {
    if (b.dead) return;
    this.detach(b);
    b.active = false;
    b.dead = true;
    this.nDead++;
    const remaining = this.liveCount();
    if (via) this.emit({ type: EV.DRAIN, t: this.time, ballId: b.id, remaining, via });
    if (!this.inUpdate) this.compact();
    if (remaining === 0) rearmAllRollovers(this.table);
  }

  compact() {
    if (this.nDead === 0) return;
    const balls = this.balls;
    let j = 0;
    for (let i = 0; i < balls.length; i++) if (!balls[i].dead) balls[j++] = balls[i];
    balls.length = j;
    this.nDead = 0;
  }

  /** A free mask-1 ball in the plunger lane at or below the feed height (resting or still bouncing after the feed). */
  ballNearPlunger() {
    const fx = this.feedPos[0], fy = this.feedPos[1];
    for (const b of this.balls) {
      if (b.dead || !b.active || b.heldBy || b.mask !== 1) continue;
      if (Math.abs(b.x - fx) < 0.4 && b.y > fy - 0.1) return true;
    }
    return false;
  }

  ballAtPlunger() {
    const fx = this.feedPos[0];
    for (const b of this.balls) {
      if (b.dead || !b.active || b.heldBy || b.mask !== 1) continue;
      if (Math.abs(b.x - fx) < 0.4 && b.y > 11.0) return true;
    }
    return false;
  }

  // ==================================================================================================================================
  // the fixed step
  // ==================================================================================================================================
  step(dt) {
    if (dt === undefined) dt = this.P.dt;
    if (!(dt > 0)) return;
    if (dt > this.P.maxFrameDt) dt = this.P.maxFrameDt;
    this.time += dt;
    this.timers.run(this.time);
    this.update(dt);
    this._updateNudge(dt);
  }

  update(dt) {
    const P = this.P;
    const balls = this.balls;
    const flippers = this.flippers;
    this.inUpdate = true;
    // 1. stuck-ball bookkeeping
    for (let i = 0; i < balls.length; i++) this._checkStuck(balls[i], dt);
    // 2. forces and sub-step counts
    let maxStep = -1;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      b.cdisabled = false;
      if (!b.active || b.dead) { b.nsteps = -1; continue; }
      b.dt = (dt > 0.01 && b.speed < P.slowSpeed) ? P.slowDt : dt;
      if (b.heldBy) { b.heldBy.fieldEffect(b, dt); b.nsteps = -1; continue; }
      this._integrate(b);
      b.dist = b.speed * b.dt;
      b.nsteps = Math.ceil(b.dist / P.subStep) - 1;
      if (b.nsteps > maxStep) maxStep = b.nsteps;
    }
    for (let i = 0; i < flippers.length; i++) {
      const f = flippers[i];
      f.stepAngle(dt);
      if (f.k > maxStep) maxStep = f.k;
    }
    // 3. sub-steps: balls first, then the moving flippers
    for (let step = 0; step <= maxStep; step++) {
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (b.nsteps >= step && !b.cdisabled && b.active && !b.dead && !b.heldBy) this._advanceBall(b, step);
      }
      for (let i = 0; i < flippers.length; i++) {
        const f = flippers[i];
        if (f.k >= step) f.collideAndRotate(f.dA, balls);
      }
    }
    // flipper strikes of this step (presentation only: nothing in physics or rules depends on them)
    for (let i = 0; i < flippers.length; i++) {
      const f = flippers[i];
      if (!f.strikeBall) continue;
      const b = f.strikeBall;
      f.strikeBall = null;
      f.strikeSpeed = 0;
      if (!b.dead) this.emit({ type: EV.FLIPPER_HIT, t: this.time, side: f.side, ballId: b.id, speed: b.speed });
    }
    this.inUpdate = false;
    this.compact();
    // 4. height bookkeeping + safety net (backwards: a lost ball is compacted out of the array while we walk it)
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (this._escaped(b)) { this.drainBall(b, 'drain'); continue; }
      this._settleZ(b);
    }
  }

  /**
   * A ball that left the table by any route the geometry did not foresee (a mask-2 / mask-4 ball slipping out of its shell, a ball squeezed through
   * a wall) would fall or fly on forever: nothing drains it (the drain line only serves mask 1, the stuck check needs speed < 0.8) and the game would wait
   * for it for ever. Treat it as a drain. The playfield is x [-8,8] x y [-14,15]; the drain line sits at y 14.14, so these limits are never met in
   * normal play. Balls held by a kickout / hole / sink are never "escaped".
   */
  _escaped(b) {
    if (!this.safetyNet || b.heldBy || !b.active || b.dead) return false;
    return !(b.x > ESCAPE.minX && b.x < ESCAPE.maxX && b.y > ESCAPE.minY && b.y < ESCAPE.maxY);   // also true for NaN
  }

  /** Forces of SPEC 4.4: table field (gravity, drag, lateral jitter), ramp plane, wells. Updates speed and the unit direction. */
  _integrate(b) {
    const P = this.P;
    const dt = b.dt;
    let vx, vy;
    if (b.grabbed) {
      vx = (b.tx - b.x) / dt;
      vy = (b.ty - b.y) / dt;
    } else {
      const sp = b.speed;
      const r = this.rand();
      let ax = P.gravity[0] - (0.5 - r) * sp * P.jitter - b.dx * sp * P.drag;
      let ay = P.gravity[1] - b.dy * sp * P.drag;
      if (b.onRamp && b.plane) {
        const pl = b.plane;
        ax += pl.fx - b.dx * sp * pl.drag;
        ay += pl.fy - b.dy * sp * pl.drag;
      }
      const wells = this.table.wells;
      for (let i = 0; i < wells.length; i++) {
        const w = wells[i];
        if (!w.inField(b)) continue;
        const dx = w.cx - b.x, dy = w.cy - b.y;
        const d = Math.hypot(dx, dy);
        if (d > 0) { ax += w.pull * dx / d; ay += w.pull * dy / d; }
        ax -= b.dx * sp;
        ay -= b.dy * sp;
      }
      vx = b.dx * sp + ax * dt;
      vy = b.dy * sp + ay * dt;
    }
    const m = Math.hypot(vx, vy);
    if (m > 0) {
      b.speed = m < P.maxSpeed ? m : P.maxSpeed;
      b.dx = vx / m; b.dy = vy / m;
    } else {
      b.speed = 0;
    }
  }

  /** SPEC 4.3 advanceBall: repeated ray casts inside one 0.15-unit sub-step. */
  _advanceBall(b, step) {
    const world = this.world;
    const flippers = this.flippers;
    const sub = this.P.subStep;
    let travelled = 0;
    // remaining ray length of this sub-step: a bounce re-casts the FULL length, a pass-through trigger consumes the distance it travelled
    b.rayMax = b.nsteps <= step ? b.dist - b.nsteps * sub : sub;
    for (let guard = 0; travelled < sub && guard < 32; guard++) {
      const maxd = b.rayMax;
      if (maxd <= 0) break;
      const skip = b.remembered;
      const nskip = skip.length;
      const spare = b.altRem;
      spare.length = 0;
      b.altRem = skip;
      b.remembered = spare;

      let best = world.cast(b.x, b.y, b.dx, b.dy, maxd, b.mask, skip, nskip);
      let edge = world.hitEdge;
      let fl = null;
      let fnx = 0, fny = 0;
      for (let i = 0; i < flippers.length; i++) {
        const f = flippers[i];
        if ((f.mask & b.mask) === 0 || !f.near(b.x, b.y, maxd + 0.01)) continue;
        const d = f.distTo(b.x, b.y, b.dx, b.dy, maxd);
        if (d < best) { best = d; fl = f; edge = null; fnx = f.hnx; fny = f.hny; }
      }
      let other = null;
      if (best > 0 && this.balls.length > 1) {
        const bb = this.bbEdge;
        for (let i = 0; i < this.balls.length; i++) {
          const o = this.balls[i];
          if (o === b || o.dead || !o.active || o.heldBy || (o.mask & b.mask) === 0) continue;
          if (Math.abs(o.x - b.x) >= this.P.ballPairBox || Math.abs(o.y - b.y) >= this.P.ballPairBox) continue;
          setCircle(bb, o.x, o.y, 2 * this.R);
          let t = rayCircle(bb, b.x, b.y, b.dx, b.dy, maxd);
          if (t >= NO_HIT) continue;
          t -= 0.002;
          if (t < 0) t = 0;
          if (t < best) { best = t; other = o; fl = null; edge = null; }
        }
      }
      if (best >= NO_HIT) {
        b.x += maxd * b.dx;
        b.y += maxd * b.dy;
        break;
      }
      const hx = b.x + best * b.dx;
      const hy = b.y + best * b.dy;
      if (fl) {
        fl.hit(b, hx, hy, fnx, fny);
      } else if (other) {
        this._ballBall(b, other, best);
      } else {
        let nx, ny;
        if (edge.k === 'line') {
          nx = edge.nx; ny = edge.ny;
        } else {
          nx = hx - edge.cx; ny = hy - edge.cy;
          const l = Math.hypot(nx, ny);
          if (l > 0) { nx /= l; ny /= l; } else { nx = 0; ny = -1; }
        }
        edge.comp.onHit(b, edge, hx, hy, nx, ny);
        if (b.remembered.length > 0) b.rayMax -= best;        // pass-through: the ray continues with what is left (SPEC 4.5)
      }
      if (best <= 0 || b.cdisabled || b.dead || !b.active || b.heldBy) break;
      travelled += best;
    }
  }

  /** SPEC 4.7.3: perfectly elastic equal-mass exchange of the normal velocity components. */
  _ballBall(a, o, dist) {
    a.x += a.dx * dist;
    a.y += a.dy * dist;
    let nx = a.x - o.x, ny = a.y - o.y;
    const l = Math.hypot(nx, ny);
    if (l > 0) { nx /= l; ny /= l; } else { nx = 0; ny = -1; }
    const vax = a.dx * a.speed, vay = a.dy * a.speed;
    const vbx = o.dx * o.speed, vby = o.dy * o.speed;
    const k = (vbx * nx + vby * ny) - (vax * nx + vay * ny);
    const dx = nx * k, dy = ny * k;
    this._setVelocity(a, vax + dx, vay + dy);
    this._setVelocity(o, vbx - dx, vby - dy);
    a.cdisabled = true;
  }

  _setVelocity(b, vx, vy) {
    const m = Math.hypot(vx, vy);
    if (m > 0) {
      b.speed = m < this.P.maxSpeed ? m : this.P.maxSpeed;
      b.dx = vx / m; b.dy = vy / m;
    } else {
      b.speed = 0;
    }
  }

  /** Velocity change applied to a free ball (nudge). */
  _addVelocity(b, ax, ay) {
    this._setVelocity(b, b.dx * b.speed + ax, b.dy * b.speed + ay);
  }

  /** Ball height bookkeeping (RENDER only). */
  _settleZ(b) {
    if (b.heldBy || !b.active) return;
    if (b.onRamp && b.plane) b.z = planeZ(b.plane, b.x, b.y) + this.R;
    else if (b.mask === 4) b.z = this.Z.ballOnDeck;
    else if (b.mask === 1) b.z = this.Z.ball;
  }

  /** SPEC 4.12. */
  _checkStuck(b, dt) {
    const P = this.P;
    if (!b.active || b.dead || b.heldBy || b.grabbed) { b.slowTime = 0; return; }
    if (b.speed >= P.unstuckSpeed || this._inStuckExempt(b)) { b.slowTime = 0; return; }
    b.slowTime += dt;
    if (b.slowTime <= P.unstuckSeconds) return;
    b.slowTime = 0;
    const moved = Math.hypot(b.x - b.lastX, b.y - b.lastY);
    b.lastX = b.x; b.lastY = b.y;
    if (moved < this.R / 2) b.stuckCount++; else b.stuckCount = 0;
    if (b.stuckCount > P.unstuckMaxCount) {
      this.drainBall(b, null);
      this.emit({ type: EV.STUCK_RELAUNCH, t: this.time });
      this.relaunch();
      return;
    }
    throwBall(b, 0, -1, STUCK_RETHROW_ANGLE, 1.0, 0, this.rand, this.exactBug);
  }

  // ==================================================================================================================================
  // nudge / tilt
  // ==================================================================================================================================
  _updateNudge(dt) {
    let any = false;
    const a = this.nudgeApplied;
    if (a.left > 0 || a.right > 0 || a.bottom > 0) any = true;
    if (any) this.nudgeCount += this.T.nudgeRise * dt;
    else if (this.nudgeCount > 0) this.nudgeCount = Math.max(0, this.nudgeCount - dt);
    const c = this.nudgeCount;
    if (c > this.T.nudgeWarn) {
      if (!this.warned) {
        this.warned = true;
        if (!this.tilt) this.emit({ type: EV.NUDGE_COUNT, t: this.time, level: 'warn', count: c });
      }
    } else this.warned = false;
    if (c > this.T.nudgeTilt) {
      if (!this.tiltedFlag) {
        this.tiltedFlag = true;
        if (!this.tilt) this.emit({ type: EV.NUDGE_COUNT, t: this.time, level: 'tilt', count: c });
      }
    } else this.tiltedFlag = false;
  }

  nudge(dir, down = true) {
    const n = NUDGE[dir];
    if (!n) throw new TypeError(`nudge: unknown direction ${String(dir)}`);
    if (down) {
      if (this.tilt) return false;
      this.nudgeApplied[dir]++;
      this.nudgeLast = dir;
      for (const b of this.balls) if (b.active && !b.dead && !b.heldBy && !b.grabbed) this._addVelocity(b, n.vx, n.vy);
      this.shake.x = n.shakeX; this.shake.y = n.shakeY;
      this.timers.cancel(this.nudgeTimer);
      this.nudgeTimer = this.timers.schedule(this.time + this.T.nudgeUndo, () => { this.nudgeTimer = 0; this._undoNudges(); });
      this.emit({ type: EV.NUDGE, t: this.time, dir });
      return true;
    }
    this._undoNudge(dir);
    return !this.tilt;
  }

  _undoNudge(dir) {
    const n = NUDGE[dir];
    const count = this.nudgeApplied[dir];
    if (count > 0) {
      this.nudgeApplied[dir] = 0;
      for (const b of this.balls) if (b.active && !b.dead && !b.heldBy && !b.grabbed) this._addVelocity(b, -n.vx * count, -n.vy * count);
    }
    const a = this.nudgeApplied;
    if (a.left === 0 && a.right === 0 && a.bottom === 0) {
      this.shake.x = 0; this.shake.y = 0;
      this.timers.cancel(this.nudgeTimer);
      this.nudgeTimer = 0;
    } else {
      const rest = a.left > 0 ? 'left' : a.right > 0 ? 'right' : 'bottom';
      this.shake.x = NUDGE[rest].shakeX; this.shake.y = NUDGE[rest].shakeY;
    }
  }

  _undoNudges() {
    this._undoNudge('left');
    this._undoNudge('right');
    this._undoNudge('bottom');
  }

  setTiltLock(on) {
    on = !!on;
    if (on === this.tilt) return;
    this.tilt = on;
    if (on) {
      this._undoNudges();
      for (const f of this.flippers) this._forceRetract(f);
      if (this.table.plunger) this.table.plunger.cancelCharge();
      for (const k of this.table.kickoutList) {
        const due = this.timers.dueOf(k.releaseTimer);
        if (k.ball && due >= 0) k.setHold(Math.min(0.1, Math.max(0, due - this.time)));
      }
    }
    this._syncTilt();
  }

  _syncTilt() {
    for (const k of this.table.kickoutList) k.sync();
    if (this.table.blocker) this.table.blocker.sync();
  }

  isTiltLocked() {
    return this.tilt;
  }

  getNudgeCount() {
    return this.nudgeCount;
  }

  // ==================================================================================================================================
  // flippers
  // ==================================================================================================================================
  _flipper(side) {
    if (side !== 'left' && side !== 'right') throw new TypeError(`flipper side must be 'left' or 'right', got ${String(side)}`);
    const f = this.flippers.find((x) => x.side === side);
    if (!f) throw new TypeError(`no ${side} flipper in this table`);
    return f;
  }

  _forceRetract(f) {
    if (!f.button) return;
    f.button = false;
    f.setMotion(false);
    this.emit({ type: EV.FLIPPER, t: this.time, side: f.side, action: 'retract', byKey: false });
  }

  setFlipperButton(side, down) {
    const f = this._flipper(side);
    down = !!down;
    if (!this.flipEnabled || this.tilt) return false;
    if (f.button === down) return true;
    f.button = down;
    f.setMotion(down);
    this.emit({ type: EV.FLIPPER, t: this.time, side, action: down ? 'extend' : 'retract', byKey: true });
    return true;
  }

  setFlippersEnabled(on) {
    on = !!on;
    this.flipEnabled = on;
    if (!on) for (const f of this.flippers) this._forceRetract(f);
  }

  // ==================================================================================================================================
  // plunger / feed
  // ==================================================================================================================================
  setPlungerButton(down) {
    const pl = this.table.plunger;
    if (!pl) return;
    if (down) { if (!this.tilt) pl.press(); } else pl.release();
  }

  /** Window focus lost while the plunger is being pulled: let it go back WITHOUT firing (a ball-save relaunch charges by itself and is left alone). */
  cancelPlunger() {
    const pl = this.table.plunger;
    if (pl && pl.charging && !pl.autoRelease) pl.cancelCharge();
  }

  startFeed(opts = {}) {
    const fallback = this.data.PLUNGER ? this.data.PLUNGER.feedDelay : this.T.feedDelay;
    this._scheduleFeed('normal', opts && opts.delay !== undefined ? opts.delay : fallback);
  }

  relaunch() {
    this._scheduleFeed('relaunch', this.data.PLUNGER ? this.data.PLUNGER.feedDelay : this.T.feedDelay);
  }

  _scheduleFeed(mode, delay) {
    if (!(delay >= 0)) delay = 0;
    this.timers.cancel(this.feedTimer);
    this.feedMode = mode;
    this.feedTimer = this.timers.schedule(this.time + delay, () => this._feed());
  }

  _feed() {
    this.feedTimer = 0;
    const fx = this.feedPos[0], fy = this.feedPos[1];
    for (const o of this.balls) {
      if (o.dead || !o.active) continue;
      if (Math.hypot(o.x - fx, o.y - fy) < 1.2 * this.R) {
        this.feedTimer = this.timers.schedule(this.time + this.T.feedRetry, () => this._feed());
        return;
      }
    }
    const b = this.newBall(fx, fy);
    this.setTiltLock(false);
    this.nudgeCount = this.T.nudgeGrace;
    this.warned = false; this.tiltedFlag = false;
    this.emit({ type: EV.PLUNGER_FED, t: this.time, ballId: b.id });
    if (this.feedMode === 'relaunch' && this.table.plunger) this.table.plunger.press(this.T.plungerRelaunchTick, true);
  }

  launchInstant() {
    const pl = this.table.plunger;
    if (!pl || !this.ballAtPlunger()) return false;
    pl.launchNow();
    return true;
  }

  // ==================================================================================================================================
  // component commands
  // ==================================================================================================================================
  _id(kind, id, map, names) {
    let key = id;
    if (typeof id === 'string') {
      const k = Object.keys(names).find((n) => names[n] === id);
      if (k === undefined) throw new TypeError(`${kind}: unknown component ${id}`);
      key = Number(k);
    }
    if (!map[key]) throw new TypeError(`${kind}: unknown id ${String(id)}`);
    return map[key];
  }

  gateSetEnabled(id, enabled) {
    this._id('gateSetEnabled', id, this.table.gates, this.data.NAMES.gate).setEnabled(enabled);
  }

  blockerSetEnabled(enabled) {
    if (this.table.blocker) this.table.blocker.setEnabled(enabled);
  }

  popupReenable(names, immediate = false) {
    const list = this.table.popups;
    let targets;
    if (names === 'all') targets = list;
    else {
      const arrNames = Array.isArray(names) ? names : [names];
      targets = arrNames.map((n) => {
        const c = list.find((p) => p.name === n);
        if (!c) throw new TypeError(`popupReenable: unknown pop-up target ${String(n)}`);
        return c;
      });
    }
    for (const c of targets) c.reenable(!!immediate);
  }

  kickoutSetActive(id, active) {
    this._id('kickoutSetActive', id, this.table.kickouts, this.data.NAMES.kickout).setActive(active);
  }

  kickoutSetHold(id, seconds) {
    const k = this._id('kickoutSetHold', id, this.table.kickouts, this.data.NAMES.kickout);
    if (typeof seconds !== 'number' || Number.isNaN(seconds)) throw new TypeError('kickoutSetHold: seconds must be a number');
    k.setHold(seconds);
  }

  sinkSetRoute(id, exitId, holdSeconds) {
    const from = this._id('sinkSetRoute', id, this.table.sinks, this.data.NAMES.sink);
    const exit = this._id('sinkSetRoute', exitId, this.table.sinks, this.data.NAMES.sink);
    let target = null;
    for (const b of this.balls) if (!b.dead && b.sink && b.sink.from === from.id) target = b;     // most recent capture wins
    if (!target) return;
    const rec = target.sink;
    rec.exit = exit.id;
    rec.hold = holdSeconds === undefined ? from.def.holdSeconds : holdSeconds;
    this.timers.cancel(rec.timer);
    rec.timer = this.timers.schedule(this.time + Math.max(0, rec.hold), () => this.table.ejectBall(target));
  }

  setDemoTriggers(on) {
    for (const d of this.table.demo) for (const e of d.edges) e.active = !!on;
  }

  // ==================================================================================================================================
  // balls: bulk commands
  // ==================================================================================================================================
  forceDrainAll() {
    const list = this.balls.slice();
    for (const b of list) if (!b.dead) this.drainBall(b, 'forced');
  }

  removeAllBalls() {
    for (const b of this.balls) { this.detach(b); b.dead = true; b.active = false; }
    this.balls.length = 0;
    this.nDead = 0;
    this.timers.cancel(this.feedTimer);
    this.feedTimer = 0;
    if (this.table.plunger) this.table.plunger.reset();
    for (const s of this.table.sinkList) s.count = 0;
    if (this.table.hole) this.table.hole.reset();
    for (const k of this.table.kickoutList) { this.timers.cancel(k.releaseTimer); k.releaseTimer = 0; k.ball = null; }
    rearmAllRollovers(this.table);
  }

  resetTable() {
    this.removeAllBalls();
    this.timers.clear();
    this.tilt = false;
    this.flipEnabled = true;
    for (const f of this.flippers) { f.button = false; f.reset(); }
    this.nudgeApplied.left = 0; this.nudgeApplied.right = 0; this.nudgeApplied.bottom = 0;
    this.nudgeTimer = 0; this.nudgeLast = null; this.nudgeCount = 0; this.warned = false; this.tiltedFlag = false;
    this.shake.x = 0; this.shake.y = 0;
    this.feedMode = 'normal';
    resetComponents(this.table);
    this._syncTilt();
    this.events = [];
  }

  spawnBall(x, y, opts = {}) {
    if (this.liveCount() >= this.P.maxBalls) return null;
    for (const o of this.balls) {
      if (o.dead) continue;
      if (Math.hypot(o.x - x, o.y - y) < 1.2 * this.R) return null;
    }
    const mask = opts.mask === undefined ? 1 : opts.mask;
    let plane = null;
    if (mask === 2) {
      for (const p of this.table.rampPlanes) if (inTriangle(p.v, x, y)) { plane = p; break; }
      if (!plane) return null;
    }
    const b = this.newBall(x, y);
    b.mask = mask;
    if (plane) { b.onRamp = true; b.plane = plane; }
    b.z = mask === 4 ? this.Z.ballOnDeck : plane ? planeZ(plane, x, y) + this.R : this.Z.ball;
    const vx = opts.vx || 0, vy = opts.vy || 0;
    if (vx !== 0 || vy !== 0) this._setVelocity(b, vx, vy);
    return b;
  }

  // ==================================================================================================================================
  // debug drag
  // ==================================================================================================================================
  debugGrab(x, y) {
    let best = null, bd = 1.0;
    for (const b of this.balls) {
      if (b.dead || !b.active || b.heldBy) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return false;
    best.grabbed = true;
    best.tx = x; best.ty = y;
    return true;
  }

  debugDrag(x, y) {
    for (const b of this.balls) if (b.grabbed) { b.tx = x; b.ty = y; }
  }

  debugRelease() {
    for (const b of this.balls) b.grabbed = false;
  }
}
