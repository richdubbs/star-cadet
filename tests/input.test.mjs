/**
 * tests/input.test.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 11.3: cheat matcher, key mapping with a fake EventTarget (repeat ignored, blocked mode, bindings, releaseAll, app keys,
 * pointer mapping, touch delegation, debug mode).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, createCheatMatcher, usableCheatWords, CHEAT_WORDS } from '../src/input.js';
import { DEFAULT_KEYS } from '../src/data/constants.js';

// ---- fakes ---------------------------------------------------------------------------------------------------------------------------
class FakeEl extends EventTarget {
  constructor(id, tag = 'DIV', attrs = {}, rect = { left: 0, top: 0, width: 365, height: 416 }) {
    super();
    this.id = id; this.tagName = tag; this.attrs = attrs; this.rect = rect;
  }
  getBoundingClientRect() { return this.rect; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  closest() { return this.attrs['data-action'] !== undefined || this.attrs['data-app'] !== undefined ? this : null; }
  contains(o) { return o === this; }
  blur() { this.blurred = true; }
}
class FakeDoc extends EventTarget {
  constructor(els) { super(); this.els = els; this.hidden = false; this.body = {}; this.activeElement = null; }
  getElementById(id) { return this.els[id] || null; }
}

function rig(opts = {}) {
  const events = [];
  const win = new EventTarget();
  const table = new FakeEl('table-view');
  const touch = new FakeEl('touch-controls');
  const doc = new FakeDoc({ 'table-view': table, 'touch-controls': touch });
  const input = createInput({ onEvent: (e) => events.push(e), target: win, doc, ...opts });
  input.attach();
  const fire = (el, type, props = {}) => {
    const e = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(e, props);
    el.dispatchEvent(e);
    return e;
  };
  const key = (type, code, extra = {}) => fire(extra.on || win, type, { code, key: extra.key ?? '', repeat: false, ...extra });
  const clear = () => { events.length = 0; };
  return { events, win, table, touch, doc, input, fire, key, clear };
}
const games = (events) => events.filter((e) => e.kind === 'game').map((e) => `${e.action}:${e.down ? 'down' : 'up'}`);

// ---- cheat matcher ---------------------------------------------------------------------------------------------------------------------
test('cheat matcher: every word completes once; TAB can replace the space; a wrong character resets progress', () => {
  for (const word of CHEAT_WORDS) {
    const m = createCheatMatcher();
    const out = [];
    for (const ch of word) out.push(m.feed(ch));
    assert.equal(out[out.length - 1], word, word);
    assert.deepEqual(out.slice(0, -1).filter(Boolean), [], 'no earlier completion for ' + word);
    assert.equal(m.feed('x'), null, 'buffer cleared after a completion');
  }
  const m = createCheatMatcher();
  let res = null;
  for (const ch of 'hidden\ttest') res = m.feed(ch);
  assert.equal(res, 'hidden test');
  const w = createCheatMatcher();
  for (const ch of 'gma') w.feed(ch);
  assert.equal(w.feed('q'), null);
  assert.equal(w.feed('x'), null, 'gmaqx is not gmax');
  for (const ch of 'gmax') res = w.feed(ch);
  assert.equal(res, 'gmax');
});

test('cheat matcher: rolling buffer of 11 characters, upper case is lower-cased, junk input is ignored', () => {
  const m = createCheatMatcher();
  for (const ch of 'zzzzzzzzzzzzzzzzzzzz') m.feed(ch);
  assert.equal(m.buffer().length, 11);
  let res = null;
  for (const ch of 'xx1MAX') res = m.feed(ch);
  assert.equal(res, '1max');
  assert.equal(m.feed(''), null);
  assert.equal(m.feed('ab'), null);
  assert.equal(m.feed(/** @type {any} */ (undefined)), null);
  const long = createCheatMatcher();
  let r = null;
  for (const ch of 'easy mode') r = long.feed(ch);
  assert.equal(r, 'easy mode');
});

test('usableCheatWords: default bindings keep all six; a gameplay key rebound to a letter of a word disables that word (SPEC 6.9)', () => {
  assert.deepEqual(usableCheatWords(DEFAULT_KEYS), [...CHEAT_WORDS]);
  assert.ok(!usableCheatWords({ ...DEFAULT_KEYS, flipperLeft: 'KeyG' }).includes('gmax'));
  assert.ok(usableCheatWords({ ...DEFAULT_KEYS, flipperLeft: 'KeyG' }).includes('1max'));
  assert.ok(!usableCheatWords({ ...DEFAULT_KEYS, nudgeLeft: 'Digit1' }).includes('1max'));
  assert.ok(usableCheatWords({ ...DEFAULT_KEYS, nudgeLeft: 'KeyQ' }).length === 6);
  assert.ok(!usableCheatWords({ ...DEFAULT_KEYS, plunger: 'KeyE' }).includes('easy mode'));
});

// ---- keyboard ---------------------------------------------------------------------------------------------------------------------------
test('keys: the six default bindings map to game events; key repeat is ignored; bound keys are preventDefaulted', () => {
  const r = rig();
  const pairs = [['KeyZ', 'flipperLeft'], ['Slash', 'flipperRight'], ['Space', 'plunger'], ['KeyX', 'nudgeLeft'], ['Period', 'nudgeRight'], ['ArrowUp', 'nudgeBottom']];
  for (const [code, action] of pairs) {
    r.clear();
    const d = r.key('keydown', code);
    assert.equal(d.defaultPrevented, true, code + ' keydown preventDefault');
    r.key('keydown', code, { repeat: true });
    r.key('keydown', code, { repeat: true });
    assert.deepEqual(games(r.events), [`${action}:down`], code + ' repeat ignored');
    r.key('keyup', code);
    assert.deepEqual(games(r.events), [`${action}:down`, `${action}:up`]);
  }
});

test('keys: a stray keyup emits nothing; modifiers (Ctrl / Meta / Alt) leave the browser shortcuts alone', () => {
  const r = rig();
  r.key('keyup', 'KeyZ');
  const e = r.key('keydown', 'KeyZ', { ctrlKey: true });
  assert.equal(e.defaultPrevented, false);
  const f = r.key('keydown', 'F5', { metaKey: true });
  assert.equal(f.defaultPrevented, false);
  assert.deepEqual(r.events, []);
});

test('app keys: F1 F2 F3 F4 F5 F6 F8 Enter V C emit app events (keydown only, no repeat, preventDefault)', () => {
  const r = rig();
  const map = { F2: 'newGame', Enter: 'launchBall', F3: 'pause', F4: 'fullscreen', F5: 'sounds', F6: 'music', F8: 'controls', F1: 'help', KeyV: 'camera', KeyC: 'cinematic' };
  for (const [code, action] of Object.entries(map)) {
    r.clear();
    const e = r.key('keydown', code);
    r.key('keydown', code, { repeat: true });
    r.key('keyup', code);
    assert.equal(e.defaultPrevented, true, code);
    assert.deepEqual(r.events, [{ kind: 'app', action }], code);
  }
});

test('typing a cheat word emits one cheat event; Tab counts as the space of "hidden test"', () => {
  const r = rig();
  for (const ch of 'gmax') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  assert.deepEqual(r.events.filter((e) => e.kind === 'cheat'), [{ kind: 'cheat', word: 'gmax' }]);
  r.clear();
  for (const ch of 'hidden') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  r.key('keydown', 'Tab', { key: 'Tab' });
  for (const ch of 'test') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  assert.deepEqual(r.events.filter((e) => e.kind === 'cheat'), [{ kind: 'cheat', word: 'hidden test' }]);
  // repeat does not feed the buffer twice
  r.clear();
  r.key('keydown', 'Digit1', { key: '1' });
  for (const ch of 'max') { r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch }); r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch, repeat: true }); }
  assert.deepEqual(r.events.filter((e) => e.kind === 'cheat'), [{ kind: 'cheat', word: '1max' }]);
});

test('cheats still work with the default X nudge binding, and are skipped when a binding collides after rebinding', () => {
  const r = rig();
  for (const ch of 'rmax') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  assert.equal(r.events.filter((e) => e.kind === 'cheat').length, 1);
  r.input.setBindings({ ...DEFAULT_KEYS, flipperLeft: 'KeyR' });
  r.clear();
  for (const ch of 'rmax') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  assert.equal(r.events.filter((e) => e.kind === 'cheat').length, 0, 'R is a flipper now');
  r.clear();
  for (const ch of 'gmax') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  assert.equal(r.events.filter((e) => e.kind === 'cheat').length, 1);
});

test('setBindings: the new codes work, the old ones do not, held keys are released first, defaultBindings is DEFAULT_KEYS', () => {
  const r = rig();
  assert.deepEqual(r.input.defaultBindings(), { ...DEFAULT_KEYS });
  r.key('keydown', 'KeyZ');
  r.clear();
  r.input.setBindings({ ...DEFAULT_KEYS, flipperLeft: 'KeyA' });
  assert.deepEqual(games(r.events), ['flipperLeft:up']);
  assert.equal(r.input.getBindings().flipperLeft, 'KeyA');
  r.clear();
  r.key('keydown', 'KeyZ');
  assert.deepEqual(r.events, []);
  r.key('keydown', 'KeyA');
  assert.deepEqual(games(r.events), ['flipperLeft:down']);
  // junk input falls back to the defaults
  r.input.setBindings({ flipperLeft: 5 });
  assert.deepEqual(r.input.getBindings(), { ...DEFAULT_KEYS });
});

test('setBlocked: releases what is held, swallows keys without preventDefault, resumes afterwards', () => {
  const r = rig();
  r.key('keydown', 'KeyZ');
  r.key('keydown', 'Space');
  r.clear();
  r.input.setBlocked(true);
  assert.deepEqual(games(r.events).sort(), ['flipperLeft:up', 'plunger:up']);
  r.clear();
  const e = r.key('keydown', 'KeyZ');
  const f = r.key('keydown', 'F2');
  r.key('keydown', 'KeyG', { key: 'g' });
  assert.equal(e.defaultPrevented, false);
  assert.equal(f.defaultPrevented, false);
  r.key('keyup', 'KeyZ');
  assert.deepEqual(r.events, []);
  assert.equal(r.input.isBlocked(), true);
  r.input.setBlocked(false);
  r.key('keydown', 'KeyZ');
  assert.deepEqual(games(r.events), ['flipperLeft:down']);
});

test('setBlocked also resets the cheat buffer; typing into a form control never reaches the game', () => {
  const r = rig();
  for (const ch of 'gma') r.key('keydown', 'Key' + ch.toUpperCase(), { key: ch });
  r.input.setBlocked(true);
  r.input.setBlocked(false);
  r.key('keydown', 'KeyX', { key: 'x' });
  assert.equal(r.events.filter((e) => e.kind === 'cheat').length, 0);
  const field = new FakeEl('name', 'INPUT');
  r.clear();
  // the browser reports the focused control as event.target
  const ev = new Event('keydown', { cancelable: true, bubbles: true });
  Object.assign(ev, { code: 'KeyZ', key: 'z', repeat: false });
  Object.defineProperty(ev, 'target', { value: field });
  r.win.dispatchEvent(ev);
  assert.deepEqual(r.events, []);
  assert.equal(ev.defaultPrevented, false);
});

test('releaseAll emits up for every held action; blur and a hidden document do the same; nothing else is emitted', () => {
  const r = rig();
  r.key('keydown', 'KeyZ');
  r.key('keydown', 'Slash');
  r.clear();
  r.input.releaseAll();
  assert.deepEqual(games(r.events).sort(), ['flipperLeft:up', 'flipperRight:up']);
  r.clear();
  r.input.releaseAll();
  assert.deepEqual(r.events, []);
  r.key('keydown', 'Space');
  r.clear();
  r.fire(r.win, 'blur');
  assert.deepEqual(games(r.events), ['plunger:up']);
  r.key('keydown', 'KeyX');
  r.clear();
  r.doc.hidden = true;
  r.fire(r.doc, 'visibilitychange');
  assert.deepEqual(games(r.events), ['nudgeLeft:up']);
  // the key that was released by blur does not produce a second 'up' when its keyup finally arrives
  r.clear();
  r.key('keyup', 'KeyX');
  assert.deepEqual(r.events, []);
});

test('detach removes every listener (and releases held keys)', () => {
  const r = rig();
  r.key('keydown', 'KeyZ');
  r.clear();
  r.input.detach();
  assert.deepEqual(games(r.events), ['flipperLeft:up']);
  r.clear();
  r.key('keydown', 'KeyZ');
  r.fire(r.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  assert.deepEqual(r.events, []);
});

// ---- mouse / touch / buttons ------------------------------------------------------------------------------------------------------------
test('mouse over the table: button 0 = left flipper, 2 = right flipper, 1 = plunger; both buttons can be held; context menu suppressed', () => {
  const r = rig();
  r.fire(r.table, 'mousedown', { button: 0, clientX: 50, clientY: 50 });
  r.fire(r.table, 'mousedown', { button: 2, clientX: 50, clientY: 50 });
  r.fire(r.table, 'mousedown', { button: 1, clientX: 50, clientY: 50 });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperRight:down', 'plunger:down']);
  r.clear();
  r.fire(r.win, 'mouseup', { button: 2 });
  r.fire(r.win, 'mouseup', { button: 0 });
  r.fire(r.win, 'mouseup', { button: 1 });
  r.fire(r.win, 'mouseup', { button: 1 });
  assert.deepEqual(games(r.events), ['flipperRight:up', 'flipperLeft:up', 'plunger:up']);
  const c = r.fire(r.table, 'contextmenu');
  assert.equal(c.defaultPrevented, true);
  r.clear();
  r.fire(r.table, 'mousedown', { button: 4, clientX: 0, clientY: 0 });
  assert.deepEqual(r.events, []);
});

test('a keyboard flipper and a mouse flipper on the same action do not release each other', () => {
  const r = rig();
  r.key('keydown', 'KeyZ');
  r.fire(r.table, 'mousedown', { button: 0 });
  assert.deepEqual(games(r.events), ['flipperLeft:down']);
  r.fire(r.win, 'mouseup', { button: 0 });
  assert.deepEqual(games(r.events), ['flipperLeft:down']);
  r.key('keyup', 'KeyZ');
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up']);
});

test('touch on the table: the left half is the left flipper, the right half the right flipper; multi-touch; cancel releases', () => {
  const r = rig();
  r.fire(r.table, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 40, clientY: 300 });
  r.fire(r.table, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 300, clientY: 300 });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperRight:down']);
  r.clear();
  r.fire(r.win, 'pointerup', { pointerType: 'touch', pointerId: 1 });
  r.fire(r.win, 'pointercancel', { pointerType: 'touch', pointerId: 2 });
  assert.deepEqual(games(r.events), ['flipperLeft:up', 'flipperRight:up']);
});

test('setPointerFlippers(false) disables mouse / touch flippers and releases the ones held', () => {
  const r = rig();
  r.fire(r.table, 'mousedown', { button: 0 });
  r.clear();
  r.input.setPointerFlippers(false);
  assert.deepEqual(games(r.events), ['flipperLeft:up']);
  r.clear();
  r.fire(r.table, 'mousedown', { button: 0 });
  r.fire(r.table, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 });
  assert.deepEqual(r.events, []);
  r.input.setPointerFlippers(true);
  r.fire(r.table, 'mousedown', { button: 2 });
  assert.deepEqual(games(r.events), ['flipperRight:down']);
});

test('touch buttons are handled by delegation: [data-action] holds, [data-app] fires once; leaving with a mouse releases', () => {
  const r = rig();
  const flip = new FakeEl('b1', 'BUTTON', { 'data-action': 'flipperLeft' });
  const plunger = new FakeEl('b2', 'BUTTON', { 'data-action': 'plunger' });
  const pause = new FakeEl('b3', 'BUTTON', { 'data-app': 'pause' });
  const fireOn = (el, type, props) => {
    const e = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(e, props);
    Object.defineProperty(e, 'target', { value: el });
    r.touch.dispatchEvent(e);
    return e;
  };
  const d = fireOn(flip, 'pointerdown', { pointerType: 'touch', pointerId: 7 });
  assert.equal(d.defaultPrevented, true);
  fireOn(plunger, 'pointerdown', { pointerType: 'touch', pointerId: 8 });
  fireOn(pause, 'pointerdown', { pointerType: 'touch', pointerId: 9 });
  assert.deepEqual(r.events, [
    { kind: 'game', action: 'flipperLeft', down: true }, { kind: 'game', action: 'plunger', down: true }, { kind: 'app', action: 'pause' },
  ]);
  r.clear();
  r.fire(r.win, 'pointerup', { pointerType: 'touch', pointerId: 7 });
  r.fire(r.win, 'pointercancel', { pointerType: 'touch', pointerId: 8 });
  r.fire(r.win, 'pointerup', { pointerType: 'touch', pointerId: 9 });
  assert.deepEqual(games(r.events), ['flipperLeft:up', 'plunger:up']);
  // a mouse pressed on the on-screen button and dragged off it
  r.clear();
  fireOn(flip, 'pointerdown', { pointerType: 'mouse', pointerId: 1 });
  fireOn(flip, 'pointerout', { pointerType: 'mouse', pointerId: 1, relatedTarget: null });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up']);
  // blocked: nothing happens
  r.clear();
  r.input.setBlocked(true);
  fireOn(flip, 'pointerdown', { pointerType: 'touch', pointerId: 11 });
  fireOn(pause, 'pointerdown', { pointerType: 'touch', pointerId: 12 });
  assert.deepEqual(r.events, []);
});

test('a [data-action] with an unknown name is ignored', () => {
  const r = rig();
  const bogus = new FakeEl('b', 'BUTTON', { 'data-action': 'selfDestruct' });
  const e = new Event('pointerdown', { cancelable: true, bubbles: true });
  Object.assign(e, { pointerType: 'touch', pointerId: 1 });
  Object.defineProperty(e, 'target', { value: bogus });
  r.touch.dispatchEvent(e);
  assert.deepEqual(r.events, []);
});

test('other keyboard layouts: the key LABELLED Z / X works wherever it sits (QWERTZ, AZERTY, Dvorak); rebound letters stay physical', () => {
  const r = rig();
  // QWERTZ: the labelled Z is the physical KeyY; AZERTY: it is the physical KeyW
  for (const code of ['KeyY', 'KeyW']) {
    r.clear();
    const down = r.key('keydown', code, { key: 'z' });
    assert.equal(down.defaultPrevented, true);
    r.key('keyup', code, { key: 'z' });
    assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up'], code);
  }
  r.clear();
  r.key('keydown', 'KeyQ', { key: 'Z' });                                   // a capital letter (caps lock / shift) is the same key
  r.key('keyup', 'KeyQ', { key: 'Z' });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up']);
  r.clear();
  r.key('keydown', 'KeyZ', { key: 'y' });                                   // the physical Z position still works (labelled Y on QWERTZ)
  r.key('keyup', 'KeyZ', { key: 'y' });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up']);
  r.clear();
  r.key('keydown', 'KeyW', { key: 'z' }); r.key('keydown', 'KeyW', { key: 'z', repeat: true });   // repeat still ignored
  assert.deepEqual(games(r.events), ['flipperLeft:down']);
  r.key('keyup', 'KeyW', { key: 'z' });
  r.clear();
  r.key('keydown', 'KeyB', { key: 'b' }); r.key('keydown', 'KeyN', { key: 'n' }); r.key('keyup', 'KeyB', { key: 'b' }); r.key('keyup', 'KeyN', { key: 'n' });
  assert.deepEqual(games(r.events), [], 'letters that are not bound are not flippers');
  // once the player rebinds a key, only that physical key counts: the letter fallback is for the default bindings
  r.input.setBindings({ ...DEFAULT_KEYS, flipperLeft: 'KeyA' });
  r.clear();
  r.key('keydown', 'KeyY', { key: 'z' }); r.key('keyup', 'KeyY', { key: 'z' });
  assert.deepEqual(games(r.events), [], 'Z is no longer the left flipper');
  r.key('keydown', 'KeyA', { key: 'a' }); r.key('keyup', 'KeyA', { key: 'a' });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up']);
  r.clear();
  r.key('keydown', 'KeyD', { key: 'x' }); r.key('keyup', 'KeyD', { key: 'x' });       // X (left nudge) was not rebound: its labelled key still works
  assert.deepEqual(games(r.events), ['nudgeLeft:down', 'nudgeLeft:up']);
  // blocked and modifiers: nothing
  r.clear();
  r.input.setBlocked(true);
  r.key('keydown', 'KeyD', { key: 'x' });
  r.input.setBlocked(false);
  r.key('keydown', 'KeyD', { key: 'x', ctrlKey: true });
  assert.deepEqual(r.events, []);
});

test('a MOUSE click on an on-screen button (?touch=1, hybrid devices) is released by its pointerup, not only by leaving the button', () => {
  const r = rig();
  const flip = new FakeEl('b1', 'BUTTON', { 'data-action': 'flipperRight' });
  const fireOn = (type, props) => {
    const e = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(e, props);
    Object.defineProperty(e, 'target', { value: flip });
    r.touch.dispatchEvent(e);
  };
  fireOn('pointerdown', { pointerType: 'mouse', pointerId: 1 });
  assert.deepEqual(games(r.events), ['flipperRight:down']);
  assert.equal(r.input.isDown('flipperRight'), true);
  r.fire(r.win, 'pointerup', { pointerType: 'mouse', pointerId: 1 });
  assert.deepEqual(games(r.events), ['flipperRight:down', 'flipperRight:up'], 'the click ends with the pointerup');
  assert.equal(r.input.isDown('flipperRight'), false);
  // the table's own mouse buttons are driven by mouse events and must not be disturbed by an unrelated pointerup
  r.clear();
  r.fire(r.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  r.fire(r.win, 'pointerup', { pointerType: 'mouse', pointerId: 1 });
  assert.deepEqual(games(r.events), ['flipperLeft:down']);
  r.fire(r.win, 'mouseup', { button: 0 });
  assert.deepEqual(games(r.events), ['flipperLeft:down', 'flipperLeft:up']);
});

// ---- debug mode -----------------------------------------------------------------------------------------------------------------------
test('debug keys H R B S I J Y only emit while debug is on, and they also feed the cheat buffer', () => {
  const r = rig();
  r.key('keydown', 'KeyH', { key: 'h' });
  assert.deepEqual(r.events.filter((e) => e.kind === 'debug'), []);
  r.input.setDebug(true);
  assert.equal(r.input.isDebug(), true);
  r.clear();
  for (const k of 'HRBSIJY') r.key('keydown', 'Key' + k, { key: k.toLowerCase() });
  assert.deepEqual(r.events.filter((e) => e.kind === 'debug').map((e) => e.key), ['H', 'R', 'B', 'S', 'I', 'J', 'Y']);
  // 'hidden test' can still be typed in debug mode to leave it
  r.clear();
  for (const ch of 'hidden test') r.key('keydown', ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase(), { key: ch });
  assert.equal(r.events.filter((e) => e.kind === 'cheat' && e.word === 'hidden test').length, 1);
  r.input.setDebug(false);
  r.clear();
  r.key('keydown', 'KeyB', { key: 'b' });
  assert.deepEqual(r.events.filter((e) => e.kind === 'debug'), []);
});

test('debug mode: mouse and touch gestures on the table become pointer events instead of flippers', () => {
  const r = rig();
  r.input.setDebug(true);
  r.fire(r.table, 'mousedown', { button: 0, clientX: 100, clientY: 200 });
  r.fire(r.win, 'mousemove', { clientX: 110, clientY: 210 });
  r.fire(r.win, 'mouseup', { button: 0, clientX: 120, clientY: 220 });
  assert.deepEqual(r.events, [
    { kind: 'pointer', phase: 'down', clientX: 100, clientY: 200, button: 0 },
    { kind: 'pointer', phase: 'move', clientX: 110, clientY: 210, button: 0 },
    { kind: 'pointer', phase: 'up', clientX: 120, clientY: 220, button: 0 },
  ]);
  r.clear();
  r.fire(r.win, 'mousemove', { clientX: 1, clientY: 1 });            // no drag in progress: nothing
  r.fire(r.table, 'pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 10, clientY: 10 });
  r.fire(r.win, 'pointermove', { pointerType: 'touch', pointerId: 5, clientX: 12, clientY: 14 });
  r.fire(r.win, 'pointerup', { pointerType: 'touch', pointerId: 5, clientX: 13, clientY: 15 });
  assert.deepEqual(r.events.map((e) => e.phase), ['down', 'move', 'up']);
  // switching debug off during a drag ends it
  r.clear();
  r.fire(r.table, 'mousedown', { button: 0, clientX: 5, clientY: 5 });
  r.input.setDebug(false);
  assert.deepEqual(r.events.map((e) => e.phase), ['down', 'up']);
});

test('createInput validates its options and is importable / usable with no globals', () => {
  assert.throws(() => createInput({}), TypeError);
  const noop = createInput({ onEvent() {}, target: null, doc: null });
  noop.attach();
  noop.releaseAll();
  noop.detach();
  assert.equal(typeof noop.setPointerFlippers, 'function');
});

test('setMouseButtons(false) (Mouse Rotates View): mouse buttons stop working the table, a held one is let go; touch still flips', () => {
  const r = rig();
  assert.equal(r.input.getMouseButtons(), true);
  r.fire(r.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  assert.equal(r.input.isDown('flipperLeft'), true);
  r.input.setMouseButtons(false);
  assert.equal(r.input.isDown('flipperLeft'), false, 'released when the mouse is handed to the view');
  r.clear();
  r.fire(r.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  r.fire(r.table, 'mousedown', { button: 2, clientX: 10, clientY: 10 });
  r.fire(r.table, 'mousedown', { button: 1, clientX: 10, clientY: 10 });
  assert.deepEqual(games(r.events), []);
  r.fire(r.table, 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 10, clientY: 10 });
  assert.deepEqual(games(r.events), ['flipperLeft:down'], 'touch flippers are unaffected');
  r.input.setMouseButtons(true);
  r.clear();
  r.fire(r.table, 'mousedown', { button: 2, clientX: 10, clientY: 10 });
  assert.deepEqual(games(r.events), ['flipperRight:down']);
});
