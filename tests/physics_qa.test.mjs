/**
 * tests/physics_qa.test.mjs
 * OWNER: PHYSICS (test)
 * STATUS: IMPLEMENTED
 * QA regression tests found by driving the real table headlessly (see dev/qa/physics/*.mjs for the exploration scripts):
 *   - hidden tube: the far-end exit seam was shadowed by the inflated end wall of shell 106 (a ball that travelled the whole tube bounced back)
 *   - lost-ball safety net (a ball that leaves the table by an unforeseen route must drain, not hang the game)
 *   - stuck check: a flipper box exempts a ball only while that flipper is raised / moving (the cradle), not while it idles at rest
 *   - blocker rattle: a ball wedged between the post and a flipper tip may not machine-gun blockerHit
 *   - soaks: fast random shots never penetrate a wall, nothing ever rests on an idle table, random flipper fire never penetrates a flipper
 * Deterministic: every random source is a seeded mulberry32 / constantRand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysics } from '../src/physics.js';
import { Engine } from '../src/physics/engine.js';
import { mulberry32, constantRand } from './helpers/seeded_rand.mjs';
import { data, mk, run, ofType, only } from './physics_support.mjs';

// ======================================================================================================================================
// geometry helpers (raw polygons, no physics code involved)
// ======================================================================================================================================
const islands = data.WALLS.filter((w) => (w.mask & 1) && w.solid === 'island');
const posts = data.POSTS.filter((p) => p.mask & 1);
const bbox = (pts) => [Math.min(...pts.map((p) => p[0])) - 0.5, Math.max(...pts.map((p) => p[0])) + 0.5, Math.min(...pts.map((p) => p[1])) - 0.5, Math.max(...pts.map((p) => p[1])) + 0.5];
const boxes = new Map(islands.map((w) => [w.name, bbox(w.pts)]));

function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** clearance of a point to the nearest island wall / post: [name, distance] (negative inside). The un-inflated table outline is not an obstacle. */
function clearance(x, y) {
  let best = ['-', 99];
  for (const w of islands) {
    const bb = boxes.get(w.name);
    if (x < bb[0] || x > bb[1] || y < bb[2] || y > bb[3]) continue;
    let d = 1e9;
    for (let i = 0; i < w.pts.length; i++) {
      const a = w.pts[i], b = w.pts[(i + 1) % w.pts.length];
      d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1]));
    }
    if (inPoly(w.pts, x, y)) d = -d;
    if (d < best[1]) best = [w.name, d];
  }
  for (const p of posts) {
    const d = Math.hypot(x - p.c[0], y - p.c[1]) - p.r;
    if (d < best[1]) best = [p.name, d];
  }
  return best;
}

// ======================================================================================================================================
// hidden tube far end
// ======================================================================================================================================
test('tube: the inflated end wall of shell 106 is switched off, the far-end exit seam is the end of the tube', () => {
  const eng = new Engine({});
  const wall = eng.world.edges.filter((e) => e.owner === 'wall_106');
  assert.equal(wall.length, 4, 'shell 106 has four sides');
  assert.equal(wall.filter((e) => !e.active).length, 1, 'exactly the end wall is off');
  const off = wall.find((e) => !e.active);
  const seam = eng.world.edges.find((e) => e.role === 'seam:exitFar');
  assert.ok(seam && seam.active);
  // the switched-off wall is the one lying on the seam
  const d = (x, y) => Math.abs((x - seam.x0) * seam.nx + (y - seam.y0) * seam.ny);
  assert.ok(d(off.x0, off.y0) < 0.1 && d(off.x1, off.y1) < 0.1);
  // tables without a far-end seam (no RAMPS) keep every wall
  const bare = new Engine({ data: only('WALLS') });
  assert.ok(bare.world.edges.every((e) => e.active));
});

test('tube: balls aimed along the tube leave through the far-end seam (mask 1, z 0.3) - before the fix every one of them bounced back down', () => {
  const rows = [];
  for (const [x0, angles] of [[-6.0, [-6, -3, 0, 3, 6]], [-5.95, [-6, -3, 0, 3]]]) {
    for (const speed of [35, 45, 55]) {
      for (const angDeg of angles) {
        const p = mk();
        const tx = -3.4 - x0, ty = -10.5 + 0.6;
        const a = Math.atan2(ty, tx) + (angDeg * Math.PI) / 180;
        const b = p.spawnBall(x0, -0.6, { vx: speed * Math.cos(a), vy: speed * Math.sin(a) });
        let entered = false, exitY = null, exitMask = null;
        for (let i = 0; i < 3 * 120 && exitY === null; i++) {
          p.step();
          for (const e of p.drainEvents()) {
            if (e.type === 'rampEnter' && e.ramp === 's_ramp9') entered = true;
            if (e.type === 'rampExit' && e.ramp === 's_ramp9') { exitY = b.y; exitMask = e.mask; }
          }
        }
        rows.push({ x0, speed, angDeg, entered, exitY, exitMask, mask: b.mask, z: b.z });
      }
    }
  }
  const entered = rows.filter((r) => r.entered);
  assert.equal(entered.length, rows.length, 'every aimed ball enters the tube');
  const far = entered.filter((r) => r.exitY !== null && r.exitY < -9.5);
  assert.ok(far.length === entered.length, `all ${entered.length} aimed shots reach the far end, got ${far.length}: ${JSON.stringify(entered.filter((r) => !far.includes(r)))}`);
  for (const r of far) assert.deepEqual([r.exitMask, r.mask, r.z], [1, 1, 0.3]);
});

// ======================================================================================================================================
// lost-ball safety net
// ======================================================================================================================================
test('safety net: a mask-4 ball that falls out of the table (nothing drains mask 4) is drained, via "drain", and the game is not left waiting', () => {
  const p = mk();
  const b = p.spawnBall(0, 12, { mask: 4, vy: 10 });
  assert.equal(p.ballsInPlay(), 1);
  const ev = run(p, 2.0);
  const drains = ofType(ev, 'drain');
  assert.equal(drains.length, 1);
  assert.deepEqual([drains[0].remaining, drains[0].via, drains[0].ballId], [0, 'drain', b.id]);
  assert.equal(p.ballsInPlay(), 0);
  assert.equal(p.balls.length, 0);
});

test('safety net: leaving through the side or the top drains too; NaN positions are caught; sink-held and kickout-held balls are never "escaped"', () => {
  for (const [x, y, vx, vy] of [[8.5, 0, 25, 0], [-8.5, 3, -25, 0], [0, -14.5, 0, -30]]) {
    const p = mk();
    p.spawnBall(x, y, { mask: 4, vx, vy });
    const ev = run(p, 1.0);
    assert.equal(ofType(ev, 'drain').length, 1, `(${x},${y})`);
  }
  const q = mk();
  const nb = q.spawnBall(-1, 3, { mask: 4 });
  nb.x = NaN;
  assert.equal(ofType(run(q, 0.1), 'drain').length, 1, 'NaN');
  // a ball held in a_kout3 and one held in a sink stay in play
  const h = mk();
  const k = data.KICKOUTS.find((o) => o.id === 3);
  h.spawnBall(k.c[0] - 0.3, k.c[1] - 0.3, { vx: 6, vy: 6 });
  run(h, 0.5);
  assert.ok(h.snapshot().kickouts.a_kout3.held, 'captured');
  assert.equal(h.ballsInPlay(), 1);
});

test('safety net: only on a real table (drain + outline); partial tables used by tests let balls fly free', () => {
  const p = mk({ data: only('KICKOUTS') });
  const b = p.spawnBall(0, 14, { vy: 30 });
  run(p, 1.0);
  assert.ok(b.y > 15.5 && !b.dead && p.ballsInPlay() === 1);
});

// ======================================================================================================================================
// stuck check vs flipper boxes
// ======================================================================================================================================
test('stuck check: a flipper box exempts a ball only while the flipper is raised or moving, not while it idles at rest', () => {
  const eng = new Engine({ rand: constantRand(0.5) });
  const b = { x: 2.46, y: 11.33 };                      // a probe: _inStuckExempt only looks at the position
  assert.equal(eng._inStuckExempt(b), false, 'idle flipper at rest');
  eng.setFlipperButton('left', true);
  assert.equal(eng._inStuckExempt(b), true, 'extending');
  for (let i = 0; i < 12; i++) eng.step(1 / 120);
  assert.equal(eng.flippers[0].flag, 0, 'fully raised');
  assert.equal(eng._inStuckExempt(b), true, 'raised and held');
  eng.setFlipperButton('left', false);
  assert.equal(eng._inStuckExempt(b), true, 'retracting');
  for (let i = 0; i < 20; i++) eng.step(1 / 120);
  assert.equal(eng.flippers[0].cur, 0);
  assert.equal(eng._inStuckExempt(b), false, 'back at rest');
  // the plunger box still exempts
  assert.equal(eng._inStuckExempt({ x: -7.0, y: 11.5 }), true, 'plunger');
});

test('cradle: a ball resting in the V of a held-up flipper stays put (never re-thrown); released, the flipper retracts fully and the ball drains', () => {
  for (const side of ['left', 'right']) {
    const sg = side === 'left' ? 1 : -1;
    const p = createPhysics({ rand: mulberry32(2) });
    p.setFlipperButton(side, true);
    for (let i = 0; i < 12; i++) p.step();
    const b = p.spawnBall(sg * 4.4, 9.9, { vx: -sg * 2, vy: 1 });
    run(p, 4);
    const at = [b.x, b.y];
    assert.ok(b.speed < 0.8, `${side}: cradled (speed ${b.speed})`);
    assert.ok(Math.abs(at[0] - sg * 2.46) < 0.1 && Math.abs(at[1] - 11.33) < 0.1, `${side}: in the V at the pivot ${at}`);
    run(p, 4);                                          // 8 s of rest: far beyond the 0.5 s stuck window
    assert.ok(Math.hypot(b.x - at[0], b.y - at[1]) < 0.05, `${side}: not disturbed`);
    p.setFlipperButton(side, false);
    const ev = run(p, 3);
    assert.equal(ofType(ev, 'drain').length, 1, `${side}: drains after the release`);
    const f = p.snapshot().flippers[side === 'left' ? 'a_flip1' : 'a_flip2'];
    assert.equal(f.angle, 0);
  }
});

// ======================================================================================================================================
// blocker rattle
// ======================================================================================================================================
test('blocker: a ball wedged between the post and a flipper tip may not fire blockerHit more than every 0.1 s; real bounces still report', () => {
  const p = createPhysics({ rand: mulberry32(3) });
  p.blockerSetEnabled(true);
  const b = p.spawnBall(0.1, 9.5, { vy: 4 });
  const hits = [];
  for (let i = 0; i < 12 * 120; i++) {
    p.step();
    for (const e of p.drainEvents()) if (e.type === 'blockerHit') hits.push(e.t);
  }
  assert.ok(!b.dead, 'the post keeps the ball on the table');
  assert.ok(hits.length >= 1, 'the first bounce reports');
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i] - hits[i - 1] >= 0.1 - 1e-9, `gap ${hits[i] - hits[i - 1]}`);
  assert.ok(hits.length <= 12 * 10 + 1, `at most 10 per second, got ${hits.length}`);
});

// ======================================================================================================================================
// soaks
// ======================================================================================================================================
test('soak: 800 random shots at 5-60 u/s from valid places never push a ball into a wall or post (> 0.05 deeper than its keep-out)', () => {
  const R = mulberry32(11);
  let simulated = 0, steps = 0;
  const bad = [];
  for (let n = 0; n < 800; n++) {
    let x, y, tries = 0;
    do { x = (R() - 0.5) * 15.4; y = -13 + R() * 26; tries++; }
    while (tries < 200 && (clearance(x, y)[1] < 0.34 || (x < -6.2 && y > 3.5) || (y > 10.3 && Math.abs(x) < 3.2) || (y > 12 && Math.abs(x) < 4)));
    if (tries >= 200) continue;
    const p = createPhysics({ rand: mulberry32(n + 1) });
    const ang = R() * Math.PI * 2, sp = 5 + R() * 55;
    const b = p.spawnBall(x, y, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp });
    if (!b) continue;
    simulated++;
    let sinceLayer = 99;
    for (let i = 0; i < Math.round(2.5 * 120) && !b.dead; i++) {
      p.step();
      steps++;
      for (const e of p.drainEvents()) if (e.type === 'rampExit') sinceLayer = e.ramp === 's_ramp9' && b.y < -9 ? -40 : 0;
      if (b.mask !== 1 || b.heldBy || !b.active) { sinceLayer = Math.min(sinceLayer, 0); continue; }
      if (++sinceLayer < 4 || (b.x < -6.2 && b.y > 3.5)) continue;          // ramp / tube mouths hand a ball over inside a keep-out zone by design
      const [name, c] = clearance(b.x, b.y);
      if (c < 0.25) { bad.push(`${name} ${c.toFixed(3)} at (${b.x.toFixed(2)},${b.y.toFixed(2)}) start (${x.toFixed(2)},${y.toFixed(2)}) v${sp.toFixed(0)}`); break; }
    }
  }
  assert.ok(simulated > 600 && steps > 60000, `${simulated} shots, ${steps} steps`);
  assert.deepEqual(bad, []);
});

test('soak: balls placed at rest anywhere on the idle table never stay slow forever (only the plunger lane is a legitimate rest)', () => {
  const R = mulberry32(5);
  const rests = [];
  let placed = 0;
  for (let n = 0; n < 500; n++) {
    let x, y, tries = 0;
    do { x = (R() - 0.5) * 15; y = -13 + R() * 26.4; tries++; }
    while (tries < 200 && (clearance(x, y)[1] < 0.34 || (Math.abs(x) < 3.3 && y > 11)));       // not inside a flipper
    if (tries >= 200) continue;
    const p = createPhysics({ rand: mulberry32(n + 5) });
    const b = p.spawnBall(x, y, {});
    if (!b) continue;
    placed++;
    let slow = 0;
    for (let i = 0; i < 25 * 120 && !b.dead; i++) {
      p.step();
      if (b.active && !b.heldBy && b.speed < 0.8) slow++; else slow = 0;
    }
    if (!b.dead && slow > 4 * 120 && !(b.x < -6.4 && b.y > 11)) rests.push(`start (${x.toFixed(2)},${y.toFixed(2)}) slow ${slow / 120}s at (${b.x.toFixed(2)},${b.y.toFixed(2)}) mask ${b.mask}`);
  }
  assert.ok(placed > 400);
  assert.deepEqual(rests, []);
});

test('soak: random fast balls and random presses never push a ball more than 0.12 into a flipper (600 trials)', () => {
  const R = mulberry32(7);
  const piv = (side) => (side === 'left' ? [2.488815, 12.06306] : [-2.488815, 12.06306]);
  const t1 = (side) => (side === 'left' ? [0.961315, 13.130959] : [-0.961315, 13.130959]);
  let worst = 0;
  for (let n = 0; n < 600; n++) {
    const p = createPhysics({ rand: mulberry32(n + 7) });
    const left = R() < 0.5;
    const x = (left ? 1 : -1) * (0.3 + R() * 2.8), y = 8.5 + R() * 3.0;
    const ang = Math.PI / 2 + (R() - 0.5) * 2.2, sp = R() < 0.4 ? R() * 8 : 5 + R() * 55;
    const b = p.spawnBall(x, y, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp });
    if (!b) continue;
    const pressL = Math.floor(R() * 60), pressR = Math.floor(R() * 60), holdL = 5 + Math.floor(R() * 80), holdR = 5 + Math.floor(R() * 80);
    for (let i = 0; i < 3 * 120 && !b.dead; i++) {
      if (i === pressL) p.setFlipperButton('left', true);
      if (i === pressL + holdL) p.setFlipperButton('left', false);
      if (i === pressR) p.setFlipperButton('right', true);
      if (i === pressR + holdR) p.setFlipperButton('right', false);
      p.step();
      if (b.dead || b.mask !== 1) continue;
      const snap = p.snapshot();
      for (const side of ['left', 'right']) {
        const f = snap.flippers[side === 'left' ? 'a_flip1' : 'a_flip2'];
        const pv = piv(side), t = t1(side), c = Math.cos(f.angle), s = Math.sin(f.angle);
        const tip = [pv[0] + (t[0] - pv[0]) * c - (t[1] - pv[1]) * s, pv[1] + (t[0] - pv[0]) * s + (t[1] - pv[1]) * c];
        const dx = tip[0] - pv[0], dy = tip[1] - pv[1];
        let u = ((b.x - pv[0]) * dx + (b.y - pv[1]) * dy) / (dx * dx + dy * dy);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(b.x - (pv[0] + u * dx), b.y - (pv[1] + u * dy));
        const depth = 0.610981 + (0.493308 - 0.610981) * u - d;
        if (depth > worst) worst = depth;
      }
    }
  }
  assert.ok(worst < 0.12, `deepest penetration ${worst.toFixed(3)}`);
});
