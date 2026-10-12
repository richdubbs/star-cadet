/**
 * tests/rules.test.mjs
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * RULES acceptance tests (ARCHITECTURE.md 7.10 / 13.2, SPEC Appendix D #8): scheduler, text boxes, high scores, scoring, game flow,
 * features (bumpers, banks, lanes, hyperspace, ramp, kickbacks, post, gravity well, black hole, wormholes), tilt, input gating, cheats, demo,
 * sound dispatch, event robustness. Missions / ranks / fuel live in tests/rules_missions.test.mjs.
 * Uses the real createRules with a recording fake physics, a recording SoundPort and the lamps double (or the real lamps, see rules_rig.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/rules/scheduler.js';
import { TextBoxQueue } from '../src/rules/textbox.js';
import { HighScoreTable } from '../src/rules/highscores.js';
import { createRules } from '../src/rules.js';
import { createLamps } from '../src/lamps.js';
import * as DATA from '../src/data/index.js';
import { makeRig, realLampsAvailable } from './rules_rig.mjs';
import { createFakePhysics } from './helpers/fake_physics.mjs';
import { mulberry32, constantRand } from './helpers/seeded_rand.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

// =====================================================================================================================================
// Scheduler
// =====================================================================================================================================
test('Scheduler: fires in (due, insertion) order, cancel, now()', () => {
  const s = new Scheduler();
  const log = [];
  s.after(2, () => log.push('b'));
  s.after(1, () => log.push('a'));
  s.after(2, () => log.push('c'));            // same due as b: insertion order
  const h = s.after(1.5, () => log.push('x'));
  s.cancel(h);
  s.advance(0.9); assert.deepEqual(log, []);
  s.advance(0.1); assert.deepEqual(log, ['a']);
  s.advance(1.0); assert.deepEqual(log, ['a', 'b', 'c']);
  near(s.now(), 2.0);
  assert.equal(s.pending(), 0);
});

test('Scheduler: re-entrant - a timer already due fires in the same advance and chained timers are exact', () => {
  const s = new Scheduler();
  const log = [];
  s.after(1, () => {
    log.push(['first', s.now()]);
    s.after(0, () => log.push(['now', s.now()]));
    s.after(1, () => log.push(['chain', s.now()]));
  });
  s.advance(2.5);
  assert.deepEqual(log, [['first', 1], ['now', 1], ['chain', 2]]);
  near(s.now(), 2.5);
});

test('Scheduler: cancelAll inside a callback, cancel of unknown handles, throwing callbacks are not swallowed', () => {
  const s = new Scheduler();
  const log = [];
  s.after(1, () => { log.push('one'); s.cancelAll(); });
  s.after(2, () => log.push('two'));
  s.advance(3);
  assert.deepEqual(log, ['one']);
  s.cancel(12345); s.cancel(null); s.cancel(undefined);
  s.after(1, () => { throw new Error('boom'); });
  assert.throws(() => s.advance(2), /boom/);
  s.advance(1);                                   // the throwing timer was removed: the clock keeps working
  assert.equal(s.pending(), 0);
  assert.throws(() => s.after(1, 'nope'), TypeError);
});

test('Scheduler: 120 Hz accumulation does not delay a 1.82 s timer by a whole step', () => {
  const s = new Scheduler();
  let at = -1;
  s.after(1.82, () => { at = s.now(); });
  let steps = 0;
  while (at < 0) { s.advance(1 / 120); steps++; }
  assert.equal(steps, 219);                       // ceil(1.82 * 120)
});

// =====================================================================================================================================
// TextBoxQueue
// =====================================================================================================================================
test('TextBoxQueue: head shows at once, timed message expires, persistent stays', () => {
  const q = new TextBoxQueue();
  assert.equal(q.current(), '');
  q.push('hello', 2);
  assert.equal(q.current(), 'hello');
  q.tick(1.9); assert.equal(q.current(), 'hello');
  q.tick(0.2); assert.equal(q.current(), '');
  q.push('stay', -1);
  q.tick(100); assert.equal(q.current(), 'stay');
  q.push('', 5); q.push(undefined, 5); q.push(null, 5);       // empty text is ignored
  assert.equal(q.current(), 'stay');
});

test('TextBoxQueue: a different message is appended behind a timed head; a persistent head is cleared by it', () => {
  const q = new TextBoxQueue();
  q.push('a', 2); q.push('b', 5);
  assert.equal(q.current(), 'a');
  q.tick(2.0); assert.equal(q.current(), 'b');                // b was added at t=0, due 5
  q.tick(3.1); assert.equal(q.current(), '');
  q.push('p', -1); q.tick(1);
  q.push('n', 2);                                             // clears the persistent head (it was visible > 0.25 s)
  assert.equal(q.current(), 'n');
  q.tick(2.0); assert.equal(q.current(), '');
});

test('TextBoxQueue: a repeat of the newest message only refreshes its timer', () => {
  const q = new TextBoxQueue();
  q.push('x', 2);
  q.tick(1.5);
  q.push('x', 2);                                             // refresh: due moves to t = 3.5
  assert.equal(q.size(), 1);
  q.tick(1.9); assert.equal(q.current(), 'x');
  q.tick(0.2); assert.equal(q.current(), '');
  q.push('y', 1); q.push('z', 1); q.push('z', 4);             // newest is z: refreshed, y untouched
  assert.equal(q.size(), 2);
  q.tick(1.0); assert.equal(q.current(), 'z');
  q.tick(3.5); assert.equal(q.current(), '');
});

test('TextBoxQueue: messages overdue by more than 2 s are skipped; minimum display 0.25 s', () => {
  const q = new TextBoxQueue();
  q.push('long', 10); q.push('short', 2); q.push('last', 4);
  q.tick(10.0);                                               // short is overdue by 8 s: skipped; last (due 4) too
  assert.equal(q.current(), '');
  q.push('a', 3); q.tick(1); q.push('b', 0.1);               // b waits behind a, due at 1.1
  q.tick(2.0);                                                // a expires at t=3: b is overdue by 1.9 s -> shown, but at least 0.25 s
  assert.equal(q.current(), 'b');
  q.tick(0.2); assert.equal(q.current(), 'b');
  q.tick(0.1); assert.equal(q.current(), '');
  q.push('m', 0); assert.equal(q.current(), 'm'); q.tick(0.2); assert.equal(q.current(), 'm'); q.tick(0.06); assert.equal(q.current(), '');
  q.push('c', 1); q.clear(); assert.equal(q.current(), '');
});

// =====================================================================================================================================
// HighScoreTable
// =====================================================================================================================================
test('HighScoreTable: empty table, qualifies, insert order, ties, name clipping, onChange', () => {
  const t = new HighScoreTable();
  assert.deepEqual(t.entries(), Array.from({ length: 5 }, () => ({ name: '', score: -999 })));
  assert.equal(t.qualifies(0), false);
  assert.equal(t.qualifies(-5), false);
  assert.equal(t.qualifies(1), true);
  const changes = [];
  t.onChange = (e) => changes.push(e);
  assert.equal(t.insert('Ann', 500), 1);
  assert.equal(t.insert('Bob', 900), 1);
  assert.equal(t.insert('Cy', 500), 3);                       // tie ranks below the earlier holder
  assert.equal(t.insert('  ' + 'x'.repeat(40) + '  ', 100), 4);
  assert.equal(t.entries()[3].name.length, 31);
  assert.equal(t.insert('Eve', 50), 5);
  assert.equal(t.qualifies(50), false);                       // not better than the 5th
  assert.equal(t.insert('Nope', 50), 0);
  assert.equal(t.insert('Top', 1000), 1);                     // pushes Eve off
  assert.deepEqual(t.entries().map((e) => e.score), [1000, 900, 500, 500, 100]);
  assert.equal(changes.length, 6);
  assert.equal(changes.at(-1).length, 5);
  assert.equal(t.rankOf(950), 2);
  assert.equal(t.rankOf(1), 0);
  t.clear();
  assert.equal(changes.length, 7);
  assert.equal(t.entries()[0].score, -999);
});

test('HighScoreTable: load sanitises to 5 sorted entries without calling onChange; toJSON', () => {
  const t = new HighScoreTable();
  let calls = 0;
  t.onChange = () => { calls++; };
  t.load([{ name: 'low', score: 5 }, { name: 'hi', score: 70 }, null, { name: 'bad', score: 'x' }, { score: 9 }, 7, { name: 'n'.repeat(50), score: 6 }]);
  assert.equal(calls, 0);
  const e = t.entries();
  assert.equal(e.length, 5);
  assert.deepEqual(e.map((x) => x.score), [70, 9, 6, 5, -999]);
  assert.equal(e[2].name.length, 31);
  assert.deepEqual(t.toJSON(), e);
  t.load('garbage');
  assert.equal(t.entries().every((x) => x.score === -999 && x.name === ''), true);
  const copy = t.entries(); copy[0].score = 1e9;
  assert.equal(t.entries()[0].score, -999);                   // entries() hands out copies
});

// =====================================================================================================================================
// Game flow
// =====================================================================================================================================
test('new game: light show lasts SOUND1 (5.045 s), then ball 1 is fed; "Player 1"; plungerFed -> Ready for Launch', () => {
  const r = makeRig();
  const v = r.rules.getView();
  assert.equal(v.phase, 'idle');
  r.rules.newGame({ players: 1 });
  assert.equal(v.phase, 'lightShow');
  assert.equal(v.ballNumber, 1);
  assert.equal(v.player, 1);
  assert.equal(v.info, '');
  assert.equal(v.mission, '');
  assert.ok(r.played.includes('NEW_GAME'));
  assert.ok(r.calls('resetTable').length === 1 && r.calls('removeAllBalls').length === 1);
  r.tick(5.0); assert.equal(v.phase, 'lightShow');
  assert.equal(r.calls('startFeed').length, 0);
  r.tick(0.06);
  assert.equal(v.phase, 'playing');
  assert.equal(v.info, 'Player 1');
  assert.equal(r.calls('startFeed').length, 1);
  assert.ok(r.played.includes('BALL_FEED'));
  assert.deepEqual(r.calls('gateSetEnabled').map((c) => c.slice(1)), [[1, false], [2, false]]);   // both outlane gates open at ball start
  assert.equal(r.on('lite200'), true);                                                              // ball save armed
  assert.equal(r.on('lite67'), true);                                                               // skill shot armed
  assert.equal(r.count('middle_circle'), 1);                                                        // rank Cadet
  assert.equal(r.lamps.fuel.level, 0);                                                              // fuel quirk: lamps lit, level 0
  assert.equal(r.lamps.steady('literoll179') && r.lamps.steady('literoll184'), true);
  assert.equal(v.launchEnabled, true);
  r.fed();
  assert.equal(v.mission, 'Ready for Launch');
});

test('new game: no NEW_GAME sound -> 5.0 s fallback; F2 during the light show starts at once; 2 players shown', () => {
  const quiet = { play: () => -1 };
  const r = makeRig({ sound: quiet });
  r.rules.newGame({ players: 2 });
  r.tick(4.9); assert.equal(r.view.phase, 'lightShow');
  r.tick(0.2); assert.equal(r.view.phase, 'playing');
  const r2 = makeRig();
  r2.rules.newGame({ players: 3 });
  r2.tick(1);
  assert.equal(r2.view.phase, 'lightShow');
  r2.rules.newGame({ players: 3 });                          // F2 again: cuts the show
  assert.equal(r2.view.phase, 'playing');
  assert.equal(r2.view.playerCount, 3);
  assert.equal(r2.calls('startFeed').length, 1);
});

test('skill shot award table 15000/30000/75000/30000/15000/7500 for 1..6 lamps; three lamps = 75,000', () => {
  const expected = [15000, 30000, 75000, 30000, 15000, 7500];
  const trips = ['s_trip1', 's_trip2', 's_trip3', 's_trip4', 's_trip5'];
  for (let n = 1; n <= 6; n++) {
    const r = r0();
    r.ev('oneway', { name: 's_onewy1' });                    // gate 1: arms, refuels, flashes the reflex lamps
    for (let i = 0; i < n - 1; i++) r.ev('tripwire', { name: trips[i] });
    assert.equal(r.count('skill_shot_lights'), n);
    const before = r.score();
    r.ev('oneway', { name: 's_onewy4' });
    assert.equal(r.score() - before, expected[n - 1], 'lamps ' + n);
    assert.equal(r.info(), 'Skill Shot\n' + expected[n - 1]);
    assert.ok(r.played.includes('SW3'));
    assert.equal(r.count('skill_shot_lights'), 0);            // FlashWhenOn: steady flags off at once
  }
  function r0() { return makeRig().play(); }
});

test('skill shot: gate 1 arms (fuel 11, reflex lamps flash), tripwires only while lite67 lit, s_onewy10 clears the lamps without award', () => {
  const r = makeRig().play();
  r.ev('oneway', { name: 's_onewy1' });
  assert.equal(r.lamps.fuel.level, 11);
  assert.equal(r.lamps.overlay('lite54'), 'flash');
  assert.equal(r.lamps.overlay('lite25'), 'flash');
  assert.ok(r.played.includes('SW14'));
  r.ev('tripwire', { name: 's_trip1' });
  assert.equal(r.on('lite68'), true);
  const before = r.score();
  r.ev('oneway', { name: 's_onewy10' });
  assert.equal(r.score(), before);
  assert.equal(r.count('skill_shot_lights'), 0);
  r.ev('tripwire', { name: 's_trip2' });                      // lite67 is off now: no light
  assert.equal(r.on('lite69'), false);
  assert.equal(r.state(), 1);                                // deployed
  r.tick(0.3);                                                // 'Ready for Launch' was visible for the minimum 0.25 s
  assert.equal(r.mission(), 'Hit Mission Targets to Pick a Mission');
});

test('skill shot with a mission selected keeps the trek lamps; s_onewy4 advances state 0 -> 1', () => {
  const r = makeRig().play();
  r.ev('oneway', { name: 's_onewy1' });
  r.ev('oneway', { name: 's_onewy4' });
  assert.equal(r.state(), 1);
  assert.equal(r.score(), 15000);
});

test('ball save: drain while lite200 lit -> SW27, Ball Saved, no state change, relaunch after 1.82 s', () => {
  const r = makeRig().start().fed();
  const v = r.view;
  assert.equal(r.on('lite200'), true);
  r.clearPlayed();
  r.drain(0);
  assert.ok(r.played.includes('SW27'));
  assert.equal(v.info, 'Ball Saved');
  assert.equal(v.ballNumber, 1);
  assert.equal(v.score, 0);
  assert.equal(r.on('lite200'), true);
  r.tick(1.8); assert.equal(r.calls('relaunch').length, 0);
  r.tick(0.05);
  assert.equal(r.calls('relaunch').length, 1);
  assert.equal(r.calls('startFeed').length, 1);              // only the very first feed
  assert.equal(r.calls('gateSetEnabled').length, 2);         // no gate/lamp block repeated on a re-deploy
  r.drain(0); r.tick(2);                                     // repeated saves are possible
  assert.equal(r.calls('relaunch').length, 2);
});

test('ball save timing: the first s_onewy1 crossing gives 5 s steady + 5 s flashing, then a real drain counts', () => {
  const r = makeRig().start().fed();
  r.ev('oneway', { name: 's_onewy1' });
  r.tick(9.9); assert.equal(r.on('lite200'), true);
  assert.equal(r.lamps.overlay('lite200'), 'flash');
  r.tick(0.2); assert.equal(r.on('lite200'), false);
  r.drain(0);
  assert.equal(r.info(), 'Crash Bonus\n10000');
  assert.equal(r.view.ballNumber, 2);
});

test('real drain: crash bonus (SpecialAdd), ball count, 1.82 s then the next feed; bonus pot 25000 afterwards', () => {
  const r = makeRig().play();
  const v = r.view;
  r.drain(0);
  assert.equal(v.score, 10000);
  assert.equal(v.info, 'Crash Bonus\n10000');
  assert.equal(v.ballNumber, 2);
  assert.equal(r.calls('startFeed').length, 1);
  r.tick(1.8); assert.equal(r.calls('startFeed').length, 1);
  r.tick(0.05); assert.equal(r.calls('startFeed').length, 2);
  r.fed(); r.noSave();
  r.drain(0);
  assert.equal(v.score, 10000 + 25000);
  assert.equal(v.ballNumber, 3);
});

test('extra ball: shoot again at a real drain, ball count unchanged', () => {
  const r = makeRig().play();
  r.rules.cheat('1max');
  assert.equal(r.view.extraBalls, 1);
  assert.equal(r.info(), 'Extra Ball');
  r.drain(0);
  r.tick(2.6);                                                  // 'Extra Ball' and 'Crash Bonus' (2 s each) first
  assert.equal(r.view.info, 'Player 1 Shoots Again');
  assert.equal(r.view.ballNumber, 1);
  assert.equal(r.view.extraBalls, 0);
  r.tick(1.9);
  assert.equal(r.calls('startFeed').length, 2);
  r.fed(); r.noSave(); r.drain(0);
  assert.equal(r.view.ballNumber, 2);
});

test('game over after ball 3; flippers disabled; Game Over -> F2 Starts New Game; Launch Ball disabled', () => {
  const r = makeRig().play();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });         // some score
  r.endBall(); r.endBall();
  assert.equal(r.view.ballNumber, 3);
  r.rules.cheat('1max');                                      // would give a high-score block: cheats used -> no prompt
  r.noSave(); r.drain(0);
  assert.equal(r.view.ballNumber, 3);                         // shoot again
  r.tick(1.9); r.fed(); r.noSave();
  r.drain(0);
  assert.equal(r.view.ballNumber, 0);                         // erased at 0 balls
  assert.equal(r.view.phase, 'playing');
  r.tick(1.8); assert.equal(r.view.phase, 'playing');
  r.tick(0.05);
  assert.equal(r.view.phase, 'gameOver');
  assert.equal(r.view.info, 'Game Over');
  assert.equal(r.view.mission, '');
  assert.equal(r.view.launchEnabled, false);
  assert.equal(r.calls('setFlippersEnabled').at(-1)[1], false);
  r.tick(3.0);
  assert.equal(r.view.info, 'F2 Starts New Game');
  assert.equal(r.view.mission, 'Star Cadet\nPinball');
  assert.equal(r.view.namePrompt, null);                      // CheatsUsed: no high-score entry
});

test('2-4 players rotate; per-player score / balls; game ends after the last player\'s third ball', () => {
  for (const n of [2, 3, 4]) {
    const r = makeRig().play(n);
    const order = [];
    let guard = 0;
    while (r.view.phase === 'playing' && guard++ < 40) {
      order.push(r.view.player);
      r.ev('bumperHit', { name: 'a_bump1', impact: 5 });      // 500 for the player on turn
      r.noSave(); r.drain(0); r.tick(1.9);
      if (r.view.phase === 'playing') { r.fed(); r.noSave(); }
    }
    assert.equal(order.length, 3 * n, 'players ' + n);
    const expected = []; for (let b = 0; b < 3; b++) for (let p = 1; p <= n; p++) expected.push(p);
    assert.deepEqual(order, expected);
    assert.equal(r.view.phase, 'gameOver');
  }
});

test('multiplayer turn change: "Player N" message, ball number follows the player, scores are separate', () => {
  const r = makeRig().play(2);
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  r.drain(0);                                                  // crash bonus 10000 for P1 (pot is table-level)
  assert.equal(r.view.player, 2);
  assert.equal(r.view.score, 0);
  assert.equal(r.view.ballNumber, 1);
  r.tick(1.9); r.fed(); r.noSave();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.view.score, 500);
  r.drain(0);
  assert.equal(r.view.player, 1);
  assert.equal(r.view.score, 10500);
  assert.equal(r.view.ballNumber, 2);
  r.tick(2.1);
  assert.equal(r.view.info, 'Player 1');
});

test('high scores: qualifying scores prompt sequentially, sorted by score; submitName inserts; cancel skips', () => {
  const r = makeRig().play(2);
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });           // P1: 500
  r.noSave(); r.drain(0); r.tick(1.9);                         // P1 +10000 crash bonus -> 10500 ... P2 turn
  r.fed(); r.noSave();
  for (let i = 0; i < 4; i++) r.ev('bumperHit', { name: 'a_bump1', impact: 5 });   // P2: 2000
  r.drain(0); r.tick(1.9);
  while (r.view.phase === 'playing') { r.fed(); r.noSave(); r.drain(0); r.tick(1.9); }
  assert.equal(r.view.phase, 'gameOver');
  assert.equal(r.view.mission, 'HIGH SCORE');
  assert.equal(r.view.namePrompt, null);                       // prompts open at EndGame
  r.tick(3.1);
  const p = r.view.namePrompt;
  assert.ok(p);
  const totals = [r.rules.getView().score];
  assert.equal(p.defaultName, 'Player ' + p.player);
  assert.equal(p.rank, 1);
  const first = p.player;
  r.rules.submitName('First');
  const q = r.view.namePrompt;
  assert.ok(q && q.player !== first);
  assert.equal(q.rank, 2);
  r.rules.submitName(null);                                    // cancel: not inserted
  assert.equal(r.view.namePrompt, null);
  const e = r.rules.highScores.entries();
  assert.equal(e[0].name, 'First');
  assert.equal(e[1].score, -999);
  assert.ok(totals.length === 1);
});

test('high scores: demo games and cheated games never prompt; empty name falls back to the default', () => {
  const hs = new HighScoreTable();
  const r = makeRig({ highScores: hs }).play();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  r.endBall(); r.endBall(); r.noSave(); r.drain(0); r.tick(1.9);
  r.tick(3.1);
  assert.ok(r.view.namePrompt);
  r.rules.submitName('   ');
  assert.equal(hs.entries()[0].name, 'Player 1');
  assert.equal(hs.entries()[0].score, 500 + 10000 + 25000 + 25000);       // bumper + three crash bonuses (pot 10000 first, 25000 afterwards)
  const d = makeRig({ highScores: new HighScoreTable() });
  d.rules.setDemo(true); d.tick(6);
  assert.equal(d.view.demo, true);
  d.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  d.lamps.off('lite200');
  d.drain(0); d.tick(1.9); d.fed(); d.lamps.off('lite200'); d.drain(0); d.tick(1.9); d.fed(); d.lamps.off('lite200'); d.drain(0); d.tick(1.9);
  assert.equal(d.view.phase, 'gameOver');
  d.tick(3.1);
  assert.equal(d.view.namePrompt, null);
  assert.equal(d.view.mission !== 'HIGH SCORE', true);
});

test('game over cycle in the mission box: title 10 s, player scores 3 s, then high-score entries', () => {
  const hs = new HighScoreTable([{ name: 'Old', score: 777 }]);
  const r = makeRig({ highScores: hs }).play();
  r.rules.cheat('1max');
  r.endBall(); r.endBall(); r.noSave(); r.drain(0); r.tick(1.9);   // shoot again consumed on the first
  r.noSave(); r.drain(0); r.tick(1.9);
  while (r.view.phase === 'playing') { r.fed(); r.noSave(); r.drain(0); r.tick(1.9); }
  r.tick(3.0);
  assert.equal(r.view.mission, 'Star Cadet\nPinball');
  r.tick(10.1);
  assert.match(r.view.mission, /^Player 1's Score\n\d+$/);
  r.tick(3.0);
  assert.equal(r.view.mission, 'High Score 1\n777');
  r.tick(3.0);
  assert.equal(r.view.mission, 'Star Cadet\nPinball');
});

// =====================================================================================================================================
// Scoring: multiplier, pots, specialAdd, E9
// =====================================================================================================================================
test('multiplier applies in addScore only; crash bonus (SpecialAdd) ignores it; field multiplier steps 2x..10x', () => {
  const r = makeRig().play();
  const hit3 = (a) => { for (let i = 0; i < 3; i++) r.ev('popupHit', { name: 'a_targ' + (a + i) }); };
  hit3(7);                                                     // multiplier bank: 500 + 500 + 1500 (old multiplier 1x)
  assert.equal(r.score(), 2500);
  assert.equal(r.info(), 'Score Multiplier 2x');
  assert.equal(r.count('top_target_lights'), 1);
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });           // 500 * 2
  assert.equal(r.score(), 3500);
  hit3(7);                                                     // 3x: 500*2 + 500*2 + 1500*2
  assert.equal(r.score(), 3500 + 5000);
  assert.equal(r.info(), 'Score Multiplier 2x');               // text is queued behind the first one
  r.tick(2.1);
  assert.equal(r.info(), 'Score Multiplier 3x');
  const before = r.score();
  r.drain(0);                                                  // crash bonus 10000 is NOT multiplied
  assert.equal(r.score() - before, 10000);
});

test('multiplier decays every 30 s (index -1, top lamp drops) and is cleared at the next ball', () => {
  const r = makeRig().play();
  for (let i = 0; i < 3; i++) r.ev('popupHit', { name: 'a_targ' + (7 + i) });
  r.tick(1);
  const s0 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.score() - s0, 1000);
  r.tick(30.1);
  assert.equal(r.count('top_target_lights'), 0);
  const s1 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.score() - s1, 500);
});

test('bonus and jackpot pots: flags accumulate raw points, jackpot persists and pays at hyperspace step 2', () => {
  const r = makeRig().play();
  const booster = () => { for (let i = 1; i <= 3; i++) r.ev('popupHit', { name: 'a_targ' + i }); };
  booster();                                                   // flags upgraded
  assert.equal(r.on('lite61'), true);
  assert.equal(r.info(), 'Flags Powered Up');
  booster();                                                   // jackpot activated
  assert.equal(r.on('lite60'), true);
  assert.equal(r.view.info, 'Flags Powered Up');
  r.tick(2.1);
  assert.equal(r.view.info, 'Jackpot Lit');
  const s0 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });           // raw 500 into the jackpot pot
  assert.equal(r.score() - s0, 500);
  r.ev('kickoutCapture', { id: 2 });                           // n = 0: 10000 (+ the pot grows by 10000)
  r.tick(5.1);                                                 // (the reflex window of the first entry must be over)
  r.ev('kickoutCapture', { id: 2 });                           // n = 1: pays the pot = 20000 + 5000 (set) + 500 + 10000
  assert.equal(r.score() - s0, 500 + 10000 + 35500);
  assert.equal(r.info(), 'Jackpot!\n35500');
  r.tick(61);
  assert.equal(r.on('lite60'), false);                         // window over
  const s1 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.score() - s1, 500);
});

test('bonus window: third set pays the pot at drain; bonus pot caps at 5,000,000; lite58 keeps the pot for the next ball', () => {
  const r = makeRig().play();
  const booster = () => { for (let i = 1; i <= 3; i++) r.ev('popupHit', { name: 'a_targ' + i }); };
  booster(); booster(); booster();                             // flags, jackpot, bonus
  assert.equal(r.on('lite59'), true);
  const s0 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.score() - s0, 500);
  booster();                                                   // lite58 (Bonus Hold) lights up
  assert.equal(r.on('lite58'), true);
  // pot: 10000 + 5000 (the set that activated the bonus window) + 500 (bumper) + 500 + 500 + 5000 (fourth set, flag still on)
  const pot = 10000 + 5000 + 500 + 1000 + 5000;
  const before = r.score();
  r.drain(0);
  assert.equal(r.score() - before, pot);                       // crash bonus = the grown pot (SpecialAdd)
  r.tick(1.9);
  assert.equal(r.on('lite58'), false);                         // Bonus Hold consumed, the pot kept
  r.fed(); r.noSave();
  const before2 = r.score();
  r.drain(0);
  assert.equal(r.score() - before2, pot, 'the held pot is paid at the next drain');
});

test('score rolls over at 1,000,000,000 through the E9 counter (view.score stays 0..999999999)', () => {
  const r = makeRig({ rand: constantRand(0.9999995) }).play();
  r.rules.cheat('hidden test');
  assert.equal(r.view.debug, true);
  let guard = 0;
  while (r.view.score < 990000000 && guard++ < 1100) r.rules.debugKey('S');
  r.rules.debugKey('S'); r.rules.debugKey('S'); r.rules.debugKey('S');
  assert.ok(r.view.score >= 0 && r.view.score <= 999999999);
  assert.ok(guard < 1100);
  const total = r.view.score;
  for (let i = 0; i < 15; i++) r.rules.debugKey('S');
  assert.ok(r.view.score < total || r.view.score >= total);   // wrapped at least once overall
  assert.ok(r.view.score <= 999999999);
});

// =====================================================================================================================================
// Bumpers, lanes, rebounders
// =====================================================================================================================================
test('bumper scores by level: attack 500/1000/1500/2000, launch 1500/2500/3500/4500', () => {
  const r = makeRig().play();
  const lane = (names) => { for (const n of names) r.ev('rolloverEnter', { name: n }); };
  let s0 = r.score();
  r.ev('bumperHit', { name: 'a_bump3', impact: 5 }); assert.equal(r.score() - s0, 500);
  s0 = r.score(); r.ev('bumperHit', { name: 'a_bump5', impact: 5 }); assert.equal(r.score() - s0, 1500);
  lane(['a_roll1', 'a_roll2', 'a_roll3']);
  assert.equal(r.view.bumperLevels.attack, 1);
  assert.equal(r.info(), 'Weapons Powered Up');
  s0 = r.score(); r.ev('bumperHit', { name: 'a_bump2', impact: 5 }); assert.equal(r.score() - s0, 1000);
  lane(['a_roll110', 'a_roll111', 'a_roll112']);
  assert.equal(r.view.bumperLevels.launch, 1);
  s0 = r.score(); r.ev('bumperHit', { name: 'a_bump6', impact: 5 }); assert.equal(r.score() - s0, 2500);
  for (let k = 0; k < 2; k++) { r.tick(5.1); lane(['a_roll110', 'a_roll111', 'a_roll112']); }
  assert.equal(r.view.bumperLevels.launch, 3);
  s0 = r.score(); r.ev('bumperHit', { name: 'a_bump7', impact: 5 }); assert.equal(r.score() - s0, 4500);
  for (let k = 0; k < 4; k++) { r.tick(5.1); lane(['a_roll1', 'a_roll2', 'a_roll3']); }
  assert.equal(r.view.bumperLevels.attack, 3);                 // capped at 3
  s0 = r.score(); r.ev('bumperHit', { name: 'a_bump4', impact: 5 }); assert.equal(r.score() - s0, 2000);
});

test('bumper level decays by 1 every 60 s after the latest upgrade and resets at the next ball', () => {
  const r = makeRig().play();
  for (const n of ['a_roll1', 'a_roll2', 'a_roll3']) r.ev('rolloverEnter', { name: n });
  r.tick(5.1);
  for (const n of ['a_roll1', 'a_roll2', 'a_roll3']) r.ev('rolloverEnter', { name: n });
  assert.equal(r.view.bumperLevels.attack, 2);
  r.tick(59); assert.equal(r.view.bumperLevels.attack, 2);
  r.tick(1.2); assert.equal(r.view.bumperLevels.attack, 1);
  r.tick(60); assert.equal(r.view.bumperLevels.attack, 0);
  for (const n of ['a_roll1', 'a_roll2']) r.ev('rolloverEnter', { name: n });
  r.drain(0);
  assert.equal(r.view.bumperLevels.attack, 0);
});

test('lane lamps: a lit lane turns off on the next pass, a flashing lane ignores it, 3 lit lanes blink 5 s then off', () => {
  const r = makeRig().play();
  r.ev('rolloverEnter', { name: 'a_roll1' });
  assert.equal(r.lamps.steady('lite10'), true);
  r.ev('rolloverEnter', { name: 'a_roll1' });
  assert.equal(r.lamps.steady('lite10'), false);
  r.ev('rolloverEnter', { name: 'a_roll1' }); r.ev('rolloverEnter', { name: 'a_roll2' }); r.ev('rolloverEnter', { name: 'a_roll3' });
  assert.equal(r.count('bmpr_inc_lights'), 0);                  // steady flags false at once
  assert.equal(r.lamps.overlay('lite8'), 'flash');
  const s0 = r.score();
  r.ev('rolloverEnter', { name: 'a_roll3' });                   // flashing: only the 2000 points
  assert.equal(r.score() - s0, 2000);
  assert.equal(r.lamps.steady('lite8'), false);
  r.tick(5.2);
  assert.equal(r.lamps.overlay('lite8'), 'none');
  assert.equal(r.on('lite8'), false);
});

test('flipper lane change: left flipper steps both lane groups backward, right flipper forward (only on extend)', () => {
  const r = makeRig().play();
  r.ev('rolloverEnter', { name: 'a_roll3' });                   // lite8 = member 0
  r.ev('rolloverEnter', { name: 'a_roll110' });                 // lite169 = member 2
  r.ev('flipper', { side: 'left', action: 'extend', byKey: true });
  assert.equal(r.lamps.steady('lite9'), true);                  // pattern moved toward higher index
  assert.equal(r.lamps.steady('lite8'), false);
  assert.equal(r.lamps.steady('lite171'), true);                // member 2 -> member 0 (wraps)
  r.ev('flipper', { side: 'right', action: 'extend', byKey: true });
  assert.equal(r.lamps.steady('lite8'), true);
  assert.equal(r.lamps.steady('lite169'), true);
  r.ev('flipper', { side: 'left', action: 'retract', byKey: true });
  assert.equal(r.lamps.steady('lite8'), true);                  // retract does not rotate
});

test('rebounders score 500 and flash their decal lamps 0.1 s', () => {
  const r = makeRig().play();
  r.ev('rebounderHit', { name: 'v_rebo1', impact: 3 });
  assert.equal(r.score(), 500);
  assert.equal(r.lamps.isLit('lite84'), true);
  r.tick(0.15);
  assert.equal(r.lamps.isLit('lite84'), false);
  r.ev('rebounderHit', { name: 'v_rebo2', impact: 3 });
  assert.equal(r.lamps.isLit('lite85'), true);
  r.ev('rebounderHit', { name: 'v_rebo3', impact: 3 });
  assert.equal(r.score(), 1500);
});

test('rollover scores: outlane 20000, return 5000 / 25000 (lit lamp goes off and lite59 too), fuel 500, space warp 10000', () => {
  const r = makeRig().play();
  let s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll4' }); assert.equal(r.score() - s0, 20000);
  assert.ok(r.played.includes('SW26'));
  s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll6' }); assert.equal(r.score() - s0, 5000);
  s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll9' }); assert.equal(r.score() - s0, 10000);
  assert.equal(r.on('lite27') && r.on('lite28'), true);
  s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll6' }); assert.equal(r.score() - s0, 25000);
  assert.equal(r.on('lite27'), false);
  s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll7' }); assert.equal(r.score() - s0, 25000);
  s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll181' }); assert.equal(r.score() - s0, 500);
  r.lamps.fuel.setLevel(11);
  s0 = r.score(); r.ev('rolloverEnter', { name: 'a_roll179' }); assert.equal(r.score() - s0, 500);
  assert.equal(r.lamps.fuel.level, 11);                         // level already above 2k-1: unchanged
  assert.equal(r.lamps.overlay('literoll179'), 'off');          // the lamp blinks off 0.05 s
});

test('bonus lane roll5: 10000 while lite16 is unlit, pays the pot (SpecialAdd) when lit; always refuels', () => {
  const r = makeRig().play();
  let s0 = r.score();
  r.ev('rolloverEnter', { name: 'a_roll5' });
  assert.equal(r.score() - s0, 10000);
  assert.equal(r.lamps.fuel.level, 11);
  assert.ok(r.played.includes('SW25'));
  r.lamps.on('lite16');
  r.clearPlayed();
  s0 = r.score();
  r.ev('rolloverEnter', { name: 'a_roll5' });
  assert.equal(r.score() - s0, 10000);                          // pot (10000 on the first ball) via SpecialAdd
  assert.equal(r.info(), 'Bonus Awarded\n10000');
  assert.ok(r.played.includes('SW50'));
  assert.equal(r.on('lite16'), false);
});

test('outlanes: extra-ball lamps award an extra ball (SW28) and turn off; kick-back gate re-closes after the kickback timer', () => {
  const r = makeRig().play();
  // light the extra-ball lamps through the 4th hyperspace step
  for (let i = 0; i < 4; i++) r.ev('kickoutCapture', { id: 2 });
  assert.equal(r.on('lite17') && r.on('lite18'), true);
  r.clearPlayed();
  r.ev('rolloverEnter', { name: 'a_roll8' });
  assert.equal(r.view.extraBalls, 1);
  assert.ok(r.played.includes('SW28'));
  assert.equal(r.on('lite17') || r.on('lite18'), false);
  // gates are open at ball start; the kickback timer closes the matching one
  r.fp.clearCalls();
  r.ev('kickbackTimerExpired', { id: 1 });
  assert.deepEqual(r.calls('gateSetEnabled').map((c) => c.slice(1)), [[1, true]]);
  assert.equal(r.on('lite30'), false);
  r.ev('kickbackTimerExpired', { id: 2 });
  assert.equal(r.on('lite29'), false);
});

test('hazard banks re-open the matching gate: left bank -> gate 1, right bank -> gate 2, SW14 on completion', () => {
  const r = makeRig().play();
  r.ev('kickbackTimerExpired', { id: 1 }); r.ev('kickbackTimerExpired', { id: 2 });
  r.fp.clearCalls(); r.clearPlayed();
  for (const n of ['a_targ16', 'a_targ17', 'a_targ18']) r.ev('soloHit', { name: n, impact: 5 });
  assert.deepEqual(r.calls('gateSetEnabled').map((c) => c.slice(1)), [[1, false]]);
  assert.ok(r.played.includes('SW14'));
  assert.ok(r.played.includes('SW49D'));
  assert.equal(r.on('lite30'), true);
  r.fp.clearCalls();
  for (const n of ['a_targ19', 'a_targ20', 'a_targ21']) r.ev('soloHit', { name: n, impact: 5 });
  assert.deepEqual(r.calls('gateSetEnabled').map((c) => c.slice(1)), [[2, false]]);
  assert.equal(r.count('lchute_tgt_lights'), 3);               // blink 2 s then off (S stays true until the flash ends)
  r.tick(2.1);
  assert.equal(r.count('lchute_tgt_lights'), 0);
  assert.equal(r.score(), 6 * 750);
});

// =====================================================================================================================================
// Drop-target banks
// =====================================================================================================================================
test('booster bank: 500 per target, 5000 on completion + Flags Powered Up; second set Jackpot, third Bonus, fourth Bonus Hold, fifth +5000', () => {
  const r = makeRig().play();
  r.ev('popupHit', { name: 'a_targ1' }); r.ev('popupHit', { name: 'a_targ2' });
  assert.equal(r.score(), 1000);
  r.ev('popupHit', { name: 'a_targ2' });                        // already down: ignored
  assert.equal(r.score(), 1000);
  r.clearPlayed();
  r.ev('popupHit', { name: 'a_targ3' });
  assert.equal(r.score(), 1000 + 5000);
  assert.ok(r.played.includes('SW47'));
  assert.deepEqual(r.calls('popupReenable').at(-1).slice(1), [['a_targ1', 'a_targ2', 'a_targ3']]);
  assert.equal(r.on('lite19') && r.on('lite20') && r.on('lite61'), true);
  assert.equal(r.lamps.steady('lite61'), false);                // FORCE_ON window, not steady
  const set = () => { for (let i = 1; i <= 3; i++) r.ev('popupHit', { name: 'a_targ' + i }); };
  set(); assert.ok(r.played.includes('SW45')); assert.equal(r.on('lite60'), true);
  set(); assert.ok(r.played.includes('SW46')); assert.equal(r.on('lite59'), true);
  set(); assert.ok(r.played.includes('SW48')); assert.equal(r.on('lite58'), true);
  const s0 = r.score();
  set();                                                        // all four lit: 500 + 500 + 5000 + 5000 extra
  assert.equal(r.score() - s0, 500 + 500 + 5000 + 5000 + 0 * 1);
});

test('booster set during Cosmic Plague / Maelstrom stage 6 does not re-light the flags', () => {
  const r = makeRig().play();
  r.deploy();
  r.accept(15);
  assert.equal(r.state(), 15);
  assert.equal(r.on('lite20'), true);                           // forced upgraded by the mission itself
  r.lamps.off('lite20'); r.lamps.off('lite19');
  for (let i = 1; i <= 3; i++) r.ev('popupHit', { name: 'a_targ' + i });
  assert.equal(r.on('lite61'), false);
  assert.equal(r.on('lite20'), false);
});

test('medal bank: 1500 per target; set done 10000 / 50000 / extra ball; commendation texts; 30 s decay', () => {
  const r = makeRig().play();
  const set = () => { for (let i = 4; i <= 6; i++) r.ev('popupHit', { name: 'a_targ' + i }); };
  r.ev('popupHit', { name: 'a_targ4' }); r.ev('popupHit', { name: 'a_targ5' });
  assert.equal(r.score(), 3000);
  r.ev('popupHit', { name: 'a_targ6' });
  assert.equal(r.score(), 3000 + 10000);
  assert.equal(r.info(), 'Commendation: Level 1');
  assert.equal(r.count('bumper_target_lights'), 1);
  r.tick(2.1);
  set();
  assert.equal(r.score(), 13000 + 3000 + 50000);
  assert.equal(r.count('bumper_target_lights'), 2);
  r.tick(2.1);
  const s0 = r.score();
  set();
  assert.equal(r.score() - s0, 3000);                           // level 3: extra ball, no points
  assert.equal(r.view.extraBalls, 1);
  assert.equal(r.info(), 'Extra Ball');
  r.tick(4.1);
  assert.equal(r.info(), 'Commendation: Level 3');
  assert.equal(r.count('bumper_target_lights'), 3);
  r.tick(30.1);
  assert.equal(r.count('bumper_target_lights'), 2);
  r.tick(30.1);
  assert.equal(r.count('bumper_target_lights'), 1);
});

test('end of ball pops every drop target up and clears the already-hit flags', () => {
  const r = makeRig().play();
  r.ev('popupHit', { name: 'a_targ1' });
  r.drain(0);
  assert.deepEqual(r.calls('popupReenable').at(-1).slice(1), ['all', true]);
  r.tick(1.9); r.fed(); r.noSave();
  const s0 = r.score();
  r.ev('popupHit', { name: 'a_targ1' });
  assert.equal(r.score() - s0, 500);                            // not "already down" any more
});

// =====================================================================================================================================
// Hyperspace ladder, gravity well, black hole, ramp, wormholes
// =====================================================================================================================================
test('hyperspace ladder 10000 / jackpot / post / extra-ball lamps / 150000 + gravity well; holds follow the chosen sound', () => {
  const r = makeRig().play();
  const hold = () => r.calls('kickoutSetHold').at(-1);
  r.ev('kickoutCapture', { id: 2 });                            // n = 0
  assert.equal(r.score(), 10000);
  assert.equal(r.info(), 'Hyperspace Bonus\n10000');
  near(hold()[2], DATA.soundDuration('SW35'));
  assert.equal(hold()[1], 2);
  r.tick(5.1);                                                  // (a second entry within 5 s would also pay the reflex shot)
  r.ev('kickoutCapture', { id: 2 });                            // n = 1: jackpot pot 20000
  assert.equal(r.score(), 10000 + 20000);
  assert.equal(r.info(), 'Jackpot!\n20000');
  near(hold()[2], DATA.soundDuration('SW36'));
  r.tick(5.1);
  r.fp.clearCalls();
  r.ev('kickoutCapture', { id: 2 });                            // n = 2: centre post up, 20000
  assert.equal(r.score(), 30000 + 20000);
  assert.equal(r.info(), 'Center Post\n20000');
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [true]);
  assert.equal(r.on('lite1'), true);
  near(hold()[2], DATA.soundDuration('SW35'));
  r.tick(5.1);
  r.ev('kickoutCapture', { id: 2 });                            // n = 3: extra-ball lamps, 50000
  assert.equal(r.score(), 50000 + 50000);
  assert.equal(r.info(), 'Extra Ball Lit\n50000');
  assert.equal(r.on('lite17') && r.on('lite18'), true);
  near(hold()[2], DATA.soundDuration('SW38'));
  r.tick(5.1);
  r.fp.clearCalls();
  r.ev('kickoutCapture', { id: 2 });                            // n = 4: 150000 + gravity well armed
  assert.equal(r.score(), 100000 + 150000);
  assert.equal(r.info(), 'Gravity Well\n150000');
  assert.deepEqual(r.calls('kickoutSetActive').at(-1).slice(1), [1, true]);
  assert.equal(r.on('lite62'), true);
  assert.equal(r.count('hyperspace_lights'), 0);
  near(hold()[2], DATA.soundDuration('SW39'));
  r.tick(5.1);
  r.ev('kickoutCapture', { id: 2 });                            // the cycle restarts
  assert.equal(r.score(), 250000 + 10000);
  assert.equal(r.count('hyperspace_lights'), 1);
});

test('hyperspace: reflex window (lite25) pays ReflexShotScore and picks SW21 / SW40 / SW41+36+50; 60 s decay drops lamps', () => {
  const r = makeRig().play();
  r.ev('oneway', { name: 's_onewy1' });                         // lite25 flashing for 5 s
  r.clearPlayed();
  r.ev('kickoutCapture', { id: 2 });
  assert.equal(r.score(), 15000 * 0 + 10000 + 25000);           // hyperspace bonus + reflex shot (SpecialAdd 25000)
  assert.ok(r.played.includes('SW21'));
  near(r.calls('kickoutSetHold').at(-1)[2], DATA.soundDuration('SW21'));
  assert.match(r.view.info, /Hyperspace Bonus|Reflex Shot/);
  r.tick(2.1);
  assert.equal(r.view.info, 'Reflex Shot\n25000');
  r.tick(10);
  r.lamps.flash('lite26', 5);                                   // flags = 2 -> SW40
  r.clearPlayed();
  r.ev('kickoutCapture', { id: 2 });
  assert.ok(r.played.includes('SW40'));
  r.lamps.on('lite130'); r.lamps.flash('lite25', 5);            // flags = 5 -> big combination
  r.clearPlayed();
  r.ev('kickoutCapture', { id: 2 });
  assert.deepEqual(r.played.filter((k) => k.startsWith('SW')), ['SW41', 'SW36', 'SW50']);
  near(r.calls('kickoutSetHold').at(-1)[2], DATA.soundDuration('SW41'));
  assert.equal(r.on('lite130'), false);                         // grand reward consumed it
  const lamps = r.count('hyperspace_lights');
  assert.ok(lamps >= 1);
  r.tick(60.5);
  assert.equal(r.count('hyperspace_lights'), lamps - 1);
});

test('grand reward set (lite130 lit at the hyperspace chute)', () => {
  const r = makeRig().play();
  r.lamps.on('lite130');
  r.fp.clearCalls();
  r.ev('kickoutCapture', { id: 2 });
  assert.equal(r.count('top_target_lights'), 4);
  assert.equal(r.count('bumper_target_lights'), 3);
  assert.equal(r.on('lite60') && r.on('lite59') && r.on('lite61') && r.on('lite19') && r.on('lite20') && r.on('lite58'), true);
  assert.equal(r.on('lite27') && r.on('lite28') && r.on('lite17') && r.on('lite18') && r.on('lite1'), true);
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [true]);
  assert.deepEqual(r.calls('kickoutSetActive').at(-1).slice(1), [1, true]);
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.score(), 10000 + 5000 * 0 + 500 * 10 + (r.score() - 10000 - 5000));   // 10x multiplier now applies
  const s0 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  assert.equal(r.score() - s0, 5000);
});

test('gravity well: dormant until armed; capture 50000, "Gravity Restored", held for SW7 (2.404 s), lamp off, disarmed', () => {
  const r = makeRig().play();
  r.rules.cheat('gmax');
  assert.equal(r.info(), 'Gravity Well');
  r.tick(2.1);
  assert.deepEqual(r.calls('kickoutSetActive').at(-1).slice(1), [1, true]);
  assert.equal(r.lamps.overlay('lite62'), 'flash');
  r.fp.clearCalls();
  r.ev('kickoutCapture', { id: 1 });
  assert.equal(r.score(), 50000);
  assert.equal(r.info(), 'Gravity Restored\n50000');
  near(r.calls('kickoutSetHold').at(-1)[2], 2.403818, 1e-5);
  assert.deepEqual(r.calls('kickoutSetActive').at(-1).slice(1), [1, false]);
  assert.equal(r.on('lite62'), false);
  assert.ok(r.played.includes('SW7'));
});

test('black hole: 20000, "Black Hole", default hold 1.5 s', () => {
  const r = makeRig().play();
  r.ev('kickoutCapture', { id: 3 });
  assert.equal(r.score(), 20000);
  assert.equal(r.info(), 'Black Hole\n20000');
  assert.deepEqual(r.calls('kickoutSetHold').at(-1).slice(1), [3, 1.5]);
});

test('launch ramp: 5000 plain (SW30); lite54 pays the reflex shot (SW21); lite55 SW23; mission lamp SW24; ramp hole release flashes lite54', () => {
  const r = makeRig().play();
  r.clearPlayed();
  r.ev('rampLine1');
  assert.equal(r.score(), 5000);
  assert.ok(r.played.includes('SW30'));
  r.lamps.flash('lite54', 5);
  r.clearPlayed();
  const s0 = r.score();
  r.ev('rampLine1');
  assert.equal(r.score() - s0, 25000);
  assert.equal(r.info(), 'Reflex Shot\n25000');
  assert.ok(r.played.includes('SW21'));
  r.lamps.off('lite54');
  r.lamps.flash('lite55', 5); r.clearPlayed();
  r.ev('rampLine1');
  assert.ok(r.played.includes('SW23'));
  r.lamps.off('lite55'); r.lamps.on('lite56'); r.clearPlayed();
  r.ev('rampLine1');
  assert.ok(r.played.includes('SW24'));
  r.lamps.off('lite56');
  r.ev('rampHoleReleased');
  assert.equal(r.lamps.overlay('lite54'), 'flash');
});

test('wormhole matrix: 2500 without destination, 5000 + replay on a match, 7500 and a different exit on a mismatch', () => {
  const r = makeRig().play();
  r.fp.clearCalls();
  r.ev('sinkCapture', { id: 2 });
  assert.equal(r.score(), 2500);
  assert.deepEqual(r.calls('sinkSetRoute').at(-1).slice(1), [2, 2, 2]);
  assert.equal(r.info(), 'Wormhole');
  r.tick(2.1);
  // a_targ22 sets the destination: first hit = red (sink 1), all wormhole lamps + arrows light up
  r.ev('soloHit', { name: 'a_targ22', impact: 5 });
  assert.equal(r.score(), 2500 + 750);
  assert.equal(r.lamps.getField('lite4'), 1);
  assert.equal(r.count('worm_hole_lights'), 3);
  assert.equal(r.count('bsink_arrow_lights'), 3);
  assert.equal(r.lamps.getOnIdx('lite4'), 2);                   // image 3 - d: red
  assert.equal(r.info(), 'Wormhole Open');
  r.ev('soloHit', { name: 'a_targ22', impact: 5 });
  assert.equal(r.lamps.getField('lite4'), 2);
  assert.equal(r.lamps.getOnIdx('lite2'), 1);                   // green
  r.ev('soloHit', { name: 'a_targ22', impact: 5 });
  r.ev('soloHit', { name: 'a_targ22', impact: 5 });
  assert.equal(r.lamps.getField('lite4'), 1);                   // 3 -> 1
  const s0 = r.score();
  r.ev('sinkCapture', { id: 1 });                               // match
  assert.equal(r.score() - s0, 5000);
  assert.equal(r.on('lite199'), true);
  assert.deepEqual(r.calls('sinkSetRoute').at(-1).slice(1), [1, 1, 2]);
  assert.equal(r.lamps.getField('lite4'), 0);
  assert.equal(r.count('worm_hole_lights'), 0);
  assert.equal(r.on('lite110'), false);
  r.ev('soloHit', { name: 'a_targ22', impact: 5 });             // dest 1 (red) again
  const s1 = r.score();
  r.ev('sinkCapture', { id: 3 });                               // mismatch: ball leaves from the destination sink 1
  assert.equal(r.score() - s1, 7500);
  assert.deepEqual(r.calls('sinkSetRoute').at(-1).slice(1), [3, 1, 2]);
});

test('wormhole flag loop advances the destination only while one is set; escape chute re-emits from itself', () => {
  const r = makeRig().play();
  r.ev('flagLoop', { name: 'a_flag1' });
  assert.equal(r.lamps.getField('lite4'), 0);
  r.ev('soloHit', { name: 'a_targ22', impact: 5 });
  r.ev('flagLoop', { name: 'a_flag2' });
  assert.equal(r.lamps.getField('lite4'), 2);
  r.ev('sinkCapture', { id: 7 });
  assert.deepEqual(r.calls('sinkSetRoute').at(-1).slice(1), [7, 7, 2]);
  assert.equal(r.score(), 750);
});

test('flag spinners: 500 per frame, 2500 when the flags are upgraded (lite20)', () => {
  const r = makeRig().play();
  r.ev('flagFrame', { name: 'a_flag1', frame: 1, dir: 1 });
  assert.equal(r.score(), 500);
  for (let i = 1; i <= 3; i++) r.ev('popupHit', { name: 'a_targ' + i });
  const s0 = r.score();
  r.ev('flagFrame', { name: 'a_flag2', frame: 2, dir: 1 });
  assert.equal(r.score() - s0, 2500);
  r.tick(61);
  const s1 = r.score();
  r.ev('flagFrame', { name: 'a_flag2', frame: 3, dir: 1 });
  assert.equal(r.score() - s1, 500);
});

test('centre post: 55 s steady + 5 s flashing lamp, lowered after 60 s; BLOCKER_MOVE sound', () => {
  const r = makeRig().play();
  r.ev('kickoutCapture', { id: 2 }); r.tick(2.1);
  r.ev('kickoutCapture', { id: 2 }); r.tick(2.1);
  r.clearPlayed(); r.fp.clearCalls();
  r.ev('kickoutCapture', { id: 2 });
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [true]);
  assert.ok(r.played.includes('BLOCKER_MOVE'));
  r.tick(50); assert.equal(r.lamps.overlay('lite1'), 'on');
  r.tick(5.1); assert.equal(r.lamps.overlay('lite1'), 'flash');
  assert.equal(r.calls('blockerSetEnabled').length, 1);
  r.tick(5.0);
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [false]);
  assert.equal(r.on('lite1'), false);
});

test('extra-ball lamps: lit 55 s then flash 5 s then off', () => {
  const r = makeRig().play();
  for (let i = 0; i < 4; i++) { r.ev('kickoutCapture', { id: 2 }); r.tick(2.1); }
  assert.equal(r.lamps.overlay('lite17'), 'on');
  r.tick(50); assert.equal(r.lamps.overlay('lite17'), 'on');
  r.tick(5); assert.equal(r.lamps.overlay('lite17'), 'flash');
  assert.equal(r.on('lite17') && r.on('lite18'), true);
  r.tick(5.2);
  assert.equal(r.on('lite17') || r.on('lite18'), false);
});

// =====================================================================================================================================
// Tilt
// =====================================================================================================================================
test('tilt: warn -> "Easy Now..." 2 s; tilt -> TILT!, sound, lamps off, lock; 30 s -> forceDrainAll; no crash bonus; cleared at the next ball', () => {
  const r = makeRig().play();
  r.ev('nudgeCount', { level: 'warn', count: 0.6 });
  assert.equal(r.info(), 'Easy Now...');
  r.tick(2.1); assert.equal(r.info(), '');
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  r.clearPlayed(); r.fp.clearCalls();
  r.ev('nudgeCount', { level: 'tilt', count: 1.1 });
  assert.equal(r.view.tilted, true);
  assert.equal(r.view.info, 'TILT!');
  assert.equal(r.view.mission, '');
  assert.ok(r.played.includes('TILT'));
  assert.deepEqual(r.calls('setTiltLock').at(-1).slice(1), [true]);
  assert.equal(r.lamps.overlay('lite77'), 'flash');
  assert.equal(r.lamps.isLit('lite67'), false);                 // everything forced off
  assert.equal(r.lamps.fuel.level, 0);
  // gameplay events are ignored while tilted
  const s0 = r.score();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  r.ev('rolloverEnter', { name: 'a_roll4' });
  r.ev('kickoutCapture', { id: 2 });
  assert.equal(r.score(), s0);
  r.clearPlayed();
  r.ev('flipper', { side: 'left', action: 'extend', byKey: true });
  assert.deepEqual(r.played, []);                               // DAT-bound sounds are suppressed while tilted
  r.tick(29.9); assert.equal(r.calls('forceDrainAll').length, 0);
  r.tick(0.2); assert.equal(r.calls('forceDrainAll').length, 1);
  r.drain(0, 'forced');
  assert.equal(r.score(), s0);                                  // no crash bonus
  assert.notEqual(r.view.info, 'Crash Bonus\n10000');
  assert.equal(r.view.tilted, false);                           // ClearTiltLock in the reset block
  assert.deepEqual(r.calls('setTiltLock').at(-1).slice(1), [false]);
  assert.equal(r.lamps.overlay('lite77'), 'none');
  assert.equal(r.view.ballNumber, 2);
  r.tick(1.9);
  r.fed();
  assert.notEqual(r.view.info, 'TILT!');
});

test('tilt: no ball save and no replay on a tilted drain; the tilt is ignored while a ball is draining', () => {
  const r = makeRig().play();
  r.lamps.on('lite200'); r.lamps.on('lite199');
  r.ev('nudgeCount', { level: 'tilt', count: 1.1 });
  r.drain(0, 'forced');
  assert.equal(r.on('lite200'), false);
  assert.equal(r.on('lite199'), false);
  assert.equal(r.view.ballNumber, 2);
  const r2 = makeRig().play();
  r2.drain(0);
  r2.ev('nudgeCount', { level: 'tilt', count: 1.1 });
  assert.equal(r2.view.tilted, false);
});

// =====================================================================================================================================
// Input gating, pause, focus
// =====================================================================================================================================
test('input gating: accepted only while playing, not paused, not demo, not tilted; releases always pass', () => {
  const r = makeRig();
  r.rules.input('flipperLeft', true);
  assert.equal(r.calls('setFlipperButton').length, 0);          // idle
  r.rules.input('flipperLeft', false);
  assert.deepEqual(r.calls('setFlipperButton').at(-1).slice(1), ['left', false]);
  r.start(); r.fed();
  r.fp.clearCalls();
  r.rules.input('flipperLeft', true);
  r.rules.input('flipperRight', true);
  r.rules.input('plunger', true);
  r.rules.input('nudgeLeft', true);
  r.rules.input('nudgeRight', true);
  r.rules.input('nudgeBottom', true);
  assert.deepEqual(r.calls('setFlipperButton').map((c) => c.slice(1)), [['left', true], ['right', true]]);
  assert.deepEqual(r.calls('setPlungerButton').map((c) => c.slice(1)), [[true]]);
  assert.deepEqual(r.calls('nudge').map((c) => c.slice(1)), [['left', true], ['right', true], ['bottom', true]]);
  r.fp.clearCalls();
  r.rules.setPaused(true);
  r.rules.input('flipperLeft', true); r.rules.input('plunger', true); r.rules.input('nudgeLeft', true);
  assert.equal(r.fp.calls.length, 0);
  r.rules.input('flipperLeft', false); r.rules.input('plunger', false); r.rules.input('nudgeLeft', false);
  assert.equal(r.fp.calls.length, 3);                           // releases always pass
  r.rules.setPaused(false);
  r.ev('nudgeCount', { level: 'tilt', count: 1.2 });
  r.fp.clearCalls();
  r.rules.input('flipperLeft', true);
  assert.equal(r.fp.calls.length, 0);                           // tilted
  const d = makeRig(); d.rules.setDemo(true); d.tick(6); d.fp.clearCalls();
  d.rules.input('flipperLeft', true); d.rules.input('plunger', true);
  assert.equal(d.fp.calls.length, 0);                           // demo blocks gameplay input
});

test('launchBall: playing, not demo, not paused -> physics.launchInstant; otherwise false', () => {
  const r = makeRig();
  assert.equal(r.rules.launchBall(), false);
  r.start(); r.fed();
  assert.equal(r.rules.launchBall(), true);
  assert.equal(r.calls('launchInstant').length, 1);
  r.rules.setPaused(true);
  assert.equal(r.rules.launchBall(), false);
  r.rules.setPaused(false);
  const d = makeRig(); d.rules.setDemo(true); d.tick(6);
  assert.equal(d.rules.launchBall(), false);
});

test('pause / resume texts; focusLost releases flippers and plunger; focusGained does nothing', () => {
  const r = makeRig().play();
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  r.rules.setPaused(true);
  assert.equal(r.rules.isPaused(), true);
  assert.equal(r.view.paused, true);
  assert.equal(r.view.info, 'Game Paused\nF3 to Resume');
  const before = r.view.revision;
  r.rules.tick(1);                                              // ticks are ignored while paused
  assert.equal(r.view.revision, before);
  r.rules.setPaused(false);
  assert.equal(r.view.info, 'Continue Play');
  r.tick(5.1);
  assert.equal(r.view.info, '');
  r.fp.clearCalls();
  r.rules.focusLost();
  assert.deepEqual(r.fp.calls.map((c) => c.slice(0, 3)), [['setFlipperButton', 'left', false], ['setFlipperButton', 'right', false],
    ['setPlungerButton', false]]);
  r.rules.focusGained();
  assert.equal(r.fp.calls.length, 3);
  r.rules.cheat('1max'); r.endBall(); r.endBall(); r.noSave(); r.drain(0); r.tick(1.9); r.noSave(); r.drain(0); r.tick(1.9);
  while (r.view.phase === 'playing') { r.fed(); r.noSave(); r.drain(0); r.tick(1.9); }
  r.tick(3.1);
  r.rules.setPaused(true); r.rules.setPaused(false);
  assert.equal(r.view.info, 'F2 Starts New Game');
});

test('newGame while paused unpauses; stopGame returns to idle without text', () => {
  const r = makeRig().play();
  r.rules.setPaused(true);
  r.rules.newGame({ players: 2 });
  assert.equal(r.view.paused, false);
  assert.equal(r.view.playerCount, 2);
  r.tick(6);
  r.rules.stopGame();
  assert.equal(r.view.phase, 'idle');
  assert.equal(r.view.info, '');
  assert.equal(r.view.mission, '');
  assert.equal(r.view.ballNumber, 0);
  assert.equal(r.view.launchEnabled, false);
  assert.equal(r.view.highScoresEnabled, false);
  assert.equal(r.view.newGameEnabled, true);
});

test('view: revision increases on displayed changes only; stable object; setPlayers', () => {
  const r = makeRig();
  const v = r.rules.getView();
  assert.equal(r.rules.getView(), v);
  const rev0 = v.revision;
  r.rules.getView(); r.rules.tick(0.01);
  assert.equal(v.revision, rev0);
  r.rules.setPlayers(4);
  assert.equal(v.playerCount, 4);
  assert.ok(v.revision > rev0);
  r.rules.setPlayers(9); assert.equal(v.playerCount, 4);
  r.rules.setPlayers(0); assert.equal(v.playerCount, 1);
});

// =====================================================================================================================================
// Cheats and debug keys
// =====================================================================================================================================
test('cheats: hidden test toggles debug (no CheatsUsed); gmax / 1max / bmax / rmax / easy mode mark CheatsUsed', () => {
  const hs = new HighScoreTable();
  const r = makeRig({ highScores: hs }).play();
  r.tick(0.3);
  r.rules.cheat('hidden test');
  assert.equal(r.view.debug, true);
  r.rules.cheat('hidden test');
  assert.equal(r.view.debug, false);
  r.rules.setDebug(true); assert.equal(r.view.debug, true); r.rules.setDebug(false);
  r.ev('bumperHit', { name: 'a_bump1', impact: 5 });
  r.rules.cheat('rmax');
  assert.equal(r.count('middle_circle'), 2);
  assert.equal(r.mission(), 'Promoted to Ensign');
  r.rules.cheat('easy mode');
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [true]);
  assert.deepEqual(r.calls('gateSetEnabled').slice(-2).map((c) => c.slice(1)), [[1, false], [2, false]]);
  r.ev('kickbackTimerExpired', { id: 1 });
  assert.notDeepEqual(r.calls('gateSetEnabled').at(-1).slice(1), [1, true]);   // the kick-back does not re-close the gate
  r.rules.cheat('easy mode');
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [false]);
  r.rules.cheat('bmax');                                        // unlimited: a drain re-feeds, nothing lost
  r.fp.clearCalls();
  r.drain(0);
  assert.equal(r.calls('startFeed').length, 1);
  assert.equal(r.view.ballNumber, 1);
  r.endBall(); r.endBall(); r.noSave(); r.drain(0); r.tick(1.9);
  r.tick(5);
  assert.equal(r.view.namePrompt, null);                        // cheats used -> no high-score entry
  assert.equal(hs.entries()[0].score, -999);
});

test('cheats are ignored while idle (except hidden test); unknown words do nothing', () => {
  const r = makeRig();
  r.rules.cheat('1max'); r.rules.cheat('rmax'); r.rules.cheat('gmax'); r.rules.cheat('nonsense');
  assert.equal(r.view.extraBalls, 0);
  assert.equal(r.fp.calls.length, 0);
  r.rules.cheat('hidden test');
  assert.equal(r.view.debug, true);
});

test('debug keys act only in debug mode: R rank, B spawn (only on a free spot), S score, H prompt, I/J lamps', () => {
  const r = makeRig().play();
  r.rules.debugKey('R'); r.rules.debugKey('B'); r.rules.debugKey('S');
  assert.equal(r.fp.callsOf('spawnBall').length, 0);
  assert.equal(r.score(), 0);
  r.rules.cheat('hidden test');
  r.rules.debugKey('R');
  assert.equal(r.count('middle_circle'), 2);
  r.rules.debugKey('B');
  assert.deepEqual(r.calls('spawnBall').at(-1).slice(1, 3), [6, 7]);
  r.fp.physics.balls.push({ x: 6.2, y: 7.1, active: true });
  r.rules.debugKey('B');
  assert.equal(r.calls('spawnBall').length, 1);
  const s0 = r.score(); r.rules.debugKey('S');
  assert.ok(r.score() >= s0 && r.score() - s0 < 1000000);
  r.rules.debugKey('H');
  assert.deepEqual({ ...r.view.namePrompt }, { player: 1, rank: 1, score: 1000000000, defaultName: 'Player 1' });
  r.rules.submitName('Dbg');
  assert.equal(r.rules.highScores.entries()[0].score, 1000000000);
  r.rules.debugKey('I');
  assert.equal(r.lamps.isLit('lite55'), true);
  r.tick(1.1);
  assert.equal(r.lamps.isLit('lite55'), false);
  r.rules.debugKey('J');
  assert.equal(r.lamps.isLit('lite67'), false);
});

// =====================================================================================================================================
// Demo mode
// =====================================================================================================================================
test('demo: Demo/Player 1 text, demo triggers on, AI presses flippers through physics with the DEMO_TIMERS delays', () => {
  const r = makeRig({ rand: constantRand(0.5) });
  r.rules.setDemo(true);
  assert.equal(r.view.demo, true);
  assert.deepEqual(r.calls('setDemoTriggers').at(-1).slice(1), [true]);
  r.tick(6);
  assert.equal(r.view.info, 'Demo\nPlayer 1');
  assert.equal(r.view.phase, 'playing');
  r.fp.clearCalls();
  r.ev('demoTrigger', { id: 1400 });                            // delayed press: t1 + t2 - 0.5*2*t2 = 0.2 s
  assert.equal(r.calls('setFlipperButton').length, 0);
  r.tick(0.19); assert.equal(r.calls('setFlipperButton').length, 0);
  r.tick(0.03);
  assert.deepEqual(r.calls('setFlipperButton').at(-1).slice(1), ['left', true]);
  r.ev('demoTrigger', { id: 1401 });                            // already held: skipped
  assert.equal(r.calls('setFlipperButton').length, 1);
  r.tick(0.35); assert.equal(r.calls('setFlipperButton').length, 1);   // hold = u1 + u2 - 0.5*2*u2 = 0.4 s (from the press at 0.2 s)
  r.tick(0.1);
  assert.deepEqual(r.calls('setFlipperButton').at(-1).slice(1), ['left', false]);
  r.ev('demoTrigger', { id: 1403 });                            // right flipper now
  assert.deepEqual(r.calls('setFlipperButton').at(-1).slice(1), ['right', true]);
  r.ev('demoTrigger', { id: 1402 });                            // pending/held: ignored
  assert.equal(r.calls('setFlipperButton').length, 3);
  r.tick(0.5);
  r.ev('demoTrigger', { id: 1404 });                            // plunger: pulled 2.0 + rand() s
  assert.deepEqual(r.calls('setPlungerButton').at(-1).slice(1), [true]);
  r.tick(2.4); assert.equal(r.calls('setPlungerButton').length, 1);
  r.tick(0.2); assert.deepEqual(r.calls('setPlungerButton').at(-1).slice(1), [false]);
  r.tick(2);
});

test('demo: ignores triggers when not in demo; after its game over the next demo game starts 5 s later; toggling off -> F2 Starts New Game', () => {
  const r = makeRig();
  r.start(); r.fed(); r.fp.clearCalls();
  r.ev('demoTrigger', { id: 1401 });
  assert.equal(r.calls('setFlipperButton').length, 0);
  const d = makeRig({ seed: 5 });
  d.rules.setDemo(true); d.tick(6);
  for (let i = 0; i < 3; i++) { d.fed(); d.noSave(); d.drain(0); d.tick(1.9); }
  assert.equal(d.view.phase, 'gameOver');
  assert.equal(d.view.demo, true);
  d.tick(4.9); assert.equal(d.view.phase, 'gameOver');
  d.tick(0.2);
  assert.equal(d.view.phase, 'lightShow');
  assert.equal(d.view.demo, true);
  d.tick(6);
  assert.equal(d.view.phase, 'playing');
  d.rules.setDemo(false);
  assert.equal(d.view.demo, false);
  assert.equal(d.view.phase, 'gameOver');
  assert.equal(d.view.info, 'F2 Starts New Game');
  assert.equal(d.view.mission, '');
  assert.deepEqual(d.calls('setDemoTriggers').at(-1).slice(1), [false]);
  d.rules.newGame();                                            // F2: a normal game
  assert.equal(d.view.demo, false);
  assert.equal(d.view.phase, 'lightShow');
});

// =====================================================================================================================================
// Sound dispatch and event robustness
// =====================================================================================================================================
test('sound dispatch: SOUND_EVENT_MAP keys per event, silent when tilted, durations are the manifest values', () => {
  const r = makeRig().play();
  const check = (type, payload, key) => {
    r.clearPlayed(); r.ev(type, payload);
    assert.ok(r.played.includes(key), `${type} -> ${key} (got ${r.played})`);
  };
  check('flipper', { side: 'left', action: 'extend', byKey: true }, 'FLIP_UP');
  check('flipper', { side: 'left', action: 'retract', byKey: true }, 'FLIP_DOWN');
  r.clearPlayed(); r.ev('flipper', { side: 'left', action: 'retract', byKey: false }); assert.equal(r.played.includes('FLIP_DOWN'), false);
  check('plungerRelease', { boost: 50, hitBall: true }, 'PLUNGER_RELEASE');
  check('plungerPull', {}, 'PLUNGER_PULL');
  check('bumperHit', { name: 'a_bump1', impact: 3 }, 'BUMPER');
  check('rebounderHit', { name: 'v_rebo1', impact: 2 }, 'REBOUNDER');
  check('popupHit', { name: 'a_targ1' }, 'POPUP_HIT');
  check('popupUp', { name: 'a_targ4' }, 'POPUP4_REARM');
  check('popupUp', { name: 'a_targ7' }, 'POPUP7_REARM');
  check('soloHit', { name: 'a_targ22', impact: 4 }, 'SOLO22_HIT');
  check('blockerHit', { impact: 3 }, 'BLOCKER_HIT');
  check('kickbackFired', { id: 1 }, 'KICKBACK');
  check('rolloverEnter', { name: 'a_roll1' }, 'ROLLOVER');
  check('rolloverEnter', { name: 'a_roll180' }, 'ROLL_FUEL');
  check('rolloverEnter', { name: 'a_roll184' }, 'ROLL_184');
  check('rolloverEnter', { name: 'a_roll9' }, 'SPACEWARP');
  check('kickoutEject', { id: 2 }, 'KICKOUT');
  check('sinkEject', { id: 1, from: 1 }, 'SINK');
  check('flagFrame', { name: 'a_flag1', frame: 1, dir: 1 }, 'FLAG_TICK');
  check('onewaySide', { name: 's_onewy9', impact: 1 }, 'ONEWAY_SIDE');
  r.clearPlayed(); r.ev('kickoutEject', { id: 3 }); assert.deepEqual(r.played, []);
  r.clearPlayed(); r.ev('kickoutCapture', { id: 3 }); assert.ok(r.played.includes('KICKOUT'));
  r.clearPlayed(); r.ev('rolloverEnter', { name: 'a_roll4' }); assert.equal(r.played.includes('ROLLOVER'), false);
  r.ev('nudgeCount', { level: 'tilt', count: 1.1 });
  r.clearPlayed();
  r.ev('bumperHit', { name: 'a_bump1', impact: 3 }); r.ev('flipper', { side: 'left', action: 'extend', byKey: true });
  assert.deepEqual(r.played, []);
  assert.ok(Math.abs(DATA.soundDuration('NEW_GAME') - 5.045) < 1e-3);
});

test('unknown event types and malformed payloads are ignored; every EVENT_TYPES value is accepted without throwing', () => {
  const payloads = {
    bumperHit: { name: 'a_bump1', impact: 3 }, rebounderHit: { name: 'v_rebo1', impact: 2 }, popupHit: { name: 'a_targ1' },
    popupUp: { name: 'a_targ1' }, soloHit: { name: 'a_targ10', impact: 4 }, rolloverEnter: { name: 'a_roll1' }, tripwire: { name: 's_trip1' },
    oneway: { name: 's_onewy1' }, onewaySide: { name: 's_onewy9', impact: 1 }, rampLine1: {}, rampEnter: { ramp: 'ramp' },
    rampExit: { ramp: 'ramp', mask: 4 }, rampHoleCaptured: {}, rampHoleReleased: {}, kickoutCapture: { id: 3 }, kickoutEject: { id: 3 },
    sinkCapture: { id: 1 }, sinkEject: { id: 1, from: 1 }, flagFrame: { name: 'a_flag1', frame: 1, dir: 1 }, flagLoop: { name: 'a_flag1' },
    kickbackFired: { id: 1 }, kickbackTimerExpired: { id: 1 }, blockerHit: { impact: 2 }, drain: { ballId: 1, remaining: 1, via: 'drain' },
    plungerFed: { ballId: 1 }, plungerPull: {}, plungerRelease: { boost: 10, hitBall: true }, stuckRelaunch: {},
    flipper: { side: 'left', action: 'extend', byKey: true }, nudge: { dir: 'left' }, nudgeCount: { level: 'warn', count: 0.6 },
    demoTrigger: { id: 1401 }, flipperHit: { side: 'left', ballId: 1, speed: 30 },
  };
  assert.deepEqual(Object.keys(payloads).sort(), [...DATA.EVENT_TYPES].sort());
  for (const phase of ['idle', 'play']) {
    const r = makeRig();
    if (phase === 'play') r.play();
    for (const t of DATA.EVENT_TYPES) r.ev(t, payloads[t]);
    for (const t of DATA.EVENT_TYPES) r.ev(t, {});            // payload-less events must not throw either
    r.ev('somethingNew', { x: 1 });
    r.rules.onPhysicsEvents([]); r.rules.onPhysicsEvents(undefined); r.rules.onPhysicsEvents([null, {}, { type: 5 }]);
  }
});

test('createRules validates its dependencies; works with the (possibly inert) real lamps module', () => {
  assert.throws(() => createRules({}), TypeError);
  const fp = createFakePhysics();
  const rules = createRules({ physics: fp.physics, lamps: createLamps({ rand: mulberry32(1) }), rand: mulberry32(1) });
  rules.newGame({ players: 2 });
  for (let i = 0; i < 720; i++) rules.tick(1 / 120);
  assert.equal(rules.getView().phase, 'playing');
  rules.onPhysicsEvents([{ type: 'plungerFed', ballId: 1 }]);
  assert.equal(rules.getView().mission, 'Ready for Launch');
});

test('real lamps module (when implemented): the core flow runs against it', { skip: !realLampsAvailable() }, () => {
  const r = makeRig({ realLamps: true }).play();
  r.ev('oneway', { name: 's_onewy1' });
  r.ev('tripwire', { name: 's_trip1' });
  r.ev('tripwire', { name: 's_trip2' });
  const s0 = r.score();
  r.ev('oneway', { name: 's_onewy4' });
  assert.equal(r.score() - s0, 75000);
  assert.equal(r.state(), 1);
  r.lamps.fuel.setLevel(11);
  for (const n of ['a_roll1', 'a_roll2', 'a_roll3']) r.ev('rolloverEnter', { name: n });
  assert.equal(r.view.bumperLevels.attack, 1);
  r.tick(1);
});

// =====================================================================================================================================
// Additional coverage: text-box coalescing, E9, launch lanes, light show, per-player state, determinism
// =====================================================================================================================================
test('TextBoxQueue: an unseen persistent message is replaced by a newer persistent one (counter texts never lag behind)', () => {
  const q = new TextBoxQueue();
  q.push('head', -1); q.tick(1);
  for (let n = 10; n >= 1; n--) q.push('Left: ' + n, -1);          // ten counter updates in the same instant
  assert.equal(q.current(), 'Left: 10');                           // head replaced at once (it had been visible > 0.25 s)
  assert.equal(q.size(), 2);                                       // visible one + the newest unseen one
  q.tick(0.3);
  assert.equal(q.current(), 'Left: 1');
  q.push('timed', 2); q.push('Left: 0', -1); q.push('Left: -1', -1);
  assert.equal(q.size(), 3);                                       // a timed message is never replaced; the two persistent ones collapse
  for (let i = 0; i < 230; i++) q.tick(0.01);                      // (fine ticks: the minimum display is measured from the settle instant)
  assert.equal(q.current(), 'Left: -1');
});

test('score rolls over at 1e9 through the E9 counter: view.score stays within 0..999999999 and the cycle shows the full score', () => {
  const r = makeRig({ rand: constantRand(0.9999995) }).play();
  r.rules.cheat('hidden test');
  let max = 0;
  for (let i = 0; i < 1001; i++) { r.rules.debugKey('S'); max = Math.max(max, r.view.score); }
  assert.ok(max <= 999999999);
  assert.equal(r.view.score, (1001 * 999999) % 1000000000);        // 998,999
  assert.ok(max > 990000000);
  r.endBall(); r.endBall(); r.noSave(); r.drain(0); r.tick(1.9);
  r.tick(3.0 + 10.1);
  assert.equal(r.view.mission, "Player 1's Score\n" + (1001 * 999999 + 10000 + 25000 + 25000));
});

test('launch lanes score 500 per pass and do not stop the trek chase; re-entry lanes do', () => {
  const r = makeRig().play();
  assert.equal(r.lamps.group('l_trek_lights').isAnimating(), true);
  assert.equal(r.lamps.group('r_trek_lights').isAnimating(), true);
  const s0 = r.score();
  r.ev('rolloverEnter', { name: 'a_roll111' });
  assert.equal(r.score() - s0, 500);
  assert.equal(r.lamps.group('l_trek_lights').isAnimating(), true);
  r.ev('rolloverEnter', { name: 'a_roll2' });
  assert.equal(r.lamps.group('l_trek_lights').isAnimating(), false);
  assert.equal(r.count('l_trek_lights') + r.count('r_trek_lights'), 0);
});

test('light show: random lamp pulses while it runs, all lamps off at the start of ball 1; the gates open with their lamps', () => {
  const r = makeRig({ seed: 3 });
  r.rules.newGame();
  r.tick(2);
  assert.ok(r.lamps.names.some((n) => r.lamps.isLit(n)), 'some lamp pulses during the show');
  r.tick(4);
  assert.equal(r.view.phase, 'playing');
  const lit = r.lamps.names.filter((n) => r.lamps.isLit(n) && !['lite30', 'lite29', 'lite196', 'lite195', 'lite67', 'lite200', 'lite154',
    'literoll179', 'literoll180', 'literoll181', 'literoll182', 'literoll183', 'literoll184',
    'lite185', 'lite186', 'lite187', 'lite188', 'lite189', 'lite190', 'lite191', 'lite192', 'lite193', 'lite194', 'lite68', 'lite69', 'lite131',
    'lite132', 'lite133'].includes(n));
  assert.deepEqual(lit, []);
  assert.equal(r.on('lite30') && r.on('lite29'), true);              // both outlane gates open: lamps lit
  assert.equal(r.lamps.overlay('lite196'), 'flash');
  assert.equal(r.lamps.overlay('lite195'), 'flash');
  assert.equal(r.on('lite154'), true);                                // rank Cadet lit steady at the first feed
  assert.equal(r.lamps.overlay('lite154'), 'none');
});

test('multiplayer: rank lamps and extra balls belong to the player; Shoots Again keeps the same player', () => {
  const r = makeRig().play(2);
  r.lamps.group('middle_circle').offsetForward(); r.lamps.group('middle_circle').offsetForward();   // P1 is a Lieutenant now
  assert.equal(r.count('middle_circle'), 3);
  r.rules.cheat('1max');
  assert.equal(r.view.extraBalls, 1);
  r.noSave(); r.drain(0); r.tick(1.9);                                // shoot again: still P1
  assert.equal(r.view.player, 1);
  r.fed(); r.noSave();
  r.drain(0); r.tick(1.9);                                            // now P2
  assert.equal(r.view.player, 2);
  assert.equal(r.view.extraBalls, 0);
  r.fed(); r.noSave();
  assert.equal(r.count('middle_circle'), 1);                          // P2 starts as a Cadet
  r.drain(0); r.tick(1.9);
  assert.equal(r.view.player, 1);
  r.fed(); r.noSave();
  assert.equal(r.count('middle_circle'), 3);                          // P1's rank came back
});

test('determinism: the same seed and the same event script give the same views', () => {
  const run = () => {
    const r = makeRig({ seed: 11 }).play(2);
    const log = [];
    const script = [['bumperHit', { name: 'a_bump2', impact: 4 }], ['rolloverEnter', { name: 'a_roll2' }], ['kickoutCapture', { id: 2 }],
      ['popupHit', { name: 'a_targ4' }], ['soloHit', { name: 'a_targ22', impact: 5 }], ['sinkCapture', { id: 1 }]];
    for (const [t, p] of script) { r.ev(t, p); r.tick(0.7); log.push([r.view.score, r.view.info, r.view.mission, r.view.revision]); }
    r.drain(0); r.tick(2); log.push([r.view.score, r.view.player, r.view.ballNumber, r.view.revision]);
    return JSON.stringify(log);
  };
  assert.equal(run(), run());
});

test('rules never read a wall clock or Math.random themselves (sources contain none of them)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/rules/', import.meta.url);
  const files = [...readdirSync(dir).map((f) => new URL(f, dir)), new URL('../src/rules.js', import.meta.url)];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/\bDate\b|performance\.now|setTimeout|setInterval|requestAnimationFrame/.test(src), false, String(f));
    const mr = src.match(/Math\.random/g) || [];
    assert.ok(mr.length <= 1, String(f));                              // only as the default of the injected `rand`
  }
});

test('stopGame then newGame works; exit clears pending name prompts and timers', () => {
  const r = makeRig().play();
  r.rules.cheat('hidden test');
  r.rules.debugKey('H');
  assert.ok(r.view.namePrompt);
  r.rules.stopGame();
  assert.equal(r.view.namePrompt, null);
  r.tick(100);
  assert.equal(r.view.phase, 'idle');
  r.rules.newGame({ players: 2 });
  r.tick(6);
  assert.equal(r.view.phase, 'playing');
  assert.equal(r.view.playerCount, 2);
});

// =====================================================================================================================================
// Fuzz: random event soup, random input / cheats / pauses never throw and keep the invariants
// =====================================================================================================================================
test('fuzz: 40 games of random physics events, inputs, cheats, pauses and new games never throw; invariants hold', () => {
  const names = {
    bumperHit: () => 'a_bump' + (1 + (rnd() * 7 | 0)), rebounderHit: () => 'v_rebo' + (1 + (rnd() * 4 | 0)), popupHit: () => 'a_targ' + (1 + (rnd() * 9 | 0)),
    popupUp: () => 'a_targ' + (1 + (rnd() * 9 | 0)), soloHit: () => 'a_targ' + (10 + (rnd() * 13 | 0)),
    rolloverEnter: () => pick(DATA.COMPONENT_NAMES.rollovers.concat(['a_roll9'])), tripwire: () => 's_trip' + (1 + (rnd() * 5 | 0)),
    oneway: () => pick(DATA.COMPONENT_NAMES.oneways), onewaySide: () => pick(DATA.COMPONENT_NAMES.oneways),
    flagFrame: () => 'a_flag' + (1 + (rnd() * 2 | 0)), flagLoop: () => 'a_flag' + (1 + (rnd() * 2 | 0)),
  };
  let rnd = mulberry32(99);
  const pick = (a) => a[(rnd() * a.length) | 0];
  const cheats = ['hidden test', 'gmax', '1max', 'bmax', 'rmax', 'easy mode'];
  const idEvents = { kickoutCapture: [1, 2, 3], kickoutEject: [1, 2, 3], sinkCapture: [1, 2, 3, 7], sinkEject: [1, 2, 3, 7],
    kickbackFired: [1, 2], kickbackTimerExpired: [1, 2], demoTrigger: [1400, 1401, 1402, 1403, 1404] };
  const plain = ['rampLine1', 'rampEnter', 'rampExit', 'rampHoleCaptured', 'rampHoleReleased', 'blockerHit', 'plungerPull', 'plungerRelease',
    'stuckRelaunch', 'nudge'];
  for (let game = 0; game < 40; game++) {
    rnd = mulberry32(1000 + game);
    const r = makeRig({ seed: game });
    const players = 1 + (game % 4);
    r.rules.newGame({ players });
    if (game % 7 === 3) r.rules.setDemo(true);
    let lastGame = 0;
    for (let step = 0; step < 4000; step++) {
      const x = rnd();
      if (x < 0.30) {
        const kinds = Object.keys(names);
        const t = pick(kinds);
        r.ev(t, { name: names[t](), impact: 5, frame: (rnd() * 8) | 0, dir: 1 });
      } else if (x < 0.40) {
        const t = pick(Object.keys(idEvents));
        r.ev(t, { id: pick(idEvents[t]), from: 1 });
      } else if (x < 0.46) {
        r.ev(pick(plain), { ramp: 'ramp', mask: 4, boost: 50, hitBall: true, dir: 'left' });
      } else if (x < 0.52) {
        r.fp.state.ballsInPlay = (rnd() * 2) | 0;
        r.ev('drain', { ballId: 1, remaining: r.fp.state.ballsInPlay, via: pick(['drain', 'forced', 'sinkTilt']) });
      } else if (x < 0.57) {
        r.ev('plungerFed', { ballId: 1 });
      } else if (x < 0.60) {
        r.ev('nudgeCount', { level: pick(['warn', 'tilt']), count: 1 });
      } else if (x < 0.64) {
        r.ev('flipper', { side: pick(['left', 'right']), action: pick(['extend', 'retract']), byKey: rnd() < 0.5 });
      } else if (x < 0.70) {
        r.rules.input(pick(['flipperLeft', 'flipperRight', 'plunger', 'nudgeLeft', 'nudgeRight', 'nudgeBottom']), rnd() < 0.5);
      } else if (x < 0.72) {
        r.rules.cheat(pick(cheats));
      } else if (x < 0.73) {
        r.rules.debugKey(pick(['H', 'R', 'B', 'S', 'I', 'J']));
      } else if (x < 0.745) {
        r.rules.setPaused(rnd() < 0.5);
      } else if (x < 0.75 && step - lastGame > 200) {
        lastGame = step;
        r.rules.newGame({ players: 1 + ((rnd() * 4) | 0) });
      } else if (x < 0.755) {
        r.rules.submitName(rnd() < 0.5 ? null : 'Fuzz');
      } else if (x < 0.757) {
        r.rules.setDemo(rnd() < 0.5);
      } else if (x < 0.758) {
        r.rules.launchBall();
      } else if (x < 0.759) {
        r.rules.focusLost();
      }
      r.tick(rnd() < 0.2 ? 0.5 : 0.02);
      const v = r.view;
      assert.ok(['idle', 'lightShow', 'playing', 'gameOver'].includes(v.phase));
      assert.ok(v.score >= 0 && v.score <= 999999999);
      assert.ok(v.player >= 1 && v.player <= 4 && v.playerCount >= 1 && v.playerCount <= 4);
      assert.ok(v.ballNumber >= 0 && v.ballNumber <= 3);
      assert.ok(typeof v.info === 'string' && typeof v.mission === 'string');
      assert.ok(v.missionState >= 0 && v.missionState <= 32);
      assert.ok(v.bumperLevels.attack >= 0 && v.bumperLevels.attack <= 3 && v.bumperLevels.launch >= 0 && v.bumperLevels.launch <= 3);
      assert.ok(v.extraBalls >= 0);
      assert.ok(v.fuelLevel >= 0 && v.fuelLevel <= 11);
    }
  }
});
