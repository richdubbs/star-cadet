/**
 * src/audio/validate.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.2 step 3; SPEC 7.5 step 3
 * validateBytes(expected, buf, sha1Fn): accept ONLY if byteLength === expected.bytes AND SHA-1 === expected.sha1.
 * This rejects HTML error pages, Git-LFS pointer files, truncated bodies and other editions' files.
 * Pure helpers (no DOM, nothing touched at import time).
 *
 * ASSUMPTIONS:
 *  - crypto.subtle only exists in secure contexts (https / localhost). On a plain-http LAN address it is missing, which would
 *    reject every file, so sha1Hex() falls back to a small pure-JS SHA-1 (sha1Js). Both give identical results (tested vs node:crypto).
 *  - The SHA-1 here is an integrity check against a published manifest, not a security primitive.
 *  - validateBytes never throws: any problem (wrong type, digest failure) is simply "not valid".
 */

/** @param {any} x */
function isBinary(x) {
  return x instanceof ArrayBuffer || ArrayBuffer.isView(x)
    || (x != null && typeof x === 'object' && typeof x.byteLength === 'number' && !!x.slice);
}

/** Normalise an ArrayBuffer / typed array / DataView to a Uint8Array view (no copy). @param {any} x @returns {Uint8Array} */
export function toBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x != null && typeof x.byteLength === 'number' && typeof x.slice === 'function') return new Uint8Array(x); // cross-realm ArrayBuffer
  throw new TypeError('expected an ArrayBuffer or a typed array');
}

/**
 * A standalone ArrayBuffer holding exactly the bytes of x (copies only when x is a view onto a larger buffer).
 * @param {any} x @returns {ArrayBuffer}
 */
export function toArrayBuffer(x) {
  if (x instanceof ArrayBuffer) return x;
  const u8 = toBytes(x);
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength && u8.buffer instanceof ArrayBuffer) return u8.buffer;
  return u8.slice().buffer;
}

const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * Pure-JS SHA-1 (FIPS 180-1). Used only when crypto.subtle is unavailable.
 * @param {ArrayBuffer|ArrayBufferView} input @returns {string} 40 lower-case hex characters
 */
export function sha1Js(input) {
  const bytes = toBytes(input);
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = len * 8;
  dv.setUint32(total - 8, Math.floor(bitLen / 4294967296), false);
  dv.setUint32(total - 4, bitLen % 4294967296, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4);
}

/**
 * Hex SHA-1 of a buffer: crypto.subtle when present (secure contexts, Node), else the pure-JS implementation. Never rejects for
 * well-formed input.
 * @param {ArrayBuffer|ArrayBufferView} buf @returns {Promise<string>}
 */
export async function sha1Hex(buf) {
  const bytes = toBytes(buf);
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (subtle && typeof subtle.digest === 'function') {
      const digest = await subtle.digest('SHA-1', bytes);
      const v = new Uint8Array(digest);
      let s = '';
      for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, '0');
      return s;
    }
  } catch { /* fall through to the JS implementation */ }
  return sha1Js(bytes);
}

/**
 * Accept bytes only if the length equals expected.bytes AND the SHA-1 equals expected.sha1.
 * @param {{bytes:number, sha1:string}} expected manifest entry (SOUND_FILES[k] or MUSIC_FILE)
 * @param {ArrayBuffer} buf the downloaded / user-supplied bytes
 * @param {(b:ArrayBuffer)=>Promise<string>} [sha1Fn] hex SHA-1 implementation (default sha1Hex)
 * @returns {Promise<boolean>} never rejects
 */
export async function validateBytes(expected, buf, sha1Fn) {
  try {
    if (!expected || typeof expected.bytes !== 'number' || typeof expected.sha1 !== 'string' || !isBinary(buf)) return false;
    if (buf.byteLength !== expected.bytes) return false; // cheap test first: most wrong bodies (HTML pages) fail here
    const fn = typeof sha1Fn === 'function' ? sha1Fn : sha1Hex;
    const hex = await fn(toArrayBuffer(buf));
    return typeof hex === 'string' && hex.toLowerCase() === expected.sha1.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Read the RIFF 'fmt ' chunk of a WAV (SPEC 7.2: log it once; expected PCM, 1 channel, 11025 Hz, 8 bit). Informational only,
 * never used for gameplay timing.
 * @param {ArrayBuffer|ArrayBufferView} buf @returns {{format:number, channels:number, sampleRate:number, bitsPerSample:number}|null}
 */
export function readWavFormat(buf) {
  try {
    const u8 = toBytes(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let p = 12;
    while (p + 8 <= u8.length) {
      const size = dv.getUint32(p + 4, true);
      if (tag(p) === 'fmt ' && size >= 16 && p + 8 + 16 <= u8.length) {
        return {
          format: dv.getUint16(p + 8, true),
          channels: dv.getUint16(p + 10, true),
          sampleRate: dv.getUint32(p + 12, true),
          bitsPerSample: dv.getUint16(p + 22, true),
        };
      }
      p += 8 + size + (size & 1);
    }
  } catch { /* not a WAV */ }
  return null;
}
