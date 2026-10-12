/**
 * tests/ui_dom.test.mjs
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * The DOM-building UI modules (menus, start overlay, dialogs, toasts, touch controls, pause veil and the createUI facade) exercised in Node
 * against the small DOM double of tests/ui_helpers/fake_dom.mjs. Real-browser checks (layout, screenshots) are the INTEGRATOR's job (13.3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument, fire, findAll } from './ui_helpers/fake_dom.mjs';
import { createMenus, computeMenuState, MENU_MODEL, stateKey } from '../src/ui/menus.js';
import { createStartOverlay, CONSENT_TEXT } from '../src/ui/overlay.js';
import { createDialogs, assignBinding, RESERVED_KEYS, helpSections, normalizeEntries } from '../src/ui/dialogs.js';
import { createToasts } from '../src/ui/toast.js';
import { createTouchControls, wantsTouchControls, TOUCH_BUTTONS } from '../src/ui/touch.js';
import { createPauseOverlay } from '../src/ui/pause.js';
import { createFilePicker } from '../src/ui/filepicker.js';
import { createUI } from '../src/ui/index.js';
import { createStore, DEFAULT_OPTIONS } from '../src/ui/storage.js';
import { DEFAULT_KEYS } from '../src/data/constants.js';
import { APP_TITLE } from '../src/data/text.js';
import { h } from '../src/ui/dom.js';

// ------------------------------------------------------------------------------------------------------------------ helpers
/** Records every UIActions call as [name, ...args]. */
function recorder() {
  const calls = [];
  const actions = new Proxy({}, { get: (t, name) => (typeof name === 'string' ? (...args) => { calls.push([name, ...args]); } : undefined) });
  return { calls, actions, names: () => calls.map((c) => c[0]) };
}

function makeView(over = {}) {
  return {
    revision: 1, phase: 'playing', demo: false, paused: false, tilted: false, debug: false, score: 0, player: 1, playerCount: 1, ballNumber: 1,
    info: '', mission: '', bumperLevels: { attack: 0, launch: 0 }, launchEnabled: true, highScoresEnabled: true, newGameEnabled: true, namePrompt: null,
    missionState: 0, extraBalls: 0, fuelLevel: 0, ...over,
  };
}

/** The mount points of index.html (Appendix B) in a fake document. */
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
  const wrap = el('main', 'stage-wrap', 'stage-wrap', app);
  const stage = el('div', 'stage', 'stage', wrap);
  el('div', 'table-view', 'table-view', stage);
  const panel = el('aside', 'panel', 'panel', stage);
  const touch = el('div', 'touch-controls', 'touch-controls', stage, true);
  const start = el('div', 'start-overlay', 'overlay start-overlay', stage, true);
  const status = el('div', 'status-line', 'status-line', stage);
  const dialogRoot = el('div', 'dialog-root', 'dialog-root', app);
  const toastRoot = el('div', 'toast-root', 'toast-root', app);
  return { doc, app, menubar, stage, panel, touch, start, status, dialogRoot, toastRoot };
}

const textOf = (e) => e.textContent;
const byId = (doc, id) => doc.getElementById(id);

// ------------------------------------------------------------------------------------------------------------------ menus
function makeMenus(extra = {}) {
  const page = makePage();
  const rec = recorder();
  const local = { sound: () => rec.calls.push(['local', 'sound']), controls: () => rec.calls.push(['local', 'controls']), help: () => rec.calls.push(['local', 'help']), about: () => rec.calls.push(['local', 'about']) };
  const picker = { pickFolder: () => rec.calls.push(['picker', 'folder']), pickFiles: () => rec.calls.push(['picker', 'files']) };
  const opens = [];
  const menus = createMenus({
    root: page.menubar, doc: page.doc, actions: rec.actions, local, picker, options: { ...DEFAULT_OPTIONS }, onOpenChange: (o) => opens.push(o), ...extra,
  });
  const item = (cmd, value) => menus.elements.items.find((b) => b.getAttribute('data-cmd') === cmd && (value === undefined || b.getAttribute('data-value') === value));
  return { page, rec, menus, item, opens, doc: page.doc };
}

test('menus: structure follows ARCHITECTURE 8.2 (roles, data-cmd, shortcut hints)', () => {
  const { menus, item, page } = makeMenus();
  const bar = findAll(page.menubar, (e) => e.className === 'menu-bar')[0];
  assert.equal(bar.getAttribute('role'), 'menubar');
  assert.deepEqual(menus.elements.titles.map(textOf), ['Game', 'Options', 'Help']);
  for (const t of menus.elements.titles) { assert.equal(t.getAttribute('aria-haspopup'), 'true'); assert.equal(t.getAttribute('aria-expanded'), 'false'); }
  for (const l of menus.elements.lists) { assert.equal(l.getAttribute('role'), 'menu'); assert.equal(l.hidden, true); }
  const cmds = ['newGame', 'launchBall', 'pause', 'highScores', 'demo', 'exit', 'fullscreen', 'sounds', 'music', 'loadSounds', 'loadSoundsZip', 'controls', 'help', 'about'];
  for (const c of cmds) assert.ok(item(c), c);
  for (const n of ['1', '2', '3', '4']) assert.equal(item('players', n).getAttribute('role'), 'menuitemradio');
  for (const m of ['original', 'top', 'orbit']) assert.equal(item('camera', m).getAttribute('role'), 'menuitemradio');
  for (const c of ['demo', 'fullscreen', 'sounds', 'music']) assert.equal(item(c).getAttribute('role'), 'menuitemcheckbox', c);
  assert.ok(item('soundDialog'));
  assert.equal(item('newGame').getAttribute('role'), 'menuitem');
  const hint = (cmd) => findAll(item(cmd), (e) => e.tagName === 'KBD').map(textOf)[0];
  assert.equal(hint('newGame'), 'F2');
  assert.equal(hint('launchBall'), 'Enter');
  assert.equal(hint('pause'), 'F3');
  assert.equal(hint('fullscreen'), 'F4');
  assert.equal(hint('sounds'), 'F5');
  assert.equal(hint('music'), 'F6');
  assert.equal(hint('controls'), 'F8');
  assert.equal(hint('help'), 'F1');
  assert.equal(hint('camera') ?? findAll(item('camera', 'original'), (e) => e.tagName === 'KBD').map(textOf)[0], 'V');
  assert.equal(item('exit').textContent, 'Exit');
  assert.equal(MENU_MODEL.length, 3);
});

test('menus: option- and view-derived state', () => {
  const { menus, item } = makeMenus();
  const disabled = (cmd) => item(cmd).disabled;
  assert.equal(disabled('newGame'), false);
  assert.equal(disabled('launchBall'), true);
  assert.equal(disabled('pause'), true);
  assert.equal(disabled('highScores'), true);
  assert.equal(item('sounds').getAttribute('aria-checked'), 'true');
  assert.equal(item('music').getAttribute('aria-checked'), 'false');
  assert.equal(item('players', '1').getAttribute('aria-checked'), 'true');
  assert.equal(item('camera', 'original').getAttribute('aria-checked'), 'true');
  menus.update(makeView());
  assert.equal(disabled('launchBall'), false);
  assert.equal(disabled('pause'), false);
  assert.equal(disabled('highScores'), false);
  assert.equal(item('pause').children[0].textContent, 'Pause Game');
  menus.update(makeView({ paused: true, demo: true, launchEnabled: false, highScoresEnabled: false }));
  assert.equal(item('pause').children[0].textContent, 'Resume Game');
  assert.equal(item('demo').getAttribute('aria-checked'), 'true');
  assert.equal(disabled('launchBall'), true);
  assert.equal(disabled('highScores'), true);
  menus.update(makeView({ phase: 'idle', launchEnabled: false, highScoresEnabled: false }));
  assert.equal(disabled('pause'), true);
  menus.setOptions({ ...DEFAULT_OPTIONS, sounds: false, music: true, fullscreen: true, players: 3, camera: 'orbit' });
  assert.equal(item('sounds').getAttribute('aria-checked'), 'false');
  assert.equal(item('music').getAttribute('aria-checked'), 'true');
  assert.equal(item('fullscreen').getAttribute('aria-checked'), 'true');
  assert.equal(item('players', '3').getAttribute('aria-checked'), 'true');
  assert.equal(item('players', '1').getAttribute('aria-checked'), 'false');
  assert.equal(item('camera', 'orbit').getAttribute('aria-checked'), 'true');
});

test('menus: computeMenuState is pure and covers every command', () => {
  const s = computeMenuState({ ...DEFAULT_OPTIONS }, makeView());
  for (const m of MENU_MODEL) for (const e of m.items) if (e.cmd) assert.ok(s[stateKey(e.cmd, e.value)], e.cmd);
  assert.deepEqual(computeMenuState(DEFAULT_OPTIONS, null).launchBall, { enabled: false });
  assert.equal(computeMenuState(DEFAULT_OPTIONS, makeView({ newGameEnabled: false })).newGame.enabled, false);
});

test('menus: click opens and closes, hover switches, Escape and outside click close', () => {
  const { menus, doc, opens, page } = makeMenus();
  const [game, options, help] = menus.elements.titles;
  const [gameList, optionsList] = menus.elements.lists;
  fire(game, 'click');
  assert.equal(gameList.hidden, false);
  assert.equal(game.getAttribute('aria-expanded'), 'true');
  assert.equal(menus.isOpen(), true);
  fire(options, 'pointerenter', { bubbles: false, pointerType: 'mouse' });
  assert.equal(gameList.hidden, true);
  assert.equal(optionsList.hidden, false);
  fire(options, 'click');
  assert.equal(menus.isOpen(), false);
  fire(help, 'pointerenter', { bubbles: false, pointerType: 'mouse' });
  assert.equal(menus.isOpen(), false, 'hover alone never opens a menu');
  fire(game, 'click');
  const outside = doc.createElement('div'); page.stage.appendChild(outside);
  fire(outside, 'pointerdown');
  assert.equal(menus.isOpen(), false);
  fire(game, 'click');
  game.focus();
  fire(game, 'keydown', { key: 'Escape' });
  assert.equal(menus.isOpen(), false);
  assert.deepEqual(opens, [true, false, true, false, true, false], 'onOpenChange fires only when the bar goes from closed to open and back');
});

test('menus: items run their command through the UIActions and close the menu', () => {
  const { menus, item, rec } = makeMenus();
  menus.update(makeView());
  const [game, options, help] = menus.elements.titles;
  const click = (title, cmd, value) => { fire(title, 'click'); item(cmd, value).click(); };
  click(game, 'newGame');
  click(game, 'launchBall');
  click(game, 'pause');
  click(game, 'highScores');
  click(game, 'demo');
  click(game, 'exit');
  click(options, 'fullscreen');
  click(options, 'players', '3');
  click(options, 'sounds');
  click(options, 'music');
  click(options, 'camera', 'top');
  click(options, 'loadSounds');
  click(options, 'loadSoundsZip');
  click(options, 'soundDialog');
  click(options, 'controls');
  click(help, 'help');
  click(help, 'about');
  assert.deepEqual(rec.calls, [
    ['newGame'], ['launchBall'], ['togglePause'], ['showHighScores'], ['toggleDemo'], ['exit'], ['toggleFullscreen'], ['selectPlayers', 3],
    ['setSounds', false], ['setMusic', true], ['setCamera', 'top'], ['picker', 'folder'], ['picker', 'files'], ['local', 'sound'], ['local', 'controls'],
    ['local', 'help'], ['local', 'about'],
  ]);
  assert.equal(menus.isOpen(), false);
});

test('menus: disabled items do nothing', () => {
  const { menus, item, rec } = makeMenus();
  fire(menus.elements.titles[0], 'click');
  item('launchBall').click();
  fire(item('pause'), 'click');
  assert.deepEqual(rec.calls, []);
});

test('menus: keyboard navigation (arrows, Home/End, Enter) and handled keys do not reach the game shortcuts', () => {
  const { menus, item, rec, doc } = makeMenus();
  menus.update(makeView());
  const leaked = [];
  doc.addEventListener('keydown', (e) => leaked.push(e.key));
  const [game, options] = menus.elements.titles;
  game.focus();
  fire(game, 'keydown', { key: 'ArrowDown' });
  assert.equal(menus.isOpen(), true);
  assert.equal(doc.activeElement, item('newGame'));
  fire(doc.activeElement, 'keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, item('launchBall'));
  fire(doc.activeElement, 'keydown', { key: 'End' });
  assert.equal(doc.activeElement, item('exit'));
  fire(doc.activeElement, 'keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, item('newGame'), 'wraps');
  fire(doc.activeElement, 'keydown', { key: 'ArrowUp' });
  assert.equal(doc.activeElement, item('exit'));
  fire(doc.activeElement, 'keydown', { key: 'Home' });
  assert.equal(doc.activeElement, item('newGame'));
  fire(doc.activeElement, 'keydown', { key: 'ArrowRight' });
  assert.equal(menus.elements.lists[0].hidden, true);
  assert.equal(menus.elements.lists[1].hidden, false);
  assert.equal(doc.activeElement, item('fullscreen'));
  fire(doc.activeElement, 'keydown', { key: 'ArrowLeft' });
  assert.equal(doc.activeElement, item('newGame'));
  fire(doc.activeElement, 'keydown', { key: 'Enter' });
  assert.deepEqual(rec.calls, [['newGame']]);
  assert.equal(menus.isOpen(), false);
  assert.ok(!leaked.includes('Enter'), 'Enter on a menu item must not also reach the global Launch Ball shortcut');
  assert.ok(!leaked.includes('ArrowDown'));
  fire(options, 'keydown', { key: 'Enter' });
  assert.equal(menus.isOpen(), true);
  fire(doc.activeElement, 'keydown', { key: 'Escape' });
  assert.equal(menus.isOpen(), false);
  assert.ok(!menus.elements.bar.contains(doc.activeElement), 'Escape also leaves the bar so Space / Enter reach the game again');
});

test('menus: focus leaves the menu bar after activating an item (Space is the plunger)', () => {
  const { menus, item, doc } = makeMenus();
  fire(menus.elements.titles[0], 'click');
  menus.elements.titles[0].focus();
  item('newGame').focus();
  item('newGame').click();
  assert.notEqual(doc.activeElement, item('newGame'));
  assert.ok(!menus.elements.bar.contains(doc.activeElement));
});

// ------------------------------------------------------------------------------------------------------------------ start overlay
function makeOverlay(options = {}) {
  const page = makePage();
  const rec = recorder();
  const picker = { pickFolder: () => rec.calls.push(['picker', 'folder']), pickFiles: () => rec.calls.push(['picker', 'files']) };
  const overlay = createStartOverlay({ root: page.start, doc: page.doc, actions: rec.actions, picker, options: { ...DEFAULT_OPTIONS, ...options } });
  return { page, rec, overlay, doc: page.doc };
}

test('start overlay: frozen ids, exact consent line, title, hidden until shown', () => {
  const { doc, overlay, page } = makeOverlay();
  assert.equal(page.start.hidden, true);
  assert.equal(textOf(byId(doc, 'start-title')), APP_TITLE);
  assert.equal(textOf(byId(doc, 'start-consent')), 'Original game sounds are fetched from the Internet Archive; they are copyright Microsoft/Cinematronics and are not bundled.');
  assert.equal(CONSENT_TEXT, textOf(byId(doc, 'start-consent')));
  const sel = byId(doc, 'start-players');
  assert.equal(sel.tagName, 'SELECT');
  assert.deepEqual(sel.children.map((o) => o.getAttribute('value')), ['1', '2', '3', '4']);
  assert.equal(sel.value, '1');
  assert.equal(byId(doc, 'start-music').type, 'checkbox');
  assert.equal(byId(doc, 'start-music').checked, false);
  assert.match(textOf(byId(doc, 'start-music').parentNode), /Music \(off by default\)/);
  assert.equal(textOf(byId(doc, 'start-btn-sound')), 'Start with original sounds');
  assert.equal(textOf(byId(doc, 'start-btn-silent')), 'Start without sound');
  assert.equal(textOf(byId(doc, 'start-load-local')), 'Use my own Pinball folder / zip...');
  assert.ok(byId(doc, 'start-status'));
  overlay.show({ soundStatus: { state: 'idle', loaded: 0, total: 41, source: null, text: 'sound: not loaded' } });
  assert.equal(page.start.hidden, false);
  assert.equal(overlay.isShown(), true);
  assert.equal(textOf(byId(doc, 'start-status')), 'sound: not loaded');
  assert.equal(doc.activeElement, byId(doc, 'start-btn-sound'));
  overlay.hide();
  assert.equal(page.start.hidden, true);
});

test('start overlay: the start buttons call actions.start synchronously with the chosen settings', () => {
  const { doc, overlay, rec } = makeOverlay({ players: 2 });
  overlay.show({});
  assert.equal(byId(doc, 'start-players').value, '2');
  byId(doc, 'start-btn-sound').click();
  assert.deepEqual(rec.calls, [['start', { withSound: true, players: 2, music: false }]]);
  byId(doc, 'start-players').value = '4';
  byId(doc, 'start-music').checked = true;
  byId(doc, 'start-btn-sound').click();
  assert.deepEqual(rec.calls.at(-1), ['start', { withSound: true, players: 4, music: true }]);
  byId(doc, 'start-btn-silent').click();
  assert.deepEqual(rec.calls.at(-1), ['start', { withSound: false, players: 4, music: false }], 'silent never starts music');
  assert.equal(rec.calls.length, 3);
});

test('start overlay: loading local sounds does not start the game; consent decides the focus; status updates', () => {
  const { doc, overlay, rec } = makeOverlay();
  overlay.show({});
  byId(doc, 'start-load-local').click();
  byId(doc, 'start-load-zip').click();
  assert.deepEqual(rec.calls, [['picker', 'folder'], ['picker', 'files']]);
  assert.ok(!rec.names().includes('start'));
  overlay.setSoundStatus({ text: 'sound: loading 12/41...' });
  assert.equal(textOf(byId(doc, 'start-status')), 'sound: loading 12/41...');
  overlay.hide();
  overlay.setOptions({ ...DEFAULT_OPTIONS, soundConsent: 'denied' });
  overlay.show({});
  assert.equal(doc.activeElement, byId(doc, 'start-btn-silent'));
  overlay.setBindings({ ...DEFAULT_KEYS, flipperLeft: 'KeyA' });
  assert.match(textOf(byId(doc, 'start-keys')), /Flippers: A \(left\), \/ \(right\)/);
});

// ------------------------------------------------------------------------------------------------------------------ dialogs
function makeDialogs(extra = {}) {
  const page = makePage();
  const rec = recorder();
  const changes = [];
  const toasts = [];
  const bindingsSeen = [];
  const dialogs = createDialogs({
    root: page.dialogRoot, doc: page.doc, actions: rec.actions, onChange: (o) => changes.push(o), toast: (t) => toasts.push(t),
    getBindings: () => ({ ...DEFAULT_KEYS }), onBindings: (b) => bindingsSeen.push(b), ...extra,
  });
  return { page, rec, dialogs, changes, toasts, bindingsSeen, doc: page.doc };
}
const SCORES = [{ name: 'Ann', score: 900000 }, { name: 'Bob', score: 1234567 }, { name: '', score: -999 }, { name: '', score: -999 }, { name: '', score: -999 }];

test('dialogs: high scores table, focus, Escape, onChange only for 0 <-> 1', () => {
  const { dialogs, page, changes, doc } = makeDialogs();
  const opener = doc.createElement('button'); page.app.appendChild(opener); opener.focus();
  dialogs.showHighScores(SCORES, { clearable: false });
  const dlg = byId(doc, 'dlg-highscores');
  assert.equal(dlg.getAttribute('role'), 'dialog');
  assert.equal(dlg.getAttribute('aria-modal'), 'true');
  assert.equal(dlg.parentNode.parentNode, page.dialogRoot, 'the backdrop is a direct child of #dialog-root');
  assert.equal(textOf(findAll(dlg, (e) => e.className === 'dialog-title')[0]), 'High Scores');
  const rows = findAll(dlg, (e) => e.tagName === 'TR').slice(1);
  assert.equal(rows.length, 5);
  const cells = (r) => findAll(r, (e) => e.tagName === 'TD').map(textOf);
  assert.deepEqual(cells(rows[0]), ['1', 'Ann', '900,000']);
  assert.deepEqual(cells(rows[1]), ['2', 'Bob', '1,234,567']);
  assert.deepEqual(cells(rows[2]), ['3', '', '']);
  assert.deepEqual(findAll(dlg, (e) => e.tagName === 'TH').map(textOf), ['Rank', 'Name', 'Score']);
  assert.equal(byId(doc, 'hs-clear'), null, 'Clear only when clearable');
  assert.deepEqual(changes, [true]);
  assert.ok(dlg.contains(doc.activeElement), 'focus moved into the dialog');
  fire(doc.activeElement, 'keydown', { key: 'Escape' });
  assert.equal(dialogs.isOpen(), false);
  assert.deepEqual(changes, [true, false]);
  assert.equal(doc.activeElement, opener, 'focus returns to the previous element');
});

test('dialogs: Clear asks for confirmation, then clears via the action', () => {
  const { dialogs, rec, changes, doc, toasts } = makeDialogs();
  dialogs.showHighScores(SCORES, { clearable: true });
  byId(doc, 'hs-clear').click();
  const confirm = byId(doc, 'dlg-confirm');
  assert.ok(confirm);
  assert.equal(textOf(findAll(confirm, (e) => e.className === 'dialog-title')[0]), 'Confirm');
  assert.equal(textOf(findAll(confirm, (e) => e.className === 'dialog-text')[0]), 'Clear High Scores?');
  assert.equal(dialogs.count(), 2);
  assert.deepEqual(changes, [true], 'a second dialog does not fire onChange');
  const buttons = findAll(confirm, (e) => e.tagName === 'BUTTON');
  buttons.find((b) => b.textContent === 'Cancel').click();
  assert.equal(dialogs.topId(), 'dlg-highscores');
  assert.deepEqual(rec.calls, []);
  byId(doc, 'hs-clear').click();
  fire(byId(doc, 'dlg-confirm'), 'keydown', { key: 'Enter' });          // Enter = OK
  assert.deepEqual(rec.calls, [['clearHighScores']]);
  assert.equal(dialogs.topId(), 'dlg-highscores');
  const rows = findAll(byId(doc, 'dlg-highscores'), (e) => e.tagName === 'TR').slice(1);
  assert.deepEqual(findAll(rows[0], (e) => e.tagName === 'TD').map(textOf), ['1', '', '']);
  assert.deepEqual(toasts, ['High scores cleared']);
  fire(doc.activeElement, 'keydown', { key: 'Escape' });
  assert.deepEqual(changes, [true, false]);
});

test('dialogs: name entry - OK, Enter, empty -> default, 31 chars, Cancel and Esc', () => {
  const prompt = { player: 2, rank: 1, score: 123456, defaultName: 'Player 2' };
  const run = (act) => {
    const ctx = makeDialogs();
    ctx.dialogs.promptName(prompt);
    const dlg = byId(ctx.doc, 'dlg-name');
    const input = byId(ctx.doc, 'dlg-name-input');
    assert.equal(textOf(findAll(dlg, (e) => e.className === 'dialog-title')[0]), 'Player 2 - new high score #1');
    assert.equal(input.getAttribute('maxlength'), '31');
    assert.equal(input.value, 'Player 2');
    assert.equal(ctx.doc.activeElement, input);
    assert.equal(input.selected, true);
    act(ctx, input, dlg);
    return ctx;
  };
  const okBtn = (dlg) => findAll(dlg, (e) => e.tagName === 'BUTTON').find((b) => b.textContent === 'OK');
  const cancelBtn = (dlg) => findAll(dlg, (e) => e.tagName === 'BUTTON').find((b) => b.textContent === 'Cancel');
  let c = run((ctx, input, dlg) => okBtn(dlg).click());
  assert.deepEqual(c.rec.calls, [['submitName', 'Player 2']]);
  assert.equal(c.dialogs.isOpen(), false);
  c = run((ctx, input) => { input.value = '  Zed Prime  '; fire(input, 'keydown', { key: 'Enter' }); });
  assert.deepEqual(c.rec.calls, [['submitName', 'Zed Prime']]);
  c = run((ctx, input) => { input.value = '   '; fire(input, 'keydown', { key: 'Enter' }); });
  assert.deepEqual(c.rec.calls, [['submitName', 'Player 2']]);
  c = run((ctx, input) => { input.value = 'x'.repeat(50); fire(input, 'keydown', { key: 'Enter' }); });
  assert.equal(c.rec.calls[0][1].length, 31);
  c = run((ctx, input, dlg) => cancelBtn(dlg).click());
  assert.deepEqual(c.rec.calls, [['submitName', null]]);
  c = run((ctx, input) => fire(input, 'keydown', { key: 'Escape' }));
  assert.deepEqual(c.rec.calls, [['submitName', null]]);
  assert.deepEqual(c.changes, [true, false]);
  // a second promptName for the open dialog is ignored
  const d = makeDialogs();
  d.dialogs.promptName(prompt);
  d.dialogs.promptName(prompt);
  assert.equal(d.dialogs.count(), 1);
});

test('dialogs: keyboard events aimed at a dialog never reach the global shortcuts; Tab is trapped', () => {
  const { dialogs, doc, page } = makeDialogs();
  const outside = doc.createElement('button'); page.app.appendChild(outside);
  const leaked = [];
  doc.addEventListener('keydown', (e) => leaked.push(e.key));
  dialogs.showControls({ ...DEFAULT_KEYS });
  const dlg = byId(doc, 'dlg-controls');
  const focusables = findAll(dlg, (e) => e.tagName === 'BUTTON');
  const first = focusables[0];
  const last = focusables.at(-1);
  first.focus();
  fire(first, 'keydown', { key: 'KeyZ', code: 'KeyZ' });
  fire(first, 'keydown', { key: ' ', code: 'Space' });
  assert.deepEqual(leaked, []);
  const tab = fire(first, 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(doc.activeElement, last, 'Shift+Tab on the first control wraps to the last');
  fire(last, 'keydown', { key: 'Tab' });
  assert.equal(doc.activeElement, first, 'Tab on the last control wraps to the first');
  outside.focus();
  assert.ok(dlg.contains(doc.activeElement), 'focus cannot leave the modal dialog');
  fire(doc.body, 'keydown', { key: 'Tab' });
  assert.ok(dlg.contains(doc.activeElement));
});

test('dialogs: controls - pickers, rebinding, reserved keys, swap, Default, OK / Cancel', () => {
  const { dialogs, rec, doc, bindingsSeen, changes } = makeDialogs();
  dialogs.showControls({ ...DEFAULT_KEYS });
  const dlg = byId(doc, 'dlg-controls');
  assert.equal(textOf(findAll(dlg, (e) => e.className === 'dialog-title')[0]), 'Player Controls');
  assert.deepEqual(findAll(dlg, (e) => e.tagName === 'LEGEND').map(textOf), ['Control Options', 'Instructions']);
  const pickers = findAll(dlg, (e) => e.className.startsWith('key-picker'));
  assert.equal(pickers.length, 6);
  assert.deepEqual(findAll(dlg, (e) => e.className === 'controls-label').map(textOf),
    ['Left Flipper', 'Right Flipper', 'Plunger', 'Left Table Bump', 'Right Table Bump', 'Bottom Table Bump']);
  assert.deepEqual(pickers.map(textOf), ['Z', '/', 'Space', 'X', '.', 'Up Arrow']);
  const hint = byId(doc, 'controls-hint');
  const pick = (i) => pickers[i];

  pick(0).click();                                                  // arm "Left Flipper"
  assert.equal(textOf(pick(0)), 'Press a key...');
  const ev = fire(pick(0), 'keydown', { key: 'q', code: 'KeyQ' });
  assert.equal(ev.defaultPrevented, true);
  assert.equal(textOf(pick(0)), 'Q');
  assert.equal(doc.activeElement, pick(0));

  pick(1).click();                                                  // reserved shortcut key is refused and the picker stays armed
  fire(pick(1), 'keydown', { key: 'F2', code: 'F2' });
  assert.equal(textOf(pick(1)), 'Press a key...');
  assert.match(textOf(hint), /reserved/);
  fire(pick(1), 'keydown', { key: 'Escape', code: 'Escape' });      // Escape only cancels the pick
  assert.equal(textOf(pick(1)), '/');
  assert.equal(dialogs.isOpen(), true);

  pick(2).click();                                                  // plunger takes the key of "Right Table Bump" ('.') -> swap
  fire(pick(2), 'keydown', { key: '.', code: 'Period' });
  assert.equal(textOf(pick(2)), '.');
  assert.equal(textOf(pick(4)), 'Space');
  assert.match(textOf(hint), /Swapped with Right Table Bump/);

  pick(3).click();                                                  // a held key repeating is ignored while armed
  fire(pick(3), 'keydown', { key: 'a', code: 'KeyA', repeat: true });
  assert.equal(textOf(pick(3)), 'Press a key...');
  fire(pick(3), 'keydown', { key: 'a', code: 'KeyA' });
  assert.equal(textOf(pick(3)), 'A');

  byId(doc, 'controls-default').click();
  assert.deepEqual(pickers.map(textOf), ['Z', '/', 'Space', 'X', '.', 'Up Arrow']);

  pick(0).click();
  fire(pick(0), 'keydown', { key: 'a', code: 'KeyA' });
  findAll(dlg, (e) => e.tagName === 'BUTTON' && e.textContent === 'OK')[0].click();
  assert.equal(dialogs.isOpen(), false);
  assert.deepEqual(rec.calls, [['setBindings', { ...DEFAULT_KEYS, flipperLeft: 'KeyA' }]]);
  assert.deepEqual(bindingsSeen, [{ ...DEFAULT_KEYS, flipperLeft: 'KeyA' }]);
  assert.deepEqual(changes, [true, false]);

  rec.calls.length = 0;
  dialogs.showControls({ ...DEFAULT_KEYS });
  const dlg2 = byId(doc, 'dlg-controls');
  findAll(dlg2, (e) => e.className.startsWith('key-picker'))[0].click();
  fire(doc.body, 'keydown', { key: 'p', code: 'KeyP' });
  findAll(dlg2, (e) => e.tagName === 'BUTTON' && e.textContent === 'Cancel')[0].click();
  assert.deepEqual(rec.calls, [], 'Cancel changes nothing');
});

test('dialogs: assignBinding / RESERVED_KEYS / helpSections / normalizeEntries (pure)', () => {
  const b = { ...DEFAULT_KEYS };
  assert.deepEqual(assignBinding(b, 'flipperLeft', 'KeyQ'), { bindings: { ...b, flipperLeft: 'KeyQ' }, status: 'ok' });
  assert.equal(assignBinding(b, 'flipperLeft', 'KeyZ').status, 'same');
  const sw = assignBinding(b, 'flipperLeft', 'Slash');
  assert.equal(sw.status, 'swapped');
  assert.equal(sw.swappedWith, 'flipperRight');
  assert.equal(sw.bindings.flipperLeft, 'Slash');
  assert.equal(sw.bindings.flipperRight, 'KeyZ');
  for (const k of ['Escape', 'Enter', 'F2', 'F3', 'F4', 'F5', 'F6', 'F8', 'F1', 'KeyV']) {
    assert.ok(RESERVED_KEYS.includes(k), k);
    assert.equal(assignBinding(b, 'plunger', k).status, 'reserved');
  }
  assert.equal(assignBinding(b, 'bogus', 'KeyQ').status, 'invalid');
  assert.equal(assignBinding(b, 'plunger', '').status, 'invalid');
  assert.deepEqual(b, DEFAULT_KEYS, 'input is not mutated');
  const text = helpSections(b).map((s) => s.lines.join(' ')).join(' ');
  assert.match(text, /Left flipper: Z/);
  assert.ok(!/gmax|rmax|1max|bmax|hidden test|easy mode|cheat/i.test(text), 'cheats are not listed');
  assert.equal(normalizeEntries([{ name: 'a', score: 5 }]).length, 5);
  assert.deepEqual(normalizeEntries(null)[4], { name: '', score: -999 });
});

test('dialogs: sound dialog - live status, progress, volume, load buttons', () => {
  const rec = recorder();
  const picks = [];
  let status = { state: 'idle', loaded: 0, total: 41, source: null, text: 'sound: not loaded' };
  const { dialogs, doc, changes } = makeDialogs({
    actions: rec.actions, picker: { pickFolder: () => picks.push('folder'), pickFiles: () => picks.push('files') },
    getOptions: () => ({ ...DEFAULT_OPTIONS, volume: 0.5 }), getSoundStatus: () => status,
  });
  dialogs.showSound();
  const dlg = byId(doc, 'dlg-sound');
  assert.equal(textOf(findAll(dlg, (e) => e.className === 'dialog-title')[0]), 'Sound');
  assert.equal(textOf(byId(doc, 'sound-dlg-status')), 'sound: not loaded');
  assert.equal(byId(doc, 'sound-dlg-progress').hidden, true);
  assert.equal(byId(doc, 'sound-dlg-volume').value, '50');
  assert.match(dlg.textContent, /Internet Archive/);
  dialogs.updateSound({ state: 'loading', loaded: 12, total: 41, source: 'S1', text: 'sound: loading 12/41...' });
  assert.equal(textOf(byId(doc, 'sound-dlg-status')), 'sound: loading 12/41...');
  assert.equal(byId(doc, 'sound-dlg-progress').hidden, false);
  assert.equal(Number(byId(doc, 'sound-dlg-progress').max), 41);
  assert.equal(Number(byId(doc, 'sound-dlg-progress').value), 12);
  dialogs.updateSound({ state: 'ready', loaded: 41, total: 41, source: 'S1', text: 'sound: original (Internet Archive)' });
  assert.equal(byId(doc, 'sound-dlg-progress').hidden, true);
  assert.equal(textOf(byId(doc, 'sound-dlg-status')), 'sound: original (Internet Archive)');
  const vol = byId(doc, 'sound-dlg-volume');
  vol.value = '25';
  fire(vol, 'input', {});
  assert.deepEqual(rec.calls, [['setVolume', 0.25]]);
  byId(doc, 'sound-dlg-folder').click();
  byId(doc, 'sound-dlg-zip').click();
  assert.deepEqual(picks, ['folder', 'files']);
  assert.ok(!rec.names().includes('start'), 'loading files never starts a game');
  assert.equal(dialogs.isOpen(), true);
  findAll(dlg, (e) => e.tagName === 'BUTTON' && e.textContent === 'Close')[0].click();
  assert.equal(dialogs.isOpen(), false);
  dialogs.updateSound(status);                                       // closed: no-op, no throw
  assert.deepEqual(changes, [true, false]);
});

test('dialogs: about and help, replacement, closeAll is silent', () => {
  const { dialogs, rec, doc, changes } = makeDialogs();
  dialogs.showAbout();
  const about = byId(doc, 'dlg-about');
  assert.match(about.textContent, /unofficial/);
  assert.match(about.textContent, /Microsoft, Cinematronics or Maxis/);
  assert.match(about.textContent, /sound files are not included/);
  findAll(about, (e) => e.tagName === 'BUTTON')[0].click();
  assert.equal(dialogs.isOpen(), false);
  dialogs.showHelp();
  assert.match(byId(doc, 'dlg-help').textContent, /plunger/i);
  dialogs.showHelp();
  assert.equal(dialogs.count(), 1, 're-opening replaces');
  assert.deepEqual(changes, [true, false, true]);
  dialogs.promptName({ player: 1, rank: 1, score: 5, defaultName: 'Player 1' });
  dialogs.closeAll();
  assert.equal(dialogs.isOpen(), false);
  assert.deepEqual(changes, [true, false, true, false]);
  assert.deepEqual(rec.calls, [], 'closeAll never calls an action (no submitName)');
});

// ------------------------------------------------------------------------------------------------------------------ toasts, touch, pause, picker
test('toasts: timed by tick(dt), repeats refresh, at most three, empty ignored', () => {
  const page = makePage();
  const toasts = createToasts({ root: page.toastRoot, doc: page.doc });
  toasts.show('hello', 1000);
  assert.equal(toasts.count(), 1);
  assert.equal(page.toastRoot.children[0].getAttribute('role'), 'status');
  assert.equal(textOf(page.toastRoot.children[0]), 'hello');
  toasts.tick(0.5);
  assert.equal(toasts.count(), 1);
  toasts.show('hello', 1000);                                      // refresh: 1.0 s left again
  toasts.tick(0.5);
  assert.ok(!page.toastRoot.children[0].className.includes('toast-out'));
  toasts.tick(0.2);
  assert.equal(toasts.count(), 1);
  assert.ok(page.toastRoot.children[0].className.includes('toast-out'), 'fades during the last 0.35 s');
  toasts.tick(0.4);
  assert.equal(toasts.count(), 0);
  assert.equal(page.toastRoot.children.length, 0);
  toasts.show('');
  toasts.show(null);
  assert.equal(toasts.count(), 0);
  toasts.show('default');
  toasts.tick(2.4);
  assert.equal(toasts.count(), 1, 'default duration is 2.5 s');
  toasts.tick(0.2);
  assert.equal(toasts.count(), 0);
  for (const t of ['a', 'b', 'c', 'd']) toasts.show(t, 5000);
  assert.deepEqual(page.toastRoot.children.map(textOf), ['b', 'c', 'd']);
  toasts.clear();
  assert.equal(toasts.count(), 0);
});

test('touch controls: buttons, data attributes, visible only on coarse pointers or ?touch=1', () => {
  const build = (docOpts) => {
    const page = makePage(docOpts);
    const touch = createTouchControls({ root: page.touch, doc: page.doc });
    return { page, touch };
  };
  const { page, touch } = build({});
  assert.equal(page.touch.hidden, true);
  assert.equal(touch.enabled, false);
  assert.equal(touch.buttons.length, TOUCH_BUTTONS.length);
  const action = (name) => page.touch.querySelector(`[data-action="${name}"]`);
  const app = (name) => page.touch.querySelector(`[data-app="${name}"]`);
  for (const a of ['flipperLeft', 'flipperRight', 'plunger', 'nudgeLeft', 'nudgeRight', 'nudgeBottom']) {
    assert.ok(action(a), a);
    assert.equal(action(a).tagName, 'BUTTON');
    assert.ok(action(a).classList.contains('tc'));
    assert.ok(action(a).getAttribute('aria-label'));
  }
  for (const a of ['pause', 'newGame', 'launchBall']) assert.ok(app(a), a);
  assert.equal(page.touch.querySelectorAll('.tc').length, 9);
  fire(action('flipperLeft'), 'pointerdown');
  assert.ok(action('flipperLeft').classList.contains('is-down'));
  fire(action('flipperLeft'), 'pointerup');
  assert.ok(!action('flipperLeft').classList.contains('is-down'));
  const ctx = fire(action('plunger'), 'contextmenu');
  assert.equal(ctx.defaultPrevented, true);
  assert.equal(build({ coarse: true }).page.touch.hidden, false);
  assert.equal(build({ search: '?touch=1' }).page.touch.hidden, false);
  assert.equal(build({ search: '?x=1&touch=1' }).page.touch.hidden, false);
  assert.equal(build({ search: '?touch=0', coarse: true }).page.touch.hidden, true);
  assert.equal(wantsTouchControls('', null), false);
  assert.equal(wantsTouchControls('?touch=1', null), true);
  assert.equal(wantsTouchControls('', () => ({ matches: true })), true);
  assert.equal(wantsTouchControls('', () => { throw new Error('x'); }), false);
  touch.dispose();
  assert.equal(page.touch.querySelectorAll('.tc').length, 0);
});

test('pause overlay: shown on demand, Resume calls togglePause', () => {
  const page = makePage();
  const rec = recorder();
  const pause = createPauseOverlay({ host: page.stage, doc: page.doc, actions: rec.actions });
  assert.equal(pause.element.id, 'pause-overlay');
  assert.equal(pause.isShown(), false);
  pause.update(true);
  assert.equal(pause.isShown(), true);
  byId(page.doc, 'pause-resume').click();
  assert.deepEqual(rec.calls, [['togglePause']]);
  pause.update(false);
  assert.equal(pause.isShown(), false);
});

test('file picker: folder and zip inputs deliver File[] once and reset', () => {
  const page = makePage();
  const got = [];
  const picker = createFilePicker({ root: page.dialogRoot, doc: page.doc, onFiles: (f) => got.push(f) });
  assert.equal(picker.inputs.folder.getAttribute('webkitdirectory'), '');
  assert.ok(picker.inputs.files.getAttribute('accept').includes('.zip'));
  let clicks = 0;
  picker.inputs.folder.addEventListener('click', () => { clicks++; });
  picker.pickFolder();
  assert.equal(clicks, 1);
  picker.inputs.folder.files = [{ name: 'SOUND1.WAV' }, { name: 'SOUND2.WAV' }];
  fire(picker.inputs.folder, 'change', { bubbles: false });
  assert.equal(got.length, 1);
  assert.equal(got[0].length, 2);
  picker.inputs.files.files = [];
  fire(picker.inputs.files, 'change', { bubbles: false });
  assert.equal(got.length, 1, 'an empty selection is ignored');
  picker.dispose();
  assert.equal(findAll(page.dialogRoot, (e) => e.tagName === 'INPUT').length, 0);
});

// ------------------------------------------------------------------------------------------------------------------ facade
function makeUI(extra = {}) {
  const page = makePage(extra.docOpts);
  const rec = recorder();
  const dialogChanges = [];
  const menuChanges = [];
  const art = page.doc.createElement('canvas');
  const store = createStore(null);
  const ui = createUI({
    root: page.app, doc: page.doc, store, actions: rec.actions, panelArt: art, options: { ...DEFAULT_OPTIONS }, bindings: { ...DEFAULT_KEYS },
    onDialogChange: (o) => dialogChanges.push(o), onMenuChange: (o) => menuChanges.push(o), ...extra.opts,
  });
  return { page, rec, ui, dialogChanges, menuChanges, doc: page.doc };
}

test('createUI: fills every mount point and survives a bare page', () => {
  const { page, ui, doc } = makeUI();
  const canvas = byId(doc, 'panel-canvas');
  assert.equal(canvas.tagName, 'CANVAS');
  assert.equal(canvas.parentNode, page.panel);
  assert.equal(canvas.width, 203);
  assert.equal(canvas.height, 394);
  const aria = byId(doc, 'panel-aria');
  assert.equal(aria.getAttribute('aria-live'), 'polite');
  assert.ok(aria.classList.contains('sr-only'));
  assert.equal(page.menubar.querySelectorAll('.menu-bar').length, 1);
  assert.equal(page.touch.querySelectorAll('.tc').length, 9);
  assert.ok(byId(doc, 'start-btn-sound'));
  assert.equal(byId(doc, 'sound-status').parentNode, page.status);
  assert.equal(byId(doc, 'fps').hidden, true);
  assert.ok(byId(doc, 'pause-overlay'));
  assert.equal(page.start.hidden, true);
  for (const k of ['update', 'setOptions', 'showStartOverlay', 'hideStartOverlay', 'setSoundStatus', 'showHighScores', 'promptName', 'showControls',
    'showAbout', 'showHelp', 'toast', 'setFps', 'isDialogOpen', 'closeAllDialogs', 'dispose']) assert.equal(typeof ui[k], 'function', k);
  // a bare page without any mount point
  const bare = createFakeDocument();
  const root = bare.createElement('div');
  bare.body.appendChild(root);
  const ui2 = createUI({ root, doc: bare, store: createStore(null), actions: {}, panelArt: bare.createElement('canvas'), options: DEFAULT_OPTIONS, bindings: DEFAULT_KEYS });
  for (const id of ['menubar', 'panel', 'touch-controls', 'start-overlay', 'status-line', 'dialog-root', 'toast-root', 'panel-canvas', 'panel-aria']) assert.ok(bare.getElementById(id), id);
  ui2.update(makeView(), 0.016);
  ui2.dispose();
  assert.throws(() => createUI({}), TypeError);
});

test('createUI.update: repaints the panel and #panel-aria only when the revision changed', () => {
  const { ui, doc } = makeUI();
  const canvas = byId(doc, 'panel-canvas');
  const view = makeView({ score: 4200, info: 'Skill Shot', mission: 'Ready for Launch' });
  const before = canvas.ops.length;
  ui.update(view, 1 / 60);
  const after = canvas.ops.length;
  assert.ok(after > before);
  assert.equal(textOf(byId(doc, 'panel-aria')), 'Player 1, ball 1, score 4200. Skill Shot Ready for Launch');
  for (let i = 0; i < 5; i++) ui.update(view, 1 / 60);
  assert.equal(canvas.ops.length, after, 'no canvas work while nothing changed');
  view.revision++;
  view.score = 4300;
  ui.update(view, 1 / 60);
  assert.ok(canvas.ops.length > after);
  assert.match(textOf(byId(doc, 'panel-aria')), /score 4300/);
});

test('createUI.update: the name dialog opens once per prompt and never reopens after an answer', () => {
  const { ui, rec, dialogChanges, doc } = makeUI();
  const prompt = { player: 1, rank: 2, score: 777, defaultName: 'Player 1' };
  const view = makeView({ phase: 'gameOver', namePrompt: prompt });
  ui.update(view, 0.016);
  assert.equal(ui.isDialogOpen(), true);
  assert.deepEqual(dialogChanges, [true]);
  ui.update(view, 0.016);
  assert.equal(findAll(byId(doc, 'dialog-root'), (e) => e.id === 'dlg-name').length, 1);
  findAll(byId(doc, 'dlg-name'), (e) => e.tagName === 'BUTTON' && e.textContent === 'OK')[0].click();
  assert.deepEqual(rec.calls, [['submitName', 'Player 1']]);
  assert.equal(ui.isDialogOpen(), false);
  assert.deepEqual(dialogChanges, [true, false]);
  ui.update(view, 0.016);                                          // the rules have not cleared the prompt yet: must not reopen
  assert.equal(ui.isDialogOpen(), false);
  view.namePrompt = null;
  ui.update(view, 0.016);
  view.namePrompt = { player: 2, rank: 1, score: 999, defaultName: 'Player 2' };
  ui.update(view, 0.016);
  assert.equal(ui.isDialogOpen(), true, 'a new prompt opens a new dialog');
  fire(doc.activeElement, 'keydown', { key: 'Escape' });
  assert.deepEqual(rec.calls.at(-1), ['submitName', null]);
  ui.update(view, 0.016);
  assert.equal(ui.isDialogOpen(), false, 'a cancelled prompt does not pop up again');
  // promptName() can also be called directly and survives updates without a prompt in the view
  view.namePrompt = null;
  ui.update(view, 0.016);
  ui.promptName({ player: 3, rank: 3, score: 1, defaultName: 'Player 3' });
  assert.equal(ui.isDialogOpen(), true);
  ui.update(view, 0.016);
  assert.equal(ui.isDialogOpen(), true, 'a directly requested prompt is not withdrawn by an update without view.namePrompt');
  ui.closeAllDialogs();
  assert.equal(ui.isDialogOpen(), false);
  // the rules withdraw a prompt that came from the view (new game while the dialog is up): the stale dialog goes away silently
  view.namePrompt = { player: 4, rank: 5, score: 3, defaultName: 'Player 4' };
  const callsBefore = rec.calls.length;
  ui.update(view, 0.016);
  assert.equal(ui.isDialogOpen(), true);
  view.namePrompt = null;
  ui.update(view, 0.016);
  assert.equal(ui.isDialogOpen(), false);
  assert.equal(rec.calls.length, callsBefore, 'withdrawing the prompt does not call submitName');
});

test('createUI.update: pause veil, start overlay auto-hide, Exit keeps the overlay', () => {
  const { ui, rec, doc, page } = makeUI();
  const pauseEl = byId(doc, 'pause-overlay');
  ui.update(makeView({ paused: true }), 0.016);
  assert.equal(pauseEl.hidden, false);
  byId(doc, 'pause-resume').click();
  assert.deepEqual(rec.calls, [['togglePause']]);
  ui.update(makeView({ paused: false }), 0.016);
  assert.equal(pauseEl.hidden, true);
  ui.update(makeView({ paused: true, phase: 'idle' }), 0.016);
  assert.equal(pauseEl.hidden, true, 'no veil in idle');
  ui.update(makeView({ paused: true }), 0.016);
  ui.showAbout();
  ui.update(makeView({ paused: true }), 0.016);
  assert.equal(pauseEl.hidden, true, 'no veil under a dialog');
  ui.closeAllDialogs();

  const status = { state: 'idle', loaded: 0, total: 41, source: null, text: 'sound: not loaded' };
  ui.update(makeView({ phase: 'idle' }), 0.016);
  ui.showStartOverlay({ soundStatus: status });
  assert.equal(page.start.hidden, false);
  ui.update(makeView({ phase: 'idle' }), 0.016);
  assert.equal(page.start.hidden, false);
  ui.update(makeView({ phase: 'lightShow' }), 0.016);               // F2 pressed under the overlay
  assert.equal(page.start.hidden, true);
  // Exit: the rules go idle in the same breath as the overlay is shown
  ui.update(makeView({ phase: 'playing' }), 0.016);
  ui.showStartOverlay({ soundStatus: status });
  ui.update(makeView({ phase: 'idle' }), 0.016);
  assert.equal(page.start.hidden, false);
  ui.hideStartOverlay();
  assert.equal(page.start.hidden, true);
});

test('createUI: status line, fps, toast, options and dialogs', () => {
  const { ui, page, doc } = makeUI();
  ui.setSoundStatus({ state: 'loading', loaded: 12, total: 41, source: 'S1', text: 'sound: loading 12/41...' });
  assert.equal(textOf(byId(doc, 'sound-status')), 'sound: loading 12/41...');
  assert.equal(textOf(byId(doc, 'start-status')), 'sound: loading 12/41...');
  ui.setFps(59.6);
  assert.equal(textOf(byId(doc, 'fps')), '60 fps');
  assert.equal(byId(doc, 'fps').hidden, false);
  ui.setFps(null);
  assert.equal(byId(doc, 'fps').hidden, true);
  ui.toast('Saved', 1000);
  assert.equal(page.toastRoot.children.length, 1);
  ui.update(makeView(), 1.1);
  assert.equal(page.toastRoot.children.length, 0);
  ui.setOptions({ ...DEFAULT_OPTIONS, sounds: false, players: 2 });
  const menuBtn = (cmd, v) => page.menubar.querySelector(`[data-cmd="${cmd}"]` + (v ? `[data-value="${v}"]` : ''));
  assert.equal(menuBtn('sounds').getAttribute('aria-checked'), 'false');
  assert.equal(menuBtn('players', '2').getAttribute('aria-checked'), 'true');
  ui.showHighScores(SCORES, { clearable: true });
  assert.equal(ui.isDialogOpen(), true);
  ui.closeAllDialogs();
  ui.showSound();
  assert.equal(textOf(byId(doc, 'sound-dlg-status')), 'sound: loading 12/41...', 'the dialog opens with the last known status');
  ui.setSoundStatus({ state: 'ready', loaded: 41, total: 41, source: 'local', text: 'sound: original (local)' });
  assert.equal(textOf(byId(doc, 'sound-dlg-status')), 'sound: original (local)', 'and follows later status updates');
  ui.closeAllDialogs();
  ui.showControls({ ...DEFAULT_KEYS, flipperLeft: 'KeyA' });
  assert.deepEqual(findAll(byId(doc, 'dlg-controls'), (e) => e.className.startsWith('key-picker')).map(textOf)[0], 'A');
  ui.closeAllDialogs();
  ui.showHelp();
  assert.match(byId(doc, 'dlg-help').textContent, /Left flipper: A/, 'help shows the current bindings');
  ui.closeAllDialogs();
  ui.dispose();
  assert.equal(page.menubar.querySelectorAll('.menu-bar').length, 0);
});

test('createUI: menu and controls flow end to end (rebinding persists through actions and the start card hint)', () => {
  const { ui, rec, page, doc, menuChanges } = makeUI();
  const [, options] = page.menubar.querySelectorAll('.menu-title');
  fire(options, 'click');
  page.menubar.querySelector('[data-cmd="controls"]').click();
  assert.deepEqual(menuChanges, [true, false]);
  const dlg = byId(doc, 'dlg-controls');
  const picker = findAll(dlg, (e) => e.className.startsWith('key-picker'))[1];
  picker.click();
  fire(picker, 'keydown', { key: 'k', code: 'KeyK' });
  findAll(dlg, (e) => e.tagName === 'BUTTON' && e.textContent === 'OK')[0].click();
  assert.deepEqual(rec.calls.at(-1), ['setBindings', { ...DEFAULT_KEYS, flipperRight: 'KeyK' }]);
  assert.deepEqual(ui.getBindings(), { ...DEFAULT_KEYS, flipperRight: 'KeyK' });
  assert.match(textOf(byId(doc, 'start-keys')), /Flippers: Z \(left\), K \(right\)/);
});

test('dom helper h(): attributes, properties, handlers, children', () => {
  const doc = createFakeDocument();
  let clicked = 0;
  const el = h(doc, 'button', { class: 'a b', id: 'x', 'data-k': 'v', disabled: true, hidden: false, onclick: () => { clicked++; }, 'aria-hidden': null }, 'hi ', [h(doc, 'b', { text: 'there' }), null, false], 3);
  assert.equal(el.className, 'a b');
  assert.equal(el.id, 'x');
  assert.equal(el.getAttribute('data-k'), 'v');
  assert.equal(el.disabled, true);
  assert.equal(el.hidden, false);
  assert.equal(el.getAttribute('aria-hidden'), null);
  assert.equal(el.textContent, 'hi there3');
  el.disabled = false;
  el.click();
  assert.equal(clicked, 1);
});

test('toasts: a progress toast ("Loading 3 files...") is withdrawn as soon as its result toast arrives; ordinary toasts are not', () => {
  const page = makePage();
  const toasts = createToasts({ root: page.toastRoot, doc: page.doc });
  toasts.show('Loading 3 files...');
  toasts.show('Hint', 5000);
  assert.deepEqual(page.toastRoot.children.map(textOf), ['Hint'], 'a non-progress toast replaces the progress one');
  toasts.show('Loading 2 files...');
  toasts.show('Loading 4 files...');
  assert.deepEqual(page.toastRoot.children.map(textOf), ['Hint', 'Loading 4 files...'], 'a new progress toast also replaces the old progress toast');
  toasts.show('Loaded 4 sound files from your files.', 3500);
  assert.deepEqual(page.toastRoot.children.map(textOf), ['Hint', 'Loaded 4 sound files from your files.']);
  assert.equal(toasts.count(), 2);
});

test('portrait HUD: panelHudParts gives plain text for the scoreboard (player / ball / score / info / mission), blank where the panel is blank', async () => {
  const { panelHudParts } = await import('../src/ui/panel.js');
  assert.deepEqual(panelHudParts(makeView({ score: 748750, player: 2, playerCount: 2, ballNumber: 3, info: 'Skill Shot\n30000', mission: 'Attack Bumpers\nHits\nTo Go: 8' })),
    { head: 'Player 2 - Ball 3', score: '748750', info: 'Skill Shot 30000', mission: 'Attack Bumpers Hits To Go: 8' });
  assert.deepEqual(panelHudParts(makeView({ phase: 'idle', score: -1, ballNumber: 0 })), { head: 'Star Cadet Pinball', score: '', info: '', mission: '' });
  assert.equal(panelHudParts(makeView({ ballNumber: 0 })).head, 'Player 1', 'no ball number during the last end-of-ball bonus');
  assert.deepEqual(panelHudParts(null), { head: '', score: '', info: '', mission: '' });
});

test('createUI.update: the text HUD under the panel follows the view and is hidden from screen readers (the live region carries the announcement)', () => {
  const { ui, doc, page } = makeUI();
  const hud = byId(doc, 'panel-hud');
  assert.ok(hud, 'the HUD element exists');
  assert.equal(hud.parentNode, page.panel);
  assert.equal(hud.getAttribute('aria-hidden'), 'true');
  const view = makeView({ score: 4200, ballNumber: 2, info: 'Skill Shot', mission: 'Ready for\nLaunch' });
  ui.update(view, 1 / 60);
  assert.equal(textOf(hud.querySelector('.hud-head')), 'Player 1 - Ball 2');
  assert.equal(textOf(hud.querySelector('.hud-score')), '4200');
  assert.equal(textOf(hud.querySelector('.hud-info')), 'Skill Shot');
  assert.equal(textOf(hud.querySelector('.hud-mission')), 'Ready for Launch');
  view.revision++; view.score = 5000; view.info = '';
  ui.update(view, 1 / 60);
  assert.equal(textOf(hud.querySelector('.hud-score')), '5000');
  assert.equal(textOf(hud.querySelector('.hud-info')), '');
});

test('menus: Cinematic Camera / Mouse Rotates View are checkboxes from the options, Reset View an action (additive)', () => {
  const { menus, item, rec } = makeMenus();
  assert.equal(item('cinematic').getAttribute('role'), 'menuitemcheckbox');
  assert.equal(item('mouseLook').getAttribute('role'), 'menuitemcheckbox');
  assert.equal(item('resetView').getAttribute('role'), 'menuitem');
  assert.equal(findAll(item('cinematic'), (e) => e.tagName === 'KBD').map(textOf)[0], 'C');
  assert.equal(item('cinematic').getAttribute('aria-checked'), 'false', 'off by default');
  assert.equal(item('mouseLook').getAttribute('aria-checked'), 'true', 'on by default');
  const options = menus.elements.titles[1];
  const click = (cmd) => { fire(options, 'click'); item(cmd).click(); };
  click('cinematic');
  click('mouseLook');
  click('resetView');
  assert.deepEqual(rec.calls, [['setCinematic', true], ['setMouseLook', false], ['resetView']]);
  menus.setOptions({ ...DEFAULT_OPTIONS, cinematic: true, mouseLook: false });
  assert.equal(item('cinematic').getAttribute('aria-checked'), 'true');
  assert.equal(item('mouseLook').getAttribute('aria-checked'), 'false');
});
