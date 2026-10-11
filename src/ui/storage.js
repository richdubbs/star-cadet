/**
 * src/ui/storage.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.5; type Store (src/types.js)
 * createStore(storage?) -> Store. The ONLY module in the app that touches localStorage. Every read and every write is wrapped in try/catch:
 * with `storage === null`, a storage whose methods (or getter) throw (private window, blocked site data), a full quota or corrupt JSON the
 * store silently keeps working from memory and returns defaults. `storage === undefined` means "use window.localStorage, looked up inside
 * try/catch"; nothing is read at import time.
 *
 *   getOptions()        always a complete, validated Options (defaults filled)
 *   setOptions(patch)   merge the valid fields of `patch`, persist, return the complete Options
 *   getBindings()       Bindings | null (null = nothing valid stored)        setBindings(b)  invalid input is ignored, null clears
 *   getHighScores()     5 x {name, score} | null                           setHighScores(e) anything but 5 valid entries is ignored
 *
 * Pure helpers sanitizeOptions / sanitizeBindings / sanitizeHighScores are exported too (additive) so the validation is unit-testable.
 *
 * ASSUMPTIONS: a value written during this session takes priority over what the storage returns (so a failed write still reads back);
 * high-score names are limited to 31 characters (SPEC 6.6); duplicate keys inside stored bindings are accepted (the dialog prevents them).
 */

/** @type {Readonly<import('../types.js').Options>} */
export const DEFAULT_OPTIONS = Object.freeze({
  sounds: true, music: false, fullscreen: false, players: 1, camera: 'original', volume: 0.8, soundConsent: 'unset',
});

export const STORAGE_KEYS = Object.freeze({ options: 'scp.options.v1', bindings: 'scp.bindings.v1', highScores: 'scp.highscores.v1' });

const CAMERAS = Object.freeze(['original', 'top', 'orbit']);
const CONSENTS = Object.freeze(['unset', 'granted', 'denied']);
/** The six rebindable game actions (GameAction in types.js). */
export const BINDING_ACTIONS = Object.freeze(['flipperLeft', 'flipperRight', 'plunger', 'nudgeLeft', 'nudgeRight', 'nudgeBottom']);
const NAME_MAX = 31;
const SLOTS = 5;

/**
 * Validate an Options-like object field by field; invalid or missing fields fall back to `base`.
 * @param {any} raw @param {import('../types.js').Options} [base] @returns {import('../types.js').Options}
 */
export function sanitizeOptions(raw, base = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...base };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return o;
  if (typeof raw.sounds === 'boolean') o.sounds = raw.sounds;
  if (typeof raw.music === 'boolean') o.music = raw.music;
  if (typeof raw.fullscreen === 'boolean') o.fullscreen = raw.fullscreen;
  if (Number.isInteger(raw.players) && raw.players >= 1 && raw.players <= 4) o.players = /** @type {1|2|3|4} */ (raw.players);
  if (CAMERAS.includes(raw.camera)) o.camera = raw.camera;
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) o.volume = Math.min(1, Math.max(0, raw.volume));
  if (CONSENTS.includes(raw.soundConsent)) o.soundConsent = raw.soundConsent;
  return o;
}

/**
 * @param {any} raw @returns {import('../types.js').Bindings|null} all six actions mapped to non-empty strings, else null
 */
export function sanitizeBindings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  /** @type {any} */
  const out = {};
  for (const a of BINDING_ACTIONS) {
    const v = raw[a];
    if (typeof v !== 'string' || v.length === 0 || v.length > 40) return null;
    out[a] = v;
  }
  return out;
}

/**
 * @param {any} raw @returns {import('../types.js').HighScoreEntry[]|null} exactly 5 {name, score} entries, else null
 */
export function sanitizeHighScores(raw) {
  if (!Array.isArray(raw) || raw.length !== SLOTS) return null;
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof e.name !== 'string' || typeof e.score !== 'number' || !Number.isFinite(e.score)) return null;
    out.push({ name: e.name.slice(0, NAME_MAX), score: e.score });
  }
  return out;
}

/** window.localStorage looked up defensively (the getter itself throws in some privacy modes). @returns {Storage|null} */
function defaultStorage() {
  try {
    if (typeof window !== 'undefined' && window && window.localStorage) return window.localStorage;
  } catch { /* blocked */ }
  return null;
}

/**
 * @param {Storage|null} [storage] undefined = window.localStorage (try/catch), null = memory only
 * @returns {import('../types.js').Store}
 */
export function createStore(storage) {
  const backend = storage === undefined ? defaultStorage() : storage;
  /** @type {Map<string, string|null>} values written this session (string = JSON text, null = removed) */
  const mem = new Map();

  /** @param {string} key @returns {string|null} */
  function readRaw(key) {
    if (mem.has(key)) return /** @type {string|null} */ (mem.get(key));
    if (!backend) return null;
    try {
      const v = backend.getItem(key);
      return typeof v === 'string' ? v : null;
    } catch { return null; }
  }

  /** @param {string} key @param {string|null} value */
  function writeRaw(key, value) {
    mem.set(key, value);
    if (!backend) return;
    try {
      if (value === null) backend.removeItem(key); else backend.setItem(key, value);
    } catch { /* quota exceeded / blocked: memory copy keeps working */ }
  }

  /** @param {string} key @returns {any} parsed JSON or undefined */
  function readJson(key) {
    const raw = readRaw(key);
    if (raw === null) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  return {
    getOptions() {
      return sanitizeOptions(readJson(STORAGE_KEYS.options));
    },
    setOptions(patch) {
      const next = sanitizeOptions(patch, sanitizeOptions(readJson(STORAGE_KEYS.options)));
      writeRaw(STORAGE_KEYS.options, JSON.stringify(next));
      return { ...next };
    },
    getBindings() {
      return sanitizeBindings(readJson(STORAGE_KEYS.bindings));
    },
    setBindings(b) {
      if (b === null || b === undefined) { writeRaw(STORAGE_KEYS.bindings, null); return; }
      const clean = sanitizeBindings(b);
      if (clean) writeRaw(STORAGE_KEYS.bindings, JSON.stringify(clean));
    },
    getHighScores() {
      return sanitizeHighScores(readJson(STORAGE_KEYS.highScores));
    },
    setHighScores(entries) {
      const clean = sanitizeHighScores(entries);
      if (clean) writeRaw(STORAGE_KEYS.highScores, JSON.stringify(clean));
    },
  };
}
