/**
 * tests/audio_media.test.mjs
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * ARCHITECTURE.md 10.4 / 10.5 + 13.2: parseMidi on synthetic SMFs (tempo change, running status, meta/sysex skipped), the note pairing
 * and the look-ahead synth scheduler (fake AudioContext + manual timer), readZip / inflate on archives built with node:zlib, and
 * pickSoundFiles / drop / directory-handle input handling. No network, no real timers, no Date, no Math.random.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { parseMidi } from '../src/audio/midi.js';
import { buildNotes, createMusic, instrumentFor, LOOKAHEAD_S, TICK_MS } from '../src/audio/music.js';
import { readZip, inflateRawJs } from '../src/audio/zip.js';
import {
  pickSoundFiles, soundKeyForName, snapshotDrop, attachDropTarget, pickDirectory, supportsDirectoryPicker, SOUND_NAME_RE,
} from '../src/audio/userfiles.js';
import {
  FakeAudioContext, be16, be32, demoSong, eot, makeZip, meta, randomBytes, rng, smf, tempo, toAB, track,
} from './audio_helpers/fake_audio.mjs';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const types = (events) => events.map((e) => `${e.type}:${e.ch}:${e.a}`);

// =====================================================================================================================
// midi.js
// =====================================================================================================================
test('parseMidi: format-1 file with two tracks - header fields, event order, seconds and duration', () => {
  const m = parseMidi(demoSong());
  assert.equal(m.format, 1);
  assert.equal(m.ticksPerBeat, 480);
  assert.equal(m.trackCount, 2);
  assert.equal(m.tempoMap.length, 1);
  assert.equal(m.tempoMap[0].bpm, 120);
  assert.ok(near(m.duration, 2.0), 'end-of-track marker counts: ' + m.duration);
  assert.deepEqual(types(m.events), [
    'programChange:0:0', 'noteOn:0:60', 'noteOn:0:64', 'programChange:1:33', 'noteOn:1:36', // tick 0 (track order kept)
    'noteOff:0:60', 'noteOff:0:64', // 0.5 s
    'noteOn:0:67', 'noteOff:1:36', 'noteOn:9:36', 'noteOn:9:42', // 1.0 s
    'noteOff:0:67', 'noteOff:9:42', // 1.5 s (velocity-0 noteOn is reported as noteOff)
  ]);
  const at = (type, ch, a) => m.events.find((e) => e.type === type && e.ch === ch && e.a === a);
  assert.ok(near(at('noteOn', 0, 60).t, 0));
  assert.ok(near(at('noteOff', 0, 60).t, 0.5));
  assert.ok(near(at('noteOn', 0, 67).t, 1.0));
  assert.ok(near(at('noteOff', 0, 67).t, 1.5));
  assert.equal(at('noteOn', 0, 60).b, 100);
  assert.equal(at('noteOff', 9, 42).b, 0);
  assert.ok(m.events.every((e, i) => i === 0 || e.t >= m.events[i - 1].t), 'sorted by time');
});

test('parseMidi: tempo changes are honoured (tempo map, also from another track)', () => {
  const t0 = track([
    [0, ...tempo(500000)], // 120 bpm
    [960, ...tempo(250000)], // after 2 beats (1.0 s): 240 bpm
    [480, 0x90, 60, 90], // tick 1440: 1.0 + 0.25 = 1.25 s
    [480, 0x80, 60, 0], // tick 1920: 1.5 s
    [0, ...eot()],
  ]);
  const t1 = track([[1920, ...tempo(1000000)], [480, 0x90, 62, 90], [0, ...eot()]]); // tick 1920: 60 bpm, tick 2400 -> 1.5 + 1.0
  const m = parseMidi(smf({ format: 1, division: 480, tracks: [t0, t1] }));
  assert.deepEqual(m.tempoMap.map((s) => [s.tick, s.usPerBeat]), [[0, 500000], [960, 250000], [1920, 1000000]]);
  assert.ok(near(m.tempoMap[1].t, 1.0));
  assert.ok(near(m.tempoMap[2].t, 1.5));
  const on = (a) => m.events.find((e) => e.type === 'noteOn' && e.a === a).t;
  assert.ok(near(on(60), 1.25), String(on(60)));
  assert.ok(near(m.events.find((e) => e.type === 'noteOff').t, 1.5));
  assert.ok(near(on(62), 2.5), String(on(62)));
  assert.ok(near(m.duration, 2.5));
  assert.ok(near(m.tempoMap[2].bpm, 60));
});

test('parseMidi: a later tempo event at the same tick wins; a tempo at tick 0 overrides the 120 bpm default', () => {
  const m = parseMidi(smf({ format: 0, division: 96, tracks: [track([[0, ...tempo(600000)], [0, ...tempo(400000)], [96, 0x90, 60, 80], [0, ...eot()]])] }));
  assert.equal(m.tempoMap.length, 1);
  assert.equal(m.tempoMap[0].usPerBeat, 400000);
  assert.ok(near(m.events[0].t, 0.4));
});

test('parseMidi: running status, velocity-0 note-offs, long delta times, all channel message types', () => {
  const t = track([
    [0, 0x90, 60, 100], // explicit status
    [10, 62, 90], // running status: noteOn 62
    [10, 60, 0], // running status velocity 0 -> noteOff
    [0x81 * 0 + 16384, 0xb0, 7, 64], // 3-byte delta (16384 ticks)
    [0, 10, 70], // running status controller 10 = 70
    [0, 0xc2, 5], // program change (1 data byte)
    [0, 0xd3, 40], // channel pressure (1 data byte)
    [0, 0xa0, 61, 33], // poly pressure
    [0, 0xe0, 0x00, 0x40], // pitch bend centre
    [0, 0xe0, 0x7f, 0x7f], // max
    [0, 0xe0, 0x00, 0x00], // min
    [0, ...eot()],
  ]);
  const m = parseMidi(smf({ format: 0, division: 480, tracks: [t] }));
  assert.deepEqual(m.events.map((e) => [e.type, e.ch, e.a, e.b]), [
    ['noteOn', 0, 60, 100], ['noteOn', 0, 62, 90], ['noteOff', 0, 60, 0],
    ['controlChange', 0, 7, 64], ['controlChange', 0, 10, 70],
    ['programChange', 2, 5, 0], ['channelPressure', 3, 40, 0], ['polyPressure', 0, 61, 33],
    ['pitchBend', 0, 0, 0], ['pitchBend', 0, 8191, 0], ['pitchBend', 0, -8192, 0],
  ]);
  assert.ok(near(m.events[3].t, (20 + 16384) / 960), 'long delta: ' + m.events[3].t);
});

test('parseMidi: meta and sysex events are skipped and cancel running status; unknown chunks are skipped', () => {
  const body = [
    [0, ...meta(0x03, [...Buffer.from('Track name')])],
    [0, ...meta(0x58, [4, 2, 24, 8])],
    [0, ...meta(0x59, [0, 0])],
    [0, 0xf0, 0x05, 0x43, 0x12, 0x00, 0x00, 0xf7], // sysex (length 5)
    [0, 0xf7, 0x02, 0x01, 0x02], // escaped sysex
    [0, 0x90, 60, 100],
    [480, 0x80, 60, 0],
    [0, ...eot()],
  ];
  const junk = [0x58, 0x58, 0x58, 0x58, ...be32(3), 1, 2, 3]; // unknown chunk 'XXXX'
  const hdr = [0x4d, 0x54, 0x68, 0x64, ...be32(6), ...be16(0), ...be16(1), ...be16(480)];
  const m = parseMidi(Uint8Array.from([...hdr, ...junk, ...track(body)]));
  assert.deepEqual(types(m.events), ['noteOn:0:60', 'noteOff:0:60']);
  assert.ok(near(m.events[0].t, 0) && near(m.events[1].t, 0.5), 'sysex skipped by its declared length: ' + m.events[1].t);
  // a data byte right after a sysex has no running status: the track stops there, earlier events survive
  const broken = track([[0, 0x90, 60, 100], [0, 0xf0, 0x01, 0xf7], [0, 64, 100], [0, 0x90, 65, 100], [0, ...eot()]]);
  const m2 = parseMidi(Uint8Array.from([...hdr, ...broken]));
  assert.deepEqual(types(m2.events), ['noteOn:0:60']);
});

test('parseMidi: SMPTE division, RMID wrapper, truncation and garbage never throw', () => {
  const division = ((256 - 25) << 8) | 40; // 25 fps, 40 ticks per frame = 1000 ticks / s
  const m = parseMidi(smf({ format: 0, division, tracks: [track([[0, ...tempo(100000)], [500, 0x90, 60, 80], [0, ...eot()]])] }));
  assert.ok(near(m.events[0].t, 0.5), 'tempo is ignored for SMPTE time: ' + m.events[0].t);
  const plain = demoSong();
  const rmid = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x52, 0x4d, 0x49, 0x44, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0, ...plain]);
  assert.equal(parseMidi(rmid).events.length, parseMidi(plain).events.length, 'RIFF RMID wrapper');
  for (let cut = 0; cut < plain.length; cut += 3) {
    const r = parseMidi(plain.subarray(0, cut));
    assert.ok(Array.isArray(r.events) && Number.isFinite(r.duration), 'truncated at ' + cut);
  }
  const empty = { format: 0, ticksPerBeat: 480, trackCount: 0, events: [], duration: 0 };
  for (const junk of [new ArrayBuffer(0), randomBytes(500, 4), new Uint8Array([0x4d, 0x54, 0x68, 0x64]), toAB(randomBytes(64, 5)),
    Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...be32(2), 0, 0]), smf({ format: 0, division: 0, tracks: [track([[0, ...eot()]])] }), null, undefined, 42, 'x']) {
    const r = parseMidi(junk);
    assert.equal(r.events.length, 0);
    assert.equal(r.duration, 0);
    assert.equal(r.format, empty.format);
  }
  assert.equal(parseMidi(toAB(plain)).events.length, parseMidi(plain).events.length, 'ArrayBuffer input');
});

// =====================================================================================================================
// music.js: buildNotes
// =====================================================================================================================
const ev = (t, ch, type, a, b = 0) => ({ t, ch, type, a, b });

test('buildNotes: pairs note-on/off first-in-first-out, captures channel state at note start', () => {
  const { notes, duration } = buildNotes({
    duration: 4,
    events: [
      ev(0, 0, 'programChange', 40), ev(0, 0, 'controlChange', 7, 80), ev(0, 0, 'controlChange', 11, 100), ev(0, 0, 'pitchBend', 2048),
      ev(0, 0, 'noteOn', 60, 100), // A
      ev(0.5, 0, 'noteOn', 60, 90), // B overlaps the same key
      ev(1.0, 0, 'noteOff', 60), // closes A (the oldest)
      ev(1.5, 0, 'controlChange', 7, 20), // later change must not touch sounding notes
      ev(2.0, 0, 'noteOff', 60), // closes B
      ev(2.5, 0, 'noteOn', 62, 70), // C: new state
      ev(3.0, 0, 'noteOff', 62),
    ],
  });
  assert.equal(notes.length, 3);
  assert.ok(near(notes[0].dur, 1.0) && near(notes[1].dur, 1.5) && near(notes[2].dur, 0.5));
  assert.equal(notes[0].program, 40);
  assert.equal(notes[0].vol, 80);
  assert.equal(notes[0].expr, 100);
  assert.equal(notes[0].bend, 2048);
  assert.equal(notes[0].perc, false);
  assert.equal(notes[2].vol, 20);
  assert.equal(duration, 4);
});

test('buildNotes: same-tick on/off, sustain pedal, all-notes-off, RPN bend range, percussion channel, never-closed notes', () => {
  const { notes, duration } = buildNotes({
    duration: 10,
    events: [
      ev(0, 0, 'noteOn', 60, 90), ev(0, 0, 'noteOff', 60), // zero-length note
      ev(1, 0, 'controlChange', 64, 127), // pedal down
      ev(1, 0, 'noteOn', 64, 90), ev(1.5, 0, 'noteOff', 64), // released while the pedal is down...
      ev(3, 0, 'controlChange', 64, 0), // ...so it rings until here
      ev(4, 1, 'noteOn', 50, 90), ev(4, 1, 'noteOn', 52, 90), ev(4.5, 1, 'controlChange', 123, 0), // all notes off on ch1
      ev(5, 0, 'controlChange', 101, 0), ev(5, 0, 'controlChange', 100, 0), ev(5, 0, 'controlChange', 6, 12), // bend range 12
      ev(5.5, 0, 'noteOn', 70, 90), ev(6, 0, 'noteOff', 70),
      ev(6, 9, 'noteOn', 36, 100), ev(6.2, 9, 'noteOff', 36), // drums
      ev(7, 2, 'noteOn', 72, 90), // never closed
    ],
  });
  const byNote = (n, ch = 0) => notes.find((x) => x.note === n && x.ch === ch);
  assert.ok(byNote(60).dur >= 0.02 && byNote(60).dur <= 0.03, 'zero-length note gets a minimal duration');
  assert.ok(near(byNote(64).dur, 2.0), 'sustain pedal: ' + byNote(64).dur);
  assert.ok(near(byNote(50, 1).dur, 0.5) && near(byNote(52, 1).dur, 0.5), 'all-notes-off');
  assert.equal(byNote(70).bendRange, 12);
  assert.equal(byNote(60).bendRange, 2);
  assert.equal(byNote(36, 9).perc, true);
  assert.ok(near(byNote(72, 2).dur, 3.0), 'rings to the end of the song: ' + byNote(72, 2).dur);
  assert.equal(duration, 10);
  assert.deepEqual(buildNotes(null), { notes: [], duration: 0 });
  assert.deepEqual(buildNotes({ events: [] }), { notes: [], duration: 0 });
});

test('instrumentFor: General-MIDI families map to sine / triangle / square voices only', () => {
  const kinds = new Set();
  for (let p = 0; p < 128; p++) kinds.add(instrumentFor(p).type);
  assert.deepEqual([...kinds].sort(), ['sine', 'square', 'triangle']);
  assert.equal(instrumentFor(0).type, 'triangle');
  assert.equal(instrumentFor(19).type, 'square');
  assert.equal(instrumentFor(11).type, 'sine');
});

// =====================================================================================================================
// music.js: createMusic
// =====================================================================================================================
function musicRig({ bytes = demoSong, ctx = new FakeAudioContext(), withCtx = true } = {}) {
  ctx.state = 'running';
  const timers = { fn: null, ms: null, set: 0, cleared: 0 };
  const calls = { bytes: 0 };
  let ctxRef = withCtx ? ctx : null;
  const music = createMusic({
    getCtx: () => ctxRef,
    getBytes: async () => { calls.bytes++; return typeof bytes === 'function' ? bytes() : bytes; },
    setTimer: (fn, ms) => { timers.fn = fn; timers.ms = ms; timers.set++; return 7; },
    clearTimer: () => { timers.fn = null; timers.cleared++; },
  });
  return { music, ctx, timers, calls, setCtx: (c) => { ctxRef = c; } };
}

const freqs = (ctx) => ctx.oscillators.map((o) => o.frequency.value);
const hz = (note) => 440 * 2 ** ((note - 69) / 12);

test('createMusic: default OFF - nothing is loaded or played until setEnabled(true)', async () => {
  const r = rig();
  assert.equal(r.music.available(), false);
  assert.equal(r.music.getState(), 'stopped');
  r.music.pause(); r.music.resume(); r.music.stop(); r.music.tick(); r.music.notifyContext();
  assert.equal(r.calls.bytes, 0, 'bytes are only requested when music is switched on');
  assert.equal(r.ctx.oscillators.length, 0);
  assert.equal(r.timers.set, 0);
  function rig() { return musicRig(); }
});

test('createMusic: setEnabled(true) loads lazily, starts playing and schedules the first notes within the look-ahead', async () => {
  const { music, ctx, timers, calls } = musicRig();
  await music.setEnabled(true);
  assert.equal(calls.bytes, 1);
  assert.equal(music.available(), true);
  assert.equal(music.getState(), 'playing');
  assert.equal(music.isEnabled(), true);
  assert.ok(near(music.getDuration(), 2.0));
  assert.equal(timers.ms, TICK_MS);
  assert.equal(LOOKAHEAD_S, 0.4);
  // t=0 notes: piano C4 + E4, bass C2 (the second chord note is at 1.0 s, outside the window)
  assert.equal(ctx.oscillators.length, 3);
  const [c4, e4, bass] = ctx.oscillators;
  assert.ok(near(c4.frequency.value, hz(60), 1e-6) && near(e4.frequency.value, hz(64), 1e-6) && near(bass.frequency.value, hz(36), 1e-6));
  assert.ok([c4, e4, bass].every((o) => near(o.startedAt, 0.08, 1e-9)));
  assert.equal(c4.type, 'triangle');
  assert.ok(c4.stoppedAt > c4.startedAt + 0.5, 'stop time follows the note length plus release');
  // all voices end in a gain node connected to the music bus -> destination
  const bus = c4.to.to;
  assert.equal(bus.to, ctx.destination);
  // a second setEnabled(true) reuses the parsed song
  await music.setEnabled(true);
  assert.equal(calls.bytes, 1);
});

test('createMusic: tick() schedules what falls into the window - pitched notes, kick (sine thump) and hat (filtered noise)', async () => {
  const { music, ctx } = musicRig();
  await music.setEnabled(true);
  const base = ctx.oscillators.length;
  ctx.currentTime = 0.8; // window up to 1.2 s: E-flat... the G4 at 1.0 s (+0.08), the kick and the hat on channel 10
  music.tick();
  const added = ctx.oscillators.slice(base);
  assert.equal(added.length, 2, 'G4 + kick');
  const g4 = added.find((o) => near(o.frequency.value, hz(67), 1e-6));
  assert.ok(g4 && near(g4.startedAt, 1.08, 1e-9));
  const kick = added.find((o) => o !== g4);
  assert.equal(kick.type, 'sine');
  assert.ok(kick.frequency.calls.some((c) => c[0] === 'exp'), 'pitch drop');
  assert.equal(ctx.sources.length, 1, 'hat = one noise burst');
  assert.equal(ctx.filters.length, 1);
  assert.equal(ctx.filters[0].type, 'highpass');
  assert.ok(near(ctx.sources[0].startedAt, 1.08, 1e-9));
  const again = ctx.oscillators.length;
  music.tick(); // nothing new in the same window
  assert.equal(ctx.oscillators.length, again);
});

test('createMusic: the song loops forever (the second pass is scheduled when the window reaches the end)', async () => {
  const { music, ctx } = musicRig();
  await music.setEnabled(true);
  ctx.currentTime = 1.9; music.tick();
  const chordC4 = ctx.oscillators.filter((o) => near(o.frequency.value, hz(60), 1e-6));
  assert.equal(chordC4.length, 2, 'second pass: C4 again');
  assert.ok(near(chordC4[1].startedAt, 0.08 + 2.0, 1e-9));
  ctx.currentTime = 3.9; music.tick();
  assert.equal(ctx.oscillators.filter((o) => near(o.frequency.value, hz(60), 1e-6)).length, 3, 'third pass');
  assert.equal(music.getState(), 'playing');
});

test('createMusic: waking up long after the end jumps to the current pass instead of replaying the backlog', async () => {
  const { music, ctx } = musicRig();
  await music.setEnabled(true);
  const before = ctx.oscillators.length;
  ctx.currentTime = 1000.3; // background tab
  music.tick();
  assert.ok(ctx.oscillators.length - before <= 6, 'at most the notes of one window: ' + (ctx.oscillators.length - before));
});

test('createMusic: pause silences every voice and remembers the position; resume continues and re-triggers ringing notes', async () => {
  const { music, ctx, timers } = musicRig();
  await music.setEnabled(true);
  ctx.currentTime = 0.3;
  music.tick();
  const live = ctx.oscillators.slice();
  music.pause();
  assert.equal(music.getState(), 'paused');
  assert.equal(timers.fn, null, 'timer cleared');
  assert.ok(live.filter((o) => o.stoppedAt === 0).length >= 3, 'voices stopped immediately');
  const n = ctx.oscillators.length;
  music.tick();
  assert.equal(ctx.oscillators.length, n, 'nothing is scheduled while paused');
  ctx.currentTime = 20;
  music.resume();
  assert.equal(music.getState(), 'playing');
  const resumed = ctx.oscillators.slice(n);
  // position was 0.3 - 0.08 = 0.22 s: the chord (until 0.5 s) and the bass (until 1.0 s) are still ringing -> re-triggered
  assert.equal(resumed.length, 3);
  assert.ok(resumed.every((o) => near(o.startedAt, 20.08, 1e-9)));
  // the next note (G4 at 1.0 s) is scheduled relative to the resumed position
  ctx.currentTime = 20.7;
  music.tick();
  const g4 = ctx.oscillators.slice(n + 3).find((o) => near(o.frequency.value, hz(67), 1e-6));
  assert.ok(g4 && near(g4.startedAt, 20.08 + (1.0 - 0.22), 1e-9), String(g4 && g4.startedAt));
});

test('createMusic: pausing in the last moments of a pass (scheduler already wrapped) resumes there, not at the beginning', async () => {
  const { music, ctx } = musicRig();
  await music.setEnabled(true); // loopStart = 0.08, D = 2.0
  ctx.currentTime = 1.9; // the window (to 2.3) already contains the next pass: loopStart becomes 2.08
  music.tick();
  music.pause(); // position within the song: 1.9 - 0.08 = 1.82 s
  const n = ctx.oscillators.length;
  ctx.currentTime = 50;
  music.resume();
  assert.equal(music.getState(), 'playing');
  // nothing is ringing at 1.82 s (the last note ended at 1.5 s) and the next pass is only 0.18 s away: the chord of pass 2 follows
  ctx.currentTime = 50.0;
  music.tick();
  const c4 = ctx.oscillators.slice(n).filter((o) => near(o.frequency.value, hz(60), 1e-6));
  assert.equal(c4.length, 1);
  assert.ok(near(c4[0].startedAt, 50.08 + (2.0 - 1.82), 1e-9), String(c4[0].startedAt));
});

test('createMusic: pause before the song has loaded defers the start until resume; stop rewinds; setEnabled(false) stops', async () => {
  const { music, ctx, timers } = musicRig();
  music.pause(); // window blurred before music was ever started
  await music.setEnabled(true);
  assert.equal(music.available(), true);
  assert.equal(music.getState(), 'stopped', 'held by pause()');
  assert.equal(ctx.oscillators.length, 0);
  music.resume();
  assert.equal(music.getState(), 'playing');
  assert.equal(ctx.oscillators.length, 3);
  ctx.currentTime = 1.5; music.tick();
  music.stop();
  assert.equal(music.getState(), 'stopped');
  assert.equal(timers.fn, null);
  const n = ctx.oscillators.length;
  ctx.currentTime = 5;
  music.resume(); // rewound: starts from the beginning
  assert.equal(music.getState(), 'playing');
  assert.equal(ctx.oscillators.slice(n).filter((o) => near(o.frequency.value, hz(60), 1e-6)).length, 1);
  assert.ok(near(ctx.oscillators[n].startedAt, 5.08, 1e-9));
  await music.setEnabled(false);
  assert.equal(music.getState(), 'stopped');
  assert.equal(music.isEnabled(), false);
  music.resume(); // not enabled: stays silent
  assert.equal(music.getState(), 'stopped');
  const m2 = ctx.oscillators.length;
  music.restart();
  assert.equal(ctx.oscillators.length, m2);
  await music.setEnabled(true);
  music.restart();
  assert.equal(music.getState(), 'playing');
});

test('createMusic: without a context it loads but waits; notifyContext() (unlock) starts it', async () => {
  const r = musicRig({ withCtx: false });
  await r.music.setEnabled(true);
  assert.equal(r.music.available(), true);
  assert.equal(r.music.getState(), 'stopped');
  r.setCtx(r.ctx);
  r.music.notifyContext();
  assert.equal(r.music.getState(), 'playing');
  assert.equal(r.ctx.oscillators.length, 3);
});

test('createMusic: any failure leaves it silent and unavailable - null, rejected, garbage, note-less and throwing sources', async () => {
  const cases = [
    () => null,
    () => { throw new Error('network'); },
    () => randomBytes(300, 8),
    () => smf({ format: 0, division: 480, tracks: [track([[0, ...tempo(500000)], [480, ...eot()]])] }),
    () => new ArrayBuffer(0),
  ];
  for (const bytes of cases) {
    const r = musicRig({ bytes });
    await r.music.setEnabled(true);
    assert.equal(r.music.available(), false);
    assert.equal(r.music.getState(), 'stopped');
    assert.equal(r.ctx.oscillators.length, 0);
    r.music.pause(); r.music.resume(); r.music.tick();
  }
  // a later retry can succeed (e.g. the user supplied the MID in the meantime)
  let good = false;
  const r = musicRig({ bytes: () => (good ? demoSong() : null) });
  await r.music.setEnabled(true);
  assert.equal(r.music.available(), false);
  good = true;
  await r.music.retry();
  assert.equal(r.music.available(), true);
  assert.equal(r.music.getState(), 'playing');
});

test('createMusic: a context method that throws never escapes (one bad voice does not stop the music)', async () => {
  const ctx = new FakeAudioContext();
  ctx.createOscillator = () => { throw new Error('too many oscillators'); };
  const r = musicRig({ ctx });
  await r.music.setEnabled(true);
  assert.equal(r.music.getState(), 'playing');
  ctx.currentTime = 0.9;
  r.music.tick();
  assert.equal(r.music.getState(), 'playing');
});

test('createMusic: a realistic ~9 minute, 4-channel, 20 000-event file parses, pairs and plays without piling up voices', async () => {
  const r = rng(77);
  const mk = (ch, program, notes) => {
    const ev = [[0, 0xc0 | ch, program]];
    for (let i = 0; i < notes; i++) {
      const n = 36 + Math.floor(r() * 48);
      ev.push([Math.floor(r() * 240), 0x90 | ch, n, 40 + Math.floor(r() * 80)], [60 + Math.floor(r() * 400), 0x80 | ch, n, 0]);
    }
    ev.push([0, ...eot()]);
    return track(ev);
  };
  const big = smf({ format: 1, division: 480, tracks: [track([[0, ...tempo(500000)], [0, ...eot()]]), mk(0, 0, 3000), mk(1, 33, 3000), mk(2, 48, 2000), mk(3, 80, 2000)] });
  const parsed = parseMidi(big);
  assert.equal(parsed.events.filter((e) => e.type === 'noteOn').length, 10000);
  assert.ok(parsed.duration > 100, 'long song: ' + parsed.duration);
  const { notes } = buildNotes(parsed);
  assert.equal(notes.length, 10000);
  assert.ok(notes.every((n) => n.dur >= 0.02 && Number.isFinite(n.dur)));
  const { music, ctx } = musicRig({ bytes: () => big });
  await music.setEnabled(true);
  for (let t = 0.1; t < 60; t += 0.1) { ctx.currentTime = t; music.tick(); }
  assert.equal(music.getState(), 'playing');
  const scheduled = ctx.oscillators.length;
  const expected = notes.filter((n) => n.t < 60.4).length;
  assert.ok(scheduled > 0 && scheduled <= expected, `${scheduled} <= ${expected}`);
});

// =====================================================================================================================
// zip.js
// =====================================================================================================================
const compressible = (n, seed = 1) => {
  const r = rng(seed);
  const words = ['pinball', 'space', 'cadet', 'flipper', 'bumper', 'kickout', 'rollover', 'ramp', 'target'];
  let s = '';
  while (s.length < n) s += words[Math.floor(r() * words.length)] + ' ';
  return new TextEncoder().encode(s.slice(0, n));
};

function sampleZip(extra = [], opts) {
  const files = {
    s1: randomBytes(3000, 21),
    s3: compressible(20000, 22),
    dat: compressible(5000, 23),
    s4: randomBytes(800, 24),
    txt: new TextEncoder().encode('hi'),
  };
  const zip = makeZip([
    { name: 'Pinball/', data: new Uint8Array(0), method: 0 },
    { name: 'Pinball/SOUND1.WAV', data: files.s1, method: 8 },
    { name: 'Pinball/SOUND/sound3.wav', data: files.s3, method: 8, level: 9 },
    { name: 'Pinball/PINBALL.DAT', data: files.dat, method: 0 },
    { name: 'Pinball\\SOUND4.WAV', data: files.s4, method: 8 },
    { name: 'README.txt', data: files.txt, method: 8 },
    ...extra,
  ], opts);
  return { zip, files };
}

test('readZip: stored + deflate entries, base names lower-cased, directories skipped, content identical', async () => {
  const { zip, files } = sampleZip();
  for (const native of [true, false]) {
    const m = await readZip(toAB(zip), { native });
    assert.deepEqual([...m.keys()].sort(), ['pinball.dat', 'readme.txt', 'sound1.wav', 'sound3.wav', 'sound4.wav']);
    assert.deepEqual(new Uint8Array(m.get('sound1.wav')), files.s1);
    assert.deepEqual(new Uint8Array(m.get('sound3.wav')), files.s3);
    assert.deepEqual(new Uint8Array(m.get('pinball.dat')), files.dat);
    assert.deepEqual(new Uint8Array(m.get('sound4.wav')), files.s4, 'backslash paths');
    assert.equal(new TextDecoder().decode(m.get('readme.txt')), 'hi');
    for (const buf of m.values()) assert.ok(buf instanceof ArrayBuffer && buf.byteLength === buf.slice(0).byteLength);
  }
  assert.deepEqual(new Uint8Array((await readZip(zip)).get('sound1.wav')), files.s1, 'a Uint8Array input works too');
});

test('readZip: the filter runs before inflating; only wanted entries are read', async () => {
  const { zip, files } = sampleZip();
  const seen = [];
  const m = await readZip(zip, { filter: (base, full) => { seen.push([base, full]); return /^sound\d+\.wav$/.test(base); } });
  assert.deepEqual([...m.keys()].sort(), ['sound1.wav', 'sound3.wav', 'sound4.wav']);
  assert.ok(seen.some(([b, f]) => b === 'sound3.wav' && f === 'Pinball/SOUND/sound3.wav'));
  assert.deepEqual(new Uint8Array(m.get('sound3.wav')), files.s3);
  assert.ok(!seen.some(([b]) => b === ''), 'directory entries never reach the filter');
});

test('readZip: archive comment, duplicates (first wins), empty files, size guard', async () => {
  const a = randomBytes(40, 31);
  const b = randomBytes(40, 32);
  const { zip } = sampleZip([
    { name: 'again/SOUND9.WAV', data: a, method: 0 },
    { name: 'other/sound9.wav', data: b, method: 0 },
    { name: 'empty.wav', data: new Uint8Array(0), method: 8 },
    { name: 'big.bin', data: new Uint8Array(5000), method: 8 },
  ], { comment: 'x'.repeat(3000) });
  const m = await readZip(zip);
  assert.deepEqual(new Uint8Array(m.get('sound9.wav')), a, 'first copy wins');
  assert.equal(m.get('empty.wav').byteLength, 0);
  assert.ok(m.has('big.bin'));
  const small = await readZip(zip, { maxEntryBytes: 4000 });
  assert.ok(!small.has('big.bin') && !small.has('sound3.wav'), 'entries above the guard are skipped');
  assert.ok(small.has('sound1.wav'));
});

test('readZip: corrupt archives resolve to an empty (or partial) map and never throw', async () => {
  const { zip } = sampleZip();
  for (const junk of [new ArrayBuffer(0), new ArrayBuffer(10), randomBytes(5000, 41), null, undefined, 'x', 12]) {
    assert.equal((await readZip(junk)).size, 0);
  }
  assert.equal((await readZip(zip.subarray(0, zip.length - 30))).size, 0, 'no end-of-central-directory');
  assert.equal((await readZip(zip.subarray(0, 100))).size, 0);
  // central directory offset pointing outside
  const bad = zip.slice();
  new DataView(bad.buffer).setUint32(bad.length - 22 + 16, 0x7fffffff, true);
  assert.equal((await readZip(bad)).size, 0);
  // bad local header signature on one entry: that entry is skipped, the rest survive
  const damaged = zip.slice();
  damaged[0] = 0; // local header of the directory entry (first entry)
  assert.ok((await readZip(damaged)).has('sound1.wav'));
});

test('readZip: encrypted entries, unsupported methods and damaged deflate data are skipped individually', async () => {
  const good = randomBytes(100, 51);
  const { zip } = sampleZip([
    { name: 'enc.wav', data: good, method: 8, flags: 1 },
    { name: 'bz.wav', data: good, method: 12, raw: good },
    { name: 'bad.wav', data: good, method: 8, raw: Uint8Array.from([0x07, 0xff, 0xff]) }, // invalid block type
    { name: 'short.wav', data: good, method: 8, raw: new Uint8Array(zlib.deflateRawSync(good.subarray(0, 50))) }, // wrong size
    { name: 'SOUND77.WAV', data: good, method: 0 },
  ]);
  for (const native of [true, false]) {
    const m = await readZip(zip, { native });
    for (const k of ['enc.wav', 'bz.wav', 'bad.wav', 'short.wav']) assert.ok(!m.has(k), k);
    assert.ok(m.has('sound77.wav') && m.has('sound1.wav'));
  }
});

test('inflateRawJs matches node:zlib for many sizes, data shapes, levels and strategies', () => {
  const shapes = {
    random: (n) => randomBytes(n, n + 3),
    text: (n) => compressible(n, n + 5),
    zeros: (n) => new Uint8Array(n),
    ramp: (n) => Uint8Array.from({ length: n }, (_, i) => i & 255),
    repeat: (n) => Uint8Array.from({ length: n }, (_, i) => (i % 7) * 31),
  };
  for (const n of [0, 1, 2, 3, 100, 1000, 40000, 65535, 65536, 70001]) {
    for (const [name, make] of Object.entries(shapes)) {
      const data = make(n);
      for (const opts of [{ level: 0 }, { level: 1 }, { level: 6 }, { level: 9 }, { strategy: zlib.constants.Z_FIXED }, { strategy: zlib.constants.Z_HUFFMAN_ONLY },
        { strategy: zlib.constants.Z_RLE }]) {
        const comp = new Uint8Array(zlib.deflateRawSync(data, opts));
        const out = inflateRawJs(comp, n + 10);
        assert.equal(out.length, n, `${name} ${n} ${JSON.stringify(opts)}`);
        assert.ok(Buffer.from(out).equals(Buffer.from(data)), `${name} ${n} ${JSON.stringify(opts)}`);
      }
    }
  }
});

test('inflateRawJs: corrupt, truncated and oversized streams throw instead of looping or exploding', () => {
  const data = compressible(5000, 61);
  const comp = new Uint8Array(zlib.deflateRawSync(data, { level: 9 }));
  assert.throws(() => inflateRawJs(comp.subarray(0, comp.length - 4), 100000), /inflate/);
  assert.throws(() => inflateRawJs(comp, 100), /too large/);
  assert.throws(() => inflateRawJs(Uint8Array.from([0x07, 0xff, 0xff]), 100), /invalid block type/);
  assert.throws(() => inflateRawJs(Uint8Array.from([0x01, 0x05, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5]), 100), /length mismatch/);
  assert.throws(() => inflateRawJs(new Uint8Array(0), 100));
  const zeros = new Uint8Array(zlib.deflateRawSync(new Uint8Array(1_000_000), { level: 9 }));
  assert.throws(() => inflateRawJs(zeros, 1000), /too large/, 'a 1 MB zip bomb is stopped at the declared size');
  for (let i = 0; i < 30; i++) { // random garbage never hangs or crashes the process
    const junk = randomBytes(200, 70 + i);
    try { inflateRawJs(junk, 1 << 16); } catch { /* expected for most inputs */ }
  }
});

// =====================================================================================================================
// userfiles.js
// =====================================================================================================================
test('soundKeyForName: base-name filter ignores sub-folders, backslashes and letter case', () => {
  const ok = {
    'SOUND1.WAV': 'SOUND1', 'sound49d.wav': 'SOUND49D', 'Pinball/SOUND/Sound131.Wav': 'SOUND131', 'C:\\Pinball\\SOUND\\SOUND5.WAV': 'SOUND5',
    'PINBALL.MID': 'PINBALL', 'x/pinball.mid': 'PINBALL', 'SOUND999.WAV': 'SOUND999',
  };
  for (const [name, key] of Object.entries(ok)) assert.equal(soundKeyForName(name), key, name);
  for (const bad of ['PINBALL2.MID', 'PINBALL.DAT', 'SOUND.WAV', 'SOUND1.WAV.bak', 'xSOUND1.WAV', 'sound1.wav.zip', 'SOUND1DD.WAV', 'readme.txt', '', null, undefined, 'SOUND/', 'sound1.mid']) {
    assert.equal(soundKeyForName(bad), null, String(bad));
  }
  assert.ok(SOUND_NAME_RE.test('a/b/SOUND12.WAV') && !SOUND_NAME_RE.test('a/b/MYSOUND12.WAV'));
});

function file(name, bytes, rel) {
  const f = new File([bytes], name);
  if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
}

test('pickSoundFiles: a picked folder (webkitRelativePath), loose files and unrelated files', async () => {
  const s1 = randomBytes(30, 1);
  const s3 = randomBytes(31, 2);
  const mid = randomBytes(32, 3);
  const files = [
    file('SOUND1.WAV', s1, 'Pinball/SOUND1.WAV'),
    file('sound3.wav', s3, 'Pinball/SOUND/sound3.wav'),
    file('PINBALL.MID', mid, 'Pinball/PINBALL.MID'),
    file('PINBALL.DAT', randomBytes(20, 4), 'Pinball/PINBALL.DAT'),
    file('PINBALL2.MID', randomBytes(20, 5), 'Pinball/PINBALL2.MID'),
    file('table.bmp', randomBytes(20, 6), 'Pinball/table.bmp'),
    file('SOUND1.WAV', randomBytes(30, 7), 'Backup/SOUND1.WAV'), // duplicate: first wins
  ];
  const m = await pickSoundFiles(files);
  assert.deepEqual([...m.keys()].sort(), ['PINBALL', 'SOUND1', 'SOUND3']);
  assert.deepEqual(new Uint8Array(m.get('SOUND1')), s1);
  assert.deepEqual(new Uint8Array(m.get('SOUND3')), s3);
  assert.deepEqual(new Uint8Array(m.get('PINBALL')), mid);
  const loose = await pickSoundFiles([file('Sound5.wav', s1), file('notes.txt', s3)]);
  assert.deepEqual([...loose.keys()], ['SOUND5']);
  // array-likes and a single file
  assert.deepEqual([...(await pickSoundFiles(file('SOUND7.WAV', s1))).keys()], ['SOUND7']);
  const arrayLike = { length: 1, 0: file('SOUND8.WAV', s1) };
  assert.deepEqual([...(await pickSoundFiles(arrayLike)).keys()], ['SOUND8']);
  // duck-typed file objects and backslash names
  const duck = { name: 'SOUND\\sound9.wav', size: 3, arrayBuffer: async () => toAB(s1) };
  assert.deepEqual([...(await pickSoundFiles([duck])).keys()], ['SOUND9']);
});

test('pickSoundFiles: zip archives are expanded (only the matching entries), alone or inside a picked folder', async () => {
  const s1 = randomBytes(300, 11);
  const s4 = compressible(4000, 12);
  const zip = makeZip([
    { name: '3D Pinball Space Cadet/SOUND1.WAV', data: s1, method: 8 },
    { name: '3D Pinball Space Cadet/SOUND4.WAV', data: s4, method: 8 },
    { name: '3D Pinball Space Cadet/PINBALL.DAT', data: new Uint8Array(900000), method: 8 },
    { name: '3D Pinball Space Cadet/PINBALL2.MID', data: randomBytes(10, 13), method: 0 },
    { name: '3D Pinball Space Cadet/PINBALL.MID', data: randomBytes(50, 14), method: 0 },
  ]);
  const m = await pickSoundFiles([file('3D Pinball Space Cadet.zip', zip)]);
  assert.deepEqual([...m.keys()].sort(), ['PINBALL', 'SOUND1', 'SOUND4']);
  assert.deepEqual(new Uint8Array(m.get('SOUND4')), s4);
  const inFolder = await pickSoundFiles([file('Backup.ZIP', zip, 'Games/Backup.ZIP'), file('SOUND1.WAV', randomBytes(300, 15), 'Games/SOUND1.WAV')]);
  assert.deepEqual(new Uint8Array(inFolder.get('SOUND1')), s1, 'first in the list wins');
  assert.deepEqual([...(await pickSoundFiles([file('broken.zip', randomBytes(900, 16))])).keys()], [], 'a corrupt zip is ignored');
  const typed = new File([zip], 'download', { type: 'application/zip' });
  assert.deepEqual([...(await pickSoundFiles([typed])).keys()].sort(), ['PINBALL', 'SOUND1', 'SOUND4'], 'zip recognised by MIME type too');
});

test('pickSoundFiles: FileSystemDirectoryHandle (showDirectoryPicker) is walked recursively, values() and entries() flavours', async () => {
  const s1 = randomBytes(30, 21);
  const s2 = randomBytes(30, 22);
  const fh = (name, bytes) => ({ kind: 'file', name, getFile: async () => file(name, bytes) });
  const sub = { kind: 'directory', name: 'SOUND', async *values() { yield fh('SOUND3.WAV', s2); yield fh('junk.bin', s1); } };
  const root = { kind: 'directory', name: 'Pinball', async *values() { yield fh('SOUND1.WAV', s1); yield sub; yield fh('PINBALL.DAT', s1); } };
  const m = await pickSoundFiles(root);
  assert.deepEqual([...m.keys()].sort(), ['SOUND1', 'SOUND3']);
  const viaEntries = { kind: 'directory', name: 'Pinball', async *entries() { yield ['SOUND1.WAV', fh('SOUND1.WAV', s1)]; yield ['SOUND', sub]; } };
  assert.deepEqual([...(await pickSoundFiles([viaEntries])).keys()].sort(), ['SOUND1', 'SOUND3']);
  assert.deepEqual([...(await pickSoundFiles(fh('SOUND12.WAV', s1))).keys()], ['SOUND12'], 'a single file handle');
  // permission errors / unreadable files are skipped
  const denied = { kind: 'file', name: 'SOUND2.WAV', getFile: async () => { throw new DOMException('denied', 'NotAllowedError'); } };
  const mixed = { kind: 'directory', name: 'x', async *values() { yield denied; yield fh('SOUND4.WAV', s1); } };
  assert.deepEqual([...(await pickSoundFiles(mixed)).keys()], ['SOUND4']);
  const unreadable = { name: 'SOUND6.WAV', size: 1, arrayBuffer: async () => { throw new Error('read error'); } };
  assert.deepEqual([...(await pickSoundFiles([unreadable, file('SOUND7.WAV', s1)])).keys()], ['SOUND7']);
});

test('pickSoundFiles: directory walk is bounded (depth and entry budget)', async () => {
  let yielded = 0;
  const endless = { kind: 'directory', name: 'huge', async *values() { for (;;) { yielded++; yield { kind: 'file', name: 'x' + yielded + '.txt', getFile: async () => file('x.txt', new Uint8Array(1)) }; } } };
  const m = await pickSoundFiles(endless);
  assert.equal(m.size, 0);
  assert.ok(yielded <= 20002, 'stopped after the budget: ' + yielded);
  const deep = (n) => ({ kind: 'directory', name: 'd' + n, async *values() { if (n < 30) yield deep(n + 1); else yield { kind: 'file', name: 'SOUND1.WAV', getFile: async () => file('SOUND1.WAV', new Uint8Array(1)) }; } });
  assert.equal((await pickSoundFiles(deep(0))).size, 0, 'depth cap');
});

/** A fake webkit FileSystemEntry tree for drag-and-drop. */
function fileEntry(name, bytes) {
  return { isFile: true, isDirectory: false, name, file: (ok) => ok(file(name, bytes)) };
}
function dirEntry(name, children, batch = 2) {
  return {
    isFile: false, isDirectory: true, name,
    createReader() {
      let i = 0;
      return { readEntries: (ok) => { const out = children.slice(i, i + batch); i += batch; ok(out); } }; // returns [] when exhausted
    },
  };
}

test('pickSoundFiles: dropped folders (webkitGetAsEntry) are read in batches; the DataTransfer is snapshotted synchronously', async () => {
  const bytes = (n) => randomBytes(20, n);
  const tree = dirEntry('Pinball', [
    fileEntry('SOUND1.WAV', bytes(1)), fileEntry('SOUND3.WAV', bytes(2)), fileEntry('SOUND4.WAV', bytes(3)), fileEntry('readme.txt', bytes(4)),
    dirEntry('SOUND', [fileEntry('SOUND5.WAV', bytes(5)), fileEntry('PINBALL.MID', bytes(6)), fileEntry('SOUND6.WAV', bytes(7))], 1),
  ], 2);
  let alive = true;
  const items = [{ kind: 'file', webkitGetAsEntry: () => { if (!alive) throw new Error('DataTransferItem expired'); return tree; } }, { kind: 'string' }];
  const dt = { get items() { if (!alive) throw new Error('DataTransfer expired'); return items; }, files: [], types: ['Files'] };
  const promise = pickSoundFiles(dt);
  alive = false; // the drop handler returned: the browser invalidates the items
  const m = await promise;
  assert.deepEqual([...m.keys()].sort(), ['PINBALL', 'SOUND1', 'SOUND3', 'SOUND4', 'SOUND5', 'SOUND6']);
  // snapshot arrays can be fed to pickSoundFiles later
  alive = true;
  const snap = snapshotDrop(dt);
  alive = false;
  assert.equal(snap.length, 1);
  assert.equal((await pickSoundFiles(snap)).size, 6);
});

test('snapshotDrop: falls back from entries to getAsFile to dt.files; ignores non-file items; never throws', async () => {
  const f1 = file('SOUND1.WAV', randomBytes(10, 1));
  const f2 = file('SOUND2.WAV', randomBytes(10, 2));
  const f3 = file('SOUND3.WAV', randomBytes(10, 3));
  assert.deepEqual(snapshotDrop({ items: [{ kind: 'file', getAsFile: () => f1 }, { kind: 'string', getAsFile: () => f2 }] }), [f1]);
  assert.deepEqual(snapshotDrop({ items: [], files: [f2, f3] }), [f2, f3]);
  assert.deepEqual(snapshotDrop({ files: [f3] }), [f3]);
  assert.deepEqual(snapshotDrop({ items: [{ kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => f1 }] }), [f1]);
  assert.deepEqual(snapshotDrop(null), []);
  assert.deepEqual(snapshotDrop({ get items() { throw new Error('x'); } }), []);
  const m = await pickSoundFiles({ items: [{ kind: 'file', getAsFile: () => f1 }], files: [] });
  assert.deepEqual([...m.keys()], ['SOUND1']);
});

test('attachDropTarget: accepts file drags only, hands over a stable snapshot, and detaches cleanly', () => {
  const handlers = new Map();
  const target = { addEventListener: (t, fn) => handlers.set(t, fn), removeEventListener: (t, fn) => { if (handlers.get(t) === fn) handlers.delete(t); } };
  const got = [];
  const detach = attachDropTarget(target, (snap, e) => got.push([snap, e]));
  const f = file('SOUND1.WAV', randomBytes(5, 1));
  let prevented = 0;
  const mk = (types, extra = {}) => ({ preventDefault: () => { prevented++; }, dataTransfer: { types, files: [f], items: [], ...extra } });
  const over = mk(['Files']);
  handlers.get('dragover')(over);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
  handlers.get('dragover')(mk(['text/plain']));
  handlers.get('drop')(mk(['text/plain']));
  assert.equal(prevented, 1, 'non-file drags are left alone');
  assert.equal(got.length, 0);
  handlers.get('drop')(mk(['Files']));
  assert.equal(prevented, 2);
  assert.deepEqual(got[0][0], [f]);
  const throwing = attachDropTarget(target, () => { throw new Error('handler bug'); });
  assert.doesNotThrow(() => handlers.get('drop')(mk(['Files'])));
  throwing();
  detach();
  assert.equal(handlers.size, 0);
  assert.equal(typeof attachDropTarget(null, () => {}), 'function');
  assert.equal(typeof attachDropTarget({}, () => {}), 'function');
});

test('supportsDirectoryPicker / pickDirectory: feature detection, user cancel and success', async () => {
  assert.equal(supportsDirectoryPicker({}), false);
  assert.equal(supportsDirectoryPicker(null), false);
  assert.equal(await pickDirectory({}), null);
  const handle = { kind: 'directory', name: 'Pinball' };
  const seen = [];
  const win = { showDirectoryPicker: async (o) => { seen.push(o); return handle; } };
  assert.equal(supportsDirectoryPicker(win), true);
  assert.equal(await pickDirectory(win), handle);
  assert.equal(seen[0].mode, 'read');
  assert.equal(await pickDirectory({ showDirectoryPicker: async () => { throw new DOMException('cancelled', 'AbortError'); } }), null);
});
