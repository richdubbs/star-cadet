/**
 * src/physics/ball.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.3; type Ball (src/types.js); SPEC 4.2
 * The runtime ball. T-frame; (dx,dy) is the UNIT direction (except right after throwBall, which leaves it un-normalised until the next
 * update); speed <= 60. The ball carries ONE collision mask (1 playfield, 2 ramp/tube, 4 deck). z is only bookkeeping for RENDER.
 */
export class Ball {
  constructor(id, x, y) {
    this.id = id;
    this.x = x; this.y = y; this.z = 0.3;
    this.dx = 0; this.dy = 1; this.speed = 0;
    this.mask = 1;
    this.active = true;             // false while captured by a sink
    this.dead = false;              // removed during an update, compacted at its end
    this.heldBy = null;             // kickout / hole currently holding it
    this.cdisabled = false;
    /** @type {object[]} edges to ignore on the NEXT ray cast only (pass-through triggers) */
    this.remembered = [];
    /** @type {object[]} spare list swapped with `remembered` at every cast (no per-cast allocation) */
    this.altRem = [];
    this.onRamp = false;
    this.plane = null;              // ramp plane the ball is on
    this.dt = 0;
    this.nsteps = -1;               // extra sub-steps of this update (-1 = not moving)
    this.dist = 0;                  // distance to travel this update
    this.rayMax = 0;                // remaining ray length inside the current sub-step
    // stuck-ball bookkeeping (SPEC 4.12)
    this.slowTime = 0;
    this.lastX = x; this.lastY = y;
    this.stuckCount = 0;
    // debug drag
    this.grabbed = false;
    this.tx = 0; this.ty = 0;
    /** @type {{from:number, exit:number, hold:number, timer:number}|null} sink capture record */
    this.sink = null;
  }

  /** JSON-safe view (the live object references components, which reference the engine). */
  toJSON() {
    return {
      id: this.id, x: this.x, y: this.y, z: this.z, dx: this.dx, dy: this.dy, speed: this.speed, mask: this.mask, active: this.active,
      held: !!this.heldBy, onRamp: this.onRamp, plane: this.plane ? this.plane.index : null,
    };
  }

  /** Put an edge on the "already hit" list (ignored on the next cast only). SPEC 4.5 */
  remember(edge) {
    if (this.remembered.length < 16) this.remembered.push(edge);
  }
}
