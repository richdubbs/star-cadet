/**
 * src/ui/menus.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.2; SPEC 6.4
 * createMenus({root, doc, actions, local, picker, options, onOpenChange}) -> {setOptions(o), update(view), closeAll(), isOpen(), dispose()}
 *
 * Builds the menu bar (Game / Options / Help) inside `root` (= #menubar):
 *   <ul class="menu-bar" role="menubar"><li class="menu" data-menu="game" role="none"><button class="menu-title" ...>Game</button>
 *     <ul class="menu-items" role="menu" hidden><li role="none"><button class="menu-item" role="menuitem" data-cmd="newGame">...
 * Items, shortcut hints (display only: input.js owns all shortcuts), data-cmd/data-value and states are MENU_MODEL below.
 * Checkboxes (Demo, Full Screen, Sounds, Music) use role=menuitemcheckbox + aria-checked; Select Players and Camera use role=menuitemradio.
 * Behaviour: click opens/closes; while one menu is open, hovering another title switches to it; Escape / outside click / Tab close;
 * ArrowLeft/Right move between menus, ArrowUp/Down/Home/End between items, Enter/Space activate. Handled keys call stopPropagation so the
 * global game shortcuts do not also fire while the keyboard is driving the menu (Enter would otherwise also be "Launch Ball").
 *
 * `actions` are the UIActions of src/types.js. Commands that open UI-owned dialogs (controls, help, about, sound) go to `local` (callbacks of the facade).
 * Option-derived state arrives through setOptions(o), view-derived state through update(view); both touch the DOM only when a value changed.
 * While a menu is open the application pauses the game (a menu is modal, as in the original), so the Pause item keeps the label it had when the
 * menu was opened ("Pause Game" unless the player had paused on purpose); otherwise the player would see "Resume Game", pick it and end up paused.
 * A click outside an open menu only dismisses it: pointerdown is cancelled (no compatibility mouse events) and stopped, so it does not also flick
 * the mouse flipper of the table underneath.
 *
 * ASSUMPTIONS: "Camera" is a labelled radio group inside Options (a flat list instead of a nested submenu), same for "Select Players";
 * the pause item is disabled when phase is 'idle'; after an item is activated focus leaves the menu bar (so the Space/plunger key cannot
 * re-trigger a focused title button).
 */
import { callAction, h, setAttr, setHidden, setText } from './dom.js';

/**
 * @typedef {{cmd:string, label:string, key?:string, type?:'checkbox'|'radio', value?:string}} MenuItemSpec
 * @typedef {{sep:true}|{heading:string}|MenuItemSpec} MenuEntry
 */

/** The three menus. `key` is only a shortcut hint. @type {ReadonlyArray<{id:string, label:string, items:ReadonlyArray<MenuEntry>}>} */
export const MENU_MODEL = Object.freeze([
  {
    id: 'game', label: 'Game', items: [
      { cmd: 'newGame', label: 'New Game', key: 'F2' },
      { cmd: 'launchBall', label: 'Launch Ball', key: 'Enter' },
      { cmd: 'pause', label: 'Pause Game', key: 'F3' },
      { sep: true },
      { cmd: 'highScores', label: 'High Scores...' },
      { cmd: 'demo', label: 'Demo', type: 'checkbox' },
      { sep: true },
      { cmd: 'exit', label: 'Exit' },
    ],
  },
  {
    id: 'options', label: 'Options', items: [
      { cmd: 'fullscreen', label: 'Full Screen', key: 'F4', type: 'checkbox' },
      { sep: true },
      { heading: 'Select Players' },
      { cmd: 'players', value: '1', label: '1 Player', type: 'radio' },
      { cmd: 'players', value: '2', label: '2 Players', type: 'radio' },
      { cmd: 'players', value: '3', label: '3 Players', type: 'radio' },
      { cmd: 'players', value: '4', label: '4 Players', type: 'radio' },
      { sep: true },
      { cmd: 'sounds', label: 'Sounds', key: 'F5', type: 'checkbox' },
      { cmd: 'music', label: 'Music', key: 'F6', type: 'checkbox' },
      { cmd: 'soundDialog', label: 'Sound Status & Volume...' },
      { sep: true },
      { heading: 'Camera' },
      { cmd: 'camera', value: 'original', label: 'Original', key: 'V', type: 'radio' },
      { cmd: 'camera', value: 'top', label: 'Top', type: 'radio' },
      { cmd: 'camera', value: 'orbit', label: 'Orbit', type: 'radio' },
      { sep: true },
      { cmd: 'loadSounds', label: 'Load My Sounds (Folder)...' },
      { cmd: 'loadSoundsZip', label: 'Load My Sounds (Zip)...' },
      { sep: true },
      { cmd: 'controls', label: 'Player Controls...', key: 'F8' },
    ],
  },
  {
    id: 'help', label: 'Help', items: [
      { cmd: 'help', label: 'Help Topics', key: 'F1' },
      { cmd: 'about', label: 'About' },
    ],
  },
]);

/** @param {string} cmd @param {string} [value] @returns {string} key used in the state map */
export function stateKey(cmd, value) {
  return value === undefined ? cmd : cmd + ':' + value;
}

/**
 * Pure: the display state of every menu item for the given options and rules view.
 * @param {import('../types.js').Options} options @param {import('../types.js').RulesView|null} view
 * @returns {Record<string, {enabled:boolean, checked?:boolean, label?:string}>}
 */
export function computeMenuState(options, view) {
  const o = options || /** @type {any} */ ({});
  const v = view || /** @type {any} */ ({});
  /** @type {Record<string, {enabled:boolean, checked?:boolean, label?:string}>} */
  const s = {
    newGame: { enabled: v.newGameEnabled !== false },
    launchBall: { enabled: Boolean(v.launchEnabled) },
    pause: { enabled: v.phase !== undefined && v.phase !== 'idle', label: v.paused ? 'Resume Game' : 'Pause Game' },
    highScores: { enabled: Boolean(v.highScoresEnabled) },
    demo: { enabled: true, checked: Boolean(v.demo) },
    exit: { enabled: true },
    fullscreen: { enabled: true, checked: Boolean(o.fullscreen) },
    sounds: { enabled: true, checked: Boolean(o.sounds) },
    music: { enabled: true, checked: Boolean(o.music) },
    soundDialog: { enabled: true },
    loadSounds: { enabled: true },
    loadSoundsZip: { enabled: true },
    controls: { enabled: true },
    help: { enabled: true },
    about: { enabled: true },
  };
  for (const n of ['1', '2', '3', '4']) s[stateKey('players', n)] = { enabled: true, checked: String(o.players) === n };
  for (const m of ['original', 'top', 'orbit']) s[stateKey('camera', m)] = { enabled: true, checked: o.camera === m };
  return s;
}

/**
 * @param {{root:any, doc:Document, actions?:any, local?:{controls?:()=>void, help?:()=>void, about?:()=>void, sound?:()=>void},
 *          picker?:{pickFolder:()=>void, pickFiles:()=>void}, options?:import('../types.js').Options, onOpenChange?:(open:boolean)=>void}} opts
 */
export function createMenus(opts) {
  const { root, doc, actions = {}, local = {}, picker = null, onOpenChange } = opts;
  let options = opts.options || /** @type {any} */ ({});
  /** @type {any} */
  let view = null;
  /** @type {number} index of the open menu, -1 = none */
  let openIndex = -1;
  /** the rules' paused flag when the open menu was opened (null while no menu is open); drives the Pause / Resume label */
  let pausedAtOpen = null;
  /** last view fields applied (update() skips the work while they are unchanged) */
  const seen = { phase: undefined, paused: undefined, launch: undefined, scores: undefined, demo: undefined, newGame: undefined };

  /** @type {Array<{title:any, list:any}>} */
  const menus = [];
  /** @type {Array<{btn:any, spec:MenuItemSpec, labelEl:any, key:string, enabled:boolean|null, checked:boolean|null, label:string|null, menu:number}>} */
  const items = [];

  const bar = h(doc, 'ul', { class: 'menu-bar', role: 'menubar' });
  MENU_MODEL.forEach((menu, mi) => {
    const title = h(doc, 'button', {
      class: 'menu-title', type: 'button', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-menu-title': menu.id, text: menu.label,
    });
    const list = h(doc, 'ul', { class: 'menu-items', role: 'menu', 'aria-label': menu.label, hidden: true });
    for (const entry of menu.items) {
      if ('sep' in entry) { list.appendChild(h(doc, 'li', { class: 'menu-sep', role: 'separator' })); continue; }
      if ('heading' in entry) { list.appendChild(h(doc, 'li', { class: 'menu-heading', role: 'presentation', text: entry.heading })); continue; }
      const role = entry.type === 'checkbox' ? 'menuitemcheckbox' : entry.type === 'radio' ? 'menuitemradio' : 'menuitem';
      const labelEl = h(doc, 'span', { class: 'mi-label', text: entry.label });
      const btn = h(doc, 'button', {
        class: 'menu-item', type: 'button', role, tabindex: '-1', 'data-cmd': entry.cmd, 'data-value': entry.value,
        'aria-checked': entry.type ? 'false' : null,
      }, labelEl, entry.key ? h(doc, 'kbd', { text: entry.key }) : null);
      list.appendChild(h(doc, 'li', { role: 'none' }, btn));
      items.push({ btn, spec: entry, labelEl, key: stateKey(entry.cmd, entry.value), enabled: null, checked: null, label: null, menu: mi });
    }
    bar.appendChild(h(doc, 'li', { class: 'menu', 'data-menu': menu.id, role: 'none' }, title, list));
    menus.push({ title, list });
  });
  root.appendChild(bar);

  // ---------------------------------------------------------------------------------------------------------------- state
  function applyState() {
    const state = computeMenuState(options, view && pausedAtOpen !== null ? { ...view, paused: pausedAtOpen } : view);
    for (const it of items) {
      const st = state[it.key];
      if (!st) continue;
      if (it.enabled !== st.enabled) {
        it.enabled = st.enabled;
        it.btn.disabled = !st.enabled;
        setAttr(it.btn, 'aria-disabled', st.enabled ? 'false' : 'true');
      }
      if (st.checked !== undefined && it.checked !== st.checked) {
        it.checked = st.checked;
        setAttr(it.btn, 'aria-checked', st.checked ? 'true' : 'false');
      }
      if (st.label !== undefined && it.label !== st.label) {
        it.label = st.label;
        setText(it.labelEl, st.label);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- open / close
  function setOpen(index) {
    if (index === openIndex) return;
    const wasOpen = openIndex >= 0;
    if (openIndex >= 0) {
      setHidden(menus[openIndex].list, true);
      setAttr(menus[openIndex].title, 'aria-expanded', 'false');
    }
    openIndex = index;
    if (index >= 0) {
      setHidden(menus[index].list, false);
      setAttr(menus[index].title, 'aria-expanded', 'true');
    }
    if (wasOpen !== index >= 0) {
      pausedAtOpen = index >= 0 ? Boolean(view && view.paused) : null;
      if (index < 0) applyState();                      // the real pause state is shown again
    }
    if (typeof onOpenChange === 'function' && wasOpen !== index >= 0) onOpenChange(index >= 0);
  }

  function enabledItemsOf(mi) {
    return items.filter((it) => it.menu === mi && !it.btn.disabled);
  }

  function focusItem(it) {
    if (it) it.btn.focus();
  }

  /** Leave the menu bar: close and make sure no menu button keeps keyboard focus (Space is the plunger key). */
  function closeAndBlur() {
    const hadFocus = Boolean(doc.activeElement && bar.contains && bar.contains(doc.activeElement));
    setOpen(-1);
    if (hadFocus && doc.activeElement && typeof doc.activeElement.blur === 'function') doc.activeElement.blur();
  }

  // ---------------------------------------------------------------------------------------------------------------- commands
  /** @param {MenuItemSpec} spec */
  function run(spec) {
    switch (spec.cmd) {
      case 'newGame': callAction(actions, 'newGame'); break;
      case 'launchBall': callAction(actions, 'launchBall'); break;
      case 'pause': callAction(actions, 'togglePause'); break;
      case 'highScores': callAction(actions, 'showHighScores'); break;
      case 'demo': callAction(actions, 'toggleDemo'); break;
      case 'exit': callAction(actions, 'exit'); break;
      case 'fullscreen': callAction(actions, 'toggleFullscreen'); break;
      case 'players': callAction(actions, 'selectPlayers', Number(spec.value)); break;
      case 'sounds': callAction(actions, 'setSounds', !options.sounds); break;
      case 'music': callAction(actions, 'setMusic', !options.music); break;
      case 'camera': callAction(actions, 'setCamera', spec.value); break;
      case 'loadSounds': if (picker) picker.pickFolder(); break;
      case 'loadSoundsZip': if (picker) picker.pickFiles(); break;
      case 'soundDialog': if (local.sound) local.sound(); break;
      case 'controls': if (local.controls) local.controls(); break;
      case 'help': if (local.help) local.help(); break;
      case 'about': if (local.about) local.about(); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- events
  /** @type {Array<()=>void>} */
  const cleanups = [];
  const listen = (target, type, fn, capture = false) => {
    target.addEventListener(type, fn, capture);
    cleanups.push(() => target.removeEventListener(type, fn, capture));
  };

  menus.forEach((m, mi) => {
    listen(m.title, 'click', () => {
      if (openIndex === mi) closeAndBlur(); else { setOpen(mi); }
    });
    listen(m.title, 'pointerenter', (e) => {
      if (openIndex >= 0 && openIndex !== mi && (!e || e.pointerType !== 'touch')) setOpen(mi);
    });
  });
  for (const it of items) {
    listen(it.btn, 'click', (e) => {
      if (it.btn.disabled) { if (e && e.preventDefault) e.preventDefault(); return; }
      closeAndBlur();
      run(it.spec);
    });
  }

  // outside click closes - and is consumed (text fields / selects keep their normal behaviour); the click event itself still fires
  listen(doc, 'pointerdown', (e) => {
    if (openIndex < 0) return;
    const t = e && e.target;
    if (t && bar.contains && bar.contains(t)) return;
    setOpen(-1);
    const tag = String((t && t.tagName) || '').toLowerCase();
    if (e && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
  }, true);
  // keyboard focus leaving the bar closes the menu
  listen(bar, 'focusout', (e) => {
    if (openIndex < 0) return;
    const next = e && e.relatedTarget;
    if (next && bar.contains && bar.contains(next)) return;
    if (next === null || next === undefined) return;      // focus lost to the window (blur) or to nothing: keep state, pointerdown handles clicks
    setOpen(-1);
  });

  listen(bar, 'keydown', (e) => {
    const key = e.key;
    const target = e.target;
    const titleIndex = menus.findIndex((m) => m.title === target);
    const item = items.find((it) => it.btn === target);
    const mi = titleIndex >= 0 ? titleIndex : item ? item.menu : -1;
    if (mi < 0) return;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if (key === 'Escape') {
      // close AND leave the bar: a focused title would swallow Space / Enter, which are the plunger and Launch Ball keys
      if (openIndex >= 0) { handled(); closeAndBlur(); }
      return;
    }
    if (key === 'Tab') { setOpen(-1); return; }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      handled();
      const next = (mi + (key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length;
      const keepOpen = openIndex >= 0;
      if (keepOpen) setOpen(next);
      if (item && keepOpen) focusItem(enabledItemsOf(next)[0]); else menus[next].title.focus();
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      handled();
      if (titleIndex >= 0) {
        setOpen(mi);
        const list = enabledItemsOf(mi);
        focusItem(key === 'ArrowDown' ? list[0] : list[list.length - 1]);
      } else {
        const list = enabledItemsOf(mi);
        const at = list.indexOf(item);
        focusItem(list[(at + (key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]);
      }
      return;
    }
    if ((key === 'Home' || key === 'End') && item) {
      handled();
      const list = enabledItemsOf(mi);
      focusItem(key === 'Home' ? list[0] : list[list.length - 1]);
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      handled();
      if (titleIndex >= 0) {
        if (openIndex === mi) closeAndBlur();
        else { setOpen(mi); focusItem(enabledItemsOf(mi)[0]); }
      } else if (item && !item.btn.disabled) {
        closeAndBlur();
        run(item.spec);
      }
    }
  });

  // Space activates a focused button on key UP in some browsers: swallow it for the menu buttons (Space is the plunger key)
  listen(bar, 'keyup', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); e.stopPropagation(); }
  });

  applyState();

  return {
    /** Refresh the option-derived checks (sounds, music, fullscreen, players, camera). @param {import('../types.js').Options} o */
    setOptions(o) {
      options = o || options;
      applyState();
    },
    /** Refresh the view-derived states (launch, pause label, high scores, demo); a no-op while those fields are unchanged. @param {import('../types.js').RulesView} v */
    update(v) {
      view = v;
      if (!v) return;
      if (v.phase === seen.phase && v.paused === seen.paused && v.launchEnabled === seen.launch && v.highScoresEnabled === seen.scores
        && v.demo === seen.demo && v.newGameEnabled === seen.newGame) return;
      seen.phase = v.phase; seen.paused = v.paused; seen.launch = v.launchEnabled; seen.scores = v.highScoresEnabled;
      seen.demo = v.demo; seen.newGame = v.newGameEnabled;
      applyState();
    },
    closeAll() { setOpen(-1); },
    isOpen: () => openIndex >= 0,
    /** Elements for tests / the facade. */
    elements: { bar, titles: menus.map((m) => m.title), lists: menus.map((m) => m.list), items: items.map((it) => it.btn) },
    dispose() {
      for (const fn of cleanups.splice(0)) fn();
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    },
  };
}
