/**
 * src/data/sounds.js
 * OWNER: DATA  (ARCHITECT-SEEDED, REAL VALUES. FROZEN CONTRACT: keys may be added, never renamed or removed)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * SPEC 7.2-7.5 + task sound policy: source order per file = (1) local ./sounds/<NAME>  (2) Internet Archive S1 zip route
 * (3) Internet Archive S5 loose-file route  (4) user-picked folder/zip.  GitHub/jsDelivr mirrors S2-S4 are DROPPED.
 * Every file is validated by byte length + SHA-1 (all 41 SHA-1 values below were cross-checked against the independent
 * checksum.sha1 of the 'Pinball' folder of the space-cadet-pinball installer repo). Nothing is ever bundled.
 * Pure, Node-safe, frozen. Durations are bytes/11000 (SPEC 7.4) and drive gameplay timers whether or not audio loaded.
 * SOUND_EVENT_MAP matching rule: an entry matches a physics event e when e.type === entry.event AND, for every property p of entry.match (if any),
 * e[p] is one of the allowed values listed for p; the FIRST matching entry wins and its `key` is played (suppressed while tilt-locked, SPEC 7.3);
 * no match = silent. Script sounds (SW*) and rules-initiated ones (NEW_GAME, TILT, BALL_FEED, BLOCKER_MOVE, GAME_OVER) are played by RULES directly.
 */
import { deepFreeze } from './freeze.js';

/** Original sound files. Key = upper-case base name; real file name = fileNameOf(key) (e.g. SOUND49D -> 'SOUND49D.WAV'). */
export const SOUND_FILES = deepFreeze({
  SOUND1: { bytes: 55490, sha1: 'dfe41d51a938ecfae109bbbc61a123591e41b327', timer: 5.044545 },
  SOUND3: { bytes: 22858, sha1: 'cf7a88a5035e9e0dd1fe830511910778c79d89a9', timer: 2.078 },
  SOUND4: { bytes: 16626, sha1: '0d522eb3b12b8973c1a69e6a0867a98e4bcf4a33', timer: 1.511455 },
  SOUND5: { bytes: 3180, sha1: '751794a51bd5b072fa9c082c6fe730ff7c384c89', timer: 0.289091 },
  SOUND7: { bytes: 26442, sha1: 'a6c979787f55c7fbd35029c2f866e7d7728bb353', timer: 2.403818 },
  SOUND8: { bytes: 2102, sha1: 'c5b611e741004610964999f32bbd4349d8e2b825', timer: 0.191091 },
  SOUND9: { bytes: 20098, sha1: 'b60817955aa87e869ed440e84fdb92dbed844c8a', timer: 1.827091 },
  SOUND12: { bytes: 4296, sha1: '83a2aadf3bf8afaa328f448beaf79df76c7c09f1', timer: 0.390545 },
  SOUND14: { bytes: 3002, sha1: '3634223359f1ff17533cf616069015c2a0e3051a', timer: 0.272909 },
  SOUND16: { bytes: 1046, sha1: 'a4abd710cc2a64cb2d0c0779228c0ee4c568532b', timer: 0.095091 },
  SOUND17: { bytes: 2090, sha1: 'a2353017387fab74062a72ba153d93c5855e30e7', timer: 0.19 },
  SOUND18: { bytes: 3986, sha1: '6d029c7a90a0ba60e22592c9ff7b4c4ef308c6bf', timer: 0.362364 },
  SOUND19: { bytes: 5230, sha1: 'a784be434f01c4f36fc3facad9285b67801f92c4', timer: 0.475455 },
  SOUND20: { bytes: 8650, sha1: '0408b9c258df424586ac2af4e074224e502aa328', timer: 0.786364 },
  SOUND21: { bytes: 9194, sha1: 'e547de35a94eac2d72a6db634a05bf35d615e201', timer: 0.835818 },
  SOUND22: { bytes: 7376, sha1: '62e121b9178172fd5e7869566c7d998b12b0ae80', timer: 0.670545 },
  SOUND24: { bytes: 12106, sha1: '0483fcd451e86650720156eb821e6c09baadfa30', timer: 1.100545 },
  SOUND25: { bytes: 25704, sha1: '2f0c2a9d0c688e19d24602a525ee5e0883d7d7d0', timer: 2.336727 },
  SOUND26: { bytes: 7306, sha1: 'b00cfb19c98c42e9cc5efde516a6cf67d5271f19', timer: 0.664182 },
  SOUND27: { bytes: 20242, sha1: 'd403214aeb68ccb48c156332d1e28f60a1864181', timer: 1.840182 },
  SOUND28: { bytes: 8650, sha1: '042a41dede73a6a62edf143bffc54a46e195452d', timer: 0.786364 },
  SOUND29: { bytes: 10364, sha1: '6db09c6c9f728ada8a6a9a17aea456ad7e3df5c9', timer: 0.942182 },
  SOUND30: { bytes: 22570, sha1: 'f3ac1cddce6b1e754c8a3536bcb6ce895fccce8c', timer: 2.051818 },
  SOUND34: { bytes: 1520, sha1: '8a57c85ad19a0e3e5f31a1e2fc795fda8ee625f0', timer: 0.138182 },
  SOUND35: { bytes: 19498, sha1: '69e2787400c9cef9b27d315096657c4fe284aa9b', timer: 1.772545 },
  SOUND36: { bytes: 33848, sha1: '1752c3ee6d6477ba4907cb6b3f6d6983cae70303', timer: 3.077091 },
  SOUND38: { bytes: 13024, sha1: 'cad6dece9ef1d737fec21be8023afe7defbd79ce', timer: 1.184 },
  SOUND39: { bytes: 28282, sha1: '1da85c474c35f5867a37ee03194d5c5bb4c3a82f', timer: 2.571091 },
  SOUND43: { bytes: 22796, sha1: 'ff5b397f63f5aa69155797c3313b42cd7ae58a88', timer: 2.072364 },
  SOUND45: { bytes: 9770, sha1: '7c663440910f156bd0b4a5d1831408edc21d91e8', timer: 0.888182 },
  SOUND49: { bytes: 1876, sha1: '297645858fd7c2a4b2b4ee19a85576637c29d073', timer: 0.170545 },
  SOUND49D: { bytes: 3330, sha1: '34894beb860aafb467cfbf6b0a4b1c17f3322c62', timer: 0.302727 },
  SOUND50: { bytes: 12074, sha1: 'a3777e78b4a3e9b65905c56c6e331f2038130953', timer: 1.097636 },
  SOUND54: { bytes: 18250, sha1: '1faf14e33f7ed6aa736c9f26a3161dc23f35bfd6', timer: 1.659091 },
  SOUND55: { bytes: 21890, sha1: '77380a92f99db5207c324077ec476659781da8ad', timer: 1.99 },
  SOUND57: { bytes: 30502, sha1: '5fb7bbda9799bcc6d0f7e1f7905a28a18210f5b3', timer: 2.772909 },
  SOUND104: { bytes: 1226, sha1: 'f8acd7e01a57238b9e7bdc66ef3fc543bc0c4f7b', timer: 0.111455 },
  SOUND105: { bytes: 1968, sha1: 'b09398237b6439609aac3cc56ed570e0a4afd555', timer: 0.178909 },
  SOUND108: { bytes: 7754, sha1: '362823fcf19b32d4488eb943833eeb6846732f6f', timer: 0.704909 },
  SOUND111: { bytes: 890, sha1: '08540944e8d475814991cc643cc97cd6f82665cc', timer: 0.080909 },
  SOUND131: { bytes: 1290, sha1: '961f182053de9c85825b1a6cb29ec6576d708d75', timer: 0.117273 },
});

/** The only music file (loops; optional; fetched from local ./sounds or archive S1 ONLY - the S5 route has no CORS for it). */
export const MUSIC_FILE = deepFreeze({ name: 'PINBALL.MID', bytes: 108607, sha1: '3dfc2b292d96f38ad4cd4d948d751ba48a45ddbd' });

/** Files that must never be requested (absent from the release / not music). */
export const NEVER_FETCH = deepFreeze(['SOUND2.WAV', 'SOUND37.WAV', 'SOUND44.WAV', 'SOUND52.WAV', 'SOUND59.WAV', 'SOUND62.WAV', 'PINBALL2.MID']);

const f = (file, extra) => ({ file, ...extra });

/**
 * SoundKey -> { file: key of SOUND_FILES | null, missing?: 'SOUNDnn' }. file === null means the file is absent from the
 * release (silent in the real game): play() returns -1 and nothing is fetched.
 * Component keys come from the DAT; SW* keys are the script tags (soundwaveNN) of the rules code (NN is NOT always the file number).
 * SPEC 7.3.
 */
export const SOUND_KEYS = deepFreeze({
  // component-bound
  FLIP_UP: f('SOUND104'), FLIP_DOWN: f('SOUND105'), PLUNGER_PULL: f(null, { missing: 'SOUND62' }), PLUNGER_RELEASE: f('SOUND22'),
  BALL_FEED: f('SOUND4'), BUMPER: f('SOUND12'), REBOUNDER: f('SOUND5'), POPUP_HIT: f('SOUND49'),
  POPUP4_REARM: f('SOUND50'), POPUP7_REARM: f('SOUND18'), SOLO22_HIT: f('SOUND55'),
  BLOCKER_MOVE: f('SOUND16'), BLOCKER_HIT: f('SOUND34'), KICKBACK: f('SOUND17'), ROLLOVER: f('SOUND26'),
  ROLL_FUEL: f('SOUND8'), ROLL_184: f('SOUND25'), SPACEWARP: f('SOUND55'), KICKOUT: f('SOUND57'), SINK: f('SOUND43'),
  FLAG_TICK: f('SOUND131'), ONEWAY_SIDE: f('SOUND111'), NEW_GAME: f('SOUND1'), GAME_OVER: f(null, { missing: 'SOUND2' }),
  TILT: f('SOUND108'),
  // script tags
  SW3: f('SOUND3'), SW7: f('SOUND7'), SW8: f('SOUND8'), SW9: f('SOUND9'), SW10: f('SOUND54'), SW14: f('SOUND14'),
  SW21: f('SOUND21'), SW23: f('SOUND19'), SW24: f('SOUND24'), SW25: f('SOUND25'), SW26: f('SOUND26'), SW27: f('SOUND27'),
  SW28: f('SOUND28'), SW30: f('SOUND30'), SW35: f('SOUND35'), SW36: f('SOUND36'), SW37: f(null, { missing: 'SOUND37' }),
  SW38: f('SOUND38'), SW39: f('SOUND39'), SW40: f('SOUND20'), SW41: f('SOUND29'), SW44: f(null, { missing: 'SOUND44' }),
  SW45: f('SOUND45'), SW46: f('SOUND45'), SW47: f('SOUND45'), SW48: f('SOUND45'), SW49D: f('SOUND49D'), SW50: f('SOUND50'),
  SW52: f(null, { missing: 'SOUND52' }), SW59: f(null, { missing: 'SOUND59' }),
});

/**
 * Generic DAT-bound sounds triggered by PHYSICS EVENTS (consumed by the rules' sound dispatcher; suppressed while tilt-locked).
 * An entry matches an event e when e.type === entry.event AND, for every property p of entry.match, e[p] is in the allowed list.
 * First match wins; no match = silent. Script sounds (SW*) and rules-initiated ones (NEW_GAME, TILT, BALL_FEED, BLOCKER_MOVE,
 * GAME_OVER) are NOT here: rules plays them directly.
 */
export const SOUND_EVENT_MAP = deepFreeze([
  { event: 'flipper', match: { action: ['extend'] }, key: 'FLIP_UP' },
  { event: 'flipper', match: { action: ['retract'], byKey: [true] }, key: 'FLIP_DOWN' },
  { event: 'plungerPull', key: 'PLUNGER_PULL' },
  { event: 'plungerRelease', key: 'PLUNGER_RELEASE' },
  { event: 'bumperHit', key: 'BUMPER' },
  { event: 'rebounderHit', key: 'REBOUNDER' },
  { event: 'popupHit', key: 'POPUP_HIT' },
  { event: 'popupUp', match: { name: ['a_targ4'] }, key: 'POPUP4_REARM' },
  { event: 'popupUp', match: { name: ['a_targ7'] }, key: 'POPUP7_REARM' },
  { event: 'soloHit', match: { name: ['a_targ22'] }, key: 'SOLO22_HIT' },
  { event: 'blockerHit', key: 'BLOCKER_HIT' },
  { event: 'kickbackFired', key: 'KICKBACK' },
  { event: 'rolloverEnter', match: { name: ['a_roll1', 'a_roll2', 'a_roll3', 'a_roll6', 'a_roll7', 'a_roll110', 'a_roll111', 'a_roll112'] }, key: 'ROLLOVER' },
  { event: 'rolloverEnter', match: { name: ['a_roll179', 'a_roll180', 'a_roll181', 'a_roll182', 'a_roll183'] }, key: 'ROLL_FUEL' },
  { event: 'rolloverEnter', match: { name: ['a_roll184'] }, key: 'ROLL_184' },
  { event: 'rolloverEnter', match: { name: ['a_roll9'] }, key: 'SPACEWARP' },
  { event: 'kickoutEject', match: { id: [1, 2] }, key: 'KICKOUT' },
  { event: 'kickoutCapture', match: { id: [3] }, key: 'KICKOUT' },
  { event: 'sinkCapture', key: 'SINK' },
  { event: 'sinkEject', key: 'SINK' },
  { event: 'flagFrame', key: 'FLAG_TICK' },
  { event: 'onewaySide', key: 'ONEWAY_SIDE' },
]);

/**
 * Fetch sources in priority order. url(fileName) -> string. 'local' is probed first (404 => skip that source for that file).
 * caseVariants: which spellings of the file name to try, in order ('upper' = SOUND1.WAV, 'lower' = sound1.wav).
 */
export const SOUND_SOURCES = deepFreeze([
  { id: 'local', label: 'local ./sounds folder', music: true, caseVariants: ['upper', 'lower'], url: (name) => './sounds/' + name },
  { id: 'S1', label: 'Internet Archive (zip route)', music: true, caseVariants: ['upper'],
    url: (name) => 'https://archive.org/download/3d-pinball-space-cadet_202103/3D%20Pinball%20Space%20Cadet.zip/3D%20Pinball%20Space%20Cadet%2F' + name },
  { id: 'S5', label: 'Internet Archive (loose files)', music: false, caseVariants: ['upper'],
    url: (name) => 'https://archive.org/download/pinball_202005/' + name },
]);

/** 'SOUND49D' -> 'SOUND49D.WAV'. */
export function fileNameOf(fileKey) { return fileKey + '.WAV'; }

/** Duration in seconds of a sound key from the manifest (bytes/11000), or -1 when the key is unknown or its file is missing. */
export function soundDuration(key) {
  const k = SOUND_KEYS[key];
  if (!k || !k.file) return -1;
  return SOUND_FILES[k.file].timer;
}

/** SoundPort that makes no noise but returns the true durations (default for rules and every headless test). */
export const SILENT_SOUND = Object.freeze({ play: (key) => soundDuration(key) });
