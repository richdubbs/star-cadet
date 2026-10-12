/**
 * tests/physics_components.test.mjs
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * Component-level tests (ARCHITECTURE.md 5.6 #8 and details of #6/#9): every handler of SPEC 4.9 in isolation (tables reduced to the
 * component under test with tests/physics_support.mjs `only()`), timing semantics through the engine clock, tilt rules, layers,
 * the ramp geometry builder, the timer queue, the flipper shape, and a fuzz soak that validates every event against the contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../src/data/index.js';
import { createPhysics } from '../src/physics.js';
import { Engine } from '../src/physics/engine.js';
import { Ball } from '../src/physics/ball.js';
import { Timers } from '../src/physics/timers.js';
import { Flipper } from '../src/physics/flipper.js';
import { buildRamp, planeZ, inTriangle, orientAgainst } from '../src/physics/ramps.js';
import { mulberry32, constantRand, sequenceRand } from './helpers/seeded_rand.mjs';
import { EMPTY, only, without, mk, stepN, run, runUntil, ofType, vel } from './physics_support.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);
const mid = (e) => [(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2];

/** White-box helper: an Engine on a reduced table and a standalone ball for direct handler calls. */
function lab(keys, rand = constantRand(0.5)) {
  const eng = new Engine({ rand, data: only(...keys) });
  const ball = (x, y, dx, dy, speed) => { const b = new Ball(1, x, y); b.dx = dx; b.dy = dy; b.speed = speed; return b; };
  const advance = (seconds) => { for (let i = 0; i < Math.round(seconds * 120); i++) eng.step(); };
  return { eng, ball, advance };
}

// ======================================================================================================================================
// Bumpers (kicker 371 / 404), rebounders (468)
// ======================================================================================================================================
test('bumper: hard hit above 2.5 adds +17 (attack) / +12 (launch), emits bumperHit once, then 0.1 s of plain bounces', () => {
  for (const [name, boost] of [['a_bump1', 17], ['a_bump5', 12]]) {
    const { eng, ball, advance } = lab(['BUMPERS']);
    const comp = eng.table.bumpers.find((b) => b.name === name);
    const edge = comp.edges[0];
    const hit = () => { const b = ball(0, 0, 0, 1, 10); comp.onHit(b, edge, 0, 0, 0, -1); return b; };
    const b1 = hit();
    near(b1.speed, 10 * 0.6 + boost, 1e-9, `${name} first hit`);
    let ev = eng.drainEvents();
    assert.deepEqual(ev.map((e) => [e.type, e.name]), [['bumperHit', name]]);
    near(ev[0].impact, 10, 1e-12);
    assert.equal(eng.snapshot().bumpers[name].hit, true);
    const b2 = hit();
    near(b2.speed, 6, 1e-9, 'second hit within 0.1 s is a plain bounce');
    assert.equal(eng.drainEvents().length, 0);
    advance(0.05);
    assert.equal(eng.snapshot().bumpers[name].hit, true, 'hit frame lasts 0.1 s');
    advance(0.06);
    assert.equal(eng.snapshot().bumpers[name].hit, false);
    near(hit().speed, 6 + boost, 1e-9, 'threshold restored');
    assert.equal(eng.drainEvents().length, 1);
    const soft = ball(0, 0, 0, 1, 2);                                // rebound 2 < 2.5
    advance(0.2);
    comp.onHit(soft, edge, 0, 0, 0, -1);
    near(soft.speed, 1.2, 1e-12);
    assert.equal(eng.drainEvents().length, 0, 'no event for a soft hit');
  }
});

test('bumper: end to end - a ball dropped on a_bump1 is kicked away and the rules get bumperHit{name, impact}', () => {
  const p = mk({ data: only('BUMPERS') });
  const b = p.spawnBall(0.008, -5.5, { vy: 20 });
  const ev = run(p, 0.2);
  const hit = ofType(ev, 'bumperHit');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, 'a_bump1');
  assert.ok(hit[0].impact > 19 && hit[0].impact < 22);
  assert.ok(b.dy < 0 && b.speed > 20, `kicked back up the table: ${b.speed}`);
});

test('rebounder: hard hit from 1.0 adds +18, flashes 0.1 s, emits rebounderHit; a soft hit does neither', () => {
  const reb = data.WALLS.find((w) => w.name === 'v_rebo1');
  const { eng, ball, advance } = lab([]);
  const e2 = new Engine({ rand: constantRand(0.5), data: { ...data, ...EMPTY, WALLS: [reb] } });
  const comp = e2.table.rebounders[0];
  const edge = comp.edges.find((e) => e.k === 'line');
  const b = new Ball(1, 0, 0); b.dx = 0; b.dy = 1; b.speed = 5;
  comp.onHit(b, edge, 0, 0, 0, -1);
  near(b.speed, 5 * 0.6 + 18, 1e-9);
  const ev = e2.drainEvents();
  assert.deepEqual(ev.map((e) => [e.type, e.name, e.impact]), [['rebounderHit', 'v_rebo1', 5]]);
  assert.equal(e2.snapshot().rebounders.v_rebo1.flash, true);
  for (let i = 0; i < 13; i++) e2.step();
  assert.equal(e2.snapshot().rebounders.v_rebo1.flash, false);
  const soft = new Ball(1, 0, 0); soft.dx = 0; soft.dy = 1; soft.speed = 0.8;
  comp.onHit(soft, edge, 0, 0, 0, -1);
  near(soft.speed, 0.48, 1e-9);
  assert.equal(e2.drainEvents().length, 0);
  void eng; void ball; void advance;
});

test('rebounder: end to end through the real v_rebo1 rubber', () => {
  const reb = data.WALLS.find((w) => w.name === 'v_rebo1');
  const long = reb.edges.filter((e) => e.k === 'line').sort((a, b) => Math.hypot(b.x1 - b.x0, b.y1 - b.y0) - Math.hypot(a.x1 - a.x0, a.y1 - a.y0))[0];
  const [mx, my] = mid(long);
  const p = mk({ data: { ...data, ...EMPTY, WALLS: [reb] } });
  const b = p.spawnBall(mx + long.nx * 1.0, my + long.ny * 1.0, { vx: -long.nx * 12, vy: -long.ny * 12 });
  const ev = run(p, 0.3);
  const hit = ofType(ev, 'rebounderHit');
  assert.equal(hit.length, 1);
  assert.ok(hit[0].impact > 11);
  assert.ok(vel(b)[0] * long.nx + vel(b)[1] * long.ny > 12, 'thrown back out faster than it came in');
});

// ======================================================================================================================================
// Targets
// ======================================================================================================================================
test('pop-up target: hit above 3.0 -> +5, popupHit, edges off (ball passes), re-raised 0.25 s after popupReenable with popupUp', () => {
  const p = mk({ data: only('POPUP_TARGETS') });
  const b = p.spawnBall(-3.0, 0.97, { vx: -25 });
  let ev = run(p, 0.3);
  assert.deepEqual(ofType(ev, 'popupHit').map((e) => e.name), ['a_targ1']);
  assert.equal(p.snapshot().popups.a_targ1.up, false);
  assert.ok(b.dx > 0, 'bounced back');
  // the target is down: a second ball runs straight through
  const c = p.spawnBall(-3.0, 1.0, { vx: -25 });
  const ev2 = run(p, 0.3);
  assert.equal(ofType(ev2, 'popupHit').length, 0);
  assert.ok(c.x < -5, `passed through: ${c.x}`);
  // re-raise: 0.25 s timer
  p.popupReenable('a_targ1');
  assert.equal(p.snapshot().popups.a_targ1.up, false);
  const up = runUntil(p, (es) => ofType(es, 'popupUp').length > 0, 1);
  assert.ok(up.hit);
  const t0 = ofType(up.events, 'popupUp')[0].t;
  assert.equal(p.snapshot().popups.a_targ1.up, true);
  assert.equal(ofType(up.events, 'popupUp')[0].name, 'a_targ1');
  assert.ok(t0 > 0);
  // immediate re-raise, 'all', and no event when already up
  const q = mk({ data: only('POPUP_TARGETS') });
  q.spawnBall(-3.0, 0.97, { vx: -25 });
  run(q, 0.3);
  q.drainEvents();
  q.popupReenable(['a_targ1'], true);
  assert.deepEqual(q.drainEvents().map((e) => e.type), ['popupUp']);
  q.popupReenable('all');
  assert.equal(run(q, 0.5).length, 0, 'already up: nothing happens');
});

test('pop-up target: the re-raise delay is exactly 0.25 s; calling popupReenable twice does not duplicate the event', () => {
  const { eng, ball } = lab(['POPUP_TARGETS']);
  const comp = eng.table.popups[0];
  const b = ball(0, 0, 0, 1, 10);
  comp.onHit(b, comp.edges[1], 0, 0, 0, -1);
  assert.equal(comp.up, false);
  eng.drainEvents();
  const t0 = eng.time;
  eng.popupReenable('a_targ1');
  eng.popupReenable('a_targ1');
  let when = null;
  for (let i = 0; i < 60 && when === null; i++) { eng.step(); for (const e of eng.drainEvents()) if (e.type === 'popupUp') when = e.t; }
  near(when - t0, 0.25, 1 / 120 + 1e-9);
  stepN(eng, 20);
  assert.equal(eng.drainEvents().length, 0);
});

test('pop-up target: a hit below 3.0 is a plain bounce without event; while tilted even a hard hit is plain', () => {
  const { eng, ball } = lab(['POPUP_TARGETS']);
  const comp = eng.table.popups[3];
  const soft = ball(0, 0, 0, 1, 2.5);
  comp.onHit(soft, comp.edges[1], 0, 0, 0, -1);
  assert.equal(comp.up, true);
  near(soft.speed, 1.5, 1e-12);
  assert.equal(eng.drainEvents().length, 0);
  eng.setTiltLock(true);
  const hard = ball(0, 0, 0, 1, 20);
  comp.onHit(hard, comp.edges[1], 0, 0, 0, -1);
  assert.equal(comp.up, true);
  near(hard.speed, 12, 1e-12);
  assert.equal(eng.drainEvents().length, 0);
});

test('solo target: hit above 3.0 -> +5, soloHit{impact}, flash 1 -> 0 over 0.1 s, edges inactive 0.1 s then re-armed', () => {
  const { eng, ball } = lab(['SOLO_TARGETS']);
  const comp = eng.table.solos.find((s) => s.name === 'a_targ13');
  const b = ball(0, 0, 0, 1, 20);
  comp.onHit(b, comp.edges[1], 0, 0, 0, -1);
  near(b.speed, 20 * 0.6 + 5, 1e-9);
  const ev = eng.drainEvents();
  assert.deepEqual(ev.map((e) => [e.type, e.name, e.impact]), [['soloHit', 'a_targ13', 20]]);
  assert.ok(comp.edges.every((e) => !e.active));
  near(eng.snapshot().solos.a_targ13.flash, 1, 1e-9);
  stepN(eng, 6);
  near(eng.snapshot().solos.a_targ13.flash, 0.5, 1e-6);
  stepN(eng, 5);
  assert.ok(comp.edges.every((e) => !e.active), 'still inactive at 0.092 s');
  stepN(eng, 2);
  assert.ok(comp.edges.every((e) => e.active), 're-armed after 0.1 s');
  assert.equal(eng.snapshot().solos.a_targ13.flash, 0);
  // soft hit: plain bounce, no event
  const soft = ball(0, 0, 0, 1, 2);
  comp.onHit(soft, comp.edges[1], 0, 0, 0, -1);
  assert.equal(eng.drainEvents().length, 0);
});

test('solo target: end to end - the ball bounces off, an immediate second ball passes through, a later one registers again', () => {
  const p = mk({ data: only('SOLO_TARGETS') });
  p.spawnBall(6.0, -11.5, { vx: 25 });                      // hits the lower cap of a_targ10 (x 7.35, y -11.28..-10.74)
  const second = p.spawnBall(5.0, -10.5, { vx: 25 });       // 1 unit behind and 1 unit higher: arrives ~0.04 s later, inside the 0.1 s window
  const ev = run(p, 0.25);
  assert.deepEqual(ofType(ev, 'soloHit').map((e) => e.name), ['a_targ10'], 'only the first registered');
  assert.ok(second.x > 7.8, `second ball passed through: ${second.x}`);
  p.removeAllBalls();
  p.spawnBall(6.0, -11.0, { vx: 25 });
  assert.equal(ofType(run(p, 0.25), 'soloHit').length, 1, 're-armed');
});

// ======================================================================================================================================
// Kickbacks, gates, blocker, drain, outline
// ======================================================================================================================================
test('kickback: first touch starts a 0.7 s wait (plain bounces), then a touch kicks at 55 u/s; kickbackFired, then kickbackTimerExpired within 0.1 s', () => {
  const kb = data.KICKBACKS[0];
  const x = (kb.line[0][0] + kb.line[1][0]) / 2, yLine = kb.edges[0].y0;
  const p = mk({ data: only('KICKBACKS') });
  const b = p.spawnBall(x, yLine - 0.25);
  const ev = [];
  let touch = null, snapArmed = false, snapKicked = false, fired = null;
  for (let i = 0; i < 4 * 120; i++) {
    p.step();
    const s = p.snapshot().kickbacks.a_kick1;
    if (touch === null && b.speed > 0 && b.dy < 0 && b.y > yLine - 0.05) touch = p.snapshot().time;
    snapArmed ||= s.armed; snapKicked ||= s.kicked;
    for (const e of p.drainEvents()) { ev.push(e); if (e.type === 'kickbackFired') fired = e.t; }
    if (fired !== null && ofType(ev, 'kickbackTimerExpired').length) break;
  }
  assert.ok(fired !== null, 'kick happened');
  assert.deepEqual(ev.map((e) => e.type), ['kickbackFired', 'kickbackTimerExpired']);
  assert.deepEqual([ev[0].id, ev[1].id], [1, 1]);
  assert.ok(ev[1].t - ev[0].t > 0 && ev[1].t - ev[0].t <= 0.1 + 1e-9, 'expires within 0.1 s of the kick');
  assert.ok(snapArmed && snapKicked, 'snapshot showed armed and kicked');
  assert.ok(b.dy < -0.99 && b.speed > 50 && b.speed < 56, `launched up the table: ${b.speed}`);
  assert.ok(fired - touch >= 0.7 - 2 / 120 && fired - touch < 0.9, `kick ${(fired - touch).toFixed(3)} s after the first touch`);
});

test('kickback: white-box state machine (idle -> waiting -> armed -> kicked -> expired), a kick resets for the next first touch', () => {
  const { eng, ball } = lab(['KICKBACKS']);
  const comp = eng.table.kickbacks[1];
  const edge = comp.edges[0];
  const touch = (speed = 1) => { const b = ball(7, 11.46, 0, 1, speed); comp.onHit(b, edge, 7, 11.46, 0, -1); return b; };
  let b = touch();
  near(b.speed, 0.2, 1e-9, 'plain 0.7/0.2 bounce on the first touch');
  assert.deepEqual([comp.active, comp.armed, comp.kicked], [true, false, false]);
  b = touch(); near(b.speed, 0.2, 1e-9, 'still waiting: plain');
  eng.advance?.(0);
  stepN(eng, 83);                                                // 0.69 s
  assert.equal(comp.armed, false);
  stepN(eng, 2);                                                 // 0.7 s reached
  assert.equal(comp.armed, true);
  assert.deepEqual(eng.snapshot().kickbacks.a_kick1, { kicked: false, armed: true });
  b = touch(0);
  near(b.speed, 55, 1e-9, 'armed: any touch kicks, even a resting ball');
  assert.deepEqual(eng.drainEvents().map((e) => e.type), ['kickbackFired']);
  assert.deepEqual([comp.active, comp.armed, comp.kicked], [false, false, true]);
  stepN(eng, 13);
  assert.deepEqual(eng.drainEvents().map((e) => e.type), ['kickbackTimerExpired']);
  assert.equal(comp.kicked, false);
  b = touch(); near(b.speed, 0.2, 1e-9, 'next touch starts a new 0.7 s cycle (plain bounce)');
  assert.equal(comp.active, true);
});

test('kickback: while tilt-locked the first touch kicks at once (T=0, B=55)', () => {
  const { eng, ball } = lab(['KICKBACKS']);
  const comp = eng.table.kickbacks[2];
  eng.setTiltLock(true);
  const b = ball(-6, 11.47, 0, 1, 3);
  comp.onHit(b, comp.edges[0], -6, 11.47, 0, -1);
  near(b.speed, 0.2 * 3 + 55, 1e-9);
  assert.deepEqual(eng.drainEvents().map((e) => e.type), ['kickbackFired']);
  stepN(eng, 13);
  assert.deepEqual(eng.drainEvents().map((e) => e.type), ['kickbackTimerExpired']);
});

test('gates: enabled = solid one-sided wall (bounce 0.8/0.5), disabled = the ball passes; gateSetEnabled is idempotent', () => {
  const g = data.GATES[0];
  const e = g.edges[0];
  const m = mid(e);
  const shoot = (enabled) => {
    const p = mk({ data: only('GATES') });
    p.gateSetEnabled(1, enabled);
    p.gateSetEnabled(1, enabled);
    const b = p.spawnBall(m[0] + e.nx * 1.0, m[1] + e.ny * 1.0, { vx: -e.nx * 10, vy: -e.ny * 10 });
    run(p, 0.3);
    return { b, p, side: (b.x - m[0]) * e.nx + (b.y - m[1]) * e.ny };
  };
  const on = shoot(true), off = shoot(false);
  assert.ok(on.side > 0.5, `bounced back to the front side (${on.side})`);
  assert.ok(off.side < -1, `passed through (${off.side})`);
  assert.equal(on.p.snapshot().gates.v_gate1.enabled, true);
  assert.equal(off.p.snapshot().gates.v_gate1.enabled, false);
  // the gate hit is a plain bounce even for a very fast ball (T = never)
  assert.ok(Math.hypot(...vel(on.b)) < 7, 'e 0.5');
});

test('blocker: down = ball falls past, up = ball bounces off the post (blockerHit), tilt lowers it and the rules state returns afterwards', () => {
  const post = data.BLOCKER.c;
  const drop = (up, tilt = false) => {
    const p = mk({ data: only('BLOCKER') });
    if (up) p.blockerSetEnabled(true);
    if (tilt) p.setTiltLock(true);
    const b = p.spawnBall(post[0], post[1] - 2.0, { vy: 8 });
    const ev = run(p, 0.8);
    return { b, ev, p };
  };
  const down = drop(false), upr = drop(true), tilted = drop(true, true);
  assert.ok(down.b.y > post[1] + 0.5 && ofType(down.ev, 'blockerHit').length === 0, 'post down: no hit');
  assert.ok(ofType(upr.ev, 'blockerHit').length >= 1, 'post up: blockerHit');
  assert.ok(ofType(upr.ev, 'blockerHit')[0].impact > 6);
  assert.ok(upr.b.y < post[1] - 0.3, 'bounced off');
  assert.ok(tilted.b.y > post[1] + 0.5 && ofType(tilted.ev, 'blockerHit').length === 0, 'tilt: post deactivated');
  upr.p.setTiltLock(true); assert.equal(upr.p.snapshot().blocker.up, false);
  upr.p.setTiltLock(false); assert.equal(upr.p.snapshot().blocker.up, true);
});

test('drain: a ball touching the drain line leaves play with drain{ballId, remaining, via}; two balls count down', () => {
  const p = mk({ data: only('DRAIN') });
  const a = p.spawnBall(-3, 13.5, { vy: 10 });
  const b = p.spawnBall(3, 13.5, { vy: 10 });
  assert.equal(p.ballsInPlay(), 2);
  const ev = run(p, 0.5);
  const d = ofType(ev, 'drain');
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((e) => e.remaining), [1, 0]);
  assert.deepEqual(d.map((e) => e.via), ['drain', 'drain']);
  assert.deepEqual(d.map((e) => e.ballId).sort(), [a.id, b.id].sort());
  assert.equal(p.ballsInPlay(), 0);
  assert.equal(p.balls.length, 0);
  assert.equal(p.snapshot().balls.length, 0);
});

test('forceDrainAll drains every ball (via forced), including sink / kickout captives; removeAllBalls is silent and cancels pending work', () => {
  const p = mk({ data: only('KICKOUTS', 'SINKS') });
  p.spawnBall(data.KICKOUTS[1].c[0], data.KICKOUTS[1].c[1] + 0.4, { vy: -4 });
  p.spawnBall(5, 5);
  stepN(p, 30);
  assert.equal(ofType(p.drainEvents(), 'kickoutCapture').length, 1);
  p.forceDrainAll();
  const d = ofType(p.drainEvents(), 'drain');
  assert.deepEqual(d.map((e) => [e.remaining, e.via]), [[1, 'forced'], [0, 'forced']]);
  assert.equal(p.ballsInPlay(), 0);
  assert.equal(p.snapshot().kickouts.a_kout2.held, false);
  assert.equal(run(p, 3).length, 0, 'the kickout hold timer was cancelled');
  // removeAllBalls: no events, pending feed cancelled
  p.startFeed();
  p.spawnBall(5, 5);
  p.removeAllBalls();
  assert.equal(p.ballsInPlay(), 0);
  assert.equal(run(p, 2).length, 0);
});

test('table outline: the four inward lines bounce (0.95/0.6) and a hard hit (>= 5) gets +15; walls and posts use their material', () => {
  const p = mk({ data: only('TABLE_OUTLINE') });
  const b = p.spawnBall(-7.5, 0, { vx: -20 });
  run(p, 0.1);
  assert.ok(b.dx > 0.9, 'bounced off x = -8');
  near(b.speed, 20 * 0.6 + 15, 3, 'hard hit: e 0.6 + boost 15');
  const q = mk({ data: only('TABLE_OUTLINE') });
  const c = q.spawnBall(0, 14.5, { vy: 3 });
  run(q, 0.3);
  assert.ok(c.y < 15 && c.y > 14, 'a soft ball stays above y = 15');
  const post = data.POSTS[1];
  const w = mk({ data: only('POSTS') });
  const d = w.spawnBall(post.c[0] + 1.5, post.c[1], { vx: -10 });
  run(w, 0.3);
  assert.ok(d.dx > 0, 'bounced off the post circle');
  assert.ok(d.speed < 10 * 0.6 + 1.5, `post elasticity 0.6: ${d.speed}`);
});

// ======================================================================================================================================
// Pass-through components
// ======================================================================================================================================
test('one-way: passes in the +n direction (event, not deflected), bounces from the +n side; onewaySide only for s_onewy9/10 above 0.2', () => {
  const ow = (name) => data.ONEWAYS.find((o) => o.name === name);
  // s_onewy4: n = (1, 0)
  const just = (name) => ({ ...data, ...EMPTY, ONEWAYS: data.ONEWAYS.filter((o) => o.name === name) });
  const through = mk({ data: just('s_onewy4') });
  const a = through.spawnBall(-7.0, 4.3, { vx: 20 });
  const ev = run(through, 0.3);
  assert.deepEqual(ofType(ev, 'oneway').map((e) => e.name), ['s_onewy4']);
  assert.ok(a.x > -4.5 && Math.abs(a.dy) < 0.2, `passed on: ${a.x}`);
  near(a.speed, 20, 1.5, 'not slowed by the trigger');
  const back = mk({ data: just('s_onewy4') });
  const b = back.spawnBall(-5.0, 4.3, { vx: -20 });
  const ev2 = run(back, 0.3);
  assert.equal(ofType(ev2, 'oneway').length, 0);
  assert.equal(ofType(ev2, 'onewaySide').length, 0, 's_onewy4 has no side sound');
  assert.ok(b.dx > 0.5, 'bounced back');
  // s_onewy10 (side sound): hit its wall side head-on
  const w10 = ow('s_onewy10');
  const m = mid(w10.edges[0]);
  const n = w10.normal;
  const side = mk({ data: just('s_onewy10') });
  side.spawnBall(m[0] + n[0] * 1.5, m[1] + n[1] * 1.5, { vx: -n[0] * 15, vy: -n[1] * 15 });
  const ev3 = run(side, 0.3);
  const s = ofType(ev3, 'onewaySide');
  assert.deepEqual(s.map((e) => e.name), ['s_onewy10']);
  assert.ok(s[0].impact > 14 && s[0].impact < 16);
  assert.equal(ofType(ev3, 'oneway').length, 0);
  // the same wall passed in its pass direction fires the script event
  const ok = mk({ data: just('s_onewy10') });
  ok.spawnBall(m[0] - n[0] * 1.5, m[1] - n[1] * 1.5, { vx: n[0] * 15, vy: n[1] * 15 });
  assert.deepEqual(ofType(run(ok, 0.3), 'oneway').map((e) => e.name), ['s_onewy10']);
});

test('one-way on the deck (s_onewy12, mask 4) is invisible to a mask-1 ball; mask-1 one-ways are invisible to deck balls', () => {
  const ow = data.ONEWAYS.find((o) => o.name === 's_onewy12');
  const m = mid(ow.edges[0]);
  const n = ow.normal;
  const floor = mk({ data: only('ONEWAYS') });
  const f = floor.spawnBall(m[0] + n[0] * 1.5, m[1] + n[1] * 1.5, { vx: -n[0] * 15, vy: -n[1] * 15 });
  run(floor, 0.3);
  assert.ok(f.x < m[0] - 1, 'a mask-1 ball ignores the deck one-way');
  const deck = mk({ data: only('ONEWAYS') });
  const d = deck.spawnBall(m[0] + n[0] * 1.5, m[1] + n[1] * 1.5, { mask: 4, vx: -n[0] * 15, vy: -n[1] * 15 });
  run(deck, 0.3);
  assert.ok((d.x - m[0]) * n[0] + (d.y - m[1]) * n[1] > 0.5, 'a mask-4 ball is stopped');
});

test('tripwire: fires only for a ball travelling against its normal (up the right orbit), never deflects', () => {
  const t = data.TRIPWIRES[0];
  const e = t.edges[0];
  const m = mid(e);
  const up = mk({ data: only('TRIPWIRES') });
  const a = up.spawnBall(m[0] + e.nx * 1.0, m[1] + e.ny * 1.0, { vx: -e.nx * 20, vy: -e.ny * 20 });
  const ev = run(up, 0.3);
  assert.deepEqual(ofType(ev, 'tripwire').map((x) => x.name), ['s_trip1']);
  assert.ok((a.x - m[0]) * e.nx + (a.y - m[1]) * e.ny < -1, 'went straight through');
  const down = mk({ data: only('TRIPWIRES') });
  down.spawnBall(m[0] - e.nx * 1.0, m[1] - e.ny * 1.0, { vx: e.nx * 20, vy: e.ny * 20 });
  assert.equal(ofType(run(down, 0.3), 'tripwire').length, 0, 'wrong direction: silent');
});

test('rollover: entry polygon crossed once per pass (rolloverEnter), ball not deflected, exit disarms the entry for 0.1 s', () => {
  const p = mk({ data: only('ROLLOVERS') });
  const b = p.spawnBall(1.25, -8.0, { vy: -20 });                 // a_roll1: x 0.79..1.71, y -9.84..-9.16
  const ev = run(p, 0.5);
  assert.deepEqual(ofType(ev, 'rolloverEnter').map((e) => e.name), ['a_roll1']);
  assert.ok(b.y < -10.5, 'carried straight through');
  assert.ok(Math.abs(b.dx) < 0.01, 'not deflected');
  // a mask-4 rollover (a_roll110) ignores a floor ball and fires for a deck ball
  const q = mk({ data: only('ROLLOVERS') });
  q.spawnBall(7.268, 3.0, { vy: -10 });
  assert.equal(ofType(run(q, 0.4), 'rolloverEnter').length, 0);
  const r = mk({ data: only('ROLLOVERS') });
  r.spawnBall(7.268, 3.0, { mask: 4, vy: -10 });
  assert.deepEqual(ofType(run(r, 0.4), 'rolloverEnter').map((e) => e.name), ['a_roll110']);
});

test('rollover: white-box arm / pressed / re-arm timing (0.1 s) and the light rollover sprite (0.15 s)', () => {
  const { eng, ball } = lab(['ROLLOVERS']);
  const roll = eng.table.rollovers.find((r) => r.name === 'a_roll9');
  assert.equal(roll.light, true);
  const entry = roll.edges.filter((e) => e.gate === 'active'), exit = roll.edges.filter((e) => e.gate === 'rolloverflag');
  assert.ok(entry.every((e) => e.active) && exit.every((e) => !e.active), 'armed');
  const b = ball(5, -7.2, 0, -1, 10);
  roll.onHit(b, entry[0], 5, -7.0, 0, 1);
  assert.deepEqual(eng.drainEvents().map((e) => [e.type, e.name]), [['rolloverEnter', 'a_roll9']]);
  assert.ok(entry.every((e) => !e.active) && exit.every((e) => e.active), 'pressed: only the exit polygon is live');
  assert.equal(eng.snapshot().rolloverSprites.a_roll9.lit, false);
  const t0 = eng.time;
  roll.onHit(b, exit[0], 5, -7.5, 0, 1);
  assert.equal(eng.drainEvents().length, 0, 'the exit crossing is silent');
  assert.ok(entry.every((e) => !e.active) && exit.every((e) => !e.active), 'disarmed');
  assert.equal(eng.snapshot().rolloverSprites.a_roll9.lit, true, 'sprite lit after the exit');
  stepN(eng, 11);
  assert.ok(entry.every((e) => !e.active), 'still disarmed at 0.092 s');
  stepN(eng, 2);
  assert.ok(entry.every((e) => e.active), 're-armed after 0.1 s');
  assert.equal(eng.snapshot().rolloverSprites.a_roll9.lit, true, 'sprite 0.15 s');
  stepN(eng, 6);
  assert.equal(eng.snapshot().rolloverSprites.a_roll9.lit, false);
  assert.ok(eng.time - t0 > 0.15);
});

test('flag spinner: crossing starts decaying frame events (500/2500 points per frame in the rules), flagLoop every 8 frames, direction by side', () => {
  const f = data.FLAGS[0];                                            // a_flag1, y = -4.739, x 6.5..7.5
  const fast = mk({ data: only('FLAGS') });
  const b = fast.spawnBall(7.0, -3.9, { vy: -60 });
  const ev = run(fast, 1.0);
  const frames = ofType(ev, 'flagFrame');
  assert.deepEqual([...new Set(frames.map((e) => e.dir))], [1]);
  assert.equal(frames.length, 13, '1200 u/s decays by 0.65 per frame until < 5');
  assert.deepEqual(frames.map((e) => e.frame), [1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(ofType(ev, 'flagLoop').map((e) => e.name), ['a_flag1']);
  assert.ok(b.y < -6 && Math.abs(b.dx) < 0.05, 'ball passes undeflected');
  // frame rate decays: the gaps between frames grow
  const gaps = frames.slice(1).map((e, i) => e.t - frames[i].t);
  assert.ok(gaps[gaps.length - 1] > gaps[2], 'spin slows down');
  const s = fast.snapshot().flags.a_flag1;
  assert.deepEqual([s.frame, s.spinning], [5, false]);
  near(s.angle, 5 * Math.PI / 4, 1e-12);
  // the other side of the line spins the other way
  const back = mk({ data: only('FLAGS') });
  back.spawnBall(7.0, -5.6, { vy: 60 });
  const ev2 = run(back, 1.0);
  const fr2 = ofType(ev2, 'flagFrame');
  assert.deepEqual([...new Set(fr2.map((e) => e.dir))], [-1]);
  assert.deepEqual(fr2.slice(0, 3).map((e) => e.frame), [7, 6, 5]);
  assert.equal(f.name, 'a_flag1');
});

test('flag spinner: spin speed is clamped to [5, 50000]; a crawling ball spins exactly one frame; a second crossing refreshes the speed', () => {
  const { eng, ball } = lab(['FLAGS']);
  const comp = eng.table.flags[0];
  const e = comp.edges[0];
  comp.onHit(ball(7, -4.7, 0, -1, 0.01), e, 7, -4.739, 0, 1);     // 0.01 * 20 = 0.2 -> clamped up to 5
  near(comp.spinSpeed, 5, 1e-12);
  const ev = [];
  for (let i = 0; i < 60; i++) { eng.step(); ev.push(...eng.drainEvents()); }
  const frames = ofType(ev, 'flagFrame');
  assert.equal(frames.length, 1, '5 * 0.65 < 5: a single frame');
  near(frames[0].t, 0.2, 1 / 120 + 1e-9, 'first frame after 1/5 s');
  assert.equal(comp.spinning, false);
  const { eng: eng2, ball: ball2 } = lab(['FLAGS']);
  const c2 = eng2.table.flags[0];
  c2.onHit(ball2(7, -4.7, 0, -1, 10), c2.edges[0], 7, -4.739, 0, 1);
  near(c2.spinSpeed, 200, 1e-9);
  c2.onHit(ball2(7, -4.7, 0, -1, 40), c2.edges[0], 7, -4.739, 0, 1);
  near(c2.spinSpeed, 800, 1e-9, 'refreshed, still one timer');
  assert.equal(eng2.timers.size, 1);
  const c3 = lab(['FLAGS']);
  c3.eng.table.flags[0].onHit(c3.ball(7, -4.7, 0, -1, 1e6), c3.eng.table.flags[0].edges[0], 7, -4.739, 0, 1);
  near(c3.eng.table.flags[0].spinSpeed, 50000, 1e-9, 'upper clamp');
});

test('demo triggers: silent until setDemoTriggers(true), then demoTrigger{id} when a ball enters (offset 0)', () => {
  const p = mk({ data: only('DEMO_TRIGGERS') });
  p.spawnBall(1.5, 9.5, { vy: 12 });
  assert.equal(ofType(run(p, 0.8), 'demoTrigger').length, 0, 'off by default');
  p.removeAllBalls();
  p.setDemoTriggers(true);
  p.spawnBall(1.5, 9.5, { vy: 12 });
  const ev = run(p, 0.8);
  assert.ok(ofType(ev, 'demoTrigger').some((e) => e.id === 1401), `ids ${ofType(ev, 'demoTrigger').map((e) => e.id)}`);
  p.setDemoTriggers(false);
  p.removeAllBalls();
  p.spawnBall(1.5, 9.5, { vy: 12 });
  assert.equal(ofType(run(p, 0.8), 'demoTrigger').length, 0);
});

// ======================================================================================================================================
// Layers
// ======================================================================================================================================
test('layers: a mask-4 ball hits the deck bumpers a_bump5-7, a mask-1 ball passes through them (and the converse for a_bump1)', () => {
  const b5 = data.BUMPERS.find((b) => b.name === 'a_bump5');
  const deck = mk({ data: only('BUMPERS') });
  deck.spawnBall(b5.c[0] - 2, b5.c[1], { mask: 4, vx: 15 });
  assert.ok(ofType(run(deck, 0.3), 'bumperHit').some((e) => e.name === 'a_bump5'));
  const floor = mk({ data: only('BUMPERS') });
  const f = floor.spawnBall(b5.c[0] - 2, b5.c[1], { vx: 15 });
  assert.equal(ofType(run(floor, 0.3), 'bumperHit').length, 0);
  assert.ok(f.x > b5.c[0] + 1);
  const b1 = data.BUMPERS[0];
  const wrong = mk({ data: only('BUMPERS') });
  wrong.spawnBall(b1.c[0] - 2, b1.c[1], { mask: 4, vx: 15 });
  assert.equal(ofType(run(wrong, 0.3), 'bumperHit').length, 0, 'deck ball passes over a floor bumper');
});

test('layers: shell 103 (mask 6) contains deck AND ramp balls but not floor balls', () => {
  const shell = data.WALLS.find((w) => w.name === 'wall_103');
  assert.equal(shell.mask, 6);
  const p = mk({ data: { ...data, ...EMPTY, WALLS: [shell] } });
  // a deck ball thrown at the shell's right edge (x ~ 7.65) is held in; a floor ball sails through
  const d = p.spawnBall(7.0, 1.0, { mask: 4, vx: -30 });
  const f = p.spawnBall(7.0, -0.5, { vx: -30 });
  run(p, 0.5);
  assert.ok(d.x > 4 && d.x < 8, `deck ball stays inside: ${d.x}`);
  assert.ok(f.x < 3, `floor ball passes through the shell: ${f.x}`);
});

test('spawnBall: masks, velocity, guard and ramp planes', () => {
  const p = mk();
  const a = p.spawnBall(2.0, 6.0, { vx: 3, vy: -4 });
  near(a.speed, 5, 1e-12); near(a.dx, 0.6, 1e-12); near(a.dy, -0.8, 1e-12);
  assert.equal(a.z, 0.3);
  const d = p.spawnBall(6.0, 3.0, { mask: 4 });
  assert.deepEqual([d.mask, d.z], [4, 1.368]);
  const r = p.spawnBall(2.9, 0.6, { mask: 2 });
  assert.ok(r && r.onRamp && r.plane, 'spawned on a ramp plane');
  near(r.z, planeZ(r.plane, 2.9, 0.6) + 0.3, 1e-9);
  assert.ok(r.z > 0.3 && r.z < 1.4);
  assert.equal(p.spawnBall(0, -13, { mask: 2 }), null, 'no ramp plane there');
  for (let i = 0; i < 25; i++) p.spawnBall(-7 + (i % 5) * 1.0, 8 + Math.floor(i / 5) * 0.8);
  assert.ok(p.ballsInPlay() <= 20);
  assert.equal(p.spawnBall(2.0, 6.1), null, 'blocked by the ball at (2, 6)');
});

// ======================================================================================================================================
// Ball to ball, debug drag
// ======================================================================================================================================
test('ball-ball: equal masses exchange their normal velocity components (head-on swap), momentum conserved', () => {
  const p = mk({ data: { ...data, ...EMPTY } });
  const a = p.spawnBall(-3, 0, { vx: 10, vy: 0 });
  const b = p.spawnBall(3, 0, { vx: -10, vy: 0 });
  for (let i = 0; i < 60; i++) p.step();
  assert.ok(vel(a)[0] < -8 && vel(b)[0] > 8, `bounced: ${vel(a)[0]}, ${vel(b)[0]}`);
  assert.ok(Math.abs(a.x - b.x) > 0.55, 'never overlap by more than the contact tolerance');
  near(vel(a)[0] + vel(b)[0], 0, 0.8, 'total x momentum (gravity/drag aside)');
});

test('debug drag: a grabbed ball follows the pointer without gravity and keeps its momentum on release', () => {
  const p = mk({ data: { ...data, ...EMPTY } });
  const b = p.spawnBall(0, 0);
  assert.equal(p.debugGrab(0.5, 0.3), true);
  for (let i = 0; i < 30; i++) { p.debugDrag(0.5 + i * 0.05, 0.3); p.step(); }
  near(b.y, 0.3, 0.1, 'held at the pointer height (no gravity)');
  assert.ok(b.x > 1.0, `followed the pointer: ${b.x}`);
  p.debugRelease();
  const before = vel(b);
  p.step();
  assert.ok(Math.hypot(...vel(b)) > 1, 'keeps moving after release');
  assert.ok(vel(b)[0] > before[0] * 0.9);
  assert.equal(p.debugGrab(50, 50), false);
});

// ======================================================================================================================================
// Nudge details, tilt overlay
// ======================================================================================================================================
test('nudge: a new nudge restarts the shared 0.4 s timer; stacked nudges are all undone; pending undo cannot leak velocity', () => {
  const p = mk({ data: { ...data, ...EMPTY } });
  const b = p.spawnBall(0, 0);
  stepN(p, 1);
  const v0 = vel(b);
  p.nudge('left', true);
  stepN(p, 24);                                                      // 0.2 s
  p.nudge('bottom', true);
  stepN(p, 40);                                                      // 0.53 s after the first, 0.33 s after the second
  assert.notDeepEqual([p.snapshot().shake.x, p.snapshot().shake.y], [0, 0], 'timer restarted by the second nudge');
  stepN(p, 12);
  assert.deepEqual([p.snapshot().shake.x, p.snapshot().shake.y], [0, 0], 'both undone together');
  // velocity bookkeeping: with gravity/drag ignored the net nudge is zero -> compare with an un-nudged twin
  const q = mk({ data: { ...data, ...EMPTY } });
  const twin = q.spawnBall(0, 0);
  stepN(q, 1 + 24 + 40 + 12);
  void v0;
  near(vel(b)[0], vel(twin)[0], 0.25, 'x velocity back (only drag-scaled residue)');
  near(vel(b)[1], vel(twin)[1], 0.25, 'y velocity back');
});

test('tilt overlay: kickouts and the blocker deactivate while locked and come back with the lock; a running hold is cut to 0.1 s', () => {
  const p = mk({ data: only('KICKOUTS', 'BLOCKER') });
  p.blockerSetEnabled(true);
  p.spawnBall(data.KICKOUTS[2].c[0], data.KICKOUTS[2].c[1] + 0.3, { vy: -3 });
  const cap = runUntil(p, (es) => ofType(es, 'kickoutCapture').length > 0, 1);
  assert.ok(cap.hit);
  const t0 = p.snapshot().time;
  p.setTiltLock(true);
  assert.equal(p.snapshot().kickouts.a_kout2.active, false);
  assert.equal(p.snapshot().kickouts.a_kout3.active, false);
  assert.equal(p.snapshot().blocker.up, false);
  const ej = runUntil(p, (es) => ofType(es, 'kickoutEject').length > 0, 3);
  assert.ok(ej.hit);
  assert.ok(ofType(ej.events, 'kickoutEject')[0].t - t0 <= 0.1 + 2 / 120, 'tilt cuts the hold to 0.1 s');
  p.setTiltLock(false);
  stepN(p, 10);
  assert.equal(p.snapshot().kickouts.a_kout2.active, true);
  assert.equal(p.snapshot().blocker.up, true);
});

test('tilt: the plunger fires at once at full power when a ball touches it (auto-plunger), plungerRelease{boost:100, hitBall:true}', () => {
  const p = mk();
  p.setTiltLock(true);
  const b = p.spawnBall(data.PLUNGER.feed[0], data.PLUNGER.feed[1]);
  const ev = run(p, 1.0);
  const rel = ofType(ev, 'plungerRelease');
  assert.equal(rel.length, 1);
  assert.deepEqual([rel[0].boost, rel[0].hitBall], [100, true]);
  assert.ok(b.y < 5, `launched up the lane: ${b.y}`);
  p.setPlungerButton(true);
  assert.equal(p.snapshot().plunger.charging, false, 'charging refused while tilted');
});

test('events: every event has a numeric t equal to the physics clock of its step, in emission order', () => {
  const p = mk();
  p.spawnBall(2.5, 4.0, { vy: -35 });
  let last = 0;
  for (let i = 0; i < 400; i++) {
    p.step();
    const t = p.snapshot().time;
    for (const e of p.drainEvents()) {
      assert.equal(typeof e.type, 'string');
      assert.ok(Math.abs(e.t - t) < 1e-9, `${e.type}: t ${e.t} vs clock ${t}`);
      assert.ok(e.t >= last);
      last = e.t;
    }
  }
  assert.deepEqual(p.drainEvents(), []);
});

// ======================================================================================================================================
// resetTable
// ======================================================================================================================================
test('resetTable: start state (no balls, gates solid, post down, a_kout1 inactive, popups up, flippers at rest, no tilt, queue empty)', () => {
  const p = mk();
  p.spawnBall(2.5, 4.0, { vy: -35 });
  p.gateSetEnabled(1, false); p.blockerSetEnabled(true); p.kickoutSetActive(1, true); p.kickoutSetActive(2, false);
  p.setFlipperButton('left', true); p.setDemoTriggers(true); p.setTiltLock(true); p.nudge('left', true);
  run(p, 0.5);
  p.resetTable();
  const s = p.snapshot();
  assert.equal(p.ballsInPlay(), 0);
  assert.deepEqual(p.drainEvents(), []);
  assert.deepEqual([s.tiltLocked, s.nudgeCount, s.shake.x, s.shake.y], [false, 0, 0, 0]);
  assert.deepEqual([s.gates.v_gate1.enabled, s.gates.v_gate2.enabled, s.blocker.up], [true, true, false]);
  assert.deepEqual([s.kickouts.a_kout1.active, s.kickouts.a_kout2.active, s.kickouts.a_kout3.active], [false, true, true]);
  assert.deepEqual([s.flippers.a_flip1.angle, s.flippers.a_flip1.up], [0, false]);
  assert.ok(Object.values(s.popups).every((x) => x.up));
  assert.equal(p.setFlipperButton('left', true), true, 'flippers enabled again');
  assert.equal(run(p, 1).filter((e) => e.type !== 'flipper').length, 0, 'nothing pending');
});

// ======================================================================================================================================
// Support modules
// ======================================================================================================================================
test('EXACT_THROW_BUG: the a_kout1 eject follows the original rotation quirk (PHYS.exactThrowBug) or a true rotation when switched off', () => {
  for (const [bug, wantDy] of [[true, -0.4635], [false, -0.8090]]) {
    const eng = new Engine({ rand: constantRand(0.5), data: { ...data, ...EMPTY, KICKOUTS: [data.KICKOUTS[0]], PHYS: { ...data.PHYS, exactThrowBug: bug } } });
    const comp = eng.table.kickouts[1];
    comp.setActive(true);
    const b = new Ball(1, 0, 6);
    b.dx = 0; b.dy = -1; b.speed = 3;
    comp.onHit(b, comp.edges[0], 0, 6, 0, -1);
    assert.equal(comp.ball, b);
    eng.rand = sequenceRand([0.25, 0.5]);                     // angle = +0.5 * 1.256637 rad (36 deg), no speed jitter
    comp.release();
    near(b.dx, 0.5878, 1e-4, `bug=${bug} dx`);
    near(b.dy, wantDy, 1e-4, `bug=${bug} dy`);
    near(b.speed, 45, 1e-9);
    near(Math.hypot(b.dx, b.dy), bug ? 0.7486 : 1, 1e-3, 'the quirk leaves the direction un-normalised');
  }
});

test('Ball: toJSON is safe even while a component holds it (no cycles through the engine)', () => {
  const p = mk({ data: only('KICKOUTS') });
  const b = p.spawnBall(data.KICKOUTS[1].c[0], data.KICKOUTS[1].c[1] + 0.4, { vy: -4 });
  runUntil(p, (es) => ofType(es, 'kickoutCapture').length > 0, 1);
  assert.ok(b.heldBy);
  const j = JSON.parse(JSON.stringify(p.balls));
  assert.equal(j.length, 1);
  assert.deepEqual([j[0].id, j[0].held, j[0].mask], [b.id, true, 1]);
});

test('Timers: due order, insertion order for ties, re-entrancy, cancel, epsilon', () => {
  const t = new Timers();
  const log = [];
  t.schedule(0.2, () => log.push('b'));
  t.schedule(0.1, () => log.push('a'));
  t.schedule(0.2, () => log.push('c'));
  const x = t.schedule(0.15, () => log.push('x'));
  assert.equal(t.cancel(x), true);
  assert.equal(t.cancel(x), false);
  t.schedule(0.1, (due) => { log.push('d'); t.schedule(due + 0.05, () => log.push('e')); });
  t.run(0.05); assert.deepEqual(log, []);
  t.run(0.2);
  assert.deepEqual(log, ['a', 'd', 'e', 'b', 'c']);
  assert.equal(t.size, 0);
  const u = new Timers();
  let fired = 0;
  u.schedule(0.025, () => fired++);
  let now = 0;
  for (let i = 0; i < 3; i++) { now += 1 / 120; u.run(now); }
  assert.equal(fired, 1, '3 steps of 1/120 reach 0.025 s despite float drift');
  assert.ok(u.pending(0) === false);
});

test('buildRamp: 18 + 2 planes with the SPEC heights/forces, mouth edges not duplicated, seams oriented for the ball that must hit them', () => {
  const ramp = buildRamp(data.RAMPS.ramp, { pass: data.ONEWAYS.find((o) => o.name === 's_onewy12').normal });
  const tube = buildRamp(data.RAMPS.tube);
  assert.equal(ramp.planes.length, 18);
  assert.equal(tube.planes.length, 2);
  data.RAMPS.ramp.planes.forEach((pl, i) => {
    const q = ramp.planes[i];
    pl.v.forEach((v) => near(q.a * v[0] + q.b * v[1] + q.c, pl.offset[0] * v[0] + pl.offset[1] * v[1] + pl.offset[2], 1e-9));
    near(q.fx, pl.force[0], 2e-3, `plane ${i} fx`); near(q.fy, pl.force[1], 2e-3, `plane ${i} fy`);
  });
  near(planeZ(ramp.planes[0], 4.3948, -0.6761), 1.068, 2e-3, 'plateau');
  near(planeZ(ramp.planes[17], 3.2964, 1.2325), 0, 2e-3, 'low mouth');
  assert.equal(planeZ(tube.planes[0], -5.5, -3), -5);
  // seam counts: 54 triangle edges - 2 mouth edges + enter, enterUpper, exit, exitUpper, line1 = 57; tube 6 - 1 + enter, exit, exitFar = 8
  assert.equal(ramp.seams.length, 18 * 3 - 2 + 5);
  assert.equal(tube.seams.length, 2 * 3 - 1 + 3);
  const kinds = (r) => r.seams.map((s) => s.kind).filter((k) => k !== 'plane').sort();
  assert.deepEqual(kinds(ramp), ['enter', 'enterUpper', 'exit', 'exitUpper', 'line1']);
  assert.deepEqual(kinds(tube), ['enter', 'exit', 'exitFar']);
  const seam = (r, k) => r.seams.find((s) => s.kind === k);
  const normal = (s) => { const dx = s.p1[0] - s.p0[0], dy = s.p1[1] - s.p0[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  // a ball travelling along `dir` hits the one-sided seam iff dot(dir, n) < 0
  assert.ok(dot([0.35, -0.94], normal(seam(ramp, 'enter'))) < 0, 'low mouth is entered travelling up-screen');
  assert.ok(dot([-0.88, 0.47], normal(seam(ramp, 'enterUpper'))) < 0, 'upper mouth is entered from the deck');
  assert.ok(dot([0.88, -0.47], normal(seam(ramp, 'exitUpper'))) < 0, 'the deck is left through the upper mouth');
  assert.ok(dot([-0.35, 0.94], normal(seam(ramp, 'exit'))) < 0, 'back down the ramp leaves it');
  assert.ok(dot([0.826, 0.563], normal(seam(ramp, 'line1'))) < 0, 'line 1 fires for a ball moving along (+0.826,+0.563)');
  assert.ok(dot([0.25, -0.97], normal(seam(tube, 'exitFar'))) < 0, 'the far end is crossed travelling up the tube');
  assert.ok(dot([0, -1], normal(seam(tube, 'enter'))) < 0 && dot([0, 1], normal(seam(tube, 'exit'))) < 0);
  assert.deepEqual([seam(ramp, 'enter').mask, seam(ramp, 'enter').newMask, seam(ramp, 'enterUpper').mask, seam(ramp, 'enterUpper').newMask], [1, 2, 4, 2]);
  assert.deepEqual([seam(ramp, 'exit').newMask, seam(ramp, 'exitUpper').newMask, seam(tube, 'exitFar').newMask], [1, 4, 1]);
  assert.equal(seam(ramp, 'enter').plane.index, 17);
  assert.equal(seam(ramp, 'enterUpper').plane.index, 1);
  // the owner plane of every interior seam lies on the inner side of the seam normal... a ball moving INTO a triangle hits its edge
  for (const s of ramp.seams.filter((x) => x.kind === 'plane')) {
    const n = normal(s);
    const c = s.plane.v.reduce((a, v) => [a[0] + v[0] / 3, a[1] + v[1] / 3], [0, 0]);
    assert.ok((c[0] - s.p0[0]) * n[0] + (c[1] - s.p0[1]) * n[1] < 0, 'outward normal');
  }
  assert.equal(inTriangle(data.RAMPS.ramp.planes[17].v, 2.9, 0.9), true);
  assert.equal(inTriangle(data.RAMPS.ramp.planes[17].v, 5, 5), false);
  assert.deepEqual(orientAgainst([0, 0], [1, 0], 0, 1), [[0, 0], [1, 0]]);
  assert.deepEqual(orientAgainst([0, 0], [1, 0], 0, -1), [[1, 0], [0, 0]]);
});

test('Flipper: shape, motion state machine, boost on the front side, damping on the back side, idle = wall', () => {
  const def = data.FLIPPERS[0];
  const f = new Flipper(def, 0.3);
  near(f.reach, 2.3571, 2e-3);
  near(f.invT1, 3.0407, 1e-3);
  assert.equal(f.idle, true);
  // rest shape: pivot circle r 0.611, tip circle r 0.493
  near(f.pivotCircle.r, 0.610981, 1e-9); near(f.tipCircle.r, 0.493308, 1e-9);
  near(f.tipCircle.cx, def.restTip[0], 1e-9);
  // swing to the raised angle: the tip ends at the raised tip (0.961, 11.007)
  f.setMotion(true);
  assert.equal(f.flag, 1);
  near(Math.abs(f.ms), 30.38, 0.01);
  for (let i = 0; i < 6; i++) { f.stepAngle(1 / 120); for (let k = 0; k <= f.k; k++) f.collideAndRotate(f.dA, []); }
  assert.ok(f.idle);
  near(f.cur, def.angleMax, 1e-12);
  near(f.cTipX, def.raisedTip[0], 0.02); near(f.cTipY, def.raisedTip[1], 0.02);
  // idle flipper is a plain wall: hit at the middle of line A, e = 0.75, no boost
  const mkB = () => { const b = new Ball(1, 0, 0); b.dx = 0; b.dy = 1; b.speed = 10; return b; };
  const wall = mkB();
  f.hit(wall, 1.5, 11.5, 0, -1);
  near(wall.speed, 7.5, 1e-9);
  // retracting flipper: a contact on the leading side along the line normal gets 0.9 * v boost, v = |ms| * sqrt(r2/reach^2)
  f.setMotion(false);
  const mover = mkB();
  const lineB = f.lineB;
  const cx = (lineB.x0 + lineB.x1) / 2, cy = (lineB.y0 + lineB.y1) / 2;
  mover.dx = -lineB.nx; mover.dy = -lineB.ny; mover.speed = 2;
  f.hit(mover, cx, cy, lineB.nx, lineB.ny);
  const r2 = (cx - f.ox) ** 2 + (cy - f.oy) ** 2;
  const boost = 0.9 * 1 * Math.abs(f.ms) * Math.sqrt(r2 / f.reachSq);
  near(mover.speed, 2 * 0.75 + boost, 1e-6, 'front-side boost');
  // the back side is damped: e = (1 - sqrt(r2/reach^2)) * 0.75 and no boost
  const back = mkB();
  back.dx = lineB.nx; back.dy = lineB.ny; back.speed = 6;                 // moving against the normal's opposite: contact on the trailing side
  f.hit(back, f.lineA.x0, f.lineA.y0, -lineB.nx, -lineB.ny);
  assert.ok(back.speed < 6, 'damped, no boost');
});

// ======================================================================================================================================
// Fuzz soak: random commands never throw, balls stay finite, every event matches its contract shape
// ======================================================================================================================================
const SHAPES = {
  bumperHit: ['name', 'impact'], rebounderHit: ['name', 'impact'], popupHit: ['name'], popupUp: ['name'], soloHit: ['name', 'impact'],
  rolloverEnter: ['name'], tripwire: ['name'], oneway: ['name'], onewaySide: ['name', 'impact'], rampLine1: [], rampEnter: ['ramp'],
  rampExit: ['ramp', 'mask'], rampHoleCaptured: [], rampHoleReleased: [], kickoutCapture: ['id'], kickoutEject: ['id'], sinkCapture: ['id'],
  sinkEject: ['id', 'from'], flagFrame: ['name', 'frame', 'dir'], flagLoop: ['name'], kickbackFired: ['id'], kickbackTimerExpired: ['id'],
  blockerHit: ['impact'], drain: ['ballId', 'remaining', 'via'], plungerFed: ['ballId'], plungerPull: [], plungerRelease: ['boost', 'hitBall'],
  stuckRelaunch: [], flipper: ['side', 'action', 'byKey'], nudge: ['dir'], nudgeCount: ['level', 'count'], demoTrigger: ['id'],
  flipperHit: ['side', 'ballId', 'speed'],
};

test('every PhysicsEvent type of EVENT_TYPES has a payload shape in this suite (new event types must be added)', () => {
  assert.deepEqual(Object.keys(SHAPES).sort(), [...data.EVENT_TYPES].sort());
});

test('fuzz: 3 x 40 s of random commands - no exception, finite balls inside the table, every event matches the PhysicsEvent contract', () => {
  const seen = new Set();
  for (const seed of [1, 2, 3]) {
    const rnd = mulberry32(seed * 7919);
    const p = createPhysics({ rand: mulberry32(seed) });
    p.setDemoTriggers(seed === 3);
    p.startFeed();
    let drained = 0;
    for (let i = 0; i < 40 * 120; i++) {
      const r = rnd();
      if (i % 7 === 0) {
        if (r < 0.10) p.setFlipperButton(rnd() < 0.5 ? 'left' : 'right', rnd() < 0.5);
        else if (r < 0.14) p.setPlungerButton(rnd() < 0.5);
        else if (r < 0.17) p.nudge(['left', 'right', 'bottom'][Math.floor(rnd() * 3)], rnd() < 0.7);
        else if (r < 0.1925) p.spawnBall(5.5 + rnd(), 2 + rnd() * 3, { mask: 4, vx: (rnd() - 0.5) * 10, vy: (rnd() - 0.5) * 10 });
        else if (r < 0.19) p.spawnBall(-7 + rnd() * 14, -10 + rnd() * 22, { vx: (rnd() - 0.5) * 30, vy: (rnd() - 0.5) * 30, mask: 1 });
        else if (r < 0.21) p.gateSetEnabled(1 + Math.floor(rnd() * 2), rnd() < 0.5);
        else if (r < 0.22) p.blockerSetEnabled(rnd() < 0.5);
        else if (r < 0.24) p.popupReenable(rnd() < 0.5 ? 'all' : 'a_targ' + (1 + Math.floor(rnd() * 9)), rnd() < 0.3);
        else if (r < 0.25) p.kickoutSetActive(1 + Math.floor(rnd() * 3), rnd() < 0.7);
        else if (r < 0.255) p.setTiltLock(rnd() < 0.5);
        else if (r < 0.26) p.setFlippersEnabled(rnd() < 0.8);
        else if (r < 0.262) p.launchInstant();
        else if (r < 0.264) p.relaunch();
        else if (r < 0.265) p.startFeed({ delay: rnd() });
        else if (r < 0.266) p.forceDrainAll();
        else if (r < 0.2665) p.removeAllBalls();
        else if (r < 0.267) p.resetTable();
        else if (r < 0.28) { if (p.debugGrab(-6 + rnd() * 12, rnd() * 10)) p.debugDrag(rnd() * 4, rnd() * 10); }
        else if (r < 0.29) p.debugRelease();
      }
      p.step();
      for (const e of p.drainEvents()) {
        seen.add(e.type);
        const need = SHAPES[e.type];
        assert.ok(need, `unknown event type ${e.type}`);
        assert.ok(Number.isFinite(e.t));
        for (const k of need) assert.ok(k in e, `${e.type} lacks ${k}`);
        if (e.type === 'drain') { drained++; assert.ok(['drain', 'sinkTilt', 'forced'].includes(e.via)); assert.ok(e.remaining >= 0); }
        if (e.type === 'kickoutCapture' && rnd() < 0.5) p.kickoutSetHold(e.id, rnd() * 2);
        if (e.type === 'sinkCapture') p.sinkSetRoute(e.id, [1, 2, 3, 7][Math.floor(rnd() * 4)], rnd() < 0.5 ? undefined : rnd() * 3);
      }
      const snap = p.snapshot();
      for (const b of snap.balls) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && Number.isFinite(b.speed), 'finite ball');
        assert.ok(b.speed <= 60 + 1e-9, `reported speed ${b.speed}`);
        assert.ok(b.x > -10.5 && b.x < 10.5 && b.y > -15.5 && b.y < 16.5, `ball escaped: ${b.x}, ${b.y}`);
      }
      assert.ok(p.ballsInPlay() <= 20);
    }
    assert.ok(drained >= 0);
  }
  for (const t of ['flipper', 'plungerFed', 'plungerPull', 'drain', 'bumperHit', 'rolloverEnter', 'nudge']) assert.ok(seen.has(t), `fuzz exercised ${t}`);
});

test('everything importable: factories need no DOM / window / document (pure Node module)', () => {
  assert.equal(typeof createPhysics, 'function');
  assert.equal(typeof globalThis.window, 'undefined');
  const p = createPhysics();                                     // default Math.random
  p.spawnBall(0, 0);
  stepN(p, 10);
  assert.equal(p.ballsInPlay(), 1);
  void without;
});
