/**
 * tests/audio.test.mjs
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 10.7 + 13.2: source order, size + SHA-1 validation, loader fallbacks and retries, concurrency, progress, cache,
 * mixer voice stealing, the createAudio facade (durations in every state, status texts, unlock/pause/volume, user files).
 * Node only: fake fetch / AudioContext / IndexedDB, injected sleep, no network, no real timers, no Date, no Math.random.
 * (MIDI, music synth, zip and user-file parsing live in tests/audio_media.test.mjs.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAudio } from '../src/audio.js';
import { candidateUrls } from '../src/audio/sources.js';
import { validateBytes, sha1Js, sha1Hex, readWavFormat } from '../src/audio/validate.js';
import { loadSounds, discoverLocalIndex, RETRY_DELAYS_MS } from '../src/audio/loader.js';
import { createCache } from '../src/audio/cache.js';
import { Mixer } from '../src/audio/mixer.js';
import {
  REAL, FakeAudioContext, baseOf, flush, makeFakeIndexedDB, makeFetch, makeSynth, randomBytes, sha1, toAB,
} from './audio_helpers/fake_audio.mjs';

const S1_PREFIX = 'https://archive.org/download/3d-pinball-space-cadet_202103/3D%20Pinball%20Space%20Cadet.zip/3D%20Pinball%20Space%20Cadet%2F';
const S5_PREFIX = 'https://archive.org/download/pinball_202005/';
const isLocal = (url) => url.startsWith('./sounds/');
const isS1 = (url) => url.startsWith(S1_PREFIX);
const isS5 = (url) => url.startsWith(S5_PREFIX);
const noSleep = async () => {};

// =====================================================================================================================
// sources.js
// =====================================================================================================================
test('candidateUrls: order is local upper, local lower, S1, S5 with the exact URLs', () => {
  assert.deepEqual(candidateUrls('SOUND1'), [
    { source: 'local', url: './sounds/SOUND1.WAV' },
    { source: 'local', url: './sounds/sound1.wav' },
    { source: 'S1', url: S1_PREFIX + 'SOUND1.WAV' },
    { source: 'S5', url: S5_PREFIX + 'SOUND1.WAV' },
  ]);
  const c = candidateUrls('SOUND49D');
  assert.equal(c[0].url, './sounds/SOUND49D.WAV');
  assert.equal(c[1].url, './sounds/sound49d.wav');
  assert.equal(c[2].url, S1_PREFIX + 'SOUND49D.WAV');
  assert.equal(c[3].url, S5_PREFIX + 'SOUND49D.WAV');
  assert.deepEqual(candidateUrls('sound49d'), c, 'the key is case-insensitive');
});

test('candidateUrls: every manifest file has the same four candidates in policy order', () => {
  for (const key of Object.keys(REAL.SOUND_FILES)) {
    const c = candidateUrls(key);
    assert.deepEqual(c.map((x) => x.source), ['local', 'local', 'S1', 'S5'], key);
    assert.ok(c.every((x) => baseOf(x.url) === key + '.WAV'), key);
  }
});

test('candidateUrls: the MID comes from local and S1 only (never S5)', () => {
  const viaKey = candidateUrls('PINBALL');
  const viaFlag = candidateUrls('whatever', { music: true });
  assert.deepEqual(viaKey, viaFlag);
  assert.deepEqual(viaKey, [
    { source: 'local', url: './sounds/PINBALL.MID' },
    { source: 'local', url: './sounds/pinball.mid' },
    { source: 'S1', url: S1_PREFIX + 'PINBALL.MID' },
  ]);
  assert.ok(!viaKey.some((c) => c.source === 'S5' || c.url.includes('pinball_202005')));
});

test('candidateUrls: NEVER_FETCH names, PINBALL2.MID and unknown keys yield nothing', () => {
  for (const name of REAL.NEVER_FETCH) {
    const key = name.replace(/\.(WAV|MID)$/i, '');
    assert.deepEqual(candidateUrls(key), [], name);
  }
  for (const k of ['SOUND2', 'SOUND37', 'SOUND44', 'SOUND52', 'SOUND59', 'SOUND62', 'PINBALL2', 'SOUND6', 'nope', '', undefined, null, 42]) {
    assert.deepEqual(candidateUrls(k), [], String(k));
  }
  assert.ok(!Object.keys(REAL.SOUND_FILES).some((k) => REAL.NEVER_FETCH.includes(k + '.WAV')), 'manifest and NEVER_FETCH are disjoint');
});

// =====================================================================================================================
// validate.js
// =====================================================================================================================
test('validateBytes: accepts the exact bytes, rejects a 1-byte change, a wrong length and an HTML page', async () => {
  const good = randomBytes(5000, 3);
  const exp = { bytes: good.length, sha1: sha1(good) };
  const nodeSha1 = async (b) => sha1(new Uint8Array(b));
  assert.equal(await validateBytes(exp, toAB(good), nodeSha1), true);
  assert.equal(await validateBytes(exp, toAB(good)), true, 'default sha1 (crypto.subtle) agrees');
  const flipped = good.slice();
  flipped[2500] ^= 1;
  assert.equal(await validateBytes(exp, toAB(flipped), nodeSha1), false, 'one flipped bit');
  assert.equal(await validateBytes(exp, toAB(good.subarray(0, 4999)), nodeSha1), false, 'truncated');
  assert.equal(await validateBytes(exp, toAB(Uint8Array.from([...good, 0])), nodeSha1), false, 'one byte too long');
  const html = new TextEncoder().encode('<!doctype html><title>503</title>'.padEnd(5000, ' '));
  assert.equal(html.length, 5000);
  assert.equal(await validateBytes(exp, toAB(html), nodeSha1), false, 'same length, wrong content');
  assert.equal(await validateBytes(exp, toAB(new TextEncoder().encode('<html>503</html>')), nodeSha1), false);
});

test('validateBytes: never throws and tolerates bad input and a throwing digest', async () => {
  const good = randomBytes(64, 5);
  const exp = { bytes: 64, sha1: sha1(good) };
  assert.equal(await validateBytes(exp, null), false);
  assert.equal(await validateBytes(exp, 'text'), false);
  assert.equal(await validateBytes(null, toAB(good)), false);
  assert.equal(await validateBytes({ bytes: 64 }, toAB(good)), false);
  assert.equal(await validateBytes(exp, toAB(good), async () => { throw new Error('boom'); }), false);
  assert.equal(await validateBytes(exp, toAB(good), async () => 42), false);
  assert.equal(await validateBytes(exp, good), true, 'a typed array is accepted too');
  assert.equal(await validateBytes({ bytes: 64, sha1: sha1(good).toUpperCase() }, toAB(good)), true, 'hex case is ignored');
});

test('sha1Js equals node:crypto for many lengths, and sha1Hex works without crypto.subtle', async () => {
  for (const n of [...Array.from({ length: 140 }, (_, i) => i), 255, 256, 1000, 4096, 65537]) {
    const b = randomBytes(n, n + 1);
    assert.equal(sha1Js(b), sha1(b), 'length ' + n);
  }
  assert.equal(sha1Js(new Uint8Array(0)), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1Js(new TextEncoder().encode('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    const b = randomBytes(777, 9);
    assert.equal(await sha1Hex(b), sha1(b), 'JS fallback used when subtle is missing');
    const exp = { bytes: 777, sha1: sha1(b) };
    assert.equal(await validateBytes(exp, toAB(b)), true);
  } finally {
    Object.defineProperty(globalThis, 'crypto', desc);
  }
});

test('readWavFormat reads the RIFF fmt chunk (PCM, 1 ch, 11025 Hz, 8 bit) and rejects non-WAV data', () => {
  const wav = new Uint8Array(44 + 10);
  const dv = new DataView(wav.buffer);
  wav.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + 10, true); wav.set([0x57, 0x41, 0x56, 0x45], 8);
  wav.set([0x66, 0x6d, 0x74, 0x20], 12); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 11025, true); dv.setUint32(28, 11025, true);
  dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wav.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, 10, true);
  assert.deepEqual(readWavFormat(toAB(wav)), { format: 1, channels: 1, sampleRate: 11025, bitsPerSample: 8 });
  assert.equal(readWavFormat(toAB(randomBytes(100))), null);
  assert.equal(readWavFormat(new ArrayBuffer(3)), null);
});

// =====================================================================================================================
// loader.js
// =====================================================================================================================
/** Server model: a map from upper-case file name to bytes, served at the given sources. */
function server({ synth, local = [], s1 = [], s5 = [], localLowerOnly = false }) {
  return (url) => {
    const name = baseOf(url);
    const body = synth.blobs.get(name);
    if (!body) return { status: 404 };
    if (isLocal(url)) {
      if (!local.includes(name)) return { status: 404 };
      if (localLowerOnly && url !== url.toLowerCase()) return { status: 404 };
      return { status: 200, body };
    }
    if (isS1(url)) return s1.includes(name) ? { status: 200, body } : { status: 404 };
    if (isS5(url)) return s5.includes(name) ? { status: 200, body } : { status: 404 };
    return { status: 404 };
  };
}

test('loadSounds: local hit - everything comes from ./sounds, nothing remote is requested, init options are right', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const fetchImpl = makeFetch(server({ synth, local: names }));
  const r = await loadSounds({ fetchImpl, data: synth.data, sleep: noSleep });
  assert.deepEqual([...r.files.keys()].sort(), [...synth.keys].sort());
  for (const k of synth.keys) assert.equal(r.sources[k], 'local');
  assert.ok(fetchImpl.calls.every((c) => isLocal(c.url)), 'no remote request');
  assert.deepEqual(fetchImpl.calls[0].init, { cache: 'no-cache' });
  for (const [k, buf] of r.files) assert.equal(sha1(new Uint8Array(buf)), synth.data.SOUND_FILES[k].sha1);
  assert.equal(r.music, null);
});

test('loadSounds: local 404 (both spellings) -> S1; a 404 is never retried', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const sleeps = [];
  const fetchImpl = makeFetch(server({ synth, s1: names }));
  const r = await loadSounds({ fetchImpl, data: synth.data, sleep: async (ms) => { sleeps.push(ms); }, concurrency: 1 });
  assert.equal(r.files.size, synth.keys.length);
  for (const k of synth.keys) assert.equal(r.sources[k], 'S1');
  assert.deepEqual(sleeps, [], 'no backoff after plain 404s');
  const forSound1 = fetchImpl.calls.filter((c) => baseOf(c.url) === 'SOUND1.WAV').map((c) => c.url);
  assert.deepEqual(forSound1, ['./sounds/SOUND1.WAV', './sounds/sound1.wav', S1_PREFIX + 'SOUND1.WAV']);
  const remote = fetchImpl.calls.find((c) => isS1(c.url));
  assert.deepEqual(remote.init, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
});

test('loadSounds: S1 500 x3 -> retries 0.5 s then 1.5 s on the same source, then S5 succeeds', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const sleeps = [];
  const s5 = server({ synth, s5: names });
  const fetchImpl = makeFetch((url, init) => (isS1(url) ? { status: 500 } : s5(url, init)));
  const r = await loadSounds({ fetchImpl, data: synth.data, sleep: async (ms) => { sleeps.push(ms); }, concurrency: 1, localMissLimit: Infinity });
  assert.equal(r.files.size, synth.keys.length);
  for (const k of synth.keys) assert.equal(r.sources[k], 'S5');
  assert.deepEqual(RETRY_DELAYS_MS, [500, 1500]);
  assert.deepEqual(sleeps, synth.keys.flatMap(() => [500, 1500]));
  assert.equal(fetchImpl.calls.filter((c) => isS1(c.url) && baseOf(c.url) === 'SOUND1.WAV').length, 3, '1 try + 2 retries');
});

test('loadSounds: a transient failure that recovers on the 2nd retry is accepted from the same source', async () => {
  const synth = makeSynth();
  let attempts = 0;
  const body = synth.blobs.get('SOUND1.WAV');
  const fetchImpl = makeFetch((url) => {
    if (baseOf(url) !== 'SOUND1.WAV') return { status: 404 };
    if (!isS1(url)) return { status: 404 };
    attempts++;
    if (attempts === 1) return new Error('network down');
    if (attempts === 2) return { status: 503 };
    return { status: 200, body };
  });
  const sleeps = [];
  const r = await loadSounds({ fetchImpl, data: synth.data, sleep: async (ms) => { sleeps.push(ms); }, concurrency: 1 });
  assert.equal(r.sources.SOUND1, 'S1');
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps.slice(0, 2), [500, 1500]);
});

test('loadSounds: every source failing resolves with empty results and never throws', async () => {
  const synth = makeSynth();
  for (const handler of [() => ({ status: 404 }), () => new Error('offline'), () => ({ status: 500 }), () => ({ status: 503, body: new Uint8Array(3) })]) {
    const sleeps = [];
    const r = await loadSounds({ fetchImpl: makeFetch(handler), data: synth.data, sleep: async (ms) => { sleeps.push(ms); }, music: true });
    assert.equal(r.files.size, 0);
    assert.equal(r.music, null);
    assert.deepEqual(r.sources, {});
  }
  // no fetch at all
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    const r = await loadSounds({ data: synth.data, sleep: noSleep });
    assert.equal(r.files.size, 0);
  } finally {
    globalThis.fetch = saved;
  }
  // a fetch that returns garbage objects
  const weird = await loadSounds({ fetchImpl: async () => null, data: synth.data, sleep: noSleep });
  assert.equal(weird.files.size, 0);
  const throwingBody = await loadSounds({ fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error('x'); } }), data: synth.data, sleep: noSleep });
  assert.equal(throwingBody.files.size, 0);
});

test('loadSounds: wrong bytes (HTML page, truncated body, right length but different content) are discarded and the next source is tried', async () => {
  const synth = makeSynth();
  const good = synth.blobs.get('SOUND1.WAV');
  const html = new TextEncoder().encode('<html>soft 404</html>');
  const flipped = good.slice();
  flipped[10] ^= 0xff;
  const variants = [html, good.subarray(0, good.length - 1), flipped];
  for (const bad of variants) {
    const fetchImpl = makeFetch((url) => {
      if (baseOf(url) !== 'SOUND1.WAV') return { status: 404 };
      if (isLocal(url) || isS1(url)) return { status: 200, body: bad };
      return { status: 200, body: good };
    });
    const r = await loadSounds({ fetchImpl, data: synth.data, sleep: noSleep, concurrency: 1 });
    assert.equal(r.sources.SOUND1, 'S5');
    assert.equal(sha1(new Uint8Array(r.files.get('SOUND1'))), sha1(good));
  }
});

test('loadSounds: concurrency never exceeds 4 and defaults to 4; a custom value is honoured', async () => {
  const synth = makeSynth(12);
  const names = synth.keys.map((k) => k + '.WAV');
  const f4 = makeFetch(server({ synth, local: names }), { yieldTicks: 6 });
  const r4 = await loadSounds({ fetchImpl: f4, data: synth.data, sleep: noSleep });
  assert.equal(r4.files.size, synth.keys.length);
  assert.equal(f4.stats.maxInflight, 4);
  const f2 = makeFetch(server({ synth, local: names }), { yieldTicks: 6 });
  await loadSounds({ fetchImpl: f2, data: synth.data, sleep: noSleep, concurrency: 2 });
  assert.equal(f2.stats.maxInflight, 2);
  const f99 = makeFetch(server({ synth, local: names }), { yieldTicks: 6 });
  await loadSounds({ fetchImpl: f99, data: synth.data, sleep: noSleep, concurrency: 99 });
  assert.ok(f99.stats.maxInflight <= 8, 'clamped');
});

test('loadSounds: progress callback counts every file once, onFile fires for accepted files only', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const ok = names.slice(0, 3);
  const fetchImpl = makeFetch(server({ synth, local: ok }));
  const progress = [];
  const files = [];
  await loadSounds({
    fetchImpl, data: synth.data, sleep: noSleep, concurrency: 1,
    onProgress: (p) => progress.push(p),
    onFile: (key, buf, source, isMusic) => files.push([key, buf.byteLength, source, isMusic]),
  });
  assert.equal(progress.length, synth.keys.length);
  assert.deepEqual(progress.map((p) => p.done), [1, 2, 3, 4, 5]);
  assert.ok(progress.every((p) => p.total === 5));
  assert.deepEqual(progress.map((p) => p.loaded), [1, 2, 3, 3, 3]);
  assert.deepEqual(progress.map((p) => p.ok), [true, true, true, false, false]);
  assert.deepEqual(files.map((f) => f[0]), synth.keys.slice(0, 3));
  assert.ok(files.every((f) => f[2] === 'local' && f[3] === false));
  // a throwing callback never stops the load
  const r = await loadSounds({ fetchImpl, data: synth.data, sleep: noSleep, onProgress: () => { throw new Error('x'); }, onFile: () => { throw new Error('y'); } });
  assert.equal(r.files.size, 3);
});

test('loadSounds: real manifest - the six absent files and PINBALL2.MID are never requested; request counts per policy', async () => {
  const f = makeFetch(() => ({ status: 404 }), { yieldTicks: 1 });
  const r = await loadSounds({ fetchImpl: f, sleep: noSleep, music: true, localMissLimit: Infinity });
  assert.equal(r.files.size, 0);
  const urls = f.calls.map((c) => c.url);
  assert.equal(urls.length, 41 * 4 + 3, '41 files x (2 local + S1 + S5) + the MID x (2 local + S1)');
  for (const bad of ['SOUND2', 'SOUND37', 'SOUND44', 'SOUND52', 'SOUND59', 'SOUND62', 'PINBALL2']) {
    assert.ok(!urls.some((u) => baseOf(u).startsWith(bad + '.')), bad + ' must not be requested');
  }
  const mid = urls.filter((u) => baseOf(u) === 'PINBALL.MID');
  assert.equal(mid.length, 3);
  assert.ok(!mid.some(isS5), 'S5 has no CORS for the MID');
  assert.ok(urls.every((u) => isLocal(u) || isS1(u) || isS5(u)), 'only the three allowed origins; no GitHub / jsDelivr');
});

test('loadSounds: music is optional (off by default) and comes from local or S1 only', async () => {
  const synth = makeSynth();
  const names = [...synth.keys.map((k) => k + '.WAV'), 'PINBALL.MID'];
  const f1 = makeFetch(server({ synth, local: names }));
  const off = await loadSounds({ fetchImpl: f1, data: synth.data, sleep: noSleep });
  assert.equal(off.music, null);
  assert.ok(!f1.calls.some((c) => baseOf(c.url) === 'PINBALL.MID'), 'MID not requested unless asked');
  const f2 = makeFetch(server({ synth, local: names }));
  const on = await loadSounds({ fetchImpl: f2, data: synth.data, sleep: noSleep, music: true });
  assert.equal(on.music.byteLength, synth.blobs.get('PINBALL.MID').length);
  assert.equal(on.sources.PINBALL, 'local');
  assert.equal(on.files.size, synth.keys.length, 'music is not in files');
  const f3 = makeFetch(server({ synth, s1: ['PINBALL.MID'] }));
  const only = await loadSounds({ fetchImpl: f3, data: synth.data, sleep: noSleep, musicOnly: true });
  assert.equal(only.files.size, 0);
  assert.equal(only.sources.PINBALL, 'S1');
  assert.ok(f3.calls.every((c) => baseOf(c.url) === 'PINBALL.MID'));
  // a MID only on S5 is never used
  const f4 = makeFetch(server({ synth, s5: ['PINBALL.MID'] }));
  const none = await loadSounds({ fetchImpl: f4, data: synth.data, sleep: noSleep, musicOnly: true });
  assert.equal(none.music, null);
  // a damaged MID is rejected
  const f5 = makeFetch((url) => (baseOf(url) === 'PINBALL.MID' ? { status: 200, body: new Uint8Array(400) } : { status: 404 }));
  assert.equal((await loadSounds({ fetchImpl: f5, data: synth.data, sleep: noSleep, musicOnly: true })).music, null);
});

test('loadSounds: empty ./sounds folder - the probe circuit breaker stops local requests after 4 fully-missed files', async () => {
  const synth = makeSynth(7); // 12 files
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(server({ synth, s1: names }));
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, concurrency: 1 });
  assert.equal(r.files.size, synth.keys.length);
  assert.equal(f.calls.filter((c) => isLocal(c.url)).length, 8, '4 files x 2 spellings, then local is skipped');
  const lit = makeFetch(server({ synth, s1: names }));
  await loadSounds({ fetchImpl: lit, data: synth.data, sleep: noSleep, concurrency: 1, localMissLimit: Infinity });
  assert.equal(lit.calls.filter((c) => isLocal(c.url)).length, 24, 'literal policy probes every file');
});

test('loadSounds: a single local hit among the first files disables the breaker (partial local folders work)', async () => {
  const synth = makeSynth(7);
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(server({ synth, local: ['SOUND1.WAV', names[10]], s1: names }));
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, concurrency: 1 });
  assert.equal(r.sources.SOUND1, 'local');
  assert.equal(r.sources[synth.keys[10]], 'local', 'a late local file is still found');
  assert.equal(r.sources.SOUND3, 'S1');
});

test('loadSounds: after a lower-case-only local hit the lower-case spelling is tried first', async () => {
  const synth = makeSynth(3);
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(server({ synth, local: names, localLowerOnly: true }));
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, concurrency: 1 });
  assert.equal(r.files.size, synth.keys.length);
  for (const k of synth.keys) assert.equal(r.sources[k], 'local');
  const urlsFor = (k) => f.calls.filter((c) => baseOf(c.url) === k + '.WAV').map((c) => c.url);
  assert.deepEqual(urlsFor('SOUND1'), ['./sounds/SOUND1.WAV', './sounds/sound1.wav']);
  assert.deepEqual(urlsFor('SOUND3'), ['./sounds/sound3.wav'], 'lower-case first, hit, done');
});

test('loadSounds: skip option leaves already-loaded files alone', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(server({ synth, local: names }));
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, skip: ['SOUND1', 'SOUND3'] });
  assert.deepEqual([...r.files.keys()].sort(), ['SOUND4', 'SOUND49D', 'SOUND5']);
  assert.ok(!f.calls.some((c) => ['SOUND1.WAV', 'SOUND3.WAV'].includes(baseOf(c.url))));
});

test('loadSounds + cache: a valid cache hit needs no network; a miss is stored; corrupt entries are ignored', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const idb = makeFakeIndexedDB();
  const cache = createCache({ indexedDB: idb });
  const f1 = makeFetch(server({ synth, s1: names }));
  const first = await loadSounds({ fetchImpl: f1, data: synth.data, sleep: noSleep, cache, concurrency: 1 });
  assert.equal(first.files.size, 5);
  const f2 = makeFetch(() => ({ status: 500 }));
  const second = await loadSounds({ fetchImpl: f2, data: synth.data, sleep: noSleep, cache });
  assert.equal(f2.calls.length, 0, 'served entirely from the cache');
  assert.equal(second.files.size, 5);
  assert.equal(second.sources.SOUND1, 'S1', 'the original source is remembered');
  // corrupt one entry
  const key = 'SOUND3.WAV|' + synth.data.SOUND_FILES.SOUND3.sha1;
  await cache.put(key, toAB(new Uint8Array(220)), 'S1');
  const f3 = makeFetch(server({ synth, local: names }));
  const third = await loadSounds({ fetchImpl: f3, data: synth.data, sleep: noSleep, cache, concurrency: 1 });
  assert.equal(third.files.size, 5);
  assert.equal(third.sources.SOUND3, 'local', 'the corrupt entry was ignored and refetched');
  assert.equal(third.sources.SOUND1, 'S1');
  // a cache that throws is harmless
  const bad = { getEntry: async () => { throw new Error('x'); }, put: async () => { throw new Error('y'); } };
  const fourth = await loadSounds({ fetchImpl: makeFetch(server({ synth, local: names })), data: synth.data, sleep: noSleep, cache: bad });
  assert.equal(fourth.files.size, 5);
});

// ---- ./sounds/ folder listing (zero 404 lines in the browser console when the folder is empty) ----------------------------------------
const pythonListing = (names) => new TextEncoder().encode(
  '<!DOCTYPE HTML>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Directory listing for /sounds/</title>\n</head>\n<body>\n'
  + '<h1>Directory listing for /sounds/</h1>\n<hr>\n<ul>\n'
  + names.map((n) => `<li><a href="${encodeURIComponent(n)}">${n}</a></li>\n`).join('') + '</ul>\n<hr>\n</body>\n</html>\n',
);

/** server() plus a ./sounds/ listing answer. */
function serverWithListing({ synth, listing, local = [], s1 = [] }) {
  const base = server({ synth, local, s1 });
  return (url, init) => {
    if (url === './sounds/') return listing === null ? { status: 404 } : (listing instanceof Error ? listing : { status: 200, body: listing });
    return base(url, init);
  };
}

test('discoverLocalIndex: a listing that links our README.txt yields the sound files with their on-disk spelling', async () => {
  const f = makeFetch(() => ({ status: 200, body: pythonListing(['README.txt', 'sound1.wav', 'SOUND49D.WAV', 'PINBALL.MID', 'notes.txt', 'PINBALL2.MID']) }));
  const idx = await discoverLocalIndex(f);
  assert.deepEqual([...idx.entries()].sort(), [['PINBALL.MID', 'PINBALL.MID'], ['SOUND1.WAV', 'sound1.wav'], ['SOUND49D.WAV', 'SOUND49D.WAV']]);
  assert.deepEqual(f.calls[0].url, './sounds/');
  const empty = await discoverLocalIndex(makeFetch(() => ({ status: 200, body: pythonListing(['README.txt']) })));
  assert.equal(empty.size, 0, 'a listing without sound files = the folder is empty');
  // nginx / Apache style: relative and sorted-column links, URL-encoded names
  const apache = new TextEncoder().encode('<a href="?C=N;O=D">Name</a><a href="/">Parent</a><a href="README.txt">README.txt</a><a href="sound%2012.WAV">x</a><a href="SOUND3.wav">y</a>');
  assert.deepEqual([...(await discoverLocalIndex(makeFetch(() => ({ status: 200, body: apache })))).keys()], ['SOUND3.WAV']);
});

test('discoverLocalIndex: anything that is not provably a listing of this folder is "unknown" (null)', async () => {
  const notListing = new TextEncoder().encode('<html><body><a href="sound1.wav">app shell with a stray link</a></body></html>');
  for (const handler of [() => ({ status: 404 }), () => ({ status: 403 }), () => ({ status: 500 }), () => new Error('offline'),
    () => ({ status: 200, body: notListing }), () => ({ status: 200, body: new Uint8Array(0) }), () => ({ status: 200, body: randomBytes(500, 3) })]) {
    assert.equal(await discoverLocalIndex(makeFetch(handler)), null);
  }
  assert.equal(await discoverLocalIndex(async () => null), null);
  assert.equal(await discoverLocalIndex(async () => { throw new Error('x'); }), null);
});

test('loadSounds discoverLocal: an empty folder listing means NO local probes at all (no 404s), files come from the next source', async () => {
  const synth = makeSynth(7);
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(serverWithListing({ synth, listing: pythonListing(['README.txt']), s1: names }));
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, discoverLocal: true });
  assert.equal(r.files.size, synth.keys.length);
  assert.equal(f.calls.filter((c) => c.url === './sounds/').length, 1, 'the folder is listed once');
  assert.equal(f.calls.filter((c) => isLocal(c.url) && c.url !== './sounds/').length, 0, 'not one blind probe');
  assert.ok(Object.values(r.sources).every((s) => s === 'S1'));
});

test('loadSounds discoverLocal: only the listed files are requested locally, with the spelling the server uses', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(serverWithListing({
    synth, listing: pythonListing(['README.txt', 'sound3.wav', 'SOUND49D.WAV']), local: ['SOUND3.WAV', 'SOUND49D.WAV'], s1: names,
  }), { yieldTicks: 1 });
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, discoverLocal: true, concurrency: 1 });
  assert.equal(r.sources.SOUND3, 'local');
  assert.equal(r.sources.SOUND49D, 'local');
  assert.equal(r.sources.SOUND1, 'S1');
  const localUrls = f.calls.map((c) => c.url).filter((u) => isLocal(u) && u !== './sounds/');
  assert.deepEqual(localUrls, ['./sounds/sound3.wav', './sounds/SOUND49D.WAV'], 'exact spelling, no 404 probes for the other files');
  // a listing of a different folder (no README.txt) is ignored: blind probing with the circuit breaker as before
  const g = makeFetch(serverWithListing({ synth, listing: new TextEncoder().encode('<a href="other.txt">x</a>'), local: names }));
  const r2 = await loadSounds({ fetchImpl: g, data: synth.data, sleep: noSleep, discoverLocal: true, concurrency: 1 });
  assert.ok(Object.values(r2.sources).every((s) => s === 'local'));
});

test('loadSounds discoverLocal: listing refused / failing falls back to per-file probing; fully cached sessions request nothing', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  for (const listing of [null, new Error('boom')]) {
    const f = makeFetch(serverWithListing({ synth, listing, local: names }));
    const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, discoverLocal: true });
    assert.equal(r.files.size, 5);
    assert.ok(Object.values(r.sources).every((s) => s === 'local'));
  }
  const cache = createCache({ indexedDB: makeFakeIndexedDB() });
  await loadSounds({ fetchImpl: makeFetch(server({ synth, local: names })), data: synth.data, sleep: noSleep, cache });
  const f = makeFetch(() => ({ status: 500 }));
  const r = await loadSounds({ fetchImpl: f, data: synth.data, sleep: noSleep, cache, discoverLocal: true });
  assert.equal(r.files.size, 5);
  assert.equal(f.calls.length, 0, 'the listing is requested lazily: a cache-only session never touches the network');
});

// =====================================================================================================================
// cache.js
// =====================================================================================================================
test('createCache: round trip, source tag, miss, clear', async () => {
  const idb = makeFakeIndexedDB();
  const c = createCache({ indexedDB: idb });
  assert.equal(idb.opens, 0, 'nothing is opened at creation');
  assert.equal(await c.get('k'), null);
  const buf = toAB(randomBytes(32));
  assert.equal(await c.put('k', buf, 'S5'), true);
  assert.deepEqual(new Uint8Array(await c.get('k')), new Uint8Array(buf));
  assert.equal((await c.getEntry('k')).source, 'S5');
  assert.equal(await c.get('other'), null);
  assert.equal(idb.opens, 1, 'the database is opened once');
  await c.clear();
  assert.equal(await c.get('k'), null);
  assert.equal(await c.put('x', 'not a buffer'), false);
});

test('createCache: missing, blocked or failing IndexedDB degrades to a silent no-op', async () => {
  for (const opts of [{ indexedDB: undefined }, { indexedDB: null }, { indexedDB: makeFakeIndexedDB({ failOpen: true }) },
    { indexedDB: makeFakeIndexedDB({ throwOnOpen: true }) }, { indexedDB: {} }]) {
    const c = createCache(opts);
    assert.equal(await c.get('k'), null);
    assert.equal(await c.put('k', new ArrayBuffer(4)), false);
    assert.equal(await c.getEntry('k'), null);
    await c.clear();
    assert.equal(c.isAvailable(), false);
  }
  const failTx = createCache({ indexedDB: makeFakeIndexedDB({ failTx: true }) });
  assert.equal(await failTx.get('k'), null);
  assert.equal(await failTx.put('k', new ArrayBuffer(4)), false);
  // Node has no indexedDB global: the default must be a no-op, not an exception
  const dflt = createCache();
  assert.equal(await dflt.get('k'), null);
});

// =====================================================================================================================
// mixer.js
// =====================================================================================================================
const fakeBuffer = (seconds = 1) => ({ duration: seconds });

test('Mixer: graph wiring, one non-looping source per play, per-voice gain', () => {
  const ctx = new FakeAudioContext();
  const m = new Mixer({ ctx });
  assert.equal(m.maxVoices, 8);
  assert.equal(m.master.to, ctx.destination);
  assert.equal(m.sfxGain.to, m.master);
  assert.equal(m.musicGain.to, m.master);
  assert.equal(m.getMusicDestination(), m.musicGain);
  const v = m.play(fakeBuffer(), { gain: 0.5 });
  assert.ok(v && typeof v.stop === 'function');
  assert.equal(ctx.sources.length, 1);
  const src = ctx.sources[0];
  assert.equal(src.loop, false);
  assert.equal(src.startedAt, 0);
  assert.equal(src.to.gain.value, 0.5);
  assert.equal(src.to.to, m.sfxGain);
  assert.equal(m.voiceCount, 1);
  assert.equal(m.play(null), null);
  assert.throws(() => new Mixer({}), TypeError);
});

test('Mixer: at most 8 voices - when full the OLDEST is stopped', () => {
  const ctx = new FakeAudioContext();
  const m = new Mixer({ ctx, maxVoices: 8 });
  for (let i = 0; i < 8; i++) m.play(fakeBuffer(10));
  assert.equal(m.voiceCount, 8);
  assert.ok(ctx.sources.every((s) => s.stops.length === 0));
  m.play(fakeBuffer(10)); // 9th: steals voice #1
  assert.equal(ctx.sources.length, 9);
  assert.equal(ctx.sources[0].stops.length, 1, 'oldest stopped');
  assert.ok(ctx.sources.slice(1, 9).every((s) => s.stops.length === 0), 'the rest keep playing');
  assert.equal(m.voiceCount, 8);
  m.play(fakeBuffer(10)); // 10th: steals voice #2
  assert.equal(ctx.sources[1].stops.length, 1);
  assert.equal(ctx.sources[2].stops.length, 0);
  assert.equal(m.voiceCount, 8);
  for (let i = 0; i < 30; i++) m.play(fakeBuffer(10));
  assert.equal(m.voiceCount, 8, 'never more than 8 at once');
});

test('Mixer: maxVoices is clamped to 1..32 and honoured', () => {
  const ctx = new FakeAudioContext();
  assert.equal(new Mixer({ ctx, maxVoices: 0 }).maxVoices, 1);
  assert.equal(new Mixer({ ctx, maxVoices: 99 }).maxVoices, 32);
  assert.equal(new Mixer({ ctx, maxVoices: 'x' }).maxVoices, 8);
  const m = new Mixer({ ctx, maxVoices: 2 });
  m.play(fakeBuffer(5)); m.play(fakeBuffer(5)); m.play(fakeBuffer(5));
  assert.equal(m.voiceCount, 2);
  assert.equal(ctx.sources[0].stops.length, 1);
});

test('Mixer: ended voices are released, prune sweeps finished ones by time, voice.stop and stopAll work', () => {
  const ctx = new FakeAudioContext();
  const m = new Mixer({ ctx });
  m.play(fakeBuffer(1));
  m.play(fakeBuffer(3));
  const v3 = m.play(fakeBuffer(5));
  assert.equal(m.voiceCount, 3);
  ctx.sources[0].onended(); // the browser reports the first voice finished
  assert.equal(m.voiceCount, 2);
  ctx.currentTime = 3.5; // the 3 s voice is over (its ended event never arrived)
  assert.equal(m.voiceCount, 1);
  v3.stop();
  assert.equal(ctx.sources[2].stops.length, 1);
  assert.equal(m.voiceCount, 0);
  m.play(fakeBuffer(9)); m.play(fakeBuffer(9));
  m.stopAll();
  assert.equal(m.voiceCount, 0);
  assert.ok(ctx.sources.slice(-2).every((s) => s.stops.length === 1));
});

test('Mixer: master / sfx / music gains and mute (mute silences effects only)', () => {
  const ctx = new FakeAudioContext();
  const m = new Mixer({ ctx });
  m.setVolume(0.25);
  assert.equal(m.master.gain.value, 0.25);
  assert.equal(m.getVolume(), 0.25);
  m.setVolume(9); assert.equal(m.master.gain.value, 1);
  m.setVolume(-3); assert.equal(m.master.gain.value, 0);
  m.setVolume(Number.NaN); assert.equal(m.master.gain.value, 0, 'NaN ignored');
  m.setVolume(1);
  m.setSfxVolume(0.5); assert.equal(m.sfxGain.gain.value, 0.5);
  m.setMusicVolume(0.3); assert.equal(m.musicGain.gain.value, 0.3);
  m.play(fakeBuffer(5));
  m.setMuted(true);
  assert.equal(m.sfxGain.gain.value, 0);
  assert.equal(m.musicGain.gain.value, 0.3, 'music is independent of the effects mute');
  assert.equal(m.voiceCount, 0, 'muting silences in-flight effects');
  assert.equal(m.isMuted(), true);
  m.setMuted(false);
  assert.equal(m.sfxGain.gain.value, 0.5);
  m.dispose();
});

// =====================================================================================================================
// createAudio facade
// =====================================================================================================================
const allKeys = Object.keys(REAL.SOUND_KEYS);

test('createAudio: importable and usable in Node with no globals; play returns the manifest duration for all keys', async () => {
  const saved = { fetch: globalThis.fetch, ac: globalThis.AudioContext, wk: globalThis.webkitAudioContext, idb: globalThis.indexedDB };
  try {
    globalThis.fetch = undefined;
    globalThis.AudioContext = undefined;
    const a = createAudio();
    assert.equal(allKeys.length, 55);
    for (const k of allKeys) assert.equal(a.play(k), REAL.soundDuration(k), k);
    assert.ok(Math.abs(a.play('NEW_GAME') - 55490 / 11000) < 1e-6, 'bytes / 11000');
    for (const k of ['PLUNGER_PULL', 'GAME_OVER', 'SW37', 'SW44', 'SW52', 'SW59', 'NOPE', '', undefined, null, 7, {}, '__proto__', 'constructor', 'toString']) {
      assert.equal(a.play(k), -1, 'missing / unknown -> -1: ' + String(k));
    }
    assert.ok(Math.abs(a.durationOf('SW7') - 26442 / 11000) < 1e-6);
    assert.equal(a.durationOf('SW37'), -1);
    await a.unlock(); // resolves although audio is impossible
    assert.equal((await a.load()).state, 'unavailable');
    assert.deepEqual(await a.loadFromFiles([]), a.getStatus());
    a.setVolume(0.5); a.setEnabled(false); a.setPaused(true); a.setPaused(false); a.stopAll(); a.update(0.016);
    assert.equal(a.isEnabled(), false);
    assert.equal(a.music.available(), false);
    await a.music.setEnabled(true);
    a.music.pause(); a.music.resume(); a.music.stop();
    assert.equal(a.music.available(), false);
  } finally {
    globalThis.fetch = saved.fetch;
    globalThis.AudioContext = saved.ac;
  }
});

/** Real-manifest harness: files are tagged so a fake SHA-1 can map them back; everything else is the production code path. */
function realHarness({ servedUrls = (u) => isLocal(u) } = {}) {
  const keys = Object.keys(REAL.SOUND_FILES);
  const bodies = new Map();
  keys.forEach((k, i) => {
    const u = new Uint8Array(REAL.SOUND_FILES[k].bytes);
    u[0] = i & 255; u[1] = i >> 8;
    bodies.set(k + '.WAV', u);
  });
  const fakeSha1 = async (buf) => {
    const u = new Uint8Array(buf);
    const k = keys[u[0] | (u[1] << 8)];
    return k ? REAL.SOUND_FILES[k].sha1 : 'ff';
  };
  const fetchImpl = makeFetch((url) => (servedUrls(url) && bodies.has(baseOf(url)) ? { status: 200, body: bodies.get(baseOf(url)) } : { status: 404 }));
  return { keys, bodies, fakeSha1, fetchImpl };
}

test('createAudio: play() returns the manifest duration in every state and only makes noise when everything is in place', async () => {
  const h = realHarness();
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ fetch: h.fetchImpl, AudioContext: FakeAudioContext, sha1: h.fakeSha1, cache: false, log: () => {}, sleep: noSleep });
  const expectAll = () => { for (const k of allKeys) assert.equal(audio.play(k), REAL.soundDuration(k), k); };
  const ctxOf = () => FakeAudioContext.instances[created];
  expectAll(); // 1. fresh (not unlocked, not loaded)
  await audio.unlock();
  expectAll(); // 2. unlocked, nothing loaded
  assert.equal(ctxOf().sources.length, 0);
  const st = await audio.load();
  assert.equal(st.state, 'ready');
  assert.equal(st.loaded, 41);
  expectAll(); // 3. loaded: sound plays
  const withFile = allKeys.filter((k) => REAL.SOUND_KEYS[k].file);
  assert.equal(withFile.length, 49);
  assert.equal(ctxOf().sources.length, 49, 'one source per key that has a file; the six missing keys are silent');
  assert.equal(ctxOf().decoded.length, 41, 'each distinct file decoded once');
  const before = ctxOf().sources.length;
  audio.setEnabled(false);
  expectAll(); // 4. disabled
  assert.equal(ctxOf().sources.length, before);
  audio.setEnabled(true);
  audio.setPaused(true);
  expectAll(); // 5. paused
  assert.equal(ctxOf().sources.length, before);
  audio.setPaused(false);
  expectAll(); // 6. resumed
  assert.equal(ctxOf().sources.length, before + 49);
  assert.equal(audio.play('GAME_OVER'), -1);
  assert.equal(ctxOf().sources.length, before + 49, 'a missing file never starts a voice');
});

test('createAudio: unlock() creates and resumes the context synchronously inside the gesture; it is idempotent', async () => {
  const before = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, cache: false });
  assert.equal(FakeAudioContext.instances.length, before, 'nothing at creation');
  const p = audio.unlock(); // NOT awaited yet
  assert.equal(FakeAudioContext.instances.length, before + 1, 'context created synchronously');
  const ctx = FakeAudioContext.instances[before];
  assert.equal(ctx.resumeCalls, 1, 'resume() called synchronously');
  assert.deepEqual(ctx.opts, { latencyHint: 'interactive' });
  await p;
  await audio.unlock();
  assert.equal(FakeAudioContext.instances.length, before + 1, 'idempotent');
  assert.equal(ctx.resumeCalls, 1, 'already running: no second resume');
  // constructor that rejects options still works, and a constructor that throws is survivable
  let n = 0;
  class Picky extends FakeAudioContext { constructor(o) { if (o !== undefined) throw new TypeError('no options'); super(o); n++; } }
  await createAudio({ AudioContext: Picky }).unlock();
  assert.equal(n, 1);
  class Broken { constructor() { throw new Error('nope'); } }
  await createAudio({ AudioContext: Broken }).unlock();
});

test('createAudio: load() before unlock() keeps the validated bytes and decodes them when the context appears', async () => {
  const h = realHarness();
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ fetch: h.fetchImpl, AudioContext: FakeAudioContext, sha1: h.fakeSha1, cache: false, log: () => {}, sleep: noSleep });
  const st = await audio.load();
  assert.equal(st.state, 'ready');
  assert.equal(FakeAudioContext.instances.length, created);
  await audio.unlock();
  await flush(20);
  const ctx = FakeAudioContext.instances[created];
  assert.equal(ctx.decoded.length, 41);
  audio.play('BUMPER');
  assert.equal(ctx.sources.length, 1);
});

test('createAudio: status states and texts through the whole lifecycle (local / Internet Archive / mixed / partial / unavailable)', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const mk = (handler) => createAudio({
    fetch: makeFetch(handler), AudioContext: FakeAudioContext, data: synth.data, cache: false, log: () => {}, sleep: noSleep,
  });

  const a = mk(server({ synth, local: names }));
  assert.deepEqual(a.getStatus(), { state: 'idle', loaded: 0, total: 5, source: null, text: 'sound: not loaded' });
  const seen = [];
  const off = a.onStatus((s) => seen.push(s));
  const final = await a.load();
  assert.deepEqual(final, { state: 'ready', loaded: 5, total: 5, source: 'local', text: 'sound: original (local)' });
  assert.ok(seen.some((s) => s.state === 'loading' && /^sound: loading \d\/5\.\.\.$/.test(s.text)), 'loading n/5... was reported');
  assert.deepEqual(seen[seen.length - 1], final);
  off();
  const count = seen.length;
  await a.load(); // already complete: nothing new
  assert.equal(seen.length, count, 'unsubscribed listener stays quiet');

  const s1 = await mk(server({ synth, s1: names })).load();
  assert.deepEqual(s1, { state: 'ready', loaded: 5, total: 5, source: 'S1', text: 'sound: original (Internet Archive)' });
  const s5 = await mk(server({ synth, s5: names })).load();
  assert.equal(s5.source, 'S5');
  assert.equal(s5.text, 'sound: original (Internet Archive)');

  const mixed = await mk(server({ synth, local: ['SOUND1.WAV'], s1: names })).load();
  assert.equal(mixed.state, 'ready');
  assert.equal(mixed.source, 'mixed');
  assert.equal(mixed.text, 'sound: original (mixed)');
  const archives = await mk(server({ synth, s1: names.slice(0, 2), s5: names.slice(2) })).load();
  assert.equal(archives.source, 'mixed');
  assert.equal(archives.text, 'sound: original (Internet Archive)');

  const partial = await mk(server({ synth, s1: names.slice(0, 3) })).load();
  assert.deepEqual(partial, { state: 'partial', loaded: 3, total: 5, source: 'S1', text: 'sound: partial (3/5)' });

  const none = await mk(() => ({ status: 404 })).load();
  assert.deepEqual(none, { state: 'unavailable', loaded: 0, total: 5, source: null, text: 'sound: not loaded' });
});

test('createAudio: load() is shared while running and never rejects; getStatus returns snapshots', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(server({ synth, local: names }));
  const a = createAudio({ fetch: f, data: synth.data, cache: false, log: () => {}, sleep: noSleep });
  const p1 = a.load();
  const p2 = a.load();
  assert.strictEqual(p1, p2);
  await p1;
  assert.equal(f.calls.filter((c) => c.url !== './sounds/').length, 5, 'five files, requested once each (plus one folder-listing probe)');
  const s = a.getStatus();
  s.text = 'tampered';
  assert.equal(a.getStatus().text, 'sound: original (local)');
  const boom = createAudio({ fetch: async () => { throw new Error('x'); }, data: synth.data, cache: false, sleep: noSleep });
  assert.equal((await boom.load()).state, 'unavailable');
});

test('createAudio: nothing is requested at import or creation time; the network starts only in load()', async () => {
  const f = makeFetch(() => ({ status: 404 }));
  const a = createAudio({ fetch: f, AudioContext: FakeAudioContext, cache: false });
  await a.unlock();
  a.play('BUMPER'); a.setVolume(0.2); a.update(0.016);
  assert.equal(f.calls.length, 0);
  await a.load();
  assert.ok(f.calls.length > 0);
});

test('createAudio: setPaused suspends the context and silences voices; resume brings it back; stopAll stops voices', async () => {
  const h = realHarness();
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ fetch: h.fetchImpl, AudioContext: FakeAudioContext, sha1: h.fakeSha1, cache: false, log: () => {}, sleep: noSleep });
  await audio.unlock();
  await audio.load();
  const ctx = FakeAudioContext.instances[created];
  audio.play('BUMPER'); audio.play('KICKOUT');
  assert.equal(ctx.sources.length, 2);
  audio.setPaused(true);
  assert.equal(ctx.suspendCalls, 1);
  assert.equal(ctx.sources[0].stops.length, 1, 'pause silences playing voices');
  audio.setPaused(true);
  assert.equal(ctx.suspendCalls, 1, 'idempotent');
  audio.play('BUMPER');
  assert.equal(ctx.sources.length, 2, 'no new voices while paused');
  audio.setPaused(false);
  assert.equal(ctx.resumeCalls, 2);
  audio.play('BUMPER');
  assert.equal(ctx.sources.length, 3);
  audio.stopAll();
  assert.equal(ctx.sources[2].stops.length, 1);
});

test('createAudio: setVolume clamps 0..1 on the master gain; the effects mute follows setEnabled', async () => {
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, cache: false });
  audio.setVolume(0.3); // before unlock: remembered
  await audio.unlock();
  const ctx = FakeAudioContext.instances[created];
  const [master, sfx, music] = ctx.gains;
  assert.equal(master.gain.value, 0.3);
  audio.setVolume(5); assert.equal(master.gain.value, 1);
  audio.setVolume(-1); assert.equal(master.gain.value, 0);
  audio.setVolume('0.5'); assert.equal(master.gain.value, 0.5);
  audio.setVolume(NaN); assert.equal(master.gain.value, 0.5);
  audio.setVolume(undefined); assert.equal(master.gain.value, 0.5);
  assert.equal(sfx.gain.value, 1);
  audio.setEnabled(false);
  assert.equal(sfx.gain.value, 0);
  assert.equal(music.gain.value, 1, 'music has its own switch');
  audio.setEnabled(true);
  assert.equal(sfx.gain.value, 1);
});

test('createAudio: separate effects and music bus gains (remembered before unlock, clamped)', async () => {
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, cache: false });
  audio.setSfxVolume(0.4); audio.setMusicVolume(0.2);
  await audio.unlock();
  const [, sfx, music] = FakeAudioContext.instances[created].gains;
  assert.equal(sfx.gain.value, 0.4);
  assert.equal(music.gain.value, 0.2);
  audio.setSfxVolume(7); audio.setMusicVolume(-1); audio.setSfxVolume('x');
  assert.equal(sfx.gain.value, 1);
  assert.equal(music.gain.value, 0);
});

test('createAudio: no voice is started while the context is not running (autoplay-blocked)', async () => {
  const h = realHarness();
  const created = FakeAudioContext.instances.length;
  class Blocked extends FakeAudioContext { resume() { this.resumeCalls++; return Promise.resolve(); } } // stays suspended
  const audio = createAudio({ fetch: h.fetchImpl, AudioContext: Blocked, sha1: h.fakeSha1, cache: false, log: () => {}, sleep: noSleep, document: null });
  await audio.unlock();
  await audio.load();
  audio.play('BUMPER');
  assert.equal(FakeAudioContext.instances[created].sources.length, 0);
});

test('createAudio: a context blocked by autoplay rules resumes on the first user gesture', async () => {
  const listeners = new Map();
  const doc = {
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
  };
  const created = FakeAudioContext.instances.length;
  class Blocked extends FakeAudioContext { resume() { this.resumeCalls++; if (this.allow) this.state = 'running'; return Promise.resolve(); } }
  const audio = createAudio({ AudioContext: Blocked, cache: false, document: doc });
  await audio.unlock();
  const ctx = FakeAudioContext.instances[created];
  assert.equal(ctx.state, 'suspended');
  assert.deepEqual([...listeners.keys()].sort(), ['click', 'keydown', 'mousedown', 'pointerdown', 'pointerup', 'touchend']);   // every activation-capable input event
  ctx.allow = true;
  listeners.get('pointerdown')();
  await flush();
  assert.equal(ctx.state, 'running');
  assert.equal(listeners.size, 0, 'listeners removed after the first gesture');
});

// ---- user files ------------------------------------------------------------------------------------------------------------
function userFile(name, bytes, rel) {
  const f = new File([bytes], name);
  if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
}

test('createAudio.loadFromFiles: merges valid user files, rejects tampered ones, reports the user source', async () => {
  const synth = makeSynth();
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, data: synth.data, cache: false, log: () => {} });
  await audio.unlock();
  const tampered = synth.blobs.get('SOUND4.WAV').slice();
  tampered[5] ^= 1;
  const files = [
    userFile('SOUND1.WAV', synth.blobs.get('SOUND1.WAV'), 'Pinball/SOUND1.WAV'),
    userFile('sound3.wav', synth.blobs.get('SOUND3.WAV'), 'Pinball/SOUND/sound3.wav'),
    userFile('SOUND4.WAV', tampered, 'Pinball/SOUND4.WAV'),
    userFile('PINBALL.DAT', randomBytes(50), 'Pinball/PINBALL.DAT'),
    userFile('SOUND6.WAV', randomBytes(50), 'Pinball/SOUND6.WAV'),
  ];
  const st = await audio.loadFromFiles(files);
  assert.equal(st.state, 'partial');
  assert.equal(st.loaded, 2);
  assert.equal(st.source, 'user');
  assert.equal(st.text, 'sound: partial (2/5)');
  assert.deepEqual(audio.getLastImport(), { matched: 3, accepted: 2, rejected: 1, music: false });
  assert.equal(FakeAudioContext.instances[created].decoded.length, 2);
  audio.play('FLIP_UP');
  assert.equal(FakeAudioContext.instances[created].sources.length, 1);
  // second pick completes the set; already-loaded files are merged, not duplicated
  const rest = [
    userFile('SOUND1.WAV', synth.blobs.get('SOUND1.WAV')),
    userFile('SOUND4.WAV', synth.blobs.get('SOUND4.WAV')),
    userFile('SOUND5.WAV', synth.blobs.get('SOUND5.WAV')),
    userFile('SOUND49D.WAV', synth.blobs.get('SOUND49D.WAV')),
  ];
  const st2 = await audio.loadFromFiles(rest);
  assert.deepEqual(st2, { state: 'ready', loaded: 5, total: 5, source: 'user', text: 'sound: original (your files)' });
  assert.equal(audio.getSourceMap().SOUND49D, 'user');
});

test('createAudio.loadFromFiles: network files + user files give a mixed source; garbage input never throws', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const audio = createAudio({
    fetch: makeFetch(server({ synth, s1: names.slice(0, 3) })), data: synth.data, cache: false, log: () => {}, sleep: noSleep,
  });
  assert.equal((await audio.load()).state, 'partial');
  const st = await audio.loadFromFiles([userFile('SOUND5.WAV', synth.blobs.get('SOUND5.WAV')), userFile('SOUND49D.WAV', synth.blobs.get('SOUND49D.WAV'))]);
  assert.equal(st.state, 'ready');
  assert.equal(st.source, 'mixed');
  assert.equal(st.text, 'sound: original (mixed)');
  for (const junk of [null, undefined, 5, 'x', {}, [null], [{}], [new File(['x'], 'readme.txt')]]) {
    const before = audio.getStatus();
    assert.deepEqual(await audio.loadFromFiles(junk), before);
  }
});

test('createAudio.loadFromFiles: validated user files are stored in the cache, and the next session picks them up without any network', async () => {
  const synth = makeSynth();
  const idb = makeFakeIndexedDB();
  const first = createAudio({ data: synth.data, cache: createCache({ indexedDB: idb }), log: () => {} });
  await first.loadFromFiles(synth.keys.map((k) => userFile(k + '.WAV', synth.blobs.get(k + '.WAV'))));
  const f = makeFetch(() => ({ status: 500 }));
  const second = createAudio({ data: synth.data, cache: createCache({ indexedDB: idb }), fetch: f, log: () => {}, sleep: noSleep });
  const st = await second.load();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(st, { state: 'ready', loaded: 5, total: 5, source: 'user', text: 'sound: original (your files)' });
});

test('createAudio: music is OFF by default - no MID request until music.setEnabled(true); a user PINBALL.MID is validated', async () => {
  const synth = makeSynth();
  const names = synth.keys.map((k) => k + '.WAV');
  const f = makeFetch(server({ synth, local: [...names, 'PINBALL.MID'] }));
  const audio = createAudio({ fetch: f, AudioContext: FakeAudioContext, data: synth.data, cache: false, log: () => {}, sleep: noSleep });
  await audio.unlock();
  await audio.load();
  assert.ok(!f.calls.some((c) => baseOf(c.url) === 'PINBALL.MID'));
  assert.equal(audio.music.available(), false);
  // the synthetic MID is random bytes, so it parses to nothing: music stays silent and unavailable, without throwing
  await audio.music.setEnabled(true);
  assert.ok(f.calls.some((c) => baseOf(c.url) === 'PINBALL.MID' && isLocal(c.url)));
  assert.equal(audio.music.available(), false);
  // a PINBALL.MID that fails validation is ignored
  const other = createAudio({ data: synth.data, cache: false, log: () => {} });
  await other.loadFromFiles([userFile('PINBALL.MID', randomBytes(400, 1))]);
  assert.deepEqual(other.getLastImport(), { matched: 1, accepted: 0, rejected: 1, music: false });
  await other.loadFromFiles([userFile('PINBALL.MID', synth.blobs.get('PINBALL.MID'))]);
  assert.equal(other.getLastImport().music, true);
});

test('createAudio: update() is cheap and safe in every state; dispose closes the context', async () => {
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, cache: false });
  audio.update(0.016);
  await audio.unlock();
  for (let i = 0; i < 50; i++) audio.update(0.016);
  audio.dispose();
  assert.equal(FakeAudioContext.instances[created].closed, true);
  assert.equal(audio.play('BUMPER'), REAL.soundDuration('BUMPER'));
  audio.update(0.016);
});

test('createAudio: attachDropTarget / pickDirectory are wired through the user-file loader', async () => {
  const synth = makeSynth();
  const audio = createAudio({ data: synth.data, cache: false, log: () => {}, window: {} });
  assert.equal(audio.canPickDirectory(), false);
  assert.equal((await audio.pickDirectory()).state, 'idle', 'unsupported -> no change, no throw');
  const dir = {
    kind: 'directory', name: 'Pinball',
    async *values() {
      for (const k of synth.keys) yield { kind: 'file', name: k + '.WAV', getFile: async () => userFile(k + '.WAV', synth.blobs.get(k + '.WAV')) };
    },
  };
  const withPicker = createAudio({ data: synth.data, cache: false, log: () => {}, window: { showDirectoryPicker: async () => dir } });
  assert.equal(withPicker.canPickDirectory(), true);
  const st = await withPicker.pickDirectory();
  assert.equal(st.state, 'ready');
  assert.equal(st.source, 'user');
  const cancelled = createAudio({ data: synth.data, cache: false, window: { showDirectoryPicker: async () => { throw new DOMException('x', 'AbortError'); } } });
  assert.equal((await cancelled.pickDirectory()).state, 'idle');
  // drop target
  const handlers = new Map();
  const target = { addEventListener: (t, fn) => handlers.set(t, fn), removeEventListener: (t) => handlers.delete(t) };
  const loaded = new Promise((resolve) => { audio.__resolveDrop = resolve; });
  const detach = audio.attachDropTarget(target, (st) => audio.__resolveDrop(st));
  assert.deepEqual([...handlers.keys()].sort(), ['dragover', 'drop']);
  let prevented = 0;
  const files = synth.keys.map((k) => userFile(k + '.WAV', synth.blobs.get(k + '.WAV')));
  handlers.get('drop')({ preventDefault: () => { prevented++; }, dataTransfer: { types: ['Files'], items: [], files } });
  assert.equal(prevented, 1);
  const dropped = await loaded;
  assert.equal(dropped.state, 'ready');
  assert.equal(audio.getStatus().state, 'ready');
  detach();
  assert.equal(handlers.size, 0);
});

test('sha1 of the node:crypto reference helper agrees with sha1Hex (sanity for the whole suite)', async () => {
  const b = randomBytes(1234, 5);
  assert.equal(await sha1Hex(b), sha1(b));
});
