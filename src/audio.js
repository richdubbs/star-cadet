/**
 * src/audio.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10 (+ sound policy 0.2 #4); SPEC 7; type Audio (src/types.js)
 * Facade: createAudio(opts) -> Audio (also a SoundPort for rules). Safe to import and use in Node: fetch / AudioContext /
 * crypto.subtle / indexedDB / document are touched only inside methods, and only through opts when given. NOTHING is requested at
 * import or creation time; the network starts only from load() (the user-gesture start flow) or music.setEnabled(true).
 *
 * Contract highlights:
 *  - play(key) ALWAYS returns soundDuration(key) (manifest bytes/11000; -1 for the six missing files and unknown keys), never
 *    throws, and plays the decoded buffer only when unlocked, enabled, not paused, the context is running and the file is loaded.
 *    Gameplay timers therefore never depend on decoded buffers, and a silent game has identical timing.
 *  - load(): per file cache -> ./sounds -> Internet Archive S1 -> S5 (src/audio/loader.js), validated by size + SHA-1, decoded
 *    with the AudioContext, 8-voice mixer with oldest-steal, master / sfx / music gains and mute (src/audio/mixer.js).
 *  - loadFromFiles(files): the user's own folder / zip / files (src/audio/userfiles.js); only bytes that validate are used.
 *  - music: optional built-in MIDI synth (src/audio/music.js), default OFF, PINBALL.MID from ./sounds or S1 only.
 *
 * Extra createAudio options (all optional, mainly for tests): cache (object | false), indexedDB, log(...args), sleep(ms), setTimer / clearTimer
 * (music scheduler), document, window (feature detection of showDirectoryPicker), localMissLimit, discoverLocal (false = no ./sounds/ listing).
 * Additive members (not in types.js; INTEGRATOR may wire them): pickDirectory(), canPickDirectory(), attachDropTarget(el, onDone?),
 * setSfxVolume(v), setMusicVolume(v), getLastImport(), getSourceMap(), dispose(); music.restart()/retry()/tick(); onStatus() returns an unsubscribe function;
 * unlockOnGesture() (for a caller that is not inside a user gesture: creates + resumes the context at the first click / key / touch).
 *
 * ASSUMPTIONS:
 *  - Master Sounds switch (setEnabled) mutes effects only; music has its own switch. setVolume is the master gain for both.
 *  - AudioStatus.loaded counts validated sound files (of the 41 in the manifest); 'ready' = all 41, 'partial' = some, 'unavailable' =
 *    tried and none. source is the single origin of the loaded files or 'mixed'; the text for S1 / S5 is 'Internet Archive'.
 *  - AudioBuffer.duration is never used for gameplay; the first accepted WAV's RIFF 'fmt ' chunk is console.info'd once (SPEC 7.2).
 *  - If the context is blocked by autoplay rules (e.g. ?demo without a click), every pointer / key / touch event retries the resume until the
 *    context runs (the listener is armed synchronously by unlock(): a resume() without a gesture may never settle, so no promise is waited for).
 *    A suspend() that is still in flight is awaited before a resume() (a quick pause / resume pair must not leave the context suspended).
 *  - While a user import runs the validated files are cached in the user's own IndexedDB too (same cache as downloaded files).
 */
import { createCache } from './audio/cache.js';
import { loadSounds } from './audio/loader.js';
import { Mixer } from './audio/mixer.js';
import { createMusic } from './audio/music.js';
import { resolveSoundData } from './audio/sources.js';
import { attachDropTarget as attachDrop, pickDirectory as pickDir, pickSoundFiles, supportsDirectoryPicker } from './audio/userfiles.js';
import { readWavFormat, sha1Hex, validateBytes } from './audio/validate.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** @param {import('./types.js').CreateAudioOpts & Record<string, any>} [opts] @returns {import('./types.js').Audio} */
export function createAudio(opts = {}) {
  const o = opts || {};
  const D = resolveSoundData(o.data);
  const fileKeys = Object.keys(D.SOUND_FILES);
  const total = fileKeys.length;
  const log = typeof o.log === 'function' ? o.log : (...args) => { try { console.info(...args); } catch { /* no console */ } };

  // ---- state ---------------------------------------------------------------------------------------------------------------
  let enabled = true;
  let paused = false;
  let volume = 1;
  let sfxVolume = 1;
  let musicVolume = 1;
  let ctx = null;
  let mixer = null;
  /** the document-level gesture listener while armed (see armGesture) */
  let gestureFn = null;
  /** set by unlock() / unlockOnGesture(): somebody wants an AudioContext (an armed gesture listener may create it) */
  let contextWanted = false;
  /** promise of a ctx.suspend() that has not settled yet (a resume() must queue behind it) */
  let suspending = null;
  let attempted = false;
  let formatLogged = false;
  /** validated bytes per file key */
  const rawFiles = new Map();
  /** where each key came from: 'local' | 'S1' | 'S5' | 'user' */
  const sourceOf = new Map();
  /** decoded AudioBuffers per file key */
  const buffers = new Map();
  const decoding = new Map();
  let musicBytes = null;
  let musicRequested = false;
  let musicPromise = null;
  let loadPromise = null;
  let cache; // undefined = not created yet, null = disabled
  let lastImport = { matched: 0, accepted: 0, rejected: 0, music: false };
  /** @type {import('./types.js').AudioStatus} */
  let status = { state: 'idle', loaded: 0, total, source: null, text: 'sound: not loaded' };
  /** @type {((s:import('./types.js').AudioStatus)=>void)[]} */
  const listeners = [];

  // ---- environment (resolved lazily, only when a method needs it) -----------------------------------------------------------
  const getFetch = () => {
    if (typeof o.fetch === 'function') return o.fetch;
    return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  };
  const getCtor = () => o.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext || null;
  const sha1Fn = typeof o.sha1 === 'function' ? o.sha1 : sha1Hex;
  const getCache = () => {
    if (cache === undefined) cache = o.cache === false ? null : (o.cache || createCache({ indexedDB: o.indexedDB }));
    return cache;
  };
  const cacheKeyFor = (key) => D.fileNameOf(key) + '|' + D.SOUND_FILES[key].sha1;

  // ---- status ----------------------------------------------------------------------------------------------------------------
  const loadedCount = () => { let n = 0; for (const k of rawFiles.keys()) if (hasOwn(D.SOUND_FILES, k)) n++; return n; };

  function sourceSummary() {
    const set = new Set();
    for (const [k, s] of sourceOf) if (rawFiles.has(k) && hasOwn(D.SOUND_FILES, k)) set.add(s);
    if (set.size === 0) return { source: null, label: '' };
    if (set.size === 1) {
      const s = [...set][0];
      return { source: s, label: s === 'local' ? 'local' : (s === 'user' ? 'your files' : 'Internet Archive') };
    }
    const allArchive = [...set].every((s) => s === 'S1' || s === 'S5');
    return { source: 'mixed', label: allArchive ? 'Internet Archive' : 'mixed' };
  }

  function refreshStatus() {
    const n = loadedCount();
    const { source, label } = sourceSummary();
    let state;
    let text;
    if (loadPromise) { state = 'loading'; text = `sound: loading ${n}/${total}...`; }
    else if (n >= total && total > 0) { state = 'ready'; text = `sound: original (${label})`; }
    else if (n > 0) { state = 'partial'; text = `sound: partial (${n}/${total})`; }
    else { state = attempted ? 'unavailable' : 'idle'; text = 'sound: not loaded'; }
    const next = { state, loaded: n, total, source: state === 'loading' && n === 0 ? null : source, text };
    const changed = next.state !== status.state || next.loaded !== status.loaded || next.source !== status.source
      || next.text !== status.text;
    status = next;
    if (changed) for (const cb of listeners.slice()) { try { cb({ ...status }); } catch { /* a listener's problem */ } }
  }

  // ---- context / decoding ------------------------------------------------------------------------------------------------------
  function decodeAudio(bytes) {
    return new Promise((resolve, reject) => {
      try {
        const p = ctx.decodeAudioData(bytes, resolve, reject); // callback form for old Safari, promise form everywhere else
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  function startDecode(key) {
    if (!ctx || buffers.has(key) || decoding.has(key)) return;
    const bytes = rawFiles.get(key);
    if (!bytes) return;
    const p = decodeAudio(bytes.slice(0)) // decodeAudioData detaches its argument: give it a copy
      .then((b) => { if (b) buffers.set(key, b); }, () => { /* undecodable: that sound stays silent */ })
      .then(() => { decoding.delete(key); });
    decoding.set(key, p);
  }

  const decodePending = () => { for (const key of rawFiles.keys()) startDecode(key); };
  const settleDecodes = async () => { while (decoding.size) await Promise.all([...decoding.values()]); };

  /** Take validated bytes into the pool. @returns {boolean} true when the key was new */
  function accept(key, buf, source) {
    if (rawFiles.has(key)) return false;
    rawFiles.set(key, buf);
    sourceOf.set(key, source);
    if (!formatLogged) {
      formatLogged = true;
      const f = readWavFormat(buf);
      if (f) {
        log(`[audio] ${D.fileNameOf(key)}: format ${f.format}, ${f.channels} ch, ${f.sampleRate} Hz, ${f.bitsPerSample} bit`
          + ' (expected PCM, 1 ch, 11025 Hz, 8 bit)');
      }
    }
    startDecode(key);
    return true;
  }

  function resumeContext() {
    if (!ctx || typeof ctx.resume !== 'function') return Promise.resolve();
    const go = () => {
      if (!ctx || ctx.state === 'running') return Promise.resolve();
      try {
        const r = ctx.resume();
        return r && typeof r.then === 'function' ? r.then(() => {}, () => {}) : Promise.resolve();
      } catch { return Promise.resolve(); }
    };
    // a suspend() still in flight whose state flip has not happened yet (browsers differ) must finish first: a resume() issued now would look
    // like a no-op and the context would end up suspended for good (a quick pause / resume pair, e.g. a menu opened and closed)
    return suspending && ctx.state === 'running' ? suspending.then(go) : go();
  }

  function suspendContext() {
    if (!ctx || typeof ctx.suspend !== 'function' || ctx.state !== 'running') return;
    try {
      const r = ctx.suspend();
      if (r && typeof r.then === 'function') {
        const p = r.then(() => {}, () => {}).then(() => { if (suspending === p) suspending = null; });
        suspending = p;
      }
    } catch { /* ignore */ }
  }

  /** A resume() that completes after the game was paused (the same key press paused it) must not leave the context running. */
  function afterRunning() {
    if (paused) suspendContext(); else music.notifyContext();
  }

  const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'keydown', 'touchend', 'click'];
  const gestureDoc = () => (o.document !== undefined ? o.document : globalThis.document);

  function disarmGesture() {
    const doc = gestureDoc();
    const fn = gestureFn;
    gestureFn = null;
    if (!fn || !doc || typeof doc.removeEventListener !== 'function') return;
    for (const e of GESTURE_EVENTS) { try { doc.removeEventListener(e, fn, true); } catch { /* ignore */ } }
  }

  /**
   * Autoplay policy: a context created or resume()d without a user gesture stays suspended (and a resume() issued then may never settle),
   * so the NEXT gestures (every one of them, until the context really runs) retry: they create the context when it was only wanted
   * (unlockOnGesture) and resume it otherwise. Armed synchronously by unlock() - never from a promise that might not settle.
   */
  function armGesture() {
    const doc = gestureDoc();
    if (gestureFn || !doc || typeof doc.addEventListener !== 'function') return;
    gestureFn = () => {
      if (paused) return;                                   // the resume that ends the pause does the job
      if (!ctx) { if (contextWanted) unlock(); return; }
      if (ctx.state === 'running') { disarmGesture(); return; }
      resumeContext().then(() => { if (ctx && ctx.state === 'running') { disarmGesture(); afterRunning(); } });
    };
    for (const e of GESTURE_EVENTS) { try { doc.addEventListener(e, gestureFn, true); } catch { /* ignore */ } }
  }

  // ---- music glue -----------------------------------------------------------------------------------------------------------------
  function ensureMusicBytes() {
    musicRequested = true;
    if (musicBytes) return Promise.resolve(musicBytes);
    if (!musicPromise) {
      musicPromise = (async () => {
        try {
          const r = await loadSounds({
            fetchImpl: getFetch(), sha1Fn, data: D, cache: getCache(), musicOnly: true, music: true, sleep: o.sleep, concurrency: 1,
            discoverLocal: o.discoverLocal !== false,
          });
          if (r.music) musicBytes = r.music;
        } catch { /* stay silent */ }
        return musicBytes;
      })();
      const clear = () => { musicPromise = null; };
      musicPromise.then(clear, clear);
    }
    return musicPromise;
  }

  const music = createMusic({
    getCtx: () => ctx,
    getDestination: () => (mixer ? mixer.getMusicDestination() : (ctx ? ctx.destination : null)),
    getBytes: ensureMusicBytes,
    setTimer: o.setTimer,
    clearTimer: o.clearTimer,
  });

  // ---- public API -------------------------------------------------------------------------------------------------------------------
  /** SoundPort: always the manifest duration; plays the buffer only when everything is in place. */
  function play(key) {
    let dur = -1;
    try {
      dur = D.soundDuration(key);
      if (!enabled || paused || !mixer || !ctx) return dur;
      if (ctx.state && ctx.state !== 'running') return dur;
      const spec = hasOwn(D.SOUND_KEYS, key) ? D.SOUND_KEYS[key] : null;
      if (!spec || !spec.file) return dur;
      const buf = buffers.get(spec.file);
      if (buf) mixer.play(buf, { gain: 1 });
    } catch { /* never throws */ }
    return dur;
  }

  function createContext() {
    if (ctx) return;
    const Ctor = getCtor();
    if (!Ctor) return;
    try { ctx = new Ctor({ latencyHint: 'interactive' }); } catch { try { ctx = new Ctor(); } catch { ctx = null; } }
    if (!ctx) return;
    mixer = new Mixer({ ctx, maxVoices: 8 });
    mixer.setVolume(volume);
    mixer.setSfxVolume(sfxVolume);
    mixer.setMusicVolume(musicVolume);
    mixer.setMuted(!enabled);
    decodePending();
    // the browser may suspend / interrupt the context on its own (background tab, phone call): the next gesture brings it back
    try { ctx.onstatechange = () => { if (ctx && ctx.state !== 'running' && !paused && contextWanted) armGesture(); }; } catch { /* ignore */ }
  }

  function unlock() {
    try {
      contextWanted = true;
      createContext();
      if (!ctx) return Promise.resolve();
      const pending = paused ? Promise.resolve() : resumeContext(); // resume() is called synchronously inside the gesture
      if (!paused && ctx.state !== 'running') armGesture();         // synchronously: without a gesture the resume() above may never settle
      return pending.then(() => {
        if (!ctx) return;
        if (ctx.state === 'running') disarmGesture(); else if (!paused) armGesture();
        afterRunning();
      }, () => {});
    } catch {
      return Promise.resolve();
    }
  }

  /**
   * Like unlock(), but for callers that are NOT inside a user gesture (?demo with a remembered consent): nothing is created now (so the
   * browser prints no autoplay warning); the first click / key / touch creates and resumes the context.
   */
  function unlockOnGesture() {
    if (ctx) { if (ctx.state !== 'running' && !paused) armGesture(); return; }
    contextWanted = true;
    armGesture();
  }

  function load() {
    if (loadPromise) return loadPromise;
    attempted = true;
    const p = (async () => {
      try {
        const skip = [...rawFiles.keys()];
        if (loadedCount() < total) {
          await loadSounds({
            fetchImpl: getFetch(),
            sha1Fn,
            data: D,
            cache: getCache(),
            concurrency: 4,
            skip,
            sleep: o.sleep,
            localMissLimit: o.localMissLimit,
            discoverLocal: o.discoverLocal !== false, // one GET of ./sounds/ avoids a wall of 404 lines when the folder is empty
            onFile: (key, buf, source) => { accept(key, buf, source); },
            onProgress: () => refreshStatus(),
          });
        }
        if (musicRequested) await ensureMusicBytes();
        await settleDecodes();
      } catch { /* load() never rejects; whatever arrived is kept */ }
      loadPromise = null;
      refreshStatus();
      return { ...status };
    })();
    loadPromise = p;
    refreshStatus();
    return p;
  }

  async function loadFromFiles(files) {
    attempted = true;
    const report = { matched: 0, accepted: 0, rejected: 0, music: false };
    try {
      const picked = await pickSoundFiles(files);
      for (const [key, buf] of picked) {
        if (key === 'PINBALL') {
          report.matched++;
          if (musicBytes) continue;
          if (await validateBytes(D.MUSIC_FILE, buf, sha1Fn)) {
            musicBytes = buf;
            report.music = true;
            const c = getCache();
            if (c) { try { await c.put(D.MUSIC_FILE.name + '|' + D.MUSIC_FILE.sha1, buf, 'user'); } catch { /* optional */ } }
          } else {
            report.rejected++;
          }
          continue;
        }
        if (!hasOwn(D.SOUND_FILES, key)) continue; // a sound file the game does not use (e.g. SOUND6)
        report.matched++;
        if (rawFiles.has(key)) continue; // already loaded: identical bytes (same SHA-1)
        if (await validateBytes(D.SOUND_FILES[key], buf, sha1Fn)) {
          if (accept(key, buf, 'user')) {
            report.accepted++;
            const c = getCache();
            if (c) { try { await c.put(cacheKeyFor(key), buf, 'user'); } catch { /* optional */ } }
          }
        } else {
          report.rejected++;
        }
      }
      await settleDecodes();
      if (report.music && musicRequested) await music.retry();
    } catch { /* a bad import never throws */ }
    lastImport = report;
    refreshStatus();
    return { ...status };
  }

  function setEnabled(on) {
    enabled = !!on;
    if (mixer) mixer.setMuted(!enabled);
  }

  function setVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    volume = clamp01(n);
    if (mixer) mixer.setVolume(volume);
  }

  function setBusVolume(which, v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    if (which === 'sfx') { sfxVolume = clamp01(n); if (mixer) mixer.setSfxVolume(sfxVolume); }
    else { musicVolume = clamp01(n); if (mixer) mixer.setMusicVolume(musicVolume); }
  }

  function setPaused(on) {
    const p = !!on;
    if (p === paused) return;
    paused = p;
    try {
      if (p) {
        music.pause();
        if (mixer) mixer.stopAll();
        suspendContext();
      } else {
        resumeContext(); // async; the context clock is frozen while suspended, so the music can be re-armed right away
        music.resume();
      }
    } catch { /* ignore */ }
  }

  function dispose() {
    disarmGesture();
    contextWanted = false;
    try { music.stop(); } catch { /* ignore */ }
    try { if (mixer) mixer.dispose(); } catch { /* ignore */ }
    try {
      const r = ctx && typeof ctx.close === 'function' ? ctx.close() : null;
      if (r && r.then) r.then(() => {}, () => {});
    } catch { /* ignore */ }
    ctx = null;
    mixer = null;
    buffers.clear();
    decoding.clear();
  }

  return {
    play,
    durationOf: (key) => { try { return D.soundDuration(key); } catch { return -1; } },
    unlock,
    unlockOnGesture,
    load,
    loadFromFiles,
    setEnabled,
    isEnabled: () => enabled,
    setVolume,
    setPaused,
    stopAll: () => { try { if (mixer) mixer.stopAll(); } catch { /* ignore */ } },
    update: (dt) => {
      void dt;
      try { if (mixer) mixer.prune(); music.tick(); } catch { /* housekeeping must never throw */ }
    },
    getStatus: () => ({ ...status }),
    onStatus: (cb) => {
      if (typeof cb !== 'function') return () => {};
      listeners.push(cb);
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
    music,
    // ---- additive ----
    /** Separate effects / music bus gains 0..1 (the master gain is setVolume). */
    setSfxVolume: (v) => setBusVolume('sfx', v),
    setMusicVolume: (v) => setBusVolume('music', v),
    /** showDirectoryPicker() flow (Chromium, user gesture required): pick a folder and load it. @returns {Promise<AudioStatus>} */
    pickDirectory: async () => {
      const handle = await pickDir(o.window || globalThis);
      return handle ? loadFromFiles([handle]) : { ...status };
    },
    canPickDirectory: () => supportsDirectoryPicker(o.window || globalThis),
    /**
     * Make an element (default: the document) accept dropped Pinball folders / zips / files; `onDone(status)` (optional) fires after
     * each drop has been processed. @returns {()=>void} detach function
     */
    attachDropTarget: (target, onDone) => {
      const el = target || (o.document !== undefined ? o.document : globalThis.document);
      return attachDrop(el, (snapshot) => {
        loadFromFiles(snapshot).then((st) => { if (typeof onDone === 'function') { try { onDone(st); } catch { /* caller's problem */ } } });
      });
    },
    getLastImport: () => ({ ...lastImport }),
    getSourceMap: () => Object.fromEntries(sourceOf),
    dispose,
  };
}
