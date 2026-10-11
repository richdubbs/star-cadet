/**
 * tools/gen_data.mjs
 * OWNER: DATA
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 3 (dev-time generator, never imported by the app)
 * Usage (from the project root):   node tools/gen_data.mjs      (GEN_DATA_OUT=<dir> writes the four files there instead; used by the drift test)
 *   -> rewrites src/data/walls.js, src/data/components.js, src/data/ramps.js, src/data/lamps.js
 *   (src/data/missions.js, scoring.js, text.js, sounds.js, constants.js ... are hand-written from the SPEC text and are NOT touched.)
 *
 * Inputs (read-only): research/physics_data.json (pre-inflated edges, materials, kickers, ramp planes), research/layout_data.json
 * (6-decimal raw geometry), research/SPEC.md (tables of 2.x, 3.x, Appendix A and B), plus the seeded modules src/data/{names,heights,
 * materials,constants}.js. Output: plain static ES modules that are COMMITTED; the browser and the Node tests never read research/.
 *
 * The generator is a transformation + sanity pass (counts, orientation, SPEC cross-checks that would make a wrong parse obvious). The
 * independent verification lives in tests/data.test.mjs (it re-inflates the raw geometry with its own reference installer and compares
 * against the shipped edges and against physics_data.json).
 *
 * ASSUMPTIONS (gaps in the SPEC / ARCHITECTURE that were filled here, also repeated in the generated headers):
 *  - Lamp overlay `size` uses the TRUE local projection scale of SPEC 1.3: width = spritePx * z1 / |D|, depth = spritePx * z1^2 / (|D| * (21 - z)),
 *    because the vertical foreshortening differs from the horizontal scale by 21/z1 (0.69 at the top of the table, 1.13 at the bottom).
 *    Non-decal sizes are scaled uniformly (aspect kept) into [0.3, 1.3]; decals (lite84/85) are not clamped.
 *  - Deck lamps (lite54/55/56/169/170/171/198/316/317, z = 1.078): the MEASURED ones (tiers A/B/C: lite169/170/171/198) are Appendix-A
 *    positions inverse-projected onto z = 0, so they get the SPEC 8 raise formula like the wormhole rim lamps; the role-placed tier-D ones
 *    (lite54/55/56/316/317) are already world placements and keep their Appendix-A position.
 *  - DECK_FLOOR_POLY / RAMP_FOOTPRINT_POLY: the SPEC listings repeat the first vertex at the end; the closing duplicate is dropped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAMP_NAMES } from '../src/data/names.js';
import { HEIGHTS } from '../src/data/heights.js';
import { TIMING } from '../src/data/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(ROOT, 'research');
if (!fs.existsSync(path.join(RES, 'SPEC.md'))) {
  console.error('tools/gen_data.mjs needs the private research/ folder (not part of the public repo); the generated src/data modules are committed.');
  process.exit(1);
}
const OUT = process.env.GEN_DATA_OUT ? path.resolve(process.env.GEN_DATA_OUT) : path.join(ROOT, 'src', 'data');   // GEN_DATA_OUT = drift check in tests/data.test.mjs
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
const phys = readJson('physics_data.json');
const layout = readJson('layout_data.json');
const spec = fs.readFileSync(path.join(RES, 'SPEC.md'), 'utf8');

// ---------------------------------------------------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------------------------------------------------
function fail(msg) { throw new Error('gen_data: ' + msg); }
function check(cond, msg) { if (!cond) fail(msg); }
const r6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
const r4 = (v) => { const r = Math.round(v * 1e4) / 1e4; return r === 0 ? 0 : r; };
const r7 = (v) => { const r = Math.round(v * 1e7) / 1e7; return r === 0 ? 0 : r; };
const r3 = (v) => { const r = Math.round(v * 1e3) / 1e3; return r === 0 ? 0 : r; };
const pt = (p) => [r6(p[0]), r6(p[1])];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const shoelace = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const dropClosing = (pts) => {
  const f = pts[0], l = pts[pts.length - 1];
  return (pts.length > 1 && Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) ? pts.slice(0, -1) : pts;
};
const pip = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

// ---- code emitter ---------------------------------------------------------------------------------------------------
class Raw { constructor(code) { this.code = code; } }
const raw = (code) => new Raw(code);
const WIDTH = 132;
const quote = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const keyStr = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) || /^\d+$/.test(k) ? k : quote(k));
function inline(v) {
  if (v instanceof Raw) return v.code;
  if (v === null) return 'null';
  if (v === undefined) fail('undefined value in emitted data');
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('non-finite number'); return Object.is(v, -0) ? '0' : String(v); }
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return quote(v);
  if (Array.isArray(v)) return '[' + v.map(inline).join(', ') + ']';
  const es = Object.entries(v);
  if (es.length === 0) return '{}';
  return '{ ' + es.map(([k, x]) => keyStr(k) + ': ' + inline(x)).join(', ') + ' }';
}
function pretty(v, ind) {
  const s = inline(v);
  if (typeof v !== 'object' || v === null || v instanceof Raw || s.length + ind <= WIDTH) return s;
  const pad = ' '.repeat(ind + 2), end = ' '.repeat(ind);
  if (Array.isArray(v)) {
    const parts = v.map((x) => inline(x));
    if (v.every((x) => typeof x !== 'object' || x === null || Array.isArray(x)) && parts.every((p) => p.length <= 34)) {
      const lines = []; let cur = '';
      for (const p of parts) {
        if (cur && cur.length + p.length + 2 + ind + 2 > WIDTH) { lines.push(cur); cur = ''; }
        cur += (cur ? ', ' : '') + p;
      }
      if (cur) lines.push(cur);
      return '[\n' + lines.map((l) => pad + l + ',').join('\n') + '\n' + end + ']';
    }
    return '[\n' + v.map((x) => pad + pretty(x, ind + 2) + ',').join('\n') + '\n' + end + ']';
  }
  return '{\n' + Object.entries(v).map(([k, x]) => pad + keyStr(k) + ': ' + pretty(x, ind + 2) + ',').join('\n') + '\n' + end + '}';
}
function exportConst(name, value, { frozen = true, jsdoc = null, comment = null } = {}) {
  let out = '';
  if (comment) out += comment.split('\n').map((l) => '// ' + l).join('\n') + '\n';
  if (jsdoc) out += '/** ' + jsdoc + ' */\n';
  const body = pretty(value, 0);
  out += 'export const ' + name + ' = ' + (frozen ? 'deepFreeze(' + body + ')' : body) + ';\n';
  return out;
}
function writeModule(file, header, imports, body) {
  const text = header.trimEnd() + '\n' + imports.trimEnd() + '\n\n' + body.trimEnd() + '\n';
  fs.writeFileSync(path.join(OUT, file), text);
  console.log('wrote src/data/' + file + ' (' + text.length + ' bytes)');
}
const headerFor = (file, contract, extra) => `/**
 * src/data/${file}
 * OWNER: DATA
 * STATUS: IMPLEMENTED
 * GENERATED by tools/gen_data.mjs from research/{physics_data,layout_data}.json + research/SPEC.md. Do not edit by hand: edit the generator and re-run
 * \`node tools/gen_data.mjs\` (then \`node --test tests/data.test.mjs\`). The browser never reads research/.
 * CONTRACT: ${contract}
 * Frame: T-frame (+x = screen-LEFT, +y = toward the player, +z = up), table units, seconds, radians. Everything is deep-frozen.
${extra}
 */`;

// ---------------------------------------------------------------------------------------------------------------------
// raw data access
// ---------------------------------------------------------------------------------------------------------------------
const physById = new Map(phys.components.map((c) => [c.id, c]));
const physByName = new Map(phys.components.filter((c) => c.name).map((c) => [c.name, c]));
const layoutByGroup = new Map(layout.components.map((c) => [c.group, c]));
check(physById.size === 147 && layoutByGroup.size === 147, 'expected 147 components in physics_data and layout_data');

const P = (name) => physByName.get(name) ?? fail('no physics component ' + name);
const L = (idOrName) => {
  const id = typeof idOrName === 'number' ? idOrName : P(idOrName).id;
  return layoutByGroup.get(id) ?? fail('no layout component ' + idOrName);
};
const copyEdge = (e) => {
  const o = {};
  const keys = e.k === 'line' ? ['k', 'x0', 'y0', 'x1', 'y1', 'nx', 'ny', 'role', 'gate'] : ['k', 'cx', 'cy', 'r', 'role', 'gate'];
  for (const k of keys) if (e[k] !== undefined) o[k] = typeof e[k] === 'number' ? r6(e[k]) : e[k];
  return o;
};
const edgesOf = (c) => c.edges.map(copyEdge);
const ptsOf = (lc) => dropClosing(lc.points.map(pt));

const M = {
  default: raw('DEFAULT_MATERIAL'), m95: raw('MATERIALS[95]'), m96: raw('MATERIALS[96]'), m97: raw('MATERIALS[97]'), m98: raw('MATERIALS[98]'),
  flip: raw('MATERIALS[354]'), kick: raw('MATERIALS[503]'),
};
function materialFor(c) {
  const key = c.smoothness + '/' + c.elasticity;
  const map = { '0.8/0.5': M.m95, '0.9/0.5': M.m97, '0.6/0.6': M.m96, '0.9/0.8': M.m98, '0.5/0.75': M.flip, '0.7/0.2': M.kick, '0.95/0.6': M.default };
  return map[key] ?? fail('unmapped material ' + key + ' for ' + (c.name ?? c.id));
}

// ---------------------------------------------------------------------------------------------------------------------
// SPEC parsing (tables of section 3.2, Appendix A/B and the polygons of 3.5.2)
// ---------------------------------------------------------------------------------------------------------------------
function section(startMarker, endMarker) {
  const a = spec.indexOf(startMarker);
  check(a >= 0, 'SPEC marker not found: ' + startMarker);
  const b = endMarker ? spec.indexOf(endMarker, a + startMarker.length) : spec.length;
  check(b > a, 'SPEC end marker not found: ' + endMarker);
  return spec.slice(a, b);
}
const numPairs = (s) => [...s.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)].map((m) => [Number(m[1]), Number(m[2])]);

function parseWallTable() {
  const sec = section('### 3.2 Wall polygons', 'Raw vertices (closed;');
  const rows = new Map();
  for (const line of sec.split('\n')) {
    if (!/^\|\s*\d+/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 9) continue;
    const group = Number(/^\d+/.exec(cells[0])[0]);
    rows.set(group, { group, pts: Number(cells[1]), mat: cells[4], mask: Number(cells[5]), solid: cells[6], height: cells[7], role: cells.slice(8).join(' | ') });
  }
  check(rows.size === 45, 'SPEC 3.2 wall table: expected 45 rows, got ' + rows.size);
  return rows;
}
function topFromCell(cell, group) {
  if (/^(ramp\/deck|no mesh)/.test(cell)) return { top: null, endCap: null };
  const m = /(\d+(?:\.\d+)?)/.exec(cell);
  check(m, 'cannot parse height cell of wall ' + group + ': ' + cell);
  const endCap = /end caps\s+(\d+(?:\.\d+)?)/.exec(cell);
  return { top: Number(m[1]), endCap: endCap ? Number(endCap[1]) : null };
}
function parseWallVertices() {
  const sec = section('### B.1 Wall polygon vertices', '### B.2');
  const map = new Map();
  for (const line of sec.split('\n')) {
    const m = /^(\d+) m(\d+) mat([\d.]+)\/([\d.]+) (.*)$/.exec(line.trim());
    if (!m) continue;
    map.set(Number(m[1]), { mask: Number(m[2]), sm: Number(m[3]), el: Number(m[4]), pts: numPairs(m[5]) });
  }
  check(map.size === 45, 'SPEC B.1: expected 45 polygons, got ' + map.size);
  return map;
}
function parsePolyBlock(marker) {
  const a = spec.indexOf(marker);
  check(a >= 0, 'SPEC marker not found: ' + marker);
  const f = spec.indexOf('```', a);
  const e = spec.indexOf('```', f + 3);
  return numPairs(spec.slice(f + 3, e));
}
function parseLampTable() {
  const sec = section('| lamp | group[idx] | sprite px | world (x,y) | tier | note |', 'Compact JSON of the same positions');
  const rows = new Map();
  for (const line of sec.split('\n')) {
    const m = /^\|\s*(lite\w+)\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    const g = /^(\w+)\[(\d+)\]$/.exec(cells[1]);
    const sz = /^(\d+)x(\d+)$/.exec(cells[2]);
    const xy = numPairs(cells[3])[0];
    check(sz && xy, 'bad Appendix A row: ' + line);
    rows.set(cells[0], {
      name: cells[0], group: g ? g[1] : null, groupIndex: g ? Number(g[2]) : null, sprite: [Number(sz[1]), Number(sz[2])],
      pos: [xy[0] === 0 ? 0 : xy[0], xy[1] === 0 ? 0 : xy[1]], tier: cells[4].replace('*', ''), note: cells.slice(5).join(' | '),
    });
  }
  check(rows.size === 139, 'Appendix A: expected 139 lamp rows, got ' + rows.size);
  const j = spec.indexOf('```json', spec.indexOf('Compact JSON of the same positions'));
  const json = JSON.parse(spec.slice(j + 7, spec.indexOf('```', j + 7)));
  for (const [name, [x, y]] of Object.entries(json)) {
    const r = rows.get(name);
    check(r && Math.abs(r.pos[0] - x) < 1e-9 && Math.abs(r.pos[1] - y) < 1e-9, 'Appendix A table and compact JSON disagree for ' + name);
  }
  check(Object.keys(json).length === 139, 'Appendix A compact JSON: expected 139 entries');
  return rows;
}

// =====================================================================================================================
// walls.js
// =====================================================================================================================
function buildWalls() {
  const table = parseWallTable();
  const verts = parseWallVertices();
  const walls = [];
  for (const c of phys.components.filter((x) => x.type === 1000)) {
    const lc = layoutByGroup.get(c.id);
    const pts = ptsOf(lc);
    const row = table.get(c.id) ?? fail('wall ' + c.id + ' missing in SPEC 3.2');
    const vv0 = verts.get(c.id) ?? fail('wall ' + c.id + ' missing in SPEC B.1');
    const vv = { ...vv0, pts: dropClosing(vv0.pts) };   // the B.1 listing repeats the first vertex at the end
    check(pts.length === row.pts, `wall ${c.id}: ${pts.length} pts vs SPEC ${row.pts}`);
    check(vv.pts.length === pts.length, `wall ${c.id}: B.1 lists ${vv.pts.length} pts`);
    pts.forEach((p, i) => check(Math.abs(p[0] - vv.pts[i][0]) < 1.1e-4 && Math.abs(p[1] - vv.pts[i][1]) < 1.1e-4, `wall ${c.id} vertex ${i} differs from SPEC B.1`));
    check(c.collision_mask === row.mask && vv.mask === row.mask, `wall ${c.id}: mask mismatch`);
    const S = shoelace(pts);
    const solid = S > 0 ? 'island' : 'shell';
    check((solid === 'shell') === (c.id === 103 || c.id === 106), `wall ${c.id}: unexpected solidity (S=${S.toFixed(3)})`);
    check(row.solid.startsWith(solid === 'island' ? 'island' : 'SHELL'), `wall ${c.id}: SPEC solidity text mismatch`);
    const kicker = c.kicker ? { threshold: c.kicker['401'], boost: c.kicker['402'] } : null;
    const { top, endCap } = topFromCell(row.height, c.id);
    const isRebo = c.id >= 469 && c.id <= 472;
    walls.push({
      name: c.name ?? 'wall_' + c.id, group: c.id, pts, mask: c.collision_mask, material: materialFor(c),
      kicker: kicker ? (kicker.threshold === 1 && kicker.boost === 18 ? raw('KICKERS[468]') : fail('unexpected wall kicker')) : null,
      solid, top, endCapTop: endCap, lamp: isRebo ? (c.id === 469 ? 'lite84' : c.id === 470 ? 'lite85' : null) : null,
      role: row.role.replace(/`/g, ''), edges: edgesOf(c),
    });
  }
  check(walls.length === 45, 'expected 45 walls');
  return walls;
}
function buildPosts() {
  const posts = [];
  const sec = section('### 3.3 Posts (type 1010, circles)', '### 3.4');
  const roles = new Map();
  for (const line of sec.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length >= 7 && /^\d+$/.test(cells[0])) roles.set(Number(cells[0]), cells[cells.length - 1]);
  }
  for (const c of phys.components.filter((x) => x.type === 1010)) {
    const lc = layoutByGroup.get(c.id);
    const r = r6(lc.radius);
    const e = c.edges[0];
    check(c.edges.length === 1 && e.k === 'circle' && Math.abs(e.r - (r + 0.3)) < 1.5e-6, 'post edge mismatch ' + c.id);
    posts.push({
      name: 'post_' + c.id, group: c.id, c: pt(lc.points[0]), r, mask: c.collision_mask, material: materialFor(c),
      top: c.collision_mask === 4 ? HEIGHTS.deckPost : HEIGHTS.postCap, role: roles.get(c.id) ?? '', edges: edgesOf(c),
    });
  }
  check(posts.length === 19, 'expected 19 posts');
  return posts;
}
function genWalls() {
  const walls = buildWalls();
  const posts = buildPosts();
  const outline = {
    pts: [[8, 15], [-8, 15], [-8, -14], [8, -14]],
    material: raw('DEFAULT_MATERIAL'), kicker: raw('PHYS.outlineKicker'), mask: 1,
    // Listed order (8,15) (-8,15) (-8,-14) (8,-14) gives OUTWARD normals with n = (dy,-dx)/len; every line is emitted REVERSED (as
    // physics_ref_sim.py does) so (nx,ny) points INTO the table. Un-inflated.
    edges: [
      { k: 'line', x0: -8, y0: 15, x1: 8, y1: 15, nx: 0, ny: -1, role: 'outline' },
      { k: 'line', x0: -8, y0: -14, x1: -8, y1: 15, nx: 1, ny: 0, role: 'outline' },
      { k: 'line', x0: 8, y0: -14, x1: -8, y1: -14, nx: 0, ny: 1, role: 'outline' },
      { k: 'line', x0: 8, y0: 15, x1: 8, y1: -14, nx: -1, ny: 0, role: 'outline' },
    ],
  };
  const header = headerFor('walls.js', 'ARCHITECTURE.md 3.3; types WallDef, PostDef, PlainEdge',
    ` * WALLS: 45 polygons (groups 280-309, 329, 330, 102, 103, 106, 331-336 and the rebounders v_rebo1-4 = 469-472) in the DAT order of
 * physics_data.json, \`pts\` = DAT order WITHOUT the closing duplicate (6 decimals from layout_data.json, cross-checked against SPEC B.1).
 * solid 'island' (shoelace S > 0, ball outside) or 'shell' (S < 0: groups 103 and 106, ball inside). \`top\` = SPEC 3.2 visual height
 * (null for the shells); \`endCapTop\` 0.9 for the thin guides whose end caps are higher. \`edges\` = the ball-radius-inflated PlainEdges
 * of physics_data.json VERBATIM (PHYSICS reads only these; installWall(pts, 0.3) reproduces them).
 * POSTS: 19 circles (groups 310-328), edges = one circle r + 0.3.
 * TABLE_OUTLINE: the four UN-inflated backstop lines, oriented INWARD (reversed listed order).
 * ASSUMPTIONS: \`endCapTop\` (0.9 for the thin guides listed with "end caps 0.9" in SPEC 3.2, else null) and \`role\` (the SPEC 3.2 role text) are additive fields.`);
  const body = [
    exportConst('WALLS', walls, { jsdoc: '@type {ReadonlyArray<import(\'../types.js\').WallDef>} 45 walls, SPEC 3.2 / B.1 order' }),
    exportConst('POSTS', posts, { jsdoc: '@type {ReadonlyArray<import(\'../types.js\').PostDef>} 19 posts, SPEC 3.3' }),
    exportConst('TABLE_OUTLINE', outline, {
      jsdoc: 'Un-inflated, inward-facing table outline (SPEC 3.1, 4.9.15): material 0.95/0.6, kicker {threshold 5, boost 15}, mask 1.',
    }),
  ].join('\n');
  writeModule('walls.js', header,
    "import { deepFreeze } from './freeze.js';\nimport { DEFAULT_MATERIAL, MATERIALS, KICKERS } from './materials.js';\nimport { PHYS } from './constants.js';", body);
  return { walls, posts };
}

// =====================================================================================================================
// ramps.js
// =====================================================================================================================
function seam(p0, p1, ballMask, newMask) { return { p0: pt(p0), p1: pt(p1), ballMask, newMask }; }
const rev = (s, ballMask, newMask) => seam(s.p1, s.p0, ballMask, newMask);
function genRamps() {
  const rampRaw = phys.ramps.find((r) => r.name === 'ramp');
  const tubeRaw = phys.ramps.find((r) => r.name === 's_ramp9');
  const planeOf = (pl) => {
    const g1 = r6(pl.gravAngle1), g2 = r6(pl.gravAngle2);
    return {
      v: [pt(pl.v1), pt(pl.v2), pt(pl.v3)], offset: pl.zoff.map(r6), g1, g2,
      force: [r6(25 * Math.sin(g1) * Math.cos(g2)), r6(25 * Math.sin(g1) * Math.sin(g2))],
    };
  };
  // SNAPPED seams of SPEC 3.5.1 (the raw DAT attrs differ by up to 0.06) and SPEC 3.5.3
  const enter = seam([3.296382, 1.23247], [1.556096, 0.591874], 1, 2);
  const enterUpper = seam([4.110733, -1.750702], [4.616566, -0.80676], 4, 2);
  const ramp = {
    name: 'ramp', group: 101, mask: 2, planes: rampRaw.planes.map(planeOf), zOffsetFlag: 0, fieldMult: 0.2,
    enter, enterUpper, exit: rev(enter, 2, 1), exitUpper: rev(enterUpper, 2, 4), exitFar: null,
    line1: seam([6.684728, -1.751842], [6.11742, -0.918833], 4, 4), wallBallOffset: 0.3,
  };
  const tubeEnter = seam([-5.392737, -1.017711], [-6.404264, -1.032808], 1, 2);
  const tube = {
    name: 's_ramp9', group: 105, mask: 2, planes: tubeRaw.planes.map(planeOf), zOffsetFlag: 1, fieldMult: 0.2,
    enter: tubeEnter, enterUpper: null, exit: rev(tubeEnter, 2, 1), exitUpper: null,
    exitFar: seam([-3.751826, -10.333077], [-3.045506, -10.781628], 2, 1), line1: null, wallBallOffset: 0.3,
  };
  check(ramp.planes.length === 18 && tube.planes.length === 2, 'ramp plane counts');
  const deck = dropClosing(parsePolyBlock('Flat DECK FLOOR polygon'));
  const foot = dropClosing(parsePolyBlock('Ramp footprint polygon'));
  const header = headerFor('ramps.js', 'ARCHITECTURE.md 3.3; type RampDef; SPEC 3.5',
    ` * RAMPS.ramp: the launch ramp (grp 101): 18 triangular planes (surface z = a*x + b*y + c with offset [a,b,c]; ball centre z = surface + 0.3;
 *   force = 25*sin(g1)*(cos g2, sin g2) added to table gravity), SNAPPED seams (SPEC 3.5.1): lower mouth \`enter\` (mask 1 -> 2, takes plane 17),
 *   deck mouth \`enterUpper\` (4 -> 2, takes plane 1), their reversed exits (2 -> 1, 2 -> 4), and the Line 1 trigger. zOffsetFlag 0 (ball keeps z).
 * RAMPS.tube: the hidden tube s_ramp9 (grp 105): 2 planes at offset [0,0,-5], no force, mouth seam (1 -> 2), reversed exit (2 -> 1), far-end exit
 *   \`exitFar\` (2 -> 1, z restored to 0.3), zOffsetFlag 1.
 * NOTE (integration, from the PHYSICS hand-off): RAMPS.tube.exitFar and RAMPS.ramp.line1 keep the DAT point order of the source attributes. A seam / trigger line
 *   is one-sided in physics (it only fires for a ball moving against its normal n = (dy,-dx)/len), so src/physics/ramps.js REVERSES both lines (orientAgainst)
 *   so that they fire for the intended crossing direction. Consumers other than PHYSICS must not assume these two lines point the way the ball travels.
 * ASSUMPTIONS: DECK_FLOOR_POLY / RAMP_FOOTPRINT_POLY are the SPEC 3.5.2 polygons; the closing duplicate vertex of the SPEC listing is dropped (implicitly closed).`);
  const body = [
    exportConst('RAMPS', { ramp, tube }, { jsdoc: '@type {{ramp: import(\'../types.js\').RampDef, tube: import(\'../types.js\').RampDef}}' }),
    exportConst('DECK_FLOOR_POLY', deck, { jsdoc: '@type {ReadonlyArray<import(\'../types.js\').Pt>} flat deck floor polygon, z = 1.068 (SPEC 3.5.2)' }),
    exportConst('RAMP_FOOTPRINT_POLY', foot, { jsdoc: '@type {ReadonlyArray<import(\'../types.js\').Pt>} outline of the union of the 18 ramp triangles (SPEC 3.5.2)' }),
  ].join('\n');
  writeModule('ramps.js', header, "import { deepFreeze } from './freeze.js';", body);
  return { deck, foot, ramp, tube };
}

// =====================================================================================================================
// components.js
// =====================================================================================================================
function genComponents() {
  const out = {};
  // ---- flippers --------------------------------------------------------------------------------------------------
  out.FLIPPERS = phys.meta.flippers.map((f) => {
    const name = f.name.split(' ')[0];
    const comp = P(name);
    const a = comp.attrs;
    const o = a['800'][0], t1 = a['801'][0], t2 = a['802'][0];
    return {
      name, group: comp.id, side: name === 'a_flip1' ? 'left' : 'right', pivot: [r6(o[0]), r6(o[1])], pivotR: r6(o[2]),
      restTip: [r6(t1[0]), r6(t1[1])], tipR: r6(t1[2]), raisedTip: [r6(t2[0]), r6(t2[1])], angleMax: r6(f.angleMaxRad),
      extendSeconds: a['804'][0][0], retractSeconds: a['805'][0][0], collisionMult: a['803'][0][0], material: M.flip, mask: 1,
    };
  });
  check(out.FLIPPERS[0].side === 'left' && out.FLIPPERS[0].angleMax > 0 && out.FLIPPERS[1].angleMax < 0, 'flipper orientation');

  // ---- plunger ---------------------------------------------------------------------------------------------------
  { const c = P('plunger'); const lc = L('plunger'); const feed = c.attrs['601'][0];
    out.PLUNGER = {
      name: 'plunger', group: c.id, face: [pt(lc.points[0]), pt(lc.points[1])], feed: [r6(feed[0]), r6(feed[1])],
      material: { smoothness: 0.5, elasticity: 0.5 }, maxBoost: 100, tickSeconds: TIMING.plungerTick, feedDelay: TIMING.feedDelay, mask: 1, edges: edgesOf(c),
    }; }

  // ---- bumpers ---------------------------------------------------------------------------------------------------
  out.BUMPERS = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const name = 'a_bump' + n; const c = P(name); const lc = L(name); const attack = n <= 4;
    return {
      name, group: c.id, kind: attack ? 'attack' : 'launch', c: pt(lc.points[0]), r: Number(lc.radius.toFixed(4)), mask: c.collision_mask,
      material: M.default, kicker: raw(attack ? 'KICKERS[371]' : 'KICKERS[404]'), hitSeconds: c.attrs['407'][0][0], edges: edgesOf(c),
    };
  });
  check(out.BUMPERS[4].mask === 4 && out.BUMPERS[0].r === 0.35 && out.BUMPERS[4].r === 0.25, 'bumper masks/radii');

  // ---- pop-up targets --------------------------------------------------------------------------------------------
  const banks = ['booster', 'medal', 'multiplier'];
  out.POPUP_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
    const name = 'a_targ' + n; const c = P(name); const poly = ptsOf(L(name));
    return {
      name, group: c.id, poly, center: [r4(mean(poly.map((p) => p[0]))), r4(mean(poly.map((p) => p[1])))], bank: banks[Math.floor((n - 1) / 3)],
      index: (n - 1) % 3, kicker: raw('KICKERS[431]'), material: M.default, mask: c.collision_mask, repopSeconds: c.attrs['407'][0][0],
      top: HEIGHTS.dropTargetTop, edges: edgesOf(c),
    };
  });

  // ---- solo (spot) targets ---------------------------------------------------------------------------------------
  const soloKinds = [['fuel', 10, 12, 70], ['mission', 13, 15, 101], ['leftHazard', 16, 18, 104], ['rightHazard', 19, 21, 107], ['wormhole', 22, 22, 110]];
  out.SOLO_TARGETS = [];
  for (const [kind, a, b, lamp0] of soloKinds) {
    for (let n = a; n <= b; n++) {
      const name = 'a_targ' + n; const c = P(name); const poly = ptsOf(L(name));
      out.SOLO_TARGETS.push({
        name, group: c.id, poly, center: [r4(mean(poly.map((p) => p[0]))), r4(mean(poly.map((p) => p[1])))], bankKind: kind, index: n - a,
        lamp: 'lite' + (lamp0 + (n - a)), kicker: raw('KICKERS[441]'), material: M.default, mask: c.collision_mask, rearmSeconds: TIMING.soloRearm,
        top: HEIGHTS.spotTargetTops[name] ?? HEIGHTS.spotTargetTop, edges: edgesOf(c),
      });
    }
  }

  // ---- kickbacks / gates / blocker / drain ----------------------------------------------------------------------
  out.KICKBACKS = [1, 2].map((n) => {
    const name = 'a_kick' + n; const c = P(name); const lc = L(name);
    return {
      name, group: c.id, id: n, line: [pt(lc.points[0]), pt(lc.points[1])], gate: 'v_gate' + n, material: M.kick, kicker: raw('KICKERS[504]'),
      armSeconds: TIMING.kickbackArm, tickSeconds: TIMING.kickbackTick, mask: c.collision_mask, edges: edgesOf(c),
    };
  });
  out.GATES = [1, 2].map((n) => {
    const name = 'v_gate' + n; const c = P(name); const lc = L(name);
    return {
      name, group: c.id, id: n, line: [pt(lc.points[0]), pt(lc.points[1])], material: M.m95,
      lamps: n === 1 ? ['lite30', 'lite196'] : ['lite29', 'lite195'], mask: c.collision_mask, edges: edgesOf(c),
    };
  });
  { const c = P('v_bloc1'); const lc = L('v_bloc1');
    out.BLOCKER = { name: 'v_bloc1', group: c.id, c: pt(lc.points[0]), r: Number(lc.radius.toFixed(4)), material: M.m95, lamp: 'lite1', mask: c.collision_mask, edges: edgesOf(c) }; }
  { const c = P('drain'); const lc = L('drain');
    out.DRAIN = { name: 'drain', group: c.id, line: [pt(lc.points[0]), pt(lc.points[1])], delaySeconds: c.attrs['407'][0][0], material: M.default, mask: c.collision_mask, edges: edgesOf(c) }; }

  // ---- kickouts --------------------------------------------------------------------------------------------------
  const kRoles = ['gravityWell', 'hyperspace', 'blackHole'];
  out.KICKOUTS = [1, 2, 3].map((n) => {
    const name = 'a_kout' + n; const c = P(name); const lc = L(name); const k = c.kicker; const f = c.field;
    const factor = c.attrs['306'][0][0];
    const cap = c.edges.find((e) => e.role === 'capture');
    const captureRadius = r7(factor * f.radius);
    check(Math.abs(cap.r - captureRadius) < 2e-6, 'kickout capture radius ' + name);
    return {
      name, group: c.id, id: n, role: kRoles[n - 1], c: pt(lc.points[0]), fieldRadius: r6(f.radius), pull: f.pull, captureFactor: factor, captureRadius,
      startsActive: n !== 1, rearms: n !== 1, throwDir: k.dir.map((v) => v), boost: k['402'], throwMult: k['403'], angleMult: k['405'],
      heldZ: c.attrs['408'][0][2], defaultHold: n === 1 ? 2.403818 : TIMING.kickoutDefaultHold, material: M.default, mask: c.collision_mask, edges: edgesOf(c),
    };
  });

  // ---- sinks -----------------------------------------------------------------------------------------------------
  const sinkColors = { 1: 'red', 2: 'green', 3: 'yellow', 7: null };
  out.SINKS = [1, 2, 3, 7].map((n) => {
    const name = 'v_sink' + n; const c = P(name); const lc = L(name); const k = c.kicker; const re = c.attrs['601'][0];
    return {
      name, group: c.id, id: n, line: [pt(lc.points[0]), pt(lc.points[1])], reemit: [r6(re[0]), r6(re[1])], throwDir: [k.dir[0], k.dir[1]], boost: k['402'],
      throwMult: k['403'], holdSeconds: c.attrs['407'][0][0], color: sinkColors[n], material: M.default, mask: c.collision_mask, edges: edgesOf(c),
    };
  });

  // ---- ramp hole -------------------------------------------------------------------------------------------------
  { const c = P('ramp_hole'); const f = c.field; const a408 = c.attrs['408'][0];
    out.RAMP_HOLE = {
      name: 'ramp_hole', group: c.id, c: [r6(f.cx), r6(f.cy)], fieldRadius: r6(f.radius), pull: f.pull, captureFactor: c.attrs['306'][0][0],
      captureRadius: r7(c.attrs['306'][0][0] * f.radius), releaseZ: r6(a408[2]), releaseMask: c.attrs['1304'][0][0], holdSeconds: TIMING.rampHoleHold,
      material: M.default, mask: c.collision_mask, edges: edgesOf(c),
    }; }

  // ---- one-ways --------------------------------------------------------------------------------------------------
  const owNames = ['s_onewy1', 's_onewy4', 's_onewy7', 's_onewy8', 's_onewy9', 's_onewy10', 's_onewy11', 's_onewy12', 's_onewy13'];
  out.ONEWAYS = owNames.map((name) => {
    const c = P(name); const lc = L(name); const p0 = pt(lc.points[0]), p1 = pt(lc.points[1]);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
    return {
      name, group: c.id, p0, p1, normal: [r6(dy / len), r6(-dx / len)], mask: c.collision_mask, material: M.m98,
      visible: ['s_onewy1', 's_onewy9', 's_onewy10'].includes(name), scripted: ['s_onewy1', 's_onewy4', 's_onewy10'].includes(name),
      sideSound: ['s_onewy9', 's_onewy10'].includes(name), edges: edgesOf(c),
    };
  });

  // ---- tripwires -------------------------------------------------------------------------------------------------
  const tripLamps = ['lite68', 'lite69', 'lite131', 'lite132', 'lite133'];
  out.TRIPWIRES = [1, 2, 3, 4, 5].map((n) => {
    const name = 's_trip' + n; const c = P(name); const lc = L(name); const p0 = pt(lc.points[0]), p1 = pt(lc.points[1]);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
    return { name, group: c.id, p0, p1, normal: [r6(dy / len), r6(-dx / len)], lamp: tripLamps[n - 1], mask: c.collision_mask, edges: edgesOf(c) };
  });

  // ---- rollovers (17 plain + a_roll9) ----------------------------------------------------------------------------
  const rollLamp = {
    a_roll1: 'lite10', a_roll2: 'lite9', a_roll3: 'lite8', a_roll4: null, a_roll5: 'lite16', a_roll6: 'lite27', a_roll7: 'lite28', a_roll8: null,
    a_roll110: 'lite169', a_roll111: 'lite170', a_roll112: 'lite171', a_roll179: 'literoll179', a_roll180: 'literoll180', a_roll181: 'literoll181',
    a_roll182: 'literoll182', a_roll183: 'literoll183', a_roll184: 'literoll184', a_roll9: null,
  };
  const rollLamps = { a_roll4: ['lite30', 'lite196'], a_roll8: ['lite29', 'lite195'], a_roll9: ['lite27', 'lite28'] };
  const rollNames = [...[1, 2, 3, 4, 5, 6, 7, 8, 110, 111, 112, 179, 180, 181, 182, 183, 184].map((n) => 'a_roll' + n), 'a_roll9'];
  out.ROLLOVERS = rollNames.map((name) => {
    const c = P(name); const lc = L(name); const entry = ptsOf(lc);
    const exit = dropClosing(c.attrs['603'][0].slice(1, -1).reduce((acc, v, i, arr) => (i % 2 === 0 ? acc.concat([[r6(v), r6(arr[i + 1])]]) : acc), []));
    check(exit.length === entry.length, 'rollover exit polygon size ' + name);
    return {
      name, group: c.id, entry, exit, center: [r4(mean(entry.map((p) => p[0]))), r4(mean(entry.map((p) => p[1])))], mask: c.collision_mask,
      lamp: rollLamp[name], lamps: rollLamps[name] ?? (rollLamp[name] ? [rollLamp[name]] : []), light: name === 'a_roll9',
      spriteSeconds: name === 'a_roll9' ? c.attrs['407'][0][0] : 0, edges: edgesOf(c),
    };
  });

  // ---- flag spinners ---------------------------------------------------------------------------------------------
  out.FLAGS = [['a_flag1', 'lite19'], ['a_flag2', 'lite20']].map(([name, lamp]) => {
    const c = P(name); const lc = L(name); const a = c.attrs;
    return { name, group: c.id, p0: pt(lc.points[0]), p1: pt(lc.points[1]), lamp, maxSpeed: a['1200'][0][0], minSpeed: a['1201'][0][0], decay: a['1202'][0][0], mask: c.collision_mask, edges: edgesOf(c) };
  });

  // ---- demo triggers (SPEC 2.19) ---------------------------------------------------------------------------------
  { const c = P('demo'); const a = c.attrs;
    const polyOf = (id) => { const v = a[String(id)][0]; const k = v[0]; const ps = []; for (let i = 0; i < k; i++) ps.push([r6(v[1 + 2 * i]), r6(v[2 + 2 * i])]); return dropClosing(ps); };
    const defs = [[1400, 'line', 'leftDelayed'], [1401, 'triangle', 'leftNow'], [1402, 'line', 'rightDelayed'], [1403, 'triangle', 'rightNow'], [1404, 'line', 'plunger']];
    out.DEMO_TRIGGERS = defs.map(([id, shape, action]) => {
      const pts = polyOf(id);
      check(pts.length === (shape === 'line' ? 2 : 3), 'demo trigger ' + id + ' vertex count');
      return { id, shape, pts, action, offset: shape === 'line' ? 0.3 : 0 };
    }); }

  // ---- text ------------------------------------------------------------------------------------------------------
  const header = headerFor('components.js', 'ARCHITECTURE.md 3.3; types FlipperDef .. DemoTriggerDef; SPEC section 2',
    ` * Every non-wall component by DAT name: raw geometry (for RENDER/ART/RULES) AND the pre-inflated PlainEdges of physics_data.json VERBATIM
 * (\`edges\`; PHYSICS reads only these). \`material\` / \`kicker\` are resolved (see materials.js). Masks: SPEC 1.5 (a_bump5-7, ramp_hole,
 * a_roll110-112, s_onewy12 = 4, everything else 1).
 * ASSUMPTIONS / ADDITIVE fields beyond the typedefs: ROLLOVERS[i].lamps (all lamps of the SPEC 2.15 row, \`lamp\` is null where the lamp is a script matter),
 * DEMO_TRIGGERS[i].offset (SPEC 2.19: the three line triggers 1400/1402/1404 are built with the ball offset 0.3 in the original;
 * ARCHITECTURE 4.2 says 0 for demo triggers and wins), getComponent kinds 'ramp' (ramp, s_ramp9), 'demo' and 'rebounder' (v_rebo1-4 are WALLS entries but named components).
 * ROLLOVERS[i].exit is the attr-603 polygon of the DAT: the entry loop walked backwards but starting at the same first vertex (a cyclic shift of
 * entry.slice().reverse()); its vertex order matches the order of the shipped rolloverflag edges.
 * a_kout1.defaultHold = 2.403818 = SOUND7 timer (gravity well hold, SPEC 5.4.11).`);
  const parts = [];
  const docs = {
    FLIPPERS: '@type {ReadonlyArray<import(\'../types.js\').FlipperDef>} [a_flip1 (LEFT on screen, +x), a_flip2 (RIGHT)]',
    PLUNGER: '@type {import(\'../types.js\').PlungerDef}', BUMPERS: '@type {ReadonlyArray<import(\'../types.js\').BumperDef>} a_bump1-4 attack, 5-7 launch',
    POPUP_TARGETS: '@type {ReadonlyArray<import(\'../types.js\').PopupTargetDef>} a_targ1-9 (3 banks of 3)',
    SOLO_TARGETS: '@type {ReadonlyArray<import(\'../types.js\').SoloTargetDef>} a_targ10-22', KICKBACKS: '@type {ReadonlyArray<import(\'../types.js\').KickbackDef>}',
    GATES: '@type {ReadonlyArray<import(\'../types.js\').GateDef>}', BLOCKER: '@type {import(\'../types.js\').BlockerDef}', DRAIN: '@type {import(\'../types.js\').DrainDef}',
    KICKOUTS: '@type {ReadonlyArray<import(\'../types.js\').KickoutDef>} a_kout1 gravity well, a_kout2 hyperspace, a_kout3 black hole',
    SINKS: '@type {ReadonlyArray<import(\'../types.js\').SinkDef>} v_sink1 red, v_sink2 green, v_sink3 yellow, v_sink7 escape chute',
    RAMP_HOLE: '@type {import(\'../types.js\').HoleDef}', ONEWAYS: '@type {ReadonlyArray<import(\'../types.js\').OnewayDef>}',
    TRIPWIRES: '@type {ReadonlyArray<import(\'../types.js\').TripwireDef>}', ROLLOVERS: '@type {ReadonlyArray<import(\'../types.js\').RolloverDef>} 17 plain rollovers + a_roll9 (last)',
    FLAGS: '@type {ReadonlyArray<import(\'../types.js\').FlagDef>}', DEMO_TRIGGERS: '@type {ReadonlyArray<import(\'../types.js\').DemoTriggerDef>} ids 1400-1404',
  };
  for (const name of ['FLIPPERS', 'PLUNGER', 'BUMPERS', 'POPUP_TARGETS', 'SOLO_TARGETS', 'KICKBACKS', 'GATES', 'BLOCKER', 'DRAIN', 'KICKOUTS', 'SINKS', 'RAMP_HOLE',
    'ONEWAYS', 'TRIPWIRES', 'ROLLOVERS', 'FLAGS', 'DEMO_TRIGGERS']) {
    parts.push(exportConst(name, out[name], { jsdoc: docs[name] }));
  }
  parts.push(`/** Demo AI timers attr 407 = (T1, T2, U1, U2) seconds (SPEC 2.19 / 5.2.9). */
export const DEMO_TIMERS = deepFreeze({ t1: 0.2, t2: 0.1, u1: 0.4, u2: 0.2 });

const _INDEX = new Map();
for (const [kind, defs] of [
  ['flipper', FLIPPERS], ['plunger', [PLUNGER]], ['bumper', BUMPERS], ['popup', POPUP_TARGETS], ['solo', SOLO_TARGETS], ['kickback', KICKBACKS],
  ['gate', GATES], ['blocker', [BLOCKER]], ['drain', [DRAIN]], ['kickout', KICKOUTS], ['sink', SINKS], ['hole', [RAMP_HOLE]], ['oneway', ONEWAYS],
  ['tripwire', TRIPWIRES], ['rollover', ROLLOVERS], ['flag', FLAGS], ['ramp', [RAMPS.ramp, RAMPS.tube]],
  ['demo', [deepFreeze({ name: 'demo', group: 100, triggers: DEMO_TRIGGERS, timers: DEMO_TIMERS })]],
  ['rebounder', WALLS.filter((w) => w.name.startsWith('v_rebo'))],
]) for (const def of defs) _INDEX.set(def.name, Object.freeze({ kind, def }));

/**
 * Look a component up by DAT name across every list above (walls and posts are NOT included).
 * @param {string} name
 * @returns {{kind:string, def:object}|null}  kind = 'flipper'|'plunger'|'bumper'|'popup'|'solo'|'kickback'|'gate'|'blocker'|'drain'|'kickout'|'sink'|'hole'|'oneway'|'tripwire'|'rollover'|'flag'|'ramp'|'demo'|'rebounder'
 */
export function getComponent(name) {
  return _INDEX.get(name) ?? null;
}`);
  writeModule('components.js', header,
    "import { deepFreeze } from './freeze.js';\nimport { MATERIALS, KICKERS, DEFAULT_MATERIAL } from './materials.js';\nimport { RAMPS } from './ramps.js';\nimport { WALLS } from './walls.js';", parts.join('\n'));
  return out;
}

// =====================================================================================================================
// lamps.js
// =====================================================================================================================
const LAMP_GROUPS = [
  { name: 'worm_hole_lights', members: ['lite5', 'lite6', 'lite7'], step: 0.2 },
  { name: 'l_trek_lights', members: ['lite190', 'lite191', 'lite192', 'lite193', 'lite194'], step: 0.2 },
  { name: 'r_trek_lights', members: ['lite185', 'lite186', 'lite187', 'lite188', 'lite189'], step: 0.2 },
  { name: 'bsink_arrow_lights', members: ['lite2', 'lite3', 'lite4'], step: 0.08 },
  { name: 'hyperspace_lights', members: ['lite21', 'lite22', 'lite23', 'lite24'], step: 0.08 },
  { name: 'ramp_tgt_lights', members: ['lite101', 'lite102', 'lite103'], step: 0.08 },
  { name: 'goal_lights', members: Array.from({ length: 23 }, (_, i) => 'lite' + (300 + i)), step: 0.08 },
  { name: 'bpr_solotgt_lights', members: ['lite107', 'lite108', 'lite109'], step: 0.08 },
  { name: 'top_circle_tgt_lights', members: ['lite70', 'lite71', 'lite72'], step: 0.08 },
  { name: 'lchute_tgt_lights', members: ['lite104', 'lite105', 'lite106'], step: 0.08 },
  { name: 'right_target_lights', members: ['lite61', 'lite60', 'lite59', 'lite58'], step: 0.08 },
  { name: 'skill_shot_lights', members: ['lite67', 'lite68', 'lite69', 'lite131', 'lite132', 'lite133'], step: 0.08 },
  { name: 'top_target_lights', members: ['lite66', 'lite65', 'lite64', 'lite63'], step: 0.08 },
  { name: 'bumper_target_lights', members: ['lite13', 'lite12', 'lite11'], step: 0.08 },
  { name: 'bmpr_inc_lights', members: ['lite8', 'lite9', 'lite10'], step: 0.08 },
  { name: 'ramp_bmpr_inc_lights', members: ['lite171', 'lite170', 'lite169'], step: 0.08 },
  { name: 'middle_circle', members: Array.from({ length: 9 }, (_, i) => 'lite' + (154 + i)), step: 0.08 },
  { name: 'outer_circle', members: ['lite144', 'lite52', 'lite145', 'lite51', 'lite146', 'lite50', 'lite147', 'lite49', 'lite148', 'lite48', 'lite149', 'lite47', 'lite150', 'lite46', 'lite151', 'lite45', 'lite152', 'lite44'], step: 0.08 },
];
const FUEL_BARGRAPH = {
  name: 'fuel_bargraph', members: ['literoll179', 'literoll180', 'literoll181', 'literoll182', 'literoll183', 'literoll184'], step: 0.2,
  durations: [3, 14, 3, 12, 3, 10, 3, 8, 3, 6, 3, 4],
};
const LAMP_HOOK_NAMES = ['lite17', 'lite59', 'lite60', 'lite200'];
const LAMP_FLASH_DEFAULT = { off: 0.1, on: 0.1 };
const LAMP_FLASH_OVERRIDES = {
  lite5: { off: 0.1, on: 0.2 }, lite6: { off: 0.1, on: 0.2 }, lite7: { off: 0.1, on: 0.2 },
  lite29: { off: 0.1, on: 0.4 }, lite30: { off: 0.1, on: 0.4 }, lite62: { off: 0.2, on: 0.2 },
  lite77: { off: 0.2, on: 0.8 }, lite84: { off: 0.2, on: 0.8 }, lite85: { off: 0.2, on: 0.8 },
};

// ---- lamp visuals (DATA's decisions from SPEC 6.8 / Appendix A colour families / ui.md L6) -------------------------------
const COL = {
  yellow: ['#79780f', '#fdfd46'], olive: ['#57550a', '#fbfd41'], skill: ['#68690b', '#fdfd46'],
  ringBlue: ['#0c1c8a', '#a8c8ff'], ringOrange: ['#ba4c0d', '#fbfd41'], hyper: ['#070e64', '#8fc4ff'],
  trekBlue: ['#081579', '#a8d0ff'], trekOrange: ['#cf6a10', '#ff6a2a'], trekPurple: ['#9c069f', '#ff48f0'],
  replay: ['#5d0c0d', '#ff4a1c'], cross: ['#1c2ea0', '#ff5a2a'], rimRed: ['#591814', '#ff3b30'], rimGreen: ['#084106', '#3df05a'],
  rimYellow: ['#5c5c08', '#fff23a'], decal: ['#3a3a8c', '#e8f4ff'], dest: ['#a84435', '#ff5a3c'], tilt: ['#5a1010', '#ff3030'],
  redInsert: ['#b01011', '#ff7a2a'], amber: ['#8a4a10', '#ffa63a'], violet: ['#5a2a8a', '#c08aff'], gold: ['#8a6a10', '#ffe23a'],
  medal: ['#10208a', '#9fc0ff'], deckRed: ['#741111', '#ff5a2a'],
};
const FUEL_COLS = [['#79780f', '#f8fc48'], ['#79780f', '#fafb43'], ['#7a4a12', '#f4d136'], ['#5a1a70', '#cc80de'], ['#55556a', '#ffffff'], ['#3a5a78', '#a9d5f2']];
const ROLE_TEXT = {
  lite1: 'centre-post lamp', lite16: 'bonus lane lamp', lite17: 'extra ball lamp (left outlane)', lite18: 'extra ball lamp (right outlane)',
  lite19: 'flag-upgrade lamp (left flag)', lite20: 'flag-upgrade lamp (right flag)', lite25: 'hyperspace reflex-shot lamp',
  lite26: 'Time Warp backward lamp (hyperspace)', lite27: 'left return-lane / space-warp lamp', lite28: 'right return-lane / space-warp lamp',
  lite29: 'right outlane gate arrow', lite30: 'left outlane gate arrow', lite38: 'multiball arrow (unused)', lite39: 'multiball arrow (unused)',
  lite40: 'multiball arrow (unused)', lite54: 'launch-ramp reflex-shot lamp', lite55: 'Time Warp forward lamp (launch ramp)',
  lite56: 'mission-selected lamp (launch ramp)', lite58: 'Bonus Hold lamp', lite59: 'Bonus lamp', lite60: 'Jackpot lamp', lite61: 'Flags Upgraded lamp',
  lite62: 'gravity-well armed lamp', lite77: 'TILT lamp', lite84: 'left slingshot flash decal', lite85: 'right slingshot flash decal',
  lite306: 'right-hazard-bank arrow (Stray Comet)', lite307: 're-entry-lane arrow (Re-Entry Training / Alien Menace)',
  lite5: 'red wormhole rim lamp on the sink1 housing (raised)', lite6: 'green wormhole rim lamp on the sink2 housing (raised)',
  lite7: 'yellow wormhole rim lamp on the sink3 housing (raised)', lite110: 'wormhole-destination lamp (beside a_targ22)', lite130: 'Maelstrom grand-reward lamp (hyperspace)', lite195: 'right outlane flasher',
  lite196: 'left outlane flasher', lite198: 'mission-state lamp (left deck)', lite199: 'replay lamp (left of the left flipper)',
  lite200: 'shoot-again / ball-save lamp (right of the right flipper)', lite192: 'left trek arrow with no bitmap (never drawn)',
};
const GROUP_ROLE = {
  outer_circle: (i) => `rank progress lamp ${i + 1} of 18 (outer ring)`, middle_circle: (i) => `rank lamp ${i + 1} of 9 (middle ring)`,
  skill_shot_lights: (i) => `skill-shot bar ${i + 1} of 6`, hyperspace_lights: (i) => `hyperspace ladder bar ${i + 1} of 4`,
  fuel_bargraph: (i) => `fuel gauge bar ${i + 1} of 6 (on rollover a_roll${179 + i})`, top_target_lights: (i) => `field multiplier lamp ${i + 1} of 4`,
  bmpr_inc_lights: (i) => `re-entry lane lamp ${i + 1} of 3 (attack bumper upgrade)`, ramp_bmpr_inc_lights: (i) => `launch lane lamp ${i + 1} of 3 (launch bumper upgrade)`,
  bumper_target_lights: (i) => `medal commendation lamp ${i + 1} of 3`, ramp_tgt_lights: (i) => `mission spot target lamp ${i + 1} of 3`,
  lchute_tgt_lights: (i) => `left hazard bank lamp ${i + 1} of 3`, bpr_solotgt_lights: (i) => `right hazard bank lamp ${i + 1} of 3`,
  top_circle_tgt_lights: (i) => `fuel spot target lamp ${i + 1} of 3`, bsink_arrow_lights: (i) => `wormhole destination arrow ${i + 1} of 3 (sink ${[2, 3, 1][i]})`,
  l_trek_lights: (i) => `left orbit trek arrow ${i + 1} of 5`, r_trek_lights: (i) => `right orbit trek arrow ${i + 1} of 5`,
};
const DECK_LAMPS = ['lite54', 'lite55', 'lite56', 'lite169', 'lite170', 'lite171', 'lite198', 'lite316', 'lite317'];
const RAISED_LAMPS = { lite5: 0.5, lite6: 0.5, lite7: 0.5 };   // wormhole rim lamps (SPEC 3.7 step 8 / App. A)
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
const axisAngle = (dx, dy) => { let a = Math.atan2(dy, dx); if (a > Math.PI / 2) a -= Math.PI; if (a <= -Math.PI / 2) a += Math.PI; return a; };

function genLamps(deckPoly, comps) {
  const rows = parseLampTable();
  const groupOf = new Map(); // lamp -> [groupName, index]
  for (const g of [...LAMP_GROUPS, FUEL_BARGRAPH]) g.members.forEach((m, i) => groupOf.set(m, [g.name, i]));
  check(LAMP_NAMES.length === 140, 'LAMP_NAMES must have 140 entries');
  for (const [name, r] of rows) {
    if (r.group) { const g = groupOf.get(name); check(g && g[0] === r.group && g[1] === r.groupIndex, `Appendix A group of ${name} (${r.group}[${r.groupIndex}]) disagrees with LAMP_GROUPS`); }
    else check(!groupOf.has(name), `${name} is grouped in LAMP_GROUPS but not in Appendix A`);
  }
  // ---- positions and heights ----
  const info = new Map();
  for (const name of LAMP_NAMES) {
    const r = rows.get(name);
    if (!r) { check(name === 'lite192', 'unexpected lamp without a row: ' + name); info.set(name, { name, pos: null, z: 0.01, tier: 'D', sprite: [0, 0], note: '', group: 'l_trek_lights', groupIndex: 2 }); continue; }
    let z = 0.01, pos = r.pos.slice();
    if (RAISED_LAMPS[name] || (DECK_LAMPS.includes(name) && r.tier !== 'D')) {
      z = RAISED_LAMPS[name] ?? 1.078;
      const k = (21 - z) / 21;
      pos = [r.pos[0] * k, 13.5 + (r.pos[1] - 13.5) * k];
    } else if (DECK_LAMPS.includes(name)) z = 1.078;
    pos = [r4(pos[0]), r4(pos[1])];
    if (DECK_LAMPS.includes(name)) check(pip(pos, deckPoly), `deck lamp ${name} at ${pos} is outside DECK_FLOOR_POLY`);
    info.set(name, { name, pos, z, tier: r.tier, sprite: r.sprite, note: r.note, group: r.group, groupIndex: r.groupIndex });
  }
  const posOf = (n) => info.get(n).pos;
  const comp = (n) => { const all = [...comps.ONEWAYS, ...comps.TRIPWIRES, ...comps.ROLLOVERS, ...comps.SINKS, ...comps.KICKOUTS, ...comps.FLAGS]; return all.find((d) => d.name === n) ?? fail('no component ' + n); };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const toward = (n, t) => r4(Math.atan2(t[1] - posOf(n)[1], t[0] - posOf(n)[0]));

  // ---- shape / rot / colours ----
  const goalTarget = {
    lite301: [7.0, 8.0], lite302: [4.75, 8.0], lite303: [-4.2, 1.67], lite304: [-3.27, -9.49], lite305: [7.007, -4.739], lite306: [-3.55, -6.5], lite307: [0, -9.5],
    lite308: [1.251, -5.96], lite309: [0.4, -2.52], lite310: [5.053, -7.195], lite311: [-1.378, -6.618], lite312: [-4.648, -2.485], lite313: [5.8, -4.6],
    lite314: [3.932, -0.271], lite315: [2.53, -8.4], lite316: [6.3, 2.1], lite317: [6.4, -1.33], lite318: [6.84, -3.41], lite319: [4.6, 3.9],
    lite320: [-5.85, 8.0], lite321: [-4.75, 8.0],
  };
  const arrowTarget = { lite2: mid(...comp('v_sink2').line), lite3: mid(...comp('v_sink3').line), lite4: mid(...comp('v_sink1').line) };
  const trip = (n) => comp('s_trip' + n);
  const skillLine = { lite67: [comp('s_onewy1').p0, comp('s_onewy1').p1], lite68: [trip(1).p0, trip(1).p1], lite69: [trip(2).p0, trip(2).p1], lite131: [trip(3).p0, trip(3).p1], lite132: [trip(4).p0, trip(4).p1], lite133: [trip(5).p0, trip(5).p1] };
  const trekDir = (g, i) => { // arrow tip along the chase direction (next positioned member)
    const members = LAMP_GROUPS.find((x) => x.name === g).members.filter((m) => posOf(m));
    const idx = members.indexOf(LAMP_GROUPS.find((x) => x.name === g).members[i]);
    const a = members[idx], b = idx < members.length - 1 ? members[idx + 1] : null;
    if (b) return r4(Math.atan2(posOf(b)[1] - posOf(a)[1], posOf(b)[0] - posOf(a)[0]));
    const p = members[idx - 1];
    return r4(Math.atan2(posOf(a)[1] - posOf(p)[1], posOf(a)[0] - posOf(p)[0]));
  };
  const hyper = LAMP_GROUPS.find((x) => x.name === 'hyperspace_lights').members;
  const hyperRot = (i) => { const a = posOf(hyper[Math.max(0, i - 1)]), b = posOf(hyper[Math.min(3, i + 1)]); const tx = b[0] - a[0], ty = b[1] - a[1]; return r4(axisAngle(-ty, tx)); };
  const fuelRot = (i) => { const e = comps.ROLLOVERS.find((d) => d.name === 'a_roll' + (179 + i)).entry; let best = 0, bl = 0;
    for (let k = 0; k < e.length; k++) { const a = e[k], b = e[(k + 1) % e.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; best = axisAngle(b[0] - a[0], b[1] - a[1]); } } return r4(best); };

  function visual(name) {
    const gi = groupOf.get(name); const g = gi ? gi[0] : null; const i = gi ? gi[1] : 0;
    const one = (shape, rot, c) => ({ shape, rot, colors: [{ unlit: c[0], lit: c[1] }] });
    if (name === 'lite192') return one('arrow', 0, COL.trekPurple);   // no bitmap, never drawn
    if (g === 'outer_circle') return one('ring', 0, COL.ringBlue);
    if (g === 'middle_circle') return one('ring', 0, COL.ringOrange);
    if (g === 'fuel_bargraph') return one('bar', fuelRot(i), FUEL_COLS[i]);
    if (g === 'skill_shot_lights') { const [a, b] = skillLine[name]; return one('bar', r4(axisAngle(b[0] - a[0], b[1] - a[1])), COL.skill); }
    if (g === 'hyperspace_lights') return one('bar', hyperRot(i), COL.hyper);
    if (g === 'bsink_arrow_lights') {
      const c = { unlit: '#57550a' };
      return { shape: 'arrow', rot: toward(name, arrowTarget[name]), colors: [{ ...c, lit: '#fdfd46' }, { ...c, lit: '#4cf05a' }, { ...c, lit: '#ff3b30' }] };   // onIdx 0 yellow, 1 green, 2 red
    }
    if (g === 'worm_hole_lights') return one('ring', 0, i === 0 ? COL.rimRed : i === 1 ? COL.rimGreen : COL.rimYellow);
    if (g === 'l_trek_lights') return one('arrow', trekDir(g, i), [COL.trekBlue, COL.trekOrange, COL.trekPurple, COL.trekOrange, COL.trekBlue][i]);
    if (g === 'r_trek_lights') return one('arrow', trekDir(g, i), COL.trekBlue);
    if (g === 'goal_lights') {
      if (name === 'lite300' || name === 'lite322') return one('dot', 0, COL.olive);
      return one('arrow', toward(name, goalTarget[name]), COL.olive);
    }
    if (g === 'bumper_target_lights') return one('dot', 0, COL.medal);
    switch (name) {
      case 'lite29': case 'lite30': return one('triangle', r4(Math.PI / 2), COL.yellow);
      case 'lite38': case 'lite39': case 'lite40': return one('triangle', Math.PI, COL.yellow);
      case 'lite84': case 'lite85': return one('decal', 0, COL.decal);
      case 'lite62': return one('cross', 0, COL.cross);
      case 'lite77': return one('rect', 0, COL.tilt);
      case 'lite110': return one('dot', 0, COL.dest);
      case 'lite199': case 'lite200': return one('dot', 0, COL.replay);
      case 'lite54': return one('dot', 0, COL.redInsert);
      case 'lite55': return one('dot', 0, COL.amber);
      case 'lite56': return one('dot', 0, COL.gold);
      case 'lite198': return one('dot', 0, COL.deckRed);
      case 'lite25': return one('dot', 0, COL.amber);
      case 'lite26': return one('dot', 0, COL.violet);
      case 'lite130': return one('dot', 0, COL.gold);
      case 'lite195': case 'lite196': return one('rect', 0, COL.amber);
      default: return one('dot', 0, COL.yellow);
    }
  }
  function sizeOf(i, shape) {
    if (!i.pos) return [0, 0];
    const z1 = -0.406737 * i.pos[1] - 0.913545 * i.z + 24.675402;
    let w = (i.sprite[0] * z1) / 400.000702;
    let h = (i.sprite[1] * z1 * z1) / (400.000702 * (21 - i.z));
    if (shape !== 'decal') {
      const mx = Math.max(w, h);
      if (mx > 1.3) { const s = 1.3 / mx; w *= s; h *= s; }
      const mn = Math.min(w, h);
      if (mn < 0.3) { const s = 0.3 / mn; w *= s; h *= s; if (Math.max(w, h) > 1.3) { const t = 1.3 / Math.max(w, h); w *= t; h *= t; } }
    }
    return [r3(w), r3(h)];
  }
  const roleOf = (name, i) => {
    if (ROLE_TEXT[name]) return ROLE_TEXT[name];
    const g = groupOf.get(name);
    if (g && GROUP_ROLE[g[0]]) return GROUP_ROLE[g[0]](g[1]);
    return i.note.split(';')[0].replace(/^design choice:\s*/, '').replace(/ \((?:ui\.md|[^)]*ESTIMATED[^)]*|art centre[^)]*)\)/g, '').trim();
  };
  const lamps = LAMP_NAMES.map((name) => {
    const i = info.get(name); const v = visual(name);
    const nStates = ['lite2', 'lite3', 'lite4'].includes(name) ? 3 : 1;
    check(v.colors.length === nStates, 'colour count of ' + name);
    return {
      name, pos: i.pos, z: i.z, tier: i.tier, sprite: i.sprite, size: sizeOf(i, v.shape), group: i.group ?? null, groupIndex: i.groupIndex ?? null,
      shape: v.shape, rot: v.rot, colors: v.colors, flash: raw(LAMP_FLASH_OVERRIDES[name] ? 'LAMP_FLASH_OVERRIDES.' + name : 'LAMP_FLASH_DEFAULT'),
      nStates, role: roleOf(name, i),
    };
  });
  const deckResult = lamps.filter((l) => l.z >= 1).map((l) => l.name);
  check(JSON.stringify(deckResult) === JSON.stringify(['lite54', 'lite55', 'lite56', 'lite169', 'lite170', 'lite171', 'lite198', 'lite316', 'lite317']), 'deck lamp list changed: ' + deckResult);
  const underDeck = lamps.filter((l) => l.pos && l.z < 1 && pip(l.pos, deckPoly)).map((l) => l.name);

  const header = headerFor('lamps.js', 'ARCHITECTURE.md 3.6; types LampDef, LampGroupDef, BargraphDef; SPEC 5.13, 5.5, Appendix A',
    ` * LAMPS: all 140 TLights in LAMP_NAMES order. pos/sprite/tier/group = SPEC Appendix A (the spec overrides lamp_positions.json: lite2/3/4/306/307 moved).
 * ASSUMPTIONS: \`pos\` is where the overlay sits AT HEIGHT \`z\`: floor lamps z 0.01 (Appendix A positions as-is); lite5/6/7 (wormhole rims) z 0.5 and the measured deck
 * lamps lite169/170/171/198 z 1.078 are corrected with the SPEC 8 raise formula x' = x0*(21-z)/21, y' = 13.5 + (y0-13.5)*(21-z)/21 (their Appendix-A
 * numbers are inverse projections onto z = 0); the role-placed tier-D deck lamps lite54/55/56/316/317 (z 1.078) keep their Appendix-A world position.
 * Deck lamps (z >= 1, exactly): ${deckResult.join(' ')}. Floor lamps that happen to lie under the deck polygon (the fuel channel): ${underDeck.join(' ')} (z stays 0.01).
 * lite192 has no bitmap: pos null, sprite/size [0, 0] (never drawn).
 * size = overlay quad (width along T-x, depth along T-y) from the sprite px with the TRUE local projection scale of SPEC 1.3 (width = w*z1/|D|, depth = h*z1^2/(|D|*(21-z)));
 * scaled uniformly into [0.3, 1.3] (decals lite84/85 are not clamped). shape/rot/colors = DATA's visual decisions [X] from SPEC 6.8 and the Appendix A colour families:
 * rot is the direction the tip of an arrow/triangle points (atan2(dy, dx) in the T-frame) or the long-axis angle of a bar, radians; colors[i] = {unlit, lit} per ON image
 * (lite2/3/4: onIdx 0 yellow, 1 green, 2 red). flash = LAMP_FLASH_OVERRIDES[name] ?? LAMP_FLASH_DEFAULT (SPEC 5.13.1).`);
  const body = [
    exportConst('LAMP_GROUPS', LAMP_GROUPS, { jsdoc: 'The 18 TLightGroups with their member order (SPEC Appendix A). step = default animation period (attr 903).' }),
    exportConst('FUEL_BARGRAPH', FUEL_BARGRAPH, { jsdoc: 'The fuel gauge (TLightBargraph). durations[level] = seconds spent at level 0..11 (SPEC 5.5); they sum to 72.' }),
    exportConst('LAMP_HOOK_NAMES', LAMP_HOOK_NAMES, { jsdoc: 'Lamps that raise a ControlTimerExpired hook to the rules (SPEC 5.13.1).' }),
    exportConst('LAMP_FLASH_DEFAULT', LAMP_FLASH_DEFAULT, { jsdoc: 'Default lamp flash phases in seconds: off = dark phase (attr 900), on = lit phase (attr 901).' }),
    exportConst('LAMP_FLASH_OVERRIDES', LAMP_FLASH_OVERRIDES, { jsdoc: 'The 9 lamps whose flash phases differ from LAMP_FLASH_DEFAULT (SPEC 5.13.1).' }),
    exportConst('LAMPS', lamps, { jsdoc: '@type {ReadonlyArray<import(\'../types.js\').LampDef>} 140 lamps, order = LAMP_NAMES' }),
    `/** @type {Readonly<Record<string, import('../types.js').LampDef>>} */
export const LAMP_BY_NAME = deepFreeze(Object.fromEntries(LAMPS.map((l) => [l.name, l])));`,
  ].join('\n');
  writeModule('lamps.js', header, "import { deepFreeze } from './freeze.js';", body);
  return lamps;
}

// =====================================================================================================================
// main
// =====================================================================================================================
const w = genWalls();
const r = genRamps();
const c = genComponents();
const l = genLamps(r.deck, c);
console.log(`ok: ${w.walls.length} walls, ${w.posts.length} posts, ${r.ramp.planes.length}+${r.tube.planes.length} ramp planes, ${l.length} lamps`);
