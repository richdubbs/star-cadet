/**
 * src/audio/zip.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.5 (decision A10: no JSZip, no third-party library)
 * readZip(buf, {filter?, maxEntryBytes?, native?}) -> Promise<Map<lowerCaseBaseName, ArrayBuffer>>
 * A small central-directory ZIP reader. Entries are keyed by the lower-case base name (text after the last '/' or '\');
 * directories and encrypted / ZIP64 / unknown-method entries are skipped. Methods: stored (0) and deflate (8).
 * Deflate uses DecompressionStream('deflate-raw') when the browser/Node has it, and a built-in inflate (inflateRawJs) otherwise.
 * Corrupt archives (or corrupt entries) are skipped: the function never throws and resolves to whatever could be read (empty map
 * for garbage). Everything read from here is validated by size + SHA-1 by the caller before use.
 *
 * ASSUMPTIONS:
 *  - `filter(baseNameLower, fullPath)` lets callers skip entries BEFORE inflating (the original zip also holds a 900 KB PINBALL.DAT).
 *  - If two entries share a base name the first one wins.
 *  - Entry sizes come from the central directory (correct even when a data descriptor is used); an inflated size that differs from
 *    the declared size discards the entry. Entries above `maxEntryBytes` (default 32 MiB) are skipped (zip-bomb guard).
 *  - CRC-32 is not checked (the SHA-1 check of the caller is stronger).
 */

const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

/** @param {ArrayBuffer|ArrayBufferView} buf @returns {Uint8Array} */
function asU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}

/** Exact-size ArrayBuffer copy of a view. @param {Uint8Array} u8 */
function copyOut(u8) {
  const out = new Uint8Array(u8.length);
  out.set(u8);
  return out.buffer;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inflate (RFC 1951) - fallback when DecompressionStream is unavailable. Compact canonical-Huffman decoder.
// ---------------------------------------------------------------------------------------------------------------------
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** @param {ArrayLike<number>} lengths code length per symbol @param {number} n */
function buildHuffman(lengths, n) {
  const count = new Uint16Array(16);
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

let fixedTrees = null;
function getFixedTrees() {
  if (fixedTrees) return fixedTrees;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  const d = new Uint8Array(30).fill(5);
  fixedTrees = { lit: buildHuffman(l, 288), dist: buildHuffman(d, 30) };
  return fixedTrees;
}

/**
 * Inflate a raw DEFLATE stream (no zlib / gzip header). Throws on corrupt data or when the output would exceed `limit`.
 * @param {Uint8Array} src @param {number} [limit] maximum output size in bytes @returns {Uint8Array}
 */
export function inflateRawJs(src, limit = MAX_ENTRY_BYTES) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.min(Math.max(src.length * 3, 1024), limit));
  let op = 0;

  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('inflate: unexpected end of data');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('inflate: bad huffman code');
  };
  const ensure = (extra) => {
    if (op + extra <= out.length) return;
    if (op + extra > limit) throw new Error('inflate: output too large');
    const grown = new Uint8Array(Math.min(Math.max(out.length * 2, op + extra), limit));
    grown.set(out.subarray(0, op));
    out = grown;
  };
  const codes = (lit, dist) => {
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[op++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= 29) throw new Error('inflate: bad length symbol');
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) throw new Error('inflate: bad distance symbol');
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > op) throw new Error('inflate: distance too far back');
        ensure(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - d];
      }
    }
  };

  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; // stored block: drop the rest of the current byte
      bitCnt = 0;
      if (pos + 4 > src.length) throw new Error('inflate: truncated stored block');
      const len = src[pos] | (src[pos + 1] << 8);
      const nlen = src[pos + 2] | (src[pos + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored block length mismatch');
      pos += 4;
      if (pos + len > src.length) throw new Error('inflate: truncated stored block');
      ensure(len);
      out.set(src.subarray(pos, pos + len), op);
      op += len;
      pos += len;
    } else if (type === 1) {
      const f = getFixedTrees();
      codes(f.lit, f.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new Error('inflate: bad block header');
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i]] = bits(3);
      const clTree = buildHuffman(lengths.subarray(0, 19), 19);
      const all = new Uint8Array(nlen + ndist);
      let idx = 0;
      while (idx < nlen + ndist) {
        const sym = decode(clTree);
        if (sym < 16) {
          all[idx++] = sym;
        } else {
          let rep;
          let val = 0;
          if (sym === 16) {
            if (idx === 0) throw new Error('inflate: repeat with no previous length');
            val = all[idx - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) {
            rep = 3 + bits(3);
          } else {
            rep = 11 + bits(7);
          }
          if (idx + rep > nlen + ndist) throw new Error('inflate: too many lengths');
          while (rep--) all[idx++] = val;
        }
      }
      if (all[256] === 0) throw new Error('inflate: missing end-of-block code');
      codes(buildHuffman(all.subarray(0, nlen), nlen), buildHuffman(all.subarray(nlen), ndist));
    } else {
      throw new Error('inflate: invalid block type');
    }
  } while (!last);
  return out.subarray(0, op);
}

/** Inflate with the platform's DecompressionStream. @param {Uint8Array} src @returns {Promise<Uint8Array>} */
async function inflateNative(src) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const feeding = (async () => {
    await writer.write(src);
    await writer.close();
  })();
  feeding.catch(() => {}); // a failure surfaces through the reader below
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_ENTRY_BYTES) throw new Error('inflate: output too large');
  }
  await feeding;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** @param {Uint8Array} src @param {number} size declared uncompressed size @param {boolean} preferNative @returns {Promise<Uint8Array>} */
async function inflate(src, size, preferNative) {
  if (preferNative && typeof DecompressionStream === 'function') {
    try { return await inflateNative(src); } catch { /* fall back to the JS inflate (it also rejects genuinely corrupt data) */ }
  }
  return inflateRawJs(src, Math.max(size, 1));
}

/**
 * Read a ZIP archive.
 * @param {ArrayBuffer|ArrayBufferView} buf
 * @param {{filter?:(baseNameLower:string, fullPath:string)=>boolean, maxEntryBytes?:number, native?:boolean}} [opts]
 *   native:false forces the built-in inflate (tests)
 * @returns {Promise<Map<string, ArrayBuffer>>} lower-case base name -> file bytes; empty on corrupt input
 */
export async function readZip(buf, opts = {}) {
  /** @type {Map<string, ArrayBuffer>} */
  const out = new Map();
  try {
    const u8 = asU8(buf);
    const len = u8.length;
    if (len < 22) return out;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const filter = typeof opts.filter === 'function' ? opts.filter : null;
    const maxEntry = opts.maxEntryBytes > 0 ? opts.maxEntryBytes : MAX_ENTRY_BYTES;
    const preferNative = opts.native !== false;

    let eocd = -1; // end-of-central-directory record (may be followed by a comment of up to 65535 bytes)
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return out;
    const entries = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (p === 0xffffffff || p >= len) return out; // ZIP64 or damaged

    const utf8 = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
    for (let n = 0; n < entries && p + 46 <= len; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const nameBytes = u8.subarray(p + 46, Math.min(len, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      try {
        let name = '';
        if (utf8) name = utf8.decode(nameBytes); else for (const c of nameBytes) name += String.fromCharCode(c);
        if (!name || name.endsWith('/') || name.endsWith('\\')) continue; // directory entry
        if ((flags & 1) || (method !== 0 && method !== 8)) continue; // encrypted / unsupported method
        if (csize === 0xffffffff || usize === 0xffffffff || usize > maxEntry) continue; // ZIP64 / too big
        const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).toLowerCase();
        if (!base || out.has(base)) continue;
        if (filter && !filter(base, name)) continue;
        if (lho + 30 > len || dv.getUint32(lho, true) !== 0x04034b50) continue;
        const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        if (dataStart + csize > len) continue;
        const raw = u8.subarray(dataStart, dataStart + csize);
        if (method === 0) {
          if (csize !== usize) continue;
          out.set(base, copyOut(raw));
        } else {
          const data = await inflate(raw, usize, preferNative);
          if (data.length !== usize) continue;
          out.set(base, copyOut(data));
        }
      } catch {
        /* skip this entry, keep reading the others */
      }
    }
  } catch {
    /* corrupt archive: return what we have (normally nothing) */
  }
  return out;
}
