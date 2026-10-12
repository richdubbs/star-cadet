/**
 * tests/data.test.mjs
 * OWNER: DATA
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 3.10 / 13.2. Run: node --test tests/data.test.mjs
 * Verifies src/data/** against the contract (counts, freezing, unique export names), against research/physics_data.json (every shipped `edges` array,
 * masks, materials, kickers), against an independent reference re-inflation of the raw geometry (paraphrase of SPEC 4.6, NOT the PHYSICS code), and against
 * the SPEC text itself (tables of 2.x, 3.2, 3.5.1, 5.7.3, 7.3, 7.4, Appendix A/B/D). Reading research/ with fs is allowed in DATA tests only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as data from '../src/data/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// research/ (SPEC and the extracted data) is private and not part of the public repo: the cross-checks against it are skipped without it.
const HAS_RESEARCH = fs.existsSync(path.join(ROOT, 'research', 'SPEC.md'));
const SPEC = HAS_RESEARCH ? readText('research/SPEC.md') : '';
const PHYS = HAS_RESEARCH ? JSON.parse(readText('research/physics_data.json')) : null;
const LAYOUT = HAS_RESEARCH ? JSON.parse(readText('research/layout_data.json')) : null;
const rtest = HAS_RESEARCH ? test : (name, fn) => test(name, { skip: 'needs the private research/ folder' }, fn);

// The game words its messages in its own way; SPEC quotes the original wording. REWORD maps SPEC text -> shipped text.
const BS = '\\'; // a literal backslash, as SPEC writes line breaks (\n)
const REWORD_MAP = [
  ['3D Pinball' + BS + 'nSpace Cadet', 'Star Cadet' + BS + 'nPinball'],
  ['3D Pinball - Space Cadet', 'Star Cadet Pinball'],
  ['Hit Mission Targets To Select Mission', 'Hit Mission Targets to Pick a Mission'],
  ['Launch Ramp To Accept', 'Launch Ramp Starts'],
  ['Hit Hyperspace Chute or Launch Ramp', 'Shoot Hyperspace Chute or Launch Ramp'],
  ['Hyperspace Chute to end Maelstrom', 'Hyperspace Chute Ends Maelstrom'],
  ['Hit Space Warp Rollover', 'Roll Over Space Warp'],
  ['Hit Yellow Wormhole', 'Shoot Yellow Wormhole'],
  ['Hit Red Wormhole', 'Shoot Red Wormhole'],
  ['Hit Green Wormhole', 'Shoot Green Wormhole'],
  ['Hit Worm Hole', 'Find the Wormhole'],
  ['Hit Launch Ramp', 'Shoot Launch Ramp'],
  ['Hit Flags', 'Shoot the Flags'],
  ['Shoot Ball Up Fuel Chute', 'Shoot the Fuel Chute'],
  ['Enter Wormhole', 'Shoot the Wormhole'],
  ['Enter Black Hole', 'Shoot the Black Hole'],
  ['Upgrade Launch Bumpers', 'Power Up Launch Bumpers'],
  ['Upgrade Attack Bumpers', 'Power Up Attack Bumpers'],
  ['Upgrade Flags', 'Power Up Flags'],
  ['Fill Right Hazard Banks', 'Light Right Hazard Banks'],
  ['Fill Left Hazard Banks', 'Light Left Hazard Banks'],
  ['Awaiting Deployment', 'Ready for Launch'],
  ['Mission Accepted', 'Mission Started'],
  ['Mission Completed', 'Mission Complete'],
  ['Mission Aborted', 'Mission Failed'],
  ['Promotion to', 'Promoted to'],
  ['Demotion to', 'Demoted to'],
  ['Re-Fuel Ship', 'Refuel the Ship'],
  ['Target Training Passed', 'Target Practice Complete'],
  ['Launch Training Passed', 'Launch Training Complete'],
  ['Re-Entry Training Passed', 'Re-Entry Training Complete'],
  ['Warning -- Low Fuel', 'Low Fuel Warning'],
  ['Comet Destroyed', 'Comet Blasted'],
  ['Radiation Eliminated', 'Radiation Cleared'],
  ['Black Hole Eliminated', 'Black Hole Collapsed'],
  ['Xenomorphs Destroyed', 'Bugs Exterminated'],
  ['Survivors Rescued', 'Crew Rescued'],
  ['Aliens Repelled', 'Aliens Driven Off'],
  ['Satellite Repaired', 'Satellite Recovered'],
  ['Survey Complete', 'Recon Complete'],
  ['Doomsday Machine Destroyed', 'Doomsday Machine Down'],
  ['Roll Flags:', 'Flag Rolls:'],
  ['Plague Eliminated', 'Plague Cured'],
  ['Plans Recovered', 'Secret Plans Found'],
  ['Replay Awarded', 'Replay Earned'],
  ['Weapons Upgraded', 'Weapons Powered Up'],
  ['Engine Upgraded', 'Engines Powered Up'],
  ['Flags Upgraded', 'Flags Powered Up'],
  ['Extra Ball Available', 'Extra Ball Lit'],
  ['Reflex Shot Award', 'Reflex Shot'],
  ['Jackpot Awarded', 'Jackpot!'],
  ['Jackpot Activated', 'Jackpot Lit'],
  ['Bonus Activated', 'Bonus Lit'],
  ['Careful...', 'Easy Now...'],
  ['Ship Re-Fueled', 'Fuel Tanks Full'],
  ['Level One Commendation', 'Commendation: Level 1'],
  ['Level Two Commendation', 'Commendation: Level 2'],
  ['Level Three Commendation', 'Commendation: Level 3'],
  ['Field Multiplier', 'Score Multiplier'],
  ['Gravity Normalized', 'Gravity Restored'],
  ['Wormhole Opened', 'Wormhole Open'],
  ['Re-Deploy', 'Ball Saved'],
  ['Shoot Again', 'Shoots Again'],
];
const REWORD_LEFT = new RegExp('(' + BS + BS + 'n|\n|Launches |Re-Entries )Left: ', 'g');
const reword = (s) => REWORD_MAP.reduce((t, [a, b]) => t.split(a).join(b), s).replace(REWORD_LEFT, '$1To Go: ');

const {
  TABLE, PHYS: PHYS_C, MASKS, Z, CAMERA, PANEL, DEFAULT_KEYS, NAMES, TIMING, projectToTablePx, unprojectFloor,
  EV, EVENT_TYPES, HEIGHTS, DEFAULT_MATERIAL, DEFAULT_KICKER, MATERIALS, KICKERS, SCORE, MULTIPLIERS, POTS, acceptScoreFor,
  APP_TITLE, fmt, INFO, MISSION_TEXT, RANK_NAMES, MISSION_NAMES, COMPONENT_NAMES, BANKS, LAMP_NAMES, LAMP_GROUP_NAMES, FUEL_BARGRAPH_NAME, ALL_LAMPS_GROUP_NAME,
  SOUND_FILES, MUSIC_FILE, NEVER_FETCH, SOUND_KEYS, SOUND_EVENT_MAP, SOUND_SOURCES, fileNameOf, soundDuration, SILENT_SOUND,
  WALLS, POSTS, TABLE_OUTLINE, FLIPPERS, PLUNGER, BUMPERS, POPUP_TARGETS, SOLO_TARGETS, KICKBACKS, GATES, BLOCKER, DRAIN, KICKOUTS, SINKS, RAMP_HOLE,
  ONEWAYS, TRIPWIRES, ROLLOVERS, FLAGS, DEMO_TRIGGERS, DEMO_TIMERS, getComponent, RAMPS, DECK_FLOOR_POLY, RAMP_FOOTPRINT_POLY,
  LAMPS, LAMP_BY_NAME, LAMP_GROUPS, FUEL_BARGRAPH, LAMP_HOOK_NAMES, LAMP_FLASH_DEFAULT, LAMP_FLASH_OVERRIDES,
  MISSION_STATE, MISSIONS, MISSION_SELECT, rankGroupOf, missionForRank, deepFreeze,
} = data;

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`.trim());
const nearPt = (a, b, tol, msg) => { near(a[0], b[0], tol, msg + ' x'); near(a[1], b[1], tol, msg + ' y'); };
function sec(start, end) {
  const a = SPEC.indexOf(start);
  assert.ok(a >= 0, 'SPEC marker not found: ' + start);
  const b = end ? SPEC.indexOf(end, a + start.length) : SPEC.length;
  assert.ok(b > a, 'SPEC end marker not found: ' + end);
  return SPEC.slice(a, b);
}
const rowsOf = (text, startRe) => text.split('\n').filter((l) => startRe.test(l)).map((l) => l.split('|').slice(1, -1).map((s) => s.trim()));
const pairs = (s) => [...s.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const nums = (s) => [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
const dropClosing = (p) => (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? p.slice(0, -1) : p);
const shoelace = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const distToPoly = (p, poly) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
};
const pip = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };

// independent reference installer (paraphrase of SPEC 4.6): one-sided line shifted along n = (dy,-dx)/len, corner circles at convex vertices
function refLine(p0, p1, off) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy), nx = dy / len, ny = -dx / len;
  return { k: 'line', x0: p0[0] + nx * off, y0: p0[1] + ny * off, x1: p1[0] + nx * off, y1: p1[1] + ny * off, nx, ny };
}
function refWall(pts, off) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], v = pts[i], q = pts[(i + 1) % n];
    const cr = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
    if (off !== 0 && Math.sign(cr) === Math.sign(off)) out.push({ k: 'circle', cx: v[0], cy: v[1], r: off * 1.001 });
    out.push(refLine(v, q, off));
  }
  return out;
}
const refCircle = (c, r, off) => [{ k: 'circle', cx: c[0], cy: c[1], r: r + off }];
function edgesClose(actual, expected, tol, label, tags = false) {
  assert.equal(actual.length, expected.length, `${label}: edge count ${actual.length} vs ${expected.length}`);
  actual.forEach((a, i) => {
    const e = expected[i];
    assert.equal(a.k, e.k, `${label}[${i}] kind`);
    for (const key of a.k === 'line' ? ['x0', 'y0', 'x1', 'y1', 'nx', 'ny'] : ['cx', 'cy', 'r']) near(a[key], e[key], tol, `${label}[${i}].${key}`);
    if (tags) { assert.equal(a.role, e.role, `${label}[${i}] role`); assert.equal(a.gate, e.gate, `${label}[${i}] gate`); }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// structure: counts, freezing, unique names, plain data
// ---------------------------------------------------------------------------------------------------------------------
test('counts of ARCHITECTURE 3.3 / 3.6', () => {
  const counts = {
    WALLS: [WALLS, 45], POSTS: [POSTS, 19], FLIPPERS: [FLIPPERS, 2], BUMPERS: [BUMPERS, 7], POPUP_TARGETS: [POPUP_TARGETS, 9], SOLO_TARGETS: [SOLO_TARGETS, 13],
    KICKBACKS: [KICKBACKS, 2], GATES: [GATES, 2], KICKOUTS: [KICKOUTS, 3], SINKS: [SINKS, 4], ONEWAYS: [ONEWAYS, 9], TRIPWIRES: [TRIPWIRES, 5], ROLLOVERS: [ROLLOVERS, 18],
    FLAGS: [FLAGS, 2], DEMO_TRIGGERS: [DEMO_TRIGGERS, 5], LAMPS: [LAMPS, 140], LAMP_NAMES: [LAMP_NAMES, 140], LAMP_GROUPS: [LAMP_GROUPS, 18],
    DECK_FLOOR_POLY: [DECK_FLOOR_POLY, 49], RAMP_FOOTPRINT_POLY: [RAMP_FOOTPRINT_POLY, 20],
  };
  for (const [name, [list, n]] of Object.entries(counts)) assert.equal(list.length, n, name);
  assert.equal(RAMPS.ramp.planes.length, 18);
  assert.equal(RAMPS.tube.planes.length, 2);
  assert.equal(TABLE_OUTLINE.edges.length, 4);
  for (const x of [PLUNGER, BLOCKER, DRAIN, RAMP_HOLE]) assert.ok(x && x.edges.length >= 1);
  assert.equal(ROLLOVERS.filter((r) => r.light).map((r) => r.name).join(), 'a_roll9');
  assert.equal(Object.keys(MISSIONS).length, 17);
  assert.equal(LAMP_GROUP_NAMES.length, 18);
});

test('every export is deep-frozen JSON-like data (functions only where documented)', async () => {
  const dir = path.join(ROOT, 'src/data');
  const problems = [];
  const walk = (v, where) => {
    if (typeof v === 'function') return;
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) problems.push(`${where}: bad number ${v}`);
      if (v === undefined) problems.push(`${where}: undefined`);
      return;
    }
    if (!Object.isFrozen(v)) problems.push(`${where}: not frozen`);
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype) problems.push(`${where}: exotic prototype`);
    for (const k of Object.keys(v)) walk(v[k], `${where}.${k}`);
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'index.js')) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    for (const [name, value] of Object.entries(mod)) walk(value, `${f}:${name}`);
  }
  assert.deepEqual(problems, []);
  assert.throws(() => { 'use strict'; WALLS[0].pts[0][0] = 99; }, TypeError);
  assert.throws(() => { 'use strict'; LAMPS[0].colors[0].lit = '#000000'; }, TypeError);
  assert.throws(() => { 'use strict'; SOUND_FILES.SOUND1.bytes = 1; }, TypeError);
});

test('export names are unique across the data files and the barrel re-exports all of them', async () => {
  const dir = path.join(ROOT, 'src/data');
  const seen = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'index.js')) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    for (const name of Object.keys(mod)) {
      assert.ok(!seen.has(name), `export ${name} is defined in both ${seen.get(name)} and ${f}`);
      seen.set(name, f);
    }
  }
  for (const name of seen.keys()) assert.ok(name in data, `barrel misses ${name}`);
  assert.equal(Object.keys(data).length, seen.size);
});

test('data modules do not import anything outside src/data and carry the DATA header', () => {
  const dir = path.join(ROOT, 'src/data');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(src.slice(0, 1500), /OWNER:\s*DATA/, f);
    assert.match(src.slice(0, 1500), /STATUS:\s*IMPLEMENTED/, f);
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) assert.ok(/^\.\/[a-z_]+\.js$/.test(m[1]), `${f} imports ${m[1]}`);
  }
});

rtest('the committed generated modules are exactly what tools/gen_data.mjs produces (no drift)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-data-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/gen_data.mjs')], { env: { ...process.env, GEN_DATA_OUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['walls.js', 'components.js', 'ramps.js', 'lamps.js']) {
      assert.equal(fs.readFileSync(path.join(out, f), 'utf8'), readText('src/data/' + f), `${f} differs from the generator output: run node tools/gen_data.mjs`);
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------
// walls, posts, outline
// ---------------------------------------------------------------------------------------------------------------------
rtest('walls: SPEC 3.2 table (pts, mask, material, solidity, height) and B.1 vertices', () => {
  const table = new Map(rowsOf(sec('### 3.2 Wall polygons', 'Raw vertices (closed;'), /^\|\s*\d+/).map((c) => [Number(/^\d+/.exec(c[0])[0]), c]));
  const b1 = new Map();
  for (const line of sec('### B.1 Wall polygon vertices', '### B.2').split('\n')) {
    const m = /^(\d+) m(\d+) mat([\d.]+)\/([\d.]+) (.*)$/.exec(line.trim());
    if (m) b1.set(Number(m[1]), { mask: Number(m[2]), sm: Number(m[3]), el: Number(m[4]), pts: dropClosing(pairs(m[5])) });
  }
  assert.equal(table.size, 45);
  assert.equal(b1.size, 45);
  assert.deepEqual(WALLS.map((w) => w.group), [...table.keys()]);
  for (const w of WALLS) {
    const row = table.get(w.group), v = b1.get(w.group);
    assert.equal(w.pts.length, Number(row[1]), `${w.name} pts`);
    assert.equal(w.mask, Number(row[5]), `${w.name} mask`);
    const [sm, el] = row[4].split('/').map(Number);
    assert.deepEqual([w.material.smoothness, w.material.elasticity], [sm, el], `${w.name} material`);
    assert.deepEqual([v.sm, v.el, v.mask], [sm, el, w.mask]);
    assert.equal(w.name, w.group >= 469 ? 'v_rebo' + (w.group - 468) : 'wall_' + w.group);
    const S = shoelace(w.pts);
    assert.equal(w.solid, S > 0 ? 'island' : 'shell', `${w.name} solid vs shoelace ${S}`);
    assert.equal(w.solid === 'shell', w.group === 103 || w.group === 106);
    assert.ok(row[6].startsWith(w.solid === 'island' ? 'island' : 'SHELL'));
    w.pts.forEach((p, i) => nearPt(p, v.pts[i], 1.1e-4, `${w.name} B.1 vertex ${i}`));
    assert.notDeepEqual(w.pts[0], w.pts[w.pts.length - 1], `${w.name}: closing duplicate must be removed`);
    if (w.solid === 'shell') assert.equal(w.top, null); else assert.ok(w.top > 0);
    const h = /^(\d+(?:\.\d+)?)/.exec(row[7]) ?? /rubber top (\d+(?:\.\d+)?)/.exec(row[7]);
    if (w.top !== null) near(w.top, Number(h[1]), 1e-9, `${w.name} top`);
    assert.equal(w.endCapTop, /end caps/.test(row[7]) ? 0.9 : null);
  }
  const by = Object.fromEntries(WALLS.map((w) => [w.group, w]));
  assert.deepEqual([by[306].mask, by[309].mask, by[103].mask, by[106].mask, by[280].mask], [4, 4, 6, 2, 1]);
  assert.deepEqual([by[329].material, by[330].material, by[331].material, by[103].material, by[106].material], Array(5).fill(MATERIALS[97]));
  assert.deepEqual(by[469].material, DEFAULT_MATERIAL);
  assert.equal(by[469].lamp, 'lite84'); assert.equal(by[470].lamp, 'lite85'); assert.equal(by[471].lamp, null);
  for (const w of WALLS) assert.deepEqual(w.kicker, w.group >= 469 ? { threshold: 1, boost: 18 } : null);
  assert.equal(by[306].top, 1.6); assert.equal(by[308].top, 1.77); assert.equal(by[329].top, 0.6); assert.equal(by[331].top, 0.5);
});

rtest('posts: SPEC 3.3 table and circle edges r + 0.3', () => {
  const rows = rowsOf(sec('### 3.3 Posts (type 1010, circles)', '### 3.4'), /^\|\s*\d+/);
  assert.equal(rows.length, 19);
  for (const [i, p] of POSTS.entries()) {
    const row = rows[i];
    assert.equal(p.group, Number(row[0]));
    assert.equal(p.name, 'post_' + p.group);
    nearPt(p.c, pairs(row[1])[0], 1e-4, p.name);
    near(p.r, Number(row[2]), 1e-4, p.name + ' r');
    assert.equal(p.mask, Number(row[3]));
    assert.deepEqual(p.material, MATERIALS[96]);
    assert.equal(p.top, p.mask === 4 ? 1.57 : 0.9);
    edgesClose(p.edges, refCircle(p.c, p.r, 0.3), 1e-6, p.name);
  }
});

test('the table outline is four un-inflated lines pointing INTO the table (inward normals)', () => {
  assert.equal(TABLE_OUTLINE.mask, 1);
  assert.deepEqual(TABLE_OUTLINE.material, { smoothness: 0.95, elasticity: 0.6 });
  assert.deepEqual(TABLE_OUTLINE.kicker, { threshold: 5, boost: 15 });
  const centre = [0, 0.5];
  const covered = new Set();
  for (const e of TABLE_OUTLINE.edges) {
    assert.equal(e.k, 'line');
    near(Math.hypot(e.nx, e.ny), 1, 1e-12);
    const dx = e.x1 - e.x0, dy = e.y1 - e.y0, len = Math.hypot(dx, dy);
    near(e.nx, dy / len, 1e-12); near(e.ny, -dx / len, 1e-12);                                   // n = (dy, -dx)/len
    assert.ok((centre[0] - e.x0) * e.nx + (centre[1] - e.y0) * e.ny > 0, 'normal must point into the table');
    for (const [x, y] of [[e.x0, e.y0], [e.x1, e.y1]]) assert.ok(Math.abs(Math.abs(x) - 8) < 1e-12 || y === 15 || y === -14, 'un-inflated');
    covered.add(`${Math.min(e.x0, e.x1)},${Math.min(e.y0, e.y1)},${Math.max(e.x0, e.x1)},${Math.max(e.y0, e.y1)}`);
  }
  assert.equal(covered.size, 4);
  assert.deepEqual([...covered].sort(), ['-8,-14,-8,15', '-8,-14,8,-14', '-8,15,8,15', '8,-14,8,15']);
});

// ---------------------------------------------------------------------------------------------------------------------
// physics_data.json cross-check: every edges array, masks, materials, kickers
// ---------------------------------------------------------------------------------------------------------------------
function defForPhys(c) {
  if (c.type === 1000) return WALLS.find((w) => w.group === c.id);
  if (c.type === 1010) return POSTS.find((p) => p.group === c.id);
  if (c.type === 1021) return c.name === 'ramp' ? RAMPS.ramp : RAMPS.tube;
  if (c.type === 1023) return { mask: 1, edges: [] };
  const hit = getComponent(c.name);
  return hit ? hit.def : undefined;
}
rtest('every component of physics_data.json has a def whose edges, mask, material and kicker match (1e-6)', () => {
  assert.equal(PHYS.components.length, 147);
  let edgeCount = 0;
  for (const c of PHYS.components) {
    const def = defForPhys(c);
    assert.ok(def, `no def for ${c.name ?? c.id}`);
    const label = c.name ?? 'group ' + c.id;
    if (c.type !== 1023) assert.equal(def.group, c.id, label + ' group');
    assert.equal(def.mask, c.collision_mask, label + ' mask');
    if (c.type !== 1001 && c.type !== 1003 && c.type !== 1004 && c.type !== 1021 && c.type !== 1023) {
      const mat = def.material ?? DEFAULT_MATERIAL;
      assert.deepEqual([mat.smoothness, mat.elasticity], [c.smoothness, c.elasticity], label + ' material');
    }
    if (c.type === 1000 || c.type === 1005 || c.type === 1006 || c.type === 1019) {
      const k = def.kicker;
      const kc = c.kicker ?? {};
      if (c.type === 1000 && !c.kicker) assert.equal(k, null, label + ' kicker');
      else {
        assert.equal(k.threshold, kc['401'] ?? DEFAULT_KICKER.threshold, label + ' threshold');
        assert.equal(k.boost, kc['402'] ?? 0, label + ' boost');
      }
    }
    if (c.type === 1014) { assert.equal(def.kicker.boost, c.kicker['402']); assert.equal(def.kicker.threshold, 0); }
    if (c.type === 1012 || c.type === 1029 || c.type === 1017) {
      const kc = c.kicker;
      assert.equal(def.boost, kc['402'], label + ' boost'); assert.equal(def.throwMult, kc['403'], label + ' throwMult');
      if (c.type !== 1017) assert.equal(def.angleMult, kc['405'], label + ' angle');
      assert.deepEqual(c.type === 1017 ? def.throwDir : def.throwDir.slice(0, 3), c.type === 1017 ? kc.dir.slice(0, 2) : kc.dir, label + ' dir');
    }
    if (Array.isArray(def.edges)) {
      const ex = c.edges ?? [];
      edgesClose(def.edges, ex, 1e-6, label, true);
      edgeCount += ex.length;
      for (const e of def.edges) assert.ok(!('mask' in e) && !('owner' in e));
    }
  }
  assert.ok(edgeCount > 1100, 'expected ~1150 shipped edges, got ' + edgeCount);
  edgeCount += 0;
});

test('reference re-inflation of the raw geometry reproduces every shipped edge (1e-4)', () => {
  const R = 0.3;
  for (const w of WALLS) edgesClose(w.edges, refWall(w.pts, R), 1e-4, w.name);
  for (const t of [...POPUP_TARGETS, ...SOLO_TARGETS]) edgesClose(t.edges, refWall(t.poly, R), 1e-4, t.name);
  for (const b of BUMPERS) edgesClose(b.edges, refCircle(b.c, b.r, R), 5e-6, b.name);
  edgesClose(BLOCKER.edges, refCircle(BLOCKER.c, BLOCKER.r, R), 1e-6, 'v_bloc1');
  for (const k of KICKBACKS) edgesClose(k.edges, [refLine(k.line[0], k.line[1], R)], 1e-4, k.name);
  for (const g of GATES) edgesClose(g.edges, [refLine(g.line[0], g.line[1], R)], 1e-4, g.name);
  edgesClose(DRAIN.edges, [refLine(DRAIN.line[0], DRAIN.line[1], R)], 1e-4, 'drain');
  edgesClose(PLUNGER.edges, [refLine(PLUNGER.face[0], PLUNGER.face[1], R)], 1e-4, 'plunger');
  for (const s of SINKS) edgesClose(s.edges, [refLine(s.line[0], s.line[1], R)], 1e-4, s.name);
  for (const t of TRIPWIRES) edgesClose(t.edges, [refLine(t.p0, t.p1, R)], 1e-4, t.name);
  for (const o of ONEWAYS) {
    edgesClose(o.edges, [refLine(o.p0, o.p1, R), refLine(o.p1, o.p0, -0.24)], 1e-4, o.name);
    assert.deepEqual(o.edges.map((e) => e.role), ['wall', 'passthrough']);
  }
  for (const f of FLAGS) edgesClose(f.edges, [refLine(f.p1, f.p0, 0), refLine(f.p0, f.p1, 0)], 1e-4, f.name);
  for (const r of ROLLOVERS) {
    const entry = refWall(r.entry, 0), exit = refWall(r.exit, 0);
    edgesClose(r.edges, [...entry, ...exit], 1e-4, r.name);
    assert.deepEqual(r.edges.map((e) => e.gate), [...entry.map(() => 'active'), ...exit.map(() => 'rolloverflag')]);
  }
  for (const k of KICKOUTS) edgesClose(k.edges, [{ k: 'circle', cx: k.c[0], cy: k.c[1], r: k.captureRadius }], 2e-6, k.name);
  edgesClose(RAMP_HOLE.edges, [{ k: 'circle', cx: RAMP_HOLE.c[0], cy: RAMP_HOLE.c[1], r: RAMP_HOLE.captureRadius }], 2e-6, 'ramp_hole');
});

rtest('the raw geometry equals layout_data.json (6 decimals) for walls, posts and components', () => {
  const lay = new Map(LAYOUT.components.map((c) => [c.group, c]));
  for (const w of WALLS) { const l = lay.get(w.group); assert.equal(w.pts.length, l.points.length - 1); w.pts.forEach((p, i) => nearPt(p, l.points[i], 1e-6, w.name)); }
  for (const p of POSTS) { const l = lay.get(p.group); nearPt(p.c, l.points[0], 1e-6, p.name); near(p.r, l.radius, 1e-6, p.name); }
  for (const t of [...POPUP_TARGETS, ...SOLO_TARGETS]) { const l = lay.get(t.group); assert.equal(t.poly.length, 4); t.poly.forEach((p, i) => nearPt(p, l.points[i], 1e-6, t.name)); }
  for (const o of [...ONEWAYS, ...TRIPWIRES]) { const l = lay.get(o.group); nearPt(o.p0, l.points[0], 1e-6, o.name); nearPt(o.p1, l.points[1], 1e-6, o.name); }
  for (const r of ROLLOVERS) { const l = lay.get(r.group); assert.equal(r.entry.length, l.points.length - 1); r.entry.forEach((p, i) => nearPt(p, l.points[i], 1e-6, r.name)); }
});

// ---------------------------------------------------------------------------------------------------------------------
// components against SPEC section 2
// ---------------------------------------------------------------------------------------------------------------------
rtest('flippers (SPEC 2.3), plunger (2.4), blocker/drain (2.8)', () => {
  const [l, r] = FLIPPERS;
  assert.deepEqual([l.name, l.side, r.name, r.side], ['a_flip1', 'left', 'a_flip2', 'right']);
  assert.deepEqual(l.pivot, [2.488815, 12.06306]); assert.equal(l.pivotR, 0.310981);
  assert.deepEqual(l.restTip, [0.961315, 13.130959]); assert.deepEqual(l.raisedTip, [0.961315, 11.00657]); assert.equal(l.tipR, 0.193308);
  assert.deepEqual(r.pivot, [-2.489, 12.06306]); assert.deepEqual(r.restTip, [-0.961, 13.130959]); assert.deepEqual(r.raisedTip, [-0.961, 11.00657]);
  assert.equal(l.angleMax, 1.21523); assert.equal(r.angleMax, -1.214923);
  for (const f of FLIPPERS) { assert.deepEqual([f.extendSeconds, f.retractSeconds, f.collisionMult, f.mask], [0.04, 0.08, 0.9, 1]); assert.deepEqual(f.material, { smoothness: 0.5, elasticity: 0.75 }); }
  near(Math.hypot(l.restTip[0] - l.pivot[0], l.restTip[1] - l.pivot[1]), 1.8638, 1e-3);
  assert.deepEqual(PLUNGER.face, [[-8.002954, 11.974978], [-6.384019, 11.974978]]);
  assert.deepEqual(PLUNGER.feed, [-7.020939, 10.084854]);
  assert.deepEqual(PLUNGER.material, { smoothness: 0.5, elasticity: 0.5 });
  assert.deepEqual([PLUNGER.maxBoost, PLUNGER.tickSeconds, PLUNGER.feedDelay], [100, 0.025, 0.96]);
  assert.deepEqual(PLUNGER.edges, [{ k: 'line', x0: -8.002954, y0: 11.674978, x1: -6.384019, y1: 11.674978, nx: 0, ny: -1 }]);
  assert.deepEqual(BLOCKER.c, [0.000002, 13.25]); assert.equal(BLOCKER.r, 0.175); assert.equal(BLOCKER.lamp, 'lite1');
  assert.deepEqual(DRAIN.line, [[-10.391989, 14.437246], [10.32141, 14.437246]]); assert.equal(DRAIN.delaySeconds, 1.82);
  assert.deepEqual(DRAIN.edges, [{ k: 'line', x0: -10.391989, y0: 14.137246, x1: 10.32141, y1: 14.137246, nx: 0, ny: -1 }]);
});

rtest('bumpers (SPEC 2.5), popup targets (2.17), solo targets (2.18)', () => {
  const rows = rowsOf(sec('### 2.5 Pop bumpers', '### 2.6'), /^\|\s*a_bump\d/);
  assert.equal(rows.length, 7);
  for (const [i, b] of BUMPERS.entries()) {
    assert.equal(b.name, rows[i][0]); assert.equal(b.group, Number(rows[i][1]));
    nearPt(b.c, pairs(rows[i][2])[0], 1e-3, b.name);
    assert.equal(b.r, i < 4 ? 0.35 : 0.25); assert.equal(b.kind, i < 4 ? 'attack' : 'launch'); assert.equal(b.mask, Number(rows[i][4]));
    assert.deepEqual(b.kicker, i < 4 ? { threshold: 2.5, boost: 17 } : { threshold: 2.5, boost: 12 }); assert.equal(b.hitSeconds, 0.1);
  }
  const pop = rowsOf(sec('### 2.17 Pop-up (drop) targets', '### 2.18'), /^\|\s*a_targ\d/);
  assert.equal(pop.length, 9);
  for (const [i, t] of POPUP_TARGETS.entries()) {
    assert.equal(t.name, pop[i][0]); assert.equal(t.group, Number(pop[i][1]));
    nearPt(t.center, pairs(pop[i][2])[0], 1.5e-3, t.name + ' centre');
    const poly = pairs(pop[i][5]); t.poly.forEach((p, j) => nearPt(p, poly[j], 1.1e-4, t.name));
    assert.equal(t.bank, ['booster', 'medal', 'multiplier'][Math.floor(i / 3)]); assert.equal(t.index, i % 3);
    assert.deepEqual(t.kicker, { threshold: 3, boost: 5 }); assert.equal(t.repopSeconds, 0.25); assert.equal(t.top, 0.7);
  }
  const solo = rowsOf(sec('### 2.18 Solo (spot) targets', '### 2.19'), /^\|\s*a_targ\d/);
  assert.equal(solo.length, 13);
  const kinds = ['fuel', 'fuel', 'fuel', 'mission', 'mission', 'mission', 'leftHazard', 'leftHazard', 'leftHazard', 'rightHazard', 'rightHazard', 'rightHazard', 'wormhole'];
  for (const [i, t] of SOLO_TARGETS.entries()) {
    assert.equal(t.name, solo[i][0]); assert.equal(t.group, Number(solo[i][1]));
    nearPt(t.center, pairs(solo[i][2])[0], 1.5e-3, t.name + ' centre');
    const poly = pairs(solo[i][solo[i].length - 1]); t.poly.forEach((p, j) => nearPt(p, poly[j], 1.1e-4, t.name));
    assert.equal(t.lamp, solo[i].find((c) => /^lite\d+$/.test(c))); assert.equal(t.bankKind, kinds[i]);
    assert.deepEqual(t.kicker, { threshold: 3, boost: 5 }); assert.equal(t.rearmSeconds, 0.1);
  }
  assert.deepEqual(SOLO_TARGETS.map((t) => t.top), [0.4, 0.7, 0.45, 0.2, 0.2, 0.2, 0.33, 0.33, 0.33, 0.33, 0.33, 0.33, 0.36]);
  for (const [bank, list] of Object.entries(BANKS)) {
    const defs = list.map((n) => getComponent(n).def);
    for (const [i, d] of defs.entries()) assert.deepEqual([d.bank ?? d.bankKind, d.index], [bank === 'fuelSpot' ? 'fuel' : bank === 'missionSpot' ? 'mission' : bank === 'wormholeTarget' ? 'wormhole' : bank, i], d.name);
  }
});

rtest('kickbacks and gates (SPEC 2.7), kickouts (2.9), sinks (2.10), ramp hole (2.11)', () => {
  const kb = rowsOf(sec('### 2.7 Outlane kickbacks', '### 2.8'), /^\|\s*(a_kick|v_gate)\d/);
  assert.equal(kb.length, 4);
  const lineOf = (row) => { const p = pairs(row[2]); return [p[0], p[1]]; };
  KICKBACKS.forEach((k, i) => { assert.equal(k.group, Number(kb[i][1])); k.line.forEach((p, j) => nearPt(p, lineOf(kb[i])[j], 1e-6, k.name)); });
  GATES.forEach((g, i) => { assert.equal(g.group, Number(kb[2 + i][1])); g.line.forEach((p, j) => nearPt(p, lineOf(kb[2 + i])[j], 1e-6, g.name)); });
  for (const k of KICKBACKS) { assert.deepEqual(k.material, { smoothness: 0.7, elasticity: 0.2 }); assert.deepEqual(k.kicker, { threshold: 0, boost: 55 }); assert.deepEqual([k.armSeconds, k.tickSeconds], [0.7, 0.1]); }
  assert.deepEqual(GATES.map((g) => g.lamps), [['lite30', 'lite196'], ['lite29', 'lite195']]);
  assert.deepEqual(KICKBACKS.map((k) => k.gate), ['v_gate1', 'v_gate2']);

  const ko = rowsOf(sec('### 2.9 Kickouts', '### 2.10'), /^\|\s*a_kout\d/);
  const want = [
    { id: 1, c: [0, 6], W: 3.2, pull: 30, f: 0.05, cap: 0.16, active: false, dir: [0, -1, 0], boost: 45, angle: 1.256637, heldZ: 0.3 },
    { id: 2, c: [-3.269448, -9.493082], W: 0.412526, pull: 32, f: 0.9, cap: 0.3713, active: true, dir: [-1, 1, 0], boost: 35, angle: 0, heldZ: 0 },
    { id: 3, c: [3.932241, -0.270534], W: 0.412526, pull: 32, f: 0.2, cap: 0.0825, active: true, dir: [-1, -1, 0], boost: 35, angle: 0, heldZ: 0 },
  ];
  assert.equal(ko.length, 3);
  KICKOUTS.forEach((k, i) => {
    const w = want[i];
    assert.equal(k.id, w.id); assert.equal(k.name, 'a_kout' + w.id); assert.equal(k.group, Number(/\d+/.exec(ko[i][2])[0]));
    nearPt(k.c, pairs(ko[i][3])[0], 1e-3, k.name); nearPt(k.c, w.c, 1e-6, k.name);
    near(k.fieldRadius, w.W, 1e-6); assert.equal(k.pull, w.pull); assert.equal(k.captureFactor, w.f); near(k.captureRadius, k.captureFactor * k.fieldRadius, 1e-7);
    near(k.captureRadius, w.cap, 1e-4); assert.equal(k.startsActive, w.active); assert.equal(k.rearms, w.id !== 1);
    assert.deepEqual(k.throwDir, w.dir); assert.equal(k.boost, w.boost); assert.equal(k.throwMult, 5); assert.equal(k.angleMult, w.angle); assert.equal(k.heldZ, w.heldZ);
    assert.equal(k.defaultHold, w.id === 1 ? SOUND_FILES.SOUND7.timer : 1.5);
  });
  assert.deepEqual(KICKOUTS.map((k) => k.role), ['gravityWell', 'hyperspace', 'blackHole']);

  const sk = rowsOf(sec('### 2.10 Sinks', '### 2.11'), /^\|\s*v_sink\d/);
  assert.equal(sk.length, 4);
  SINKS.forEach((s, i) => {
    assert.equal(s.name, sk[i][0]); assert.equal(s.group, Number(sk[i][1]));
    const ln = pairs(sk[i][3]); s.line.forEach((p, j) => nearPt(p, ln[j], 1e-6, s.name));
    nearPt(s.reemit, pairs(sk[i][4])[0], 1e-6, s.name + ' reemit');
    assert.deepEqual(s.throwDir, nums(sk[i][5]).slice(0, 2).map((v) => v)); assert.equal(s.boost, 35); assert.equal(s.throwMult, 5); assert.equal(s.holdSeconds, 2);
  });
  assert.deepEqual(SINKS.map((s) => s.color), ['red', 'green', 'yellow', null]);
  assert.deepEqual([RAMP_HOLE.c, RAMP_HOLE.fieldRadius, RAMP_HOLE.pull, RAMP_HOLE.captureFactor, RAMP_HOLE.releaseZ, RAMP_HOLE.releaseMask, RAMP_HOLE.holdSeconds, RAMP_HOLE.mask],
    [[5.870174, 7.607636], 0.325772, 10, 0.1, 0.325772, 1, 0.5, 4]);
  near(RAMP_HOLE.captureRadius, 0.0325772, 1e-9);
});

rtest('one-ways: normals equal SPEC 2.13 (+-5e-4) and are unit length; flags; tripwires; rollovers', () => {
  const ow = rowsOf(sec('### 2.13 One-way gates', '### 2.14'), /^\|\s*s_onewy\d/);
  assert.equal(ow.length, 9);
  ONEWAYS.forEach((o, i) => {
    assert.equal(o.name, ow[i][0]); assert.equal(o.group, Number(ow[i][1]));
    const [p0, p1] = pairs(ow[i][2]); nearPt(o.p0, p0, 1.1e-4, o.name); nearPt(o.p1, p1, 1.1e-4, o.name);
    nearPt(o.normal, pairs(ow[i][3])[0], 5e-4, o.name + ' normal'); near(Math.hypot(...o.normal), 1, 1e-5);
    assert.equal(o.mask, Number(ow[i][4])); assert.deepEqual(o.material, { smoothness: 0.9, elasticity: 0.8 });
  });
  assert.deepEqual(ONEWAYS.filter((o) => o.visible).map((o) => o.name), ['s_onewy1', 's_onewy9', 's_onewy10']);
  assert.deepEqual(ONEWAYS.filter((o) => o.scripted).map((o) => o.name), ['s_onewy1', 's_onewy4', 's_onewy10']);
  assert.deepEqual(ONEWAYS.filter((o) => o.sideSound).map((o) => o.name), ['s_onewy9', 's_onewy10']);
  assert.equal(ONEWAYS.find((o) => o.name === 's_onewy12').mask, 4);

  const tw = rowsOf(sec('### 2.14 Tripwires', '### 2.15'), /^\|\s*s_trip\d/);
  TRIPWIRES.forEach((t, i) => {
    assert.equal(t.name, tw[i][0]); const [p0, p1] = pairs(tw[i][2]); nearPt(t.p0, p0, 1.1e-4); nearPt(t.p1, p1, 1.1e-4);
    nearPt(t.normal, pairs(tw[i][3])[0], 1e-3, t.name + ' normal'); assert.equal(t.lamp, tw[i][tw[i].length - 1]);
  });

  const fl = rowsOf(sec('### 2.16 Flag spinners', '### 2.17'), /^\|\s*a_flag\d/);
  FLAGS.forEach((f, i) => {
    assert.equal(f.name, fl[i][0]); const [p0, p1] = pairs(fl[i][2]); nearPt(f.p0, p0, 1e-6); nearPt(f.p1, p1, 1e-6);
    assert.deepEqual([f.maxSpeed, f.minSpeed, f.decay, f.lamp], [50000, 5, 0.65, i === 0 ? 'lite19' : 'lite20']);
  });

  const ro = rowsOf(sec('### 2.15 Rollovers', '### 2.16'), /^\|\s*a_roll\d/);
  assert.equal(ro.length, 17);
  ROLLOVERS.slice(0, 17).forEach((r, i) => {
    assert.equal(r.name, ro[i][0]); assert.equal(r.group, Number(ro[i][1]));
    nearPt(r.center, pairs(ro[i][2])[0], 1.5e-3, r.name + ' centre'); assert.equal(r.mask, Number(ro[i][4]));
    assert.equal(r.light, false); assert.equal(r.spriteSeconds, 0);
    assert.equal(r.exit.length, r.entry.length);
    const lampsInRow = ro[i][6].match(/lite\w+/g) ?? []; assert.deepEqual(r.lamps, lampsInRow);
    assert.equal(r.lamp, lampsInRow.length === 1 ? lampsInRow[0] : null);
  });
  const r9 = ROLLOVERS[17];
  assert.equal(r9.name, 'a_roll9'); assert.equal(r9.light, true); assert.equal(r9.spriteSeconds, 0.15); assert.equal(r9.entry.length, 6);
  nearPt(r9.center, [5.053, -7.195], 2e-3); assert.deepEqual(r9.lamps, ['lite27', 'lite28']);
  // B.2: raw entry polygons
  const b2 = new Map(rowsOf(sec('### B.2 Raw attr-600 polygons', '## Appendix C'), /^\|\s*a_roll/).map((c) => [c[0], pairs(c[2])]));
  for (const r of ROLLOVERS) r.entry.forEach((p, i) => nearPt(p, b2.get(r.name)[i], 1.1e-4, r.name + ' B.2'));
  // exit polygon is the entry polygon walked backwards
  for (const r of ROLLOVERS) {
    const rev = r.entry.slice().reverse();
    const k = rev.findIndex((p) => Math.abs(p[0] - r.exit[0][0]) < 1e-5 && Math.abs(p[1] - r.exit[0][1]) < 1e-5);
    assert.ok(k >= 0, r.name);
    r.exit.forEach((p, i) => nearPt(p, rev[(k + i) % rev.length], 5e-6, r.name + ' exit'));
  }
});

rtest('demo triggers (SPEC 2.19) and timers', () => {
  const rows = rowsOf(sec('### 2.19 Demo / attract-mode trigger geometry', '### 2.20'), /^\|\s*14\d\d/);
  assert.equal(rows.length, 5);
  DEMO_TRIGGERS.forEach((d, i) => {
    assert.equal(d.id, Number(rows[i][0])); const p = pairs(rows[i][1]);
    assert.equal(d.shape, /^triangle/.test(rows[i][1]) ? 'triangle' : 'line'); assert.equal(d.pts.length, p.length);
    d.pts.forEach((q, j) => nearPt(q, p[j], 1.1e-4, 'trigger ' + d.id));
  });
  assert.deepEqual(DEMO_TRIGGERS.map((d) => d.action), ['leftDelayed', 'leftNow', 'rightDelayed', 'rightNow', 'plunger']);
  assert.deepEqual(DEMO_TIMERS, { t1: 0.2, t2: 0.1, u1: 0.4, u2: 0.2 });
});

test('getComponent resolves every name of COMPONENT_NAMES and nothing else', () => {
  const all = [];
  for (const v of Object.values(COMPONENT_NAMES)) all.push(...(Array.isArray(v) ? v : [v]));
  for (const n of all) { const hit = getComponent(n); assert.ok(hit, n); assert.equal(hit.def.name, n); assert.equal(typeof hit.kind, 'string'); }
  assert.equal(getComponent('a_bump1').kind, 'bumper'); assert.equal(getComponent('ramp').def, RAMPS.ramp); assert.equal(getComponent('s_ramp9').def, RAMPS.tube);
  assert.equal(getComponent('wall_280'), null); assert.equal(getComponent('post_310'), null); assert.equal(getComponent('nope'), null); assert.equal(getComponent('__proto__'), null);
  assert.equal(COMPONENT_NAMES.rollovers.length, 17); assert.equal(COMPONENT_NAMES.oneways.length, 9);
  for (const [i, n] of NAMES.kickout ? Object.entries(NAMES.kickout) : []) assert.equal(KICKOUTS[Number(i) - 1].name, n);
  for (const [i, n] of Object.entries(NAMES.sink)) assert.equal(SINKS.find((s) => s.id === Number(i)).name, n);
  for (const [i, n] of Object.entries(NAMES.kickback)) assert.equal(KICKBACKS[Number(i) - 1].name, n);
  for (const [i, n] of Object.entries(NAMES.gate)) assert.equal(GATES[Number(i) - 1].name, n);
});

// ---------------------------------------------------------------------------------------------------------------------
// ramps
// ---------------------------------------------------------------------------------------------------------------------
rtest('ramp planes: forces equal 25 sin(g1)(cos g2, sin g2) and plane heights equal SPEC 3.5.1', () => {
  const rows = rowsOf(sec('#### 3.5.1 Launch ramp', 'Seams (lines'), /^\|\s*\d+\s*\|\s*\(/);
  assert.equal(rows.length, 18);
  RAMPS.ramp.planes.forEach((pl, i) => {
    const row = rows[i];
    const [v1, v2, v3] = [pairs(row[1])[0], pairs(row[2])[0], pairs(row[3])[0]];
    [v1, v2, v3].forEach((v, j) => nearPt(pl.v[j], v, 1.1e-4, `plane ${i} v${j + 1}`));
    const zs = nums(row[4]); const [a, b, c] = pl.offset;
    pl.v.forEach((v, j) => near(a * v[0] + b * v[1] + c, zs[j], 2e-3, `plane ${i} z@v${j + 1}`));
    nums(row[5]).forEach((x, j) => near(pl.offset[j], x, 1.1e-4, `plane ${i} offset ${j}`));
    const g = nums(row[6]); near(pl.g1, g[0], 1.1e-4); near(pl.g2, g[1], 1.1e-4);
    near(pl.force[0], 25 * Math.sin(pl.g1) * Math.cos(pl.g2), 1e-3); near(pl.force[1], 25 * Math.sin(pl.g1) * Math.sin(pl.g2), 1e-3);
    const f = nums(row[7]); near(pl.force[0], f[0], 5e-3); near(pl.force[1], f[1], 5e-3);
  });
  RAMPS.tube.planes.forEach((pl) => { assert.deepEqual(pl.offset, [0, 0, -5]); assert.equal(pl.g1, 0); near(pl.g2, Math.PI / 2, 1e-5); assert.deepEqual(pl.force, [0, 0]); });
  // the 18 triangles of the ramp tile its footprint: the footprint vertices are plane vertices
  const vs = RAMPS.ramp.planes.flatMap((p) => p.v);
  for (const q of RAMP_FOOTPRINT_POLY) assert.ok(vs.some((v) => Math.hypot(v[0] - q[0], v[1] - q[1]) < 1.1e-3), 'footprint vertex ' + q);
  // ball z on the plateau: surface 1.068 -> ball centre 1.368 (SPEC 1.5)
  near(RAMPS.ramp.planes[0].offset[0] * 4.3948 + RAMPS.ramp.planes[0].offset[1] * -0.6761 + RAMPS.ramp.planes[0].offset[2], Z.deck, 2e-3);
});

rtest('ramp seams (snapped, SPEC 3.5.1/3.5.3), masks and deck polygons (3.5.2)', () => {
  const { ramp, tube } = RAMPS;
  assert.deepEqual([ramp.name, ramp.group, ramp.mask, ramp.zOffsetFlag, ramp.fieldMult], ['ramp', 101, 2, 0, 0.2]);
  assert.deepEqual([tube.name, tube.group, tube.mask, tube.zOffsetFlag, tube.fieldMult], ['s_ramp9', 105, 2, 1, 0.2]);
  assert.deepEqual(ramp.enter, { p0: [3.296382, 1.23247], p1: [1.556096, 0.591874], ballMask: 1, newMask: 2 });
  assert.deepEqual(ramp.enterUpper, { p0: [4.110733, -1.750702], p1: [4.616566, -0.80676], ballMask: 4, newMask: 2 });
  assert.deepEqual(ramp.exit, { p0: ramp.enter.p1, p1: ramp.enter.p0, ballMask: 2, newMask: 1 });
  assert.deepEqual(ramp.exitUpper, { p0: ramp.enterUpper.p1, p1: ramp.enterUpper.p0, ballMask: 2, newMask: 4 });
  assert.deepEqual(ramp.line1, { p0: [6.684728, -1.751842], p1: [6.11742, -0.918833], ballMask: 4, newMask: 4 });
  assert.equal(ramp.exitFar, null);
  // seam == edge of the owning plane (plane 17 V1-V2, plane 1 V2-V3)
  nearPt(ramp.enter.p0, ramp.planes[17].v[0], 1e-6); nearPt(ramp.enter.p1, ramp.planes[17].v[1], 1e-6);
  nearPt(ramp.enterUpper.p0, ramp.planes[1].v[1], 1e-6); nearPt(ramp.enterUpper.p1, ramp.planes[1].v[2], 1e-6);
  assert.deepEqual(tube.enter, { p0: [-5.392737, -1.017711], p1: [-6.404264, -1.032808], ballMask: 1, newMask: 2 });
  assert.deepEqual(tube.exit, { p0: tube.enter.p1, p1: tube.enter.p0, ballMask: 2, newMask: 1 });
  assert.deepEqual(tube.exitFar, { p0: [-3.751826, -10.333077], p1: [-3.045506, -10.781628], ballMask: 2, newMask: 1 });
  assert.equal(tube.enterUpper, null); assert.equal(tube.exitUpper, null); assert.equal(tube.line1, null);
  assert.equal(ramp.wallBallOffset, 0.3);
  // polygons: SPEC 3.5.2 verbatim (closing duplicate dropped), deck inside shell 103, ramp footprint area 4.246, deck floor area ~20.6
  const deck = dropClosing(pairs(sec('Flat DECK FLOOR polygon', 'Ramp footprint polygon').split('```')[1]));
  const foot = dropClosing(pairs(sec('Ramp footprint polygon', '**Visual height field**').split('```')[1]));
  assert.deepEqual(DECK_FLOOR_POLY, deck); assert.deepEqual(RAMP_FOOTPRINT_POLY, foot);
  near(Math.abs(shoelace(RAMP_FOOTPRINT_POLY)), 4.246, 0.02, 'footprint area');
  near(Math.abs(shoelace(DECK_FLOOR_POLY)), 20.621, 0.5, 'deck floor area');
  const shell = WALLS.find((w) => w.group === 103).pts;
  for (const p of DECK_FLOOR_POLY) assert.ok(pip(p, shell) || distToPoly(p, shell) < 0.02, 'deck vertex inside shell 103: ' + p);
  // the 18 ramp vertices are inside (or on) shell 103's outline margin
  for (const p of RAMP_FOOTPRINT_POLY) assert.ok(pip(p, shell) || distToPoly(p, shell) < 0.05, 'footprint vertex inside shell 103: ' + p);
});

// ---------------------------------------------------------------------------------------------------------------------
// constants, projection (SPEC 1.3 / Appendix D #1)
// ---------------------------------------------------------------------------------------------------------------------
rtest('projection checkpoints of SPEC Appendix D #1 and round trips', () => {
  nearPt(projectToTablePx(2.4888, 12.0631), [132.6, 384.3], 0.1, 'flipper-L pivot');
  nearPt(projectToTablePx(-7.0209, 10.0849), [319.5, 343.4], 0.1, 'plunger rest');
  nearPt(projectToTablePx(8, -14), [77.6, 19.6], 0.1, 'corner (8,-14)');
  nearPt(projectToTablePx(-8, -14), [288.4, 19.6], 0.1, 'corner (-8,-14)');
  nearPt(projectToTablePx(8, 15), [10.7, 451.5], 0.1, 'corner (8,15)');
  nearPt(projectToTablePx(-8, 15), [355.3, 451.5], 0.1, 'corner (-8,15)');
  for (const [x, y] of [[0, 0], [1.234, -5.67], [-7.5, 14], [7.9, -13.9], [-3.3, 9.9]]) {
    const [px, py] = projectToTablePx(x, y);
    nearPt(unprojectFloor(px, py), [x, y], 1e-9, `round trip ${x},${y}`);
  }
  nearPt(projectToTablePx(0, 0, 0), [183 + 0, 238 + (3.791398 * CAMERA.D) / 24.675402], 1e-9, 'origin');
  // the camera matrix is a pure pitch (SPEC 1.4): rows orthonormal, 24 degrees
  const [r1, r2] = [CAMERA.matrixRows[1], CAMERA.matrixRows[2]];
  near(Math.hypot(r1[1], r1[2]), 1, 1e-6); near(Math.hypot(r2[1], r2[2]), 1, 1e-6); near(Math.acos(-r1[1]) * 180 / Math.PI, 24, 0.01);
  near(2 * Math.atan(238 / Math.abs(CAMERA.D)) * 180 / Math.PI, CAMERA.fovDeg, 2e-3);
  assert.deepEqual(CAMERA.position, [0, 13.5, 21]); assert.deepEqual(CAMERA.principal, [183, 238]); assert.deepEqual(CAMERA.viewport, [365, 416]);
  near(CAMERA.D, -400.000702, 1e-9);
});

rtest('constants vs SPEC 1.x/4.1/5.12/6.x', () => {
  assert.deepEqual([TABLE.xMin, TABLE.xMax, TABLE.yMin, TABLE.yMax, TABLE.R], [-8, 8, -14, 15, 0.3]);
  assert.equal(TABLE.drainY, 14.437246); assert.equal(TABLE.visibleBottomY, 13.496);
  assert.deepEqual(PHYS_C.gravity, [3.916845e-6, 11.985638]);
  near(25 * Math.sin(0.5), PHYS_C.gravity[1], 1e-5);                      // SPEC 4.1: gy = 25 sin(0.5)
  assert.equal(PHYS_C.dt, 1 / 120); assert.equal(PHYS_C.maxSpeed, 60); assert.equal(PHYS_C.subStep, 0.15); assert.equal(PHYS_C.drag, 0.2);
  assert.deepEqual(PHYS_C.outlineKicker, { threshold: 5, boost: 15 });
  assert.deepEqual(PHYS_C.tableOutline, [[8, 15], [-8, 15], [-8, -14], [8, -14], [8, 15]]);
  assert.deepEqual(MASKS, { PLAYFIELD: 1, RAMP: 2, DECK: 4, SHELL103: 6 });
  assert.deepEqual(Z, { floor: 0, ball: 0.3, deck: 1.068, ballOnDeck: 1.368, tubeBall: -4.7, holeRelease: 0.325772 });
  assert.deepEqual(DEFAULT_KEYS, { flipperLeft: 'KeyZ', flipperRight: 'Slash', plunger: 'Space', nudgeLeft: 'KeyX', nudgeRight: 'Period', nudgeBottom: 'ArrowUp' });
  // PANEL local fields = original 600x416 rectangles (SPEC 6.2) minus the panel origin (386, 12)
  const o = { score1: [433, 197, 135, 22], player1: [403, 197, 15, 22], ball1: [553, 152, 15, 22], info: [405, 239, 165, 44], mission: [405, 303, 165, 88] };
  for (const [k, [x, y, w, h]] of Object.entries(o)) assert.deepEqual([PANEL.fields[k].x + PANEL.rect.x, PANEL.fields[k].y + PANEL.rect.y, PANEL.fields[k].w, PANEL.fields[k].h], [x, y, w, h], k);
  assert.deepEqual(PANEL.rect, { x: 386, y: 12, w: 203, h: 394 }); assert.deepEqual(PANEL.virtual, { w: 600, h: 416 });
  // SPEC 5.12 timer cheat-sheet
  assert.deepEqual([TIMING.bumperHit, TIMING.rebounderFlash, TIMING.popupRepop, TIMING.soloRearm, TIMING.rolloverRearm, TIMING.kickbackArm, TIMING.kickbackTick, TIMING.sinkHold,
    TIMING.kickoutDefaultHold, TIMING.rampHoleHold, TIMING.drainDelay, TIMING.feedDelay, TIMING.centerPostOn, TIMING.centerPostFlash, TIMING.extraBallOn, TIMING.upgradeWindow,
    TIMING.bumperDecay, TIMING.hyperspaceDecay, TIMING.medalDecay, TIMING.multiplierDecay, TIMING.reflexWindow, TIMING.tiltTimeout, TIMING.carefulText, TIMING.gameOverToEnd,
    TIMING.demoRestart, TIMING.skillLampFlash, TIMING.rankFlash, TIMING.lampFlash, TIMING.plungerTick],
  [0.1, 0.1, 0.25, 0.1, 0.1, 0.7, 0.1, 2, 1.5, 0.5, 1.82, 0.96, 55, 5, 55, 60, 60, 60, 30, 30, 5, 30, 2, 3, 5, 1, 5, 2, 0.025]);
  assert.equal(TIMING.nudgeUndo, 0.4); assert.equal(TIMING.nudgeGrace, -2); assert.equal(TIMING.plungerRelaunchTick, 0.025 / 4);
  assert.equal(TABLE.width, 16); assert.equal(TABLE.height, 29);
});

test('events: the 32 physics event types of ARCHITECTURE 5.3 + flipperHit (additive, presentation only)', () => {
  const expected = ['bumperHit', 'rebounderHit', 'popupHit', 'popupUp', 'soloHit', 'rolloverEnter', 'tripwire', 'oneway', 'onewaySide', 'rampLine1', 'rampEnter', 'rampExit',
    'rampHoleCaptured', 'rampHoleReleased', 'kickoutCapture', 'kickoutEject', 'sinkCapture', 'sinkEject', 'flagFrame', 'flagLoop', 'kickbackFired', 'kickbackTimerExpired',
    'blockerHit', 'drain', 'plungerFed', 'plungerPull', 'plungerRelease', 'stuckRelaunch', 'flipper', 'nudge', 'nudgeCount', 'demoTrigger', 'flipperHit'];
  assert.deepEqual([...EVENT_TYPES].sort(), [...expected].sort());
  assert.equal(new Set(EVENT_TYPES).size, 33);
  for (const [k, v] of Object.entries(EV)) assert.equal(k, v.replace(/([A-Z])/g, '_$1').toUpperCase(), `EV.${k} should be the SCREAMING_SNAKE of ${v}`);
});

rtest('materials and kickers (SPEC 2.2), heights (3.6)', () => {
  assert.deepEqual(DEFAULT_MATERIAL, { smoothness: 0.95, elasticity: 0.6 });
  assert.deepEqual(DEFAULT_KICKER, { threshold: 8.9999999e10, boost: 0 });
  assert.deepEqual(MATERIALS, { 95: { smoothness: 0.8, elasticity: 0.5 }, 96: { smoothness: 0.6, elasticity: 0.6 }, 97: { smoothness: 0.9, elasticity: 0.5 },
    98: { smoothness: 0.9, elasticity: 0.8 }, 354: { smoothness: 0.5, elasticity: 0.75 }, 503: { smoothness: 0.7, elasticity: 0.2 } });
  const k = KICKERS;
  assert.deepEqual([k[371].threshold, k[371].boost, k[404].threshold, k[404].boost, k[431].threshold, k[431].boost, k[441].threshold, k[441].boost, k[468].threshold, k[468].boost,
    k[504].boost, k[99].threshold], [2.5, 17, 2.5, 12, 3, 5, 3, 5, 1, 18, 55, 5]);
  assert.deepEqual([k[509].boost, k[511].boost, k[513].boost, k[509].throwAngle, k[509].throwMult], [45, 35, 35, 1.256637, 5]);
  assert.equal(HEIGHTS.deckSurface, Z.deck); assert.equal(HEIGHTS.ballOnDeck, Z.ballOnDeck); assert.equal(HEIGHTS.wall, 0.85); assert.equal(HEIGHTS.cabinetWall, 1.6);
  assert.deepEqual(HEIGHTS.attackBumper.radius, 0.77); assert.deepEqual(HEIGHTS.launchBumper.radius, 0.47);
});

// ---------------------------------------------------------------------------------------------------------------------
// lamps (SPEC 5.13, Appendix A)
// ---------------------------------------------------------------------------------------------------------------------
const GROUPS_SPEC = {
  goal_lights: Array.from({ length: 23 }, (_, i) => 'lite' + (300 + i)), middle_circle: Array.from({ length: 9 }, (_, i) => 'lite' + (154 + i)),
  outer_circle: [144, 52, 145, 51, 146, 50, 147, 49, 148, 48, 149, 47, 150, 46, 151, 45, 152, 44].map((n) => 'lite' + n),
  bmpr_inc_lights: ['lite8', 'lite9', 'lite10'], ramp_bmpr_inc_lights: ['lite171', 'lite170', 'lite169'], right_target_lights: ['lite61', 'lite60', 'lite59', 'lite58'],
  top_target_lights: ['lite66', 'lite65', 'lite64', 'lite63'], bumper_target_lights: ['lite13', 'lite12', 'lite11'], skill_shot_lights: ['lite67', 'lite68', 'lite69', 'lite131', 'lite132', 'lite133'],
  hyperspace_lights: ['lite21', 'lite22', 'lite23', 'lite24'], bpr_solotgt_lights: ['lite107', 'lite108', 'lite109'], lchute_tgt_lights: ['lite104', 'lite105', 'lite106'],
  top_circle_tgt_lights: ['lite70', 'lite71', 'lite72'], ramp_tgt_lights: ['lite101', 'lite102', 'lite103'], bsink_arrow_lights: ['lite2', 'lite3', 'lite4'],
  l_trek_lights: ['lite190', 'lite191', 'lite192', 'lite193', 'lite194'], r_trek_lights: ['lite185', 'lite186', 'lite187', 'lite188', 'lite189'], worm_hole_lights: ['lite5', 'lite6', 'lite7'],
};
rtest('lamps: 140 defs in LAMP_NAMES order, groups per Appendix A, fuel bargraph, flash timing, hooks', () => {
  assert.deepEqual(LAMPS.map((l) => l.name), [...LAMP_NAMES]);
  assert.equal(new Set(LAMP_NAMES).size, 140);
  for (const l of LAMPS) assert.equal(LAMP_BY_NAME[l.name], l);
  assert.equal(Object.keys(LAMP_BY_NAME).length, 140);
  assert.deepEqual(LAMP_GROUPS.map((g) => g.name).sort(), [...LAMP_GROUP_NAMES].sort());
  assert.equal(LAMP_GROUPS.length, 18);
  for (const g of LAMP_GROUPS) {
    assert.deepEqual(g.members, GROUPS_SPEC[g.name], g.name);
    g.members.forEach((m, i) => { assert.ok(LAMP_BY_NAME[m], m); assert.equal(LAMP_BY_NAME[m].group, g.name); assert.equal(LAMP_BY_NAME[m].groupIndex, i); });
    assert.equal(g.step, ['l_trek_lights', 'r_trek_lights', 'worm_hole_lights'].includes(g.name) ? 0.2 : 0.08, g.name + ' step');
  }
  assert.deepEqual(FUEL_BARGRAPH.members, ['literoll179', 'literoll180', 'literoll181', 'literoll182', 'literoll183', 'literoll184']);
  FUEL_BARGRAPH.members.forEach((m, i) => { assert.equal(LAMP_BY_NAME[m].group, 'fuel_bargraph'); assert.equal(LAMP_BY_NAME[m].groupIndex, i); });
  assert.equal(FUEL_BARGRAPH.name, FUEL_BARGRAPH_NAME); assert.equal(FUEL_BARGRAPH.step, 0.2);
  assert.deepEqual(FUEL_BARGRAPH.durations, [3, 14, 3, 12, 3, 10, 3, 8, 3, 6, 3, 4]);
  assert.equal(FUEL_BARGRAPH.durations.reduce((s, v) => s + v, 0), 72);
  assert.equal(ALL_LAMPS_GROUP_NAME, 'all');
  const grouped = new Set([...LAMP_GROUPS.flatMap((g) => g.members), ...FUEL_BARGRAPH.members]);
  const ungrouped = LAMPS.filter((l) => !grouped.has(l.name)).map((l) => l.name);
  const ungroupedSpec = [1, 16, 17, 18, 19, 20, 25, 26, 27, 28, 29, 30, 38, 39, 40, 54, 55, 56, 62, 77, 84, 85, 110, 130, 195, 196, 198, 199, 200].map((n) => 'lite' + n);
  assert.deepEqual(ungrouped.sort(), ungroupedSpec.sort());
  for (const l of LAMPS) if (!grouped.has(l.name)) { assert.equal(l.group, null); assert.equal(l.groupIndex, null); }
  assert.deepEqual([...LAMP_HOOK_NAMES], ['lite17', 'lite59', 'lite60', 'lite200']);
  assert.deepEqual(LAMP_FLASH_DEFAULT, { off: 0.1, on: 0.1 });
  assert.deepEqual(Object.keys(LAMP_FLASH_OVERRIDES).sort(), ['lite29', 'lite30', 'lite5', 'lite6', 'lite62', 'lite7', 'lite77', 'lite84', 'lite85']);
  for (const l of LAMPS) assert.deepEqual(l.flash, LAMP_FLASH_OVERRIDES[l.name] ?? LAMP_FLASH_DEFAULT, l.name + ' flash');
  assert.deepEqual(LAMP_FLASH_OVERRIDES.lite77, { off: 0.2, on: 0.8 }); assert.deepEqual(LAMP_FLASH_OVERRIDES.lite29, { off: 0.1, on: 0.4 });
});

rtest('lamps: positions equal SPEC Appendix A (with the documented height corrections), z, tiers, sprite px', () => {
  const rows = new Map(rowsOf(sec('| lamp | group[idx] | sprite px | world (x,y) | tier | note |', 'Compact JSON of the same positions'), /^\|\s*lite/).map((c) => [c[0], c]));
  assert.equal(rows.size, 139);
  const j = sec('Compact JSON of the same positions', 'Ring parametrisation');
  const compact = JSON.parse(j.slice(j.indexOf('```json') + 7, j.indexOf('```', j.indexOf('```json') + 7)));
  assert.equal(Object.keys(compact).length, 139);
  for (const n of Object.keys(compact)) assert.ok(LAMP_BY_NAME[n], 'Appendix A lamp missing in LAMPS: ' + n);
  const DECK = ['lite54', 'lite55', 'lite56', 'lite169', 'lite170', 'lite171', 'lite198', 'lite316', 'lite317'];
  const MEASURED_DECK = ['lite169', 'lite170', 'lite171', 'lite198'];
  const RAISED = { lite5: 0.5, lite6: 0.5, lite7: 0.5 };
  for (const l of LAMPS) {
    if (l.name === 'lite192') { assert.equal(l.pos, null); assert.deepEqual(l.sprite, [0, 0]); assert.deepEqual(l.size, [0, 0]); continue; }
    const [x0, y0] = compact[l.name]; const row = rows.get(l.name);
    const sz = /^(\d+)x(\d+)$/.exec(row[2]); assert.deepEqual(l.sprite, [Number(sz[1]), Number(sz[2])], l.name + ' sprite');
    assert.equal(l.tier, row[4].replace('*', ''), l.name + ' tier');
    const z = RAISED[l.name] ?? (DECK.includes(l.name) ? 1.078 : 0.01);
    assert.equal(l.z, z, l.name + ' z');
    if (RAISED[l.name] || MEASURED_DECK.includes(l.name)) { const k = (21 - z) / 21; nearPt(l.pos, [x0 * k, 13.5 + (y0 - 13.5) * k], 1e-4, l.name + ' raised pos'); }
    else nearPt(l.pos, [x0, y0], 1e-9, l.name + ' pos');
    assert.ok(l.pos[0] >= -8 && l.pos[0] <= 8 && l.pos[1] >= -14 && l.pos[1] <= 15, l.name + ' on the table');
  }
  assert.deepEqual(LAMPS.filter((l) => l.z >= 1).map((l) => l.name), DECK);
  for (const n of DECK) assert.ok(pip(LAMP_BY_NAME[n].pos, DECK_FLOOR_POLY), n + ' inside DECK_FLOOR_POLY');
  assert.deepEqual(LAMPS.filter((l) => l.z === 0.5).map((l) => l.name), ['lite5', 'lite6', 'lite7']);
  // SPEC overrides lamp_positions.json only for the moved lamps lite2/3/4/306/307
  const lp = new Map(JSON.parse(readText('research/lamp_positions.json')).lamps.map((l) => [l.name, l]));
  const differs = LAMPS.filter((l) => l.pos && !RAISED[l.name] && !MEASURED_DECK.includes(l.name) && (Math.abs(l.pos[0] - lp.get(l.name).wx) > 1e-9 || Math.abs(l.pos[1] - lp.get(l.name).wy) > 1e-9)).map((l) => l.name);
  assert.deepEqual(differs.sort(), ['lite2', 'lite3', 'lite306', 'lite307', 'lite4']);
  // Appendix A ring parametrisation: outer ring r 2.501 about (0.007, 6.039), middle ring r 1.656 about (0.022, 6.034)
  for (const n of GROUPS_SPEC.outer_circle) near(Math.hypot(LAMP_BY_NAME[n].pos[0] - 0.007, LAMP_BY_NAME[n].pos[1] - 6.039), 2.5, 0.15, n);
  for (const n of GROUPS_SPEC.middle_circle) near(Math.hypot(LAMP_BY_NAME[n].pos[0] - 0.022, LAMP_BY_NAME[n].pos[1] - 6.034), 1.66, 0.2, n);
  // lamps sit on the thing they mark: fuel lamps on their rollover, launch-lane dots one row above their rollover
  FUEL_BARGRAPH.members.forEach((m, i) => nearPt(LAMP_BY_NAME[m].pos, ROLLOVERS.find((r) => r.name === 'a_roll' + (179 + i)).center, 0.06, m));
  [['lite169', 'a_roll110'], ['lite170', 'a_roll111'], ['lite171', 'a_roll112']].forEach(([l, r]) => near(LAMP_BY_NAME[l].pos[0], ROLLOVERS.find((x) => x.name === r).center[0], 0.05, l + ' vs ' + r));
});

rtest('lamps: visuals (size, shape, colours, states)', () => {
  const SHAPES = ['dot', 'arrow', 'bar', 'ring', 'triangle', 'decal', 'cross', 'rect'];
  for (const l of LAMPS) {
    assert.ok(SHAPES.includes(l.shape), l.name + ' shape ' + l.shape);
    assert.equal(l.nStates, ['lite2', 'lite3', 'lite4'].includes(l.name) ? 3 : 1);
    assert.equal(l.colors.length, l.nStates);
    for (const c of l.colors) { assert.match(c.unlit, /^#[0-9a-f]{6}$/); assert.match(c.lit, /^#[0-9a-f]{6}$/); }
    assert.ok(Number.isFinite(l.rot) && Math.abs(l.rot) <= Math.PI + 1e-9, l.name + ' rot');
    assert.equal(typeof l.role, 'string'); assert.ok(l.role.length > 0, l.name + ' role');
    assert.ok(['A', 'B', 'C', 'D'].includes(l.tier));
    if (l.pos) {
      assert.ok(l.size[0] > 0 && l.size[1] > 0);
      if (l.shape !== 'decal') for (const s of l.size) assert.ok(s >= 0.3 - 1e-9 && s <= 1.3 + 1e-9, `${l.name} size ${l.size}`);
      assert.ok(l.sprite[0] > 0 && l.sprite[1] > 0);
    }
  }
  assert.deepEqual(LAMPS.filter((l) => l.shape === 'decal').map((l) => l.name), ['lite84', 'lite85']);
  assert.deepEqual(LAMP_BY_NAME.lite2.colors.map((c) => c.lit), ['#fdfd46', '#4cf05a', '#ff3b30']);   // onIdx 0 yellow, 1 green, 2 red (SPEC 5.9)
  assert.deepEqual(['lite144', 'lite154', 'literoll179'].map((n) => LAMP_BY_NAME[n].colors[0].unlit), ['#0c1c8a', '#ba4c0d', '#79780f']);
  assert.equal(LAMP_BY_NAME.literoll184.colors[0].lit, '#a9d5f2');
  // size follows the projection: a lamp of the same sprite is smaller near the player than at the top of the table
  near(LAMP_BY_NAME.lite1.size[0], (13 * (24.675402 - 0.406737 * 12.6)) / 400.000702, 2e-3, 'lite1 width');
});

// ---------------------------------------------------------------------------------------------------------------------
// sounds (SPEC 7.3 / 7.4 + the task sound policy)
// ---------------------------------------------------------------------------------------------------------------------
rtest('sound manifest: 41 files, sizes, SHA-1, timers = bytes/11000, equal to SPEC 7.4', () => {
  const keys = Object.keys(SOUND_FILES);
  assert.equal(keys.length, 41);
  assert.equal(keys.reduce((s, k) => s + SOUND_FILES[k].bytes, 0), 528396);
  const j = sec('(`SOUND*.WAV` names are UPPER-CASE', '### 7.5');
  const compact = JSON.parse(j.slice(j.indexOf('```json') + 7, j.indexOf('```', j.indexOf('```json') + 7)));
  assert.deepEqual(Object.keys(compact).sort(), [...keys].sort());
  for (const k of keys) {
    const f = SOUND_FILES[k];
    assert.match(f.sha1, /^[0-9a-f]{40}$/, k); assert.equal(f.sha1, compact[k].sha1, k); assert.equal(f.bytes, compact[k].bytes, k);
    near(f.timer, f.bytes / 11000, 1e-6, k + ' timer'); near(f.timer, compact[k].timer, 1e-6, k + ' timer vs SPEC');
    assert.equal(fileNameOf(k), k + '.WAV');
  }
  assert.deepEqual(MUSIC_FILE, { name: 'PINBALL.MID', bytes: 108607, sha1: '3dfc2b292d96f38ad4cd4d948d751ba48a45ddbd' });
  // the timers that drive gameplay (SPEC 7.4)
  const want = { SW7: 2.404, SW21: 0.836, SW40: 0.786, SW41: 0.942, SW36: 3.077, SW35: 1.773, SW38: 1.184, SW39: 2.571, NEW_GAME: 5.045 };
  for (const [key, secs] of Object.entries(want)) near(soundDuration(key), secs, 5e-4, key);
});

rtest('sound keys: 55 keys, 6 silent by design, every file used, equal to the SPEC 7.3 machine-readable map', () => {
  const keys = Object.keys(SOUND_KEYS);
  assert.equal(keys.length, 55);
  const silent = keys.filter((k) => SOUND_KEYS[k].file === null).sort();
  assert.deepEqual(silent, ['GAME_OVER', 'PLUNGER_PULL', 'SW37', 'SW44', 'SW52', 'SW59']);
  for (const k of silent) { assert.equal(soundDuration(k), -1); assert.ok(NEVER_FETCH.includes(SOUND_KEYS[k].missing + '.WAV'), k); }
  const used = new Set(keys.map((k) => SOUND_KEYS[k].file).filter(Boolean));
  for (const k of keys) { const f = SOUND_KEYS[k].file; if (f !== null) assert.ok(SOUND_FILES[f], `${k} -> ${f}`); }
  assert.deepEqual([...used].sort(), Object.keys(SOUND_FILES).sort(), 'every manifest file is used and no key points outside the manifest');
  assert.equal(soundDuration('NOPE'), -1);
  for (const n of NEVER_FETCH) assert.ok(!(n.replace(/\.WAV$/, '') in SOUND_FILES) && n !== MUSIC_FILE.name, n);
  assert.deepEqual([...NEVER_FETCH].sort(), ['PINBALL2.MID', 'SOUND2.WAV', 'SOUND37.WAV', 'SOUND44.WAV', 'SOUND52.WAV', 'SOUND59.WAV', 'SOUND62.WAV']);
  // SPEC 7.3 machine-readable map
  const m = sec('Machine-readable map:', '### 7.4');
  const map = JSON.parse(m.slice(m.indexOf('```json') + 7, m.indexOf('```', m.indexOf('```json') + 7)));
  const fileOf = (v) => v.replace(/\.wav$/, '').toUpperCase();
  for (const [tag, wav] of Object.entries(map.soundwave)) {
    const key = 'SW' + tag; assert.ok(SOUND_KEYS[key], key);
    const missing = map.missing_in_release.includes(wav);
    assert.equal(SOUND_KEYS[key].file, missing ? null : fileOf(wav), key);
  }
  for (const [key, wav] of Object.entries(map.component)) {
    assert.ok(SOUND_KEYS[key], key);
    const missing = map.missing_in_release.includes(wav);
    assert.equal(SOUND_KEYS[key].file, missing ? null : fileOf(wav), key);
  }
  assert.equal(Object.keys(map.soundwave).length + Object.keys(map.component).length, 55);
  assert.equal(map.music, 'pinball.mid');
});

test('sound event map, sources (local -> Internet Archive S1 -> S5, no GitHub/jsDelivr) and SILENT_SOUND', () => {
  for (const e of SOUND_EVENT_MAP) {
    assert.ok(EVENT_TYPES.includes(e.event), e.event); assert.ok(SOUND_KEYS[e.key], e.key);
    for (const [p, allowed] of Object.entries(e.match ?? {})) assert.ok(Array.isArray(allowed) && allowed.length > 0, `${e.event}.${p}`);
  }
  // script / rules-initiated sounds are NOT dispatched from events
  const mapped = new Set(SOUND_EVENT_MAP.map((e) => e.key));
  for (const k of ['NEW_GAME', 'TILT', 'GAME_OVER', 'BALL_FEED', 'BLOCKER_MOVE']) assert.ok(!mapped.has(k), k);
  for (const k of mapped) assert.ok(!k.startsWith('SW'), k);
  assert.deepEqual(SOUND_SOURCES.map((s) => s.id), ['local', 'S1', 'S5']);
  assert.equal(SOUND_SOURCES[2].music, false); assert.equal(SOUND_SOURCES[0].music, true); assert.equal(SOUND_SOURCES[1].music, true);
  assert.equal(SOUND_SOURCES[0].url('SOUND1.WAV'), './sounds/SOUND1.WAV'); assert.deepEqual(SOUND_SOURCES[0].caseVariants, ['upper', 'lower']);
  assert.equal(SOUND_SOURCES[1].url('SOUND49D.WAV'), 'https://archive.org/download/3d-pinball-space-cadet_202103/3D%20Pinball%20Space%20Cadet.zip/3D%20Pinball%20Space%20Cadet%2FSOUND49D.WAV');
  assert.equal(SOUND_SOURCES[2].url('SOUND1.WAV'), 'https://archive.org/download/pinball_202005/SOUND1.WAV');
  for (const s of SOUND_SOURCES) assert.ok(!/github|jsdelivr|githubusercontent/i.test(s.url('X.WAV')), s.id);
  assert.equal(SILENT_SOUND.play('BUMPER'), soundDuration('BUMPER')); assert.equal(SILENT_SOUND.play('SW59'), -1); assert.equal(SILENT_SOUND.play('???'), -1);
  assert.ok(Object.isFrozen(SILENT_SOUND));
});

// ---------------------------------------------------------------------------------------------------------------------
// scoring, text, missions
// ---------------------------------------------------------------------------------------------------------------------
rtest('scoring (SPEC 5.1/5.3)', () => {
  assert.deepEqual(SCORE.bumperAttack, [500, 1000, 1500, 2000]); assert.deepEqual(SCORE.bumperLaunch, [1500, 2500, 3500, 4500]);
  assert.deepEqual(SCORE.skillShot, [15000, 30000, 75000, 30000, 15000, 7500]);
  assert.deepEqual(SCORE.hyperspace, [10000, null, 20000, 50000, 150000]);
  assert.deepEqual([SCORE.reentryLane, SCORE.launchLane, SCORE.rebounder, SCORE.outlane, SCORE.returnLane, SCORE.returnLaneLit, SCORE.bonusLaneUnlit, SCORE.fuelRollover],
    [2000, 500, 500, 20000, 5000, 25000, 10000, 500]);
  assert.deepEqual([SCORE.flagFrame, SCORE.flagFrameUpgraded, SCORE.spaceWarp, SCORE.rampPlain, SCORE.reflexShotStart, SCORE.blackHole, SCORE.gravityWell], [500, 2500, 10000, 5000, 25000, 20000, 50000]);
  assert.deepEqual(SCORE.wormhole, { none: 2500, match: 5000, mismatch: 7500 });
  assert.deepEqual(SCORE.booster, { each: 500, setComplete: 5000, allLitExtra: 5000 });
  assert.deepEqual(SCORE.medal, { each: 1500, level1: 10000, level2: 50000 }); assert.deepEqual(SCORE.multiplier, { each: 500, setComplete: 1500 });
  assert.deepEqual([SCORE.fuelSpot, SCORE.missionSpot, SCORE.hazard, SCORE.wormholeTarget], [750, 1000, 750, 750]);
  assert.deepEqual(MULTIPLIERS, [1, 2, 3, 5, 10]);
  assert.deepEqual([POTS.bonusNewGame, POTS.bonusAfterBall, POTS.jackpotStart, POTS.cap, POTS.maxScore, POTS.e9], [10000, 25000, 20000, 5000000, 999999999, 1000000000]);
  for (let id = 2; id <= 18; id++) assert.equal(acceptScoreFor(id), id <= 5 ? 10000 : id <= 14 ? 20000 : 30000, 'accept ' + id);
});

rtest('text: every SPEC 5.11 string present, plain decimals, fmt()', () => {
  const sp = sec('**Info box strings (exact English):**', '### 5.12');
  const infoSpec = reword(/\*\*Info box strings \(exact English\):\*\*\s*(.+)/.exec(sp)[1]);
  const missionSpec = reword(/\*\*Mission box strings:\*\*\s*(.+)/.exec(sp)[1]);
  const split = (s) => s.replace(/\.\s*$/, '').split(' | ').map((x) => x.trim().replace(/\\n/g, '\n'));
  const expand = (item) => {
    if (/^Player 1\.\.4 Shoots Again$/.test(item)) return ['Player %d Shoots Again'];
    if (/^Demo\nPlayer 1\.\.4$/.test(item)) return ['Demo\nPlayer %d'];
    if (/^Player 1\.\.4$/.test(item)) return ['Player %d'];
    if (/^Score Multiplier/.test(item)) return ['Score Multiplier 2x', 'Score Multiplier 3x', 'Score Multiplier 5x', 'Score Multiplier 10x'];
    if (/^Gravity Well \(cheat only\)$/.test(item)) return ['Gravity Well'];
    if (/^Player N's Score/.test(item)) return ["Player %d's Score\n%ld"];
    if (/^High Score N/.test(item)) return ['High Score %d\n%ld'];
    return [item];
  };
  const flat = (o) => Object.values(o).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const infoHave = flat(INFO), missionHave = flat(MISSION_TEXT);
  const infoWant = split(infoSpec).flatMap(expand), missionWant = split(missionSpec).flatMap(expand);
  for (const s of infoWant) assert.ok(infoHave.includes(s), 'INFO misses ' + JSON.stringify(s));
  for (const s of infoHave) assert.ok(infoWant.includes(s), 'INFO has unexpected ' + JSON.stringify(s));
  for (const s of missionWant) assert.ok(missionHave.includes(s), 'MISSION_TEXT misses ' + JSON.stringify(s));
  for (const s of missionHave) assert.ok(missionWant.includes(s) || s === 'Maelstrom!', 'MISSION_TEXT has unexpected ' + JSON.stringify(s));
  for (const s of [...infoHave, ...missionHave]) { assert.ok(!/\d,\d{3}/.test(s) && !/\d\.\d{3}/.test(s), 'thousands separator in ' + s); assert.ok(!/\d{4,}/.test(s), s); }
  assert.equal(fmt('Skill Shot\n%ld', 75000), 'Skill Shot\n75000'); assert.equal(fmt(MISSION_TEXT.promotionTo, 'Ensign'), 'Promoted to Ensign');
  assert.equal(fmt(INFO.player, 3), 'Player 3'); assert.equal(fmt('%ld', 1234567.9), '1234567'); assert.equal(fmt('x %d of %d', 2, 3), 'x 2 of 3');
  assert.equal(fmt(MISSION_TEXT.launchRampToAccept, MISSION_NAMES[2]), 'Launch Ramp Starts Target Practice Mission');
  assert.deepEqual([...RANK_NAMES], ['Cadet', 'Ensign', 'Lieutenant', 'Captain', 'Lt Commander', 'Commander', 'Commodore', 'Admiral', 'Fleet Admiral']);
  assert.equal(INFO.fieldMultiplier.length, 4); assert.equal(typeof APP_TITLE, 'string');
});

rtest('missions: SPEC 5.7.3 table, states, selection table (5.7.2)', () => {
  const rows = rowsOf(sec('#### 5.7.3 Mission table', '#### 5.7.4'), /^\|\s*\d+\s*\|/);
  assert.equal(rows.length, 17);
  const first = (s) => Number(/[\d,]+/.exec(s)[0].replace(/,/g, ''));
  for (const row of rows) {
    const id = Number(row[0]); const m = MISSIONS[id];
    assert.ok(m, 'mission ' + id); assert.equal(m.id, id); assert.equal(m.name, row[1]); assert.equal(MISSION_NAMES[id], row[1]);
    assert.equal(m.accept, first(row[4]), `${m.name} accept`); assert.equal(m.accept, acceptScoreFor(id));
    assert.equal(m.reward, first(row[5]), `${m.name} reward`); assert.equal(m.rankPts, first(row[6]), `${m.name} rank pts`);
    const q = [...row[7].matchAll(/"([^"]+)"/g)].map((x) => reword(x[1]));
    assert.equal(MISSION_TEXT[m.doneText], q[0], `${m.name} completion text`);
    if (id === 17) assert.equal(MISSION_TEXT[m.doneTextAlt], q[1]); else assert.equal(m.doneTextAlt, null);
    assert.equal(m.doneBox, id === 18 ? 'info' : 'mission');
    assert.ok(m.doneText in MISSION_TEXT);
    assert.equal(m.states.length, m.stageCounters.length); assert.equal(m.states[0], id);
    assert.equal(m.counter, m.stageCounters.find((c) => c !== null) ?? null);
  }
  assert.deepEqual(Object.keys(MISSIONS).map(Number), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual([MISSIONS[10].states, MISSIONS[15].states, MISSIONS[16].states, MISSIONS[17].states, MISSIONS[18].states],
    [[10, 20], [15, 21], [16, 22, 23], [17, 24], [18, 25, 26, 27, 28, 29, 30, 31]]);
  assert.deepEqual([2, 3, 4, 5, 9, 11, 12, 13, 14].map((i) => MISSIONS[i].counter), [8, 3, 3, 9, 15, 1, 3, 15, 3]);
  assert.deepEqual([6, 7, 8, 16].map((i) => MISSIONS[i].counter), [null, null, null, null]);
  assert.deepEqual([MISSIONS[15].counter, MISSIONS[17].counter, MISSIONS[18].stageCounters.slice(0, 3)], [75, 25, [3, 3, 5]]);
  // every state id of MISSION_STATE is covered by exactly one mission (or is one of the global states 0, 1, 32)
  const covered = new Set(Object.values(MISSIONS).flatMap((m) => m.states));
  for (const [name, v] of Object.entries(MISSION_STATE)) assert.ok(covered.has(v) || [0, 1, 32].includes(v), name);
  assert.equal(covered.size + 3, Object.keys(MISSION_STATE).length);
  // selection table: rank groups and levels
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(rankGroupOf), [1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(missionForRank(1, 1), 3); assert.equal(missionForRank(1, 3), 2); assert.equal(missionForRank(2, 4), 16); assert.equal(missionForRank(8, 4), 18); assert.equal(missionForRank(9, 2), 16);
  for (const g of Object.values(MISSION_SELECT)) for (const id of g) assert.ok(MISSIONS[id], 'selectable mission ' + id);
  assert.equal(MISSION_STATE.GAME_OVER, 32);
});
