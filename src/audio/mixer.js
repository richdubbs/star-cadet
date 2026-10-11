/**
 * src/audio/mixer.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.3; SPEC 7.2 / sounds.md section 3 (mixer rules)
 * class Mixer: a pool of one-shot voices on top of an injected AudioContext (testable with a fake context).
 *   - one AudioBufferSourceNode per play(), never looped;
 *   - at most `maxVoices` (default 8, clamped 1..32) at the same time; when the pool is full the OLDEST voice is stopped;
 *   - graph: voice gain -> sfx gain -> master gain -> destination, and a separate music gain -> master gain;
 *   - no panning (the original had none; SPEC 7.2 default OFF).
 * Gameplay never reads anything from here: durations come from the manifest, not from buffers.
 *
 * ASSUMPTIONS:
 *  - `mute` silences the sfx bus only (the master "Sounds" switch); music has its own on/off, master volume affects both.
 *  - A voice is released by the node's `ended` event; prune() is a belt-and-braces sweep (suspended / fake contexts) based on the
 *    buffer's nominal duration (housekeeping only, never gameplay).
 *  - Only the AudioContext members createGain, createBufferSource, destination and currentTime are used.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

export class Mixer {
  /** @param {{ctx:any, maxVoices?:number}} opts */
  constructor(opts) {
    if (!opts || !opts.ctx) throw new TypeError('Mixer: opts.ctx (an AudioContext) is required');
    const ctx = opts.ctx;
    this.ctx = ctx;
    /** @type {number} */
    this.maxVoices = clamp(Math.trunc(num(opts.maxVoices, 8)), 1, 32);
    this._volume = 1;
    this._sfxVolume = 1;
    this._musicVolume = 1;
    this._muted = false;
    /** voices, oldest first @type {{id:number, src:any, gain:any, end:number}[]} */
    this._voices = [];
    this._nextId = 1;
    this.master = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(ctx.destination);
    this._apply();
  }

  /** Number of voices currently sounding (after sweeping finished ones). */
  get voiceCount() {
    this.prune();
    return this._voices.length;
  }

  /** The node that music voices should connect to (separate music gain). */
  getMusicDestination() { return this.musicGain; }

  /**
   * Play one buffer once. Returns a voice handle, or null if nothing was played.
   * @param {any} buffer decoded AudioBuffer
   * @param {{gain?:number}} [o] per-voice gain 0..4 (default 1)
   * @returns {{id:number, stop:()=>void}|null}
   */
  play(buffer, o) {
    if (!buffer) return null;
    this.prune();
    while (this._voices.length >= this.maxVoices) this._stopVoice(this._voices.shift()); // full: steal the OLDEST
    const ctx = this.ctx;
    let src = null;
    let g = null;
    try {
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = false;
      g = ctx.createGain();
      g.gain.value = clamp(num(o && o.gain, 1), 0, 4);
      src.connect(g);
      g.connect(this.sfxGain);
      const now = num(ctx.currentTime, 0);
      const voice = { id: this._nextId++, src, gain: g, end: now + num(buffer.duration, 0) };
      src.onended = () => this._release(voice);
      src.start(0);
      this._voices.push(voice);
      return { id: voice.id, stop: () => { this._release(voice); this._stopVoice(voice); } };
    } catch {
      try { if (g) g.disconnect(); } catch { /* ignore */ }
      return null;
    }
  }

  /** Sweep voices whose buffer has finished (in case `ended` never fired). @param {number} [now] */
  prune(now) {
    const t = num(now, num(this.ctx.currentTime, 0));
    if (!this._voices.length) return;
    const keep = [];
    for (const v of this._voices) {
      if (v.end + 0.05 <= t) this._disconnect(v); else keep.push(v);
    }
    this._voices = keep;
  }

  /** Master gain 0..1 (applies to sfx and music). @param {number} v */
  setVolume(v) { this._volume = clamp(num(v, this._volume), 0, 1); this._apply(); }

  /** @returns {number} */
  getVolume() { return this._volume; }

  /** Sfx bus gain 0..1. @param {number} v */
  setSfxVolume(v) { this._sfxVolume = clamp(num(v, this._sfxVolume), 0, 1); this._apply(); }

  /** Music bus gain 0..1. @param {number} v */
  setMusicVolume(v) { this._musicVolume = clamp(num(v, this._musicVolume), 0, 1); this._apply(); }

  /** Mute / unmute the sfx bus (the master Sounds switch); in-flight voices are silenced at once. @param {boolean} on */
  setMuted(on) {
    this._muted = !!on;
    this._apply();
    if (this._muted) this.stopAll();
  }

  /** @returns {boolean} */
  isMuted() { return this._muted; }

  /** Stop every sfx voice immediately. */
  stopAll() {
    const all = this._voices;
    this._voices = [];
    for (const v of all) this._stopVoice(v);
  }

  /** Stop everything and detach the graph. */
  dispose() {
    this.stopAll();
    for (const n of [this.sfxGain, this.musicGain, this.master]) { try { n.disconnect(); } catch { /* ignore */ } }
  }

  _apply() {
    this.master.gain.value = this._volume;
    this.sfxGain.gain.value = this._muted ? 0 : this._sfxVolume;
    this.musicGain.gain.value = this._musicVolume;
  }

  _release(voice) {
    const i = this._voices.indexOf(voice);
    if (i >= 0) { this._voices.splice(i, 1); this._disconnect(voice); }
  }

  _stopVoice(voice) {
    if (!voice) return;
    try { voice.src.onended = null; } catch { /* ignore */ }
    try { voice.src.stop(0); } catch { /* already stopped */ }
    this._disconnect(voice);
  }

  _disconnect(voice) {
    try { voice.src.disconnect(); } catch { /* ignore */ }
    try { voice.gain.disconnect(); } catch { /* ignore */ }
  }
}
