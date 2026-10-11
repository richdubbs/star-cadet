/**
 * tests/audio_helpers/fake_audio.mjs
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * Test doubles and builders for the AUDIO tests (not a test file itself): fake AudioContext, fake IndexedDB, fake fetch,
 * synthetic sound manifest, SMF (MIDI) and ZIP builders, a tiny deterministic PRNG. No timers, no Date, no Math.random.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as realSounds from '../../src/data/sounds.js';

export const REAL = realSounds;

export const sha1 = (u8) => crypto.createHash('sha1').update(u8).digest('hex');
export const toAB = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
export const flush = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

/** Tiny deterministic PRNG (mulberry32) so tests never touch Math.random. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytes(n, seed = 7) {
  const r = rng(seed);
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = Math.floor(r() * 256);
  return u;
}

// ---------------------------------------------------------------------------------------------------------------------
// synthetic manifest: a handful of tiny "sound files" with real SHA-1s, so loader / facade tests can validate real bytes
// ---------------------------------------------------------------------------------------------------------------------
const SYNTH = [['SOUND1', 300], ['SOUND3', 220], ['SOUND4', 150], ['SOUND5', 120], ['SOUND49D', 90]];

/** @returns {{data:any, blobs:Map<string,Uint8Array>, keys:string[]}} blobs are keyed by upper-case file name */
export function makeSynth(extraCount = 0) {
  const SOUND_FILES = {};
  const blobs = new Map();
  const list = [...SYNTH];
  for (let i = 0; i < extraCount; i++) list.push(['SOUND' + (200 + i), 60 + i]);
  list.forEach(([key, n], i) => {
    const u = randomBytes(n, 100 + i);
    blobs.set(key + '.WAV', u);
    SOUND_FILES[key] = { bytes: n, sha1: sha1(u), timer: n / 11000 };
  });
  const mid = randomBytes(400, 999);
  blobs.set('PINBALL.MID', mid);
  const MUSIC_FILE = { name: 'PINBALL.MID', bytes: mid.length, sha1: sha1(mid) };
  const SOUND_KEYS = {
    FLIP_UP: { file: 'SOUND1' }, FLIP_DOWN: { file: 'SOUND3' }, BALL_FEED: { file: 'SOUND4' }, BUMPER: { file: 'SOUND5' },
    SW49D: { file: 'SOUND49D' }, GAME_OVER: { file: null, missing: 'SOUND2' },
  };
  const soundDuration = (key) => {
    const k = Object.prototype.hasOwnProperty.call(SOUND_KEYS, key) ? SOUND_KEYS[key] : null;
    return k && k.file ? SOUND_FILES[k.file].timer : -1;
  };
  const data = { ...realSounds, SOUND_FILES, MUSIC_FILE, SOUND_KEYS, soundDuration };
  return { data, blobs, keys: list.map(([k]) => k) };
}

// ---------------------------------------------------------------------------------------------------------------------
// fake fetch
// ---------------------------------------------------------------------------------------------------------------------
/**
 * @param {(url:string, init:any)=>any} handler returns {status, body?:Uint8Array} | Error | undefined (=404)
 * @param {{yieldTicks?:number}} [o]
 */
export function makeFetch(handler, o = {}) {
  const calls = [];
  let inflight = 0;
  const stats = { maxInflight: 0 };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    inflight++;
    stats.maxInflight = Math.max(stats.maxInflight, inflight);
    try {
      await flush(o.yieldTicks ?? 3);
      const r = await handler(url, init);
      if (r instanceof Error) throw r;
      const status = r ? r.status ?? 200 : 404;
      return {
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: async () => toAB(r && r.body ? r.body : new Uint8Array(0)),
      };
    } finally {
      inflight--;
    }
  };
  fetchImpl.calls = calls;
  fetchImpl.stats = stats;
  return fetchImpl;
}

/** Last path segment of a URL, upper-cased and decoded. */
export const baseOf = (url) => {
  const d = decodeURIComponent(url);
  return d.slice(d.lastIndexOf('/') + 1).toUpperCase();
};

// ---------------------------------------------------------------------------------------------------------------------
// fake AudioContext
// ---------------------------------------------------------------------------------------------------------------------
function param(v = 0) {
  return {
    value: v,
    calls: [],
    setValueAtTime(x, t) { this.calls.push(['set', x, t]); return this; },
    linearRampToValueAtTime(x, t) { this.calls.push(['lin', x, t]); return this; },
    exponentialRampToValueAtTime(x, t) { this.calls.push(['exp', x, t]); return this; },
    setTargetAtTime(x, t, c) { this.calls.push(['target', x, t, c]); return this; },
  };
}

export class FakeAudioContext {
  static instances = [];
  constructor(opts) {
    this.opts = opts;
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = { kind: 'destination' };
    this.sources = [];
    this.gains = [];
    this.oscillators = [];
    this.filters = [];
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.decoded = [];
    this.closed = false;
    FakeAudioContext.instances.push(this);
  }
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.suspendCalls++; this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createGain() {
    const g = { gain: param(1), to: null, connect(n) { this.to = n; }, disconnect() { this.to = null; } };
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = {
      buffer: null, loop: false, onended: null, startedAt: null, stops: [], to: null,
      connect(n) { this.to = n; }, disconnect() { this.to = null; },
      start(t) { this.startedAt = t; }, stop(t) { this.stops.push(t); },
    };
    this.sources.push(s);
    return s;
  }
  createOscillator() {
    const o = {
      type: 'sine', frequency: param(440), startedAt: null, stoppedAt: null, to: null,
      connect(n) { this.to = n; }, disconnect() { this.to = null; },
      start(t) { this.startedAt = t; }, stop(t) { this.stoppedAt = t; },
    };
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter() {
    const f = { type: 'lowpass', frequency: param(350), Q: param(1), to: null, connect(n) { this.to = n; }, disconnect() { this.to = null; } };
    this.filters.push(f);
    return f;
  }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: () => data };
  }
  decodeAudioData(ab, ok, err) {
    if (!(ab instanceof ArrayBuffer) || ab.byteLength === 0 || ab.byteLength > 1e7) {
      const e = new Error('EncodingError');
      if (err) err(e);
      return Promise.reject(e);
    }
    const buf = { numberOfChannels: 1, length: ab.byteLength, sampleRate: 11025, duration: ab.byteLength / 11025, bytes: ab.byteLength };
    this.decoded.push(buf);
    if (ok) ok(buf);
    return Promise.resolve(buf);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// fake IndexedDB (just enough of the API surface that cache.js uses)
// ---------------------------------------------------------------------------------------------------------------------
export function makeFakeIndexedDB({ failOpen = false, throwOnOpen = false, failTx = false } = {}) {
  const stores = new Map(); // dbName -> Map(storeName -> Map(key -> value))
  const factory = {
    opens: 0,
    stores,
    open(name) {
      factory.opens++;
      if (throwOnOpen) throw new Error('SecurityError');
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => {
        if (failOpen) { req.onerror && req.onerror({}); return; }
        const existed = stores.has(name);
        if (!existed) stores.set(name, new Map());
        const dbStores = stores.get(name);
        const db = {
          objectStoreNames: { contains: (s) => dbStores.has(s) },
          createObjectStore: (s) => { dbStores.set(s, new Map()); },
          transaction(storeName) {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const store = dbStores.get(storeName);
            tx.objectStore = () => {
              const mk = (fn) => {
                const r = { result: undefined, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (failTx) { r.onerror && r.onerror({}); tx.onerror && tx.onerror({}); return; }
                  r.result = fn();
                  r.onsuccess && r.onsuccess({});
                  queueMicrotask(() => tx.oncomplete && tx.oncomplete({}));
                });
                return r;
              };
              return {
                get: (k) => mk(() => store.get(k)),
                put: (v, k) => mk(() => { store.set(k, v); return k; }),
                clear: () => mk(() => { store.clear(); }),
              };
            };
            return tx;
          },
        };
        req.result = db;
        if (!existed && req.onupgradeneeded) req.onupgradeneeded({});
        req.onsuccess && req.onsuccess({});
      });
      return req;
    },
  };
  return factory;
}

// ---------------------------------------------------------------------------------------------------------------------
// SMF (MIDI) builder
// ---------------------------------------------------------------------------------------------------------------------
export const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};
export const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
export const tempo = (us) => meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]);
export const eot = () => meta(0x2f, []);
export const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const be16 = (n) => [(n >>> 8) & 255, n & 255];
/** events: array of [deltaTicks, ...bytes] ; returns an MTrk chunk. */
export function track(events) {
  const body = [];
  for (const [d, ...bytes] of events) body.push(...vlq(d), ...bytes);
  return [0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body];
}
export function smf({ format = 1, division = 480, tracks }) {
  const hdr = [0x4d, 0x54, 0x68, 0x64, ...be32(6), ...be16(format), ...be16(tracks.length), ...be16(division)];
  return Uint8Array.from([...hdr, ...tracks.flat()]);
}

/** A 2-second, 1-bar song at 120 bpm (division 480): a piano chord, a bass note, a kick and a hat on channel 10. */
export function demoSong() {
  const t0 = track([
    [0, ...tempo(500000)],
    [0, 0xc0, 0], // ch0 piano
    [0, 0x90, 60, 100], [0, 0x90, 64, 100], // chord at 0 s
    [480, 0x80, 60, 0], [0, 0x80, 64, 0], // off at 0.5 s
    [480, 0x90, 67, 90], // at 1.0 s
    [480, 0x80, 67, 0], // off at 1.5 s
    [480, ...eot()], // end of track at 2.0 s
  ]);
  const t1 = track([
    [0, 0xc1, 33], // ch1 bass
    [0, 0x91, 36, 110], [960, 0x81, 36, 0],
    [0, 0x99, 36, 120], [0, 0x99, 42, 80], // drums at 1.0 s (kick + hat on ch10)
    [480, 0x99, 42, 0],
    [0, ...eot()],
  ]);
  return smf({ format: 1, division: 480, tracks: [t0, t1] });
}

// ---------------------------------------------------------------------------------------------------------------------
// ZIP builder
// ---------------------------------------------------------------------------------------------------------------------
const crc32 = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();

/**
 * @param {{name:string, data?:Uint8Array, method?:0|8, level?:number, flags?:number, raw?:Uint8Array}[]} entries
 * @param {{comment?:string}} [o]
 */
export function makeZip(entries, o = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const le16 = (n) => [n & 255, (n >>> 8) & 255];
  const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const nameBytes = (s) => [...Buffer.from(s, 'utf8')];
  for (const e of entries) {
    const data = e.data || new Uint8Array(0);
    const method = e.method ?? 8;
    const comp = e.raw ? e.raw : method === 8 ? new Uint8Array(zlib.deflateRawSync(data, { level: e.level ?? 6 })) : data;
    const name = nameBytes(e.name);
    const flags = e.flags ?? 0;
    const local = [0x50, 0x4b, 3, 4, ...le16(20), ...le16(flags), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc32(data)),
      ...le32(comp.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...name];
    parts.push(Uint8Array.from(local), comp);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(flags), ...le16(method), ...le16(0), ...le16(0x21),
      ...le32(crc32(data)), ...le32(comp.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
      ...le32(0), ...le32(offset), ...name]));
    offset += local.length + comp.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { parts.push(c); cdSize += c.length; }
  const comment = nameBytes(o.comment || '');
  parts.push(Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...le16(entries.length), ...le16(entries.length), ...le32(cdSize), ...le32(cdStart),
    ...le16(comment.length), ...comment]));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
