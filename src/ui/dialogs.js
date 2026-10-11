/**
 * src/ui/dialogs.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.4; SPEC 6.5 / 6.6
 * createDialogs({root, doc, actions, onChange, getBindings, onBindings, getOptions, getSoundStatus, picker, toast, data}) ->
 *     {showHighScores(entries, {clearable}), promptName(p), showControls(bindings), showSound(), updateSound(status), showAbout(), showHelp(), showConfirm(o),
 *      isOpen(), count(), topId(), closeById(id), closeAll(), dispose()}
 *
 * Modal dialogs inside `root` (= #dialog-root): a `.dialog-backdrop` (dims the page, direct child of the root) holding a
 * `.dialog[role=dialog][aria-modal=true]` with the frozen ids dlg-highscores, dlg-name, dlg-controls, dlg-about, dlg-help (+ dlg-confirm).
 * Keyboard: Esc = cancel, Enter = OK (when focus is not on another button), Tab / Shift+Tab are trapped inside the topmost dialog,
 * keydown events aimed at a dialog never reach the game's global shortcuts. Focus moves into the dialog on open and returns to the previously
 * focused element on close. onChange(open) fires only when the number of open dialogs goes 0 -> 1 (true) or 1 -> 0 (false).
 *
 *   dlg-highscores : "High Scores", table Rank / Name / Score (commas via formatHighScore, empty slot blank), OK, and Clear when `clearable`
 *                    (confirm dialog "Clear High Scores?" titled "Confirm" -> actions.clearHighScores()).
 *   dlg-name       : "Player N - new high score #k", text input maxlength 31 (default p.defaultName); OK -> actions.submitName(name),
 *                    Cancel / Esc -> actions.submitName(null). An empty field submits the default name.
 *   dlg-controls   : "Player Controls", group "Control Options" with six key pickers (click one, then press a key: KeyboardEvent.code),
 *                    Default (Z, /, Space, X, ., Up Arrow), group "Instructions", OK -> actions.setBindings(b), Cancel.
 *                    Reserved keys (Escape, Enter, F1-F6, F8, V: the global shortcuts) are refused; a key already used by another action is swapped.
 *   dlg-sound      : "Sound": live AudioStatus text (+ progress bar while loading), the consent line, a volume slider (actions.setVolume(0..1)) and the
 *                    buttons "Load my Pinball folder..." / "Load a zip or sound files..." (the file pickers; they do not start the game). updateSound(status)
 *                    keeps an open dialog current.
 *   dlg-about / dlg-help : static texts (fan-replica notice; short instructions without cheats).
 *
 * closeAll() closes silently (no action callbacks). Re-opening a dialog that is already open replaces it.
 * ASSUMPTIONS: the dialog heading "Player Controls" follows ARCHITECTURE.md 8.4 (SPEC 6.5 prints it as "3D Pinball: Player Controls");
 * the Clear confirmation uses OK / Cancel buttons.
 */
import { DEFAULT_KEYS } from '../data/constants.js';
import { APP_TITLE } from '../data/text.js';
import { BINDING_ACTIONS } from './storage.js';
import { callAction, clearChildren, focusableIn, h } from './dom.js';
import { formatHighScore } from './format.js';
import { keyLabel } from './keylabels.js';
import { CONSENT_TEXT } from './overlay.js';

/** Labels of the six pickers, in dialog order (SPEC 6.5). */
export const ACTION_LABELS = Object.freeze({
  flipperLeft: 'Left Flipper', flipperRight: 'Right Flipper', plunger: 'Plunger',
  nudgeLeft: 'Left Table Bump', nudgeRight: 'Right Table Bump', nudgeBottom: 'Bottom Table Bump',
});

/** KeyboardEvent.code values that belong to the global shortcuts of input.js and cannot be bound to a game action. */
export const RESERVED_KEYS = Object.freeze(['Escape', 'Enter', 'NumpadEnter', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F8', 'KeyV', 'Tab']);

/**
 * Pure: bind `code` to `action`. A key already used by another action is swapped onto the previous key of `action`.
 * @param {import('../types.js').Bindings} bindings  not mutated
 * @param {string} action @param {string} code
 * @returns {{bindings:import('../types.js').Bindings, status:'ok'|'same'|'swapped'|'reserved'|'invalid', swappedWith?:string}}
 */
export function assignBinding(bindings, action, code) {
  if (!BINDING_ACTIONS.includes(action)) return { bindings: { ...bindings }, status: 'invalid' };
  if (typeof code !== 'string' || code === '' || code === 'Unidentified') return { bindings: { ...bindings }, status: 'invalid' };
  if (RESERVED_KEYS.includes(code)) return { bindings: { ...bindings }, status: 'reserved' };
  const next = { ...bindings };
  if (next[action] === code) return { bindings: next, status: 'same' };
  const other = BINDING_ACTIONS.find((a) => a !== action && next[a] === code);
  if (other) {
    next[other] = next[action];
    next[action] = code;
    return { bindings: next, status: 'swapped', swappedWith: other };
  }
  next[action] = code;
  return { bindings: next, status: 'ok' };
}

/**
 * Paragraphs of the About dialog: fan-replica notice, original artwork, sounds policy, credits.
 * @param {string} title @returns {string[]}
 */
export function aboutParagraphs(title) {
  return [
    `${title} is an unofficial, fan-made pinball game inspired by the classic pinball table that shipped with Windows. `
      + 'It is not affiliated with, endorsed by or sponsored by Microsoft, Cinematronics or Maxis.',
    'The 3D table, all artwork, the lettering and the program code are original work made for this project; no bitmaps or code of the original game are used.',
    'The original sound files are not included. If you choose to play with sound they are fetched into your browser from the Internet Archive, '
      + 'or loaded from your own Pinball folder; they remain copyright Microsoft/Cinematronics.',
    'Built with plain JavaScript and Three.js (MIT licence). Options, key bindings and high scores are stored only in this browser.',
  ];
}

/** Text of the "Instructions" group of the controls dialog. */
export const CONTROLS_INSTRUCTIONS = Object.freeze([
  'Hold the plunger key to pull the plunger back, then release it to launch the ball.',
  'Use the flipper keys to hit the ball. A table bump nudges the ball, but too many bumps will tilt the table.',
  'F2 starts a new game, F3 pauses, F8 opens this window. The shortcut keys cannot be reassigned.',
]);

/** @param {any[]} entries @returns {import('../types.js').HighScoreEntry[]} exactly 5 entries (empty slots -999) */
export function normalizeEntries(entries) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const e = Array.isArray(entries) ? entries[i] : null;
    out.push(e && typeof e === 'object'
      ? { name: typeof e.name === 'string' ? e.name : '', score: typeof e.score === 'number' ? e.score : -999 }
      : { name: '', score: -999 });
  }
  return out;
}

/**
 * Sections of the help dialog (original text; cheats are deliberately not listed).
 * @param {import('../types.js').Bindings} b @returns {Array<{heading:string, lines:string[]}>}
 */
export function helpSections(b) {
  const k = (a) => keyLabel((b && b[a]) || DEFAULT_KEYS[a]);
  return [
    {
      heading: 'Keys',
      lines: [
        `Left flipper: ${k('flipperLeft')}     Right flipper: ${k('flipperRight')}`,
        `Plunger: hold ${k('plunger')} to pull the plunger back, release it to launch the ball.`,
        `Table bumps: ${k('nudgeLeft')} (left), ${k('nudgeRight')} (right), ${k('nudgeBottom')} (from below).`,
        'Mouse over the table: left button = left flipper, right button = right flipper, middle button = plunger (not in the Orbit camera, where the mouse moves the view).',
        'F2 New Game, F3 Pause / Resume, F4 Full Screen, F5 Sounds, F6 Music, F8 Player Controls, F1 Help, Enter Launch Ball, V changes the camera.',
      ],
    },
    {
      heading: 'Playing',
      lines: [
        'Launch the ball with the plunger and use the flippers to keep it in play. When the ball drains between the flippers the next ball is fed. Every player gets three balls.',
      ],
    },
    {
      heading: 'Bumping and tilt',
      lines: [
        'A table bump pushes the ball and shakes the table. Bump too often or too hard and the table TILTs: the flippers lock and the ball is lost without a bonus.',
      ],
    },
    {
      heading: 'Missions',
      lines: [
        'Hit the mission targets to select a mission, then shoot the launch ramp to accept it. Complete missions to earn promotions from Cadet up to Fleet Admiral.',
        'Keep an eye on the fuel gauge: if it runs out the mission is aborted. Wormholes, the hyperspace chute, the gravity well and the black hole all pay out.',
      ],
    },
    { heading: 'Touch screens', lines: ['On a phone or tablet use the on-screen buttons around the table, or tap the left / right half of the table for the flippers.'] },
  ];
}

/**
 * @param {{root:any, doc:Document, actions?:any, onChange?:(open:boolean)=>void, getBindings?:()=>import('../types.js').Bindings,
 *          onBindings?:(b:import('../types.js').Bindings)=>void, toast?:(text:string)=>void, data?:any,
 *          getOptions?:()=>import('../types.js').Options, getSoundStatus?:()=>(import('../types.js').AudioStatus|null),
 *          picker?:{pickFolder:()=>void, pickFiles:()=>void}}} opts
 */
export function createDialogs(opts) {
  const { root, doc, actions = {}, onChange, getBindings, onBindings, toast, getOptions, getSoundStatus, picker } = opts;
  const appTitle = (opts.data && opts.data.APP_TITLE) || APP_TITLE;
  const defaults = (opts.data && opts.data.DEFAULT_KEYS) || DEFAULT_KEYS;

  /** @typedef {{id:string, el:any, backdrop:any, restore:any, okBtn:any, ok:()=>void, cancel:()=>void, focusDefault:()=>void,
   *             keyCapture:((e:any)=>boolean)|null, suppressUp:string|null, silent:boolean}} DialogRecord */
  /** @type {DialogRecord[]} */
  const stack = [];
  let listening = false;

  const currentBindings = () => ({ ...defaults, ...((typeof getBindings === 'function' && getBindings()) || {}) });
  const tagOf = (el) => String((el && el.tagName) || '').toLowerCase();

  // ---------------------------------------------------------------------------------------------------------------- keyboard / focus
  function onKeyDown(e) {
    const top = stack[stack.length - 1];
    if (!top) return;
    const inside = Boolean(e.target && top.el.contains && top.el.contains(e.target));
    if (top.keyCapture && top.keyCapture(e)) return;
    if (inside && e.stopPropagation) e.stopPropagation();      // typing in a dialog must never reach the game shortcuts
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        top.cancel();
        break;
      case 'Tab': {
        const list = focusableIn(top.el);
        if (list.length === 0) { e.preventDefault(); if (top.el.focus) top.el.focus(); break; }
        const first = list[0];
        const last = list[list.length - 1];
        const active = doc.activeElement;
        if (!inside || !top.el.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        break;
      }
      case 'Enter': {
        if (e.isComposing) break;                                             // confirming an IME composition, not pressing OK
        const tag = tagOf(e.target);
        if (tag === 'button' || tag === 'textarea' || tag === 'a') break;     // the focused button handles Enter itself
        e.preventDefault();
        e.stopPropagation();
        top.ok();
        break;
      }
      default: break;
    }
  }

  function onKeyUp(e) {
    const top = stack[stack.length - 1];
    if (top && top.suppressUp && e.code === top.suppressUp) {
      top.suppressUp = null;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onFocusIn(e) {
    const top = stack[stack.length - 1];
    if (top && e.target && !top.el.contains(e.target)) top.focusDefault();
  }

  function listen() {
    if (listening) return;
    listening = true;
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('keyup', onKeyUp, true);
    doc.addEventListener('focusin', onFocusIn);
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('focusin', onFocusIn);
  }

  // ---------------------------------------------------------------------------------------------------------------- open / close
  /** @param {DialogRecord} rec */
  function close(rec) {
    const i = stack.indexOf(rec);
    if (i < 0) return;
    stack.splice(i, 1);
    if (rec.backdrop.parentNode) rec.backdrop.parentNode.removeChild(rec.backdrop);
    if (stack.length === 0) {
      unlisten();
      if (rec.restore && typeof rec.restore.focus === 'function') rec.restore.focus();
      if (!rec.silent && typeof onChange === 'function') onChange(false);
    } else if (i === stack.length) {
      stack[stack.length - 1].focusDefault();
    }
  }

  /**
   * @param {{id:string, title:string, className?:string, body:any[], buttons:Array<{label:string, id?:string, primary?:boolean, role?:'ok'|'cancel'|'action', onClick?:()=>void}>,
   *          onOk?:()=>(boolean|void), onCancel?:()=>void, initialFocus?:()=>any}} spec
   * @returns {DialogRecord}
   */
  function open(spec) {
    const existing = stack.find((r) => r.id === spec.id);
    const wasOpen = stack.length > 0;
    if (existing) { existing.silent = true; close(existing); }
    const restore = existing ? existing.restore : doc.activeElement;
    const titleId = spec.id + '-title';
    /** @type {any} */
    const btnEls = spec.buttons.map((b) => h(doc, 'button', {
      class: 'btn' + (b.primary ? ' btn-primary' : ''), type: 'button', id: b.id, 'data-role': b.role || 'action', text: b.label,
    }));
    const el = h(doc, 'div', {
      class: 'dialog' + (spec.className ? ' ' + spec.className : ''), id: spec.id, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1',
    },
    h(doc, 'h2', { class: 'dialog-title', id: titleId, text: spec.title }),
    h(doc, 'div', { class: 'dialog-body' }, spec.body),
    h(doc, 'div', { class: 'dialog-buttons' }, btnEls));
    const backdrop = h(doc, 'div', { class: 'dialog-backdrop', 'data-for': spec.id }, el);
    const okIndex = spec.buttons.findIndex((b) => b.role === 'ok' || b.primary);

    /** @type {DialogRecord} */
    const rec = {
      id: spec.id, el, backdrop, restore, okBtn: okIndex >= 0 ? btnEls[okIndex] : null, keyCapture: null, suppressUp: null, silent: false,
      ok() {
        const keepOpen = spec.onOk ? spec.onOk() === false : false;
        if (!keepOpen) close(rec);
      },
      cancel() {
        if (spec.onCancel) spec.onCancel();
        close(rec);
      },
      focusDefault() {
        const target = (spec.initialFocus && spec.initialFocus()) || rec.okBtn || focusableIn(el)[0] || el;
        if (target && typeof target.focus === 'function') target.focus();
      },
    };
    spec.buttons.forEach((b, i) => {
      btnEls[i].addEventListener('click', () => {
        if (b.role === 'ok') rec.ok();
        else if (b.role === 'cancel') rec.cancel();
        else if (b.onClick) b.onClick();
      });
    });
    stack.push(rec);
    root.appendChild(backdrop);
    listen();
    rec.focusDefault();
    if (!wasOpen && typeof onChange === 'function') onChange(true);
    return rec;
  }

  // ---------------------------------------------------------------------------------------------------------------- dialogs
  /** Generic confirmation. @param {{title?:string, message:string, onOk:()=>void}} o */
  function showConfirm(o) {
    return open({
      id: 'dlg-confirm', title: o.title || 'Confirm', className: 'dialog-small',
      body: [h(doc, 'p', { class: 'dialog-text', text: o.message })],
      buttons: [{ label: 'OK', primary: true, role: 'ok' }, { label: 'Cancel', role: 'cancel' }],
      onOk: () => { o.onOk(); },
    });
  }

  /** @param {import('../types.js').HighScoreEntry[]} entries @param {{clearable?:boolean}} [o] */
  function showHighScores(entries, o = {}) {
    const tbody = h(doc, 'tbody');
    const render = (list) => {
      clearChildren(tbody);
      list.forEach((e, i) => tbody.appendChild(h(doc, 'tr', null,
        h(doc, 'td', { class: 'hs-rank', text: String(i + 1) }),
        h(doc, 'td', { class: 'hs-name', text: e.name }),
        h(doc, 'td', { class: 'hs-score', text: formatHighScore(e.score) }))));
    };
    render(normalizeEntries(entries));
    const table = h(doc, 'table', { class: 'hs-table' },
      h(doc, 'thead', null, h(doc, 'tr', null,
        h(doc, 'th', { scope: 'col', text: 'Rank' }), h(doc, 'th', { scope: 'col', text: 'Name' }), h(doc, 'th', { scope: 'col', text: 'Score' }))),
      tbody);
    const buttons = [{ label: 'OK', primary: true, role: /** @type {'ok'} */ ('ok') }];
    if (o && o.clearable) {
      buttons.push({
        label: 'Clear', id: 'hs-clear', role: /** @type {'action'} */ ('action'),
        onClick: () => showConfirm({
          title: 'Confirm', message: 'Clear High Scores?',
          onOk: () => {
            callAction(actions, 'clearHighScores');
            render(normalizeEntries([]));
            if (typeof toast === 'function') toast('High scores cleared');
          },
        }),
      });
    }
    return open({ id: 'dlg-highscores', title: 'High Scores', className: 'dialog-scores', body: [table], buttons });
  }

  /** @param {import('../types.js').NamePrompt} p */
  function promptName(p) {
    if (!p) return null;
    const existing = stack.find((r) => r.id === 'dlg-name');
    if (existing) return existing;
    const input = h(doc, 'input', {
      id: 'dlg-name-input', class: 'name-input', type: 'text', maxlength: '31', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your name',
    });
    input.value = String(p.defaultName || `Player ${p.player}`);
    const body = [
      h(doc, 'p', { class: 'dialog-text', text: `Score ${formatHighScore(p.score)}. Enter your name:` }),
      input,
    ];
    const rec = open({
      id: 'dlg-name', title: `Player ${p.player} - new high score #${p.rank}`, className: 'dialog-small', body,
      buttons: [{ label: 'OK', primary: true, role: 'ok' }, { label: 'Cancel', role: 'cancel' }],
      initialFocus: () => input,
      onOk: () => {
        const name = String(input.value || '').trim().slice(0, 31);
        callAction(actions, 'submitName', name || String(p.defaultName || `Player ${p.player}`));
      },
      onCancel: () => { callAction(actions, 'submitName', null); },
    });
    if (typeof input.select === 'function') input.select();      // the default name is replaced by simply typing
    return rec;
  }

  /** @param {import('../types.js').Bindings} [initial] */
  function showControls(initial) {
    let working = { ...defaults, ...(initial || currentBindings()) };
    /** @type {string|null} */
    let armed = null;
    const hint = h(doc, 'p', { class: 'controls-hint', id: 'controls-hint', role: 'status', 'aria-live': 'polite' });
    /** @type {Record<string, any>} */
    const pickers = {};
    const rows = BINDING_ACTIONS.map((a) => {
      const btn = h(doc, 'button', { class: 'key-picker', type: 'button', 'data-action': a, 'aria-pressed': 'false' });
      pickers[a] = btn;
      btn.addEventListener('click', () => { armed = a; hint.textContent = `Press the key for ${ACTION_LABELS[a]} (Esc cancels).`; refresh(); });
      return h(doc, 'div', { class: 'controls-row' }, h(doc, 'span', { class: 'controls-label', text: ACTION_LABELS[a] }), btn);
    });
    function refresh() {
      for (const a of BINDING_ACTIONS) {
        const on = armed === a;
        pickers[a].textContent = on ? 'Press a key...' : keyLabel(working[a]);
        pickers[a].className = 'key-picker' + (on ? ' is-armed' : '');
        pickers[a].setAttribute('aria-pressed', on ? 'true' : 'false');
        pickers[a].setAttribute('aria-label', `${ACTION_LABELS[a]}: ${keyLabel(working[a])}`);
      }
    }
    refresh();
    const instructions = CONTROLS_INSTRUCTIONS;
    const body = [
      h(doc, 'fieldset', { class: 'controls-group' }, h(doc, 'legend', { text: 'Control Options' }), rows,
        h(doc, 'div', { class: 'controls-defaults' }, h(doc, 'button', {
          class: 'btn', type: 'button', id: 'controls-default', text: 'Default',
          onclick: () => { working = { ...defaults }; armed = null; hint.textContent = ''; refresh(); },
        })), hint),
      h(doc, 'fieldset', { class: 'controls-group' }, h(doc, 'legend', { text: 'Instructions' }),
        h(doc, 'p', { class: 'dialog-text', text: 'Click a key button, then press the key you want to use.' }),
        instructions.map((t) => h(doc, 'p', { class: 'dialog-text', text: t }))),
    ];
    const rec = open({
      id: 'dlg-controls', title: 'Player Controls', className: 'dialog-wide', body,
      buttons: [{ label: 'OK', primary: true, role: 'ok' }, { label: 'Cancel', role: 'cancel' }],
      initialFocus: () => pickers.flipperLeft,
      onOk: () => {
        const b = { ...working };
        if (typeof onBindings === 'function') onBindings(b);
        callAction(actions, 'setBindings', b);
        if (typeof toast === 'function') toast('Controls saved');
      },
    });
    rec.keyCapture = (e) => {
      if (armed === null) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return true;
      if (e.code === 'Escape' || e.key === 'Escape') { armed = null; hint.textContent = ''; refresh(); return true; }
      const action = armed;
      const res = assignBinding(working, action, e.code);
      if (res.status === 'reserved') { hint.textContent = `${keyLabel(e.code)} is reserved for the game's shortcuts. Pick another key.`; return true; }
      if (res.status === 'invalid') { hint.textContent = 'That key cannot be used. Pick another key.'; return true; }
      working = res.bindings;
      hint.textContent = res.status === 'swapped' ? `Swapped with ${ACTION_LABELS[res.swappedWith || '']}.` : '';
      armed = null;
      rec.suppressUp = e.code;
      refresh();
      pickers[action].focus();
      return true;
    };
    return rec;
  }

  /** @type {((s:any)=>void)|null} refresher of the open sound dialog */
  let soundRefresh = null;

  function showSound() {
    const statusEl = h(doc, 'p', { id: 'sound-dlg-status', class: 'sound-dlg-status', role: 'status', 'aria-live': 'polite' });
    const progress = h(doc, 'progress', { id: 'sound-dlg-progress', class: 'sound-progress', max: '1', value: 0, hidden: true });
    const opt = (typeof getOptions === 'function' && getOptions()) || {};
    const volume = h(doc, 'input', { id: 'sound-dlg-volume', class: 'sound-volume', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume' });
    volume.value = String(Math.round((typeof opt.volume === 'number' ? opt.volume : 0.8) * 100));
    const volumeText = h(doc, 'span', { class: 'sound-volume-text', text: volume.value + '%' });
    volume.addEventListener('input', () => {
      volumeText.textContent = volume.value + '%';
      callAction(actions, 'setVolume', Math.min(1, Math.max(0, Number(volume.value) / 100)));
    });
    const refresh = (s) => {
      const st = s || { state: 'idle', loaded: 0, total: 0, text: 'sound: not loaded' };
      statusEl.textContent = st.text;
      const loading = st.state === 'loading' && st.total > 0;
      progress.hidden = !loading;
      if (loading) { progress.max = st.total; progress.value = st.loaded; }
    };
    refresh(typeof getSoundStatus === 'function' ? getSoundStatus() : null);
    const rec = open({
      id: 'dlg-sound', title: 'Sound', className: 'dialog-wide',
      body: [
        statusEl, progress,
        h(doc, 'label', { class: 'sound-volume-row', for: 'sound-dlg-volume' }, h(doc, 'span', { text: 'Volume' }), volume, volumeText),
        h(doc, 'p', { class: 'dialog-text sound-dlg-note', text: CONSENT_TEXT }),
        h(doc, 'div', { class: 'sound-dlg-buttons' },
          h(doc, 'button', { class: 'btn', type: 'button', id: 'sound-dlg-folder', text: 'Load my Pinball folder...', onclick: () => { if (picker) picker.pickFolder(); } }),
          h(doc, 'button', { class: 'btn', type: 'button', id: 'sound-dlg-zip', text: 'Load a zip or sound files...', onclick: () => { if (picker) picker.pickFiles(); } })),
      ],
      buttons: [{ label: 'Close', primary: true, role: 'ok' }],
    });
    soundRefresh = refresh;
    return rec;
  }

  function showAbout() {
    return open({
      id: 'dlg-about', title: `About ${appTitle}`, className: 'dialog-wide',
      body: aboutParagraphs(appTitle).map((t) => h(doc, 'p', { class: 'dialog-text', text: t })),
      buttons: [{ label: 'OK', primary: true, role: 'ok' }],
    });
  }

  function showHelp() {
    const sections = helpSections(currentBindings());
    return open({
      id: 'dlg-help', title: 'Help Topics', className: 'dialog-wide',
      body: sections.map((s) => h(doc, 'section', { class: 'help-section' },
        h(doc, 'h3', { class: 'help-heading', text: s.heading }), s.lines.map((t) => h(doc, 'p', { class: 'dialog-text', text: t })))),
      buttons: [{ label: 'OK', primary: true, role: 'ok' }],
    });
  }

  return {
    showHighScores, promptName, showControls, showSound, showAbout, showHelp, showConfirm,
    /** Push a new AudioStatus into an open sound dialog (no-op when it is closed). */
    updateSound(status) { if (soundRefresh && stack.some((r) => r.id === 'dlg-sound')) soundRefresh(status); },
    /** Close one dialog by id without calling any action (onChange still fires when it was the last one). @param {string} id */
    closeById(id) { const rec = stack.find((r) => r.id === id); if (rec) close(rec); },
    isOpen: () => stack.length > 0,
    count: () => stack.length,
    topId: () => (stack.length ? stack[stack.length - 1].id : null),
    /** Close every dialog without calling any action. */
    closeAll() {
      const wasOpen = stack.length > 0;
      for (const rec of stack.slice().reverse()) { rec.silent = true; close(rec); }
      if (wasOpen && typeof onChange === 'function') onChange(false);
    },
    dispose() {
      for (const rec of stack.slice()) { rec.silent = true; close(rec); }
      unlisten();
    },
  };
}
