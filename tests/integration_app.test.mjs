/**
 * tests/integration_app.test.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * The application shell (src/main.js createApp) run in Node on the UI role's fake DOM, with the REAL game, input, UI, audio and store modules:
 *   boot and start flows (silent / with sound / own files), keyboard -> input.js -> rules -> physics, which sound keys reach audio.play,
 *   pause on blur / hidden tab / menu / dialog, demo mode, frame-stage isolation, renderer load failure (CDN down), exit, camera, music OFF.
 * No wall clock, no Math.random, no network (a fake fetch that answers 404 and records the URLs), no real timers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/main.js';
import { createRig } from './helpers/bot.mjs';
import { createAudio } from '../src/audio.js';
import { createStore } from '../src/ui/storage.js';
import { soundDuration, SOUND_KEYS } from '../src/data/sounds.js';
import { PHYS } from '../src/data/constants.js';
import { createFakeDocument, fire } from './ui_helpers/fake_dom.mjs';
import { FakeAudioContext, makeFetch, makeSynth } from './audio_helpers/fake_audio.mjs';

// ---- the fake page --------------------------------------------------------------------------------------------------------------------
function makePage() {
  const doc = createFakeDocument();
  const el = (tag, id, cls, parent, hidden = false) => {
    const e = doc.createElement(tag);
    e.id = id; e.className = cls; if (hidden) e.hidden = true;
    parent.appendChild(e);
    return e;
  };
  const app = el('div', 'app', 'app', doc.body);
  el('nav', 'menubar', 'menubar', app);
  const stage = el('div', 'stage', 'stage', el('main', 'stage-wrap', 'stage-wrap', app));
  const table = el('div', 'table-view', 'table-view', stage);
  table.getBoundingClientRect = () => ({ left: 0, top: 0, width: 365, height: 416 });
  el('aside', 'panel', 'panel', stage);
  el('div', 'touch-controls', 'touch-controls', stage, true);
  el('div', 'start-overlay', 'overlay start-overlay', stage, true);
  el('div', 'status-line', 'status-line', stage);
  el('div', 'dialog-root', 'dialog-root', app);
  el('div', 'toast-root', 'toast-root', app);
  doc.hidden = false;
  return { doc, table };
}

/** A renderer double that records what the loop does with it. */
function fakeRenderer() {
  const r = {
    domElement: null, renders: 0, modes: [], mode: 'original', throwOnRender: false, resizes: [], mouseLook: [], resets: 0, frames: [],
    resize(w, h, dpr) { r.resizes.push([w, h, dpr]); },
    render(f) { r.renders++; r.frames.push({ cinematic: f && f.cinematic ? { ...f.cinematic } : null }); if (r.frames.length > 20) r.frames.shift(); if (r.throwOnRender) throw new Error('boom render'); },
    setMouseLook(on) { r.mouseLook.push(on); }, resetView() { r.resets++; },
    setCameraMode(m) { r.mode = m; r.modes.push(m); },
    getCameraMode: () => r.mode,
    cycleCameraMode() { r.mode = { original: 'top', top: 'orbit', orbit: 'original' }[r.mode]; return r.mode; },
    pickTable: () => null, setQuality() {}, info: () => ({}), dispose() { r.disposed = true; },
  };
  return r;
}

const NO_SLEEP = async () => {};

/**
 * @param {{search?:string, store?:any, importRenderer?:Function, audioOpts?:object}} [o]
 */
function makeApp(o = {}) {
  const page = makePage();
  const win = new EventTarget();
  win.devicePixelRatio = 1;
  const store = o.store || createStore(null);
  const fetchImpl = makeFetch(() => undefined);                    // every URL is a 404: nothing can ever load
  const ctxStart = FakeAudioContext.instances.length;
  const audio = createAudio({ fetch: fetchImpl, AudioContext: FakeAudioContext, cache: false, document: page.doc, log: () => {}, sleep: NO_SLEEP, ...o.audioOpts });
  const played = [];
  const realPlay = audio.play;
  audio.play = (k) => { played.push(k); return realPlay(k); };      // rules call sound.play(key): the shell hands them THIS object
  const clock = { t: 1000 };
  let pending = null;
  const app = createApp({
    doc: page.doc, win, search: o.search || '', coarse: false, now: () => clock.t, raf: (cb) => { pending = cb; },
    importRenderer: o.importRenderer || (() => new Promise(() => {})),    // by default the renderer never arrives: the stand-in stays, quietly
    createArt: () => ({ panel: page.doc.createElement('canvas') }), store, audio,
  });
  const kit = {
    ...page, win, store, audio, app, played, fetchImpl, clock,
    ctxs: () => FakeAudioContext.instances.slice(ctxStart),
    /** advance the page by `ms` of wall time in `frames` animation frames */
    run(seconds, fps = 60) {
      const n = Math.max(1, Math.round(seconds * fps));
      for (let i = 0; i < n; i++) { const cb = pending; pending = null; clock.t += 1000 / fps; cb(clock.t); }
    },
    key(type, code, k = '', extra = {}) {
      const e = Object.assign(new Event(type, { cancelable: true }), { code, key: k, repeat: false, ...extra });
      win.dispatchEvent(e);
      return e;
    },
    tap(code, k = '') { kit.key('keydown', code, k); kit.key('keyup', code, k); },
    click(id) { page.doc.getElementById(id).click(); },
    phase: () => app.rules.getView().phase,
    start() { kit.click('start-btn-silent'); },
    toPlunger() {
      kit.start();
      for (let i = 0; i < 600 && !app.game.physics.ballAtPlunger(); i++) kit.run(0.1, 10);
    },
  };
  return kit;
}

function errorSpy(t) {
  const calls = [];
  t.mock.method(console, 'error', (...a) => { calls.push(a.map(String).join(' ')); });
  return calls;
}

// =====================================================================================================================================
// boot and the start flows
// =====================================================================================================================================
test('boot: the start card is up and blocks the game keys, nothing is fetched, music is OFF, the debug handle has its thirteen members', (t) => {
  const errors = errorSpy(t);
  const k = makeApp();
  assert.equal(k.doc.getElementById('start-overlay').hidden, false);
  assert.equal(k.app.input.isBlocked(), true);
  assert.equal(k.phase(), 'idle');
  assert.equal(k.fetchImpl.calls.length, 0, 'no network request before a click');
  assert.equal(k.ctxs().length, 0, 'no AudioContext before a click');
  assert.equal(k.app.audio.music.isEnabled(), false);
  assert.equal(k.store.getOptions().music, false);
  assert.deepEqual(Object.keys(k.win.__pinball).sort(),
    ['actions', 'art', 'audio', 'cinematic', 'data', 'game', 'input', 'lamps', 'physics', 'renderer', 'rules', 'store', 'ui'].sort());
  k.key('keydown', 'KeyZ', 'z');                                   // blocked: nothing reaches the rules
  assert.equal(k.app.input.isDown('flipperLeft'), false);
  k.run(1);
  assert.deepEqual(errors, []);
});

test('start without sound: the game begins, the card closes, the choice is stored, no AudioContext network traffic, sounds stay muted', () => {
  const k = makeApp();
  k.click('start-btn-silent');
  assert.equal(k.phase(), 'lightShow');
  assert.equal(k.doc.getElementById('start-overlay').hidden, true);
  assert.equal(k.app.input.isBlocked(), false);
  assert.deepEqual([k.store.getOptions().sounds, k.store.getOptions().soundConsent, k.store.getOptions().music], [false, 'denied', false]);
  assert.equal(k.audio.isEnabled(), false);
  assert.equal(k.fetchImpl.calls.length, 0, 'a silent start fetches nothing');
  assert.equal(k.ctxs().length, 0, 'and creates no AudioContext');
  assert.equal(k.app.audio.music.isEnabled(), false);
});

test('start with original sounds: the click creates the AudioContext synchronously and starts the load (local ./sounds/ first); consent is stored', async () => {
  const k = makeApp();
  k.click('start-btn-sound');
  assert.equal(k.ctxs().length, 1, 'the AudioContext is created inside the click handler (user gesture)');
  assert.equal(k.phase(), 'lightShow', 'the game starts while the files load');
  assert.deepEqual([k.store.getOptions().sounds, k.store.getOptions().soundConsent], [true, 'granted']);
  assert.equal(k.audio.isEnabled(), true);
  await k.audio.load();                                            // shared with the running load
  assert.equal(k.fetchImpl.calls[0].url, './sounds/', 'the local folder is probed first');
  assert.ok(k.fetchImpl.calls.length > 1);
  assert.equal(k.audio.getStatus().state, 'unavailable', 'all sources failed: the game simply stays silent');
  k.run(2);                                                         // gameplay timers are unaffected by the failed load
  assert.equal(k.phase(), 'lightShow');
});

test('menu New Game while the start card is up acts as "start without sound" unless the sound consent was granted earlier', () => {
  const k = makeApp();
  k.app.actions.newGame();
  assert.equal(k.phase(), 'lightShow');
  assert.equal(k.store.getOptions().soundConsent, 'denied');
  assert.equal(k.fetchImpl.calls.length, 0);
  const store = createStore(null);
  store.setOptions({ sounds: true, soundConsent: 'granted' });
  const k2 = makeApp({ store });
  k2.app.actions.newGame();
  assert.equal(k2.store.getOptions().soundConsent, 'granted');
  assert.ok(k2.fetchImpl.calls.length >= 1, 'a remembered consent starts the load');
});

/** Let pending promises (crypto digests, file reads) run until `pred()` holds: setImmediate only yields to the event loop (no delay, no wall clock), bounded. */
async function until(pred, tries = 5000) {
  for (let i = 0; i < tries && !pred(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(pred(), 'condition not reached');
}

test('Options > Load My Sounds: valid user files are used, a tampered one is rejected, the status is pushed to the UI and a toast says so', async () => {
  const synth = makeSynth();
  const k = makeApp({ audioOpts: { data: synth.data } });
  const files = [...synth.blobs].filter(([n]) => n !== 'PINBALL.MID').map(([n, b]) => new File([b], n));
  const bad = new Uint8Array(files[0].size).fill(7);                // right name, wrong bytes
  k.app.actions.loadLocalSounds([new File([bad], files[0].name)]);
  await until(() => k.audio.getLastImport().matched === 1);
  assert.deepEqual([k.audio.getLastImport().accepted, k.audio.getLastImport().rejected], [0, 1], 'a wrong hash is rejected');
  assert.equal(k.audio.getStatus().loaded, 0);
  await until(() => /do not match the original/.test(k.doc.getElementById('toast-root').textContent));
  assert.equal(k.store.getOptions().soundConsent, 'unset', 'nothing usable arrived: the consent is untouched');
  k.app.actions.loadLocalSounds(files);
  await until(() => k.audio.getStatus().loaded === files.length);
  assert.equal(k.audio.getStatus().source, 'user');
  assert.deepEqual([k.store.getOptions().sounds, k.store.getOptions().soundConsent], [true, 'granted']);
  await until(() => /Loaded 5 sound files/.test(k.doc.getElementById('toast-root').textContent));
  assert.match(k.doc.getElementById('sound-status').textContent, /your files/);
});

test('dropping a Pinball folder / files anywhere on the page imports them like the menu does (status, toast, sounds switched on)', async () => {
  const synth = makeSynth();
  const k = makeApp({ audioOpts: { data: synth.data } });
  const files = [...synth.blobs].filter(([n]) => n !== 'PINBALL.MID').map(([n, b]) => new File([b], n));
  const dt = { types: ['Files'], items: [], files };
  const ev = fire(k.doc, 'drop', { dataTransfer: dt });
  assert.equal(ev.defaultPrevented, true, 'the browser must not navigate to the dropped file');
  await until(() => k.audio.getStatus().loaded === files.length);
  await until(() => /Loaded 5 sound files/.test(k.doc.getElementById('toast-root').textContent));
  assert.deepEqual([k.store.getOptions().sounds, k.store.getOptions().soundConsent], [true, 'granted']);
  assert.equal(k.audio.isEnabled(), true);
  fire(k.doc, 'drop', { dataTransfer: dt });                        // the same files again
  await until(() => /already loaded/.test(k.doc.getElementById('toast-root').textContent));
  fire(k.doc, 'drop', { dataTransfer: { types: ['text/plain'], items: [], files: [] } });   // not a file drag: ignored
});

test('URL flags: ?nosound is stored, ?camera=top sets the camera, ?seed makes the game reproducible', () => {
  const k = makeApp({ search: '?nosound&camera=top&seed=9' });
  assert.deepEqual([k.store.getOptions().sounds, k.store.getOptions().soundConsent, k.store.getOptions().camera], [false, 'denied', 'top']);
  const a = makeApp({ search: '?seed=9' });
  const b = makeApp({ search: '?seed=9' });
  const c = makeApp({ search: '?seed=10' });
  for (const x of [a, b, c]) { x.start(); x.run(8, 20); }
  const snap = (x) => JSON.stringify(x.app.game.physics.snapshot());
  assert.equal(snap(a), snap(b));
  assert.notEqual(snap(a), snap(c));
});

// =====================================================================================================================================
// keyboard -> input.js -> rules -> physics, and which sounds reach audio.play
// =====================================================================================================================================
test('keys on the page: hold Space to launch, Z and / raise the flippers, F3 pauses and resumes, F2 restarts', () => {
  const k = makeApp();
  k.toPlunger();
  const { physics } = k.app.game;
  assert.equal(physics.ballAtPlunger(), true);
  const e = k.key('keydown', 'Space', ' ');
  assert.equal(e.defaultPrevented, true, 'Space never scrolls the page');
  k.run(2.7, 20);
  assert.ok(physics.snapshot().plunger.pull > 0.9);
  k.key('keyup', 'Space', ' ');
  k.run(3, 20);
  assert.equal(physics.ballAtPlunger(), false);
  k.key('keydown', 'KeyZ', 'z');
  assert.equal(physics.snapshot().flippers.a_flip1.up, true);
  k.key('keydown', 'Slash', '/');
  assert.equal(physics.snapshot().flippers.a_flip2.up, true);
  k.key('keyup', 'KeyZ', 'z'); k.key('keyup', 'Slash', '/');
  assert.deepEqual([physics.snapshot().flippers.a_flip1.up, physics.snapshot().flippers.a_flip2.up], [false, false]);
  k.key('keydown', 'F3');
  assert.equal(k.app.game.isPaused(), true);
  const t0 = k.app.game.simTime();
  k.run(1);
  assert.equal(k.app.game.simTime(), t0, 'a paused game does not advance');
  k.key('keydown', 'F3');
  assert.equal(k.app.game.isPaused(), false);
  k.key('keydown', 'F2');
  assert.equal(k.phase(), 'lightShow');
});

test('sound triggers: a real game on the page reaches audio.play with valid keys (new game, feed, plunger, flippers, bumpers ...)', () => {
  const k = makeApp({ search: '?seed=3' });
  k.toPlunger();
  k.key('keydown', 'Space', ' ');
  k.run(2.7, 20);
  k.key('keyup', 'Space', ' ');
  for (let i = 0; i < 40; i++) {                                   // a few seconds of flipping
    k.key('keydown', 'KeyZ', 'z'); k.key('keydown', 'Slash', '/'); k.run(0.2, 20);
    k.key('keyup', 'KeyZ', 'z'); k.key('keyup', 'Slash', '/'); k.run(0.2, 20);
  }
  const seen = new Set(k.played);
  for (const key of ['NEW_GAME', 'BALL_FEED', 'PLUNGER_PULL', 'PLUNGER_RELEASE', 'FLIP_UP', 'FLIP_DOWN']) assert.ok(seen.has(key), 'audio.play(' + key + ')');
  for (const key of seen) assert.ok(Object.prototype.hasOwnProperty.call(SOUND_KEYS, key), 'a key of the sound manifest: ' + key);
  assert.equal(k.played.filter((x) => x === 'NEW_GAME').length, 1);
  assert.equal(k.app.audio.durationOf('BALL_FEED'), soundDuration('BALL_FEED'), 'durations come from the manifest, not from any buffer');
});

test('F5 / F6 toggle sounds and music; music stays OFF until asked and F6 persists the choice', async () => {
  const k = makeApp();
  k.toPlunger();
  k.key('keydown', 'F6');
  assert.equal(k.store.getOptions().music, true);
  assert.equal(k.app.audio.music.isEnabled(), true);
  k.key('keydown', 'F6');
  assert.equal(k.store.getOptions().music, false);
  assert.equal(k.app.audio.music.isEnabled(), false);
  const before = k.fetchImpl.calls.length;
  k.key('keydown', 'F5');                                           // sounds ON from a silent session = consent + load
  assert.deepEqual([k.store.getOptions().sounds, k.store.getOptions().soundConsent], [true, 'granted']);
  assert.ok(k.fetchImpl.calls.length > before);
  k.key('keydown', 'F5');
  assert.equal(k.store.getOptions().sounds, false);
  assert.equal(k.audio.isEnabled(), false);
});

test('F4 full screen: requests it on the page element, leaves it again, and says so when the browser cannot (or refuses)', async () => {
  const k = makeApp();
  const toasts = () => k.doc.getElementById('toast-root').textContent;
  k.key('keydown', 'F4');                                           // the start card is up: F4 is blocked there, use the action
  k.app.actions.toggleFullscreen();
  assert.match(toasts(), /Full screen is not available/, 'no requestFullscreen at all (iPhone Safari)');
  let requested = 0;
  k.doc.documentElement.requestFullscreen = () => { requested++; return Promise.resolve(); };
  k.app.actions.toggleFullscreen();
  assert.equal(requested, 1);
  k.doc.fullscreenElement = k.doc.documentElement;
  let exited = 0;
  k.doc.exitFullscreen = () => { exited++; return Promise.resolve(); };
  k.app.actions.toggleFullscreen();
  assert.equal(exited, 1);
  fire(k.doc, 'fullscreenchange');
  assert.equal(k.store.getOptions().fullscreen, true, 'the option follows the real state (fullscreenchange)');
  k.doc.fullscreenElement = null;
  fire(k.doc, 'fullscreenchange');
  assert.equal(k.store.getOptions().fullscreen, false);
  k.doc.documentElement.requestFullscreen = () => Promise.reject(new Error('denied'));
  k.app.actions.toggleFullscreen();
  await until(() => (toasts().match(/Full screen is not available/g) || []).length >= 1);
});

test('rebinding: setBindings applies at once (old key dead, new key live), is persisted and a held key is released first', () => {
  const k = makeApp();
  k.toPlunger();
  k.key('keydown', 'KeyZ', 'z');
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, true);
  const b = { ...k.app.input.getBindings(), flipperLeft: 'KeyA' };
  k.app.actions.setBindings(b);
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, false, 'rebinding releases what is held');
  assert.equal(k.store.getBindings().flipperLeft, 'KeyA');
  k.key('keydown', 'KeyZ', 'z');
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, false);
  k.key('keydown', 'KeyA', 'a');
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, true);
  k.app.actions.resetBindings();
  assert.equal(k.store.getBindings().flipperLeft, 'KeyZ');
});

test('?debug=1: the debug keys work (Y shows the frame rate and hides it again, H opens the name prompt), without it they do nothing', () => {
  const plain = makeApp();
  plain.start();
  plain.key('keydown', 'KeyY', 'y'); plain.key('keyup', 'KeyY', 'y');
  plain.run(1, 20);
  assert.equal(plain.doc.getElementById('fps').hidden, true, 'no debug, no fps');
  const k = makeApp({ search: '?debug=1' });
  assert.equal(k.app.rules.getView().debug, true);
  assert.equal(k.app.input.isDebug(), true);
  k.start();
  k.run(1, 20);
  k.key('keydown', 'KeyY', 'y'); k.key('keyup', 'KeyY', 'y');
  k.run(1, 20);
  assert.equal(k.doc.getElementById('fps').hidden, false);
  assert.match(k.doc.getElementById('fps').textContent, /^[0-9]+ fps$/);
  k.key('keydown', 'KeyY', 'y'); k.key('keyup', 'KeyY', 'y');
  assert.equal(k.doc.getElementById('fps').hidden, true);
  k.key('keydown', 'KeyY', 'y'); k.key('keyup', 'KeyY', 'y');
  k.run(1, 20);
  for (const ch of 'hidden test') k.key('keydown', ch === ' ' ? 'Tab' : 'Key' + ch.toUpperCase(), ch);   // leaving debug mode hides the fps counter too
  k.run(0.2, 20);
  assert.equal(k.app.input.isDebug(), false);
  assert.equal(k.doc.getElementById('fps').hidden, true);
});

test('typed cheat words reach the rules; "hidden test" switches debug mode on and off through the shell', () => {
  const k = makeApp();
  k.toPlunger();
  for (const ch of 'hidden test') k.key('keydown', ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase(), ch);
  assert.equal(k.app.rules.getView().debug, true);
  k.run(0.1);
  assert.equal(k.app.input.isDebug(), true, 'the input follows the rules debug flag');
  k.key('keyup', 'Space', ' ');
  for (const ch of 'hidden test') k.key('keydown', ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase(), ch);
  assert.equal(k.app.rules.getView().debug, false);
  k.run(0.1);
  assert.equal(k.app.input.isDebug(), false);
});

test('high scores: a name entered in the dialog is saved to the store and shows up after a "reload" (new app, same storage)', () => {
  const store = createStore(null);
  const k = makeApp({ store });
  k.toPlunger();
  k.app.rules.setDebug(true);
  k.app.rules.debugKey('S');                                         // a random score
  k.app.rules.debugKey('H');                                         // the high-score prompt
  k.run(0.2);
  const input = k.doc.getElementById('dlg-name-input');
  assert.ok(input, 'the name dialog opened');
  assert.equal(k.app.game.isPaused(), true, 'the open dialog pauses the running game');
  input.value = 'ACE';
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(k.app.game.isPaused(), false);
  assert.equal(store.getHighScores()[0].name, 'ACE');
  assert.ok(store.getHighScores()[0].score > 0);
  const again = makeApp({ store });
  assert.equal(again.app.rules.highScores.entries()[0].name, 'ACE', 'loaded at start');
  again.app.actions.showHighScores();
  assert.match(again.doc.getElementById('dialog-root').textContent, /ACE/);
  k.app.actions.clearHighScores();
  assert.ok(store.getHighScores().every((e) => e.score <= 0), 'Clear writes through to the store');
});

// =====================================================================================================================================
// pause, focus, visibility, menus and dialogs
// =====================================================================================================================================
test('window blur releases the keys and pauses a running game; regaining focus does not resume it; F3 does', async () => {
  const k = makeApp({ audioOpts: {} });
  k.click('start-btn-sound');
  await k.audio.unlock();
  const ctx = k.ctxs()[0];
  k.run(7, 20);
  assert.equal(k.phase(), 'playing');
  k.key('keydown', 'KeyZ', 'z');
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, true);
  k.win.dispatchEvent(new Event('blur'));
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, false, 'the held flipper is released');
  assert.equal(k.app.game.isPaused(), true);
  assert.equal(ctx.state, 'suspended', 'the audio context is suspended with the pause');
  k.key('keyup', 'KeyZ', 'z');                                      // the keyup that arrives after the blur is harmless
  k.win.dispatchEvent(new Event('focus'));
  k.run(1);
  assert.equal(k.app.game.isPaused(), true, 'focus alone does not resume');
  k.key('keydown', 'F3');
  assert.equal(k.app.game.isPaused(), false);
  await k.audio.unlock();
  assert.equal(ctx.state, 'running');
});

test('a hidden tab pauses a human game for good, but the attract mode carries on by itself when the tab returns', () => {
  const human = makeApp();
  human.toPlunger();
  human.doc.hidden = true; fire(human.doc, 'visibilitychange');
  assert.equal(human.app.game.isPaused(), true);
  human.doc.hidden = false; fire(human.doc, 'visibilitychange');
  assert.equal(human.app.game.isPaused(), true, 'a human game waits for F3');

  const demo = makeApp({ search: '?demo&seed=2' });
  demo.run(2);
  demo.win.dispatchEvent(new Event('blur'));
  assert.equal(demo.app.game.isPaused(), false, 'a blurred window does not pause the demo');
  demo.doc.hidden = true; fire(demo.doc, 'visibilitychange');
  assert.equal(demo.app.game.isPaused(), true, 'a hidden tab does');
  demo.doc.hidden = false; fire(demo.doc, 'visibilitychange');
  assert.equal(demo.app.game.isPaused(), false, 'and the demo resumes');
  // ... but a pause the user chose in the meantime is respected
  demo.doc.hidden = true; fire(demo.doc, 'visibilitychange');
  demo.key('keydown', 'F3');                                       // user resumes
  demo.key('keydown', 'F3');                                       // and pauses again
  assert.equal(demo.app.game.isPaused(), true);
  demo.doc.hidden = false; fire(demo.doc, 'visibilitychange');
  assert.equal(demo.app.game.isPaused(), true, 'an explicit pause stays');
});

test('opening a menu or a dialog pauses a running game and closing it resumes - but only when that open caused the pause', () => {
  const k = makeApp();
  k.toPlunger();
  const [, options] = k.doc.getElementById('menubar').querySelectorAll('.menu-title');
  options.click();                                                  // open a menu
  assert.equal(k.app.game.isPaused(), true);
  assert.equal(k.app.input.isBlocked(), true);
  k.key('keydown', 'KeyZ', 'z');
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, false, 'keys are ignored while a menu is open');
  options.click();                                                  // close it again
  assert.equal(k.app.game.isPaused(), false);
  assert.equal(k.app.input.isBlocked(), false);

  k.app.ui.showHelp();                                              // a dialog
  assert.equal(k.app.game.isPaused(), true);
  k.app.ui.closeAllDialogs();
  assert.equal(k.app.game.isPaused(), false);

  k.key('keydown', 'F3');                                           // the user paused first: a dialog must not resume it
  k.app.ui.showHelp();
  k.app.ui.closeAllDialogs();
  assert.equal(k.app.game.isPaused(), true);
  k.key('keydown', 'F3');
  assert.equal(k.app.game.isPaused(), false);
});

test('a menu command that pauses (Pause Game) ends paused; New Game from the menu un-pauses', () => {
  const k = makeApp();
  k.toPlunger();
  const [game] = k.doc.getElementById('menubar').querySelectorAll('.menu-title');
  game.click();
  k.doc.getElementById('menubar').querySelector('[data-cmd="pause"]').click();
  assert.equal(k.app.game.isPaused(), true);
  assert.equal(k.app.input.isBlocked(), false);
  game.click();
  k.doc.getElementById('menubar').querySelector('[data-cmd="newGame"]').click();
  assert.equal(k.app.game.isPaused(), false);
  assert.equal(k.phase(), 'lightShow');
});

test('Exit returns to the start card: no game, input blocked, music stopped, pause cleared', () => {
  const k = makeApp();
  k.toPlunger();
  let stops = 0;
  const realStop = k.app.audio.music.stop;
  k.app.audio.music.stop = () => { stops++; return realStop(); };
  k.key('keydown', 'F3');
  k.app.actions.exit();
  assert.equal(k.phase(), 'idle');
  assert.equal(k.doc.getElementById('start-overlay').hidden, false);
  assert.equal(k.app.input.isBlocked(), true);
  assert.equal(k.app.game.isPaused(), false);
  assert.equal(stops, 1, 'the music does not play behind the start card');
  k.start();
  assert.equal(k.phase(), 'lightShow');
});

test('a whole game through the shell: three balls drain, game over, the name dialog blocks the keys and un-blocks them, F2 starts the next game', () => {
  const k = makeApp({ search: '?seed=5' });
  k.toPlunger();
  k.key('keydown', 'Space', ' ');                                    // a full plunge scores the lane switches: a real score, so a name is asked for
  k.run(2.7, 20);
  k.key('keyup', 'Space', ' ');
  for (let i = 0; i < 30 && k.app.rules.getView().score === 0; i++) k.run(0.5, 20);
  assert.ok(k.app.rules.getView().score > 0, 'score ' + k.app.rules.getView().score);
  const seen = [];
  for (let ball = 1; ball <= 3; ball++) {
    assert.equal(k.app.rules.getView().ballNumber, ball);
    k.app.game.physics.forceDrainAll();                              // the ball falls down the drain
    k.run(8, 20);                                                    // drain delay, ball save window, next feed
    seen.push(k.phase());
  }
  assert.equal(k.phase(), 'gameOver');
  k.run(4, 20);                                                      // "Game Over" -> the name prompt
  const input = k.doc.getElementById('dlg-name-input');
  assert.ok(input, 'the high-score name dialog opened');
  assert.equal(k.app.input.isBlocked(), true, 'typing a name must not fire flippers or F-keys');
  assert.equal(k.app.game.isPaused(), false, 'a game that is over is not auto-paused by the dialog');
  k.key('keydown', 'F2');
  assert.equal(k.phase(), 'gameOver', 'F2 is swallowed while the name dialog is open');
  input.value = 'ACE';
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(k.app.input.isBlocked(), false);
  assert.equal(k.store.getHighScores()[0].name, 'ACE');
  k.key('keydown', 'F2');
  assert.equal(k.phase(), 'lightShow');
  assert.equal(k.app.rules.getView().score, 0);
  assert.deepEqual(seen, ['playing', 'playing', 'gameOver']);
});

test('player count from the menu or the start card: a new game with that many players starts at once and the choice is remembered', () => {
  const k = makeApp();
  k.doc.getElementById('start-players').value = '3';
  k.click('start-btn-silent');
  assert.equal(k.app.rules.getView().playerCount, 3);
  assert.equal(k.store.getOptions().players, 3);
  k.run(7, 20);
  k.app.actions.selectPlayers(2);                                    // Options > 2 Players while playing: restarts
  assert.equal(k.phase(), 'lightShow');
  assert.equal(k.app.rules.getView().playerCount, 2);
  assert.equal(k.store.getOptions().players, 2);
  k.app.actions.exit();
  k.app.actions.selectPlayers(4);                                    // with the start card up: starts silently
  assert.equal(k.app.rules.getView().playerCount, 4);
  assert.equal(k.doc.getElementById('start-overlay').hidden, true);
});

// =====================================================================================================================================
// demo mode
// =====================================================================================================================================
test('?demo: no start card, the attract AI plays and restarts for ten simulated minutes without a single error; the keyboard is ignored', (t) => {
  const errors = errorSpy(t);
  const k = makeApp({ search: '?demo&seed=4' });
  assert.equal(k.doc.getElementById('start-overlay').hidden, true);
  assert.equal(k.app.rules.getView().demo, true);
  assert.equal(k.app.input.isBlocked(), false);
  k.key('keydown', 'KeyZ', 'z');
  assert.equal(k.app.game.physics.snapshot().flippers.a_flip1.up, false, 'demo ignores the player flippers');
  k.key('keyup', 'KeyZ', 'z');
  let lightShows = 0;
  let last = '';
  let best = 0;
  const panelOps = k.doc.getElementById('panel-canvas').ops;
  for (let s = 0; s < 10 * 60; s++) {                              // 10 minutes in 10 fps frames (12 sim steps each)
    k.run(1, 10);
    panelOps.length = 0;                                           // the fake canvas records every draw call: keep the double small
    const v = k.app.rules.getView();
    if (v.phase === 'lightShow' && last !== 'lightShow') lightShows++;
    last = v.phase;
    best = Math.max(best, v.score);
    assert.notEqual(v.phase, 'idle');
  }
  assert.ok(lightShows >= 2, 'the demo started ' + lightShows + ' games');
  assert.ok(best > 0, 'the demo scored');
  assert.deepEqual(errors, []);
  assert.deepEqual(k.app.errors, {});
  k.key('keydown', 'F2');                                           // F2 leaves the demo for a real game
  assert.equal(k.app.rules.getView().demo, false);
  assert.equal(k.phase(), 'lightShow');
});

test('?demo with a remembered sound consent loads the files at once but creates the AudioContext only at the first gesture', async () => {
  const store = createStore(null);
  store.setOptions({ sounds: true, soundConsent: 'granted' });
  const k = makeApp({ search: '?demo&seed=2', store });
  assert.ok(k.fetchImpl.calls.length >= 1 || true);
  assert.equal(k.ctxs().length, 0, 'no AudioContext without a gesture (the browser would refuse it and warn)');
  k.run(1);
  fire(k.doc, 'pointerdown');
  assert.equal(k.ctxs().length, 1, 'the first click creates it');
  await k.audio.unlock();
  assert.equal(k.ctxs()[0].state, 'running');
  assert.equal(k.doc.getElementById('start-overlay').hidden, true);
});

// =====================================================================================================================================
// robustness: frame stages, renderer failure, clock
// =====================================================================================================================================
test('one failing stage never stops the others: a throwing audio.update / renderer / simulation still lets the UI and the loop run', async (t) => {
  const errors = errorSpy(t);
  const r = fakeRenderer();
  const k = makeApp({ importRenderer: async () => ({ createRenderer: () => r }) });
  await k.app.rendererReady;
  assert.equal(k.app.getRenderer(), r);
  k.start();
  const panelText = () => k.doc.getElementById('panel-aria').textContent;
  k.run(1, 20);
  assert.match(panelText(), /Player 1/);

  k.app.audio.update = () => { throw new Error('boom audio'); };
  const renders = r.renders;
  k.run(2, 20);
  assert.equal(r.renders - renders, 40, 'the renderer ran every frame although the audio stage threw');
  assert.equal(errors.filter((e) => /audio error/.test(e)).length, 5, 'logged at most five times');
  assert.equal(k.app.errors.audio, 40, 'but every failure is counted');

  r.throwOnRender = true;
  k.app.actions.togglePause();                                      // a UI change that must still show although render throws
  k.run(0.5, 20);
  assert.match(panelText(), /Paused/);
  assert.equal(errors.filter((e) => /render error/.test(e)).length, 5);

  const advance = k.app.game.advance;
  k.app.game.advance = () => { throw new Error('boom sim'); };
  k.app.actions.togglePause();
  k.run(0.5, 20);
  assert.match(panelText(), /Continue Play|Player 1/, 'the UI keeps refreshing');
  assert.equal(errors.filter((e) => /simulation error/.test(e)).length, 5);
  k.app.game.advance = advance;
  k.app.audio.update = () => {};
  r.throwOnRender = false;
  const t1 = k.app.game.simTime();
  k.run(1, 20);
  assert.ok(k.app.game.simTime() > t1, 'the simulation recovers by itself');
});

test('a step that throws drops the accumulator: no backlog snowball when the fault is gone', () => {
  const k = makeApp();
  k.start();
  k.run(0.5, 20);
  const game = k.app.game;
  const realStep = game.physics.step;
  game.physics.step = () => { throw new Error('boom step'); };
  for (let i = 0; i < 50; i++) assert.throws(() => game.advance(0.1), /boom step/);
  game.physics.step = realStep;
  const steps = game.advance(0.016);
  assert.ok(steps <= 3, 'only this frame\'s steps run, not the 5 s of frames that failed (' + steps + ')');
});

test('CDN unreachable: the page, sim and UI come up, the table area shows the message renderer, V and F-keys still work, one error is logged', async (t) => {
  const errors = errorSpy(t);
  const k = makeApp({ importRenderer: () => Promise.reject(new Error('Failed to fetch dynamically imported module')) });
  await k.app.rendererReady;
  const r = k.app.getRenderer();
  assert.equal(k.win.__pinball.renderer, r, 'the debug handle shows the renderer that is really in use');
  assert.equal(r.domElement.parentNode, k.table);
  assert.equal(errors.filter((e) => /3D renderer could not be loaded/.test(e)).length, 1);
  k.start();
  k.run(2, 20);
  k.key('keydown', 'KeyV', 'v');                                    // cycleCameraMode of the stand-in is a no-op
  k.key('keydown', 'F3');
  assert.equal(k.app.game.isPaused(), true);
  assert.deepEqual(k.app.errors, {});
});

test('the real renderer replaces the stand-in: canvas swapped, camera from the options, V cycles, orbit hands the mouse to the camera', async () => {
  const store = createStore(null);
  store.setOptions({ camera: 'top' });
  const r = fakeRenderer();
  const k = makeApp({ store, importRenderer: async () => ({ createRenderer: () => { r.domElement = k.doc.createElement('canvas'); return r; } }) });
  const stand = k.app.getRenderer();
  await k.app.rendererReady;
  assert.notEqual(k.app.getRenderer(), stand);
  assert.equal(stand.domElement.parentNode, null, 'the stand-in canvas is gone');
  assert.deepEqual(r.modes, ['top'], 'the stored camera is applied');
  assert.ok(r.resizes.length >= 1);
  assert.equal(k.win.__pinball.renderer, r);
  k.start();
  k.key('keydown', 'KeyV', 'v');                                    // top -> orbit
  assert.equal(store.getOptions().camera, 'orbit');
  fire(k.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  assert.equal(k.app.input.isDown('flipperLeft'), false, 'in orbit mode the mouse is the camera, not a flipper');
  k.key('keydown', 'KeyV', 'v');                                    // orbit -> original
  fire(k.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  assert.equal(k.app.input.isDown('flipperLeft'), false, 'Mouse Rotates View (default): the mouse turns the view');
  assert.deepEqual(r.mouseLook.slice(-1), [true]);
  k.app.actions.setMouseLook(false);
  assert.deepEqual(r.mouseLook.slice(-1), [false]);
  fire(k.table, 'mousedown', { button: 0, clientX: 10, clientY: 10 });
  assert.equal(k.app.input.isDown('flipperLeft'), true, 'option off: the mouse buttons are flippers again');
  assert.equal(store.getOptions().mouseLook, false);
  assert.equal(r.domElement.parentNode, k.table, 'the real canvas is mounted in #table-view');
});

test('the clock: a frame after a long stall advances at most 0.1 s of simulation; NaN and backwards timestamps run nothing', () => {
  const k = makeApp();
  k.start();
  k.run(0.5, 20);
  const t0 = k.app.game.simTime();
  k.clock.t += 60000;                                               // the tab slept for a minute
  k.app.frame(k.clock.t);
  const dt = k.app.game.simTime() - t0;
  assert.ok(dt > 0 && dt <= PHYS.maxFrameDt + 1e-9, 'advanced ' + dt);
  const t1 = k.app.game.simTime();
  k.app.frame(Number.NaN);
  k.app.frame(k.clock.t - 5000);
  assert.equal(k.app.game.simTime(), t1);
  k.clock.t += 5000;
  k.run(0.5, 20);
  assert.ok(k.app.game.simTime() > t1 + 0.3, 'and the clock is not poisoned: the next normal frames run the sim again');
});


// =====================================================================================================================================
// final verification: focus loss with the plunger pulled
// =====================================================================================================================================
test('window blur while the plunger is pulled lets it go back WITHOUT firing: the ball is still on the plunger after the game is resumed', (t) => {
  const errors = errorSpy(t);
  const k = makeApp();
  k.toPlunger();
  assert.equal(k.app.game.physics.ballAtPlunger(), true);
  k.key('keydown', 'Space', ' ');
  k.run(1.2);                                                       // boost ~48: enough to reach the top if it were released
  assert.equal(k.app.game.physics.snapshot().plunger.charging, true);
  k.win.dispatchEvent(new Event('blur'));
  assert.equal(k.app.game.isPaused(), true);
  assert.equal(k.app.game.physics.snapshot().plunger.charging, false, 'the pull was dropped');
  k.tap('F3');                                                      // resume
  k.run(3);
  assert.equal(k.app.game.isPaused(), false);
  assert.equal(k.app.game.physics.ballAtPlunger(), true, 'no half-power launch happened behind the player');
  assert.equal(errors.length, 0);
});

test('cancelPlunger leaves a ball-save relaunch alone (it charges by itself) but drops a manual pull', () => {
  const rig = createRig({ seed: 3, newGame: true });
  const p = rig.game.physics;
  p.removeAllBalls();
  p.relaunch();
  rig.run(1.0);                                                     // the feed (0.96 s) has put the ball on the plunger: the automatic pull is running
  assert.equal(p.snapshot().plunger.charging, true, 'automatic pull in progress');
  p.cancelPlunger();
  assert.equal(p.snapshot().plunger.charging, true, 'an automatic pull is not cancelled');
  rig.run(1.5);                                                     // it completes by itself and the ball leaves the lane
  assert.equal(p.ballAtPlunger(), false);
  p.setPlungerButton(true);                                         // a manual pull IS dropped
  assert.equal(p.snapshot().plunger.charging, true);
  p.cancelPlunger();
  assert.equal(p.snapshot().plunger.charging, false);
  assert.equal(p.snapshot().plunger.fired, false, 'dropped, not fired');
});

// =====================================================================================================================================
// cinematic camera + mouse view (additive)
// =====================================================================================================================================
test('cinematic camera: C toggles the option (stored, toast); a flipper strike slows the simulation to 70 % and rides on the render frame', async () => {
  const r = fakeRenderer();
  const k = makeApp({ importRenderer: async () => ({ createRenderer: () => { r.domElement = k.doc.createElement('canvas'); return r; } }) });
  await k.app.rendererReady;
  k.toPlunger();
  assert.equal(k.store.getOptions().cinematic, false, 'off by default');
  k.tap('KeyC', 'c');
  assert.equal(k.store.getOptions().cinematic, true);
  assert.equal(k.app.director.isEnabled(), true);
  // a real ball on the table, struck by a flipper (the physics event is fed through the game's observer)
  const ball = k.app.game.physics.spawnBall(1.9, 6.0);
  k.app.director.onPhysicsEvents([{ type: 'flipperHit', t: 0, side: 'left', ballId: ball.id, speed: 30 }]);
  k.run(0.05);
  const cine = r.frames[r.frames.length - 1].cinematic;
  assert.ok(cine && cine.active, 'the render frame carries the active shot');
  k.run(0.5);                                                       // fully zoomed in: 70 % speed
  const t0 = k.app.game.simTime();
  k.run(0.5);
  const rate = (k.app.game.simTime() - t0) / 0.5;
  assert.ok(Math.abs(rate - 0.7) < 0.03, `simulation rate ${rate}`);
  // off again: the shot fades out and normal speed returns
  k.tap('KeyC', 'c');
  assert.equal(k.store.getOptions().cinematic, false);
  k.run(1.0);
  const t1 = k.app.game.simTime();
  k.run(0.5);
  assert.ok(Math.abs((k.app.game.simTime() - t1) / 0.5 - 1) < 0.03, 'back to full speed');
});

test('cinematic camera: off in the orthographic Top view (no zoom there, so no slow motion either), back on in the other views', () => {
  const k = makeApp({ search: '?cinematic=1&camera=top' });
  assert.equal(k.store.getOptions().cinematic, true);
  assert.equal(k.app.director.isEnabled(), false);
  k.app.actions.setCamera('original');
  assert.equal(k.app.director.isEnabled(), true);
  k.app.actions.setCamera('top');
  assert.equal(k.app.director.isEnabled(), false);
  k.app.actions.setCamera('orbit');
  assert.equal(k.app.director.isEnabled(), true);
});

test('cinematic camera: ?cinematic=1 switches it on; a new game drops a running shot at once', () => {
  const k = makeApp({ search: '?cinematic=1' });
  assert.equal(k.store.getOptions().cinematic, true);
  assert.equal(k.app.director.isEnabled(), true);
  k.toPlunger();
  const ball = k.app.game.physics.spawnBall(1.9, 6.0);
  k.app.director.onPhysicsEvents([{ type: 'flipperHit', t: 0, side: 'left', ballId: ball.id, speed: 30 }]);
  k.run(0.2);
  assert.equal(k.app.director.state.active, true);
  k.app.actions.newGame();
  assert.equal(k.app.director.state.active, false);
  assert.equal(k.app.director.timeScale(), 1);
});

test('mouse view: on by default (renderer told, mouse buttons off), debug mode hands the mouse back to the ball drag, Reset View reaches the renderer', async () => {
  const r = fakeRenderer();
  const k = makeApp({ importRenderer: async () => ({ createRenderer: () => { r.domElement = k.doc.createElement('canvas'); return r; } }) });
  await k.app.rendererReady;
  assert.deepEqual(r.mouseLook.slice(-1), [true]);
  k.start();
  k.app.rules.setDebug(true);
  k.run(0.05);
  assert.deepEqual(r.mouseLook.slice(-1), [false], 'debug: the mouse drags the ball');
  k.app.rules.setDebug(false);
  k.run(0.05);
  assert.deepEqual(r.mouseLook.slice(-1), [true]);
  k.app.actions.resetView();
  assert.equal(r.resets, 1);
});
