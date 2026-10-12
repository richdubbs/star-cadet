/**
 * src/main.js
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 12 (main loop, pause, demo, start flow, debug handle), 8.1 (DOM mount points), 8.9 (UIActions), 10.6 (sound start flow),
 *           11 (input routing)
 *
 * The ONLY module that knows every other module.  Browser entry point (loaded by index.html as <script type="module">).  Builds the services
 * (store, audio, game, art, UI, input, renderer), connects them and runs the animation loop:
 *   input (DOM handlers, between frames) -> game.advance(frameDt) [physics@120Hz -> rules events -> rules timers -> lamps]
 *   -> audio.update -> renderer.render(game.buildRenderFrame) -> ui.update.
 * The only global is window.__pinball = { game, physics, lamps, rules, audio, ui, renderer, input, data, store, art, actions, cinematic } (debugging only).
 *
 * URL flags: ?demo ?seed=<int> ?camera=original|top|orbit ?cinematic=1|0 ?nosound ?quality=low|high ?touch=1 ?debug=1
 *
 * Cinematic camera (Options > Cinematic Camera, key C): the director (render/cinematic.js) watches the physics events through game's
 * onPhysicsEvents observer and the render frame; its timeScale() slows the NEXT frame's simulation (game.advance(dt * scale), 70 % during a
 * shot) and its state rides on the render frame (frame.cinematic) to the camera. Mouse view (Options > Mouse Rotates View, on by default): the
 * renderer turns the original camera with the mouse and the mouse buttons stop working the flippers (input.setMouseButtons(false)); touch is
 * unchanged and debug mode keeps the mouse for dragging the ball.
 *
 * Structure: createApp(env) is the whole shell and touches the page ONLY through `env` (document, window, location.search, clock, rAF,
 * renderer loader), so tests/integration_app.test.mjs can run it in Node on a fake DOM; the last lines call it with the real page when a
 * `document` exists (importing this file in Node does nothing).
 *
 * ASSUMPTIONS (gap protocol):
 *  - The renderer module (and with it three.js from the CDN) is imported dynamically.  The page, menus, panel, start card and the sim come up
 *    first; if the CDN is unreachable the table area shows a message instead of killing the whole page.
 *  - Game keys are blocked (input.setBlocked) while the start card, a menu or a dialog is open.  Opening a menu or a dialog during a running
 *    non-demo game pauses it; closing the last one resumes it, but only if that open caused the pause.
 *  - Window blur pauses a running game (not the demo); a hidden tab pauses everything.  Focus never resumes a game by itself (F3 / Resume
 *    button); only the attract mode (demo) that a hidden tab paused carries on when the tab returns.
 *  - Choosing New Game / a player count / Launch from the menu while the start card is still up behaves like "Start without sound" unless the
 *    sound consent was already granted.  Switching Sounds ON (menu / F5) or loading own files counts as consent and starts the load.
 *  - ?demo with a remembered sound consent loads the files at once but creates the AudioContext only at the first click / key / touch (the
 *    browser refuses to start one earlier and a context created blindly would stay silent).
 *  - Coarse-pointer (touch) devices cap the device pixel ratio at 1.5.
 *  - An exception in one stage of a frame (simulation, audio, render, UI, shell) is reported (at most 5 times per stage) and does not stop the
 *    other stages or the loop, so a failing renderer never freezes the scoreboard and menus and dialogs stay usable.
 *  - The folder picker of the Audio facade (showDirectoryPicker) is not wired: the UI's own "Load My Sounds" inputs (folder / zip) and drag and drop cover it.
 */
import * as data from './data/index.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { paintAll } from './render/art/index.js';
import { mulberry32 } from './render/art/rng.js';
import { createUI } from './ui/index.js';
import { createStore } from './ui/storage.js';
import { createCinematicDirector } from './render/cinematic.js';

/** At most this many console errors per frame stage (a persistent fault must not flood the console 60 times a second). */
const ERROR_LOG_LIMIT = 5;

/** Minimal Renderer stand-in used until (or instead of) the real one: shows a message on a 2D canvas, never throws. */
function createMessageRenderer(doc, message) {
  const canvas = doc.createElement('canvas');
  let mode = 'original';
  const paint = () => {
    const w = canvas.width = Math.max(1, canvas.clientWidth || 365);
    const h = canvas.height = Math.max(1, canvas.clientHeight || 416);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#05050c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9c9d8'; g.textAlign = 'center';
    g.font = `${Math.max(12, Math.round(w / 20))}px system-ui, sans-serif`;
    const lines = String(message).split('\n');
    lines.forEach((line, i) => g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * Math.max(16, Math.round(w / 15))));
  };
  return {
    domElement: canvas,
    resize() { paint(); },
    render() {},
    setCameraMode(m) { mode = m; },
    getCameraMode: () => mode,
    cycleCameraMode() { return mode; },
    pickTable: () => null,
    setQuality() {},
    info: () => ({ drawCalls: 0, triangles: 0, textures: 0 }),
    dispose() {},
  };
}

/** Last-resort error display (the page must never stay blank without telling the visitor why). */
function showFatal(err) {
  console.error(err);
  const host = document.getElementById('stage') || document.body;
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:absolute;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:#000c;color:#f0c8c8;text-align:center;font:14px system-ui,sans-serif';
  box.textContent = 'Star Cadet could not start: ' + (err && err.message ? err.message : String(err));
  host.appendChild(box);
}

/**
 * Build the whole application on a page.
 * @param {{
 *   doc: any, win: any,                                             the document and window (or fakes with the same members)
 *   search?: string,                                                location.search
 *   coarse?: boolean,                                               matchMedia('(pointer: coarse)').matches
 *   now?: () => number, raf?: (cb: (t: number) => void) => any,     clock (ms) and requestAnimationFrame
 *   ResizeObserver?: any,                                           observer class (optional)
 *   importRenderer?: () => Promise<{createRenderer: Function}>,     loader of src/render/index.js (default: dynamic import)
 *   createArt?: (opts: object) => any,                              default: paintAll(data, opts)
 *   store?: any, audio?: any,                                       service doubles (tests)
 * }} env
 */
export function createApp(env) {
  const { doc, win } = env;
  const q = new URLSearchParams(env.search || '');
  const coarse = Boolean(env.coarse);
  const now = env.now || (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  const raf = env.raf || ((cb) => requestAnimationFrame(cb));
  const store = env.store || createStore();
  let options = store.getOptions();
  if (q.get('camera')) options = store.setOptions({ camera: /** @type {any} */ (q.get('camera')) });
  if (q.has('cinematic')) options = store.setOptions({ cinematic: q.get('cinematic') !== '0' });
  if (q.has('nosound')) options = store.setOptions({ sounds: false, soundConsent: 'denied' });
  const seed = q.get('seed');
  const rand = seed !== null && seed !== '' && Number.isFinite(Number(seed)) ? mulberry32(Number(seed)) : Math.random;
  const qualityFlag = q.get('quality');

  // ---- services -----------------------------------------------------------------------------------------------------------------------
  const audio = env.audio || createAudio();
  /** false after "Start without sound" (or ?nosound): then the page never touches the audio hardware or the network for sound */
  const wantsSound = () => options.sounds && options.soundConsent !== 'denied';
  audio.setEnabled(wantsSound());
  audio.setVolume(options.volume);
  const director = createCinematicDirector();
  /** The cinematic camera needs a perspective camera: the orthographic Top view keeps it (and its slow motion) off. */
  const syncDirector = () => director.setEnabled(Boolean(options.cinematic) && options.camera !== 'top');
  syncDirector();
  const game = createGame({ sound: audio, rand, onPhysicsEvents: (events) => director.onPhysicsEvents(events) });
  const rules = game.rules;
  const savedScores = store.getHighScores();
  if (savedScores) rules.highScores.load(savedScores);
  rules.highScores.onChange = (entries) => store.setHighScores(entries);

  const artOpts = {
    createCanvas: (w, h) => Object.assign(doc.createElement('canvas'), { width: w, height: h }),
    quality: qualityFlag === 'low' ? 'low' : qualityFlag === 'high' ? 'high' : 'normal',
  };
  const art = env.createArt ? env.createArt(artOpts) : paintAll(data, artOpts);

  // ---- shared state of the shell --------------------------------------------------------------------------------------------------------
  /** @type {import('./types.js').Renderer} */
  let renderer = createMessageRenderer(doc, 'Loading the table...');
  let ui = /** @type {import('./types.js').UI} */ (/** @type {any} */ (null));
  let input = /** @type {import('./types.js').Input} */ (/** @type {any} */ (null));
  let showFps = false;
  let wasDebug = false;
  const view = () => rules.getView();
  /** Keep the input's debug flag equal to the rules' one (the typed cheat 'hidden test' toggles it inside the rules). */
  const syncDebug = () => {
    const d = Boolean(view().debug);
    if (d === wasDebug) return;
    wasDebug = d;
    input.setDebug(d);
    applyMouseMode();
    if (!d && showFps) { showFps = false; ui.setFps(null); }
  };
  /** The mouse turns the view (Mouse Rotates View, not while debug mode drags the ball) or works the flippers. */
  function applyMouseMode() {
    if (typeof renderer.setMouseLook === 'function') renderer.setMouseLook(Boolean(options.mouseLook) && !view().debug);
    if (input && typeof input.setMouseButtons === 'function') input.setMouseButtons(!options.mouseLook);
  }
  const inGame = () => view().phase === 'lightShow' || view().phase === 'playing';
  const startEl = () => doc.getElementById('start-overlay');
  const overlayShown = () => { const el = startEl(); return Boolean(el && !el.hidden); };
  const setOpts = (patch) => { options = store.setOptions(patch); if (ui) ui.setOptions(options); return options; };
  const showStart = () => ui.showStartOverlay({ soundStatus: audio.getStatus() });

  // ---- blocking and auto pause ----------------------------------------------------------------------------------------------------------
  const open = { dialog: false, menu: false };
  let lastBlocked = false;
  const syncBlocked = () => {
    if (!input) return;                                            // the UI may report an open dialog while it is still being built
    const b = open.dialog || open.menu || overlayShown();
    if (b !== lastBlocked) { lastBlocked = b; input.setBlocked(b); }
  };
  let autoPaused = false;
  /** A hidden tab paused the attract mode (not a human game): it carries on when the tab is visible again. */
  let hiddenDemoPause = false;
  function setPaused(on) {
    game.setPaused(on);
    audio.setPaused(on);
  }
  function syncAutoPause() {
    const want = open.dialog || open.menu;
    if (want && !autoPaused && inGame() && !view().demo && !game.isPaused()) { autoPaused = true; setPaused(true); }
    else if (!want && autoPaused) { autoPaused = false; setPaused(false); }
  }
  function clearPause() {
    autoPaused = false;
    hiddenDemoPause = false;
    if (game.isPaused()) setPaused(false);
  }

  // ---- UI actions (UI -> application) ---------------------------------------------------------------------------------------------------
  const consented = () => options.soundConsent === 'granted' && options.sounds;
  function requestSounds() {
    audio.unlock();                                                // synchronous: the caller runs inside a user gesture
    audio.setEnabled(true);
    return audio.load().then((s) => { ui.setSoundStatus(s); return s; });
  }
  /** ?demo with a remembered consent: fetch now, create the AudioContext at the first gesture (see the header). */
  function requestSoundsQuietly() {
    audio.setEnabled(true);
    audio.unlockOnGesture();
    return audio.load().then((s) => { ui.setSoundStatus(s); return s; });
  }
  function startMusicIfWanted() {
    if (options.music) { audio.music.setEnabled(true).catch(() => {}); if (typeof audio.music.restart === 'function') audio.music.restart(); }
  }
  /** Begin a game from the start card's defaults (menu commands used while the card is still up). */
  function ensureStarted() {
    if (!overlayShown()) return false;
    actions.start({ withSound: consented(), players: options.players, music: consented() && options.music });
    return true;
  }

  /** What an import of the user's own files (picker or drop) did, in words. @param {{matched:number, accepted:number, rejected:number, music:boolean}} r */
  function importMessage(r) {
    if (r.accepted > 0) return `Loaded ${r.accepted} sound file${r.accepted === 1 ? '' : 's'} from your files.`;
    if (r.music) return 'Loaded the music file from your files.';
    if (r.rejected > 0) return 'Those files do not match the original game sounds (another version, or damaged), so they were not used.';
    if (r.matched > 0) return 'Those sound files are already loaded.';
    return 'No matching Pinball sound files were found in your selection.';
  }
  /** After an import: show the status and, when something usable arrived, switch sounds on (the user obviously wants to hear it). */
  function afterImport(status) {
    ui.setSoundStatus(status);
    const r = audio.getLastImport();
    if (r.accepted > 0 || r.music) { setOpts({ sounds: true, soundConsent: 'granted' }); audio.setEnabled(true); audio.unlock(); }
    ui.toast(importMessage(r), 3500);
  }

  /** @type {import('./types.js').UIActions} */
  const actions = {
    start({ withSound, players, music }) {
      setOpts({ players: /** @type {any} */ (players), sounds: withSound, music: withSound && music, soundConsent: withSound ? 'granted' : 'denied' });
      audio.setEnabled(withSound);
      if (withSound) audio.unlock();                               // synchronously inside the click (user gesture); a silent start creates no context
      if (withSound) audio.load().then((s) => ui.setSoundStatus(s));
      if (withSound && music) audio.music.setEnabled(true).catch(() => {});
      ui.hideStartOverlay();
      syncBlocked();
      clearPause();
      director.reset();
      rules.newGame({ players });
    },
    newGame() {
      if (ensureStarted()) return;
      clearPause();
      startMusicIfWanted();
      director.reset();
      rules.newGame({ players: options.players });
    },
    launchBall() { if (!overlayShown()) rules.launchBall(); },
    togglePause() {
      if (view().phase === 'idle' || overlayShown()) return;
      autoPaused = false;
      hiddenDemoPause = false;
      setPaused(!game.isPaused());
    },
    toggleDemo() {
      if (wantsSound()) audio.unlock();
      if (overlayShown()) { ui.hideStartOverlay(); syncBlocked(); }
      clearPause();
      director.reset();
      const turnOn = !view().demo;
      rules.setDemo(turnOn);
      if (turnOn) startMusicIfWanted();
    },
    showHighScores() { ui.showHighScores(rules.highScores.entries(), { clearable: true }); },
    exit() {
      clearPause();
      audio.stopAll();
      audio.music.stop();                                          // the start card is not a game: no music behind it
      director.reset();
      rules.stopGame();
      showStart();
      syncBlocked();
    },
    selectPlayers(n) {
      setOpts({ players: /** @type {any} */ (n) });
      if (ensureStarted()) return;
      clearPause();
      rules.newGame({ players: n });
    },
    setSounds(on) {
      setOpts({ sounds: on, ...(on ? { soundConsent: /** @type {any} */ ('granted') } : {}) });
      audio.setEnabled(on);
      if (on) {
        const st = audio.getStatus().state;
        if (st === 'idle' || st === 'unavailable') { ui.toast('Loading the original sounds...'); requestSounds(); } else audio.unlock();
      }
    },
    setMusic(on) {
      setOpts({ music: on });
      audio.unlock();
      audio.music.setEnabled(on).then(() => {
        if (on && !audio.music.available()) ui.toast('Music not available: put PINBALL.MID into sounds/ or load your own files.', 4000);
      }).catch(() => {});
    },
    setVolume(v) { audio.setVolume(v); setOpts({ volume: v }); },
    toggleFullscreen() {
      const unavailable = () => ui.toast('Full screen is not available here.');
      try {
        if (doc.fullscreenElement) { const r = doc.exitFullscreen?.(); if (r && r.catch) r.catch(() => {}); return; }
        const el = doc.documentElement;
        if (!el || typeof el.requestFullscreen !== 'function') { unavailable(); return; }   // e.g. iPhone Safari: say so instead of doing nothing
        const r = el.requestFullscreen();
        if (r && r.catch) r.catch(unavailable);
      } catch { unavailable(); }
    },
    setCamera(m) { renderer.setCameraMode(m); input.setPointerFlippers(m !== 'orbit'); setOpts({ camera: m }); syncDirector(); },
    setCinematic(on) {
      setOpts({ cinematic: Boolean(on) });
      syncDirector();
      const top = options.camera === 'top';
      ui.toast(on ? (top ? 'Cinematic camera ON (not in the Top view: switch the camera with V).' : 'Cinematic camera ON: a flipper hit follows the ball in slow motion.') : 'Cinematic camera OFF', 2500);
    },
    setMouseLook(on) { setOpts({ mouseLook: Boolean(on) }); applyMouseMode(); },
    resetView() { if (typeof renderer.resetView === 'function') renderer.resetView(); },
    submitName(name) { rules.submitName(name); },
    clearHighScores() { rules.highScores.clear(); },
    setBindings(b) { input.setBindings(b); store.setBindings(input.getBindings()); },
    resetBindings() { const b = input.defaultBindings(); input.setBindings(b); store.setBindings(b); },
    loadLocalSounds(files) {
      audio.unlock();                                              // inside the picker gesture
      audio.loadFromFiles(files).then(afterImport);
    },
  };

  const bindings = store.getBindings() || { ...data.DEFAULT_KEYS };
  ui = createUI({
    root: doc.getElementById('app') || doc.body, doc, store, actions, panelArt: art.panel, options, bindings,
    onDialogChange(o) { open.dialog = o; syncBlocked(); syncAutoPause(); },
    onMenuChange(o) { open.menu = o; syncBlocked(); syncAutoPause(); },
  });
  audio.onStatus((s) => ui.setSoundStatus(s));
  ui.setSoundStatus(audio.getStatus());
  audio.attachDropTarget(doc, afterImport);                         // a Pinball folder / zip dropped anywhere on the page

  // ---- input routing ------------------------------------------------------------------------------------------------------------------
  const APP = {
    newGame: actions.newGame, launchBall: actions.launchBall, pause: actions.togglePause, fullscreen: actions.toggleFullscreen,
    sounds: () => actions.setSounds(!options.sounds), music: () => actions.setMusic(!options.music),
    controls: () => ui.showControls(input.getBindings()), help: () => ui.showHelp(), camera: () => actions.setCamera(renderer.cycleCameraMode()),
    cinematic: () => actions.setCinematic(!options.cinematic),
  };
  input = createInput({
    bindings, target: win, doc,
    onFocusLoss: () => rules.focusLost(),
    onEvent(e) {
      switch (e.kind) {
        case 'game': rules.input(e.action, e.down); break;
        case 'app': { const fn = APP[e.action]; if (fn) fn(); break; }
        case 'cheat': rules.cheat(e.word); syncDebug(); break;
        case 'debug':
          if (e.key === 'Y') { showFps = !showFps; if (!showFps) ui.setFps(null); } else rules.debugKey(/** @type {any} */ (e.key));
          break;
        case 'pointer': {
          if (e.phase === 'up') { game.physics.debugRelease(); break; }
          const p = renderer.pickTable(e.clientX, e.clientY);
          if (!p) break;
          if (e.phase === 'down') game.physics.debugGrab(p[0], p[1]); else game.physics.debugDrag(p[0], p[1]);
          break;
        }
        default: break;
      }
    },
  });
  input.attach();
  input.setPointerFlippers(options.camera !== 'orbit');
  applyMouseMode();
  syncBlocked();

  // ---- focus: pause instead of letting the ball drain behind the user's back --------------------------------------------------------------
  function onFocusLost(hidden) {
    rules.focusLost();                 // first: a pulled plunger goes back without firing, so the key-up that releaseAll() sends has nothing left to launch
    input.releaseAll();
    if (view().phase === 'idle' || overlayShown()) return;
    if (hidden || !view().demo) {
      autoPaused = false;
      if (hidden && view().demo && !game.isPaused()) hiddenDemoPause = true;
      setPaused(true);
    }
  }
  function onFocusGained() {
    rules.focusGained();
    if (hiddenDemoPause) {
      hiddenDemoPause = false;
      if (game.isPaused() && view().demo) setPaused(false);
    }
  }
  win.addEventListener('blur', () => onFocusLost(false));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) onFocusLost(true); else onFocusGained(); });
  doc.addEventListener('fullscreenchange', () => setOpts({ fullscreen: Boolean(doc.fullscreenElement) }));

  // ---- the renderer (three.js is loaded from the CDN; failure leaves the rest of the page working) ----------------------------------------
  const tableView = doc.getElementById('table-view');
  const mount = (r) => {
    if (tableView && r.domElement) tableView.appendChild(r.domElement);
  };
  const unmount = (r) => {
    if (r.domElement && r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
  };
  mount(renderer);
  const resize = () => {
    if (!tableView) return;
    const r = tableView.getBoundingClientRect();
    renderer.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), win.devicePixelRatio || 1);
  };
  const ResizeObserverCtor = env.ResizeObserver;
  if (typeof ResizeObserverCtor === 'function' && tableView) new ResizeObserverCtor(resize).observe(tableView);
  win.addEventListener('resize', resize);
  resize();
  const importRenderer = env.importRenderer || (() => import('./render/index.js'));
  const rendererReady = (async () => {
    try {
      const { createRenderer } = await importRenderer();
      const quality = qualityFlag === 'low' ? { shadows: false, bloom: false, dprMax: 1.5 } : qualityFlag === 'high' ? { shadows: true, bloom: true, dprMax: 3 } : { dprMax: coarse ? 1.5 : 2 };
      const real = createRenderer({ data, art, quality });
      unmount(renderer);
      renderer.dispose();
      renderer = real;
      mount(renderer);
      renderer.setCameraMode(options.camera);
      applyMouseMode();
      resize();
    } catch (err) {
      console.error('[main] the 3D renderer could not be loaded', err);
      unmount(renderer);
      renderer = createMessageRenderer(doc, 'The 3D table could not be loaded.\nCheck your internet connection (three.js\nis fetched from a CDN) and reload.');
      mount(renderer);
      resize();
    }
    if (win.__pinball) win.__pinball.renderer = renderer;
  })();

  // ---- the loop ---------------------------------------------------------------------------------------------------------------------------
  let last = now();
  let fpsFrames = 0;
  let fpsT = 0;
  /** @type {Record<string, number>} errors seen per stage */
  const errors = {};
  function fail(stage, err) {
    errors[stage] = (errors[stage] || 0) + 1;
    if (errors[stage] <= ERROR_LOG_LIMIT) console.error(`[main] ${stage} error`, err);
  }
  /** One animation frame; every stage is isolated, so one broken stage never freezes the others. @param {number} t DOMHighResTimeStamp (ms) */
  function frame(t) {
    raf(frame);
    let dt = (t - last) / 1000;
    if (!(dt > 0)) dt = 0;
    else if (dt > data.PHYS.maxFrameDt) dt = data.PHYS.maxFrameDt;
    last = t;
    try { game.advance(dt * director.timeScale()); } catch (err) { fail('simulation', err); }   // physics@120Hz -> rules events -> rules timers -> lamps (slow motion during a cinematic shot)
    try { audio.update(dt); } catch (err) { fail('audio', err); }
    try {
      const rf = game.buildRenderFrame(dt);
      const v = view();
      director.update({ balls: rf.physics ? rf.physics.balls : [], time: rf.time, score: v.score, player: v.player, playing: v.phase === 'playing', tilted: v.tilted, paused: game.isPaused() }, dt);
      rf.cinematic = director.state;
      renderer.render(rf);
    } catch (err) { fail('render', err); }
    try { ui.update(view(), dt); syncDebug(); } catch (err) { fail('ui', err); }
    try {
      syncBlocked();
      if (showFps) { fpsFrames++; fpsT += dt; if (fpsT >= 0.5) { ui.setFps(Math.round(fpsFrames / fpsT)); fpsFrames = 0; fpsT = 0; } }
    } catch (err) { fail('shell', err); }
  }
  raf(frame);

  /** The single allowed global (debugging only; nothing reads it). */
  win.__pinball = { game, physics: game.physics, lamps: game.lamps, rules, audio, ui, renderer, input, data, store, art, actions, cinematic: director };

  setOpts({});
  if (q.get('debug') === '1') { rules.setDebug(true); syncDebug(); }
  if (q.has('demo')) {
    if (consented()) { requestSoundsQuietly(); startMusicIfWanted(); }
    rules.setDemo(true);
  } else {
    showStart();
    syncBlocked();
  }

  return { game, rules, audio, ui, input, store, art, actions, frame, getRenderer: () => renderer, rendererReady, errors, director };
}

// ---- browser entry (importing this module in Node, where there is no document, only defines createApp) ----------------------------------------
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  try {
    createApp({
      doc: document, win: window, search: location.search,
      coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
      now: () => performance.now(), raf: (cb) => requestAnimationFrame(cb), ResizeObserver: window.ResizeObserver,
    });
  } catch (err) {
    showFatal(err);
  }
}
