/**
 * tests/ui.test.mjs
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 8.10: pure UI modules in Node - wrapText, formatScore / formatHighScore, GLYPHS, keyLabel, storage resilience, drawDotText and
 * createPanel against tests/helpers/fake_canvas.mjs (strict mode: only the whitelisted 2D API). The DOM modules are in tests/ui_dom.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from '../src/ui/textlayout.js';
import { formatScore, formatHighScore } from '../src/ui/format.js';
import { GLYPHS, glyphFor, drawDotText } from '../src/ui/dotfont.js';
import { keyLabel } from '../src/ui/keylabels.js';
import {
  createStore, DEFAULT_OPTIONS, STORAGE_KEYS, sanitizeOptions, sanitizeBindings, sanitizeHighScores,
} from '../src/ui/storage.js';
import { createPanel, panelAriaText } from '../src/ui/panel.js';
import { createFakeCanvas, opsDigest } from './helpers/fake_canvas.mjs';
import { PANEL, DEFAULT_KEYS } from '../src/data/constants.js';
import { INFO, MISSION_TEXT, RANK_NAMES, fmt } from '../src/data/text.js';

// ------------------------------------------------------------------------------------------------------------------ wrapText
test('wrapText: the SPEC example and basic wrapping', () => {
  assert.deepEqual(wrapText('Ready for Launch', 15, 2), ['Ready for', 'Launch']);
  assert.deepEqual(wrapText('Player 1', 15, 2), ['Player 1']);
  assert.deepEqual(wrapText('Hit Mission Targets to Pick a Mission', 15, 4), ['Hit Mission', 'Targets to Pick', 'a Mission']);
  assert.deepEqual(wrapText('exactly15chars!!', 15, 4), ['exactly15chars!', '!']);
  assert.deepEqual(wrapText('exactly15chars!', 15, 4), ['exactly15chars!']);
});

test('wrapText: a word longer than the box is split mid-word', () => {
  const w = 'ABCDEFGHIJKLMNOPQRST';                       // 20 letters
  assert.deepEqual(wrapText(w, 15, 2), ['ABCDEFGHIJKLMNO', 'PQRST']);
  assert.deepEqual(wrapText('hi ' + w, 15, 3), ['hi', 'ABCDEFGHIJKLMNO', 'PQRST']);
  assert.deepEqual(wrapText('A'.repeat(31), 15, 4), ['A'.repeat(15), 'A'.repeat(15), 'A']);
});

test('wrapText: forced breaks, cut at `rows`, empty input, trailing spaces', () => {
  assert.deepEqual(wrapText('Center Post\n1000', 15, 2), ['Center Post', '1000']);
  assert.deepEqual(wrapText('a\nb\nc\nd\ne', 15, 4), ['a', 'b', 'c', 'd']);
  assert.deepEqual(wrapText('one two three four five six seven', 5, 2), ['one', 'two']);
  assert.deepEqual(wrapText('', 15, 2), []);
  assert.deepEqual(wrapText(null, 15, 2), []);
  assert.deepEqual(wrapText('\n\n', 15, 2), []);
  assert.deepEqual(wrapText('a\n\nb', 15, 4), ['a', '', 'b']);
  assert.deepEqual(wrapText('a\n', 15, 4), ['a']);
  assert.deepEqual(wrapText('trailing   ', 15, 2), ['trailing']);
  assert.deepEqual(wrapText('  two   spaces  ', 15, 2), ['two spaces']);
  assert.deepEqual(wrapText('a\r\nb', 15, 2), ['a', 'b']);
  assert.deepEqual(wrapText('abc', 0, 2), []);
  assert.deepEqual(wrapText('abc', 15, 0), []);
  assert.deepEqual(wrapText('x y z', 15), ['x y z']);
});

test('wrapText: every game message fits the 15 x 2 / 15 x 4 boxes without losing characters', () => {
  const samples = [];
  for (const t of Object.values(INFO)) samples.push([t, 2]);
  for (const t of Object.values(MISSION_TEXT)) samples.push([t, 4]);
  const expanded = samples.map(([t, rows]) => [fmt(t, 150000, RANK_NAMES[5], 3), rows]);
  for (const [text, rows] of expanded) {
    const lines = wrapText(text, 15, rows);
    assert.ok(lines.length <= rows, text);
    for (const l of lines) assert.ok(l.length <= 15, `${text} -> "${l}"`);
    // nothing but whitespace may be lost when it fits
    if (lines.length < rows || wrapText(text, 15, 99).length <= rows) {
      assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''), text);
    }
  }
});

// ------------------------------------------------------------------------------------------------------------------ formats
test('formatScore: plain decimal, blank when negative (SPEC E3)', () => {
  assert.equal(formatScore(-1), '');
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(12), '12');
  assert.equal(formatScore(999999999), '999999999');
  assert.equal(formatScore(1234567.9), '1234567');
  assert.equal(formatScore(NaN), '');
  assert.equal(formatScore(undefined), '');
  assert.ok(!/[,.\s]/.test(formatScore(123456789)));
});

test('formatHighScore: thousands separators only here', () => {
  assert.equal(formatHighScore(1234567), '1,234,567');
  assert.equal(formatHighScore(0), '0');
  assert.equal(formatHighScore(999), '999');
  assert.equal(formatHighScore(1000), '1,000');
  assert.equal(formatHighScore(100000), '100,000');
  assert.equal(formatHighScore(999999999), '999,999,999');
  assert.equal(formatHighScore(1000000000), '1,000,000,000');
  assert.equal(formatHighScore(-999), '');
  assert.equal(formatHighScore('x'), '');
});

// ------------------------------------------------------------------------------------------------------------------ glyphs
test('GLYPHS cover ASCII 32..126, 7 rows x 5 chars, all distinct', () => {
  const seen = new Map();
  for (let c = 32; c <= 126; c++) {
    const ch = String.fromCharCode(c);
    const g = GLYPHS[ch];
    assert.ok(Array.isArray(g), `glyph for ${JSON.stringify(ch)}`);
    assert.equal(g.length, 7, ch);
    for (const row of g) assert.match(row, /^[#.]{5}$/, ch);
    const key = g.join('/');
    assert.ok(!seen.has(key), `${ch} duplicates ${seen.get(key)}`);
    seen.set(key, ch);
  }
  assert.equal(GLYPHS[' '].join(''), '.'.repeat(35));
  assert.ok(Object.isFrozen(GLYPHS));
});

test('glyphFor: first character, ? fallback, null for nothing', () => {
  assert.equal(glyphFor('A'), GLYPHS.A);
  assert.equal(glyphFor('AB'), GLYPHS.A);
  assert.equal(glyphFor('é'), GLYPHS['?']);
  assert.equal(glyphFor(''), null);
  assert.equal(glyphFor(5), null);
});

// ------------------------------------------------------------------------------------------------------------------ keyLabel
test('keyLabel table', () => {
  const t = {
    KeyZ: 'Z', KeyA: 'A', Digit1: '1', Digit0: '0', Slash: '/', Period: '.', Comma: ',', Space: 'Space', ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow', Enter: 'Enter', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    Numpad1: 'Num 1', NumpadAdd: 'Num +', F2: 'F2', F12: 'F12', Escape: 'Esc', ControlLeft: 'Left Ctrl', Backslash: '\\', Minus: '-',
  };
  for (const [code, label] of Object.entries(t)) assert.equal(keyLabel(code), label, code);
  assert.equal(keyLabel('SomethingNew'), 'SomethingNew');
  assert.equal(keyLabel(''), '');
  assert.equal(keyLabel(undefined), '');
  // every default binding has a short readable label
  assert.deepEqual(Object.values(DEFAULT_KEYS).map(keyLabel), ['Z', '/', 'Space', 'X', '.', 'Up Arrow']);
});

// ------------------------------------------------------------------------------------------------------------------ storage
/** A Storage double backed by a Map. */
function mapStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
function throwingStorage() {
  const boom = () => { throw new Error('SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}
const SCORES = [
  { name: 'Ann', score: 900000 }, { name: 'Bob', score: 50000 }, { name: '', score: -999 }, { name: '', score: -999 }, { name: '', score: -999 },
];

test('storage: defaults without any storage (null, undefined in Node)', () => {
  for (const st of [createStore(null), createStore(), createStore(undefined)]) {
    assert.deepEqual(st.getOptions(), DEFAULT_OPTIONS);
    assert.equal(st.getBindings(), null);
    assert.equal(st.getHighScores(), null);
  }
  assert.deepEqual(DEFAULT_OPTIONS, { sounds: true, music: false, fullscreen: false, players: 1, camera: 'original', volume: 0.8, soundConsent: 'unset', cinematic: false, mouseLook: true });
});

test('storage: keeps working in memory when null or throwing', () => {
  for (const backend of [null, throwingStorage()]) {
    const st = createStore(backend);
    assert.deepEqual(st.getOptions(), DEFAULT_OPTIONS);
    const o = st.setOptions({ sounds: false, players: 3, camera: 'top' });
    assert.equal(o.sounds, false);
    assert.equal(o.players, 3);
    assert.deepEqual(st.getOptions(), o);
    const b = { flipperLeft: 'KeyA', flipperRight: 'KeyL', plunger: 'Enter', nudgeLeft: 'KeyQ', nudgeRight: 'KeyP', nudgeBottom: 'ArrowDown' };
    st.setBindings(b);
    assert.deepEqual(st.getBindings(), b);
    st.setHighScores(SCORES);
    assert.deepEqual(st.getHighScores(), SCORES);
  }
});

test('storage: corrupt JSON and wrong shapes give defaults / null', () => {
  const st = createStore(mapStorage({
    [STORAGE_KEYS.options]: '{not json', [STORAGE_KEYS.bindings]: '[1,2]', [STORAGE_KEYS.highScores]: '{"a":1}',
  }));
  assert.deepEqual(st.getOptions(), DEFAULT_OPTIONS);
  assert.equal(st.getBindings(), null);
  assert.equal(st.getHighScores(), null);
  const st2 = createStore(mapStorage({
    [STORAGE_KEYS.options]: JSON.stringify({ sounds: 'yes', players: 9, camera: 'sideways', volume: 5, soundConsent: 'maybe', music: true }),
    [STORAGE_KEYS.bindings]: JSON.stringify({ flipperLeft: 'KeyZ' }),
    [STORAGE_KEYS.highScores]: JSON.stringify([{ name: 'x', score: 'NaN' }]),
  }));
  assert.deepEqual(st2.getOptions(), { ...DEFAULT_OPTIONS, music: true, volume: 1 });
  assert.equal(st2.getBindings(), null);
  assert.equal(st2.getHighScores(), null);
});

test('storage: round trips through a real-looking storage and a second store', () => {
  const backend = mapStorage();
  const a = createStore(backend);
  a.setOptions({ music: true, fullscreen: true, volume: 0.25, soundConsent: 'granted' });
  a.setOptions({ players: 4 });
  const b = { flipperLeft: 'KeyA', flipperRight: 'KeyL', plunger: 'Space', nudgeLeft: 'KeyQ', nudgeRight: 'KeyP', nudgeBottom: 'ArrowDown' };
  a.setBindings(b);
  a.setHighScores(SCORES);
  const c = createStore(backend);
  assert.deepEqual(c.getOptions(), { sounds: true, music: true, fullscreen: true, players: 4, camera: 'original', volume: 0.25, soundConsent: 'granted', cinematic: false, mouseLook: true });
  a.setOptions({ cinematic: true, mouseLook: false });
  assert.deepEqual([createStore(backend).getOptions().cinematic, createStore(backend).getOptions().mouseLook], [true, false]);
  assert.equal(sanitizeOptions({ cinematic: 'yes', mouseLook: 0 }).cinematic, false, 'only booleans are accepted');
  assert.equal(sanitizeOptions({ cinematic: 'yes', mouseLook: 0 }).mouseLook, true);
  assert.deepEqual(c.getBindings(), b);
  assert.deepEqual(c.getHighScores(), SCORES);
  assert.ok(backend._m.has(STORAGE_KEYS.options) && backend._m.has(STORAGE_KEYS.bindings) && backend._m.has(STORAGE_KEYS.highScores));
  c.setBindings(null);
  assert.equal(createStore(backend).getBindings(), null);
});

test('storage: invalid patches never poison the store; returned objects are copies', () => {
  const st = createStore(null);
  st.setOptions({ players: 2 });
  assert.equal(st.setOptions({ players: 7, camera: 'x', sounds: 1 }).players, 2);
  assert.equal(st.setOptions(null).players, 2);
  st.setBindings({ flipperLeft: 'KeyZ' });                  // incomplete: ignored
  assert.equal(st.getBindings(), null);
  st.setHighScores([{ name: 'a', score: 1 }]);              // wrong length: ignored
  assert.equal(st.getHighScores(), null);
  const o = st.getOptions();
  o.players = 4;
  assert.equal(st.getOptions().players, 2);
  assert.equal(sanitizeHighScores([...SCORES.slice(0, 4), { name: 'x'.repeat(40), score: 5 }])[4].name.length, 31);
  assert.equal(sanitizeBindings(null), null);
  assert.deepEqual(sanitizeOptions({ volume: -3 }).volume, 0);
});

test('storage: a failing write still reads back from memory; a storage getter that throws is survived', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
  const st = createStore(full);
  st.setOptions({ camera: 'orbit' });
  assert.equal(st.getOptions().camera, 'orbit');
  const evil = new Proxy({}, { get() { throw new Error('blocked'); } });
  const st2 = createStore(evil);
  assert.deepEqual(st2.getOptions(), DEFAULT_OPTIONS);
  st2.setOptions({ sounds: false });
  assert.equal(st2.getOptions().sounds, false);
});

// ------------------------------------------------------------------------------------------------------------------ drawDotText
const ops = (c, name) => c.ops.filter((o) => o[0] === name);
const dotsOf = (s) => [...s].reduce((n, ch) => n + (glyphFor(ch) || []).join('').split('#').length - 1, 0);

test('drawDotText: blank text draws nothing at all', () => {
  const c = createFakeCanvas(203, 394, { strict: true });
  const ctx = c.getContext('2d');
  for (const t of ['', null, undefined, '   ', '\n\n']) assert.equal(drawDotText(ctx, t, PANEL.fields.info, { cellW: 11, cellH: 22, cols: 15, rows: 2 }), 0);
  assert.equal(c.ops.length, 0);
});

test('drawDotText: one ellipse per lit dot and layer, only the allowed canvas API', () => {
  const c = createFakeCanvas(203, 394, { strict: true });          // strict: throws on anything outside CANVAS_API
  const ctx = c.getContext('2d');
  const n = drawDotText(ctx, 'Hi 5', PANEL.fields.info, { cellW: 11, cellH: 22, cols: 15, rows: 2 });
  assert.equal(n, dotsOf('Hi 5'));
  assert.equal(ops(c, 'ellipse').length, 3 * n);                   // shade + mid + highlight
  assert.equal(ops(c, 'fill').length, 3);
  assert.equal(ops(c, 'save').length, 1);
  assert.equal(ops(c, 'restore').length, 1);
  const fills = ops(c, 'set').filter((o) => o[1] === 'fillStyle').map((o) => o[2]);
  assert.deepEqual(fills, ['#282858', '#7858e8', '#98c8f8']);
});

test('drawDotText: deterministic, stays inside its rectangle, alignment moves the text', () => {
  const run = (text, opts) => {
    const c = createFakeCanvas(203, 394, { strict: true });
    drawDotText(c.getContext('2d'), text, PANEL.fields.score1, opts);
    return c;
  };
  const o = { cellW: 15, cellH: 22, cols: 9, rows: 1 };
  assert.equal(opsDigest(run('123', { ...o, align: 'right' })), opsDigest(run('123', { ...o, align: 'right' })));
  assert.notEqual(opsDigest(run('123', { ...o, align: 'right' })), opsDigest(run('123', { ...o, align: 'left' })));
  const f = PANEL.fields.score1;
  for (const align of ['left', 'right', 'center']) {
    const c = run('9', { ...o, align });
    for (const e of ops(c, 'ellipse')) {
      assert.ok(e[1] >= f.x && e[1] <= f.x + f.w, `x ${e[1]} (${align})`);
      assert.ok(e[2] >= f.y && e[2] <= f.y + f.h, `y ${e[2]} (${align})`);
    }
  }
  const xs = (align) => Math.min(...ops(run('9', { ...o, align }), 'ellipse').map((e) => e[1]));
  assert.ok(xs('right') > xs('center') && xs('center') > xs('left'));
  assert.ok(Math.abs(xs('right') - (f.x + 8 * 15)) < 15, 'right-aligned digit sits in the last cell');
});

test('drawDotText: wraps into the lattice and cuts rows beyond the box', () => {
  const c = createFakeCanvas(203, 394, { strict: true });
  const f = PANEL.fields.info;
  const n = drawDotText(c.getContext('2d'), 'Ready for Launch now more lines', f, { cellW: 11, cellH: 22, cols: 15, rows: 2 });
  assert.equal(n, dotsOf('Ready for') + dotsOf('Launch now more'));     // 'Launch now more' fits the 15 columns; the rest is cut
  const ys = ops(c, 'ellipse').map((e) => e[2]);
  assert.ok(Math.max(...ys) < f.y + 2 * 22 + 1);
});

// ------------------------------------------------------------------------------------------------------------------ panel
function makeView(over = {}) {
  return {
    revision: 1, phase: 'playing', demo: false, paused: false, tilted: false, debug: false, score: 0, player: 1, playerCount: 1, ballNumber: 1,
    info: '', mission: '', bumperLevels: { attack: 0, launch: 0 }, launchEnabled: true, highScoresEnabled: true, newGameEnabled: true, namePrompt: null,
    missionState: 0, extraBalls: 0, fuelLevel: 0, ...over,
  };
}

test('createPanel: static art once, dots only when view.revision changed', () => {
  const canvas = createFakeCanvas(203, 394, { strict: true });
  const art = createFakeCanvas(203, 394);
  const panel = createPanel({ canvas, art });
  assert.equal(ops(canvas, 'drawImage').length, 1, 'static art drawn at creation');
  const v = makeView({ score: 120, info: 'Player 1', mission: 'Ready for Launch' });
  const base = canvas.ops.length;
  assert.equal(panel.update(v), true);
  const afterFirst = canvas.ops.length;
  assert.ok(afterFirst > base);
  assert.equal(ops(canvas, 'drawImage').length, 2, 'art redrawn under the dots');
  assert.equal(panel.update(v), false);
  assert.equal(panel.update(v), false);
  assert.equal(canvas.ops.length, afterFirst, 'no canvas work while the revision is unchanged');
  v.revision = 2;
  v.score = 130;
  assert.equal(panel.update(v), true);
  assert.ok(canvas.ops.length > afterFirst);
  const digest = opsDigest(canvas);
  v.revision = 3;
  assert.equal(panel.update(v), true, 'a bumped revision repaints even if nothing visible changed');
  assert.notEqual(opsDigest(canvas), digest);
});

test('createPanel: draws exactly the dots of score, player, ball, info and mission', () => {
  const canvas = createFakeCanvas(203, 394, { strict: true });
  const panel = createPanel({ canvas, art: createFakeCanvas(203, 394) });
  const view = makeView({ score: 12345, player: 2, ballNumber: 3, info: 'Jackpot!\n5000', mission: 'Targets\nTo Go: 7' });
  canvas.ops.length = 0;
  panel.update(view);
  const expected = dotsOf('12345') + dotsOf('2') + dotsOf('3') + dotsOf('Jackpot!') + dotsOf('5000') + dotsOf('Targets') + dotsOf('To Go: 7');
  assert.equal(ops(canvas, 'ellipse').length, 3 * expected);
});

test('createPanel: blank rules (score < 0, idle player, ball 0, score above 1e9)', () => {
  const canvas = createFakeCanvas(203, 394, { strict: true });
  const panel = createPanel({ canvas, art: createFakeCanvas(203, 394) });
  const ellipses = (view) => { canvas.ops.length = 0; panel.repaint(view); return ops(canvas, 'ellipse').length / 3; };
  assert.equal(ellipses(makeView({ score: -1, player: 0, ballNumber: 0 })), 0);
  assert.equal(ellipses(makeView({ phase: 'idle', score: 5, player: 3, ballNumber: 0 })), dotsOf('5'));
  assert.equal(ellipses(makeView({ phase: 'playing', score: 5, player: 3, ballNumber: 0 })), dotsOf('5') + dotsOf('3'));
  assert.equal(ellipses(makeView({ score: 1000000001, player: 0, ballNumber: 0 })), 0);
  assert.equal(ellipses(makeView({ score: 999999999, player: 0, ballNumber: 0 })), dotsOf('999999999'));
});

test('createPanel: without art a plain bezel is drawn; without a canvas nothing throws', () => {
  const canvas = createFakeCanvas(10, 10, { strict: true });
  const panel = createPanel({ canvas });
  assert.equal(canvas.width, PANEL.rect.w);
  assert.equal(canvas.height, PANEL.rect.h);
  assert.ok(ops(canvas, 'fillRect').length >= 4);
  assert.equal(panel.update(makeView({ score: 1 })), true);
  const none = createPanel({ canvas: null, art: null });
  assert.equal(none.update(makeView()), true);
  assert.equal(none.update(makeView()), false);
  assert.equal(none.update(null), false);
});

test('panelAriaText: "Player N, ball B, score S. <info> <mission>"', () => {
  assert.equal(panelAriaText(makeView({ score: 1500, player: 2, ballNumber: 3, info: 'Skill Shot\n75000', mission: 'Shoot Launch Ramp' })),
    'Player 2, ball 3, score 1500. Skill Shot 75000 Shoot Launch Ramp');
  assert.equal(panelAriaText(makeView({ phase: 'idle', score: -1, ballNumber: 0 })), '');
  assert.equal(panelAriaText(makeView({ score: 0 })), 'Player 1, ball 1, score 0.');
  const canvas = createFakeCanvas(203, 394, { strict: true });
  const panel = createPanel({ canvas, art: createFakeCanvas(203, 394) });
  panel.update(makeView({ score: 7, info: 'TILT!' }));
  assert.equal(panel.lastAria(), 'Player 1, ball 1, score 7. TILT!');
});

test('PANEL fields from the data barrel match the contract the panel relies on', () => {
  const f = PANEL.fields;
  assert.equal(f.score1.cells * f.score1.cellW, f.score1.w);
  assert.equal(f.info.cols * f.info.cellW, f.info.w);
  assert.equal(f.info.rows * f.info.cellH, f.info.h);
  assert.equal(f.mission.cols * f.mission.cellW, f.mission.w);
  assert.equal(f.mission.rows * f.mission.cellH, f.mission.h);
  assert.deepEqual([f.player1.w, f.player1.h, f.ball1.w, f.ball1.h], [15, 22, 15, 22]);
});
