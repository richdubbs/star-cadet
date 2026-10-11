/**
 * src/audio/music.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.4; SPEC 7.6 (made simple by decision A9: built-in WebAudio synth, no third-party player, no soundfont)
 * createMusic({getCtx|ctx, getDestination, getBytes, setTimer, clearTimer}) -> {available, setEnabled, pause, resume, stop, ...extras}
 * Plays PINBALL.MID with a tiny built-in synth: sine / triangle / square oscillator notes shaped by a short envelope per General-MIDI
 * instrument family, noise + sine bursts for the percussion channel (10), scheduled with a look-ahead scheduler, looping forever.
 * Default OFF: nothing is fetched until setEnabled(true); if the bytes cannot be had or parsed the music stays silent and
 * available() stays false. The MID is validated (size + SHA-1) by the facade before it is handed over via getBytes().
 *
 * ASSUMPTIONS:
 *  - Notes are pre-paired (noteOn -> noteOff, first-in-first-out per channel/key, sustain pedal and "all notes off" honoured) once,
 *    so every scheduled oscillator has a known end and nothing can hang.
 *  - Channel volume (cc7), expression (cc11), program, pitch bend (+ RPN 0 bend range) are read AT NOTE START; later changes do not
 *    retune a sounding note (lo-fi on purpose). Stereo panning is ignored (no panning anywhere, SPEC 7.2).
 *  - pause() remembers the song position and silences the voices; resume() continues from there (notes that were still sounding are
 *    re-triggered for their remaining time). stop() rewinds. The facade also suspends/resumes the whole context on pause.
 *  - The scheduler runs from an injectable interval (default setInterval 100 ms) AND from tick(), which the facade calls every frame.
 *  - "Music starts at New Game": setEnabled(true) starts it at once; INTEGRATOR may call restart() on F2 to rewind (optional).
 */
import { parseMidi } from './midi.js';

export const LOOKAHEAD_S = 0.4;
export const TICK_MS = 100;
export const MAX_VOICES = 64;
const MUSIC_LEVEL = 0.8;

/** General-MIDI family -> oscillator + envelope (attack, decay, sustain fraction, release in seconds, gain). */
const INSTRUMENTS = {
  piano: { type: 'triangle', a: 0.004, d: 0.45, s: 0.3, r: 0.14, g: 1.0 },
  mallet: { type: 'sine', a: 0.002, d: 0.7, s: 0.04, r: 0.25, g: 1.0 },
  organ: { type: 'square', a: 0.01, d: 0.02, s: 1.0, r: 0.06, g: 0.34 },
  guitar: { type: 'triangle', a: 0.003, d: 0.35, s: 0.2, r: 0.12, g: 1.0 },
  bass: { type: 'triangle', a: 0.005, d: 0.3, s: 0.55, r: 0.1, g: 1.25 },
  strings: { type: 'triangle', a: 0.09, d: 0.1, s: 0.9, r: 0.3, g: 0.9 },
  brass: { type: 'square', a: 0.03, d: 0.1, s: 0.8, r: 0.1, g: 0.26 },
  reed: { type: 'square', a: 0.04, d: 0.1, s: 0.75, r: 0.1, g: 0.22 },
  pipe: { type: 'sine', a: 0.05, d: 0.1, s: 0.85, r: 0.12, g: 0.9 },
  lead: { type: 'square', a: 0.005, d: 0.1, s: 0.85, r: 0.08, g: 0.26 },
  pad: { type: 'triangle', a: 0.2, d: 0.1, s: 0.9, r: 0.45, g: 0.8 },
  fx: { type: 'sine', a: 0.05, d: 0.2, s: 0.7, r: 0.3, g: 0.8 },
};

// General-MIDI percussion map (channel 10) groups used by the synth
const DRUM_KICK = new Set([35, 36]);
const DRUM_SNARE = new Set([37, 38, 39, 40]);
const DRUM_TOM = new Set([41, 43, 45, 47, 48, 50]);
const DRUM_HAT = new Set([42, 44]);
const DRUM_CYMBAL = new Set([49, 51, 52, 53, 55, 57, 59]);

/** @param {number} program 0..127 */
export function instrumentFor(program) {
  const p = program & 127;
  if (p < 8) return INSTRUMENTS.piano;
  if (p < 16) return INSTRUMENTS.mallet;
  if (p < 24) return INSTRUMENTS.organ;
  if (p < 32) return INSTRUMENTS.guitar;
  if (p < 40) return INSTRUMENTS.bass;
  if (p < 56) return INSTRUMENTS.strings;
  if (p < 64) return INSTRUMENTS.brass;
  if (p < 72) return INSTRUMENTS.reed;
  if (p < 80) return INSTRUMENTS.pipe;
  if (p < 88) return INSTRUMENTS.lead;
  if (p < 96) return INSTRUMENTS.pad;
  if (p < 104) return INSTRUMENTS.fx;
  if (p < 112) return INSTRUMENTS.piano;
  if (p < 120) return INSTRUMENTS.mallet;
  return INSTRUMENTS.fx;
}

/**
 * Pair note-ons with note-offs and resolve channel state at note start.
 * @param {{events:{t:number, ch:number, type:string, a:number, b:number}[], duration:number}} parsed output of parseMidi
 * @returns {{notes:{t:number, dur:number, ch:number, note:number, vel:number, program:number, vol:number, expr:number, bend:number,
 *   bendRange:number, perc:boolean}[], duration:number}}
 */
export function buildNotes(parsed) {
  const events = (parsed && parsed.events) || [];
  const chans = Array.from({ length: 16 }, () => ({
    program: 0, volume: 100, expression: 127, bend: 0, bendRange: 2, sustain: false, rpnMsb: 127, rpnLsb: 127, held: [],
  }));
  const notes = [];
  const open = new Map(); // ch*128+note -> FIFO of sounding notes
  const closeChannel = (ci, t) => {
    for (const [k, q] of open) {
      if ((k >> 7) !== ci) continue;
      for (const n of q) if (n.dur < 0) n.dur = t - n.t;
      open.delete(k);
    }
    for (const n of chans[ci].held) if (n.dur < 0) n.dur = t - n.t;
    chans[ci].held = [];
  };
  for (const e of events) {
    const ci = e.ch & 15;
    const c = chans[ci];
    const k = (ci << 7) | (e.a & 127);
    switch (e.type) {
      case 'noteOn': {
        const n = {
          t: e.t, dur: -1, ch: ci, note: e.a & 127, vel: e.b & 127, program: c.program, vol: c.volume, expr: c.expression,
          bend: c.bend, bendRange: c.bendRange, perc: ci === 9,
        };
        notes.push(n);
        const q = open.get(k);
        if (q) q.push(n); else open.set(k, [n]);
        break;
      }
      case 'noteOff': {
        const q = open.get(k);
        const n = q && q.shift();
        if (q && q.length === 0) open.delete(k);
        if (n) { if (c.sustain && ci !== 9) c.held.push(n); else n.dur = e.t - n.t; }
        break;
      }
      case 'programChange': c.program = e.a & 127; break;
      case 'pitchBend': c.bend = e.a; break;
      case 'controlChange':
        switch (e.a) {
          case 7: c.volume = e.b; break;
          case 11: c.expression = e.b; break;
          case 64: {
            const on = e.b >= 64;
            if (c.sustain && !on) { for (const n of c.held) if (n.dur < 0) n.dur = e.t - n.t; c.held = []; }
            c.sustain = on;
            break;
          }
          case 101: c.rpnMsb = e.b; break;
          case 100: c.rpnLsb = e.b; break;
          case 6: if (c.rpnMsb === 0 && c.rpnLsb === 0) c.bendRange = e.b || 2; break;
          case 120:
          case 123: closeChannel(ci, e.t); break;
          default: break;
        }
        break;
      default: break;
    }
  }
  const total = Math.max(Number(parsed && parsed.duration) || 0, notes.length ? notes[notes.length - 1].t + 0.1 : 0);
  for (const n of notes) {
    if (n.dur < 0) n.dur = Math.min(Math.max(total - n.t, 0.05), 8); // never closed: ring until the end of the song (capped)
    if (n.dur < 0.02) n.dur = 0.02;
  }
  return { notes, duration: total };
}

/** Deterministic white noise (LCG) so no Math.random is needed. @param {any} ctx */
function makeNoise(ctx) {
  if (typeof ctx.createBuffer !== 'function') return null;
  try {
    const rate = ctx.sampleRate || 22050;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(rate * 1.0)), rate);
    const data = buf.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < data.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      data[i] = (s / 2147483648) - 1;
    }
    return buf;
  } catch {
    return null;
  }
}

/**
 * @param {{ctx?:any, getCtx?:()=>any, getDestination?:()=>any, getBytes?:()=>Promise<ArrayBuffer|null>,
 *   setTimer?:(fn:()=>void, ms:number)=>any, clearTimer?:(h:any)=>void}} [opts]
 */
export function createMusic(opts = {}) {
  const getCtx = typeof opts.getCtx === 'function' ? opts.getCtx : () => opts.ctx || null;
  const getDest = typeof opts.getDestination === 'function'
    ? opts.getDestination
    : () => { const c = getCtx(); return c ? c.destination : null; };
  const getBytes = typeof opts.getBytes === 'function' ? opts.getBytes : async () => null;
  const setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : (fn, ms) => setInterval(fn, ms);
  const clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : (h) => clearInterval(h);

  let enabled = false;
  let ready = false;
  /** @type {Promise<boolean>|null} */
  let loading = null;
  /** @type {{notes:any[], duration:number}|null} */
  let song = null;
  /** @type {'stopped'|'playing'|'paused'} */
  let state = 'stopped';
  let heldPause = false;
  let timer = null;
  let bus = null;
  let busCtx = null;
  let noise = null;
  let noiseCtx = null;
  let loopStart = 0;
  let nextIndex = 0;
  let pausedPos = 0;
  let passes = 0; // how many times the scheduler has moved on to a later pass since begin()
  let level = MUSIC_LEVEL;
  /** @type {{end:number, osc:any, gain:any}[]} */
  let voices = [];

  // ---------------------------------------------------------------- synth voices
  function ensureBus(ctx) {
    if (bus && busCtx === ctx) return bus;
    bus = ctx.createGain();
    bus.gain.value = level;
    const dest = getDest();
    if (dest) bus.connect(dest);
    busCtx = ctx;
    return bus;
  }

  function trackVoice(osc, gain, end) { voices.push({ end, osc, gain }); }

  function pruneVoices(now) {
    if (!voices.length) return;
    voices = voices.filter((v) => {
      if (v.end > now) return true;
      try { v.gain.disconnect(); } catch { /* ignore */ }
      return false;
    });
  }

  function stopVoices() {
    for (const v of voices) {
      try { v.osc.stop(0); } catch { /* not started / already stopped */ }
      try { v.gain.disconnect(); } catch { /* ignore */ }
    }
    voices = [];
  }

  function pitched(ctx, out, n, when, dur) {
    const inst = instrumentFor(n.program);
    const freq = 440 * Math.pow(2, (n.note - 69 + (n.bend / 8192) * n.bendRange) / 12);
    if (!(freq > 8 && freq < 20000)) return;
    const peak = 0.16 * inst.g * Math.pow(n.vel / 127, 1.2) * (n.vol / 127) * (n.expr / 127);
    if (!(peak > 0.0005)) return;
    const osc = ctx.createOscillator();
    osc.type = inst.type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const tau = inst.d / 3 + 0.001;
    const tOff = when + Math.max(dur, 0.03);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + inst.a);
    let vOff;
    if (tOff <= when + inst.a) {
      vOff = (peak * (tOff - when)) / inst.a;
    } else if (inst.s < 1) {
      g.gain.setTargetAtTime(peak * inst.s, when + inst.a, tau);
      vOff = peak * inst.s + (peak - peak * inst.s) * Math.exp(-(tOff - when - inst.a) / tau);
    } else {
      vOff = peak;
    }
    g.gain.setValueAtTime(vOff, tOff);
    g.gain.setTargetAtTime(0, tOff, inst.r / 3 + 0.001);
    osc.connect(g);
    g.connect(out);
    const end = tOff + inst.r * 1.6 + 0.05;
    osc.start(when);
    osc.stop(end);
    trackVoice(osc, g, end);
  }

  function noiseBurst(ctx, out, when, len, vel, filterType, freq, q) {
    if (!noise || noiseCtx !== ctx) { noise = makeNoise(ctx); noiseCtx = ctx; }
    if (!noise) return false;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.004, len / 4);
    let head = src;
    if (typeof ctx.createBiquadFilter === 'function') {
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(out);
    const end = when + len * 1.5 + 0.05;
    src.start(when);
    src.stop(end);
    trackVoice(src, g, end);
    return true;
  }

  function thump(ctx, out, when, f0, f1, len, vel) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(f1, when + len * 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, when);
    g.gain.setTargetAtTime(0, when + 0.01, len / 4);
    osc.connect(g);
    g.connect(out);
    const end = when + len * 1.5 + 0.05;
    osc.start(when);
    osc.stop(end);
    trackVoice(osc, g, end);
  }

  function percussion(ctx, out, n, when) {
    const v = 0.35 * Math.pow(n.vel / 127, 1.1) * (n.vol / 127) * (n.expr / 127);
    if (!(v > 0.001)) return;
    const k = n.note;
    if (DRUM_KICK.has(k)) {
      thump(ctx, out, when, 140, 45, 0.22, v * 1.6);
    } else if (DRUM_SNARE.has(k)) {
      noiseBurst(ctx, out, when, 0.16, v, 'bandpass', 1800, 0.8);
      thump(ctx, out, when, 220, 150, 0.08, v * 0.6);
    } else if (DRUM_TOM.has(k)) {
      thump(ctx, out, when, 70 + (k - 41) * 14, 45 + (k - 41) * 7, 0.28, v * 1.3);
    } else if (DRUM_HAT.has(k)) {
      noiseBurst(ctx, out, when, 0.045, v * 0.8, 'highpass', 7000, 0.7);
    } else if (k === 46) {
      noiseBurst(ctx, out, when, 0.25, v * 0.8, 'highpass', 6500, 0.7); // open hat
    } else if (DRUM_CYMBAL.has(k)) {
      noiseBurst(ctx, out, when, 0.6, v * 0.7, 'highpass', 5000, 0.7);
    } else if (!noiseBurst(ctx, out, when, 0.06, v * 0.7, 'bandpass', 3000, 1.2)) {
      thump(ctx, out, when, 600, 400, 0.05, v * 0.3); // any other percussion: a short click
    }
  }

  function scheduleNote(ctx, n, when, dur) {
    if (voices.length >= MAX_VOICES) return;
    try {
      const out = ensureBus(ctx);
      if (n.perc) percussion(ctx, out, n, when); else pitched(ctx, out, n, when, dur);
    } catch { /* one bad voice never stops the music */ }
  }

  // ---------------------------------------------------------------- scheduler
  function firstIndexAtOrAfter(pos) {
    const notes = song.notes;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].t < pos - 1e-9) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Schedule everything due within the look-ahead window. Cheap; called by the timer and every frame by the facade. */
  function tick() {
    if (state !== 'playing' || !song) return;
    const ctx = getCtx();
    if (!ctx) return;
    const now = Number(ctx.currentTime) || 0;
    const horizon = now + LOOKAHEAD_S;
    const D = song.duration;
    const notes = song.notes;
    pruneVoices(now);
    if (now > loopStart + D + 0.5) { // woke up long after the end (background tab): jump to the loop we are in
      loopStart += Math.floor((now - loopStart) / D) * D;
      nextIndex = firstIndexAtOrAfter(now - loopStart);
      passes++;
    }
    for (let guard = 0; guard < 1000000; guard++) {
      while (nextIndex < notes.length) {
        const n = notes[nextIndex];
        const when = loopStart + n.t;
        if (when > horizon) return;
        nextIndex++;
        if (when >= now - 0.03) scheduleNote(ctx, n, Math.max(when, now), n.dur);
      }
      if (loopStart + D > horizon) return; // wait for the end of the song, then wrap
      loopStart += D;
      nextIndex = 0;
      passes++;
    }
  }

  function begin(ctx, pos) {
    const start = (Number(ctx.currentTime) || 0) + 0.08;
    loopStart = start - pos;
    nextIndex = firstIndexAtOrAfter(pos);
    passes = 0;
    if (pos > 0) { // re-trigger notes that were still sounding when we paused
      const notes = song.notes;
      for (let i = 0; i < nextIndex; i++) {
        const n = notes[i];
        const remaining = n.t + n.dur - pos;
        if (!n.perc && remaining > 0.05) scheduleNote(ctx, n, start, remaining);
      }
    }
    state = 'playing';
    if (timer === null) timer = setTimer(tick, TICK_MS);
    tick();
  }

  function startIfPossible() {
    if (!enabled || !ready || heldPause || state === 'playing' || !song) return false;
    const ctx = getCtx();
    if (!ctx) return false;
    try {
      begin(ctx, state === 'paused' ? pausedPos : 0);
      return true;
    } catch {
      state = 'stopped';
      return false;
    }
  }

  function halt() {
    if (timer !== null) { try { clearTimer(timer); } catch { /* ignore */ } timer = null; }
    stopVoices();
  }

  function loadSong() {
    if (ready) return Promise.resolve(true);
    if (loading) return loading;
    loading = (async () => {
      try {
        const bytes = await getBytes();
        if (!bytes) return false;
        const built = buildNotes(parseMidi(bytes));
        if (!built.notes.length || !(built.duration > 0)) return false;
        song = built;
        ready = true;
        return true;
      } catch {
        return false;
      }
    })();
    const done = () => { loading = null; };
    loading.then(done, done);
    return loading;
  }

  /** Turn music on (lazy load + start) or off (stop + rewind). Resolves when the attempt finished; never rejects. */
  async function setEnabled(on) {
    try {
      if (!on) { enabled = false; halt(); state = 'stopped'; pausedPos = 0; return; }
      enabled = true;
      await loadSong();
      if (enabled) startIfPossible();
    } catch { /* stay silent */ }
  }

  // ---------------------------------------------------------------- public surface
  return {
    /** True once PINBALL.MID has been loaded and parsed into playable notes. */
    available: () => ready,
    setEnabled,
    /** Silence and remember the position (game paused / window blurred). */
    pause() {
      heldPause = true;
      if (state !== 'playing') return;
      const ctx = getCtx();
      const D = song ? song.duration : 0;
      let pos = ctx && D > 0 ? ((Number(ctx.currentTime) || 0) - loopStart) % D : 0;
      if (pos < 0) pos = passes > 0 ? pos + D : 0; // the scheduler already wrapped into the next pass while the last notes still sound
      pausedPos = pos > 0 ? pos : 0;
      halt();
      state = 'paused';
    },
    /** Continue after pause() (or start if enabled and nothing is playing). */
    resume() {
      heldPause = false;
      startIfPossible();
    },
    /** Stop and rewind to the beginning. */
    stop() {
      halt();
      state = 'stopped';
      pausedPos = 0;
    },
    /** Rewind and play again from the start (e.g. at New Game) if enabled. */
    restart() {
      halt();
      state = 'stopped';
      pausedPos = 0;
      startIfPossible();
    },
    /** Try again to load the MID (e.g. after the user supplied PINBALL.MID). */
    async retry() {
      if (enabled && !ready) await setEnabled(true);
    },
    /** The AudioContext appeared (unlock): start if everything else is ready. */
    notifyContext() { startIfPossible(); },
    /** Scheduler step; safe to call at any time. */
    tick,
    /** @param {number} v 0..1 level of the synth before the music bus */
    setLevel(v) {
      if (typeof v === 'number' && Number.isFinite(v)) { level = Math.min(1, Math.max(0, v)); if (bus) bus.gain.value = level; }
    },
    isEnabled: () => enabled,
    isPlaying: () => state === 'playing',
    /** @returns {'stopped'|'playing'|'paused'} */
    getState: () => state,
    /** Song length in seconds (0 until loaded). */
    getDuration: () => (song ? song.duration : 0),
  };
}
