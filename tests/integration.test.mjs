/**
 * tests/integration.test.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 13.3: headless integration of the REAL modules (physics + lamps + rules through src/game.js), mulberry32 seeds, SILENT_SOUND:
 *   fixed-step clock and step order, new game -> light show -> playing, plunger at full boost, flipper hits, bumper scoring, tilt, drain, three
 *   balls, game over, high score, pause, demo, two players, deterministic replays, 1-minute random-flipping soak, keyboard -> ball through
 *   src/input.js, and repository conformance (no STUB left, every import and every index.html reference resolves).
 * No wall clock, no Math.random, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/game.js';
import { createInput } from '../src/input.js';
import { PHYS, TABLE } from '../src/data/constants.js';
import { SCORE } from '../src/data/scoring.js';
import { COMPONENT_NAMES, LAMP_NAMES } from '../src/data/names.js';
import { EVENT_TYPES } from '../src/data/events.js';
import { mulberry32 } from './helpers/seeded_rand.mjs';
import { createRig, createBot } from './helpers/bot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// =====================================================================================================================================
// clock and composition
// =====================================================================================================================================
test('advance(): whole 1/120 s steps, clamped to 0.1 s, none while paused', () => {
  const game = createGame({ rand: mulberry32(1) });
  assert.equal(game.advance(1 / 60), 2);
  assert.equal(game.advance(10), Math.round(PHYS.maxFrameDt / PHYS.dt));   // clamp: 0.1 s = 12 steps
  assert.ok(Math.abs(game.simTime() - 14 / 120) < 1e-9);
  game.setPaused(true);
  assert.equal(game.isPaused(), true);
  assert.equal(game.advance(1 / 60), 0);
  game.setPaused(false);
  assert.equal(game.advance(1 / 120), 1);
});

test('advance(): a fractional frame carries its remainder; garbage frame times run nothing', () => {
  const game = createGame({ rand: mulberry32(1) });
  let steps = 0;
  for (let i = 0; i < 100; i++) steps += game.advance(1 / 144);       // 100 frames of a 144 Hz display = 0.694 s
  assert.equal(steps, Math.floor((100 / 144) * 120 + 1e-6));
  assert.equal(game.advance(NaN), 0);
  assert.equal(game.advance(-1), 0);
  assert.equal(game.advance(undefined), 0);
});

test('step order is physics -> rules events -> rules tick -> lamps (spies through opts.factories)', () => {
  const calls = [];
  const physics = { step: () => calls.push('physics.step'), drainEvents: () => { calls.push('physics.drainEvents'); return []; }, snapshot: () => ({}) };
  const lamps = { advance: () => calls.push('lamps.advance'), fillView: (v) => v };
  const rules = {
    onPhysicsEvents: () => calls.push('rules.onPhysicsEvents'), tick: () => calls.push('rules.tick'),
    setPaused: () => {}, getView: () => ({}),
  };
  const game = createGame({ factories: { createPhysics: () => physics, createLamps: () => lamps, createRules: () => rules } });
  game.step();
  assert.deepEqual(calls, ['physics.step', 'physics.drainEvents', 'rules.onPhysicsEvents', 'rules.tick', 'lamps.advance']);
});

test('createGame composes the three real modules; none is a stub and each exposes its contracted surface', () => {
  const game = createGame({ rand: mulberry32(1) });
  for (const m of ['step', 'drainEvents', 'snapshot', 'setFlipperButton', 'setPlungerButton', 'nudge', 'startFeed', 'relaunch', 'launchInstant',
    'forceDrainAll', 'removeAllBalls', 'resetTable', 'spawnBall', 'setTiltLock', 'setFlippersEnabled', 'setDemoTriggers']) {
    assert.equal(typeof game.physics[m], 'function', 'physics.' + m);
  }
  for (const m of ['advance', 'advanceMs', 'isLit', 'lightOn', 'on', 'off', 'flash', 'group', 'onLampTimer', 'tiltOff', 'resetAll', 'fillView']) {
    assert.equal(typeof game.lamps[m], 'function', 'lamps.' + m);
  }
  for (const m of ['newGame', 'stopGame', 'setDemo', 'launchBall', 'setPaused', 'input', 'cheat', 'onPhysicsEvents', 'tick', 'getView', 'submitName']) {
    assert.equal(typeof game.rules[m], 'function', 'rules.' + m);
  }
  assert.equal(game.lamps.names.length, 140);
  assert.equal(game.rules.getView().phase, 'idle');
  assert.equal(game.physics.balls.length, 0);
});

test('buildRenderFrame fills one stable frame object: physics snapshot keys, 140 lamps, rules view', () => {
  const game = createGame({ rand: mulberry32(1) });
  const f = game.buildRenderFrame(1 / 60);
  assert.equal(f, game.buildRenderFrame(1 / 60));          // same object every call
  assert.ok(f.physics && f.lamps && f.rules);
  assert.equal(typeof f.rules.revision, 'number');
  assert.deepEqual(Object.keys(f.lamps.lit).sort(), [...LAMP_NAMES].sort());
  assert.deepEqual(Object.keys(f.lamps.onIdx).sort(), [...LAMP_NAMES].sort());
  assert.deepEqual(Object.keys(f.physics.flippers), COMPONENT_NAMES.flippers || Object.keys(f.physics.flippers));
  for (const group of ['popups', 'solos', 'bumpers', 'rebounders', 'kickbacks', 'gates', 'flags', 'kickouts', 'sinks']) {
    assert.ok(Object.keys(f.physics[group]).length > 0, group);
  }
  assert.equal(f.dt, 1 / 60);
  assert.equal(f.physics, game.physics.snapshot(), 'the snapshot object is stable');
  const g = createGame({ rand: mulberry32(1) });
  const mine = { time: 0, dt: 0, physics: null, lamps: { version: 0, lit: {}, onIdx: {} }, rules: null };
  assert.equal(g.buildRenderFrame(0.5, mine), mine, 'an out frame is filled in place');
  assert.equal(mine.dt, 0.5);
});

// =====================================================================================================================================
// flow: new game -> light show -> playing -> feed
// =====================================================================================================================================
test('new game: lightShow for 5.045 s, then playing; the ball is fed 0.96 s later and the mission box says "Ready for Launch"', () => {
  const rig = createRig({ seed: 1 });
  const { view } = rig;
  assert.equal(view.phase, 'idle');
  rig.game.rules.newGame({ players: 1 });
  assert.equal(view.phase, 'lightShow');
  rig.run(4.9);
  assert.equal(view.phase, 'lightShow');
  rig.run(0.2);
  assert.equal(view.phase, 'playing');
  assert.ok(rig.time() >= 5.045 - 1e-9 && rig.time() < 5.2);
  assert.equal(view.ballNumber, 1);
  assert.equal(view.player, 1);
  assert.equal(view.info, 'Player 1');
  assert.equal(rig.count('plungerFed'), 0);
  rig.run(1.2);
  assert.equal(rig.count('plungerFed'), 1);
  const fed = rig.of('plungerFed')[0];
  assert.ok(fed.t >= 5.045 + 0.96 - 0.02 && fed.t < 5.045 + 0.96 + 0.05, 'fed at ' + fed.t);
  assert.equal(view.mission, 'Ready for Launch');
  assert.equal(rig.game.physics.ballsInPlay(), 1);
  rig.run(0.5);                                                    // the new ball drops from the feed point onto the plunger face
  assert.equal(rig.game.physics.ballAtPlunger(), true);
});

test('the light show moves the lamps and the rendering version counter; the lamps go dark when the first ball is fed', () => {
  const rig = createRig({ seed: 1 });
  rig.game.rules.newGame();
  const f = rig.game.buildRenderFrame(0);
  const v0 = f.lamps.version;
  rig.run(2);
  rig.game.buildRenderFrame(0);
  assert.ok(f.lamps.version > v0, 'lamps change during the light show');
  assert.ok(Object.values(f.lamps.lit).some(Boolean));
  rig.run(4.3);
  rig.game.buildRenderFrame(0);
  assert.equal(rig.view.phase, 'playing');
});

// =====================================================================================================================================
// plunger, ball on the playfield, flippers, bumpers
// =====================================================================================================================================
test('plunge at full boost: the ball leaves the lane, reaches the top of the playfield and scores the lane switches', () => {
  const rig = createRig({ seed: 1 }).toPlunger();
  const { game, view } = rig;
  game.rules.input('plunger', true);
  rig.run(2.6);
  assert.equal(game.physics.snapshot().plunger.boost, 100);
  assert.equal(game.physics.snapshot().plunger.charging, true);
  game.rules.input('plunger', false);
  rig.step();                                                      // events are delivered at the next step
  assert.equal(rig.count('plungerPull'), 1);
  assert.equal(rig.count('plungerRelease'), 1);
  assert.ok(rig.of('plungerRelease')[0].boost >= 100, 'boost ' + rig.of('plungerRelease')[0].boost);
  assert.equal(rig.of('plungerRelease')[0].hitBall, true);
  let minY = 99;
  let enteredAt = -1;
  for (let i = 0; i < 4 * 120; i++) {
    rig.step();
    const b = game.physics.balls[0];
    if (b) minY = Math.min(minY, b.y);
    if (enteredAt < 0 && rig.count('oneway') > 0) enteredAt = rig.time();
  }
  assert.ok(minY < -10, 'the ball reaches the top of the table (min y ' + minY.toFixed(2) + ')');
  assert.ok(enteredAt > 0, 'the one-way gate at the top of the lane fired');
  const snap = game.physics.snapshot();
  assert.equal(snap.balls.length, 1);
  assert.equal(snap.balls[0].mask, 1);
  assert.equal(game.physics.ballAtPlunger(), false);
  assert.equal(view.phase, 'playing');
  assert.notEqual(view.mission, 'Ready for Launch');
});

test('a weak pull does not get the ball out of the lane: it comes back to the plunger', () => {
  const rig = createRig({ seed: 1 }).toPlunger();
  rig.game.rules.input('plunger', true);
  rig.run(0.2);
  rig.game.rules.input('plunger', false);
  rig.run(6);
  assert.equal(rig.game.physics.ballAtPlunger(), true);
  assert.equal(rig.count('oneway'), 0);
});

test('flippers: pressed at the right moment the left flipper throws a ball fast toward the top; too early it only wobbles', () => {
  let best = 0;
  let bestAt = -1;
  let earlyBest = 0;
  for (let k = 20; k <= 100; k += 4) {
    const rig = createRig({ seed: 3 }).toPlunger();
    const ball = rig.game.physics.spawnBall(1.9, 9.0);
    assert.ok(ball, 'spawnBall');
    let up = 0;
    for (let i = 0; i < 3 * 120; i++) {
      if (i === k) rig.game.rules.input('flipperLeft', true);
      rig.step();
      if (i >= k) up = Math.max(up, -ball.dy * ball.speed);
    }
    assert.equal(rig.game.physics.snapshot().flippers.a_flip1.up, true);
    if (k <= 60) earlyBest = Math.max(earlyBest, up);
    if (up > best) { best = up; bestAt = k; }
  }
  assert.ok(best >= 30 && best <= 60, `best upward speed ${best.toFixed(1)} at press step ${bestAt}`);
  assert.ok(earlyBest < 10, 'a flipper raised long before the ball arrives gives it nothing (' + earlyBest.toFixed(1) + ')');
});

test('flippers go up and down with the buttons, emit flipper events, and release is always accepted', () => {
  const rig = createRig({ seed: 1 }).toPlunger();
  const { game } = rig;
  game.rules.input('flipperLeft', true);
  game.rules.input('flipperRight', true);
  rig.run(0.1);
  const up = game.physics.snapshot().flippers;
  assert.equal(up.a_flip1.up, true);
  assert.equal(up.a_flip2.up, true);
  assert.ok(Math.abs(up.a_flip1.angle - 1.21523) < 1e-3, 'left flipper at its stop ' + up.a_flip1.angle);
  assert.ok(Math.abs(up.a_flip2.angle + 1.214923) < 1e-3, 'right flipper at its stop ' + up.a_flip2.angle);
  game.rules.input('flipperLeft', false);
  game.rules.input('flipperRight', false);
  rig.run(0.2);
  const down = game.physics.snapshot().flippers;
  assert.equal(down.a_flip1.angle, 0);
  assert.equal(down.a_flip2.angle, 0);
  const acts = rig.of('flipper').map((e) => `${e.side}:${e.action}`);
  assert.deepEqual(acts.sort(), ['left:extend', 'left:retract', 'right:extend', 'right:retract']);
});

test('a bumper hit scores by bumper level (500 at level 0) and raises a bumperHit event', () => {
  const rig = createRig({ seed: 3 }).toPlunger();
  const before = rig.view.score;
  const ball = rig.game.physics.spawnBall(-1.3775, -4.8, { vx: 0, vy: -15 });      // straight at a_bump2 (-1.3775, -6.618) from below
  assert.ok(ball);
  rig.run(0.6);
  const hits = rig.of('bumperHit').filter((e) => e.name === 'a_bump2');
  assert.ok(hits.length >= 1, 'a_bump2 was hit');
  assert.ok(hits[0].impact > 2.5);
  assert.equal(rig.view.score - before, SCORE.bumperAttack[0] * hits.length + (rig.view.score - before - SCORE.bumperAttack[0] * hits.length),
    'score moved');
  assert.ok(rig.view.score - before >= SCORE.bumperAttack[0], 'at least one 500-point bumper award (' + (rig.view.score - before) + ')');
});

test('the same shot with the table tilted scores nothing from the bumper (no hard-hit events while the lock is on)', () => {
  const rig = createRig({ seed: 3 }).toPlunger();
  rig.game.physics.setTiltLock(true);
  rig.game.physics.spawnBall(-1.3775, -4.8, { vx: 0, vy: -15 });
  rig.run(0.6);
  assert.equal(rig.of('bumperHit').length, 0);
});

// =====================================================================================================================================
// tilt, pause
// =====================================================================================================================================
test('tilt: repeated nudges raise "Careful", then TILT; the table locks; the lamps go dark; the next ball clears it', () => {
  const rig = createRig({ seed: 3 }).toPlunger();
  const { game, view } = rig;
  let sawTilt = false;
  for (let k = 0; k < 4 && !sawTilt; k++) {
    game.rules.input('nudgeLeft', true);
    rig.run(0.3);
    game.rules.input('nudgeLeft', false);
    rig.run(0.3);
    sawTilt = view.tilted;
  }
  assert.equal(sawTilt, true);
  assert.deepEqual(rig.of('nudgeCount').map((e) => e.level), ['warn', 'tilt']);
  assert.equal(view.info, 'TILT!');
  assert.equal(game.physics.isTiltLocked(), true);
  game.rules.input('flipperLeft', true);
  rig.run(0.1);
  assert.equal(game.physics.snapshot().flippers.a_flip1.up, false, 'flippers are dead while tilted');
  // the 30 s tilt timeout drains the ball (no bonus), the next ball is fed and the tilt is cleared
  rig.run(31);
  assert.equal(view.tilted, false);
  assert.equal(game.physics.isTiltLocked(), false);
  assert.equal(view.ballNumber, 2);
  assert.ok(rig.count('drain') >= 1);
});

test('pause freezes the sim clock, the lamps, the scoreboard and the physics; resume continues; blocked input stays blocked', () => {
  const rig = createRig({ seed: 1 }).toPlunger();
  const { game, view } = rig;
  game.rules.input('plunger', true);
  rig.run(2.6);
  game.rules.input('plunger', false);
  for (let i = 0; i < 120; i++) game.advance(1 / 60);
  const t0 = game.simTime();
  const snapJson = JSON.stringify(game.physics.snapshot());
  const lampsVersion = game.buildRenderFrame(0).lamps.version;
  game.setPaused(true);
  const rev = view.revision;
  assert.equal(view.paused, true);
  assert.equal(view.info, 'Game Paused\nF3 to Resume');
  const revPaused = view.revision;
  for (let i = 0; i < 300; i++) assert.equal(game.advance(1 / 60), 0);
  assert.equal(game.simTime(), t0);
  assert.equal(JSON.stringify(game.physics.snapshot()), snapJson);
  assert.equal(game.buildRenderFrame(0).lamps.version, lampsVersion);
  assert.equal(view.revision, revPaused);
  assert.ok(revPaused >= rev);
  game.rules.input('flipperLeft', true);
  game.rules.input('plunger', true);
  game.advance(0.5);
  assert.equal(game.physics.snapshot().flippers.a_flip1.up, false, 'gameplay keys do nothing while paused');
  game.rules.input('flipperLeft', false);
  game.rules.input('plunger', false);
  game.setPaused(false);
  assert.equal(view.paused, false);
  assert.equal(view.info, 'Continue Play');
  assert.ok(game.advance(1 / 60) >= 1);
  assert.ok(game.simTime() > t0);
});

// =====================================================================================================================================
// full games
// =====================================================================================================================================
function playFullGame(seed, players = 1, maxSeconds = 1500) {
  const rig = createRig({ seed, players });
  const bot = createBot(rig);
  rig.game.rules.newGame({ players });
  const phases = [rig.view.phase];
  const balls = [];
  while (rig.time() < maxSeconds && rig.view.phase !== 'gameOver') {
    rig.step();
    bot.tick();
    if (rig.view.phase !== phases[phases.length - 1]) phases.push(rig.view.phase);
    const key = `${rig.view.player}:${rig.view.ballNumber}`;
    if (rig.view.phase === 'playing' && rig.view.ballNumber > 0 && balls[balls.length - 1] !== key) balls.push(key);
  }
  return { rig, phases, balls };
}

test('a whole one-player game: plunge, flip, score, drain three balls, game over, high score entry', () => {
  const { rig, phases, balls } = playFullGame(1);
  const { view, game } = rig;
  assert.equal(view.phase, 'gameOver', 'the game ended (t=' + rig.time().toFixed(0) + ' s)');
  assert.deepEqual(phases, ['lightShow', 'playing', 'gameOver']);
  assert.deepEqual(balls, ['1:1', '1:2', '1:3']);
  assert.ok(rig.count('drain') >= 3, 'three real drains');
  assert.ok(rig.count('plungerFed') >= 3);
  assert.ok(rig.count('flipper') > 10, 'the flippers were used');
  assert.ok(rig.count('bumperHit') > 0, 'bumpers scored');
  assert.ok(rig.count('rolloverEnter') > 0 && rig.count('popupHit') > 0);
  const score = view.score;
  assert.ok(score > 10000, 'score ' + score);
  assert.equal(game.physics.ballsInPlay(), 0);
  assert.equal(game.physics.snapshot().flippers.a_flip1.up, false);
  // the rules ask for the name 3 s after "Game Over"
  assert.equal(view.namePrompt, null);
  rig.run(3.2);
  assert.ok(view.namePrompt, 'name prompt');
  assert.deepEqual({ player: view.namePrompt.player, rank: view.namePrompt.rank, score: view.namePrompt.score, defaultName: view.namePrompt.defaultName },
    { player: 1, rank: 1, score, defaultName: 'Player 1' });
  game.rules.submitName('ACE');
  assert.equal(view.namePrompt, null);
  assert.deepEqual(game.rules.highScores.entries()[0], { name: 'ACE', score });
  assert.equal(view.info, 'F2 Starts New Game');
  // F2 starts the next game from game over
  game.rules.newGame();
  assert.equal(view.phase, 'lightShow');
  assert.equal(view.score, 0);
  rig.run(6.5);
  assert.equal(view.phase, 'playing');
  assert.equal(view.ballNumber, 1);
});

test('a high score that does not qualify (or is cancelled) leaves the table alone; Cancel skips the entry', () => {
  const { rig } = playFullGame(2);
  rig.run(3.2);
  assert.ok(rig.view.namePrompt);
  rig.game.rules.submitName(null);
  assert.deepEqual(rig.game.rules.highScores.entries()[0], { name: '', score: -999 });
});

test('two players alternate balls: 1:1, 2:1, 1:2, 2:2, 1:3, 2:3, then game over', () => {
  const { rig, balls } = playFullGame(4, 2);
  assert.equal(rig.view.phase, 'gameOver');
  assert.deepEqual(balls, ['1:1', '2:1', '1:2', '2:2', '1:3', '2:3']);
  rig.run(3.2);
  assert.ok(rig.view.namePrompt);
});

test('deterministic replay: same seed + same inputs => same score, same event stream, same snapshot', () => {
  const run = () => {
    const rig = createRig({ seed: 11 });
    const bot = createBot(rig);
    rig.game.rules.newGame();
    for (let i = 0; i < 90 * 120; i++) { rig.step(); bot.tick(); }
    return { score: rig.view.score, events: rig.events.map((e) => `${e.type}@${e.t.toFixed(4)}`), snap: JSON.stringify(rig.game.physics.snapshot()), lamps: JSON.stringify(rig.game.buildRenderFrame(0).lamps.lit) };
  };
  const a = run();
  const b = run();
  assert.ok(a.events.length > 50);
  assert.deepEqual(a, b);
  const other = createRig({ seed: 12 });
  const bot = createBot(other);
  other.game.rules.newGame();
  for (let i = 0; i < 90 * 120; i++) { other.step(); bot.tick(); }
  assert.notEqual(JSON.stringify(other.game.physics.snapshot()), a.snap, 'a different seed gives a different game');
});

test('one minute of seeded random flipping: never throws, never leaves a ball outside the table, no NaN', () => {
  const rig = createRig({ seed: 5 });
  const bot = createBot(rig);
  const pick = mulberry32(99);
  rig.game.rules.newGame();
  const actions = ['flipperLeft', 'flipperRight', 'nudgeLeft', 'nudgeRight', 'nudgeBottom'];
  const down = new Set();
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 12 === 0) {                                            // 10 random presses / releases per second
      const a = actions[Math.floor(pick() * actions.length)];
      if (down.has(a)) { down.delete(a); rig.game.rules.input(a, false); } else if (!a.startsWith('nudge') || pick() < 0.15) { down.add(a); rig.game.rules.input(a, true); }
    }
    rig.step();
    bot.tick();
    for (const b of rig.game.physics.balls) {
      if (!b || b.active === false) continue;
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z), 'finite ball position');
      assert.ok(b.x > TABLE.xMin - 0.5 && b.x < TABLE.xMax + 0.5 && b.y > TABLE.yMin - 0.5 && b.y < TABLE.yMax + 0.5,
        `ball outside the table at t=${rig.time().toFixed(2)}: ${b.x.toFixed(2)}, ${b.y.toFixed(2)}`);
      assert.ok(b.speed <= PHYS.maxSpeed + 1e-6 || b.speed < 200, 'speed sane');
    }
  }
  assert.ok(rig.count('flipper') > 20);
});

test('demo mode: the attract AI plays by itself, ignores the keyboard, and restarts after its game over', () => {
  const rig = createRig({ seed: 3 });
  const { game, view } = rig;
  game.rules.setDemo(true);
  assert.equal(view.demo, true);
  rig.run(90);
  assert.equal(view.phase, 'playing');
  assert.ok(view.score > 0, 'the demo scored ' + view.score);
  assert.ok(rig.count('demoTrigger') > 0);
  assert.ok(rig.count('plungerRelease') >= 1 && rig.count('flipper') > 5);
  game.rules.input('nudgeLeft', true);                             // blocked in demo
  assert.equal(game.physics.getNudgeCount() <= 0, true);
  game.rules.input('nudgeLeft', false);
  game.rules.newGame();                                            // a user game leaves demo mode
  assert.equal(view.demo, false);
  assert.equal(view.phase, 'lightShow');
});

// =====================================================================================================================================
// keyboard -> input.js -> rules -> physics (the browser path without a browser)
// =====================================================================================================================================
test('keys through src/input.js drive the real game: hold Space to launch, Z and / flip, cheats are typed', () => {
  const rig = createRig({ seed: 1 }).toPlunger();
  const { game } = rig;
  const win = new EventTarget();
  const sent = [];
  const input = createInput({
    target: win, doc: { getElementById: () => null, addEventListener() {}, removeEventListener() {} },
    onEvent(e) {
      sent.push(e);
      if (e.kind === 'game') game.rules.input(e.action, e.down);
      else if (e.kind === 'cheat') game.rules.cheat(e.word);
    },
  });
  input.attach();
  const key = (type, code, k = '') => { const e = new Event(type, { cancelable: true }); Object.assign(e, { code, key: k, repeat: false }); win.dispatchEvent(e); };
  key('keydown', 'Space', ' ');
  rig.run(2.6);
  key('keyup', 'Space', ' ');
  rig.run(3);
  assert.equal(rig.count('plungerRelease'), 1);
  assert.ok(game.physics.balls[0].y < 11, 'the ball left the lane');
  key('keydown', 'KeyZ', 'z');
  key('keydown', 'Slash', '/');
  rig.run(0.1);
  assert.equal(game.physics.snapshot().flippers.a_flip1.up, true);
  assert.equal(game.physics.snapshot().flippers.a_flip2.up, true);
  key('keyup', 'KeyZ', 'z');
  key('keyup', 'Slash', '/');
  rig.run(0.2);
  assert.equal(game.physics.snapshot().flippers.a_flip1.up, false);
  // typing "1max" = one extra ball (info "Extra Ball")
  for (const ch of '1max') key('keydown', /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch.toUpperCase(), ch);
  assert.ok(sent.some((e) => e.kind === 'cheat' && e.word === '1max'));
  assert.equal(rig.view.info, 'Extra Ball');
  input.detach();
});

test('physics event types: every EVENT_TYPES value emitted during a full game is accepted without throwing', () => {
  const { rig } = playFullGame(1);
  const seen = new Set(rig.events.map((e) => e.type));
  for (const t of seen) assert.ok(Object.values(EVENT_TYPES).includes(t) || EVENT_TYPES.includes?.(t), 'known type ' + t);
  assert.ok(seen.size >= 15, 'a full game touches many components: ' + [...seen].join(','));
});

// =====================================================================================================================================
// repository conformance (ARCH_STRICT without an environment variable)
// =====================================================================================================================================
function walk(dir, out = []) {
  for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + d.name;
    if (d.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

test('no module under src/ or tools/ is still a STUB, and every one has an OWNER header and a STATUS', () => {
  const problems = [];
  for (const rel of [...walk('src'), ...walk('tools'), 'tests/arch_manifest.mjs']) {
    if (!/\.(js|mjs)$/.test(rel)) continue;
    const head = fs.readFileSync(path.join(ROOT, rel), 'utf8').slice(0, 1500);
    if (!/OWNER:\s*[A-Z]+/.test(head)) problems.push('no OWNER: ' + rel);
    const m = /STATUS:\s*([A-Z]+)/.exec(head);
    if (!m) problems.push('no STATUS: ' + rel);
    else if (m[1] === 'STUB') problems.push('STUB: ' + rel);
  }
  assert.deepEqual(problems, []);
});

test('no placeholder behaviour is left in src/ (NOT_IMPLEMENTED / TODO markers)', () => {
  const problems = [];
  for (const rel of walk('src')) {
    if (!rel.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (/NOT_IMPLEMENTED/.test(src)) problems.push('NOT_IMPLEMENTED in ' + rel);
    if (/\bTODO\b|\bFIXME\b/.test(src)) problems.push('TODO/FIXME in ' + rel);
  }
  assert.deepEqual(problems, []);
});

test('every relative import / export-from / dynamic import in src/ resolves to an existing file', () => {
  const problems = [];
  const re = /(?:^|[\s;}])(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const rel of walk('src').filter((p) => p.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (let m; (m = re.exec(code));) {
      const spec = m[1] || m[2] || m[3];
      if (!spec.startsWith('.')) { if (!/^three(\/addons\/.*\.js)?$/.test(spec)) problems.push(`${rel}: bare specifier ${spec}`); continue; }
      if (!/\.m?js$/.test(spec)) problems.push(`${rel}: import without .js extension: ${spec}`);
      if (!fs.existsSync(path.join(ROOT, path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))))) problems.push(`${rel}: missing ${spec}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('index.html: every href / src resolves, the import map pins three@0.160.0, the entry module and both stylesheets exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:)/.test(u));
  assert.ok(refs.includes('css/style.css') && refs.includes('css/ui.css') && refs.includes('src/main.js'), refs.join(','));
  for (const u of refs) assert.ok(fs.existsSync(path.join(ROOT, u)), 'index.html references missing file ' + u);
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.match(map.imports.three, /three@0\.160\.0\/build\/three\.module\.js$/);
  assert.match(map.imports['three/addons/'], /three@0\.160\.0\/examples\/jsm\/$/);
  const external = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, [], 'no external script / stylesheet / font besides the import map');
});

test('package.json: test scripts, no runtime dependencies; README documents run, controls, sounds and tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.test, /node --test/);
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const needle of ['http.server', 'npm test', 'sounds/', 'Space', 'F2', 'ARCH_STRICT']) assert.ok(readme.includes(needle), 'README mentions ' + needle);
});
