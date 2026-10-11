/**
 * src/render/geom/ride.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 per-frame table (physics.plunger.pull -> rod; physics.balls -> chrome sphere), pure helper (no three).
 * The physics keeps the ball at the plunger's rest face (y = 11.675, SPEC 4.9.14) while the plunger is pulled back, so the retracted rod used to leave the
 * ball hanging a full unit above it. Visually the ball rides on the rod head: while a ball RESTS on the plunger (in the lane, at the rest face, nearly
 * still) the renderer shifts it by pull * travel along T +y (the same translation the rod gets). Pure presentation: the physics is untouched, and the
 * offset vanishes the moment the ball moves (the kick at release gives it a speed far above the limit).
 */

/** Largest speed (table units / s) at which a ball still counts as resting on the plunger. */
export const PLUNGER_REST_SPEED = 3;

/**
 * @param {{x:number, y:number, mask:number, speed:number}} ball  a physics BallSnap
 * @param {number} pull                                           physics.plunger.pull (0..1)
 * @param {{feed:number[], face:number[][]}} plunger              data.PLUNGER (feed = [x, y], face = two points at the rod head)
 * @param {number} travel                                         data.HEIGHTS.plungerTravel
 * @param {number} [radius=0.3]                                   ball radius
 * @returns {number} the T-frame y offset to add to the ball's drawn position (0 when the ball is not resting on the plunger)
 */
export function plungerRideOffset(ball, pull, plunger, travel, radius = 0.3) {
  if (!(pull > 0) || ball.mask !== 1) return 0;
  const restY = plunger.face[0][1] - radius;
  if (Math.abs(ball.x - plunger.feed[0]) > 0.15) return 0;
  if (ball.y < restY - 0.15 || ball.y > restY + 0.05) return 0;
  if (!(ball.speed <= PLUNGER_REST_SPEED)) return 0;
  return Math.min(1, pull) * travel;
}
