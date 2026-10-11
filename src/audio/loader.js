/**
 * src/audio/loader.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.2; SPEC 7.5; sound policy 0.2 #4
 * loadSounds({fetchImpl, sha1Fn, data, onProgress, concurrency, music, cache, sleep, skip, musicOnly, onFile, localMissLimit, discoverLocal})
 *   -> Promise<{files: Map<fileKey, ArrayBuffer>, music: ArrayBuffer|null, sources: Record<fileKey, 'local'|'S1'|'S5'>}>
 * The network layer, pure (no AudioContext, no DOM). Per file, in this order:
 *   0. optional IndexedDB cache (re-validated);
 *   1. candidateUrls(): same-origin ./sounds/<NAME> (upper then lower spelling), Internet Archive S1, Internet Archive S5.
 *      - 404 or any other 4xx  => this source is skipped at once (no retry);
 *      - network error / 5xx / 429 / 408 => up to 2 retries with 0.5 s then 1.5 s backoff on the SAME source, then the next source;
 *      - bytes are accepted ONLY if byteLength and SHA-1 equal the manifest; anything else is discarded and the next source is tried.
 * Never rejects: if every source fails for a file the file is simply absent from `files` (the game stays silent for it).
 * Concurrency is at most `concurrency` (default 4) requests in flight. The six absent files and PINBALL2.MID are never requested.
 *
 * ASSUMPTIONS:
 *  - Browsers print every 404 fetch in the console, and an empty ./sounds/ folder (the normal case) would cost two per file. Two
 *    guards keep the console clean without changing which files are used (both only skip requests that would 404):
 *    (a) `discoverLocal: true` (the facade sets it): one GET of ./sounds/ - if the server answers with a directory listing that
 *        contains our own README.txt, only the sound files named in the listing are requested locally (exact spelling from the
 *        listing; zero 404s). Any other answer (404, 403, a page without README.txt, an error) = "unknown" and the probing below is used.
 *    (b) circuit breaker for blind probing: after `localMissLimit` (default 4) files whose every local spelling failed while NO
 *        local file has ever been found, the local source is skipped for the remaining files (a few requests are already in
 *        flight, so about 8-12 probes happen). A folder holding any of the first files probed is never affected.
 *        Pass Infinity for the literal "probe every file" policy.
 *  - After a local hit on the lower-case spelling only, the lower-case spelling is tried first from then on.
 *  - Music (the MID) is loaded as an extra job after the sounds only when `music` is true, from local or S1 only (S5 excluded by
 *    candidateUrls), and does not count towards progress.total.
 *  - A cache hit is reported with the source stored with it (default 'local' if unknown).
 */
import { candidateUrls, resolveSoundData } from './sources.js';
import { validateBytes, sha1Hex } from './validate.js';

/** Backoff before retry n (0.5 s then 1.5 s): 1 initial attempt + 2 retries per source. */
export const RETRY_DELAYS_MS = Object.freeze([500, 1500]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LOCAL_DIR = './sounds/';

/**
 * Ask the server for a listing of ./sounds/ (python http.server, nginx / Apache autoindex ...). Trusted only if the listing links
 * our own README.txt, which proves it is a listing of THIS folder.
 * @param {typeof fetch} fetchImpl
 * @param {{dir?:string, isSoundName?:(name:string)=>boolean}} [o]
 * @returns {Promise<Map<string,string>|null>} UPPER-CASE file name -> name as spelled on the server; null = unknown
 */
export async function discoverLocalIndex(fetchImpl, o = {}) {
  try {
    const res = await fetchImpl(o.dir || LOCAL_DIR, { cache: 'no-cache' });
    if (!res) return null;
    const ok = res.ok !== undefined ? !!res.ok : (res.status >= 200 && res.status < 300);
    if (!ok) return null;
    const text = new TextDecoder('utf-8').decode(await res.arrayBuffer());
    if (text.length > 2_000_000) return null;
    const all = new Map();
    for (const m of text.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)) {
      let href = m[1];
      try { href = decodeURIComponent(href); } catch { /* keep raw */ }
      const name = href.slice(href.lastIndexOf('/') + 1);
      if (name && !all.has(name.toUpperCase())) all.set(name.toUpperCase(), name);
    }
    if (!all.has('README.TXT')) return null; // not provably a listing of this folder
    const sound = o.isSoundName || ((n) => /^(sound\d+d?\.wav|pinball\.mid)$/i.test(n));
    const index = new Map();
    for (const [upper, name] of all) if (sound(name)) index.set(upper, name);
    return index;
  } catch {
    return null;
  }
}

/** Swallow errors from optional collaborators (cache, callbacks). */
async function safely(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch, sha1Fn?: (b:ArrayBuffer)=>Promise<string>, data?: any,
 *   onProgress?: (p:{done:number, loaded:number, total:number, key:string, ok:boolean, source:string|null, music:boolean})=>void,
 *   onFile?: (key:string, buf:ArrayBuffer, source:string, isMusic:boolean)=>void,
 *   concurrency?: number, music?: boolean, musicOnly?: boolean, skip?: Iterable<string>,
 *   cache?: {get:Function, getEntry?:Function, put:Function}|null, sleep?: (ms:number)=>Promise<void>, localMissLimit?: number,
 *   discoverLocal?: boolean,
 * }} [opts]
 * @returns {Promise<{files: Map<string, ArrayBuffer>, music: ArrayBuffer|null, sources: Record<string, string>}>}
 */
export async function loadSounds(opts = {}) {
  /** @type {{files: Map<string, ArrayBuffer>, music: ArrayBuffer|null, sources: Record<string, string>}} */
  const result = { files: new Map(), music: null, sources: {} };
  try {
    await run(opts || {}, result);
  } catch {
    /* never reject: whatever was loaded so far is returned */
  }
  return result;
}

async function run(opts, result) {
  const D = resolveSoundData(opts.data);
  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const sha1Fn = typeof opts.sha1Fn === 'function' ? opts.sha1Fn : sha1Hex;
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : defaultSleep;
  const cache = opts.cache || null;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const onFile = typeof opts.onFile === 'function' ? opts.onFile : null;
  const concurrency = Math.max(1, Math.min(8, Math.trunc(Number(opts.concurrency) || 4)));
  const missLimit = opts.localMissLimit === undefined ? 4 : Number(opts.localMissLimit);
  const skip = new Set(opts.skip || []);

  const jobs = [];
  if (!opts.musicOnly) {
    for (const key of Object.keys(D.SOUND_FILES)) if (!skip.has(key)) jobs.push({ key, music: false });
  }
  const total = jobs.length;
  if ((opts.music || opts.musicOnly) && !skip.has('PINBALL')) jobs.push({ key: 'PINBALL', music: true });

  const state = { localHits: 0, localMisses: 0, localOff: false, lowerFirst: false, done: 0, loaded: 0 };
  /** The ./sounds/ listing is requested lazily (a fully cached session makes no request at all) and only once. */
  let indexPromise = null;
  const ensureLocalIndex = () => {
    if (!opts.discoverLocal || !fetchImpl) return Promise.resolve(null);
    if (!indexPromise) indexPromise = discoverLocalIndex(fetchImpl);
    return indexPromise;
  };

  /** One fetch attempt sequence (initial try + retries) for one candidate. Resolves with validated bytes or null. */
  async function fetchCandidate(cand, expected) {
    if (!fetchImpl) return null;
    const isLocal = cand.source === 'local';
    const init = isLocal ? { cache: 'no-cache' } : { mode: 'cors', credentials: 'omit', cache: 'force-cache' };
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await safely(() => sleep(RETRY_DELAYS_MS[attempt - 1]));
      let res;
      try {
        res = await fetchImpl(cand.url, init);
      } catch {
        continue; // network error: retry the same source
      }
      if (!res) continue;
      const ok = res.ok !== undefined ? !!res.ok : (res.status >= 200 && res.status < 300);
      if (!ok) {
        const st = Number(res.status) || 0;
        if (st >= 500 || st === 429 || st === 408) continue; // transient: retry the same source
        return null; // 404 and other 4xx: skip this source immediately
      }
      let buf;
      try {
        buf = await res.arrayBuffer();
      } catch {
        continue; // body failed mid-transfer: treat like a network error
      }
      return (await validateBytes(expected, buf, sha1Fn)) ? buf : null; // wrong bytes: discard, next source
    }
    return null;
  }

  async function runJob(job) {
    const expected = job.music ? D.MUSIC_FILE : D.SOUND_FILES[job.key];
    const fileName = job.music ? D.MUSIC_FILE.name : D.fileNameOf(job.key);
    const cacheKey = fileName + '|' + expected.sha1;
    let buf = null;
    let source = null;

    if (cache) {
      const entry = await safely(
        async () => (typeof cache.getEntry === 'function' ? cache.getEntry(cacheKey) : { buf: await cache.get(cacheKey), source: null }),
        null,
      );
      if (entry && entry.buf && (await validateBytes(expected, entry.buf, sha1Fn))) { buf = entry.buf; source = entry.source || 'local'; }
    }

    if (!buf) {
      let cands = candidateUrls(job.key, { music: job.music, data: D });
      const localIndex = await ensureLocalIndex();
      if (localIndex) { // the server listed ./sounds/: request only what is really there, with the server's own spelling
        const actual = localIndex.get(fileName.toUpperCase());
        cands = cands.filter((c) => c.source !== 'local');
        if (actual) cands.unshift({ source: 'local', url: LOCAL_DIR + encodeURIComponent(actual) });
      } else if (state.lowerFirst) { // a lower-case-only folder: try that spelling first
        cands = [...cands.filter((c) => c.source === 'local').reverse(), ...cands.filter((c) => c.source !== 'local')];
      }
      let triedLocal = false;
      let hitLocal = false;
      for (const cand of cands) {
        const isLocal = cand.source === 'local';
        if (isLocal && state.localOff) continue;
        if (isLocal) triedLocal = true;
        const got = await fetchCandidate(cand, expected);
        if (!got) continue;
        buf = got;
        source = cand.source;
        if (isLocal) {
          hitLocal = true;
          state.localHits++;
          const base = cand.url.slice(cand.url.lastIndexOf('/') + 1);
          if (base !== base.toUpperCase() && base === base.toLowerCase()) state.lowerFirst = true;
        }
        break;
      }
      if (triedLocal && !hitLocal) {
        state.localMisses++;
        if (state.localHits === 0 && state.localMisses >= missLimit) state.localOff = true;
      }
      if (buf && cache) await safely(() => cache.put(cacheKey, buf, source));
    }

    if (buf) {
      if (job.music) result.music = buf;
      else result.files.set(job.key, buf);
      result.sources[job.key] = source;
      if (!job.music) state.loaded++;
      if (onFile) await safely(() => onFile(job.key, buf, source, job.music));
    }
    if (!job.music) state.done++;
    if (onProgress) {
      const info = { done: state.done, loaded: state.loaded, total, key: job.key, ok: !!buf, source: buf ? source : null, music: job.music };
      await safely(() => onProgress(info));
    }
  }

  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      try { await runJob(jobs[i]); } catch { /* one bad file never stops the others */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
}
