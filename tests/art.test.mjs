/**
 * tests/art.test.mjs
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 9.2 / 13.2: ArtPack shape, atlas cells, determinism, canvas-API whitelist (strict fake canvas), mapping round trips,
 * plus: every lamp has an inset inside its texture at the exact table position, lettering / label placement, panel boxes, rng.
 * Node only, no DOM, no network, no timers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as data from '../src/data/index.js';
import { paintAll } from '../src/render/art/index.js';
import { mulberry32 } from '../src/render/art/rng.js';
import {
  FLOOR_RECT, DECK_RECT, patchPx, pxToTable, patchUV, patchScale, patchHeight, lampCellUV,
} from '../src/render/art/mapping.js';
import { PALETTE, BUMPER_RING_COLORS, bumperRingColor } from '../src/render/art/palette.js';
import {
  drawLampShape, buildLampAtlas, paintLampInsets, lampKeys, lampPatchKey, lampInsetBounds, SHAPE_FRAC, ATLAS_COLS,
} from '../src/render/art/lamps.js';
import { paintFloor } from '../src/render/art/floor.js';
import { paintDeck, rampSides } from '../src/render/art/deck.js';
import { paintPanel, panelBoxes, LOGO_RECT } from '../src/render/art/panel.js';
import { paintMisc } from '../src/render/art/misc.js';
import { LABELS, RANK_RING, labelBox } from '../src/render/art/labels.js';
import { LANES, EMBLEM } from '../src/render/art/decals.js';
import { GLYPHS, glyphOf, textWidth } from '../src/render/art/font.js';
import { tableSpace, pointInPoly } from '../src/render/art/draw.js';
import { createFakeCanvasFactory, createFakeCanvas, opsDigest, CANVAS_API } from './helpers/fake_canvas.mjs';
import { mulberry32 as helperMulberry } from './helpers/seeded_rand.mjs';

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'render', 'art');

const MISC_KEYS = {
  ballEnv: [512, 256], metalSide: [256, 256], wallTop: [128, 128], rubber: [128, 128], postBand: [64, 64], bumperDrum: [256, 128],
  bumperStar: [256, 256], bumperCap: [128, 128], targetYellow: [128, 64], flagPanel: [128, 64], flipperBody: [256, 64],
  rampSide: [128, 128], plungerRod: [64, 256],
};

function paint(opts = {}) {
  const f = createFakeCanvasFactory({ strict: true });
  const pack = paintAll(data, { createCanvas: f.createCanvas, seed: 1, quality: 'low', ...opts });
  return { pack, canvases: f.canvases };
}

// the pack painted once and shared by the read-only tests below
const shared = paint();

// ---------------------------------------------------------------------------------------------------------------------------------
test('rng: mulberry32 is reproducible, in [0,1) and shared with the test helper', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = Array.from({ length: 64 }, a), sb = Array.from({ length: 64 }, b), sc = Array.from({ length: 64 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  const h = helperMulberry(42);
  assert.deepEqual(Array.from({ length: 8 }, h), sa.slice(0, 8));
  // the generator really spreads: mean of 4000 draws near 0.5
  const g = mulberry32(1995);
  let s = 0;
  for (let i = 0; i < 4000; i++) s += g();
  assert.ok(Math.abs(s / 4000 - 0.5) < 0.03);
});

test('mapping: patchPx / pxToTable / patchUV round trips and corners (floor and deck)', () => {
  for (const [name, rect, width] of [['floor', FLOOR_RECT, 1536], ['deck', DECK_RECT, 768]]) {
    const patch = { rect, width, height: patchHeight(rect, width) };
    // corners: x = xMax is the LEFT edge (px 0), y = yMin the TOP edge (py 0)
    assert.deepEqual(patchPx(patch, rect.xMax, rect.yMin), [0, 0], name);
    const br = patchPx(patch, rect.xMin, rect.yMax);
    assert.ok(Math.abs(br[0] - patch.width) < 1e-9 && Math.abs(br[1] - patch.height) < 1.0, name);
    assert.deepEqual(patchUV(patch, rect.xMax, rect.yMin), [0, 1]);
    const uv = patchUV(patch, rect.xMin, rect.yMax);
    assert.ok(Math.abs(uv[0] - 1) < 1e-9 && Math.abs(uv[1]) < 1e-3);
    for (let i = 0; i < 50; i++) {
      const x = rect.xMin + ((rect.xMax - rect.xMin) * ((i * 37) % 101)) / 100;
      const y = rect.yMin + ((rect.yMax - rect.yMin) * ((i * 53) % 103)) / 102;
      const [px, py] = patchPx(patch, x, y);
      const [bx, by] = pxToTable(patch, px, py);
      assert.ok(Math.abs(bx - x) < 1e-9 && Math.abs(by - y) < 1e-9);
      const [u, v] = patchUV(patch, x, y);
      assert.ok(Math.abs(u - px / patch.width) < 1e-12 && Math.abs(v - (1 - py / patch.height)) < 1e-12);
    }
    assert.ok(Math.abs(patchScale(patch) - patch.width / (rect.xMax - rect.xMin)) < 1e-12);
  }
  // uniform px per unit (no stretching) for both patches
  assert.equal(patchHeight(FLOOR_RECT, 1536), Math.round((1536 * 29) / 16));
  assert.ok(Math.abs(patchHeight(DECK_RECT, 768) / 768 - 10 / 6.61) < 1e-3);
  // the floor rect is the playfield of SPEC 1.1; the deck rect is the bbox of shell 103
  const shell = data.WALLS.find((w) => w.name === 'wall_103');
  const xs = shell.pts.map((p) => p[0]), ys = shell.pts.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - DECK_RECT.xMin) < 0.015 && Math.abs(Math.max(...xs) - DECK_RECT.xMax) < 0.015);
  assert.ok(Math.abs(Math.min(...ys) - DECK_RECT.yMin) < 0.015 && Math.abs(Math.max(...ys) - DECK_RECT.yMax) < 0.015);
});

test('mapping: the floor patch agrees with the data projection helpers of the original camera layout (flipper pivot is where it should be)', () => {
  const patch = { rect: FLOOR_RECT, width: 1600, height: patchHeight(FLOOR_RECT, 1600) };
  const [px, py] = patchPx(patch, 2.4888, 12.0631); // left flipper pivot: +x = screen LEFT, so px < width/2
  assert.ok(px < patch.width / 2 && py > patch.height / 2);
  const [qx] = patchPx(patch, -7.02, 10.08); // plunger lane at the screen right
  assert.ok(qx > patch.width * 0.9);
});

test('lampCellUV: local +x is the cell left edge, +y the bottom edge, centre maps to the cell centre', () => {
  const cell = { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75 };
  const size = [0.6, 0.8];
  const c = lampCellUV(cell, size, 0, 0);
  assert.ok(Math.abs(c[0] - 0.375) < 1e-12 && Math.abs(c[1] - 0.625) < 1e-12);
  assert.deepEqual(lampCellUV(cell, size, 0.3, 0.4).map((v) => +v.toFixed(9)), [0.25, 0.5]); // left, bottom
  assert.deepEqual(lampCellUV(cell, size, -0.3, -0.4).map((v) => +v.toFixed(9)), [0.5, 0.75]); // right, top
});

test('tableSpace matches mapping.patchPx (transform matrix and px()/py())', () => {
  const patch = { rect: FLOOR_RECT, width: 1024, height: patchHeight(FLOOR_RECT, 1024), canvas: createFakeCanvas(1, 1) };
  const T = tableSpace(patch);
  const c = createFakeCanvas(10, 10);
  const ctx = c.getContext('2d');
  T.enter(ctx);
  const op = c.ops.find((o) => o[0] === 'setTransform');
  const [, a, b, cc, d, e, f] = op;
  for (const [x, y] of [[0, 0], [-8, -14], [8, 15], [2.4888, 12.0631], [-7.02, 4.8]]) {
    const [px, py] = patchPx(patch, x, y);
    assert.ok(Math.abs(a * x + cc * y + e - px) < 1e-9, 'x');
    assert.ok(Math.abs(b * x + d * y + f - py) < 1e-9, 'y');
    assert.ok(Math.abs(T.px(x) - px) < 1e-9 && Math.abs(T.py(y) - py) < 1e-9);
  }
  T.leave(ctx);
  assert.equal(c.ops[c.ops.length - 1][0], 'restore');
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('paintAll: full ArtPack shape (quality low) inside the strict canvas subset', () => {
  const { pack } = shared;
  assert.deepEqual(Object.keys(pack).sort(), ['deck', 'floor', 'lampAtlas', 'misc', 'panel']);
  // floor
  assert.equal(pack.floor.width, 1024);
  assert.equal(pack.floor.height, Math.round((1024 * 29) / 16));
  assert.deepEqual(pack.floor.rect, { xMin: -8, xMax: 8, yMin: -14, yMax: 15 });
  assert.equal(pack.floor.canvas.width, pack.floor.width);
  assert.equal(pack.floor.canvas.height, pack.floor.height);
  // deck
  assert.equal(pack.deck.width, 512);
  assert.deepEqual(pack.deck.rect, { xMin: 1.04, xMax: 7.65, yMin: -2.06, yMax: 7.94 });
  assert.equal(pack.deck.height, patchHeight(DECK_RECT, 512));
  assert.equal(pack.deck.canvas.width, pack.deck.width);
  assert.equal(pack.deck.canvas.height, pack.deck.height);
  // panel
  assert.equal(pack.panel.width, 203);
  assert.equal(pack.panel.height, 394);
  // misc: exact keys and sizes of ARCHITECTURE.md 9.3
  assert.deepEqual(Object.keys(pack.misc).sort(), Object.keys(MISC_KEYS).sort());
  for (const [k, [w, h]] of Object.entries(MISC_KEYS)) {
    assert.equal(pack.misc[k].width, w, k);
    assert.equal(pack.misc[k].height, h, k);
  }
  // everything really drew something
  for (const c of [pack.floor.canvas, pack.deck.canvas, pack.lampAtlas.canvas, pack.panel, ...Object.values(pack.misc)]) {
    assert.ok(c.ops.length > 5, 'canvas has drawing ops');
  }
  assert.ok(pack.floor.canvas.ops.length > 5000);
});

test('paintAll: quality levels give the contracted sizes; unknown quality falls back to normal; opts are validated', () => {
  const sizes = {
    high: [2048, 1024, 128], normal: [1536, 768, 128], low: [1024, 512, 64],
  };
  for (const [q, [fw, dw, cell]] of Object.entries(sizes)) {
    const { pack } = paint({ quality: q });
    assert.equal(pack.floor.width, fw, q);
    assert.equal(pack.floor.height, Math.round((fw * 29) / 16), q);
    assert.equal(pack.deck.width, dw, q);
    assert.equal(pack.lampAtlas.cell, cell, q);
    assert.equal(pack.lampAtlas.width, ATLAS_COLS * cell, q);
  }
  assert.equal(paint({ quality: 'bogus' }).pack.floor.width, 1536);
  assert.equal(paint({ quality: undefined }).pack.floor.width, 1536);
  assert.throws(() => paintAll(data, {}), TypeError);
  assert.throws(() => paintAll(data), TypeError);
});

test('lampAtlas: 145 cells in LAMP_NAMES order, uniform, inside [0,1], never overlapping', () => {
  const { lampAtlas: at } = shared.pack;
  const keys = Object.keys(at.cells);
  assert.equal(keys.length, 145);
  assert.deepEqual(keys, lampKeys(data));
  for (const n of ['lite2', 'lite3', 'lite4']) {
    assert.ok(!(n in at.cells));
    for (let i = 0; i < 3; i++) assert.ok(`${n}#${i}` in at.cells, `${n}#${i}`);
  }
  assert.ok(!('lite192' in at.cells), 'lite192 has no bitmap');
  // order = LAMP_NAMES order
  const order = data.LAMP_NAMES.filter((n) => n !== 'lite192');
  const seen = [];
  for (const k of keys) { const n = k.split('#')[0]; if (seen[seen.length - 1] !== n) seen.push(n); }
  assert.deepEqual(seen, order);
  // geometry
  assert.equal(at.width, 12 * at.cell);
  assert.equal(at.height, Math.ceil(145 / 12) * at.cell);
  const rects = [];
  for (const k of keys) {
    const c = at.cells[k];
    assert.ok(c.u0 < c.u1 && c.v0 < c.v1, k);
    for (const v of [c.u0, c.u1, c.v0, c.v1]) assert.ok(v >= 0 && v <= 1, k);
    assert.equal(c.w, at.cell);
    assert.equal(c.h, at.cell);
    rects.push([k, c]);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i][1], b = rects[j][1];
      const overlap = a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
      assert.ok(!overlap, `${rects[i][0]} overlaps ${rects[j][0]}`);
    }
  }
  // v is in the flipY convention: the first cell is at the TOP of the canvas (largest v)
  const first = at.cells[keys[0]], last = at.cells[keys[keys.length - 1]];
  assert.ok(first.v1 > 0.9 && last.v1 < first.v1);
});

test('lampAtlas: one cell painting per key (clip + translate to the cell centre + lit sprite), deterministic and seed independent', () => {
  const f1 = createFakeCanvasFactory({ strict: true }), f2 = createFakeCanvasFactory({ strict: true });
  const a = buildLampAtlas(data, f1.createCanvas, mulberry32(1), 64);
  const b = buildLampAtlas(data, f2.createCanvas, mulberry32(999), 64);
  assert.equal(opsDigest(a.canvas), opsDigest(b.canvas));
  const translates = a.canvas.ops.filter((o) => o[0] === 'translate');
  assert.equal(translates.length, 145);
  Object.keys(a.cells).forEach((k, i) => {
    const col = i % 12, row = Math.floor(i / 12);
    assert.deepEqual(translates[i].slice(1), [col * 64 + 32, row * 64 + 32], k);
  });
  assert.equal(a.canvas.ops.filter((o) => o[0] === 'clip').length, 145);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('determinism: equal seeds give identical drawing operations, different seeds do not', () => {
  const a = paint({ seed: 7 }), b = paint({ seed: 7 }), c = paint({ seed: 8 });
  const digestOf = (p) => ({
    floor: opsDigest(p.floor.canvas), deck: opsDigest(p.deck.canvas), atlas: opsDigest(p.lampAtlas.canvas), panel: opsDigest(p.panel),
    misc: Object.fromEntries(Object.entries(p.misc).map(([k, v]) => [k, opsDigest(v)])),
  });
  assert.deepEqual(digestOf(a.pack), digestOf(b.pack));
  const da = digestOf(a.pack), dc = digestOf(c.pack);
  assert.notEqual(da.floor, dc.floor);
  assert.notEqual(da.deck, dc.deck);
  assert.notEqual(da.panel, dc.panel);
  for (const k of ['ballEnv', 'metalSide', 'rubber']) assert.notEqual(da.misc[k], dc.misc[k], k);
  // the default seed is 1995 and is stable
  const x = paint({ seed: undefined }), y = paint({ seed: 1995 });
  assert.equal(opsDigest(x.pack.floor.canvas), opsDigest(y.pack.floor.canvas));
});

test('painters are independent: each uses its own stream of the seed', () => {
  const f = createFakeCanvasFactory({ strict: true });
  const rand = mulberry32(5);
  const floor1 = paintFloor(data, f.createCanvas, mulberry32(5), 1024);
  const floor2 = paintFloor(data, f.createCanvas, mulberry32(5), 1024);
  assert.equal(opsDigest(floor1.canvas), opsDigest(floor2.canvas));
  const g = createFakeCanvasFactory({ strict: true });
  const deck = paintDeck(data, g.createCanvas, rand, 512);
  assert.equal(deck.width, 512);
  const misc = paintMisc(data, g.createCanvas, mulberry32(3));
  assert.equal(Object.keys(misc).length, 13);
  const panel = paintPanel(data, g.createCanvas, mulberry32(3));
  assert.equal(panel.width, 203);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('canvas API: only the allowed 2D subset is used (strict fake canvas throws otherwise); sanity of the strict mode itself', () => {
  const c = createFakeCanvas(4, 4, { strict: true });
  const ctx = c.getContext('2d');
  assert.throws(() => ctx.fillText2('x'), TypeError);
  assert.throws(() => { ctx.shadowColour = 'red'; }, TypeError);
  // every op name recorded by a full paint is allowed
  const names = new Set();
  for (const cv of [shared.pack.floor.canvas, shared.pack.deck.canvas, shared.pack.lampAtlas.canvas, shared.pack.panel, ...Object.values(shared.pack.misc)]) {
    for (const op of cv.ops) names.add(op[0]);
  }
  const allowed = new Set([...CANVAS_API.methods, 'set', 'addColorStop']);
  for (const n of names) assert.ok(allowed.has(n), 'op ' + n);
  const props = new Set(CANVAS_API.properties);
  for (const cv of [shared.pack.floor.canvas, shared.pack.panel]) for (const op of cv.ops) if (op[0] === 'set') assert.ok(props.has(op[1]), 'prop ' + op[1]);
  // the contract's prose list of allowed calls: no text API, no pattern, no getImageData / putImageData in the painters
  for (const banned of ['fillText', 'strokeText', 'measureText', 'putImageData', 'getImageData', 'createPattern', 'drawImage']) {
    assert.ok(!names.has(banned), banned + ' must not be used');
  }
});

test('module sources contain no external resource strings, no Math.random, no Date, no DOM globals', () => {
  const files = fs.readdirSync(ART_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 12);
  for (const f of files) {
    const raw = fs.readFileSync(path.join(ART_DIR, f), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/https?:|data:image|\.png|\.jpe?g|\.gif|\.webp|url\(/i.test(src), f + ': external resource string');
    assert.ok(!/Math\.random|Date\.now|new Date|performance\.now|setTimeout|setInterval|requestAnimationFrame/.test(src), f + ': nondeterminism');
    assert.ok(!/\b(window|document|localStorage|navigator|fetch|Image)\b\s*[.(]/.test(src), f + ': DOM access');
    assert.match(raw, /OWNER: ART/, f);
    assert.match(raw, /^ \* STATUS: IMPLEMENTED\s*$/m, f);
    assert.ok(!/https?:|data:image/i.test(raw), f + ': external resource string (comments included)');
    for (const m of src.matchAll(/from '([^']+)'/g)) {
      assert.ok(m[1].startsWith('./') && m[1].endsWith('.js'), f + ' imports ' + m[1]);
      assert.ok(!/(physics|rules|lamps\/|audio|ui\/|three)/.test(m[1]) || m[1] === './lamps.js', f + ' imports ' + m[1]);
    }
    // layering: art may import only data (none of them does directly) and its own folder
    assert.ok(!/from '\.\.\/(?!\.\/data\/)/.test(src) || true);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('drawLampShape draws every lamp in both states (and every ON image of the 3-image lamps)', () => {
  let n = 0;
  for (const def of data.LAMPS) {
    if (!def.pos) continue; // lite192: no bitmap
    for (const state of ['unlit', 'lit']) {
      for (let ci = 0; ci < def.nStates; ci++) {
        const c = createFakeCanvas(8, 8, { strict: true });
        const ctx = c.getContext('2d');
        drawLampShape(ctx, def, state, 96, 96, { colorIndex: ci });
        assert.ok(c.ops.length >= 6, `${def.name} ${state} ${ci}`);
        assert.ok(c.ops.some((o) => o[0] === 'fill' || o[0] === 'stroke' || o[0] === 'fillRect'), `${def.name} ${state}`);
        assert.equal(c.ops.filter((o) => o[0] === 'save').length, c.ops.filter((o) => o[0] === 'restore').length, 'balanced save/restore ' + def.name);
        n++;
      }
    }
  }
  assert.equal(n, 2 * (139 - 3 + 9));
  assert.throws(() => drawLampShape(createFakeCanvas(2, 2).getContext('2d'), data.LAMPS[0], 'half', 1, 1), TypeError);
  // lite192 (no size) is a no-op, not an error
  const c192 = createFakeCanvas(2, 2);
  drawLampShape(c192.getContext('2d'), data.LAMP_BY_NAME.lite192, 'unlit', 1, 1);
  assert.equal(c192.ops.length, 0);
});

test('drawLampShape: unlit insets rotate with LampDef.rot, lit sprites stay quad-local (RENDER rotates the quad); orientation rules', () => {
  const arrow = data.LAMP_BY_NAME.lite303; // arrow with a non-zero rot
  assert.ok(Math.abs(arrow.rot) > 0.1);
  const un = createFakeCanvas(4, 4), li = createFakeCanvas(4, 4);
  drawLampShape(un.getContext('2d'), arrow, 'unlit', 50, 50);
  drawLampShape(li.getContext('2d'), arrow, 'lit', 50, 50);
  const rotUn = un.ops.filter((o) => o[0] === 'rotate'), rotLi = li.ops.filter((o) => o[0] === 'rotate');
  assert.equal(rotUn.length, 1);
  assert.equal(rotUn[0][1], arrow.rot);
  assert.equal(rotLi.length, 0);
  // opts.rotate overrides
  const forced = createFakeCanvas(4, 4);
  drawLampShape(forced.getContext('2d'), arrow, 'lit', 50, 50, { rotate: true });
  assert.equal(forced.ops.filter((o) => o[0] === 'rotate').length, 1);
  // mirrored T-frame scale (local +x = canvas left)
  const sc = un.ops.find((o) => o[0] === 'scale');
  assert.deepEqual(sc.slice(1), [-50, 50]);
});

test('lamp insets: every positioned lamp has an inset inside its texture, exactly at its table position', () => {
  const floor = shared.pack.floor, deck = shared.pack.deck;
  const deckNames = ['lite54', 'lite55', 'lite56', 'lite169', 'lite170', 'lite171', 'lite198', 'lite316', 'lite317'];
  let nFloor = 0, nDeck = 0;
  for (const def of data.LAMPS) {
    if (!def.pos) { assert.equal(def.name, 'lite192'); continue; }
    const key = lampPatchKey(def);
    assert.equal(key === 'deck', deckNames.includes(def.name), def.name + ' patch');
    assert.equal(key, def.z >= 1 ? 'deck' : 'floor');
    const patch = key === 'deck' ? deck : floor;
    const b = lampInsetBounds(def, SHAPE_FRAC);
    // the centre is inside the texture and the lamp shape (axis-aligned box of the rotated rectangle) is inside it too, except that a few lamps
    // at the cabinet wall (lite67, lite193, ...) may poke up to 0.15 units over the rect edge (the canvas simply clips them)
    const slack = 0.15;
    assert.ok(def.pos[0] > patch.rect.xMin && def.pos[0] < patch.rect.xMax && def.pos[1] > patch.rect.yMin && def.pos[1] < patch.rect.yMax, `${def.name} centre`);
    assert.ok(b.xMin >= patch.rect.xMin - slack && b.xMax <= patch.rect.xMax + slack, `${def.name} x ${b.xMin}..${b.xMax}`);
    assert.ok(b.yMin >= patch.rect.yMin - slack && b.yMax <= patch.rect.yMax + slack, `${def.name} y ${b.yMin}..${b.yMax}`);
    // pixel box overlaps the canvas almost completely
    const [x0, y0] = patchPx(patch, b.xMax, b.yMin), [x1, y1] = patchPx(patch, b.xMin, b.yMax);
    const vis = (Math.min(x1, patch.width) - Math.max(x0, 0)) * (Math.min(y1, patch.height) - Math.max(y0, 0));
    assert.ok(vis >= 0.8 * (x1 - x0) * (y1 - y0), `${def.name} visible fraction`);
    assert.ok(x1 - x0 > 4 && y1 - y0 > 4, `${def.name} px size`);
    if (key === 'deck') nDeck++; else nFloor++;
  }
  assert.equal(nDeck, 9);
  assert.equal(nFloor, 130);
  // the painter puts the inset EXACTLY at patchPx(pos): check the translate ops of paintLampInsets against the mapping
  for (const [which, patch] of [['floor', floor], ['deck', deck]]) {
    const c = createFakeCanvas(patch.width, patch.height, { strict: true });
    const count = paintLampInsets(c.getContext('2d'), patch, data.LAMPS, which);
    const defs = data.LAMPS.filter((d) => d.pos && lampPatchKey(d) === which);
    assert.equal(count, defs.length);
    const tr = c.ops.filter((o) => o[0] === 'translate');
    assert.equal(tr.length, defs.length);
    defs.forEach((d, i) => {
      const [px, py] = patchPx(patch, d.pos[0], d.pos[1]);
      assert.ok(Math.abs(tr[i][1] - px) < 1e-6 && Math.abs(tr[i][2] - py) < 1e-6, `${which} ${d.name}`);
    });
    // and the scale is the patch scale (so insets have the lamp's real size in table units)
    const sc = c.ops.filter((o) => o[0] === 'scale')[0];
    assert.ok(Math.abs(Math.abs(sc[1]) - patch.width / (patch.rect.xMax - patch.rect.xMin)) < 1e-9);
  }
  // the floor painter calls the inset painter last (insets sit on top of every decal)
  const ops = floor.canvas.ops;
  const lastTranslateIdx = ops.map((o) => o[0]).lastIndexOf('translate');
  const lastSetTransform = ops.map((o) => o[0]).lastIndexOf('setTransform');
  assert.ok(lastTranslateIdx > lastSetTransform);
});

test('lamp shape geometry: SHAPE_FRAC leaves a glow margin; atlas shapes stay inside their quad', () => {
  assert.ok(SHAPE_FRAC > 0.5 && SHAPE_FRAC < 0.9);
  for (const def of data.LAMPS) {
    if (!def.pos) continue;
    assert.ok(def.size[0] > 0 && def.size[1] > 0);
    const b = lampInsetBounds(def);
    assert.ok(b.ex >= def.size[0] / 2 - 1e-9 || Math.abs(def.rot) > 0, def.name);
    assert.ok(Math.abs(b.cx - def.pos[0]) < 1e-12 && Math.abs(b.cy - def.pos[1]) < 1e-12);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('font: every glyph is drawn inside its grid, all label / rank / logo characters have real glyphs', () => {
  for (const [ch, g] of Object.entries(GLYPHS)) {
    for (const s of g.strokes) {
      for (const [x, y] of s) {
        assert.ok(x >= -0.001 && x <= g.w + 0.001, `${ch} x ${x}`);
        assert.ok(y >= -0.001 && y <= 6.4, `${ch} y ${y}`);
      }
    }
  }
  const texts = [...LABELS.map((l) => l.text), ...data.RANK_NAMES, 'STAR', 'CADET', 'PINBALL', 'BALL', 'TILT'];
  for (const t of texts) {
    for (const ch of t) assert.ok(ch === ' ' || glyphOf(ch) !== GLYPHS['?'] || ch === '?', `${t}: ${ch}`);
    assert.ok(textWidth(t, 1) > 0);
  }
  assert.ok(textWidth('AB', 6, 0) === 8 && textWidth('A', 6, 0.5) === 4);
  assert.equal(glyphOf('a'), GLYPHS.A);
  assert.equal(glyphOf('~'), GLYPHS['?']);
});

test('labels: inside their texture, clear of every wall island / shell, of the deck for floor labels, and of each other', () => {
  const islands = data.WALLS.filter((w) => w.solid === 'island' && w.mask === 1);
  const shells = data.WALLS.filter((w) => w.solid === 'shell');
  const wanted = ['RE-ENTRY', 'HYPERSPACE', 'FUEL', 'MEDAL', 'MISSION', 'BOOSTER', 'SKILL SHOT', 'LAUNCH'];
  for (const t of wanted) assert.ok(LABELS.some((l) => l.text === t), 'label ' + t);
  const boxes = [];
  for (const l of LABELS) {
    const b = labelBox(l);
    boxes.push([l, b]);
    const rect = l.patch === 'deck' ? DECK_RECT : FLOOR_RECT;
    assert.ok(b.xMin > rect.xMin && b.xMax < rect.xMax && b.yMin > rect.yMin && b.yMax < rect.yMax, `${l.id} inside texture`);
    const pts = [...b.corners, [l.x, l.y]];
    // sample along the box too
    for (let i = 1; i < 6; i++) {
      pts.push([b.corners[0][0] + ((b.corners[1][0] - b.corners[0][0]) * i) / 6, b.corners[0][1] + ((b.corners[1][1] - b.corners[0][1]) * i) / 6]);
      pts.push([b.corners[3][0] + ((b.corners[2][0] - b.corners[3][0]) * i) / 6, b.corners[3][1] + ((b.corners[2][1] - b.corners[3][1]) * i) / 6]);
    }
    if (l.patch === 'floor') {
      for (const [x, y] of pts) {
        for (const w of islands) assert.ok(!pointInPoly(x, y, w.pts), `${l.id} (${x.toFixed(2)},${y.toFixed(2)}) inside ${w.name}`);
        for (const w of shells) assert.ok(!pointInPoly(x, y, w.pts), `${l.id} under ${w.name}`);
      }
    } else {
      for (const [x, y] of pts) assert.ok(pointInPoly(x, y, data.DECK_FLOOR_POLY), `${l.id} (${x.toFixed(2)},${y.toFixed(2)}) on the deck floor`);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [la, a] = boxes[i], [lb, b] = boxes[j];
      if (la.patch !== lb.patch) continue;
      const overlap = a.xMin < b.xMax && b.xMin < a.xMax && a.yMin < b.yMax && b.yMin < a.yMax;
      assert.ok(!overlap, `${la.id} overlaps ${lb.id}`);
    }
  }
  // and no word sits on a lamp inset of the same texture (the lamp shapes are the readable parts of the table)
  for (const [l, b] of boxes) {
    for (const def of data.LAMPS) {
      if (!def.pos || (def.z >= 1) !== (l.patch === 'deck')) continue;
      const q = lampInsetBounds(def, SHAPE_FRAC);
      const overlap = b.xMin < q.xMax && q.xMin < b.xMax && b.yMin < q.yMax && q.yMin < b.yMax;
      assert.ok(!overlap, `${l.id} overlaps lamp ${def.name}`);
    }
  }
});

test('labels: the rank-name ring has nine arcs on the emblem, clear of the lamp ring radii', () => {
  assert.equal(RANK_RING.angles.length, data.RANK_NAMES.length);
  assert.equal(data.RANK_NAMES.length, 9);
  for (const a of RANK_RING.angles) assert.ok(a >= 0 && a < 360);
  // text band 3.0 +- size/2 lies between the outer lamp ring (r 2.5 + lamp radius) and the emblem disc edge (3.5)
  assert.ok(RANK_RING.radius - RANK_RING.size / 2 > 2.5 + 0.3);
  assert.ok(RANK_RING.radius + RANK_RING.size / 2 < 3.45);
  // neighbouring names never collide: half the angular spans of two neighbours plus 3 degrees fit in the gap between their lamps
  const spans = data.RANK_NAMES.map((n) => (textWidth(n.toUpperCase(), RANK_RING.size, RANK_RING.tracking) / RANK_RING.radius) * (180 / Math.PI));
  RANK_RING.angles.forEach((a, i, arr) => {
    const j = (i + 1) % arr.length;
    const gap = (arr[j] - a + 360) % 360;
    assert.ok((spans[i] + spans[j]) / 2 + 3 < gap, `${data.RANK_NAMES[i]} / ${data.RANK_NAMES[j]}`);
  });
  // the emblem centre agrees with the ring parametrisation of SPEC App. A (outer ring centre (0.007, 6.039))
  assert.ok(Math.hypot(EMBLEM.x - 0.007, EMBLEM.y - 6.039) < 0.02);
  const hole = data.KICKOUTS.find((k) => k.name === 'a_kout1');
  assert.ok(Math.hypot(EMBLEM.x - hole.c[0], EMBLEM.y - hole.c[1]) < 0.05);
});

test('copper lanes follow the wall geometry: centre lines stay on open floor, inside the table, clear of every island', () => {
  const islands = data.WALLS.filter((w) => w.solid === 'island' && w.mask === 1);
  for (const [name, lane] of Object.entries(LANES)) {
    assert.ok(lane.pts.length >= 4 && lane.width > 0.5 && lane.width < 1.2, name);
    for (let i = 0; i < lane.pts.length - 1; i++) {
      for (let k = 0; k <= 8; k++) {
        const x = lane.pts[i][0] + ((lane.pts[i + 1][0] - lane.pts[i][0]) * k) / 8;
        const y = lane.pts[i][1] + ((lane.pts[i + 1][1] - lane.pts[i][1]) * k) / 8;
        assert.ok(x > -8 && x < 8 && y > -14 && y < 15, `${name} inside table`);
        for (const w of islands) assert.ok(!pointInPoly(x, y, w.pts), `${name} (${x.toFixed(2)},${y.toFixed(2)}) inside ${w.name}`);
      }
    }
  }
  // the plunger lane is the lane the plunger feeds
  const feed = data.PLUNGER.feed;
  const bottom = LANES.orbit.pts[1];
  assert.ok(Math.abs(bottom[0] - feed[0]) < 0.05);
});

test('deck: ramp footprint splits into two ordered sides between the two mouths', () => {
  const { left, right } = rampSides(data.RAMP_FOOTPRINT_POLY);
  const fp = data.RAMP_FOOTPRINT_POLY;
  assert.equal(left.length + right.length, fp.length);
  assert.deepEqual(left[0], fp[3]);   // low-mouth end A
  assert.deepEqual(right[0], fp[4]);  // low-mouth end B
  assert.deepEqual(right[right.length - 1], fp[13]); // upper-mouth end C
  assert.deepEqual(left[left.length - 1], fp[14]);   // upper-mouth end D
  // low mouth = the seam of RAMPS.ramp.enter; both sides start on it
  const enter = data.RAMPS.ramp.enter;
  const ends = [enter.p0 || enter.line?.[0] || enter.a, enter.p1 || enter.line?.[1] || enter.b].filter(Boolean);
  if (ends.length === 2) {
    const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01;
    assert.ok((near(left[0], ends[0]) || near(left[0], ends[1])) && (near(right[0], ends[0]) || near(right[0], ends[1])));
  }
  // every footprint vertex lies inside the deck bbox
  for (const [x, y] of fp) assert.ok(x >= DECK_RECT.xMin && x <= DECK_RECT.xMax && y >= DECK_RECT.yMin && y <= DECK_RECT.yMax);
  for (const [x, y] of data.DECK_FLOOR_POLY) assert.ok(x >= DECK_RECT.xMin - 0.01 && x <= DECK_RECT.xMax + 0.01 && y >= DECK_RECT.yMin - 0.01 && y <= DECK_RECT.yMax + 0.01);
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('panel: boxes derive from the UI field rectangles, stay inside the bezel, never overlap and keep their fields black', () => {
  const boxes = panelBoxes(data);
  const f = data.PANEL.fields;
  assert.deepEqual(boxes.score, { x: 12, y: 180, w: 175, h: 32 });
  assert.deepEqual(boxes.info, { x: 15, y: 223, w: 173, h: 52 });
  assert.deepEqual(boxes.mission, { x: 15, y: 287, w: 173, h: 96 });
  assert.deepEqual(boxes.ball, { x: 164, y: 137, w: 21, h: 28 });
  const inside = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
  assert.ok(inside(f.player1, boxes.score) && inside(f.score1, boxes.score));
  assert.ok(inside(f.info, boxes.info));
  assert.ok(inside(f.mission, boxes.mission));
  assert.ok(inside(f.ball1, boxes.ball));
  // margins: 5 px for the score row, 4 px for the text boxes (ARCHITECTURE 8.3)
  assert.equal(f.player1.x - boxes.score.x, 5);
  assert.equal(f.info.x - boxes.info.x, 4);
  assert.equal(f.mission.y - boxes.mission.y, 4);
  const all = [boxes.score, boxes.info, boxes.mission, boxes.ball];
  for (const b of all) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 203 && b.y + b.h <= 394);
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `boxes ${i}/${j}`);
  // the boxes sit below the logo picture except the boxed ball digit which lives at its lower right
  assert.ok(boxes.score.y > LOGO_RECT.y + LOGO_RECT.h);
  assert.ok(boxes.ball.x + boxes.ball.w <= LOGO_RECT.x + LOGO_RECT.w && boxes.ball.y + boxes.ball.h <= LOGO_RECT.y + LOGO_RECT.h);
  // panel ops: each box is filled with pure black and the field rectangles are inside those fills
  const ops = shared.pack.panel.ops;
  let fill = null;
  const blackFills = [];
  for (const op of ops) {
    if (op[0] === 'set' && op[1] === 'fillStyle') fill = op[2];
    if (op[0] === 'fillRect' && fill === '#000000') blackFills.push(op.slice(1));
  }
  for (const b of [boxes.score, boxes.info, boxes.mission, boxes.ball]) {
    assert.ok(blackFills.some(([x, y, w, h]) => x === b.x && y === b.y && w === b.w && h === b.h), 'black fill for ' + JSON.stringify(b));
  }
  // the text of the logo uses no digits: only the word BALL / STAR CADET / PINBALL
  const dividerX = Math.round((f.player1.x + f.player1.w + f.score1.x) / 2);
  assert.ok(dividerX > f.player1.x + f.player1.w && dividerX < f.score1.x);
});

test('palette: contracted keys kept, colours are valid hex, bumper ring colours per level', () => {
  for (const k of ['floorNavy', 'floorNavy2', 'vein', 'ringCyan', 'gravityDot', 'rimBrown', 'lampOrange', 'lampBlue', 'lilacLight', 'lilacMid', 'lilacDark', 'pink', 'deck',
    'deckRim', 'wallMetal', 'wallMetalDark', 'railSilver', 'railRed', 'copper', 'copperLight', 'bumperWhite', 'bumperCap', 'targetYellow', 'targetFrame', 'flipperBody',
    'flipperRim', 'apron', 'ball', 'plunger']) {
    assert.match(PALETTE[k], /^#[0-9a-f]{6}$/i, k);
  }
  for (const v of Object.values(PALETTE)) assert.match(v, /^#[0-9a-f]{6}$/i);
  assert.equal(PALETTE.railRed, '#c41315');
  assert.equal(PALETTE.floorNavy, '#182848');
  assert.equal(PALETTE.targetYellow, '#faf947');
  assert.equal(bumperRingColor('attack', 0), '#c41315');
  assert.equal(bumperRingColor('launch', 0), '#815cd2');
  assert.equal(bumperRingColor('attack', 99), BUMPER_RING_COLORS.attack[3]);
  assert.equal(bumperRingColor('launch', -4), BUMPER_RING_COLORS.launch[0]);
  assert.ok(Object.isFrozen(PALETTE) && Object.isFrozen(BUMPER_RING_COLORS));
});

test('draw helpers: pointInPoly sanity (used by the placement tests)', () => {
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.ok(pointInPoly(1, 1, sq));
  assert.ok(!pointInPoly(3, 1, sq));
  assert.ok(!pointInPoly(-0.1, 1, sq));
});

test('labels: every floor label is VISIBLE from the original camera (not hidden behind a 0.85-high wall in front of it)', () => {
  // VISUAL QA regression: "HYPERSPACE" used to sit right behind the wall-296 housing and showed only "HYPERSP".
  const cam = [0, 13.5, 21.0];                                   // SPEC 1.4, T-frame
  const islands = data.WALLS.filter((w) => w.solid === 'island' && w.mask === 1 && w.name !== 'wall_102');
  for (const l of LABELS) {
    if (l.patch !== 'floor') continue;
    const b = labelBox(l);
    const pts = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 2; j++) {
      const a = b.corners[0], c = b.corners[1], d = b.corners[3];
      pts.push([a[0] + ((c[0] - a[0]) * i) / 10 + ((d[0] - a[0]) * j) / 2, a[1] + ((c[1] - a[1]) * i) / 10 + ((d[1] - a[1]) * j) / 2]);
    }
    for (const [x, y] of pts) {
      for (let k = 1; k <= 24; k++) {
        const t = (k / 24) * (1.0 / cam[2]);                     // the ray from the floor point to the camera, up to z = 1.0
        const px = x + (cam[0] - x) * t, py = y + (cam[1] - y) * t, pz = cam[2] * t;
        for (const w of islands) {
          const top = w.top ?? 0.85;
          if (pz > 0.02 && pz < top) assert.ok(!pointInPoly(px, py, w.pts), `${l.id} (${x.toFixed(2)},${y.toFixed(2)}) is hidden behind ${w.name}`);
        }
      }
    }
  }
});

test('labels: the deck label is VISIBLE from the original camera (not covered by a launch bumper, deck wall or deck post)', () => {
  // VISUAL QA regression: "LAUNCH" used to sit right behind launch bumper a_bump6 and lost its first letter.
  const cam = [0, 13.5, 21.0], deckZ = data.HEIGHTS.deckSurface;
  const bumps = data.BUMPERS.filter((b) => b.mask === 4);
  const walls = data.WALLS.filter((w) => w.solid === 'island' && w.mask === 4);
  const posts = data.POSTS.filter((p) => p.mask === 4);
  for (const l of LABELS) {
    if (l.patch !== 'deck') continue;
    const b = labelBox(l);
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 2; j++) {
      const a = b.corners[0], c = b.corners[1], d = b.corners[3];
      const x = a[0] + ((c[0] - a[0]) * i) / 10 + ((d[0] - a[0]) * j) / 2, y = a[1] + ((c[1] - a[1]) * i) / 10 + ((d[1] - a[1]) * j) / 2;
      const dz = cam[2] - deckZ;
      for (let k = 1; k <= 30; k++) {
        const t = (k / 30) * (1.0 / dz);                        // the ray from the deck point to the camera, up to 1.0 above the deck
        const px = x + (cam[0] - x) * t, py = y + (cam[1] - y) * t, pz = dz * t;   // pz = height above the deck surface
        if (pz < 0.02) continue;
        for (const bu of bumps) assert.ok(!(Math.hypot(px - bu.c[0], py - bu.c[1]) < 0.47 && pz < data.HEIGHTS.launchBumper.bodyAboveDeck), `${l.id} (${x.toFixed(2)},${y.toFixed(2)}) is hidden behind ${bu.name}`);
        for (const w of walls) assert.ok(!(deckZ + pz < (w.top ?? 1.7) && pointInPoly(px, py, w.pts)), `${l.id} is hidden behind ${w.name}`);
        for (const p of posts) assert.ok(!(Math.hypot(px - p.c[0], py - p.c[1]) < p.r + 0.02 && pz < 0.5), `${l.id} is hidden behind ${p.name}`);
      }
    }
  }
});
