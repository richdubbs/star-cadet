/**
 * tests/final_regress.test.mjs
 * OWNER: INTEGRATOR (final verification)
 * Cross-module checks found while verifying the area fixes together: focus loss in attract mode, long random soaks of the composed game.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { EVENT_TYPES } from '../src/data/events.js';
import { mulberry32 } from './helpers/seeded_rand.mjs';
import { createRig } from './helpers/bot.mjs';

test('attract mode: a focus loss while the demo pulls the plunger does not strand the ball on the plunger', () => {
  const rig = createRig({ seed: 8 });
  const { game } = rig;
  game.rules.setDemo(true);
  assert.equal(rig.view.demo, true);
  let blurred = false;
  let left = false;
  for (let i = 0; i < 120 * 90 && !left; i++) {
    rig.step(1);
    const snap = game.physics.snapshot();
    if (!blurred && snap.plunger.charging) { game.rules.focusLost(); blurred = true; }
    if (blurred && game.physics.balls.some((b) => b.y < 8 && b.mask === 1)) left = true;
  }
  assert.equal(blurred, true, 'the demo pulled the plunger');
  assert.equal(left, true, 'the demo ball still left the plunger lane after the focus loss');
});

test('composed game soak: 6 seeds x 6 simulated minutes of random play, 1-3 players: no exception, no NaN, scores never fall, balls stay on the table', () => {
  const valid = new Set(EVENT_TYPES);
  for (let seed = 1; seed <= 6; seed++) {
    const game = createGame({ rand: mulberry32(seed * 7919) });
    const R = mulberry32(seed * 104729 + 11);
    const { rules, physics: p } = game;
    const view = rules.getView();
    const orig = rules.onPhysicsEvents;
    rules.onPhysicsEvents = (list) => { for (const e of list) assert.ok(valid.has(e.type), 'event type ' + e.type); return orig(list); };
    rules.newGame({ players: 1 + (seed % 3) });
    let plungeEnd = -1, cool = 0;
    const flipUntil = { left: -1, right: -1 };
    const last = {};
    for (let i = 0; i < 6 * 60 * 120; i++) {
      game.step();
      const t = game.simTime();
      if (view.namePrompt) rules.submitName('QA');
      if (view.phase === 'idle' || view.phase === 'gameOver') { if (R() < 0.01) { rules.newGame({ players: 1 + (seed % 3) }); for (const k in last) delete last[k]; } continue; }
      if (i % 4 === 0 && view.phase === 'playing' && view.score >= 0) {
        assert.ok(Number.isFinite(view.score));
        if (last[view.player] !== undefined) assert.ok(view.score >= last[view.player], `seed ${seed} t=${t.toFixed(1)}: score fell`);
        last[view.player] = view.score;
        assert.ok(view.ballNumber >= 0 && view.ballNumber <= 3);
      }
      for (const b of p.balls) {
        if (!b || b.active === false) continue;
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.speed), `seed ${seed}: NaN ball`);
        assert.ok(Math.abs(b.x) < 9 && b.y > -15 && b.y < 15.5, `seed ${seed}: ball out of bounds ${b.x},${b.y}`);
      }
      if (view.phase !== 'playing' || view.paused) continue;
      if (plungeEnd < 0 && t > cool && p.ballAtPlunger()) { rules.input('plunger', true); plungeEnd = t + 2.5 + R() * 0.3; }
      if (plungeEnd >= 0 && t > plungeEnd) { rules.input('plunger', false); plungeEnd = -1; cool = t + 1; }
      for (const b of p.balls) {
        if (!b || b.active === false || b.mask !== 1 || b.y < 9.5 || b.y > 13 || b.dy <= 0) continue;
        if (b.x > 0.2 && b.x < 3.6 && flipUntil.left < t && R() < 0.15) { rules.input('flipperLeft', true); flipUntil.left = t + 0.08 + R() * 0.5; }
        if (b.x < -0.2 && b.x > -3.6 && flipUntil.right < t && R() < 0.15) { rules.input('flipperRight', true); flipUntil.right = t + 0.08 + R() * 0.5; }
      }
      if (flipUntil.left > 0 && flipUntil.left <= t) { rules.input('flipperLeft', false); flipUntil.left = -1; }
      if (flipUntil.right > 0 && flipUntil.right <= t) { rules.input('flipperRight', false); flipUntil.right = -1; }
    }
  }
});
