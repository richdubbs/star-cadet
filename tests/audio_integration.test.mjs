/**
 * tests/audio_integration.test.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * Audio facade behaviour that only shows in a real page, tested with fake contexts / documents / fetch:
 *   - the autoplay policy: a context that could not start is retried by EVERY later user gesture (listeners armed synchronously, because a
 *     resume() issued without a gesture may never settle); unlockOnGesture() creates the context only at the first gesture;
 *   - pause / resume pairs while a suspend() is still in flight, and a resume that completes after the pause;
 *   - the local ./sounds/ folder path (listing, blind probing, lower-case names, partial folders) over a TEMPORARY folder with tiny fake files
 *     whose manifest is synthetic: a wrong hash or a wrong size is rejected, a missing file is skipped, nothing real is ever downloaded and
 *     every non-local URL answers 404 without touching a network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAudio } from '../src/audio.js';
import { FakeAudioContext, flush, makeFetch, makeSynth, sha1 } from './audio_helpers/fake_audio.mjs';

const noSleep = async () => {};
const GESTURES = ['click', 'keydown', 'mousedown', 'pointerdown', 'pointerup', 'touchend'];

function fakeDoc() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
    fire: (t) => { const fn = listeners.get(t); if (fn) fn(); return Boolean(fn); },
  };
}

// =====================================================================================================================================
// autoplay policy
// =====================================================================================================================================
test('autoplay: unlock() outside a gesture arms the listeners SYNCHRONOUSLY (its resume() may never settle) and the next gesture starts the context', async () => {
  const doc = fakeDoc();
  class Pending extends FakeAudioContext {
    resume() { this.resumeCalls++; if (this.allow) { this.state = 'running'; return Promise.resolve(); } return new Promise(() => {}); }
  }
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: Pending, cache: false, document: doc });
  audio.unlock();                                                  // NOT awaited: its promise never settles
  const ctx = FakeAudioContext.instances[created];
  assert.equal(ctx.state, 'suspended');
  assert.deepEqual([...doc.listeners.keys()].sort(), GESTURES, 'armed without waiting for any promise');
  assert.equal(doc.fire('touchend') && ctx.state, 'suspended', 'a gesture that does not let the context start keeps the listeners');
  assert.equal(doc.listeners.size, GESTURES.length);
  ctx.allow = true;
  doc.fire('keydown');
  await flush();
  assert.equal(ctx.state, 'running');
  assert.equal(doc.listeners.size, 0, 'removed once the context runs');
  audio.dispose();
});

test('autoplay: unlockOnGesture() creates NOTHING until the first gesture (no browser warning), then creates and resumes the context; touch pointerdown that does not count is retried', async () => {
  const doc = fakeDoc();
  let allow = false;
  class Gated extends FakeAudioContext {
    resume() { this.resumeCalls++; if (allow) this.state = 'running'; return Promise.resolve(); }
  }
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: Gated, cache: false, document: doc });
  audio.unlockOnGesture();
  assert.equal(FakeAudioContext.instances.length, created, 'no context before the gesture');
  assert.deepEqual([...doc.listeners.keys()].sort(), GESTURES);
  doc.fire('pointerdown');                                         // a touch pointerdown: not an activation, the context stays suspended
  await flush();
  const ctx = FakeAudioContext.instances[created];
  assert.ok(ctx, 'the first gesture creates it');
  assert.equal(ctx.state, 'suspended');
  assert.equal(doc.listeners.size, GESTURES.length, 'and keeps listening');
  allow = true;
  doc.fire('pointerup');                                           // ... the touch pointerup is
  await flush();
  assert.equal(ctx.state, 'running');
  assert.equal(doc.listeners.size, 0);
  assert.equal(FakeAudioContext.instances.length, created + 1, 'exactly one context');
  audio.unlockOnGesture();                                         // already running: nothing to arm
  assert.equal(doc.listeners.size, 0);
  audio.dispose();
});

test('autoplay: unlockOnGesture() then unlock() (the start button) share one context; dispose() removes the listeners', async () => {
  const doc = fakeDoc();
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, cache: false, document: doc });
  audio.unlockOnGesture();
  await audio.unlock();
  assert.equal(FakeAudioContext.instances.length, created + 1);
  assert.equal(FakeAudioContext.instances[created].state, 'running');
  assert.equal(doc.listeners.size, 0, 'a running context needs no listeners');
  const audio2 = createAudio({ AudioContext: class extends FakeAudioContext { resume() { return new Promise(() => {}); } }, cache: false, document: doc });
  audio2.unlock();
  assert.equal(doc.listeners.size, GESTURES.length);
  audio2.dispose();
  assert.equal(doc.listeners.size, 0);
});

test('autoplay: a context the browser suspends or interrupts on its own (statechange) is brought back by the next gesture', async () => {
  const doc = fakeDoc();
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: FakeAudioContext, cache: false, document: doc });
  await audio.unlock();
  const ctx = FakeAudioContext.instances[created];
  assert.equal(doc.listeners.size, 0);
  ctx.state = 'interrupted';                                       // phone call / background tab
  ctx.onstatechange();
  assert.equal(doc.listeners.size, GESTURES.length);
  doc.fire('click');
  await flush();
  assert.equal(ctx.state, 'running');
  assert.equal(doc.listeners.size, 0);
  // while the game is paused the context is suspended ON PURPOSE: no re-arming, no resume
  audio.setPaused(true);
  assert.equal(ctx.state, 'suspended');
  ctx.onstatechange();
  assert.equal(doc.listeners.size, 0);
  audio.setPaused(false);
  assert.equal(ctx.state, 'running');
});

// =====================================================================================================================================
// pause / resume timing
// =====================================================================================================================================
test('pause then resume while the suspend() has not flipped ctx.state yet (browsers differ): the context still ends up running', async () => {
  class Slow extends FakeAudioContext {
    suspend() { this.suspendCalls++; return new Promise((res) => { this.finishSuspend = () => { this.state = 'suspended'; res(); }; }); }
  }
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: Slow, cache: false, document: null });
  await audio.unlock();
  const ctx = FakeAudioContext.instances[created];
  assert.equal(ctx.state, 'running');
  audio.setPaused(true);                                           // suspend() in flight, state still 'running'
  audio.setPaused(false);                                          // an instant menu open / close
  assert.equal(ctx.resumeCalls, 1, 'no second resume() yet: it would be a no-op while the state still says running');
  ctx.finishSuspend();
  await flush(20);
  assert.equal(ctx.state, 'running', 'the queued resume() ran after the suspend');
  assert.equal(ctx.resumeCalls, 2);
  audio.dispose();
});

test('a resume() that completes after the game was paused again does not leave the context running', async () => {
  const doc = fakeDoc();
  let finish = null;
  class Late extends FakeAudioContext {
    resume() { this.resumeCalls++; return new Promise((res) => { finish = () => { this.state = 'running'; res(); }; }); }
  }
  const created = FakeAudioContext.instances.length;
  const audio = createAudio({ AudioContext: Late, cache: false, document: doc });
  audio.unlock();                                                  // suspended, armed
  const ctx = FakeAudioContext.instances[created];
  doc.fire('keydown');                                             // the key press that also pauses the game ...
  audio.setPaused(true);                                           // ... (state is still 'suspended': nothing to suspend yet)
  finish();                                                        // the resume completes now
  await flush(20);
  assert.equal(ctx.state, 'suspended', 'the context follows the pause');
  assert.ok(ctx.suspendCalls >= 1);
  audio.dispose();
});

// =====================================================================================================================================
// the local ./sounds/ folder (temporary folder, tiny fake files, synthetic manifest, no network)
// =====================================================================================================================================
/** A temporary sounds folder; remove() deletes it. */
function tempFolder(files, { readme = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-sounds-'));
  if (readme) fs.writeFileSync(path.join(dir, 'README.txt'), 'drop-in folder for your own copies\n');
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  return { dir, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * fetch over a temporary folder, shaped like `python -m http.server`: './sounds/' = HTML listing (or 404), './sounds/NAME' = the file
 * (case-sensitive, like most servers) or 404; EVERY other URL (the Internet Archive) is a 404 that never leaves the process.
 * @returns {Function & {log:string[], remote:string[]}}
 */
function folderFetch(dir, { listing = true } = {}) {
  const log = [];
  const remote = [];
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => (body ? new Uint8Array(body).buffer : new ArrayBuffer(0)) });
  const f = async (url) => {
    const u = String(url);
    if (!u.startsWith('./sounds/')) { remote.push(u); return res(404); }
    log.push(u);
    if (u === './sounds/') {
      if (!listing) return res(404);
      const items = fs.readdirSync(dir).map((n) => `<li><a href="${encodeURIComponent(n)}">${n}</a></li>`).join('\n');
      return res(200, Buffer.from(`<!DOCTYPE HTML><html><body><h1>Directory listing for /sounds/</h1><ul>\n${items}\n</ul></body></html>`));
    }
    const name = decodeURIComponent(u.slice('./sounds/'.length));
    const file = path.join(dir, name);
    return fs.existsSync(file) && fs.readdirSync(dir).includes(name) ? res(200, fs.readFileSync(file)) : res(404);
  };
  f.log = log;
  f.remote = remote;
  return f;
}

function folderAudio(synth, fetchImpl, extra = {}) {
  return createAudio({ fetch: fetchImpl, AudioContext: FakeAudioContext, data: synth.data, cache: false, log: () => {}, sleep: noSleep, ...extra });
}

test('local ./sounds/: valid files load from the folder; a wrong hash, a wrong size and a missing file are rejected or skipped; nothing leaves the process', async () => {
  const synth = makeSynth();
  const blob = (n) => synth.blobs.get(n);
  const wrongHash = new Uint8Array(blob('SOUND4.WAV'));
  wrongHash[0] ^= 0xff;                                             // same length, one byte different
  const wrongSize = blob('SOUND5.WAV').slice(0, blob('SOUND5.WAV').length - 1);
  const folder = tempFolder({
    'SOUND1.WAV': blob('SOUND1.WAV'), 'SOUND3.WAV': blob('SOUND3.WAV'), 'SOUND4.WAV': wrongHash, 'SOUND5.WAV': wrongSize,
    'SOUND9999.WAV': blob('SOUND1.WAV'),                            // a file the game does not use
  });
  try {
    const fetchImpl = folderFetch(folder.dir);
    const created = FakeAudioContext.instances.length;
    const audio = folderAudio(synth, fetchImpl);
    await audio.unlock();
    const st = await audio.load();
    assert.equal(st.loaded, 2, 'only the two files with the right size AND SHA-1');
    assert.equal(st.state, 'partial');
    assert.equal(st.text, 'sound: partial (2/5)');
    assert.equal(st.source, 'local');
    assert.deepEqual(Object.keys(audio.getSourceMap()).sort(), ['SOUND1', 'SOUND3']);
    assert.ok(fetchImpl.log.includes('./sounds/SOUND4.WAV'), 'the wrong-hash file WAS read ...');
    assert.equal(audio.getSourceMap().SOUND4, undefined, '... and discarded');
    assert.ok(!fetchImpl.log.includes('./sounds/SOUND49D.WAV'), 'a file the listing does not show is never requested (no 404 noise)');
    assert.ok(!fetchImpl.log.some((u) => /9999/.test(u)), 'neither is a file that is not in the manifest');
    assert.equal(fetchImpl.log[0], './sounds/', 'the listing is the first local request');
    assert.ok(fetchImpl.remote.every((u) => /archive\.org/.test(u)), 'the only other requests are the archive routes (answered with a fake 404)');
    // what plays: FLIP_UP = SOUND1 (valid), BUMPER = SOUND5 (rejected), BALL_FEED = SOUND4 (rejected)
    const ctx = FakeAudioContext.instances[created];
    audio.play('FLIP_UP');
    audio.play('BUMPER');
    audio.play('BALL_FEED');
    assert.equal(ctx.sources.length, 1, 'only the validated file makes a sound');
    assert.equal(ctx.decoded.length, 2);
  } finally { folder.remove(); }
});

test('local ./sounds/: a complete folder gives state ready / source local and no remote request at all', async () => {
  const synth = makeSynth();
  const files = {};
  for (const [name, bytes] of synth.blobs) files[name] = bytes;
  const folder = tempFolder(files);
  try {
    const fetchImpl = folderFetch(folder.dir);
    const audio = folderAudio(synth, fetchImpl);
    const st = await audio.load();
    assert.deepEqual([st.state, st.loaded, st.total, st.source, st.text], ['ready', 5, 5, 'local', 'sound: original (local)']);
    assert.deepEqual(fetchImpl.remote, [], 'nothing is fetched from the archive when the folder is complete');
    assert.equal(audio.music.available(), false, 'music is not requested unless switched on');
  } finally { folder.remove(); }
});

test('local ./sounds/: lower-case file names work (the listing gives the real spelling) and so does a server without a listing (blind probing)', async () => {
  const synth = makeSynth();
  const lower = {};
  for (const [name, bytes] of synth.blobs) lower[name.toLowerCase()] = bytes;
  const folder = tempFolder(lower);
  try {
    const withListing = folderFetch(folder.dir);
    const a = await folderAudio(synth, withListing).load();
    assert.deepEqual([a.state, a.loaded, a.source], ['ready', 5, 'local']);
    assert.ok(withListing.log.includes('./sounds/sound1.wav'), 'the lower-case spelling from the listing is requested directly');
    assert.ok(!withListing.log.includes('./sounds/SOUND1.WAV'));

    const blind = folderFetch(folder.dir, { listing: false });
    const b = await folderAudio(synth, blind).load();
    assert.deepEqual([b.state, b.loaded, b.source], ['ready', 5, 'local'], 'no listing: each file is probed upper-case first, then lower-case');
  } finally { folder.remove(); }
});

test('local ./sounds/: a listing without our README.txt is not trusted; an empty folder costs a handful of probes, then falls through to the archive routes', async () => {
  const synth = makeSynth();
  const folder = tempFolder({ 'SOUND1.WAV': synth.blobs.get('SOUND1.WAV') }, { readme: false });
  try {
    const fetchImpl = folderFetch(folder.dir);
    const st = await folderAudio(synth, fetchImpl).load();
    assert.equal(st.loaded, 1, 'blind probing still finds the one file');
  } finally { folder.remove(); }
  const empty = tempFolder({});
  try {
    const fetchImpl = folderFetch(empty.dir);
    const st = await folderAudio(synth, fetchImpl).load();
    assert.deepEqual([st.state, st.loaded], ['unavailable', 0]);
    assert.deepEqual(fetchImpl.log, ['./sounds/'], 'a listed empty folder is asked once and never probed file by file');
    assert.ok(fetchImpl.remote.length > 0, 'the archive routes are tried next (fake 404s here)');
  } finally { empty.remove(); }
});

test('local ./sounds/: the real manifest rejects tiny fake files of the right names (wrong size) - nothing fake can ever play', async () => {
  const folder = tempFolder({ 'SOUND1.WAV': new Uint8Array(55490).fill(1), 'SOUND3.WAV': new Uint8Array(10), 'SOUND104.WAV': new Uint8Array(1226) });
  try {
    const fetchImpl = folderFetch(folder.dir);
    const created = FakeAudioContext.instances.length;
    const audio = createAudio({ fetch: fetchImpl, AudioContext: FakeAudioContext, cache: false, log: () => {}, sleep: noSleep });
    await audio.unlock();
    const st = await audio.load();
    assert.deepEqual([st.state, st.loaded], ['unavailable', 0], 'right size but wrong SHA-1 (SOUND1), wrong size (SOUND3, SOUND104): all rejected');
    audio.play('FLIP_UP');
    assert.equal(FakeAudioContext.instances[created].sources.length, 0);
    assert.equal(sha1(new Uint8Array(1226)).length, 40);
  } finally { folder.remove(); }
});

test('the load is shared and cheap when called again: a second load() after a full local load makes no request', async () => {
  const synth = makeSynth();
  const files = {};
  for (const [name, bytes] of synth.blobs) files[name] = bytes;
  const folder = tempFolder(files);
  try {
    const fetchImpl = folderFetch(folder.dir);
    const audio = folderAudio(synth, fetchImpl);
    await audio.load();
    const n = fetchImpl.log.length;
    const again = await audio.load();
    assert.equal(again.state, 'ready');
    assert.equal(fetchImpl.log.length, n, 'everything is already in memory');
  } finally { folder.remove(); }
  assert.equal(makeFetch(() => undefined).calls.length, 0);
});
