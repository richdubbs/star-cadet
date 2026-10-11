/**
 * src/physics/collision.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4.3; SPEC 4.7.1 (basicCollision), 4.9.6 (throwBall)
 * basicCollision(ball, hx, hy, nx, ny, e, s, T, B) -> rebound speed (normal speed before the bounce).
 * throwBall(ball, dx, dy, angleMult, m1, m2, rand, exactBug) re-launches a held/captured ball.
 *
 * A `ball` here is any object with x, y, dx, dy (unit direction), speed (and heldBy for throwBall).
 */

/**
 * The heart of the feel (SPEC 4.7.1). Moves the ball to the hit point + n*0.0005, splits the unit direction into normal and
 * tangential parts (smoothness `s` scales the tangential part, elasticity `e` the rebound part), damps only the normal speed and,
 * on a hard hit (rebound >= T), adds B along the normal. Returns the normal speed BEFORE the bounce (the "impact").
 * @returns {number}
 */
export function basicCollision(ball, hx, hy, nx, ny, e, s, T, B) {
  ball.x = hx + nx * 0.0005;
  ball.y = hy + ny * 0.0005;
  let p = -(nx * ball.dx + ny * ball.dy);        // positive = moving INTO the surface
  if (p < 0) {
    p = -p;                                      // already moving away: direction is left alone
  } else {
    const tx = ball.dx + p * nx;
    const ty = ball.dy + p * ny;
    const px = tx * s + p * nx * e;
    const py = ty * s + p * ny * e;
    const l = Math.hypot(px, py);
    if (l > 0) { ball.dx = px / l; ball.dy = py / l; }
  }
  const rebound = p * ball.speed;
  ball.speed -= (1 - e) * rebound;               // only the normal component is damped (also when moving away)
  if (rebound >= T) {
    const vx = ball.dx * ball.speed + nx * B;
    const vy = ball.dy * ball.speed + ny * B;
    const sp = Math.hypot(vx, vy);
    if (sp > 0) { ball.speed = sp; ball.dx = vx / sp; ball.dy = vy / sp; }
  }
  return rebound;
}

/**
 * Re-launch a held / captured ball (kickouts, sinks, the unstuck routine). SPEC 4.9.6. `rand` is called exactly twice (angle, then
 * speed). With `exactBug` the y component uses the ALREADY UPDATED x (a quirk of the original). The direction is NOT normalised
 * ((1,1) has length 1.414); the effective launch speed is speed * |dir|.
 * @param {{x:number,y:number,dx:number,dy:number,speed:number,heldBy?:any}} ball
 * @param {number} dx @param {number} dy @param {number} angleMult @param {number} m1 boost @param {number} m2 throwMult*0.01
 * @param {() => number} rand @param {boolean} [exactBug=true]
 */
export function throwBall(ball, dx, dy, angleMult, m1, m2, rand, exactBug = true) {
  ball.heldBy = null;
  const ang = (1 - 2 * rand()) * angleMult;
  const sin = Math.sin(ang);
  const cos = Math.cos(ang);
  const nx = dx * cos - dy * sin;
  const ny = (exactBug ? nx : dx) * sin + dy * cos;
  ball.dx = nx;
  ball.dy = ny;
  ball.speed = (1 - 2 * rand()) * (m1 * m2) + m1;
}
