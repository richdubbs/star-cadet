/**
 * src/input.js
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 11 (mapping), 8.7 (touch delegation), SPEC 6.5 (controls), 6.9 / 5.10 (cheats, debug keys); type Input (src/types.js)
 *
 * createInput({onEvent, target?, bindings?, doc?}) -> Input.  Turns keyboard, mouse, touch/pen and the on-screen touch buttons into InputEvents
 * ({kind:'game'|'app'|'cheat'|'debug'|'pointer'}).  It decides NOTHING about the game: gating (paused / tilted / demo / phase) is rules.input().
 * Safe to import in Node: nothing touches window / document at import; DOM objects arrive through `opts` (target, doc) or are looked up in attach().
 *
 * Behaviour:
 *  - key repeat is ignored (only the first keydown counts); bound game keys, app keys (F1 F2 F3 F4 F5 F6 F8 Enter V) and bound keys are
 *    preventDefault()ed so the browser never scrolls / reloads / opens help; keys with Ctrl/Meta/Alt are never touched.
 *  - bindings are physical key positions (KeyboardEvent.code); on top of that the DEFAULT letter bindings (Z, X) also answer to the key LABELLED
 *    with that letter (event.key), so the original's "Z" works on QWERTZ / AZERTY / Dvorak keyboards too (a rebound action stays physical only).
 *  - one press "source" per physical origin (key code, mouse button, pointer id): an action is down while at least one source holds it, so
 *    Z + a touch button on the same flipper do not release each other.
 *  - setBlocked(true) (menu / dialog / start overlay open) first RELEASES everything that is held, then swallows every key and pointer
 *    gesture without preventDefault (so dialogs keep their own Enter / Space / Tab behaviour).  Keys typed into INPUT / TEXTAREA / SELECT /
 *    contenteditable elements are ignored the same way, blocked or not.
 *  - cheats: printable characters (event.key, lower-cased; Tab = space) feed a rolling 11-character buffer; a word that is not usable
 *    because a gameplay key was rebound to one of its letters (SPEC 6.9) is skipped.
 *  - mouse over #table-view: button 0 = left flipper, 2 = right flipper, 1 = plunger (unless setMouseButtons(false): then the mouse belongs to
 *    the view - Options > Mouse Rotates View); touch / pen: left half = left flipper, right half = right flipper.  With debug on the same
 *    gestures are emitted as {kind:'pointer'} instead (ball dragging).  The context menu is suppressed over the table.  [data-action] / [data-app] buttons inside #touch-controls are handled by delegation.
 *  - window blur / document hidden => releaseAll().
 *
 * ASSUMPTIONS (gap protocol):
 *  - In debug mode the debug keys H R B S I J Y ALSO feed the cheat buffer (ARCHITECTURE 11.1 says they do not).  Otherwise 'hidden test' (which
 *    contains h, i and s) could never be typed again to leave debug mode.
 *  - Tab is not preventDefault()ed (keyboard users reach the menu bar with it); it only feeds a space to the cheat buffer.
 *  - Mouse buttons use mouse events (a chorded second button fires no pointerdown); touch and pen use pointer events.
 *  - NumpadEnter behaves like Enter (Launch Ball).
 */
import { DEFAULT_KEYS } from './data/constants.js';

/** Cheat words (SPEC 6.9). 'hidden test' may also be typed with a TAB for the space. */
export const CHEAT_WORDS = Object.freeze(['hidden test', 'gmax', '1max', 'bmax', 'rmax', 'easy mode']);

/** Length of the rolling cheat buffer (SPEC 5.10). */
export const CHEAT_BUFFER_LENGTH = 11;

/** KeyboardEvent.code -> application command (ARCHITECTURE 11.1).  Gameplay bindings take precedence. */
export const APP_KEYS = Object.freeze({
  F1: 'help', F2: 'newGame', F3: 'pause', F4: 'fullscreen', F5: 'sounds', F6: 'music', F8: 'controls',
  Enter: 'launchBall', NumpadEnter: 'launchBall', KeyV: 'camera', KeyC: 'cinematic',
});

/** Debug keys (only while debug is on): KeyboardEvent.code -> InputEvent key. */
export const DEBUG_KEYS = Object.freeze({ KeyH: 'H', KeyR: 'R', KeyB: 'B', KeyS: 'S', KeyI: 'I', KeyJ: 'J', KeyY: 'Y' });

const GAME_ACTIONS = Object.freeze(['flipperLeft', 'flipperRight', 'plunger', 'nudgeLeft', 'nudgeRight', 'nudgeBottom']);

/**
 * Rolling-buffer cheat matcher.
 * @param {readonly string[]} [words] defaults to CHEAT_WORDS
 * @returns {{feed:(ch:string)=>string|null, reset:()=>void, buffer:()=>string}} feed(ch) returns the completed word (and clears the buffer) or null
 */
export function createCheatMatcher(words = CHEAT_WORDS) {
  let list = words;
  let buf = '';
  return {
    feed(ch) {
      if (typeof ch !== 'string' || ch.length !== 1) return null;
      buf += ch === '\t' ? ' ' : ch.toLowerCase();
      if (buf.length > CHEAT_BUFFER_LENGTH) buf = buf.slice(buf.length - CHEAT_BUFFER_LENGTH);
      for (const w of list) {
        if (buf.endsWith(w)) { buf = ''; return w; }
      }
      return null;
    },
    reset() { buf = ''; },
    buffer: () => buf,
    /** @param {readonly string[]} next replace the usable word list (the buffer is kept) */
    setWords(next) { list = next; },
  };
}

/** The character a KeyboardEvent.code types on a US layout, for the rebinding rule of SPEC 6.9 (null = not a letter / digit / space). */
function charOfCode(code) {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  return code === 'Space' ? ' ' : null;
}

/**
 * Cheat words that stay usable for the given bindings: a word is dropped when a gameplay key that differs from its default is bound to
 * a letter / digit / space that occurs in the word (SPEC 6.9).
 * @param {Record<string,string>} bindings @returns {string[]}
 */
export function usableCheatWords(bindings) {
  const bad = new Set();
  for (const a of GAME_ACTIONS) {
    if (bindings[a] === DEFAULT_KEYS[a]) continue;
    const ch = charOfCode(bindings[a]);
    if (ch !== null) bad.add(ch);
  }
  return CHEAT_WORDS.filter((w) => ![...bad].some((ch) => w.includes(ch)));
}

/** @param {any} t event target @returns {boolean} a form control that wants the keyboard for itself */
function isTextTarget(t) {
  if (!t || typeof t !== 'object') return false;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

/** @param {Record<string,string>|undefined} b @returns {Record<string,string>} complete bindings (missing / invalid entries from the defaults) */
function normalizeBindings(b) {
  const out = { ...DEFAULT_KEYS };
  if (b && typeof b === 'object') for (const a of GAME_ACTIONS) if (typeof b[a] === 'string' && b[a]) out[a] = b[a];
  return out;
}

/** @param {import('./types.js').CreateInputOpts} opts @returns {import('./types.js').Input} */
export function createInput(opts) {
  if (!opts || typeof opts.onEvent !== 'function') throw new TypeError('createInput: opts.onEvent is required');
  const emit = opts.onEvent;
  const target = opts.target || (typeof window !== 'undefined' ? window : null);
  const doc = opts.doc || (target && target.document) || (typeof document !== 'undefined' ? document : null);

  let bindings = normalizeBindings(opts.bindings);
  /** @type {Map<string,string>} KeyboardEvent.code -> game action */
  let codeToAction = new Map();
  /**
   * lower-case letter -> game action, for the DEFAULT letter bindings only: the key LABELLED Z / X must work on every keyboard layout (as in the
   * original, which read the virtual key), while the bindings themselves are physical positions (KeyboardEvent.code). On a QWERTZ / AZERTY /
   * Dvorak keyboard the labelled "Z" is not at the physical KeyZ position, so a key press whose code is bound to nothing falls back to this map.
   * @type {Map<string,string>}
   */
  let letterToAction = new Map();
  const matcher = createCheatMatcher();
  const rebuild = () => {
    codeToAction = new Map();
    letterToAction = new Map();
    for (const a of GAME_ACTIONS) {
      codeToAction.set(bindings[a], a);
      if (bindings[a] === DEFAULT_KEYS[a] && /^Key[A-Z]$/.test(bindings[a])) letterToAction.set(bindings[a].slice(3).toLowerCase(), a);
    }
    matcher.setWords(usableCheatWords(bindings));
  };
  rebuild();

  let blocked = false;
  let debug = false;
  let pointerFlippers = true;
  let mouseButtons = true;
  let attached = false;
  /** @type {Record<string, Set<string>>} action -> sources currently holding it */
  const held = {};
  for (const a of GAME_ACTIONS) held[a] = new Set();
  /** @type {Map<string,string>} source id -> action (pointers, touch buttons, keys) */
  const sourceAction = new Map();
  /** key codes whose keydown was accepted and whose keyup has not arrived yet */
  const heldKeys = new Set();
  /** debug drag in progress: source id or null */
  let dragSource = null;
  let dragButton = 0;

  let tableEl = null;
  let touchEl = null;
  /** @type {Array<[any,string,Function,any?]>} registered listeners, for detach() */
  const registered = [];
  const on = (el, type, fn, o) => {
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener(type, fn, o);
    registered.push([el, type, fn, o]);
  };

  // ---- press / release with source accounting ---------------------------------------------------------------------------------------
  function press(action, src) {
    if (sourceAction.has(src)) return;
    sourceAction.set(src, action);
    const set = held[action];
    const wasDown = set.size > 0;
    set.add(src);
    if (!wasDown) emit({ kind: 'game', action: /** @type {any} */ (action), down: true });
  }
  function release(src) {
    const action = sourceAction.get(src);
    if (action === undefined) return false;
    sourceAction.delete(src);
    const set = held[action];
    set.delete(src);
    if (set.size === 0) emit({ kind: 'game', action: /** @type {any} */ (action), down: false });
    return true;
  }
  function endDrag() {
    if (dragSource === null) return;
    dragSource = null;
    emit({ kind: 'pointer', phase: 'up', clientX: 0, clientY: 0, button: dragButton });
  }
  function releaseAll() {
    for (const src of [...sourceAction.keys()]) release(src);
    endDrag();
    heldKeys.clear();
  }
  // ---- keyboard -----------------------------------------------------------------------------------------------------------------------
  function onKeyDown(e) {
    if (blocked) return;
    if (isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const code = e.code;
    let action = codeToAction.get(code);
    if (!action && letterToAction.size && typeof e.key === 'string' && e.key.length === 1) action = letterToAction.get(e.key.toLowerCase());
    if (action) {
      e.preventDefault();
      if (!e.repeat && !heldKeys.has(code)) {
        heldKeys.add(code);
        press(action, 'k:' + code);
      }
    } else if (Object.prototype.hasOwnProperty.call(APP_KEYS, code)) {
      e.preventDefault();
      if (!e.repeat) emit({ kind: 'app', action: /** @type {any} */ (APP_KEYS[code]) });
    } else if (debug && Object.prototype.hasOwnProperty.call(DEBUG_KEYS, code)) {
      e.preventDefault();
      if (!e.repeat) emit({ kind: 'debug', key: /** @type {any} */ (DEBUG_KEYS[code]) });
    }
    if (e.repeat) return;
    // typed characters feed the cheat buffer (bound game keys too: 'x' is also the left nudge, as in the original)
    const key = e.key;
    const ch = key === 'Tab' ? '\t' : (typeof key === 'string' && key.length === 1 ? key : null);
    if (ch !== null) {
      const word = matcher.feed(ch);
      if (word !== null) emit({ kind: 'cheat', word: /** @type {any} */ (word) });
    }
  }

  function onKeyUp(e) {
    const code = e.code;
    if (!heldKeys.has(code)) return;
    heldKeys.delete(code);
    release('k:' + code);
    if (!blocked && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
  }

  // ---- mouse / touch over the table --------------------------------------------------------------------------------------------------
  const MOUSE_ACTION = { 0: 'flipperLeft', 1: 'plunger', 2: 'flipperRight' };

  function blurActive() {
    try {
      const a = doc && doc.activeElement;
      if (a && a !== doc.body && typeof a.blur === 'function') a.blur();
    } catch { /* focus handling is best effort */ }
  }

  function onMouseDown(e) {
    if (blocked) return;
    if (e.preventDefault) e.preventDefault();
    blurActive();
    if (debug) {
      if (dragSource === null && e.button === 0) {
        dragSource = 'm:' + e.button;
        dragButton = e.button;
        emit({ kind: 'pointer', phase: 'down', clientX: e.clientX, clientY: e.clientY, button: e.button });
      }
      return;
    }
    if (!pointerFlippers || !mouseButtons) return;
    const action = MOUSE_ACTION[e.button];
    if (action) press(action, 'm:' + e.button);
  }
  function onMouseMove(e) {
    if (dragSource !== null && dragSource.startsWith('m:')) emit({ kind: 'pointer', phase: 'move', clientX: e.clientX, clientY: e.clientY, button: dragButton });
  }
  function onMouseUp(e) {
    if (dragSource === 'm:' + e.button) {
      dragSource = null;
      emit({ kind: 'pointer', phase: 'up', clientX: e.clientX, clientY: e.clientY, button: e.button });
    }
    release('m:' + e.button);
  }

  function halfAction(e) {
    const r = tableEl && typeof tableEl.getBoundingClientRect === 'function' ? tableEl.getBoundingClientRect() : null;
    const mid = r ? r.left + r.width / 2 : 0;
    return e.clientX < mid ? 'flipperLeft' : 'flipperRight';
  }
  function onTablePointerDown(e) {
    if (e.pointerType === 'mouse' || blocked) return;
    if (e.preventDefault) e.preventDefault();
    blurActive();
    if (debug) {
      if (dragSource === null) {
        dragSource = 'p:' + e.pointerId;
        dragButton = 0;
        emit({ kind: 'pointer', phase: 'down', clientX: e.clientX, clientY: e.clientY, button: 0 });
      }
      return;
    }
    if (pointerFlippers) press(halfAction(e), 'p:' + e.pointerId);
  }
  function onPointerMove(e) {
    if (dragSource === 'p:' + e.pointerId) emit({ kind: 'pointer', phase: 'move', clientX: e.clientX, clientY: e.clientY, button: 0 });
  }
  function onPointerEnd(e) {
    const id = e.pointerId;
    if (e.pointerType === 'mouse') {
      // the table is driven by mouse EVENTS (onMouseUp), but a mouse pressing an on-screen touch button (?touch=1, hybrid devices) is a
      // pointer 't:<id>' source: its pointerup must release it, otherwise the flipper stays up until the pointer leaves the button
      release('t:' + id);
      return;
    }
    if (dragSource === 'p:' + id) {
      dragSource = null;
      emit({ kind: 'pointer', phase: 'up', clientX: e.clientX, clientY: e.clientY, button: 0 });
    }
    release('p:' + id);
    release('t:' + id);
  }
  function onContextMenu(e) {
    if (e.preventDefault) e.preventDefault();
  }

  // ---- touch buttons (delegated, ARCHITECTURE 8.7) -------------------------------------------------------------------------------------
  function buttonOf(e) {
    const t = e.target;
    return t && typeof t.closest === 'function' ? t.closest('[data-action],[data-app]') : null;
  }
  function onTouchDown(e) {
    const btn = buttonOf(e);
    if (!btn || blocked) return;
    if (e.preventDefault) e.preventDefault();
    blurActive();
    const app = btn.getAttribute && btn.getAttribute('data-app');
    if (app) { emit({ kind: 'app', action: /** @type {any} */ (app) }); return; }
    const action = btn.getAttribute && btn.getAttribute('data-action');
    if (action && Object.prototype.hasOwnProperty.call(held, action)) press(action, 't:' + e.pointerId);
  }
  function onTouchOut(e) {
    // a mouse dragged off a button releases it (touch pointers are implicitly captured and never "leave")
    if (e.pointerType !== 'mouse') return;
    const btn = buttonOf(e);
    if (!btn) return;
    if (e.relatedTarget && typeof btn.contains === 'function' && btn.contains(e.relatedTarget)) return;
    release('t:' + e.pointerId);
  }

  // ---- focus ----------------------------------------------------------------------------------------------------------------------------
  // `opts.onFocusLoss` runs BEFORE the keys are let go: the shell uses it to drop a pulled plunger without firing it (the key-up that releaseAll()
  // sends would otherwise launch the ball at whatever power was reached).
  const onBlur = () => { if (typeof opts.onFocusLoss === 'function') opts.onFocusLoss(); releaseAll(); matcher.reset(); };
  const onVisibility = () => { if (doc && doc.hidden) onBlur(); };

  // ---- public surface -----------------------------------------------------------------------------------------------------------------------
  return {
    attach() {
      if (attached) return;
      attached = true;
      tableEl = doc && typeof doc.getElementById === 'function' ? doc.getElementById('table-view') : null;
      touchEl = doc && typeof doc.getElementById === 'function' ? doc.getElementById('touch-controls') : null;
      on(target, 'keydown', onKeyDown);
      on(target, 'keyup', onKeyUp);
      on(target, 'blur', onBlur);
      on(doc, 'visibilitychange', onVisibility);
      on(tableEl, 'mousedown', onMouseDown);
      on(tableEl, 'pointerdown', onTablePointerDown);
      on(tableEl, 'contextmenu', onContextMenu);
      on(target, 'mouseup', onMouseUp);
      on(target, 'mousemove', onMouseMove);
      on(target, 'pointermove', onPointerMove);
      on(target, 'pointerup', onPointerEnd);
      on(target, 'pointercancel', onPointerEnd);
      on(touchEl, 'pointerdown', onTouchDown);
      on(touchEl, 'pointerout', onTouchOut);
      on(touchEl, 'contextmenu', onContextMenu);
    },
    detach() {
      if (!attached) return;
      releaseAll();
      for (const [el, type, fn, o] of registered.splice(0)) el.removeEventListener(type, fn, o);
      attached = false;
    },
    getBindings: () => ({ ...bindings }),
    setBindings(b) {
      releaseAll();
      bindings = normalizeBindings(b);
      rebuild();
      matcher.reset();
    },
    defaultBindings: () => ({ ...DEFAULT_KEYS }),
    setBlocked(on) {
      const v = !!on;
      if (v === blocked) return;
      if (v) { releaseAll(); matcher.reset(); }
      blocked = v;
    },
    releaseAll,
    setDebug(on) {
      const v = !!on;
      if (v === debug) return;
      if (dragSource !== null) endDrag();
      debug = v;
    },
    setPointerFlippers(on) {
      const v = !!on;
      if (v === pointerFlippers) return;
      pointerFlippers = v;
      if (!v) for (const src of [...sourceAction.keys()]) if (src.startsWith('m:') || src.startsWith('p:')) release(src);
    },
    /** ADDITIVE: mouse buttons over the table work the flippers / plunger (default true); false = the mouse turns the view instead (touch unaffected). */
    setMouseButtons(on) {
      const v = !!on;
      if (v === mouseButtons) return;
      mouseButtons = v;
      if (!v) for (const src of [...sourceAction.keys()]) if (src.startsWith('m:')) release(src);
    },
    // ---- additive (tests / debugging) ----
    isBlocked: () => blocked,
    isDebug: () => debug,
    getMouseButtons: () => mouseButtons,
    isDown: (action) => Boolean(held[action] && held[action].size > 0),
  };
}
