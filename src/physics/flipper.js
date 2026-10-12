/**
 * src/physics/flipper.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.3; SPEC 4.8 (flippers), cross-checked against research/physics_ref_sim.py (class Flipper)
 * A flipper is a tapered capsule rebuilt on every angle change: a pivot circle (r = pivotR + R), a tip circle (r = tipR + R) and two
 * one-sided lines (A and B, normals pointing away from the axis). It collides with balls in two ways:
 *   - as an ordinary static shape in the ball's ray cast (distTo / hit), and
 *   - while moving, once per sub-step, by sweeping the ball into the flipper frame (collideAndRotate).
 * Motion: press -> extend (30.38 rad/s), release -> retract (15.19 rad/s). While moving the flipper adds a boost along the contact
 * normal ("front" side) or damps the ball ("back" side). Idle (resting or fully raised) it is a plain wall (e 0.75, s 0.5).
 *
 * ASSUMPTIONS:
 *  - The collision AABB is the SPEC box (pivot circle + both tip circles) enlarged by the circles swept by the tip between rest and raised
 *    (the arc bulges outside the box of the two end circles), then expanded by 0.4789. A superset only adds tests that find real hits.
 *  - angleMax comes from the data def (FLIPPERS[i].angleMax), not recomputed from the tip positions.
 */
import { NO_HIT, Edge, setLine, setCircle, rayLine, rayCircle } from './edges.js';
import { basicCollision } from './collision.js';

const MOTION_NONE = 0;
const MOTION_EXTEND = 1;
const MOTION_RETRACT = 2;

export class Flipper {
  /**
   * @param {import('../types.js').FlipperDef} def
   * @param {number} R ball radius
   */
  constructor(def, R) {
    this.name = def.name;
    this.side = def.side;
    this.mask = def.mask;
    this.el = def.material.elasticity;
    this.sm = def.material.smoothness;
    this.mult = def.collisionMult;
    const [ox, oy] = def.pivot;
    const [t1x, t1y] = def.restTip;
    this.ox = ox; this.oy = oy;
    this.baseR = def.pivotR + R;
    this.t1x = t1x; this.t1y = t1y;                      // rest tip (source, never rotated)
    this.tipR = def.tipR + R;
    this.amax = def.angleMax;
    this.ext = Math.abs(this.amax) / def.extendSeconds;   // |rad/s|
    this.ret = Math.abs(this.amax) / def.retractSeconds;
    // signed speeds: left (amax > 0) extends with +, right with -
    if (this.amax <= 0) this.ext = -this.ext; else this.ret = -this.ret;
    const ux = (t1x - ox), uy = (t1y - oy);
    const ul = Math.hypot(ux, uy);
    const px = -uy / ul, py = ux / ul;                   // perpCCW of the unit axis
    // source points of the two lines (Python naming: A1 tip side +perp, A2 pivot side +perp, B1 pivot side -perp, B2 tip side -perp)
    let A1 = [px * this.tipR + t1x, py * this.tipR + t1y];
    let A2 = [px * this.baseR + ox, py * this.baseR + oy];
    let B1 = [-px * this.baseR + ox, -py * this.baseR + oy];
    let B2 = [-px * this.tipR + t1x, -py * this.tipR + t1y];
    if (this.amax < 0) { [A1, B1] = [B1, A1]; [A2, B2] = [B2, A2]; }
    this.A1 = A1; this.A2 = A2; this.B1 = B1; this.B2 = B2;
    this.reach = ul + R + def.tipR;                       // DistanceDiv
    this.reachSq = this.reach * this.reach;
    this.invT1 = 1 / this.tipR * 1.5;
    this.button = false;    // the player's button is held (extended / extending)
    this.cur = 0;           // current angle (rad, CCW positive)
    this.rem = 0;           // remaining angle of the current motion
    this.dst = 0;
    this.flag = MOTION_NONE;
    this.ms = 0;            // signed move speed
    this.k = -1;            // sub-steps this update minus one (-1 = idle)
    this.dA = 0;            // angle per sub-step this update
    // dynamic shape
    this.lineA = new Edge(); this.lineB = new Edge();
    this.pivotCircle = new Edge(); this.tipCircle = new Edge();
    this.cTipX = t1x; this.cTipY = t1y;                  // rotated tip centre
    setCircle(this.pivotCircle, ox, oy, this.baseR);
    // collision AABB (see ASSUMPTIONS)
    let minX = ox - def.pivotR, maxX = ox + def.pivotR, minY = oy - def.pivotR, maxY = oy + def.pivotR;
    const grow = (cx, cy, r) => {
      if (cx - r < minX) minX = cx - r; if (cx + r > maxX) maxX = cx + r;
      if (cy - r < minY) minY = cy - r; if (cy + r > maxY) maxY = cy + r;
    };
    const SAMPLES = 16;
    for (let i = 0; i <= SAMPLES; i++) {
      const a = this.amax * i / SAMPLES;
      const s = Math.sin(a), c = Math.cos(a);
      grow(ox + (t1x - ox) * c - (t1y - oy) * s, oy + (t1x - ox) * s + (t1y - oy) * c, def.tipR);
    }
    grow(def.raisedTip[0], def.raisedTip[1], def.tipR);
    const pad = this.tipR / 1.5 + 0.15;
    this.boxMinX = minX - pad; this.boxMaxX = maxX + pad; this.boxMinY = minY - pad; this.boxMaxY = maxY + pad;
    // hit scratch (set by distTo)
    this.hnx = 0; this.hny = 0;
    // strongest strike of the current step (an extending flipper boosting a ball off its front): the engine turns it into a 'flipperHit' event
    this.strikeBall = null;
    this.strikeSpeed = 0;
    this.setAngle(0);
  }

  /** Rebuild the dynamic shape for `angle`. */
  setAngle(angle) {
    this.cur = angle;
    const s = Math.sin(angle), c = Math.cos(angle);
    const ox = this.ox, oy = this.oy;
    // rotate the source points about the pivot (CCW): x' = dx cos - dy sin, y' = dx sin + dy cos   (no closures / temporaries: hot path)
    const a1 = this.A1, a2 = this.A2, b1 = this.B1, b2 = this.B2;
    setLine(this.lineA,
      (a1[0] - ox) * c - (a1[1] - oy) * s + ox, (a1[0] - ox) * s + (a1[1] - oy) * c + oy,
      (a2[0] - ox) * c - (a2[1] - oy) * s + ox, (a2[0] - ox) * s + (a2[1] - oy) * c + oy);
    setLine(this.lineB,
      (b1[0] - ox) * c - (b1[1] - oy) * s + ox, (b1[0] - ox) * s + (b1[1] - oy) * c + oy,
      (b2[0] - ox) * c - (b2[1] - oy) * s + ox, (b2[0] - ox) * s + (b2[1] - oy) * c + oy);
    this.cTipX = (this.t1x - ox) * c - (this.t1y - oy) * s + ox;
    this.cTipY = (this.t1x - ox) * s + (this.t1y - oy) * c + oy;
    setCircle(this.tipCircle, this.cTipX, this.cTipY, this.tipR);
  }

  /** True when the flipper is neither extending nor retracting. */
  get idle() {
    return this.flag === MOTION_NONE;
  }

  /** SetMotion('extend') / ('retract'). */
  setMotion(extend) {
    if (extend) {
      this.rem = Math.abs(this.amax - this.cur);
      this.dst = this.amax;
      this.ms = this.ext;
      this.flag = this.rem !== 0 ? MOTION_EXTEND : MOTION_NONE;
    } else {
      this.rem = Math.abs(this.cur);
      this.dst = 0;
      this.ms = this.ret;
      this.flag = this.rem !== 0 ? MOTION_RETRACT : MOTION_NONE;
    }
  }

  /** Jump to rest (reset). */
  reset() {
    this.rem = 0; this.dst = 0; this.flag = MOTION_NONE; this.ms = 0; this.k = -1; this.dA = 0;
    this.strikeBall = null; this.strikeSpeed = 0;
    this.setAngle(0);
  }

  /**
   * Start of an update: compute the number of sub-steps and the angle per sub-step (SPEC 4.8 stepAngle).
   * Sets this.k (= sub-steps - 1, -1 when idle) and this.dA.
   */
  stepAngle(dt) {
    if (this.flag === MOTION_NONE) { this.k = -1; this.dA = 0; return; }
    let da = this.ms * dt;
    if (Math.abs(da) > this.rem) da = this.dst - this.cur;
    let steps = Math.abs(Math.ceil(this.reach * da * this.invT1));
    if (steps > 3) steps = 3;
    if (steps >= 2) { this.k = steps - 1; this.dA = da / steps; } else { this.k = 0; this.dA = da; }
  }

  /** Is the point inside the (enlarged) collision box, grown by `m`. */
  near(x, y, m) {
    return x >= this.boxMinX - m && x <= this.boxMaxX + m && y >= this.boxMinY - m && y <= this.boxMaxY + m;
  }

  /**
   * Nearest hit of the unit ray among {LineA, pivot circle, tip circle, LineB}. Returns the distance (NO_HIT if none) and stores
   * the contact normal in this.hnx/this.hny (circle normals computed at the hit point).
   */
  distTo(ox, oy, dx, dy, maxd) {
    let best = NO_HIT;
    let typ = 0;
    let d = rayLine(this.lineA, ox, oy, dx, dy, maxd);
    if (d < best) { best = d; typ = 1; }
    d = rayCircle(this.pivotCircle, ox, oy, dx, dy, maxd);
    if (d < best) { best = d; typ = 2; }
    d = rayCircle(this.tipCircle, ox, oy, dx, dy, maxd);
    if (d < best) { best = d; typ = 3; }
    d = rayLine(this.lineB, ox, oy, dx, dy, maxd);
    if (d < best) { best = d; typ = 4; }
    if (typ === 0) return NO_HIT;
    if (typ === 1) { this.hnx = this.lineA.nx; this.hny = this.lineA.ny; }
    else if (typ === 4) { this.hnx = this.lineB.nx; this.hny = this.lineB.ny; }
    else {
      const hx = ox + best * dx, hy = oy + best * dy;
      const cx = typ === 2 ? this.ox : this.cTipX, cy = typ === 2 ? this.oy : this.cTipY;
      const nx = hx - cx, ny = hy - cy;
      const l = Math.hypot(nx, ny);
      if (l > 0) { this.hnx = nx / l; this.hny = ny / l; } else { this.hnx = 0; this.hny = -1; }
    }
    return best;
  }

  /** Response when a ball touches the flipper at (cx,cy) with unit normal (nx,ny) (SPEC 4.8 flipperHit). */
  hit(ball, cx, cy, nx, ny) {
    if (this.flag === MOTION_NONE) {
      basicCollision(ball, cx, cy, nx, ny, this.el, this.sm, 1e9, 0);
      return;
    }
    const crossP = (this.ox - this.cTipX) * (cy - this.cTipY) - (this.oy - this.cTipY) * (cx - this.cTipX);
    let front = (crossP <= 0 && this.amax > 0) || (crossP > 0 && this.amax <= 0);
    let perp;
    if (this.flag === MOTION_RETRACT) { front = !front; perp = this.lineB; } else { perp = this.lineA; }
    const ddx = cx - this.ox, ddy = cy - this.oy;
    const r2 = ddx * ddx + ddy * ddy;
    const far = r2 > 1.01 * this.baseR * this.baseR;
    if (front) {
      let boost = 0;
      if (far) {
        const v = Math.abs(this.ms) * Math.sqrt(r2 / this.reachSq);
        const dotn = perp.nx * nx + perp.ny * ny;
        if (dotn >= 0) boost = this.mult * dotn * v;
      }
      basicCollision(ball, cx, cy, nx, ny, this.el, this.sm, boost > 0 ? -1 : 1e9, boost);
      // a real flip (not a ball rolling onto a resting flipper): remembered for the step's 'flipperHit' event; no effect on the simulation
      if (boost > 0 && this.flag === MOTION_EXTEND && ball.speed >= this.strikeSpeed) { this.strikeBall = ball; this.strikeSpeed = ball.speed; }
    } else {
      let e = this.el;
      if (far) e = (1 - Math.sqrt(r2 / this.reachSq)) * this.el;
      basicCollision(ball, cx, cy, nx, ny, e, this.sm, 1e9, 0);
    }
  }

  /**
   * One sub-step of the moving flipper (SPEC 4.8 collideAndRotate): sweep every nearby mask-1 ball into the flipper frame; any
   * contact applies the response and the flipper is pushed slightly back instead of rotating by dA.
   * @param {number} da angle of this sub-step
   * @param {{x:number,y:number,dx:number,dy:number,speed:number,mask:number,active:boolean,heldBy:any,dead?:boolean}[]} balls
   */
  collideAndRotate(da, balls) {
    if (this.flag === MOTION_NONE) return;
    let coll = false;
    const s = Math.sin(-da), c = Math.cos(-da);
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.active || b.heldBy || b.dead || (b.mask & this.mask) === 0 || !this.near(b.x, b.y, 0)) continue;
      const px = (b.x - this.ox) * c - (b.y - this.oy) * s + this.ox;
      const py = (b.x - this.ox) * s + (b.y - this.oy) * c + this.oy;
      const ddx = px - b.x, ddy = py - b.y;
      const len = Math.hypot(ddx, ddy);
      if (len > 0) {
        const d = this.distTo(b.x, b.y, ddx / len, ddy / len, len);
        if (d < NO_HIT) { this.hit(b, b.x, b.y, this.hnx, this.hny); coll = true; }
      }
    }
    if (coll) {
      const back = da / (Math.abs(this.ms) * 5);
      this.cur -= back;
      this.rem += Math.abs(back);
    } else {
      this.cur += da;
      this.rem -= Math.abs(da);
    }
    if (this.rem <= 0.0001) { this.cur = this.dst; this.flag = MOTION_NONE; }
    this.setAngle(this.cur);
  }
}
