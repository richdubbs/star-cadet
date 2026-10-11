/**
 * src/audio/cache.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.2 step 4 (optional); SPEC 7.5 step 1
 * createCache(opts) -> {get(key), getEntry(key), put(key, buf, source?), clear(), isAvailable()}
 * Optional IndexedDB cache of VALIDATED sound bytes in the visitor's own browser, keyed `NAME.WAV|sha1`.
 * Every IndexedDB access is wrapped in try/catch; a missing / blocked / failing IndexedDB (private windows, cleared site data,
 * Node) turns the cache into a silent no-op. Nothing is touched at import time or at creation time (the database is opened
 * lazily on first use).
 *
 * ASSUMPTIONS:
 *  - Callers re-validate bytes (size + SHA-1) after a cache read, so a corrupted entry can never be played.
 *  - Entries are {buf, source}; get() returns just the ArrayBuffer (contract), getEntry() also returns where the bytes came from.
 *  - After the first open failure the cache is permanently disabled for this instance (no retry storms).
 */

/**
 * @param {{indexedDB?:any, dbName?:string, storeName?:string, version?:number}} [opts]
 *   indexedDB: injected IDBFactory (default globalThis.indexedDB, resolved lazily)
 */
export function createCache(opts = {}) {
  const dbName = opts.dbName || 'space-cadet-pinball-sounds';
  const storeName = opts.storeName || 'files';
  const version = opts.version || 1;
  /** @type {Promise<any>|null} */
  let dbPromise = null;
  let disabled = false;

  function open() {
    if (disabled) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const factory = opts.indexedDB !== undefined ? opts.indexedDB : globalThis.indexedDB;
        if (!factory || typeof factory.open !== 'function') { disabled = true; resolve(null); return; }
        const req = factory.open(dbName, version);
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
          } catch { /* handled by onerror / later failures */ }
        };
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => { disabled = true; resolve(null); };
        req.onblocked = () => { disabled = true; resolve(null); };
      } catch {
        disabled = true;
        resolve(null);
      }
    });
    return dbPromise;
  }

  /** Run one request against the store; resolves with its result or `fallback` on any failure. */
  async function run(mode, fn, fallback) {
    try {
      const db = await open();
      if (!db) return fallback;
      return await new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, mode);
          const req = fn(tx.objectStore(storeName));
          let result = fallback;
          if (req) {
            req.onsuccess = () => { result = req.result === undefined ? fallback : req.result; };
            req.onerror = () => resolve(fallback);
          }
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => resolve(fallback);
          tx.onabort = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      });
    } catch {
      return fallback;
    }
  }

  const api = {
    /** @param {string} key @returns {Promise<{buf:ArrayBuffer, source:string|null}|null>} */
    async getEntry(key) {
      const v = await run('readonly', (s) => s.get(String(key)), null);
      if (v instanceof ArrayBuffer) return { buf: v, source: null };
      if (v && v.buf instanceof ArrayBuffer) return { buf: v.buf, source: typeof v.source === 'string' ? v.source : null };
      return null;
    },
    /** @param {string} key @returns {Promise<ArrayBuffer|null>} */
    async get(key) {
      const e = await api.getEntry(key);
      return e ? e.buf : null;
    },
    /** @param {string} key @param {ArrayBuffer} buf @param {string} [source] @returns {Promise<boolean>} true when stored */
    async put(key, buf, source) {
      if (!(buf instanceof ArrayBuffer)) return false;
      const ok = await run('readwrite', (s) => s.put({ buf, source: source || null }, String(key)), false);
      return ok !== false;
    },
    /** Remove every cached sound. @returns {Promise<void>} */
    async clear() {
      await run('readwrite', (s) => s.clear(), null);
    },
    /** True unless IndexedDB was found missing / failing. */
    isAvailable() { return !disabled; },
  };
  return api;
}
