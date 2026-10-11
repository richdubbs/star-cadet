/**
 * src/ui/overlay.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.4 (start overlay); SPEC 6.7
 * createStartOverlay({root, doc, actions, picker, options, bindings}) ->
 *     {show({soundStatus}), hide(), isShown(), setSoundStatus(s), setOptions(o), setBindings(b), elements, dispose()}
 *
 * Fills `root` (= #start-overlay) with the start / sound-consent card. Frozen ids inside it:
 *   start-title (APP_TITLE) | start-consent (the exact consent line, CONSENT_TEXT) | start-players (<select> 1-4) | start-music (checkbox,
 *   "Music (off by default)") | start-btn-sound "Start with original sounds" | start-btn-silent "Start without sound" |
 *   start-load-local "Use my own Pinball folder / zip..." (opens the folder picker, does NOT start the game) | start-status (AudioStatus.text).
 * Additive ids: start-load-zip (picks a zip / loose files), start-keys (current key hints).
 *
 * The two start buttons call actions.start({withSound, players, music}) synchronously inside the click handler (that click is the user gesture
 * that unlocks the AudioContext). Silent start always passes music:false. Initial focus: the silent button when options.soundConsent is
 * 'denied', otherwise the sound button.
 *
 * Copy: the lead line says what a click does (starts the game and lets the browser play sound) and that sound files are only downloaded if
 * "Start with original sounds" is chosen; the consent line is the exact contract text. On touch devices (setTouch(true)) the key hint line is
 * replaced by a hint about the on-screen buttons, because keyboard keys mean nothing there.
 *
 * ASSUMPTIONS: the card is a fixed full-viewport veil below the menu bar (readable on a 360 px phone and in fullscreen) rather than a box inside
 * the stage; the overlay itself never decides to close: the facade hides it when the application calls hideStartOverlay() or a game starts.
 */
import { APP_TITLE } from '../data/text.js';
import { DEFAULT_KEYS } from '../data/constants.js';
import { callAction, h, setText } from './dom.js';
import { keyLabel } from './keylabels.js';

/** The exact consent line required by SPEC 6.7 / ARCHITECTURE.md 8.4. */
export const CONSENT_TEXT = 'Original game sounds are fetched from the Internet Archive; they are copyright Microsoft/Cinematronics and are not bundled.';

/** Lead line of the card (what the click does, and when sound files are fetched). */
export const LEAD_TEXT = 'Click a button to start; your click also lets the browser play sound. Sound files are only downloaded if you choose "Start with original sounds".';

/** Key hint line for touch screens. */
export const TOUCH_HINT_TEXT = 'Touch: tap the left / right half of the table (or Flip) for the flippers; hold Plunger and release to launch; Bump = nudge.';

/**
 * Text of the key hint line shown on the card.
 * @param {import('../types.js').Bindings} b @param {boolean} [touch] touch screen: describe the on-screen buttons instead of the keys
 * @returns {string}
 */
export function keyHintText(b, touch = false) {
  if (touch) return TOUCH_HINT_TEXT;
  const k = (a) => keyLabel(b[a] || DEFAULT_KEYS[a]);
  const dot = '  ·  ';
  return [`Flippers: ${k('flipperLeft')} (left), ${k('flipperRight')} (right)`, `Plunger: ${k('plunger')} (hold, release)`,
    `Bumps: ${k('nudgeLeft')}, ${k('nudgeRight')}, ${k('nudgeBottom')}`, 'F2 new game, F3 pause'].join(dot);
}

/**
 * @param {{root:any, doc:Document, actions?:any, picker?:{pickFolder:()=>void, pickFiles:()=>void}, options?:import('../types.js').Options,
 *          bindings?:import('../types.js').Bindings, data?:any, touch?:boolean}} opts
 */
export function createStartOverlay(opts) {
  const { root, doc, actions = {}, picker = null } = opts;
  const title = (opts.data && opts.data.APP_TITLE) || APP_TITLE;
  let options = opts.options || /** @type {any} */ ({});
  let bindings = opts.bindings || { ...DEFAULT_KEYS };
  let shown = false;
  let touch = Boolean(opts.touch);

  const select = h(doc, 'select', { id: 'start-players', class: 'start-select', 'aria-label': 'Number of players' },
    [1, 2, 3, 4].map((n) => h(doc, 'option', { value: String(n), text: n === 1 ? '1 Player' : `${n} Players` })));
  select.value = String(options.players || 1);
  const music = h(doc, 'input', { id: 'start-music', type: 'checkbox', checked: Boolean(options.music) });
  const btnSound = h(doc, 'button', { id: 'start-btn-sound', class: 'btn btn-primary btn-big', type: 'button', text: 'Start with original sounds' });
  const btnSilent = h(doc, 'button', { id: 'start-btn-silent', class: 'btn btn-big', type: 'button', text: 'Start without sound' });
  const btnLocal = h(doc, 'button', { id: 'start-load-local', class: 'btn btn-link', type: 'button', text: 'Use my own Pinball folder / zip...' });
  const btnZip = h(doc, 'button', { id: 'start-load-zip', class: 'btn btn-link', type: 'button', text: 'or pick a .zip / sound files' });
  const status = h(doc, 'p', { id: 'start-status', class: 'start-status', role: 'status', 'aria-live': 'polite', text: 'sound: not loaded' });
  const keys = h(doc, 'p', { id: 'start-keys', class: 'start-keys', text: keyHintText(bindings, touch) });

  const card = h(doc, 'div', { class: 'start-card', role: 'group', 'aria-labelledby': 'start-title' },
    h(doc, 'h1', { id: 'start-title', class: 'start-title', text: title }),
    h(doc, 'p', { class: 'start-lead', text: LEAD_TEXT }),
    h(doc, 'p', { id: 'start-consent', class: 'start-consent', text: CONSENT_TEXT }),
    h(doc, 'div', { class: 'start-row' },
      h(doc, 'label', { class: 'start-field', for: 'start-players' }, h(doc, 'span', { text: 'Players' }), select),
      h(doc, 'label', { class: 'start-check', for: 'start-music' }, music, h(doc, 'span', { text: 'Music (off by default)' }))),
    h(doc, 'div', { class: 'start-buttons' }, btnSound, btnSilent),
    h(doc, 'div', { class: 'start-local' }, btnLocal, btnZip),
    status,
    keys);
  root.appendChild(card);
  if (!root.hasAttribute || !root.hasAttribute('hidden')) root.setAttribute('hidden', '');

  const players = () => Math.min(4, Math.max(1, Number(select.value) || 1));
  const onSound = () => callAction(actions, 'start', { withSound: true, players: players(), music: Boolean(music.checked) });
  const onSilent = () => callAction(actions, 'start', { withSound: false, players: players(), music: false });
  const onLocal = () => { if (picker) picker.pickFolder(); };
  const onZip = () => { if (picker) picker.pickFiles(); };
  btnSound.addEventListener('click', onSound);
  btnSilent.addEventListener('click', onSilent);
  btnLocal.addEventListener('click', onLocal);
  btnZip.addEventListener('click', onZip);

  return {
    /** @param {{soundStatus?:import('../types.js').AudioStatus}} [o] */
    show(o) {
      shown = true;
      if (o && o.soundStatus) setText(status, o.soundStatus.text);
      select.value = String(options.players || 1);
      music.checked = Boolean(options.music);
      root.removeAttribute('hidden');
      (options.soundConsent === 'denied' ? btnSilent : btnSound).focus();
    },
    hide() {
      shown = false;
      root.setAttribute('hidden', '');
    },
    isShown: () => shown,
    /** @param {import('../types.js').AudioStatus} s */
    setSoundStatus(s) {
      if (s && typeof s.text === 'string') setText(status, s.text);
    },
    /** @param {import('../types.js').Options} o */
    setOptions(o) {
      options = o || options;
      if (!shown) { select.value = String(options.players || 1); music.checked = Boolean(options.music); }
    },
    /** @param {import('../types.js').Bindings} b */
    setBindings(b) {
      bindings = b || bindings;
      setText(keys, keyHintText(bindings, touch));
    },
    /** @param {boolean} on the on-screen touch buttons are in use */
    setTouch(on) {
      touch = Boolean(on);
      setText(keys, keyHintText(bindings, touch));
    },
    elements: { card, select, music, btnSound, btnSilent, btnLocal, btnZip, status, keys },
    dispose() {
      btnSound.removeEventListener('click', onSound);
      btnSilent.removeEventListener('click', onSilent);
      btnLocal.removeEventListener('click', onLocal);
      btnZip.removeEventListener('click', onZip);
      if (card.parentNode) card.parentNode.removeChild(card);
    },
  };
}
