/**
 * tests/frame_interp.test.mjs
 * OWNER: INTEGRATOR (final verification)
 * Render-frame interpolation in src/game.js: the simulation ticks at 120 Hz, a display frame lands between two ticks, so buildRenderFrame blends
 * each ball between its position before the last step and after it by acc/dt. Presentation only: physics.balls and snapshot() stay exact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { PHYS } from '../src/data/constants.js';
import { mulberry32 } from './helpers/seeded_rand.mjs';
import { createRig } from './helpers/bot.mjs';

const DT = PHYS.dt;

/** a scripted physics: ball 1 moves +0.1 in x per step (or jumps if `jump` is set); a ball with a new id can appear */
function fakeGame() {
  const st = { balls: [{ id: 1, x: 0, y: 0, z: 0.3, active: true }], jump: 0 };
  const physics = {
    balls: st.balls,
    step: () => { for (const b of st.balls) b.x += st.jump || 0.1; },
    drainEvents: () => [],
    snapshot: () => ({ balls: st.balls.filter((b) => b.active).map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z })) }),
  };
  const lamps = { advance: () => {}, fillView: (v) => v };
  const rules = { onPhysicsEvents: () => {}, tick: () => {}, setPaused: () => {}, getView: () => ({}) };
  const game = createGame({ factories: { createPhysics: () => physics, createLamps: () => lamps, createRules: () => rules } });
  return { game, st };
}

test('a frame that lands between two steps shows the ball between its previous and current position', () => {
  const { game, st } = fakeGame();
  game.advance(DT); game.advance(DT);                    // two steps: x 0 -> 0.1 -> 0.2, the newest step started at x = 0.1
  assert.ok(Math.abs(st.balls[0].x - 0.2) < 1e-12);
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - 0.1) < 1e-12, 'alpha 0: the position before the last step');
  game.advance(DT / 2);                                  // half a step later: no step runs
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - 0.15) < 1e-12, 'alpha 0.5: halfway');
  game.advance(DT / 4);
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - 0.175) < 1e-12, 'alpha 0.75');
  assert.ok(Math.abs(st.balls[0].x - 0.2) < 1e-12, 'the simulation itself is untouched');
  game.advance(DT / 4);                                  // the step completes: now the previous position is the old current one
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - 0.2) < 1e-12);
});

test('motion at a 144 Hz frame rate is monotonic and moves on every frame (no repeated frames)', () => {
  const { game } = fakeGame();
  game.advance(DT); game.advance(DT);
  let last = game.buildRenderFrame(0).physics.balls[0].x;
  let repeated = 0;
  for (let i = 0; i < 288; i++) {
    game.advance(1 / 144);
    const x = game.buildRenderFrame(0).physics.balls[0].x;
    assert.ok(x >= last - 1e-12, 'never moves backwards');
    if (Math.abs(x - last) < 1e-12) repeated++;
    last = x;
  }
  assert.equal(repeated, 0, 'every 144 Hz frame shows a new position although only 120 of 144 frames run a step');
});

test('a teleport (further than 1.5 units in one step) and a ball without a previous record are never blended', () => {
  const { game, st } = fakeGame();
  game.advance(DT); game.advance(DT);
  st.jump = 5;
  game.advance(DT);                                      // the ball jumps 5 units in one step
  game.advance(DT / 2);
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - st.balls[0].x) < 1e-12, 'the jump is shown as it is');
  st.jump = 0;
  st.balls.push({ id: 2, x: 3, y: 3, z: 0.3, active: true });   // appears between two steps: no previous position
  game.advance(DT / 4);
  const f = game.buildRenderFrame(0);
  assert.equal(f.physics.balls.find((b) => b.id === 2).x, 3);
});

test('a bare step() shows the newest state (hand-stepped tests and tools see the real positions)', () => {
  const { game, st } = fakeGame();
  game.step(); game.step();
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - st.balls[0].x) < 1e-12);
});

test('physics.snapshot() is always exact: a later call is not affected by an earlier blended frame', () => {
  const { game, st } = fakeGame();
  game.advance(DT); game.advance(DT); game.advance(DT / 2);
  game.buildRenderFrame(0);
  assert.ok(Math.abs(game.physics.snapshot().balls[0].x - st.balls[0].x) < 1e-12);
});

test('real game: a launched ball is drawn on the straight path between two steps, never ahead of the physics ball', () => {
  const rig = createRig({ seed: 5, newGame: true });
  const { game } = rig;
  assert.equal(game.rules.launchBall(), true);
  for (let i = 0; i < 30; i++) game.advance(DT);          // let the ball get going up the lane
  const ball = game.physics.balls.find((b) => b && b.active !== false);
  assert.ok(ball && ball.speed > 5, 'ball in flight');
  const before = { x: ball.x, y: ball.y };
  game.advance(DT);                                      // exactly one step
  const after = { x: ball.x, y: ball.y };
  game.advance(DT / 2);                                  // half a step more: no step
  const shown = game.buildRenderFrame(0).physics.balls[0];
  assert.ok(Math.abs(shown.x - (before.x + after.x) / 2) < 1e-9 && Math.abs(shown.y - (before.y + after.y) / 2) < 1e-9, 'halfway between the last two steps');
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0.01, 'the ball really moved');
});

test('pausing and resuming leaves a clean frame (no blend left over from before the pause)', () => {
  const { game, st } = fakeGame();
  game.advance(DT); game.advance(DT); game.advance(DT / 2);
  game.setPaused(true);
  game.advance(1);                                       // paused: nothing runs
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - 0.15) < 1e-12, 'a paused frame keeps its last image');
  game.setPaused(false);
  game.advance(DT);
  assert.ok(Math.abs(st.balls[0].x - 0.3) < 1e-12, 'one more step ran after the resume');
  assert.ok(Math.abs(game.buildRenderFrame(0).physics.balls[0].x - 0.2) < 1e-12, 'alpha 0 after the resume: the position before that step');
});

test('createGame with a physics that has no ball list (spy factories) still steps and renders', () => {
  const physics = { step: () => {}, drainEvents: () => [], snapshot: () => ({ balls: [] }) };
  const game = createGame({ rand: mulberry32(1), factories: { createPhysics: () => physics,
    createLamps: () => ({ advance: () => {}, fillView: (v) => v }), createRules: () => ({ onPhysicsEvents: () => {}, tick: () => {}, setPaused: () => {}, getView: () => ({}) }) } });
  game.advance(DT * 3);
  assert.deepEqual(game.buildRenderFrame(0).physics.balls, []);
});
