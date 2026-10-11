/**
 * tests/ui_qa.test.mjs
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * Regression tests found by driving the UI in headless Chrome (QA pass): messages that lost their last line in the 15x2 / 15x4 text boxes,
 * the Sound dialog's volume slider that never reached the application, the Pause / Resume menu label while a menu is open, a click outside
 * a menu that also flicked the mouse flipper, the hi-dpi panel canvas, the touch hint on the start card, the help text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument, fire, findAll } from './ui_helpers/fake_dom.mjs';
import { createFakeCanvas } from './helpers/fake_canvas.mjs';
import { fitText, wrapText } from '../src/ui/textlayout.js';
import { drawDotText, glyphFor } from '../src/ui/dotfont.js';
import { createPanel, panelScaleFor, MAX_CONDENSED_COLS } from '../src/ui/panel.js';
import { createMenus } from '../src/ui/menus.js';
import { PAUSE_HINT, PAUSE_HINT_TOUCH } from '../src/ui/pause.js';
import { createUI } from '../src/ui/index.js';
import { createStore, DEFAULT_OPTIONS } from '../src/ui/storage.js';
import { helpSections } from '../src/ui/dialogs.js';
import { keyHintText, LEAD_TEXT, TOUCH_HINT_TEXT, CONSENT_TEXT } from '../src/ui/overlay.js';
import { DEFAULT_KEYS, PANEL } from '../src/data/constants.js';
import { INFO, MISSION_TEXT, fmt } from '../src/data/text.js';
import { MISSIONS, RANK_NAMES } from '../src/data/index.js';

const textOf = (e) => e.textContent;
const byId = (doc, id) => doc.getElementById(id);
const ops = (c, name) => c.ops.filter((o) => o[0] === name);
const dotsOf = (s) => [...s].reduce((n, ch) => n + (glyphFor(ch) || []).join('').split('#').length - 1, 0);

function recorder() {
  const calls = [];
  const actions = new Proxy({}, { get: (t, name) => (typeof name === 'string' ? (...args) => { calls.push([name, ...args]); } : undefined) });
  return { calls, actions };
}

function makeView(over = {}) {
  return {
    revision: 1, phase: 'playing', demo: false, paused: false, tilted: false, debug: false, score: 0, player: 1, playerCount: 1, ballNumber: 1,
    info: '', mission: '', bumperLevels: { attack: 0, launch: 0 }, launchEnabled: true, highScoresEnabled: true, newGameEnabled: true, namePrompt: null,
    missionState: 0, extraBalls: 0, fuelLevel: 0, ...over,
  };
}

function makePage(docOpts) {
  const doc = createFakeDocument(docOpts);
  const el = (tag, id, cls, parent, hidden = false) => {
    const e = doc.createElement(tag);
    e.id = id; e.className = cls; if (hidden) e.hidden = true;
    parent.appendChild(e);
    return e;
  };
  const app = el('div', 'app', 'app', doc.body);
  const menubar = el('nav', 'menubar', 'menubar', app);
  const stage = el('div', 'stage', 'stage', el('main', 'stage-wrap', 'stage-wrap', app));
  el('div', 'table-view', 'table-view', stage);
  const panel = el('aside', 'panel', 'panel', stage);
  const touch = el('div', 'touch-controls', 'touch-controls', stage, true);
  const start = el('div', 'start-overlay', 'overlay start-overlay', stage, true);
  el('div', 'status-line', 'status-line', stage);
  el('div', 'dialog-root', 'dialog-root', app);
  el('div', 'toast-root', 'toast-root', app);
  return { doc, app, menubar, stage, panel, touch, start };
}

// ------------------------------------------------------------------------------------------------------------------ text fitting
test('fitText: the normal 15-column layout wins whenever the message fits', () => {
  assert.deepEqual(fitText('Ready for Launch', 15, 4, 22), { lines: ['Ready for', 'Launch'], cols: 15 });
  assert.deepEqual(fitText('Ready for Launch', 15, 2, 22), { lines: ['Ready for', 'Launch'], cols: 15 }, 'two lines in a two-row box: no condensing');
  assert.deepEqual(fitText('Skill Shot\n75000', 15, 2, 22), { lines: ['Skill Shot', '75000'], cols: 15 });
  assert.deepEqual(fitText('', 15, 2, 22), { lines: [], cols: 15 });
  assert.deepEqual(fitText('Extra Ball Lit\n250000', 15, 2), { lines: wrapText('Extra Ball Lit\n250000', 15, 2), cols: 15 }, 'no maxCols: never condensed');
});

test('fitText: a message that would lose its last line is condensed to the narrowest sufficient column count', () => {
  const r = fitText('Extra Ball Is Lit\n250000', 15, 2, 22);
  assert.deepEqual(r, { lines: ['Extra Ball Is Lit', '250000'], cols: 17 });
  assert.deepEqual(fitText('Reflex Shot Bonus\n1000000', 15, 2, 22), { lines: ['Reflex Shot Bonus', '1000000'], cols: 17 });
  assert.deepEqual(fitText('Launch Ramp Starts Satellite Retrieval Mission', 15, 4, 22).lines,
    ['Launch Ramp', 'Starts Satellite', 'Retrieval', 'Mission']);
  // nothing helps: the usual cut at the usual width
  const hopeless = fitText('one two three four five six seven eight nine ten eleven twelve', 15, 2, 22);
  assert.equal(hopeless.cols, 15);
  assert.equal(hopeless.lines.length, 2);
  assert.deepEqual(hopeless.lines, wrapText('one two three four five six seven eight nine ten eleven twelve', 15, 2));
  // unlimited rows or a bad maxCols never condense
  assert.equal(fitText('a b c', 15, Infinity, 22).cols, 15);
  assert.equal(fitText('Extra Ball Lit\n250000', 15, 2, 10).cols, 15);
});

test('every info and mission message of SPEC 5.11 shows completely in its panel box (no cut-off number or word)', () => {
  const ranks = RANK_NAMES;
  const missionNames = Object.values(MISSIONS).map((m) => m.name);
  const flat = (o) => Object.values(o).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const cases = [];
  for (const tpl of flat(INFO)) for (const n of [5, 250000, 1234567, 999999999]) cases.push([tpl, n, 'Player']);
  for (const tpl of flat(MISSION_TEXT)) {
    if (/%s/.test(tpl)) for (const name of [...ranks, ...missionNames]) cases.push([tpl, 1234567, name]);
    else for (const n of [5, 1750000, 999999999]) cases.push([tpl, n, '']);
  }
  const F = PANEL.fields;
  const bad = [];
  for (const [tpl, n, s] of cases) {
    const text = /%s/.test(tpl) ? fmt(tpl, s, n) : fmt(tpl, n, n);
    for (const [box, f] of [['info', F.info], ['mission', F.mission]]) {
      const isInfo = flat(INFO).includes(tpl);
      if (isInfo !== (box === 'info')) continue;
      const fit = fitText(text, f.cols, f.rows, MAX_CONDENSED_COLS);
      const full = wrapText(text, fit.cols);
      if (full.length > f.rows || fit.lines.length !== full.length) bad.push(`${box}: ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(cases.length > 100);
});

test('drawDotText with maxCols: a condensed message keeps its last line, inside the box, with narrower cells', () => {
  const f = PANEL.fields.info;
  const run = (text, extra = {}) => {
    const c = createFakeCanvas(203, 394, { strict: true });
    const n = drawDotText(c.getContext('2d'), text, f, { cellW: 11, cellH: 22, cols: 15, rows: 2, ...extra });
    return { c, n };
  };
  const msg = 'Extra Ball Is Lit\n250000';
  const plain = run(msg);
  assert.equal(plain.n, dotsOf('Extra Ball Is') + dotsOf('Lit'), 'without maxCols the third line is cut (old behaviour)');
  const fit = run(msg, { maxCols: 22 });
  assert.equal(fit.n, dotsOf('Extra Ball Is Lit') + dotsOf('250000'));
  const xs = ops(fit.c, 'ellipse').map((e) => e[1]);
  const ys = ops(fit.c, 'ellipse').map((e) => e[2]);
  assert.ok(Math.min(...xs) >= f.x && Math.max(...xs) <= f.x + f.w, 'inside the box horizontally');
  assert.ok(Math.min(...ys) >= f.y && Math.max(...ys) <= f.y + f.h, 'inside the box vertically');
  // a message that already fits is drawn exactly as before
  const same = (a, b) => JSON.stringify(a.c.ops) === JSON.stringify(b.c.ops);
  assert.ok(same(run('Skill Shot\n75000'), run('Skill Shot\n75000', { maxCols: 22 })));
});

// ------------------------------------------------------------------------------------------------------------------ hi-dpi panel
test('panelScaleFor: integer 1..4 from the CSS width and the device pixel ratio', () => {
  assert.equal(panelScaleFor(203, 1), 1);
  assert.equal(panelScaleFor(163, 1), 1);
  assert.equal(panelScaleFor(377, 1), 2);
  assert.equal(panelScaleFor(163, 3), 3);
  assert.equal(panelScaleFor(500, 2), 4);
  assert.equal(panelScaleFor(5000, 3), 4, 'capped');
  assert.equal(panelScaleFor(0, 2), 1);
  assert.equal(panelScaleFor(NaN, NaN), 1);
  assert.equal(panelScaleFor(300, 0), 2, 'a missing dpr counts as 1');
});

test('createPanel.setScale: bigger backing store, art stretched, dots drawn through ctx.scale, repainted at once', () => {
  const canvas = createFakeCanvas(203, 394, { strict: true });
  const art = createFakeCanvas(203, 394);
  const panel = createPanel({ canvas, art });
  assert.equal(panel.getScale(), 1);
  assert.equal(panel.setScale(1), false);
  const view = makeView({ score: 120, info: 'Player 1' });
  panel.update(view);
  assert.equal(ops(canvas, 'scale').length, 0, 'scale 1 uses no transform at all');
  canvas.ops.length = 0;
  assert.equal(panel.setScale(2), true);
  assert.equal(canvas.width, 406);
  assert.equal(canvas.height, 788);
  assert.deepEqual(ops(canvas, 'drawImage')[0].slice(2), [0, 0, 406, 788], 'the static art is stretched to the new size');
  assert.deepEqual(ops(canvas, 'scale').map((o) => o.slice(1)), [[2, 2]], 'the dots are drawn in logical px at the full resolution');
  assert.ok(ops(canvas, 'ellipse').length > 0, 'the last view is repainted right away (resizing clears a canvas)');
  assert.equal(panel.update(view), false, 'and the revision bookkeeping is intact');
  assert.equal(panel.setScale(2.4), false);
  assert.equal(panel.setScale(99), true);
  assert.equal(panel.getScale(), 4);
  assert.equal(canvas.width, 812);
  assert.equal(panel.setScale('x'), true, 'garbage falls back to 1');
  assert.equal(panel.getScale(), 1);
  assert.equal(canvas.width, 203);
  // before any view only the art is (re)painted
  const c2 = createFakeCanvas(203, 394, { strict: true });
  const p2 = createPanel({ canvas: c2, art: createFakeCanvas(203, 394), scale: 3 });
  assert.equal(c2.width, 609);
  c2.ops.length = 0;
  p2.setScale(1);
  assert.equal(ops(c2, 'ellipse').length, 0);
  assert.equal(ops(c2, 'drawImage').length, 1);
  // the fallback bezel scales too
  const c3 = createFakeCanvas(10, 10, { strict: true });
  createPanel({ canvas: c3, scale: 2 });
  assert.equal(c3.width, 406);
  assert.deepEqual(ops(c3, 'scale').map((o) => o.slice(1)), [[2, 2]]);
});

test('createUI: the panel canvas follows its on-screen size (ResizeObserver) and the device pixel ratio', () => {
  const page = makePage();
  const canvas = page.doc.createElement('canvas');
  canvas.id = 'panel-canvas';
  let width = 203;
  canvas.getBoundingClientRect = () => ({ width, height: width * 394 / 203 });
  page.panel.appendChild(canvas);
  const observers = [];
  page.doc.defaultView.devicePixelRatio = 1;
  page.doc.defaultView.ResizeObserver = class { constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
  const ui = createUI({ root: page.app, doc: page.doc, store: createStore(null), actions: {}, panelArt: page.doc.createElement('canvas'), options: DEFAULT_OPTIONS, bindings: DEFAULT_KEYS });
  assert.equal(canvas.width, 203, 'a small panel keeps the logical resolution');
  ui.update(makeView({ score: 5 }), 0.016);
  width = 377;
  observers[0].cb();
  assert.equal(canvas.width, 406);
  assert.equal(canvas.height, 788);
  page.doc.defaultView.devicePixelRatio = 2;
  observers[0].cb();
  assert.equal(canvas.width, 812);
  width = 0;                                                    // hidden: keep what we have
  observers[0].cb();
  assert.equal(canvas.width, 812);
  ui.dispose();
  assert.equal(observers[0].disconnected, true);
});

// ------------------------------------------------------------------------------------------------------------------ menus
function makeMenus(view) {
  const page = makePage();
  const rec = recorder();
  const opens = [];
  const menus = createMenus({ root: page.menubar, doc: page.doc, actions: rec.actions, options: { ...DEFAULT_OPTIONS }, onOpenChange: (o) => opens.push(o) });
  if (view) menus.update(view);
  const item = (cmd) => menus.elements.items.find((b) => b.getAttribute('data-cmd') === cmd);
  const label = () => item('pause').children[0].textContent;
  return { page, rec, menus, item, label, opens, doc: page.doc };
}

test('menus: the Pause item keeps its label while a menu is open (the menu itself pauses the game)', () => {
  const { menus, label, item } = makeMenus(makeView());
  assert.equal(label(), 'Pause Game');
  fire(menus.elements.titles[0], 'click');                        // the application now pauses because a menu is open ...
  menus.update(makeView({ paused: true }));                       // ... and the rules report it
  assert.equal(label(), 'Pause Game', 'not "Resume Game": picking it would leave the game paused');
  menus.update(makeView({ paused: true, revision: 3 }));
  assert.equal(label(), 'Pause Game');
  fire(menus.elements.titles[1], 'pointerenter', { bubbles: false, pointerType: 'mouse' });   // hover to another menu keeps the frozen state
  assert.equal(label(), 'Pause Game');
  item('newGame');                                                // (sanity: the items exist)
  menus.closeAll();
  assert.equal(label(), 'Resume Game', 'back to the real state (still paused until the application resumes)');
  menus.update(makeView({ paused: false }));
  assert.equal(label(), 'Pause Game');
});

test('menus: a deliberate pause is still labelled Resume Game when a menu is opened', () => {
  const { menus, label } = makeMenus(makeView({ paused: true }));
  assert.equal(label(), 'Resume Game');
  fire(menus.elements.titles[0], 'click');
  menus.update(makeView({ paused: true, revision: 2 }));
  assert.equal(label(), 'Resume Game');
  menus.closeAll();
  menus.update(makeView({ paused: false, revision: 3 }));
  assert.equal(label(), 'Pause Game');
});

test('menus: a click outside an open menu only dismisses it (pointerdown is consumed so the table flipper does not fire)', () => {
  const { menus, page, doc } = makeMenus(makeView());
  const outside = doc.createElement('div');
  page.stage.appendChild(outside);
  const seenByTable = [];
  outside.addEventListener('pointerdown', () => seenByTable.push('pointerdown'));
  fire(menus.elements.titles[0], 'click');
  const ev = fire(outside, 'pointerdown', { pointerType: 'mouse' });
  assert.equal(menus.isOpen(), false);
  assert.equal(ev.defaultPrevented, true, 'cancelled pointerdown suppresses the compatibility mouse events');
  assert.deepEqual(seenByTable, [], 'and never reaches the table / touch handlers');
  // not consumed when no menu was open, nor for form controls
  const ev2 = fire(outside, 'pointerdown', { pointerType: 'mouse' });
  assert.equal(ev2.defaultPrevented, false);
  assert.deepEqual(seenByTable, ['pointerdown']);
  const select = doc.createElement('select');
  page.stage.appendChild(select);
  fire(menus.elements.titles[0], 'click');
  const ev3 = fire(select, 'pointerdown', { pointerType: 'mouse' });
  assert.equal(menus.isOpen(), false);
  assert.equal(ev3.defaultPrevented, false, 'a select / input keeps its normal behaviour');
  // clicks inside the bar are untouched
  fire(menus.elements.titles[0], 'click');
  const ev4 = fire(menus.elements.titles[1], 'pointerdown', { pointerType: 'mouse' });
  assert.equal(ev4.defaultPrevented, false);
  assert.equal(menus.isOpen(), true);
});

// ------------------------------------------------------------------------------------------------------------------ facade
function makeUI(extra = {}) {
  const page = makePage(extra.docOpts);
  const rec = recorder();
  const ui = createUI({
    root: page.app, doc: page.doc, store: createStore(null), actions: rec.actions, panelArt: page.doc.createElement('canvas'),
    options: { ...DEFAULT_OPTIONS }, bindings: { ...DEFAULT_KEYS }, ...extra.opts,
  });
  return { page, rec, ui, doc: page.doc };
}

test('createUI: the Sound dialog volume slider reaches actions.setVolume (0..1) - it was swallowed before', () => {
  const { ui, rec, doc } = makeUI();
  ui.showSound();
  const slider = byId(doc, 'sound-dlg-volume');
  slider.value = '30';
  fire(slider, 'input');
  assert.deepEqual(rec.calls, [['setVolume', 0.3]]);
  slider.value = '250';
  fire(slider, 'input');
  assert.deepEqual(rec.calls.at(-1), ['setVolume', 1], 'clamped');
  assert.equal(textOf(findAll(byId(doc, 'dlg-sound'), (e) => e.className === 'sound-volume-text')[0]), '250%');
});

test('createUI: no pause veil while a menu is open (that pause is only the menu\'s), it comes back for a real pause', () => {
  const { ui, page, doc } = makeUI();
  const veil = byId(doc, 'pause-overlay');
  const title = page.menubar.querySelector('.menu-title');
  ui.update(makeView({ paused: false }), 0.016);
  fire(title, 'click');
  ui.update(makeView({ paused: true, revision: 2 }), 0.016);        // the application paused because of the open menu
  assert.equal(veil.hidden, true);
  fire(title, 'click');                                              // menu closed, game still paused (explicit pause)
  ui.update(makeView({ paused: true, revision: 2 }), 0.016);
  assert.equal(veil.hidden, false);
  ui.update(makeView({ paused: false, revision: 3 }), 0.016);
  assert.equal(veil.hidden, true);
});

test('start card: lead copy, exact consent line, touch hint instead of keyboard keys on touch screens', () => {
  const kb = makeUI();
  assert.equal(textOf(findAll(kb.page.start, (e) => e.className === 'start-lead')[0]), LEAD_TEXT);
  assert.match(LEAD_TEXT, /only downloaded if you choose "Start with original sounds"/);
  assert.equal(textOf(byId(kb.doc, 'start-consent')), CONSENT_TEXT);
  assert.match(textOf(byId(kb.doc, 'start-keys')), /Flippers: Z \(left\)/);
  const touch = makeUI({ docOpts: { coarse: true } });
  assert.equal(textOf(byId(touch.doc, 'start-keys')), TOUCH_HINT_TEXT);
  assert.equal(textOf(byId(touch.doc, 'start-consent')), CONSENT_TEXT, 'the consent line is never touched');
  touch.ui.showControls({ ...DEFAULT_KEYS, flipperLeft: 'KeyA' });             // rebinding keys does not bring the keyboard hint back on a phone
  assert.equal(textOf(byId(touch.doc, 'start-keys')), TOUCH_HINT_TEXT);
  assert.equal(keyHintText(DEFAULT_KEYS, true), TOUCH_HINT_TEXT);
  assert.match(keyHintText(DEFAULT_KEYS), /Plunger: Space/);
});

test('pause veil: the hint mentions F3 on a keyboard and the Resume button on a touch screen', () => {
  assert.equal(textOf(byId(makeUI().doc, 'pause-hint')), PAUSE_HINT);
  assert.match(PAUSE_HINT, /F3/);
  assert.equal(textOf(byId(makeUI({ docOpts: { coarse: true } }).doc, 'pause-hint')), PAUSE_HINT_TOUCH);
  assert.ok(!/F3/.test(PAUSE_HINT_TOUCH));
});

test('help text: mouse and touch controls are described, cheats still are not', () => {
  const text = helpSections({ ...DEFAULT_KEYS }).map((s) => `${s.heading}: ${s.lines.join(' ')}`).join('\n');
  assert.match(text, /Mouse over the table: left button = left flipper, right button = right flipper, middle button = plunger/);
  assert.match(text, /Touch screens: .*on-screen buttons around the table/);
  assert.ok(!/below the table/.test(text));
  assert.ok(!/gmax|rmax|1max|bmax|hidden test|easy mode|cheat/i.test(text));
});
