/**
 * src/audio/sources.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.2 step 1; sound policy 0.2 #4 (local ./sounds -> Internet Archive S1 -> S5; user picker is separate)
 * candidateUrls(fileKey, {music, data}) -> [{source, url}] in policy order:
 *   local upper-case spelling, local lower-case spelling, S1 (archive zip route), S5 (archive loose route; NEVER for the MID).
 * Names in NEVER_FETCH (the six absent files, PINBALL2.MID) and keys that are not in the manifest produce an EMPTY list, so they
 * are never requested. Pure: no network, no globals.
 *
 * ASSUMPTIONS:
 *  - `music: true` (or the key 'PINBALL') always means "the single music file"; the fileKey is then ignored.
 *  - Result objects have exactly {source, url} (the lower-case local spelling is recognisable by its URL).
 *  - `data` may be a partial / spread-and-override copy of the data barrel; missing members fall back to src/data/sounds.js.
 */
import * as soundData from '../data/sounds.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Resolve the sound-manifest members this subsystem needs from an optional (possibly partial) data module.
 * @param {any} [data] @returns {{SOUND_FILES:any, MUSIC_FILE:any, NEVER_FETCH:readonly string[], SOUND_SOURCES:readonly any[], SOUND_KEYS:any,
 *   fileNameOf:(k:string)=>string, soundDuration:(k:string)=>number}}
 */
export function resolveSoundData(data) {
  const d = data || {};
  return {
    SOUND_FILES: d.SOUND_FILES || soundData.SOUND_FILES,
    MUSIC_FILE: d.MUSIC_FILE || soundData.MUSIC_FILE,
    NEVER_FETCH: d.NEVER_FETCH || soundData.NEVER_FETCH,
    SOUND_SOURCES: d.SOUND_SOURCES || soundData.SOUND_SOURCES,
    SOUND_KEYS: d.SOUND_KEYS || soundData.SOUND_KEYS,
    fileNameOf: d.fileNameOf || soundData.fileNameOf,
    soundDuration: d.soundDuration || soundData.soundDuration,
  };
}

/** True when the key designates the music file. @param {any} fileKey @param {{music?:boolean}} opts */
function isMusicKey(fileKey, opts) {
  if (opts && opts.music === true) return true;
  return typeof fileKey === 'string' && /^pinball(\.mid)?$/i.test(fileKey);
}

/**
 * Ordered download candidates for one file.
 * @param {string} fileKey e.g. 'SOUND49D' (case-insensitive) or 'PINBALL' for the MID
 * @param {{music?:boolean, data?:any}} [opts]
 * @returns {{source:string, url:string}[]}
 */
export function candidateUrls(fileKey, opts = {}) {
  const D = resolveSoundData(opts && opts.data);
  const music = isMusicKey(fileKey, opts);
  let name;
  if (music) {
    name = D.MUSIC_FILE.name;
  } else {
    if (typeof fileKey !== 'string') return [];
    const key = fileKey.toUpperCase();
    if (!hasOwn(D.SOUND_FILES, key)) return [];
    name = D.fileNameOf(key);
  }
  const upper = name.toUpperCase();
  if (D.NEVER_FETCH.some((n) => n.toUpperCase() === upper)) return [];
  const out = [];
  for (const src of D.SOUND_SOURCES) {
    if (music && src.music === false) continue; // S5 has no CORS for the MID and is never used for it
    for (const variant of src.caseVariants) {
      const spelled = variant === 'lower' ? name.toLowerCase() : upper;
      const url = src.url(spelled);
      if (!out.some((c) => c.url === url)) out.push({ source: src.id, url });
    }
  }
  return out;
}
