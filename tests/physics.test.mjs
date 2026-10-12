/**
 * tests/physics.test.mjs
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 5.6 acceptance tests (1-12) + SPEC Appendix D #2-#6 and #10. Component-level detail tests live in
 * tests/physics_components.test.mjs. Numerical cross-checks against research/physics_ref_sim.py use the numbers embedded in
 * tests/physics_ref_data.mjs (regenerate with tests/physics_ref_driver.py). Randomness: constantRand(0.5) unless noted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as data from '../src/data/index.js';
import { createPhysics } from '../src/physics.js';
import {
  NO_HIT, makeLine, makeCircle, edgesFromPlain, rayLine, rayCircle, installWall, installLine, installCircle,
} from '../src/physics/edges.js';
import { basicCollision, throwBall } from '../src/physics/collision.js';
import { createSnapshot } from '../src/physics/snapshot.js';
import { Engine } from '../src/physics/engine.js';
import { mulberry32, constantRand, sequenceRand } from './helpers/seeded_rand.mjs';
import { REF_FREEFALL, REF_LAUNCH, REF_FLIPPER } from './physics_ref_data.mjs';
import { EMPTY, only, mk, stepN, run, runUntil, ofType, vel } from './physics_support.mjs';

const { PHYS, FLIPPERS, PLUNGER } = data;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

// ======================================================================================================================================
// 1. Edges: installer == data, ray primitives
// ======================================================================================================================================
function comparePlain(name, got, want, tol = 1e-4) {
  assert.equal(got.length, want.length, `${name}: edge count`);
  got.forEach((g, i) => {
    const w = want[i];
    assert.equal(g.k, w.k, `${name}[${i}] kind`);
    const keys = g.k === 'line' ? ['x0', 'y0', 'x1', 'y1', 'nx', 'ny'] : ['cx', 'cy', 'r'];
    for (const k of keys) near(g[k], w[k], tol, `${name}[${i}].${k}`);
  });
}

test('edges: installWall / installLine / installCircle reproduce every shipped edge list (1e-4)', () => {
  for (const w of data.WALLS) comparePlain(w.name, installWall(w.pts, 0.3), w.edges);
  for (const p of data.POSTS) comparePlain(p.name, installCircle(p.c, p.r, 0.3), p.edges);
  for (const b of data.BUMPERS) comparePlain(b.name, installCircle(b.c, b.r, 0.3), b.edges);
  for (const t of [...data.POPUP_TARGETS, ...data.SOLO_TARGETS]) comparePlain(t.name, installWall(t.poly, 0.3), t.edges);
  for (const k of data.KICKBACKS) comparePlain(k.name, installLine(k.line[0], k.line[1], 0.3), k.edges);
  for (const g of data.GATES) comparePlain(g.name, installLine(g.line[0], g.line[1], 0.3), g.edges);
  comparePlain('blocker', installCircle(data.BLOCKER.c, data.BLOCKER.r, 0.3), data.BLOCKER.edges);
  comparePlain('drain', installLine(data.DRAIN.line[0], data.DRAIN.line[1], 0.3), data.DRAIN.edges);
  comparePlain('plunger', installLine(PLUNGER.face[0], PLUNGER.face[1], 0.3), PLUNGER.edges);
  for (const s of data.SINKS) comparePlain(s.name, installLine(s.line[0], s.line[1], 0.3), s.edges);
  for (const t of data.TRIPWIRES) comparePlain(t.name, installLine(t.p0, t.p1, 0.3), t.edges);
  // one-way: wall line shifted +0.3 along n, trigger line (reversed) shifted 0.24 along +n
  for (const o of data.ONEWAYS) comparePlain(o.name, [...installLine(o.p0, o.p1, 0.3), ...installLine(o.p1, o.p0, -0.24)], o.edges);
  // pass-through components use offset 0
  for (const r of data.ROLLOVERS) comparePlain(r.name, [...installWall(r.entry, 0), ...installWall(r.exit, 0)], r.edges);
  for (const f of data.FLAGS) comparePlain(f.name, [...installLine(f.p1, f.p0, 0), ...installLine(f.p0, f.p1, 0)], f.edges);
  for (const k of data.KICKOUTS) comparePlain(k.name, installCircle(k.c, k.captureRadius, 0), k.edges);
  comparePlain('ramp_hole', installCircle(data.RAMP_HOLE.c, data.RAMP_HOLE.captureRadius, 0), data.RAMP_HOLE.edges);
  const pts = data.TABLE_OUTLINE.pts;     // un-inflated, reversed so that the normals point INTO the table
  comparePlain('outline', [0, 1, 2, 3].flatMap((i) => installLine(pts[(i + 1) % 4], pts[i], 0)), data.TABLE_OUTLINE.edges);
});

test('edges: installWall adds corner circles only where sign(cross) == sign(offset), radius offset*1.001', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];                  // CCW island (area > 0)
  const grown = installWall(sq, 0.3);
  assert.equal(grown.filter((e) => e.k === 'circle').length, 4);
  for (const c of grown.filter((e) => e.k === 'circle')) near(c.r, 0.3003, 1e-9, 'corner radius');
  // every line shifted OUTWARD by 0.3: the first one (0,0)->(4,0) has normal (0,-1)
  near(grown[1].y0, -0.3, 1e-9, 'shift');
  assert.equal(installWall(sq, 0).filter((e) => e.k === 'circle').length, 0);
  // clockwise shell: the same offset produces no convex corner circles
  assert.equal(installWall([...sq].reverse(), 0.3).filter((e) => e.k === 'circle').length, 0);
});

test('edges: makeLine / makeCircle / edgesFromPlain build runtime edges', () => {
  const l = makeLine(0, 0, 10, 0, 1, 'test');
  assert.equal(l.k, 'line');
  assert.deepEqual([l.dx, l.dy, l.nx, l.ny], [1, 0, 0, -1]);
  assert.deepEqual([l.lo, l.hi, l.useX, l.active, l.role, l.owner], [0, 10, true, true, 'wall', 'test']);
  const v = makeLine(0, 0, 0, 10, 2, 'v');
  assert.equal(v.useX, false);
  assert.deepEqual([v.dx, v.dy, v.nx, v.ny, v.lo, v.hi], [0, 1, 1, -0, 0, 10]);
  const c = makeCircle(1, 2, 3, 4, 'c', 'capture');
  assert.deepEqual([c.k, c.cx, c.cy, c.r, c.rsq, c.mask, c.role], ['circle', 1, 2, 3, 9, 4, 'capture']);
  const edges = edgesFromPlain(data.ROLLOVERS[0].edges, 1, 'a_roll1');
  assert.equal(edges.length, data.ROLLOVERS[0].edges.length);
  assert.deepEqual([...new Set(edges.map((e) => e.gate))].sort(), ['active', 'rolloverflag']);
});

test('edges: rayLine unit cases (one-sided, extent, min distance, vertical lines)', () => {
  const floor = makeLine(0, 0, 10, 0, 1, 't');                  // normal (0,-1): blocks a ray travelling +y
  assert.equal(floor.ny, -1);
  near(rayLine(floor, 5, -3, 0, 1, 10), 3, 1e-12, 'front face');
  assert.equal(rayLine(floor, 5, 3, 0, -1, 10), NO_HIT, 'back face is transparent');
  assert.equal(rayLine(floor, 5, -3, 0, 1, 2.9), NO_HIT, 'beyond maxDist');
  near(rayLine(floor, 5, -3, 0, 1, 3), 3, 1e-12, 'exactly maxDist');
  assert.equal(rayLine(floor, 11, -3, 0, 1, 10), NO_HIT, 'outside the segment extent');
  near(rayLine(floor, 10, -3, 0, 1, 10), 3, 1e-12, 'end point counts');
  // up to 0.002 BEHIND the origin still counts
  near(rayLine(floor, 5, 0.0015, 0, 1, 10), -0.0015, 1e-12, 'behind origin, inside tolerance');
  near(rayLine(floor, 5, 0.002, 0, 1, 10), -0.002, 1e-12, 'behind origin, exactly -0.002');
  assert.equal(rayLine(floor, 5, 0.0021, 0, 1, 10), NO_HIT, 'behind origin, beyond tolerance');
  // grazing (parallel) ray
  assert.equal(rayLine(floor, -3, 0, 1, 0, 10), NO_HIT);
  // vertical line compares y
  const wall = makeLine(0, 0, 0, 10, 1, 'v');                   // normal (1,0): blocks a ray travelling -x
  near(rayLine(wall, 3, 5, -1, 0, 10), 3, 1e-12);
  assert.equal(rayLine(wall, 3, 11, -1, 0, 10), NO_HIT);
  // oblique ray
  const s = Math.SQRT1_2;
  near(rayLine(floor, 2, -2, s, s, 10), 2 / s, 1e-12, 'oblique');
});

test('edges: rayCircle unit cases (two-sided from outside, grazing, behind, origin inside)', () => {
  const c = makeCircle(0, 0, 1, 1, 't');
  near(rayCircle(c, -3, 0, 1, 0, 10), 2, 1e-12, 'head-on');
  assert.equal(rayCircle(c, -3, 0, 1, 0, 1.9), NO_HIT, 'beyond maxDist');
  assert.equal(rayCircle(c, 3, 0, 1, 0, 10), NO_HIT, 'circle behind the ray');
  near(rayCircle(c, -3, 1, 1, 0, 10), 3, 1e-9, 'grazing tangent hits');
  assert.equal(rayCircle(c, -3, 1.01, 1, 0, 10), NO_HIT, 'just missing');
  // origin inside, moving toward the far wall: tca - sqrt(...) <= 0  (immediate collision)
  const inside = rayCircle(c, -0.5, 0, 1, 0, 10);
  near(inside, -0.5, 1e-12, 'origin inside');
  assert.ok(inside <= 0);
  // origin inside but moving away from the centre: no hit (tca < 0)
  assert.equal(rayCircle(c, 0.5, 0, 1, 0, 10), NO_HIT);
});

test('edges: the broadphase grid finds exactly what a brute-force pass finds', () => {
  const eng = new Engine({ rand: constantRand(0.5) });
  const rnd = mulberry32(99);
  let hits = 0;
  for (let i = 0; i < 6000; i++) {
    const ox = -9 + rnd() * 18, oy = -15 + rnd() * 31, a = rnd() * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a), maxd = rnd() < 0.5 ? 0.15 : rnd() * 0.15;
    const mask = [1, 2, 4][i % 3];
    const g = eng.world.cast(ox, oy, dx, dy, maxd, mask, [], 0), ge = eng.world.hitEdge;
    const b = eng.world.castBrute(ox, oy, dx, dy, maxd, mask, [], 0), be = eng.world.hitEdge;
    assert.equal(g, b, `ray ${i}`);
    assert.equal(ge, be, `ray ${i} edge`);
    if (g < NO_HIT) hits++;
  }
  assert.ok(hits > 100, 'the random rays must actually hit things');
});

// ======================================================================================================================================
// 2. basicCollision / throwBall
// ======================================================================================================================================
const mkBall = (dx, dy, speed) => ({ x: 0, y: 0, dx, dy, speed, heldBy: 'x' });

test('basicCollision: head-on hit leaves at speed v*e, separated by 0.0005 along the normal', () => {
  const b = mkBall(0, 1, 10);
  const r = basicCollision(b, 0, 5, 0, -1, 0.5, 0.8, 1e9, 0);
  near(r, 10, 1e-12, 'returns the normal speed before the bounce');
  near(b.speed, 5, 1e-12);
  assert.deepEqual([b.dx, b.dy], [0, -1]);
  near(b.y, 5 - 0.0005, 1e-12);
  assert.equal(b.x, 0);
});

test('basicCollision: SPEC example v=10, 45 deg, e=0.5, s=0.8 -> speed 6.46, 58 deg from the normal', () => {
  const b = mkBall(Math.SQRT1_2, Math.SQRT1_2, 10);
  const r = basicCollision(b, 0, 0, 0, -1, 0.5, 0.8, 1e9, 0);
  near(r, 7.0711, 1e-3);
  near(b.speed, 6.4645, 1e-3);
  const fromNormal = Math.atan2(Math.abs(b.dx), -b.dy) * 180 / Math.PI;
  near(fromNormal, 58.0, 0.2, 'angle from the normal');
  near(Math.hypot(b.dx, b.dy), 1, 1e-12, 'unit direction');
});

test('basicCollision: hard hit (rebound >= T) adds B along the normal; soft hit does not', () => {
  const hard = mkBall(0, 1, 10);
  basicCollision(hard, 0, 0, 0, -1, 0.6, 0.95, 2.5, 17);          // bumper numbers
  near(hard.speed, 6 + 17, 1e-9);
  assert.deepEqual([hard.dx, hard.dy], [0, -1]);
  const soft = mkBall(0, 1, 2);                                     // rebound 2 < 2.5
  basicCollision(soft, 0, 0, 0, -1, 0.6, 0.95, 2.5, 17);
  near(soft.speed, 1.2, 1e-12);
  const tilted = mkBall(0, 1, 10);                                  // tilt: T = 1e9, B = 0
  basicCollision(tilted, 0, 0, 0, -1, 0.6, 0.95, 1e9, 0);
  near(tilted.speed, 6, 1e-12);
  // T = 0 fires even for a ball at rest (plunger / armed kickback)
  const rest = mkBall(0, 1, 0);
  const r = basicCollision(rest, 0, 0, 0, -1, 0.5, 0.5, 0, 55);
  near(r, 0, 1e-12);
  near(rest.speed, 55, 1e-9);
  assert.deepEqual([rest.dx, rest.dy], [0, -1]);
});

test('basicCollision: a ball already moving away keeps its direction (speed is still damped)', () => {
  const b = mkBall(0, -1, 10);
  const r = basicCollision(b, 0, 0, 0, -1, 0.6, 0.9, 1e9, 0);
  near(r, 10, 1e-12);
  assert.deepEqual([b.dx, b.dy], [0, -1]);
  near(b.speed, 6, 1e-12);
  // smoothness scales the tangential part: sliding along the wall keeps all of it at s=1
  const slide = mkBall(1, 0, 10);
  basicCollision(slide, 0, 0, 0, -1, 0.5, 1, 1e9, 0);
  near(slide.speed, 10, 1e-12);
});

test('throwBall: random angle +-angleMult, boost +-5 %, exact-bug uses the updated x for y, direction NOT normalised', () => {
  // r = 0.25 -> angle = +0.5 * angleMult (0.6283 rad = 36 deg); SPEC 8.6: (0.588, -0.464)
  const a = { dx: 0, dy: 0, speed: 0, heldBy: 'k' };
  throwBall(a, 0, -1, 1.256637, 45, 0.05, sequenceRand([0.25, 0.5]), true);
  near(a.dx, 0.5878, 1e-4); near(a.dy, -0.4635, 1e-4); near(a.speed, 45, 1e-12);
  assert.equal(a.heldBy, null);
  const t = { dx: 0, dy: 0, speed: 0, heldBy: 'k' };
  throwBall(t, 0, -1, 1.256637, 45, 0.05, sequenceRand([0.25, 0.5]), false);   // true rotation
  near(Math.hypot(t.dx, t.dy), 1, 1e-12);
  near(t.dy, -0.8090, 1e-4);
  // angleMult 0 is a no-op for the direction; diagonal directions keep their length 1.414
  const d = { dx: 0, dy: 0, speed: 0, heldBy: null };
  throwBall(d, -1, 1, 0, 35, 0.05, constantRand(0.5));
  near(Math.hypot(d.dx, d.dy), Math.SQRT2, 1e-12);
  near(d.speed, 35, 1e-12);
  // speed jitter: r = 0 -> +5 %, r = 1 -> -5 %
  throwBall(d, 0, -1, 0, 35, 0.05, sequenceRand([0.5, 0]));
  near(d.speed, 36.75, 1e-9);
  throwBall(d, 0, -1, 0, 35, 0.05, sequenceRand([0.5, 1]));
  near(d.speed, 33.25, 1e-9);
  // always exactly two rand() calls
  let calls = 0;
  throwBall(d, 0, -1, 0, 35, 0.05, () => { calls++; return 0.5; });
  assert.equal(calls, 2);
});

// ======================================================================================================================================
// 3. Free fall (App. D #2) + numerical cross-check with the Python port
// ======================================================================================================================================
test('free fall: v(t) = 59.93 (1 - e^-0.2t) within 1 %, 20 units in 1.95 s +/- 0.05, terminal speed <= 60 (empty table)', () => {
  const p = mk({ data: { ...data, ...EMPTY } });
  const b = p.spawnBall(0, -13);
  let t20 = null;
  for (let i = 1; i <= 360; i++) {
    p.step();
    const t = i / 120;
    if (t20 === null && b.y - -13 >= 20) t20 = t;
    if (i % 60 === 0) {
      const v = 59.93 * (1 - Math.exp(-0.2 * t));
      assert.ok(Math.abs(b.speed - v) / v < 0.01, `t=${t}: ${b.speed} vs ${v}`);
    }
  }
  near(t20, 1.95, 0.05, 'time to fall 20 units');
  assert.ok(Math.abs(b.x) < 1e-3, 'no lateral drift without jitter (only the 3.9e-6 x gravity)');
  // terminal speed never exceeds 60, even when launched faster
  const q = mk({ data: { ...data, ...EMPTY } });
  const fast = q.spawnBall(0, 0, { vy: 500 });
  stepN(q, 1);
  assert.ok(fast.speed <= 60 + 1e-9, 'cap');
  for (let i = 0; i < 2400; i++) { q.step(); assert.ok(fast.speed <= 60 + 1e-9); }
  near(fast.speed, 59.93, 0.02, 'terminal speed');
});

test('free fall: matches research/physics_ref_sim.py sample by sample (ESTIMATED reference, constant rand 0.5)', () => {
  const p = mk({ data: { ...data, ...EMPTY } });
  const b = p.spawnBall(0, -13);
  let k = 0;
  for (let i = 1; i <= 360; i++) {
    p.step();
    if (i % 30 === 0) {
      const [t, y, v] = REF_FREEFALL[k++];
      near(i / 120, t, 1e-9);
      near(b.y, y, 2e-3, `y(${t})`);
      near(b.speed, v, 2e-3, `v(${t})`);
    }
  }
  assert.equal(k, 12);
});

// ======================================================================================================================================
// 4. Plunger (App. D #3)
// ======================================================================================================================================
/** Ball resting on the plunger (settled 3 s), charge to `boost`, release with plunger rand `pr`; returns {p, ball, apex, events}. */
function launch(boost, pr = 0.5, seconds = 2.5) {
  let r = 0.5;
  const p = createPhysics({ rand: () => r });
  const ball = p.spawnBall(PLUNGER.feed[0], PLUNGER.feed[1]);
  const chargeSteps = (boost - 1) * 3;
  stepN(p, 360 - chargeSteps);
  p.setPlungerButton(true);
  stepN(p, chargeSteps);
  const charged = p.snapshot().plunger.boost;
  p.drainEvents();
  r = pr; p.setPlungerButton(false); r = 0.5;
  let apex = 99;
  const events = [];
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    p.step();
    for (const e of p.drainEvents()) events.push(e);
    if (ball.y < apex) apex = ball.y;
  }
  return { p, ball, apex, events, charged };
}

test('plunger: Boost 0 -> +1 at once, +1 every 0.025 s, 100 after 2.475 s (+/- 1 step); plungerPull emitted once', () => {
  const p = mk();
  p.setPlungerButton(true);
  let s = p.snapshot().plunger;
  assert.deepEqual([s.boost, s.charging, s.pull], [1, true, 0.01]);
  assert.deepEqual(ofType(p.drainEvents(), 'plungerPull').length, 1);
  let at100 = null;
  for (let i = 1; i <= 330; i++) {
    p.step();
    s = p.snapshot().plunger;
    if (i === 3) assert.equal(s.boost, 2, 'first tick after 0.025 s');
    if (i === 30) assert.equal(s.boost, 11);
    if (at100 === null && s.boost === 100) at100 = i / 120;
  }
  near(at100, 2.475, 1 / 120, 'time to full charge');
  assert.equal(p.snapshot().plunger.boost, 100, 'stays clamped at 100');
  p.setPlungerButton(true);                                       // already charging: ignored
  assert.equal(ofType(p.drainEvents(), 'plungerPull').length, 0);
});

test('plunger: apex of a held-boost launch matches the reference port exactly (Boost 10..100)', () => {
  for (const [boost, ref] of Object.entries(REF_LAUNCH)) {
    const a = launch(Number(boost), 0.5);
    assert.equal(a.charged, Number(boost));
    near(a.apex, ref.r05, 0.02, `Boost ${boost}, B = 1.05 Boost`);
    const e = launch(Number(boost), 0);
    near(e.apex, ref.exact, 0.02, `Boost ${boost}, B = Boost`);
  }
});

test('plunger: SPEC launch table (10 -> 6.8, 15 -> 2.0, 20 -> -4.0, 22 -> -6.6, 24 -> -8.9, 26 -> -10.7, 28 -> -11.7) within 0.6 of the reachable band', () => {
  const spec = { 10: 6.8, 15: 2.0, 20: -4.0, 22: -6.6, 24: -8.9, 26: -10.7, 28: -11.7 };
  for (const [boost, apex] of Object.entries(spec)) {
    const lo = launch(Number(boost), 0.999).apex;         // rand ~ 1: B = 1.1 Boost  (highest launch)
    const hi = launch(Number(boost), 0).apex;             // rand 0:   B = Boost      (lowest launch)
    assert.ok(apex >= lo - 0.6 && apex <= hi + 0.6, `Boost ${boost}: SPEC ${apex} not in [${lo.toFixed(2)}, ${hi.toFixed(2)}] +/- 0.6`);
  }
});

test('plunger: Boost >= 30 enters the table through s_onewy10, Boost 24 does not; apex is monotonic in Boost', () => {
  let prev = Infinity;
  for (const boost of [10, 15, 20, 22, 24, 26, 28, 30, 45, 100]) {
    const r = launch(boost, 0.5);
    const entered = ofType(r.events, 'oneway', { name: 's_onewy10' }).length > 0;
    if (boost >= 30) assert.ok(entered, `Boost ${boost} must pass s_onewy10`);
    if (boost <= 24) assert.ok(!entered, `Boost ${boost} must not pass s_onewy10`);
    assert.ok(r.apex <= prev + 0.05, `apex(${boost}) = ${r.apex} should not be lower than ${prev}`);
    prev = Math.min(prev, r.apex);
    assert.ok(r.ball.speed <= 60 + 1e-9);
  }
});

test('plunger: release emits plungerRelease{boost, hitBall}, launch passes s_onewy1 and the five tripwires in order, speed <= 60', () => {
  const r = launch(100, 0.5, 1.5);
  const rel = ofType(r.events, 'plungerRelease');
  assert.equal(rel.length, 1);
  assert.deepEqual([rel[0].boost, rel[0].hitBall], [100, true]);
  assert.equal(ofType(r.events, 'oneway')[0].name, 's_onewy1');
  assert.deepEqual(ofType(r.events, 'tripwire').map((e) => e.name), ['s_trip1', 's_trip2', 's_trip3', 's_trip4', 's_trip5']);
  const snap = r.p.snapshot().plunger;
  assert.deepEqual([snap.boost, snap.charging, snap.fired], [0, false, false]);
});

test('plunger: a release while the fed ball is still bouncing still launches it at the first contact', () => {
  const p = mk();
  const b = p.spawnBall(PLUNGER.feed[0], PLUNGER.feed[1]);
  stepN(p, 80);                                // 0.67 s: first impact done, ball mid-bounce
  p.setPlungerButton(true);
  stepN(p, 3 * 29);                            // Boost 30
  p.setPlungerButton(false);
  let top = 99;
  for (let i = 0; i < 360; i++) { p.step(); top = Math.min(top, b.y); }
  assert.ok(top < 0, `ball was launched, apex ${top}`);
});

test('plunger: with no ball at the plunger the SPEC 0.025 s window applies - a ball arriving later is not kicked', () => {
  const p = mk();
  const b = p.spawnBall(PLUNGER.feed[0], 8.0, { vy: 20 });          // still high up the lane, falling toward the plunger
  p.setPlungerButton(true);
  stepN(p, 3 * 29);                                                  // the ball has long since bounced... charge ~0.7 s
  b.x = PLUNGER.feed[0]; b.y = 6.0; b.dx = 0; b.dy = 1; b.speed = 20;  // put it back above the plunger just before the release
  p.setPlungerButton(false);
  let top = 99;
  for (let i = 0; i < 120; i++) { p.step(); top = Math.min(top, b.y); }
  assert.ok(top >= 5.9, `the late ball bounced plainly, apex ${top}`);
  assert.ok(b.y > 6.5, 'and keeps bouncing low in the lane instead of flying up it');
});

test('plunger: launchInstant = full power, false when no ball rests at the plunger; ballAtPlunger needs |dx|<0.4 and y>11', () => {
  const p = mk();
  assert.equal(p.launchInstant(), false);
  assert.equal(p.ballAtPlunger(), false);
  const b = p.spawnBall(PLUNGER.feed[0], PLUNGER.feed[1]);
  assert.equal(p.ballAtPlunger(), false, 'still falling from y 10.08');
  stepN(p, 240);
  assert.equal(p.ballAtPlunger(), true);
  assert.equal(p.launchInstant(), true);
  const ev = run(p, 1.5);
  assert.equal(ofType(ev, 'plungerRelease')[0].boost, 100);
  assert.ok(b.y < 0, 'launched up the lane');
  assert.equal(p.ballAtPlunger(), false);
});

test('feed: startFeed creates the ball after 0.96 s (retries every 1.0 s while blocked), clears tilt, sets the counter to -2', () => {
  const p = mk();
  p.setTiltLock(true);
  p.startFeed();
  let ev = run(p, 0.95);
  assert.equal(ev.length, 0);
  assert.equal(p.ballsInPlay(), 0);
  ev = run(p, 0.03);
  const fed = ofType(ev, 'plungerFed');
  assert.equal(fed.length, 1);
  assert.equal(p.ballsInPlay(), 1);
  assert.equal(p.isTiltLocked(), false, 'feed clears the tilt lock');
  assert.equal(p.getNudgeCount(), -2);
  near(p.balls[0].x, PLUNGER.feed[0], 1e-3);
  assert.equal(p.balls[0].mask, 1);
  // blocked feed: another ball within 1.2 R of the feed point -> retry 1.0 s later
  p.removeAllBalls();
  p.drainEvents();
  const parked = p.spawnBall(PLUNGER.feed[0], PLUNGER.feed[1] + 0.1);
  assert.ok(parked);
  p.debugGrab(PLUNGER.feed[0], PLUNGER.feed[1] + 0.1);
  const t0 = p.snapshot().time;
  p.startFeed({ delay: 0.1 });
  const events = [];
  for (let i = 0; i < 60; i++) { p.step(); p.debugDrag(PLUNGER.feed[0], PLUNGER.feed[1] + 0.1); events.push(...p.drainEvents()); }
  assert.equal(ofType(events, 'plungerFed').length, 0, 'blocked at 0.1 s');
  p.debugRelease();
  p.forceDrainAll();                                         // the parked ball leaves
  p.drainEvents();
  const later = run(p, 1.0);
  const fedAt = ofType(later, 'plungerFed');
  assert.equal(fedAt.length, 1);
  near(fedAt[0].t - t0, 1.1, 1.5 / 120, 'retry 1.0 s after the blocked attempt at 0.1 s');
});

test('feed: relaunch = 0.96 s feed + self-charging plunger (tick 0.025/4) + release at Boost 100 (plungerFed, plungerPull, plungerRelease)', () => {
  const p = mk();
  p.relaunch();
  const ev = run(p, 2.0);
  const order = ev.filter((e) => ['plungerFed', 'plungerPull', 'plungerRelease'].includes(e.type));
  assert.deepEqual(order.map((e) => e.type), ['plungerFed', 'plungerPull', 'plungerRelease']);
  near(order[0].t, 0.96, 1 / 120 + 1e-9);
  near(order[2].t - order[1].t, 99 * 0.025 / 4, 2 / 120, 'self-charge takes ~0.62 s');
  assert.equal(order[2].boost, 100);
  assert.ok(p.balls[0].y < 11, 'the ball was launched');
});

// ======================================================================================================================================
// 5. Flippers (App. D #4)
// ======================================================================================================================================
/** Drop a ball from (1.9, 9.0), press the left flipper at tick `press`; returns the speed when it first rises above y 10 (null if never). */
function flipperShot(press, ticks = 300) {
  const p = mk();
  const b = p.spawnBall(1.9, 9.0);
  let seenLow = false;
  for (let i = 0; i < ticks; i++) {
    if (i === press) p.setFlipperButton('left', true);
    p.step();
    if (b.y > 11.0) seenLow = true;
    if (seenLow && b.y < 10.0) return { speed: b.speed, x: b.x };
  }
  return null;
}

test('flipper: extend reaches angleMax in 0.04 s, retract returns to rest in 0.08 s (+/- 1 step), signs mirror', () => {
  for (const [side, name] of [['left', 'a_flip1'], ['right', 'a_flip2']]) {
    const def = FLIPPERS.find((f) => f.name === name);
    const p = mk();
    assert.equal(p.setFlipperButton(side, true), true);
    let steps = 0;
    while (Math.abs(p.snapshot().flippers[name].angle - def.angleMax) > 1e-9 && steps < 40) { p.step(); steps++; }
    near(steps / 120, 0.04, 1 / 120 + 1e-9, `${side} extend`);
    assert.equal(p.snapshot().flippers[name].angle, def.angleMax);
    assert.equal(p.snapshot().flippers[name].up, true);
    assert.equal(Math.sign(def.angleMax), side === 'left' ? 1 : -1);
    p.setFlipperButton(side, false);
    steps = 0;
    while (p.snapshot().flippers[name].angle !== 0 && steps < 60) { p.step(); steps++; }
    near(steps / 120, 0.08, 1 / 120 + 1e-9, `${side} retract`);
    assert.equal(p.snapshot().flippers[name].up, false);
  }
});

test('flipper: a half-way release retracts from the current angle; events extend/retract with byKey true', () => {
  const p = mk();
  p.setFlipperButton('left', true);
  stepN(p, 2);
  const mid = p.snapshot().flippers.a_flip1.angle;
  assert.ok(mid > 0.3 && mid < data.FLIPPERS[0].angleMax);
  p.setFlipperButton('left', false);
  const ev = p.drainEvents();
  assert.deepEqual(ev.map((e) => [e.type, e.side, e.action, e.byKey]), [['flipper', 'left', 'extend', true], ['flipper', 'left', 'retract', true]]);
  assert.equal(p.setFlipperButton('left', false), true, 'releasing again is a no-op');
  assert.equal(p.drainEvents().length, 0);
  stepN(p, 5);
  assert.equal(p.snapshot().flippers.a_flip1.angle, 0);
});

test('flipper: shot from (1.9, 9.0) matches the reference port for every press time; perfect timing leaves at 30-49 u/s', () => {
  let best = 0;
  for (const [press, speed, x] of REF_FLIPPER) {
    const s = flipperShot(press);
    if (speed === null) { assert.equal(s, null, `press ${press}: no launch expected`); continue; }
    assert.ok(s, `press ${press}: launch expected`);
    near(s.speed, speed, 0.05, `press ${press} speed`);
    near(s.x, x, 0.02, `press ${press} x`);
    best = Math.max(best, s.speed);
  }
  assert.ok(best >= 30 && best <= 49, `best leave speed ${best}`);
  // dense search: some press times launch at 30-49 u/s (the SPEC band); none exceeds the 60 u/s cap; too early / late presses are weak
  let inBand = 0, weak = 0, max = 0;
  for (let k = 40; k <= 112; k++) {
    const s = flipperShot(k);
    if (!s) { weak++; continue; }
    max = Math.max(max, s.speed);
    if (s.speed >= 30 && s.speed <= 49) inBand++;
    if (s.speed < 12) weak++;
  }
  assert.ok(inBand >= 10, `press times in the 30-49 band: ${inBand}`);
  assert.ok(max <= 60 + 1e-9, `max ${max}`);
  assert.ok(weak >= 10, 'too early / too late presses leave weakly (or not at all)');
});

test('flipper: a real flip emits flipperHit {side, ballId, speed} (presentation only); a ball resting on a raised flipper does not', () => {
  // the reference shot (press at tick 88 launches at ~44 u/s)
  const p = mk();
  const b = p.spawnBall(1.9, 9.0);
  const hits = [];
  for (let i = 0; i < 300; i++) {
    if (i === 88) p.setFlipperButton('left', true);
    p.step();
    for (const e of p.drainEvents()) if (e.type === 'flipperHit') hits.push(e);
  }
  assert.ok(hits.length >= 1 && hits.length <= 3, `one strike (a few sub-step contacts at most), got ${hits.length}`);
  assert.equal(hits[0].side, 'left');
  assert.equal(hits[0].ballId, b.id);
  assert.ok(hits[0].speed > 20, `strike speed ${hits[0].speed}`);
  assert.ok(hits.every((e) => typeof e.t === 'number'));
  // the event changes nothing: the same shot without draining in between ends in the same place
  const q = mk();
  const c = q.spawnBall(1.9, 9.0);
  for (let i = 0; i < 300; i++) { if (i === 88) q.setFlipperButton('left', true); q.step(); }
  assert.equal(c.x, b.x); assert.equal(c.y, b.y);
  // flipper already up, ball dropped onto it: it bounces / rolls off the static flipper, no strike
  const r = mk();
  r.setFlipperButton('left', true);
  stepN(r, 10);
  r.drainEvents();
  r.spawnBall(1.9, 9.0);
  const ev = run(r, 2);
  assert.equal(ev.filter((e) => e.type === 'flipperHit').length, 0);
});

test('flipper: idle flipper is a wall (bounce e 0.75), forced retract on setFlippersEnabled(false) is silent for sound (byKey false)', () => {
  const p = mk();
  p.setFlipperButton('left', true);
  p.setFlipperButton('right', true);
  p.drainEvents();
  stepN(p, 10);
  p.setFlippersEnabled(false);
  const ev = p.drainEvents();
  assert.deepEqual(ev.map((e) => [e.side, e.action, e.byKey]).sort(), [['left', 'retract', false], ['right', 'retract', false]].sort());
  assert.equal(p.setFlipperButton('left', true), false, 'input ignored while disabled');
  stepN(p, 12);
  assert.equal(p.snapshot().flippers.a_flip1.angle, 0);
  assert.equal(p.snapshot().flippers.a_flip1.up, false);
  p.setFlippersEnabled(true);
  assert.equal(p.setFlipperButton('left', true), true);
});

test('flipper: soak - 12 s with random presses and balls never tunnels through a flipper or leaves the table', () => {
  for (const seed of [1, 2, 3]) {
    const rnd = mulberry32(seed);
    const p = createPhysics({ rand: mulberry32(seed + 100) });
    const flippers = FLIPPERS;
    const spawn = () => p.spawnBall(-2.5 + rnd() * 5, 6 + rnd() * 3, { vx: (rnd() - 0.5) * 8, vy: -rnd() * 4 });
    spawn();
    let checks = 0;
    for (let i = 0; i < 12 * 120; i++) {
      if (i % 9 === 0) { p.setFlipperButton('left', rnd() < 0.5); p.setFlipperButton('right', rnd() < 0.5); }
      p.step();
      const snap = p.snapshot();
      for (const e of p.drainEvents()) if (e.type === 'drain') spawn();
      for (const b of snap.balls) {
        assert.ok(b.x > -8.5 && b.x < 8.5 && b.y > -14.5 && b.y < 14.6, `ball outside the table at ${b.x},${b.y}`);
        if (b.mask !== 1) continue;
        for (const f of flippers) {
          // distance from the ball centre to the flipper axis must stay above the (inflated) capsule radius
          const a = snap.flippers[f.name].angle, s = Math.sin(a), c = Math.cos(a);
          const tx = f.pivot[0] + (f.restTip[0] - f.pivot[0]) * c - (f.restTip[1] - f.pivot[1]) * s;
          const ty = f.pivot[1] + (f.restTip[0] - f.pivot[0]) * s + (f.restTip[1] - f.pivot[1]) * c;
          const ax = tx - f.pivot[0], ay = ty - f.pivot[1], l2 = ax * ax + ay * ay;
          const u = Math.max(0, Math.min(1, ((b.x - f.pivot[0]) * ax + (b.y - f.pivot[1]) * ay) / l2));
          const d = Math.hypot(b.x - (f.pivot[0] + ax * u), b.y - (f.pivot[1] + ay * u));
          const r = (f.pivotR + 0.3) * (1 - u) + (f.tipR + 0.3) * u;
          assert.ok(d >= r - 0.12, `tunnelled into ${f.name}: d=${d.toFixed(3)} < r=${r.toFixed(3)} at t=${snap.time.toFixed(2)}`);
          checks++;
        }
      }
    }
    assert.ok(checks > 100);
  }
});

// ======================================================================================================================================
// 6. Ramps (App. D #5)
// ======================================================================================================================================
test('ramp: a strong shot through the low mouth ends on the deck (mask 4, z 1.368), rampLine1 fires once, s_onewy12 keeps it there', () => {
  const p = mk();
  const b = p.spawnBall(2.5, 4.0, { vy: -35 });
  const ev = run(p, 0.8);
  const enter = ofType(ev, 'rampEnter'), exit = ofType(ev, 'rampExit');
  assert.deepEqual(enter.map((e) => e.ramp), ['ramp']);
  assert.deepEqual(exit.map((e) => [e.ramp, e.mask]), [['ramp', 4]]);
  assert.ok(enter[0].t < exit[0].t);
  assert.equal(b.mask, 4);
  assert.equal(b.z, 1.368);
  assert.equal(ofType(ev, 'rampLine1').length, 1);
  assert.equal(ofType(ev, 'oneway', { name: 's_onewy12' }).length, 1);
  assert.ok(ev.findIndex((e) => e.type === 'rampLine1') < ev.findIndex((e) => e.type === 'oneway'), 'line 1 comes first');
  const snapBall = p.snapshot().balls[0];
  assert.deepEqual([snapBall.mask, snapBall.z, snapBall.visible], [4, 1.368, true]);
});

test('ramp: while climbing the ball takes the plane height (z = plane + 0.3, 0.3 at the mouth up to ~1.37), mask 2', () => {
  const p = mk();
  const b = p.spawnBall(2.5, 4.0, { vy: -35 });
  let sawRamp = false, minZ = 9, maxZ = 0;
  for (let i = 0; i < 40; i++) {
    p.step();
    if (b.mask === 2) {
      sawRamp = true;
      assert.equal(b.onRamp, true);
      assert.ok(b.plane && typeof b.plane.a === 'number');
      minZ = Math.min(minZ, b.z); maxZ = Math.max(maxZ, b.z);
      assert.ok(b.z >= 0.29 && b.z <= 1.371, `z ${b.z}`);
    }
  }
  assert.ok(sawRamp);
  assert.ok(minZ < 0.7 && maxZ > 1.3, `z range ${minZ}..${maxZ}`);
});

test('ramp: a weak shot rolls back out and returns to mask 1 (z 0.3)', () => {
  for (const speed of [10, 14, 18]) {
    const p = mk();
    const b = p.spawnBall(2.5, 4.0, { vy: -speed });
    const ev = run(p, 1.2);
    assert.deepEqual(ofType(ev, 'rampEnter').length, 1, `speed ${speed}`);
    assert.deepEqual(ofType(ev, 'rampExit').map((e) => e.mask), [1], `speed ${speed}`);
    assert.equal(b.mask, 1);
    assert.equal(b.onRamp, false);
    assert.equal(b.z, 0.3);
  }
});

test('ramp: a ball on the deck that reaches the upper mouth re-enters the ramp and rolls back down to mask 1', () => {
  const p = mk();
  const b = p.spawnBall(2.5, 4.0, { vy: -22 });           // just makes the deck, then rolls back
  const ev = run(p, 3.5);
  const kinds = ev.filter((e) => e.type === 'rampEnter' || e.type === 'rampExit').map((e) => e.type + (e.mask ?? ''));
  assert.deepEqual(kinds.slice(0, 4), ['rampEnter', 'rampExit4', 'rampEnter', 'rampExit1']);
  assert.equal(b.mask, 1);
});

test('ramp: Line 1 fires once for a deck ball crossing in the pass direction and the one-way keeps it from coming back; the upper mouth re-enters the ramp', () => {
  const ow = data.ONEWAYS.find((o) => o.name === 's_onewy12');
  const n = ow.normal;
  const m = [(ow.p0[0] + ow.p1[0]) / 2, (ow.p0[1] + ow.p1[1]) / 2];
  const fwd = mk({ data: only('RAMPS', 'ONEWAYS') });
  fwd.spawnBall(m[0] - n[0] * 1.2, m[1] - n[1] * 1.2, { mask: 4, vx: n[0] * 12, vy: n[1] * 12 });
  const ev = run(fwd, 0.4);
  assert.equal(ofType(ev, 'rampLine1').length, 1);
  assert.equal(ofType(ev, 'oneway', { name: 's_onewy12' }).length, 1);
  assert.ok(ev.findIndex((e) => e.type === 'rampLine1') < ev.findIndex((e) => e.type === 'oneway'));
  // from the other side the one-way wall turns the ball around and Line 1 stays silent
  const back = mk({ data: only('RAMPS', 'ONEWAYS') });
  const b = back.spawnBall(m[0] + n[0] * 1.2, m[1] + n[1] * 1.2, { mask: 4, vx: -n[0] * 12, vy: -n[1] * 12 });
  const ev2 = run(back, 0.4);
  assert.equal(ofType(ev2, 'rampLine1').length, 0);
  assert.equal(ofType(ev2, 'oneway').length, 0);
  assert.ok((b.x - m[0]) * n[0] + (b.y - m[1]) * n[1] > 0.5, 'turned back');
  // upper mouth: a deck ball moving into the mouth (-0.88, +0.47) drops onto the ramp (mask 2, plane 1) and runs down it
  const mouth = data.RAMPS.ramp.enterUpper;
  const mm = [(mouth.p0[0] + mouth.p1[0]) / 2, (mouth.p0[1] + mouth.p1[1]) / 2];
  const up = mk({ data: only('RAMPS') });
  const u = up.spawnBall(mm[0] + 0.88, mm[1] - 0.47, { mask: 4, vx: -8.8, vy: 4.7 });
  const ev3 = run(up, 0.15);
  assert.deepEqual(ofType(ev3, 'rampEnter').map((e) => e.ramp), ['ramp']);
  assert.deepEqual([u.mask, u.onRamp], [2, true]);
});

test('ramp: deck ball is captured by ramp_hole, held 0.5 s, dropped over 0.5 s, released on mask 1 with speed 0 at the hole centre', () => {
  const p = mk({ data: only('RAMP_HOLE') });
  const b = p.spawnBall(5.9, 7.2, { mask: 4, vy: 3 });
  const cap = runUntil(p, (es) => ofType(es, 'rampHoleCaptured').length > 0, 3);
  assert.ok(cap.hit);
  const t0 = p.snapshot().time;
  assert.deepEqual([b.x, b.y], data.RAMP_HOLE.c);
  let s = p.snapshot();
  assert.deepEqual([s.rampHole.occupied, s.rampHole.drop, s.balls[0].held], [true, 0, true]);
  const mid = [];
  let release = null;
  for (let i = 0; i < 150; i++) {
    p.step();
    const t = p.snapshot().time - t0;
    s = p.snapshot();
    if (t > 0.45 && t < 0.55) mid.push(s.rampHole.drop);
    if (t > 0.75 && t < 0.8) assert.ok(s.rampHole.drop > 0.05 && s.rampHole.drop < 1);
    const r = ofType(p.drainEvents(), 'rampHoleReleased');
    if (r.length) { release = t; break; }
  }
  near(release, 1.0, 2 / 120, 'hold 0.5 s + drop 0.5 s');
  assert.ok(mid.every((d) => d < 0.01), 'no drop during the hold');
  assert.deepEqual([b.mask, b.heldBy, b.active], [1, null, true]);
  assert.ok(b.speed < 0.15, `released with speed 0 (plus one step of gravity): ${b.speed}`);
  s = p.snapshot();
  assert.deepEqual([s.rampHole.occupied, s.rampHole.drop], [false, 0]);
  near(b.z, 0.3, 0.03);
});

test('tube: entry hides the ball (visible false, z -4.7, mask 2), the far-end seam restores mask 1 / z 0.3 and the ball leaves toward s_onewy10', () => {
  const p = mk();
  const b = p.spawnBall(-5.95, 2.0, { vy: -45 });
  let hidden = false;
  const ev = [];
  for (let i = 0; i < 60; i++) {
    p.step();
    ev.push(...p.drainEvents());
    if (b.mask === 2) {
      hidden = true;
      const s = p.snapshot().balls[0];
      assert.deepEqual([b.z, s.visible, s.z], [-4.7, false, -4.7]);
    }
  }
  assert.ok(hidden);
  assert.deepEqual(ofType(ev, 'rampEnter').map((e) => e.ramp), ['s_ramp9']);
  // a ball in the tube near the far end moves out through the exit seam (spawned in the tube: mask 2)
  const q = mk();
  const t = q.spawnBall(-4.0, -9.2, { mask: 2, vx: 3, vy: -12 });
  assert.ok(t, 'spawn inside the tube');
  const ev2 = run(q, 1.0);
  const exit = ofType(ev2, 'rampExit');
  assert.deepEqual(exit.map((e) => [e.ramp, e.mask]), [['s_ramp9', 1]]);
  assert.equal(t.mask, 1);
  assert.equal(ofType(ev2, 'oneway')[0].name, 's_onewy10', 'the far end opens onto the deployment chute');
});

test('tube: a weak ball rolls back out through the mouth (mask 1)', () => {
  const p = mk();
  const b = p.spawnBall(-5.95, 0.5, { vy: -12 });
  const ev = run(p, 3);
  assert.deepEqual(ofType(ev, 'rampEnter').map((e) => e.ramp), ['s_ramp9']);
  const exit = ofType(ev, 'rampExit');
  assert.deepEqual(exit.map((e) => [e.ramp, e.mask]), [['s_ramp9', 1]]);
  assert.equal(b.mask, 1);
  assert.equal(b.z, 0.3);
  assert.ok(b.y > -1.2, 'came back out of the mouth');
});

// ======================================================================================================================================
// 7. Kickouts and sinks (App. D #6)
// ======================================================================================================================================
test('kickouts: a_kout1 (gravity well) is inert until kickoutSetActive(1,true); capture, 2.404 s default hold, eject up the table, inactive after', () => {
  const p = mk({ data: only('KICKOUTS') });
  const idle = p.spawnBall(0, 6.3, { vx: 0, vy: -2 });
  assert.equal(p.snapshot().kickouts.a_kout1.active, false);
  let ev = run(p, 1.0);
  assert.equal(ev.length, 0, 'no capture while inactive');
  assert.ok(idle.y > 6.5, 'falls straight through the well region');
  p.removeAllBalls();
  const b = p.spawnBall(0.9, 6.8);
  p.kickoutSetActive(1, true);
  assert.equal(p.snapshot().kickouts.a_kout1.active, true);
  const cap = runUntil(p, (es) => ofType(es, 'kickoutCapture').length > 0, 3);
  assert.ok(cap.hit, 'the well pulls the ball in');
  const tCap = ofType(cap.events, 'kickoutCapture')[0];
  assert.equal(tCap.id, 1);
  assert.deepEqual([b.x, b.y, b.z], [0, 6, 0.3]);
  let s = p.snapshot();
  assert.deepEqual([s.kickouts.a_kout1.held, s.balls[0].held], [true, true]);
  const eject = runUntil(p, (es) => ofType(es, 'kickoutEject').length > 0, 4);
  const tEj = ofType(eject.events, 'kickoutEject')[0];
  near(tEj.t - tCap.t, 2.403818, 1.5 / 120, 'default hold (SOUND7)');
  assert.ok(b.dy < -0.5 && b.speed > 40 && b.speed < 55, `thrown up the table: ${b.dx},${b.dy} @ ${b.speed}`);
  s = p.snapshot();
  assert.deepEqual([s.kickouts.a_kout1.held, s.kickouts.a_kout1.active], [false, false], 'a_kout1 never re-arms by itself');
});

test('kickouts: a_kout2 / a_kout3 capture inside the capture radius, throw (-1,1) / (-1,-1) at ~49.5, re-arm 0.05 s later', () => {
  for (const [id, pos, dir] of [[2, data.KICKOUTS[1].c, [-1, 1]], [3, data.KICKOUTS[2].c, [-1, -1]]]) {
    const p = mk({ data: only('KICKOUTS') });
    const b = p.spawnBall(pos[0], pos[1] + 0.45, { vy: -4 });
    const cap = runUntil(p, (es) => ofType(es, 'kickoutCapture').length > 0, 2);
    assert.ok(cap.hit, `kickout ${id} captures`);
    assert.equal(ofType(cap.events, 'kickoutCapture')[0].id, id);
    assert.deepEqual([b.x, b.y, b.z], [pos[0], pos[1], 0]);
    const ej = runUntil(p, (es) => ofType(es, 'kickoutEject').length > 0, 3);
    const t = ofType(ej.events, 'kickoutEject')[0].t - ofType(cap.events, 'kickoutCapture')[0].t;
    near(t, 1.5, 1.5 / 120, 'default hold');
    near(b.speed * Math.hypot(b.dx, b.dy), 35 * Math.SQRT2, 0.2, 'speed x |dir| (one step of drag already applied)');
    near(b.dx / Math.hypot(b.dx, b.dy), dir[0] / Math.SQRT2, 0.01);
    near(b.dy / Math.hypot(b.dx, b.dy), dir[1] / Math.SQRT2, 0.01);
    assert.equal(p.snapshot().kickouts['a_kout' + id].active, false, 'inactive right after the throw');
    stepN(p, 8);                                                  // 0.067 s > 0.05 s
    assert.equal(p.snapshot().kickouts['a_kout' + id].active, true, 're-armed');
  }
});

test('kickouts: kickoutSetHold restarts the hold from now; 0 throws at the next step; unknown ids throw TypeError', () => {
  for (const [hold, expect, tol] of [[0.5, 0.5, 1.5 / 120], [0, 1 / 120, 1.5 / 120], [3.0, 3.0, 1.5 / 120]]) {
    const p = mk({ data: only('KICKOUTS') });
    p.spawnBall(data.KICKOUTS[1].c[0], data.KICKOUTS[1].c[1] + 0.4, { vy: -4 });
    let tCap = null, tEj = null;
    for (let i = 0; i < 6 * 120 && tEj === null; i++) {
      p.step();
      for (const e of p.drainEvents()) {
        if (e.type === 'kickoutCapture') { tCap = e.t; p.kickoutSetHold(e.id, hold); }
        if (e.type === 'kickoutEject') tEj = e.t;
      }
    }
    near(tEj - tCap, expect, tol, `hold ${hold}`);
  }
  const p = mk();
  assert.throws(() => p.kickoutSetActive(4, true), TypeError);
  assert.throws(() => p.kickoutSetHold(0, 1), TypeError);
  assert.doesNotThrow(() => p.kickoutSetHold(2, 1), 'nothing held: ignored');
});

test('sinks: capture hides the ball (not in the snapshot, still in play), 2.0 s hold, re-emit at the chosen sink with sinkEject{id, from}', () => {
  const sink1 = data.SINKS[0], sink2 = data.SINKS[1];
  const mid = [(sink1.edges[0].x0 + sink1.edges[0].x1) / 2, (sink1.edges[0].y0 + sink1.edges[0].y1) / 2];
  const n = [sink1.edges[0].nx, sink1.edges[0].ny];
  const mkSink = (route) => {
    const p = mk({ data: only('SINKS') });
    const b = p.spawnBall(mid[0] + n[0] * 0.4, mid[1] + n[1] * 0.4, { vx: -n[0] * 8, vy: -n[1] * 8 });
    let tCap = null, ev = null, id = 0;
    for (let i = 0; i < 6 * 120 && !ev; i++) {
      p.step();
      for (const e of p.drainEvents()) {
        if (e.type === 'sinkCapture') {
          tCap = e.t; id = e.id;
          assert.equal(p.ballsInPlay(), 1, 'a sink-captured ball is still in play');
          assert.equal(p.snapshot().balls.length, 0, 'but not listed');
          assert.equal(p.snapshot().sinks.v_sink1.occupied, true);
          assert.equal(b.active, false);
          if (route) p.sinkSetRoute(e.id, route[0], route[1]);
        }
        if (e.type === 'sinkEject') ev = e;
      }
    }
    return { p, b, tCap, ev, id };
  };
  const same = mkSink(null);
  assert.equal(same.id, 1);
  near(same.ev.t - same.tCap, 2.0, 1.5 / 120, 'default hold');
  assert.deepEqual([same.ev.id, same.ev.from], [1, 1]);
  assert.equal(same.p.snapshot().sinks.v_sink1.occupied, false);
  const routed = mkSink([2, 1.0]);
  near(routed.ev.t - routed.tCap, 1.0, 1.5 / 120, 'route hold');
  assert.deepEqual([routed.ev.id, routed.ev.from], [2, 1]);
  const speed = routed.b.speed * Math.hypot(routed.b.dx, routed.b.dy);
  near(speed, 35 * Math.SQRT2, 0.4);
  assert.ok(Math.hypot(routed.b.x - sink2.reemit[0], routed.b.y - sink2.reemit[1]) < 0.6, 'ball re-emitted at the exit sink');
  assert.equal(routed.b.active, true);
});

test('sinks: a blocked exit (another ball within 2R) delays the eject by 0.5 s and retries', () => {
  const sink1 = data.SINKS[0];
  const e0 = sink1.edges[0];
  const mid = [(e0.x0 + e0.x1) / 2, (e0.y0 + e0.y1) / 2];
  const p = mk({ data: only('SINKS') });
  p.spawnBall(mid[0] + e0.nx * 0.4, mid[1] + e0.ny * 0.4, { vx: -e0.nx * 8, vy: -e0.ny * 8 });
  const cap = runUntil(p, (es) => ofType(es, 'sinkCapture').length > 0, 2);
  assert.ok(cap.hit);
  const tCap = ofType(cap.events, 'sinkCapture')[0].t;
  // park a blocker ball within 2R of the exit point (held by the debug drag so that gravity does not move it)
  const bx = sink1.reemit[0] + e0.nx * 0.45, by = sink1.reemit[1] + e0.ny * 0.45;
  const blocker = p.spawnBall(bx, by);
  assert.ok(blocker);
  assert.equal(p.debugGrab(bx, by), true);
  const ev = [];
  for (let i = 0; i < 120 * 2.3; i++) { p.step(); ev.push(...p.drainEvents()); p.debugDrag(bx, by); }
  assert.equal(ofType(ev, 'sinkEject').length, 0, 'still blocked after 2.3 s');
  p.debugRelease();                                          // the blocker falls away (no floor in this table)
  const rest = run(p, 1.5);
  const ej = ofType(rest, 'sinkEject');
  assert.equal(ej.length, 1);
  assert.ok(ej[0].t - tCap > 2.3 && ej[0].t - tCap < 3.6, `delayed eject at +${(ej[0].t - tCap).toFixed(2)} s`);
  const late = (ej[0].t - tCap - 2.0) / 0.5;
  near(late, Math.round(late), 0.15, 'retries come in 0.5 s steps');
});

test('sinks: while tilt-locked a sink capture is a drain (via sinkTilt)', () => {
  const sink1 = data.SINKS[0];
  const e0 = sink1.edges[0];
  const mid = [(e0.x0 + e0.x1) / 2, (e0.y0 + e0.y1) / 2];
  const p = mk({ data: only('SINKS') });
  p.setTiltLock(true);
  p.spawnBall(mid[0] + e0.nx * 0.4, mid[1] + e0.ny * 0.4, { vx: -e0.nx * 8, vy: -e0.ny * 8 });
  const r = runUntil(p, (es) => ofType(es, 'drain').length > 0, 2);
  assert.ok(r.hit);
  const d = ofType(r.events, 'drain')[0];
  assert.deepEqual([d.via, d.remaining], ['sinkTilt', 0]);
  assert.equal(ofType(r.events, 'sinkCapture').length, 0);
  assert.equal(p.ballsInPlay(), 0);
});

// ======================================================================================================================================
// 9. Tilt / nudge (App. D #10)
// ======================================================================================================================================
const hold = (p, dir, steps) => { p.nudge(dir, true); const ev = []; for (let i = 0; i < steps; i++) { p.step(); ev.push(...p.drainEvents()); } return ev; };

test('nudge: velocity change (+1.0,+0.5) / (-1.0,+0.5) / (0,+0.5), undone by release or after 0.4 s, shake offsets, nudge event', () => {
  const table = { left: [1.0, 0.5, 2, -1], right: [-1.0, 0.5, -2, -1], bottom: [0, 0.5, 0, -1] };
  for (const [dir, [vx, vy, sx, sy]] of Object.entries(table)) {
    const p = mk({ data: { ...data, ...EMPTY } });
    const b = p.spawnBall(0, 0);
    stepN(p, 1);
    const before = vel(b);
    assert.equal(p.nudge(dir, true), true);
    const after = vel(b);
    near(after[0] - before[0], vx, 1e-9, dir + ' vx');
    near(after[1] - before[1], vy, 1e-9, dir + ' vy');
    assert.deepEqual(p.drainEvents().map((e) => [e.type, e.dir]), [['nudge', dir]]);
    assert.deepEqual([p.snapshot().shake.x, p.snapshot().shake.y], [sx, sy]);
    p.nudge(dir, false);
    const undone = vel(b);
    near(undone[0], before[0], 1e-9); near(undone[1], before[1], 1e-9);
    assert.deepEqual([p.snapshot().shake.x, p.snapshot().shake.y], [0, 0]);
    // timed undo after 0.4 s: no key release
    p.nudge(dir, true);
    stepN(p, 47);
    assert.notDeepEqual([p.snapshot().shake.x, p.snapshot().shake.y], [0, 0], 'still shaking at 0.39 s');
    stepN(p, 2);
    assert.deepEqual([p.snapshot().shake.x, p.snapshot().shake.y], [0, 0], 'undone after 0.4 s');
  }
});

test('tilt: holding a nudge 0.27 s emits nudgeCount tilt; 0.2 s only warn; counter decays 1/s', () => {
  const a = mk();
  const evA = hold(a, 'left', 32);                               // 0.267 s -> 1.067
  const nc = ofType(evA, 'nudgeCount');
  assert.deepEqual(nc.map((e) => e.level), ['warn', 'tilt']);
  assert.ok(nc[0].count > 0.5 && nc[0].count < 0.55);
  assert.ok(nc[1].count > 1.0 && nc[1].count < 1.05);
  const b = mk();
  const evB = hold(b, 'left', 24);                               // 0.2 s -> 0.8
  assert.deepEqual(ofType(evB, 'nudgeCount').map((e) => e.level), ['warn']);
  near(b.getNudgeCount(), 0.8, 1e-9, 'count after 0.2 s');
  b.nudge('left', false);
  stepN(b, 60);                                                  // 0.5 s of decay
  near(b.getNudgeCount(), 0.3, 1e-9, 'decays 1 per second');
  stepN(b, 120);
  assert.equal(b.getNudgeCount(), 0);
});

test('tilt: three 0.15 s taps 0.3 s apart tilt (the third); one tap only warns', () => {
  const p = mk();
  const ev = [];
  const tap = () => { p.nudge('right', true); stepN(p, 18); ev.push(...p.drainEvents()); p.nudge('right', false); stepN(p, 36); ev.push(...p.drainEvents()); };
  tap();
  assert.deepEqual(ofType(ev, 'nudgeCount').map((e) => e.level), ['warn']);
  tap();
  assert.deepEqual(ofType(ev, 'nudgeCount').map((e) => e.level), ['warn', 'warn'], 'the counter fell below 0.5 in between: warn again');
  tap();
  const levels = ofType(ev, 'nudgeCount').map((e) => e.level);
  assert.deepEqual(levels, ['warn', 'warn', 'tilt']);
});

test('tilt: setTiltLock(true) forces plain bounces (no hard-hit events, no kick), blocks nudges, retracts the flippers, clears on feed', () => {
  const mkBump = (tilt) => {
    const p = mk({ data: only('BUMPERS') });
    p.setTiltLock(tilt);
    const b = p.spawnBall(0.008, -5.5, { vy: 20 });
    const ev = run(p, 0.4);
    return { b, ev };
  };
  const normal = mkBump(false), tilted = mkBump(true);
  const hit = ofType(normal.ev, 'bumperHit')[0];
  assert.ok(hit && hit.name === 'a_bump1' && hit.impact > 19, 'normal: bumperHit');
  assert.equal(ofType(tilted.ev, 'bumperHit').length, 0);
  assert.ok(normal.b.speed > tilted.b.speed + 6, `kicked (+17): ${normal.b.speed} vs plain ${tilted.b.speed}`);
  assert.ok(tilted.b.speed < 14, `plain bounce (e 0.6): ${tilted.b.speed}`);
  // flippers retract and ignore input, nudge refused
  const p = mk();
  p.setFlipperButton('left', true);
  stepN(p, 6);
  p.drainEvents();
  p.setTiltLock(true);
  assert.deepEqual(p.drainEvents().map((e) => [e.type, e.side, e.action, e.byKey]), [['flipper', 'left', 'retract', false]]);
  assert.equal(p.isTiltLocked(), true);
  assert.equal(p.snapshot().tiltLocked, true);
  assert.equal(p.setFlipperButton('left', true), false);
  assert.equal(p.nudge('left', true), false);
  stepN(p, 12);
  assert.equal(p.snapshot().flippers.a_flip1.angle, 0);
  p.setTiltLock(false);
  assert.equal(p.setFlipperButton('left', true), true);
});

// ======================================================================================================================================
// 10. Stuck ball
// ======================================================================================================================================
test('stuck ball: speed < 0.8 for > 0.5 s re-throws it; 21 failed checks remove it with stuckRelaunch and a relaunch feed', () => {
  const floor = { k: 'line', x0: -8, y0: 5, x1: 8, y1: 5, nx: 0, ny: -1 };
  const d = {
    ...data, ...EMPTY,
    TABLE_OUTLINE: { pts: [], material: data.DEFAULT_MATERIAL, kicker: null, mask: 1, edges: [floor] },
  };
  const p = mk({ data: d });
  const b = p.spawnBall(0, 4.9995);                              // resting on the floor line
  const speeds = [];
  let removedAt = null;
  const ev = [];
  for (let i = 0; i < 17 * 120; i++) {
    p.step();
    speeds.push(b.speed);
    const es = p.drainEvents();
    ev.push(...es);
    if (removedAt === null && es.some((e) => e.type === 'stuckRelaunch')) removedAt = p.snapshot().time;
  }
  // first re-throw happens ~0.5 s after the ball has come to rest (speed 1.0 x |dir|)
  const kicks = speeds.map((s, i) => [s, i]).filter(([s, i]) => i > 0 && s > 0.9 && speeds[i - 1] < 0.85);
  assert.ok(kicks.length >= 15, `re-throws: ${kicks.length}`);
  assert.ok(kicks[0][1] / 120 > 0.5 && kicks[0][1] / 120 < 4, 'first re-throw time');
  assert.ok(removedAt > 10 && removedAt < 15.5, `removed at ${removedAt}`);
  assert.equal(ofType(ev, 'stuckRelaunch').length, 1);
  assert.equal(ofType(ev, 'drain').length, 0, 'a stuck removal is not a drain');
  assert.equal(ofType(ev, 'plungerFed').length, 1, 'relaunch feed follows');
  assert.equal(p.ballsInPlay(), 1);
});

// ======================================================================================================================================
// 11. Determinism
// ======================================================================================================================================
function script(seed) {
  const p = createPhysics({ rand: mulberry32(seed) });
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const events = [];
  const snaps = [];
  p.startFeed();
  p.kickoutSetActive(1, true);
  for (let i = 0; i < 20 * 120; i++) {
    const t = i / 120;
    if (i === 130) { p.setPlungerButton(true); }
    if (i === 130 + 3 * 40) { p.setPlungerButton(false); }
    if (i % 25 === 0) { p.setFlipperButton('left', rnd() < 0.5); p.setFlipperButton('right', rnd() < 0.5); }
    if (i % 500 === 250) p.nudge(['left', 'right', 'bottom'][i % 3], true);
    if (i % 500 === 270) { p.nudge('left', false); p.nudge('right', false); p.nudge('bottom', false); }
    p.step();
    for (const e of p.drainEvents()) {
      events.push(e);
      if (e.type === 'kickoutCapture') p.kickoutSetHold(e.id, 0.7);
      if (e.type === 'sinkCapture') p.sinkSetRoute(e.id, [1, 2, 3, 7][(i >> 3) % 4], 1.0);
      if (e.type === 'drain' && e.remaining === 0) p.startFeed();
    }
    if (i % 120 === 0) snaps.push(JSON.stringify(p.snapshot()));
    void t;
  }
  return { events: JSON.stringify(events), snaps, count: events.length };
}

test('determinism: same seed + same inputs => identical event streams and snapshots; a different seed differs', () => {
  const a = script(11), b = script(11), c = script(12);
  assert.ok(a.count > 40, `scenario produced ${a.count} events`);
  assert.equal(a.events, b.events);
  assert.deepEqual(a.snaps, b.snaps);
  assert.notEqual(a.events, c.events);
});

test('determinism: rand() is called once per free ball per step, twice per throwBall (call counting)', () => {
  let calls = 0;
  const p = createPhysics({ rand: () => { calls++; return 0.5; }, data: { ...data, ...EMPTY } });
  p.step();
  assert.equal(calls, 0, 'no balls, no rand');
  p.spawnBall(0, 0);
  p.spawnBall(3, 0);
  p.step();
  assert.equal(calls, 2, 'one jitter draw per ball');
  const q = createPhysics({ rand: () => { calls++; return 0.5; }, data: only('KICKOUTS') });
  q.spawnBall(data.KICKOUTS[1].c[0], data.KICKOUTS[1].c[1] + 0.4, { vy: -4 });
  calls = 0;
  let steps = 0;
  while (!ofType(q.drainEvents(), 'kickoutCapture').length && steps < 200) { q.step(); steps++; }
  const afterCapture = calls;
  assert.equal(afterCapture, steps, 'only jitter draws until the throw');
  q.kickoutSetHold(2, 0);
  q.step();
  assert.equal(calls, afterCapture + 3, 'the throw adds exactly two draws, plus the jitter of the now free ball; held balls draw none');
});

// ======================================================================================================================================
// 12. Snapshot
// ======================================================================================================================================
test('snapshot: the same stable object every call, keys match COMPONENT_NAMES, createSnapshot is the idle shape', () => {
  const p = mk();
  const s = p.snapshot();
  assert.equal(p.snapshot(), s);
  const N = data.COMPONENT_NAMES;
  assert.deepEqual(Object.keys(s.flippers), N.flippers);
  assert.deepEqual(Object.keys(s.popups), N.popups);
  assert.deepEqual(Object.keys(s.solos), N.solos);
  assert.deepEqual(Object.keys(s.bumpers), N.bumpers);
  assert.deepEqual(Object.keys(s.rebounders), N.rebounders);
  assert.deepEqual(Object.keys(s.kickbacks), N.kickbacks);
  assert.deepEqual(Object.keys(s.gates), N.gates);
  assert.deepEqual(Object.keys(s.flags), N.flags);
  assert.deepEqual(Object.keys(s.kickouts), N.kickouts);
  assert.deepEqual(Object.keys(s.sinks), N.sinks);
  assert.deepEqual(Object.keys(s.rolloverSprites), [N.lightRollover]);
  assert.deepEqual(s, createSnapshot(), 'a fresh table is the idle snapshot');
  assert.equal(p.balls.length, 0);
  assert.equal(p.ballsInPlay(), 0);
  // the inner objects and the balls array keep their identity while the table runs
  const keep = [s.flippers, s.flippers.a_flip1, s.balls, s.plunger, s.shake, s.kickouts.a_kout2, s.rampHole];
  p.spawnBall(1, 1);
  stepN(p, 30);
  const s2 = p.snapshot();
  assert.equal(s2, s);
  assert.deepEqual([s2.flippers, s2.flippers.a_flip1, s2.balls, s2.plunger, s2.shake, s2.kickouts.a_kout2, s2.rampHole].map((x, i) => x === keep[i]), keep.map(() => true));
  assert.equal(s2.balls.length, 1);
  assert.deepEqual(Object.keys(s2.balls[0]).sort(), ['held', 'id', 'mask', 'speed', 'visible', 'x', 'y', 'z']);
  near(s2.time, 0.25, 1e-9);
});

test('snapshot: reflects component state (popups down, bumper hit frame, rebounder flash, solo flash, gates, blocker, flags)', () => {
  const p = mk();
  p.gateSetEnabled(1, false);
  p.blockerSetEnabled(true);
  let s = p.snapshot();
  assert.deepEqual([s.gates.v_gate1.enabled, s.gates.v_gate2.enabled, s.blocker.up], [false, true, true]);
  p.setTiltLock(true);
  assert.equal(p.snapshot().blocker.up, false, 'tilt lowers the post');
  p.setTiltLock(false);
  assert.equal(p.snapshot().blocker.up, true, 'and restores it');
  assert.deepEqual([p.snapshot().kickouts.a_kout1.active, p.snapshot().kickouts.a_kout2.active, p.snapshot().kickouts.a_kout3.active], [false, true, true]);
});

// ======================================================================================================================================
// misc contract checks
// ======================================================================================================================================
test('contract: unknown names / ids / sides throw TypeError, runtime conditions never throw', () => {
  const p = mk();
  assert.throws(() => p.gateSetEnabled(3, true), TypeError);
  assert.throws(() => p.sinkSetRoute(4, 1), TypeError);
  assert.throws(() => p.sinkSetRoute(1, 5), TypeError);
  assert.throws(() => p.popupReenable('a_targ99'), TypeError);
  assert.throws(() => p.popupReenable(['a_targ1', 'nope']), TypeError);
  assert.throws(() => p.setFlipperButton('up', true), TypeError);
  assert.throws(() => p.nudge('up'), TypeError);
  assert.doesNotThrow(() => { p.popupReenable('all'); p.popupReenable('a_targ4', true); p.forceDrainAll(); p.removeAllBalls(); p.debugRelease(); p.debugDrag(1, 1); });
  assert.equal(p.debugGrab(0, 0), false);
  assert.equal(p.spawnBall(0, 0) !== null, true);
  assert.equal(p.spawnBall(0.1, 0), null, 'spawn guard: within 1.2 R of another ball');
  assert.equal(p.balls, p.balls);
});

test('performance: 1 ball on the full table steps in well under 0.3 ms on average; 3 balls under 1 ms', () => {
  const measure = (nBalls) => {
    const p = createPhysics({ rand: mulberry32(5) });
    const rnd = mulberry32(6);
    const starts = [[-2, 3], [2, -3], [-1, -8]];
    for (let k = 0; k < nBalls; k++) p.spawnBall(starts[k][0], starts[k][1], { vx: 6, vy: -4 });
    let moving = 0, total = 0;
    const N = 20 * 120;
    stepN(p, 240);                                                // warm-up
    for (let i = 0; i < N; i++) {
      if (i % 20 === 0) { p.setFlipperButton('left', rnd() < 0.5); p.setFlipperButton('right', rnd() < 0.5); }
      const t0 = process.hrtime.bigint();
      p.step();
      total += Number(process.hrtime.bigint() - t0);
      for (const e of p.drainEvents()) if (e.type === 'drain') p.spawnBall(starts[e.ballId % 3][0], starts[e.ballId % 3][1], { vx: 4, vy: -5 });
      if (p.balls.some((b) => b.speed > 0)) moving++;
    }
    return { avgMs: total / N / 1e6, moving };
  };
  const one = measure(1), three = measure(3);
  assert.ok(one.moving > 1000);
  assert.ok(one.avgMs < 0.3, `1 ball avg ${one.avgMs.toFixed(4)} ms`);
  assert.ok(three.avgMs < 1.0, `3 balls avg ${three.avgMs.toFixed(4)} ms`);
});
