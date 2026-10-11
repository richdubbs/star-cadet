/**
 * src/audio/midi.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.4
 * parseMidi(buf) -> {format, ticksPerBeat, trackCount, events: [{t, ch, type, a, b}], tempoMap, duration}
 * Standard MIDI File reader (type 0 and 1; type 2 tracks are merged like type 1), pure, never throws (garbage in -> empty result).
 *   - tempo map honoured (set-tempo meta events from any track, last one at a tick wins; default 120 bpm);
 *   - running status, any delta-time length up to 4 bytes, sysex / meta / unknown chunks skipped (only set-tempo and end-of-track used);
 *   - 'RIFF .... RMID' wrapped files are accepted (the 'MThd' header is searched in the first 64 bytes);
 *   - SMPTE time division is supported (fixed seconds per tick, tempo ignored).
 * Event `type` strings: noteOn (a=note, b=velocity), noteOff (a=note, b=velocity; a noteOn with velocity 0 is reported as noteOff),
 * polyPressure (a=note, b=pressure), controlChange (a=controller, b=value), programChange (a=program, b=0), channelPressure (a=value, b=0),
 * pitchBend (a=-8192..8191, b=0). `t` is in seconds from the start; events are ordered by time, ties keep file/track order.
 *
 * ASSUMPTIONS:
 *  - `duration` is the largest of the last event time and the end-of-track marker time, so trailing silence in the loop is kept.
 *  - A truncated track keeps the events that were parsed before the damage.
 */

const EMPTY_TEMPO = Object.freeze([{ tick: 0, t: 0, usPerBeat: 500000, bpm: 120 }]);

function emptyResult() {
  return { format: 0, ticksPerBeat: 480, trackCount: 0, events: [], tempoMap: EMPTY_TEMPO.map((x) => ({ ...x })), duration: 0 };
}

/** @param {ArrayBuffer|ArrayBufferView} buf @returns {Uint8Array} */
function asU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}

/**
 * @param {ArrayBuffer|ArrayBufferView} buf
 * @returns {{format:number, ticksPerBeat:number, trackCount:number,
 *   events:{t:number, ch:number, type:string, a:number, b:number}[],
 *   tempoMap:{tick:number, t:number, usPerBeat:number, bpm:number}[], duration:number}}
 */
export function parseMidi(buf) {
  try {
    return parse(asU8(buf));
  } catch {
    return emptyResult();
  }
}

function parse(u8) {
  const len = u8.length;
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  let p = -1;
  for (let i = 0; i + 14 <= Math.min(len, 64); i++) if (tag(i) === 'MThd') { p = i; break; }
  if (p < 0) return emptyResult();
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hdrLen = dv.getUint32(p + 4, false);
  if (hdrLen < 6 || p + 8 + hdrLen > len) return emptyResult();
  const format = dv.getUint16(p + 8, false);
  const nTracks = dv.getUint16(p + 10, false);
  const division = dv.getUint16(p + 12, false);
  p += 8 + hdrLen;

  const smpte = (division & 0x8000) !== 0;
  let secPerTick = 0;
  let ticksPerBeat = division & 0x7fff;
  if (smpte) {
    let fps = 256 - (division >> 8);
    if (fps === 29) fps = 29.97;
    const tpf = division & 0xff;
    secPerTick = 1 / (fps * Math.max(1, tpf));
    ticksPerBeat = Math.max(1, Math.round((fps * tpf) / 2)); // defined as ticks per 0.5 s for SMPTE files
  } else if (ticksPerBeat === 0) {
    return emptyResult();
  }

  /** @type {{tick:number, ch:number, type:string, a:number, b:number}[]} */
  const raw = [];
  /** @type {{tick:number, usPerBeat:number}[]} */
  const tempos = [];
  let endTick = 0;
  let trackCount = 0;

  while (p + 8 <= len && trackCount < Math.max(nTracks, 1) + 1024) {
    const id = tag(p);
    const size = dv.getUint32(p + 4, false);
    const body = p + 8;
    const end = Math.min(body + size, len);
    p = body + size;
    if (id !== 'MTrk') continue;
    trackCount++;
    endTick = Math.max(endTick, parseTrack(u8, body, end, raw, tempos));
    if (p > len) break;
  }

  // stable sort by absolute tick (Array.prototype.sort is stable): ties keep track order, then in-track order
  raw.sort((x, y) => x.tick - y.tick);
  tempos.sort((x, y) => x.tick - y.tick);

  // tempo map: segments {tick, t, usPerBeat}
  const map = [{ tick: 0, t: 0, usPerBeat: 500000 }];
  for (const tp of tempos) {
    const last = map[map.length - 1];
    if (tp.tick === last.tick) { last.usPerBeat = tp.usPerBeat; continue; }
    map.push({ tick: tp.tick, t: 0, usPerBeat: tp.usPerBeat });
  }
  for (let i = 1; i < map.length; i++) {
    map[i].t = map[i - 1].t + (smpte ? 0 : ((map[i].tick - map[i - 1].tick) * map[i - 1].usPerBeat) / 1e6 / ticksPerBeat);
  }
  const tickToSec = (tick) => {
    if (smpte) return tick * secPerTick;
    let lo = 0;
    let hi = map.length - 1;
    while (lo < hi) { // last segment with seg.tick <= tick
      const mid = (lo + hi + 1) >> 1;
      if (map[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    const s = map[lo];
    return s.t + ((tick - s.tick) * s.usPerBeat) / 1e6 / ticksPerBeat;
  };

  const events = new Array(raw.length);
  let duration = 0;
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    const t = tickToSec(e.tick);
    events[i] = { t, ch: e.ch, type: e.type, a: e.a, b: e.b };
    if (t > duration) duration = t;
  }
  duration = Math.max(duration, tickToSec(endTick));
  return {
    format,
    ticksPerBeat,
    trackCount,
    events,
    tempoMap: map.map((s) => ({ tick: s.tick, t: s.t, usPerBeat: s.usPerBeat, bpm: 60e6 / s.usPerBeat })),
    duration,
  };
}

/** Parse one MTrk body into `raw` / `tempos`; returns the track's final tick (end-of-track marker or last event). */
function parseTrack(u8, start, end, raw, tempos) {
  let q = start;
  let tick = 0;
  let running = 0;
  const vlq = () => {
    let v = 0;
    for (let n = 0; n < 4 && q < end; n++) {
      const b = u8[q++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    return v;
  };
  while (q < end) {
    tick += vlq();
    if (q >= end) break;
    let status = u8[q];
    if (status < 0x80) {
      if (!running) break; // data byte without a status: damaged track
      status = running;
    } else {
      q++;
      if (status < 0xf0) running = status;
    }
    if (status === 0xff) { // meta event
      running = 0;
      if (q >= end) break;
      const type = u8[q++];
      const n = vlq();
      if (type === 0x51 && n === 3 && q + 3 <= end) tempos.push({ tick, usPerBeat: (u8[q] << 16) | (u8[q + 1] << 8) | u8[q + 2] });
      q += n;
      if (type === 0x2f) break; // end of track
      continue;
    }
    if (status === 0xf0 || status === 0xf7) { // sysex: skipped
      running = 0;
      const n = vlq(); // (not `q += vlq()`: the operand q would be read before vlq() advances it)
      q += n;
      continue;
    }
    if (status > 0xf0) break; // system common / real-time bytes cannot appear in a file
    const hi = status & 0xf0;
    const ch = status & 0x0f;
    const needsTwo = hi !== 0xc0 && hi !== 0xd0;
    if (q + (needsTwo ? 2 : 1) > end) break;
    const d1 = u8[q++];
    const d2 = needsTwo ? u8[q++] : 0;
    switch (hi) {
      case 0x80: raw.push({ tick, ch, type: 'noteOff', a: d1, b: d2 }); break;
      case 0x90: raw.push({ tick, ch, type: d2 === 0 ? 'noteOff' : 'noteOn', a: d1, b: d2 }); break;
      case 0xa0: raw.push({ tick, ch, type: 'polyPressure', a: d1, b: d2 }); break;
      case 0xb0: raw.push({ tick, ch, type: 'controlChange', a: d1, b: d2 }); break;
      case 0xc0: raw.push({ tick, ch, type: 'programChange', a: d1, b: 0 }); break;
      case 0xd0: raw.push({ tick, ch, type: 'channelPressure', a: d1, b: 0 }); break;
      case 0xe0: raw.push({ tick, ch, type: 'pitchBend', a: (d1 | (d2 << 7)) - 8192, b: 0 }); break;
      default: break;
    }
  }
  return tick;
}
