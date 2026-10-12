/**
 * tests/cinematic.test.mjs
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * The cinematic camera director (src/render/cinematic.js): when a shot starts, how long it follows the ball, the 70 % slow motion, the
 * extensions for points, the early exits. Pure Node, no three.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCinematicDirector, CINEMATIC } from '../src/render/cinematic.js';

const FRAME = 1 / 60;
const ball = (o = {}) => ({ id: 1, x: 2, y: 10, z: 0.3, mask: 1, visible: true, held: false, speed: 30, ...o });
const strike = (o = {}) => ({ type: 'flipperHit', t: 0, side: 'left', ballId: 1, speed: 30, ...o });

/** A tiny world: one ball moving up the table at `vy` (sim units/s); frames advance real time `FRAME`, sim time FRAME * timeScale. */
function world(o = {}) {
  const d = createCinematicDirector(o.tune);
  d.setEnabled(o.enabled !== false);
  const w = { d, t: 0, balls: [ball(o.ball)], score: 0, player: 1, playing: true, tilted: false, paused: false, vy: o.vy ?? -20 };
  w.frame = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const sim = FRAME * d.timeScale();
      w.t += sim;
      for (const b of w.balls) b.y += w.vy * sim;
      d.update({ balls: w.balls, time: w.t, score: w.score, player: w.player, playing: w.playing, tilted: w.tilted, paused: w.paused }, FRAME);
    }
    return d.state;
  };
  return w;
}

test('cinematic: off by default; a disabled director ignores strikes and never slows the game', () => {
  const d = createCinematicDirector();
  assert.equal(d.isEnabled(), false);
  d.onPhysicsEvents([strike()]);
  const s = d.update({ balls: [ball()], time: 0, score: 0, player: 1, playing: true }, FRAME);
  assert.equal(s.active, false);
  assert.equal(d.timeScale(), 1);
});

test('cinematic: a flipper strike zooms in quickly and slows the simulation to 70 %', () => {
  const w = world();
  w.d.onPhysicsEvents([strike()]);
  w.frame();
  assert.equal(w.d.state.active, true);
  assert.equal(w.d.state.ballId, 1);
  assert.equal(w.d.state.shots, 1);
  w.frame(Math.ceil(CINEMATIC.easeIn / FRAME));
  assert.equal(w.d.state.weight, 1, 'fully zoomed in after easeIn');
  assert.ok(Math.abs(w.d.timeScale() - 0.7) < 1e-12, `time scale ${w.d.timeScale()}`);
});

test('cinematic: weak contacts and strikes on balls that are not on the table start nothing', () => {
  const w = world();
  w.d.onPhysicsEvents([strike({ speed: CINEMATIC.minStrikeSpeed - 1 }), { type: 'flipper', side: 'left', action: 'extend' }, strike({ ballId: 9 })]);
  w.frame();
  assert.equal(w.d.state.active, false);
  w.balls[0].held = true;
  w.d.onPhysicsEvents([strike()]);
  w.frame();
  assert.equal(w.d.state.active, false, 'a held ball is not followed');
});

test('cinematic: the shot lasts holdSeconds without points, then eases out and normal speed comes back', () => {
  const w = world({ vy: -2 });
  w.d.onPhysicsEvents([strike()]);
  w.frame(Math.round((CINEMATIC.holdSeconds - 0.1) / FRAME));
  assert.equal(w.d.state.active, true, 'still following just before holdSeconds');
  w.frame(Math.round(0.2 / FRAME));
  assert.equal(w.d.state.active, false, 'ended after holdSeconds');
  assert.ok(w.d.state.weight > 0, 'eases out instead of cutting');
  w.frame(Math.ceil(CINEMATIC.easeOut / FRAME) + 1);
  assert.equal(w.d.state.weight, 0);
  assert.equal(w.d.timeScale(), 1);
});

test('cinematic: every scoring moment while following extends the shot (rate limited, capped at maxSeconds)', () => {
  const w = world({ vy: -1 });
  w.d.onPhysicsEvents([strike()]);
  w.frame(30);
  const before = w.d.state.remaining;
  w.score += 1000;
  w.frame();
  assert.ok(w.d.state.remaining > before + CINEMATIC.extendSeconds - 2 * FRAME, `extended: ${before} -> ${w.d.state.remaining}`);
  // a spinner scoring every frame cannot keep the camera forever
  let frames = 0;
  while (w.d.state.active && frames < 2000) { w.score += 10; w.frame(); frames++; }
  assert.equal(w.d.state.active, false);
  assert.ok(w.d.state.elapsed <= CINEMATIC.maxSeconds + 2 * FRAME, `capped: ${w.d.state.elapsed}`);
  assert.ok(w.d.state.elapsed >= CINEMATIC.maxSeconds - 0.1, `extensions really extended: ${w.d.state.elapsed}`);
});

test('cinematic: a new player\'s score is not counted as points of the followed ball', () => {
  const w = world({ vy: -1 });
  w.d.onPhysicsEvents([strike()]);
  w.frame(10);
  const before = w.d.state.remaining;
  w.player = 2; w.score = 5000;
  w.frame();
  assert.ok(w.d.state.remaining < before, 'no extension');
});

test('cinematic: a ball falling back towards the flippers ends the shot early (after the grace time)', () => {
  const w = world({ vy: -25, ball: { y: 11 } });
  w.d.onPhysicsEvents([strike()]);
  w.frame(Math.round(0.3 / FRAME));
  assert.equal(w.d.state.active, true);
  w.vy = 12;                                                   // turns around, comes down
  w.balls[0].y = CINEMATIC.returnY - 0.5;
  w.frame(Math.round(0.2 / FRAME));
  assert.equal(w.d.state.active, false, 'ended when the falling ball passed returnY');
  assert.ok(w.d.state.elapsed < CINEMATIC.holdSeconds);
});

test('cinematic: right after the strike a low ball does not end the shot (grace), even if the estimate says falling', () => {
  const w = world({ vy: 5, ball: { y: 12 } });
  w.d.onPhysicsEvents([strike()]);
  w.frame(Math.round((CINEMATIC.returnGrace - 0.1) / FRAME));
  assert.equal(w.d.state.active, true);
});

test('cinematic: drain / capture, tilt, game stop and switching the option off end the shot', () => {
  for (const kill of [(w) => { w.balls.length = 0; }, (w) => { w.balls[0].held = true; }, (w) => { w.tilted = true; }, (w) => { w.playing = false; },
    (w) => { w.d.setEnabled(false); }]) {
    const w = world({ vy: -1 });
    w.d.onPhysicsEvents([strike()]);
    w.frame(5);
    assert.equal(w.d.state.active, true);
    kill(w);
    w.frame();
    assert.equal(w.d.state.active, false);
    w.frame(Math.ceil(CINEMATIC.easeOut / FRAME) + 1);
    assert.equal(w.d.timeScale(), 1);
  }
});

test('cinematic: a paused game freezes the shot (no time passes, nothing ends)', () => {
  const w = world({ vy: -1 });
  w.d.onPhysicsEvents([strike()]);
  w.frame(10);
  const snap = { ...w.d.state, target: { ...w.d.state.target } };
  w.paused = true;
  w.frame(600);
  assert.equal(w.d.state.active, true);
  assert.equal(w.d.state.remaining, snap.remaining);
  assert.equal(w.d.state.weight, snap.weight);
});

test('cinematic: another strike refreshes the shot; in multiball the struck ball is followed', () => {
  const w = world({ vy: -1 });
  w.balls.push(ball({ id: 2, x: -3, y: 9 }));
  w.d.onPhysicsEvents([strike()]);
  w.frame(Math.round(1.2 / FRAME));
  const left = w.d.state.remaining;
  w.d.onPhysicsEvents([strike({ ballId: 2, side: 'right', speed: 40 })]);
  w.frame();
  assert.equal(w.d.state.ballId, 2);
  assert.ok(w.d.state.remaining > left, 'refreshed');
  assert.equal(w.d.state.shots, 1, 'still the same shot');
});

test('cinematic: the camera target follows the ball smoothly (no jump), and reset() drops everything', () => {
  const w = world({ vy: 0 });
  w.d.onPhysicsEvents([strike()]);
  w.frame();
  assert.deepEqual([w.d.state.target.x, w.d.state.target.y], [2, 10]);
  w.balls[0].x = 6;                                            // teleport: the target glides, it does not jump
  w.frame();
  assert.ok(w.d.state.target.x > 2 && w.d.state.target.x < 6);
  w.frame(120);
  assert.ok(Math.abs(w.d.state.target.x - 6) < 0.01);
  w.d.reset();
  assert.equal(w.d.state.active, false);
  assert.equal(w.d.state.weight, 0);
  assert.equal(w.d.timeScale(), 1);
});

test('cinematic: the camera looks ahead of a moving ball (lead along its smoothed velocity, capped), not ahead of a resting one', () => {
  const w = world({ vy: -30 });
  w.d.onPhysicsEvents([strike()]);
  w.frame(40);
  const L = w.d.state.lead;
  assert.ok(L.y < -0.5, `leads up the table: ${L.y}`);
  assert.ok(Math.hypot(L.x, L.y) <= CINEMATIC.leadMax + 1e-9);
  const w2 = world({ vy: 0 });
  w2.d.onPhysicsEvents([strike()]);
  w2.frame(40);
  assert.ok(Math.hypot(w2.d.state.lead.x, w2.d.state.lead.y) < 1e-6);
});
