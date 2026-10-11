/**
 * src/ui/index.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8; type UI / CreateUIOpts (src/types.js)
 * Facade: createUI({root, store, actions, panelArt, options, bindings, onDialogChange, doc, data}) -> UI.
 *
 * Owns the DOM inside the mount points of index.html (ARCHITECTURE.md 8.1), found below `root`:
 *   #menubar (menus.js) | #panel (canvas#panel-canvas 203x394 drawn by panel.js + hidden live region #panel-aria) | #touch-controls (touch.js) |
 *   #start-overlay (overlay.js) | #status-line (span#sound-status, span#fps) | #dialog-root (dialogs.js) | #toast-root (toast.js)
 * plus one extra element, div#pause-overlay inside #stage (pause.js). A missing mount point is created and appended to `root`, so the UI also
 * works on a bare page. Imports only src/data and src/ui; it never sees rules, physics, lamps, render or audio - only RulesView, AudioStatus,
 * Options, Bindings, HighScoreEntry and NamePrompt. Everything the user does goes out through `actions` (UIActions) only.
 *
 * update(view, dt) is called once per animation frame: it repaints the panel only when view.revision changed (and then refreshes #panel-aria),
 * refreshes view-derived menu states only when the relevant fields changed, opens the name dialog when view.namePrompt becomes non-null
 * (once per prompt), shows/hides the pause veil, closes the start overlay if a game starts underneath it (F2) and ticks the toasts.
 *
 * Additive (not in types.js): opts.onMenuChange(open) - called when a menu opens/closes so the application can block game shortcuts while
 * the keyboard drives a menu; ui.showSound() (the Sound dialog: status, progress, volume, load-my-files); ui.getBindings(); ui.elements.
 *
 * The panel canvas resolution follows the panel's on-screen size and devicePixelRatio (ResizeObserver + window resize; panel.setScale), the pause
 * veil is not shown while a menu is open (the application pauses for the open menu, that is not a "Paused" state), and the start card / pause veil
 * show touch wording when the touch buttons are enabled.
 *
 * ASSUMPTIONS: the "Fullscreen" check follows document.fullscreenElement when the Fullscreen API exists (the browser knows better than a stored
 * flag); toasts are timed by the dt passed to update().
 */
import { DEFAULT_KEYS } from '../data/constants.js';
import { callAction, h, setHidden, setText } from './dom.js';
import { createDialogs } from './dialogs.js';
import { createFilePicker } from './filepicker.js';
import { createMenus } from './menus.js';
import { createStartOverlay } from './overlay.js';
import { createPanel, panelHudParts, panelScaleFor } from './panel.js';
import { createPauseOverlay } from './pause.js';
import { DEFAULT_OPTIONS } from './storage.js';
import { createToasts } from './toast.js';
import { createTouchControls } from './touch.js';

/** @param {import('../types.js').NamePrompt} p @returns {string} */
function promptKey(p) {
  return p.player + '|' + p.rank + '|' + p.score;
}

/** @param {import('../types.js').CreateUIOpts & {onMenuChange?:(open:boolean)=>void}} opts @returns {import('../types.js').UI} */
export function createUI(opts) {
  if (!opts || !opts.root) throw new TypeError('createUI: opts.root is required');
  const { root, store, actions = {}, panelArt, onDialogChange, onMenuChange } = opts;
  const doc = opts.doc || root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new TypeError('createUI: no document available');
  const win = doc.defaultView || null;

  let options = { ...DEFAULT_OPTIONS, ...(opts.options || (store && store.getOptions && store.getOptions()) || {}) };
  let bindings = { ...DEFAULT_KEYS, ...(opts.bindings || (store && store.getBindings && store.getBindings()) || {}) };

  // ---- mount points ---------------------------------------------------------------------------------------------------------------
  const find = (id) => (typeof root.querySelector === 'function' ? root.querySelector('#' + id) : null) || (doc.getElementById ? doc.getElementById(id) : null);
  const mount = (id, tag, cls) => {
    let el = find(id);
    if (!el) { el = h(doc, tag, { id, class: cls }); root.appendChild(el); }
    return el;
  };
  const menubarEl = mount('menubar', 'nav', 'menubar');
  const panelEl = mount('panel', 'aside', 'panel');
  const touchEl = mount('touch-controls', 'div', 'touch-controls');
  const startEl = mount('start-overlay', 'div', 'overlay start-overlay');
  const statusEl = mount('status-line', 'div', 'status-line');
  const dialogRootEl = mount('dialog-root', 'div', 'dialog-root');
  const toastRootEl = mount('toast-root', 'div', 'toast-root');
  const stageEl = find('stage') || root;
  if (!menubarEl.getAttribute('aria-label')) menubarEl.setAttribute('aria-label', 'Game menu');

  // ---- panel (score board) --------------------------------------------------------------------------------------------------------
  const panelCanvas = find('panel-canvas') || h(doc, 'canvas', { id: 'panel-canvas', class: 'panel-canvas', width: '203', height: '394', 'aria-hidden': 'true' });
  const ariaEl = find('panel-aria') || h(doc, 'div', { id: 'panel-aria', class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  if (!panelCanvas.parentNode) panelEl.appendChild(panelCanvas);
  if (!ariaEl.parentNode) panelEl.appendChild(ariaEl);
  // Phone-portrait layout (css/ui.css): the canvas is hidden and these few lines of text sit under the full-width table instead.
  const hudHead = h(doc, 'span', { class: 'hud-head' });
  const hudScore = h(doc, 'span', { class: 'hud-score' });
  const hudInfo = h(doc, 'div', { class: 'hud-info' });
  const hudMission = h(doc, 'div', { class: 'hud-mission' });
  const hudEl = find('panel-hud') || h(doc, 'div', { id: 'panel-hud', class: 'panel-hud', 'aria-hidden': 'true' },
    h(doc, 'div', { class: 'hud-row' }, hudHead, hudScore), hudInfo, hudMission);
  if (!hudEl.parentNode) panelEl.appendChild(hudEl);
  function updateHud(view) {
    const p = panelHudParts(view);
    setText(hudHead, p.head); setText(hudScore, p.score); setText(hudInfo, p.info); setText(hudMission, p.mission);
  }
  const panel = createPanel({ canvas: panelCanvas, art: panelArt, data: opts.data });
  // The panel canvas backing store follows its on-screen size (CSS px x devicePixelRatio) so the LED dots stay crisp on big / hi-dpi screens.
  const syncPanelScale = () => {
    const rect = typeof panelCanvas.getBoundingClientRect === 'function' ? panelCanvas.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0)) return;
    panel.setScale(panelScaleFor(rect.width, (win && win.devicePixelRatio) || 1));
  };
  /** @type {any} */
  let panelObserver = null;
  if (win && typeof win.ResizeObserver === 'function') {
    panelObserver = new win.ResizeObserver(syncPanelScale);
    panelObserver.observe(panelEl);
  }
  if (win && typeof win.addEventListener === 'function') win.addEventListener('resize', syncPanelScale);
  syncPanelScale();

  // ---- status line -----------------------------------------------------------------------------------------------------------------
  const soundStatusEl = find('sound-status') || h(doc, 'span', { id: 'sound-status', class: 'sound-status', text: 'sound: not loaded' });
  const fpsEl = find('fps') || h(doc, 'span', { id: 'fps', class: 'fps', hidden: true });
  if (!soundStatusEl.parentNode) statusEl.appendChild(soundStatusEl);
  if (!fpsEl.parentNode) statusEl.appendChild(fpsEl);

  // ---- parts -----------------------------------------------------------------------------------------------------------------------
  const toasts = createToasts({ root: toastRootEl, doc });
  const picker = createFilePicker({
    root: dialogRootEl, doc,
    onFiles: (files) => {
      toasts.show(`Loading ${files.length} file${files.length === 1 ? '' : 's'}...`);
      callAction(actions, 'loadLocalSounds', files);
    },
  });

  let shownPromptKey = '';
  let answeredKey = '';
  let promptFromView = false;                 // the open name dialog was opened because view.namePrompt was set
  /** @type {import('../types.js').AudioStatus|null} */
  let lastSoundStatus = null;
  const dialogs = createDialogs({
    root: dialogRootEl, doc,
    actions: {
      submitName: (name) => { answeredKey = shownPromptKey; callAction(actions, 'submitName', name); },
      clearHighScores: () => callAction(actions, 'clearHighScores'),
      setBindings: (b) => callAction(actions, 'setBindings', b),
      setVolume: (v) => callAction(actions, 'setVolume', v),          // the Sound dialog's slider
    },
    onChange: (open) => { if (typeof onDialogChange === 'function') onDialogChange(open); },
    getBindings: () => bindings,
    getOptions: () => options,
    getSoundStatus: () => lastSoundStatus,
    picker,
    onBindings: (b) => { bindings = { ...b }; overlay.setBindings(bindings); },
    toast: (t) => toasts.show(t),
    data: opts.data,
  });

  const overlay = createStartOverlay({ root: startEl, doc, actions, picker, options, bindings, data: opts.data });
  const pause = createPauseOverlay({ host: stageEl, doc, actions });
  const touch = createTouchControls({ root: touchEl, doc, win });
  overlay.setTouch(touch.enabled);
  pause.setTouch(touch.enabled);

  const effective = (o) => {
    const fs = doc.fullscreenElement;
    return fs === undefined ? o : { ...o, fullscreen: Boolean(fs) };
  };
  const menus = createMenus({
    root: menubarEl, doc, actions, picker, options: effective(options),
    local: {
      controls: () => dialogs.showControls(bindings),
      help: () => dialogs.showHelp(),
      sound: () => dialogs.showSound(),
      about: () => dialogs.showAbout(),
    },
    onOpenChange: (open) => { if (typeof onMenuChange === 'function') onMenuChange(open); },
  });
  const onFullscreenChange = () => menus.setOptions(effective(options));
  doc.addEventListener('fullscreenchange', onFullscreenChange);

  let lastPhase = 'idle';

  function setSoundStatus(s) {
    if (!s || typeof s.text !== 'string') return;
    lastSoundStatus = s;
    setText(soundStatusEl, s.text);
    overlay.setSoundStatus(s);
    dialogs.updateSound(s);
  }

  return {
    update(view, dt) {
      if (!view) return;
      if (panel.update(view)) { setText(ariaEl, panel.lastAria()); updateHud(view); }
      menus.update(view);
      if (overlay.isShown() && lastPhase === 'idle' && view.phase !== 'idle') overlay.hide();     // a game started underneath (F2): get out of the way
      lastPhase = view.phase;
      pause.update(Boolean(view.paused) && view.phase !== 'idle' && !overlay.isShown() && !dialogs.isOpen() && !menus.isOpen());
      const p = view.namePrompt;
      if (!p) {
        shownPromptKey = ''; answeredKey = '';
        if (promptFromView) { promptFromView = false; dialogs.closeById('dlg-name'); }     // the rules withdrew the prompt (new game): drop the stale dialog
      } else {
        const key = promptKey(p);
        if (key !== answeredKey && dialogs.topId() !== 'dlg-name') { shownPromptKey = key; promptFromView = true; dialogs.promptName(p); }
      }
      toasts.tick(dt);
    },
    setOptions(o) {
      options = { ...DEFAULT_OPTIONS, ...options, ...(o || {}) };
      menus.setOptions(effective(options));
      overlay.setOptions(options);
    },
    showStartOverlay(o) {
      menus.closeAll();
      overlay.show(o);
      if (o && o.soundStatus) setSoundStatus(o.soundStatus);
    },
    hideStartOverlay() { overlay.hide(); },
    setSoundStatus,
    showHighScores(entries, o) { dialogs.showHighScores(entries, o); },
    promptName(p) {
      if (!p) return;
      shownPromptKey = promptKey(p);
      promptFromView = false;
      dialogs.promptName(p);
    },
    showControls(b) {
      if (b) { bindings = { ...DEFAULT_KEYS, ...b }; overlay.setBindings(bindings); }
      dialogs.showControls(bindings);
    },
    showSound() { dialogs.showSound(); },
    showAbout() { dialogs.showAbout(); },
    showHelp() { dialogs.showHelp(); },
    toast(text, ms) { toasts.show(text, ms); },
    setFps(n) {
      if (n === null || n === undefined) { setHidden(fpsEl, true); return; }
      setText(fpsEl, `${Math.round(n)} fps`);
      setHidden(fpsEl, false);
    },
    isDialogOpen: () => dialogs.isOpen(),
    closeAllDialogs() { dialogs.closeAll(); },
    dispose() {
      doc.removeEventListener('fullscreenchange', onFullscreenChange);
      if (panelObserver) panelObserver.disconnect();
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('resize', syncPanelScale);
      dialogs.dispose();
      menus.dispose();
      overlay.dispose();
      pause.dispose();
      touch.dispose();
      toasts.dispose();
      picker.dispose();
    },
    /** @returns {import('../types.js').Bindings} the bindings the UI currently shows (additive) */
    getBindings: () => ({ ...bindings }),
    /** DOM handles for tests and the integrator (additive). */
    elements: { menubar: menubarEl, panel: panelEl, panelCanvas, panelAria: ariaEl, touch: touchEl, startOverlay: startEl, pauseOverlay: pause.element, statusLine: statusEl,
      soundStatus: soundStatusEl, fps: fpsEl, dialogRoot: dialogRootEl, toastRoot: toastRootEl },
  };
}
