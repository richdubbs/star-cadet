/**
 * src/ui/touch.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.7 (touch controls); internal to src/ui.
 * createTouchControls({root, doc, win}) -> {enabled, setEnabled(on), buttons, dispose()}
 *
 * Builds the on-screen buttons inside `root` (= #touch-controls):
 *   <button class="tc" data-action="flipperLeft|flipperRight|plunger|nudgeLeft|nudgeRight|nudgeBottom">
 *   <button class="tc" data-app="pause|newGame|launchBall">
 * UI only creates and styles them; input.js (INTEGRATOR) listens by delegation on #touch-controls (pointerdown -> down:true / app event,
 * pointerup|pointercancel|pointerleave -> down:false). The listeners added here never stop propagation; they only toggle the visual
 * `is-down` class and swallow the long-press context menu.
 * The container loses its `hidden` attribute only when matchMedia('(pointer: coarse)').matches or the URL has ?touch=1 (never on desktop).
 * Markup groups (for the CSS layouts): .tc-app (3 app buttons), .tc-pad > .tc-left / .tc-mid / .tc-right.
 *
 * ASSUMPTIONS: ?touch=0 forces the controls off even on a coarse pointer.
 */
import { h } from './dom.js';

/** Button definitions in DOM / reading order. `kind` is the data attribute used by input.js. */
export const TOUCH_BUTTONS = Object.freeze([
  { group: 'app', kind: 'app', name: 'pause', label: 'Pause', aria: 'Pause or resume' },
  { group: 'app', kind: 'app', name: 'newGame', label: 'New', aria: 'New game' },
  { group: 'app', kind: 'app', name: 'launchBall', label: 'Launch', aria: 'Launch ball' },
  { group: 'left', kind: 'action', name: 'nudgeLeft', label: 'Bump L', aria: 'Left table bump' },
  { group: 'left', kind: 'action', name: 'flipperLeft', label: 'Flip', aria: 'Left flipper', big: true },
  { group: 'mid', kind: 'action', name: 'nudgeBottom', label: 'Bump Up', aria: 'Bottom table bump' },
  { group: 'mid', kind: 'action', name: 'plunger', label: 'Plunger', aria: 'Plunger (hold, release to launch)', big: true },
  { group: 'right', kind: 'action', name: 'nudgeRight', label: 'Bump R', aria: 'Right table bump' },
  { group: 'right', kind: 'action', name: 'flipperRight', label: 'Flip', aria: 'Right flipper', big: true },
]);

/**
 * @param {string} search  location.search
 * @param {(q:string)=>{matches:boolean}|null} [matchMedia]
 * @returns {boolean} whether the touch controls should be visible
 */
export function wantsTouchControls(search, matchMedia) {
  const m = /[?&]touch=([^&#]*)/.exec(String(search || ''));
  if (m) return m[1] !== '0' && m[1] !== 'false' && m[1] !== '';
  try {
    return Boolean(matchMedia && matchMedia('(pointer: coarse)') && matchMedia('(pointer: coarse)').matches);
  } catch { return false; }
}

/**
 * @param {{root:any, doc:Document, win?:any}} opts
 */
export function createTouchControls({ root, doc, win }) {
  const w = win || (doc && doc.defaultView) || null;
  const groups = {
    app: h(doc, 'div', { class: 'tc-group tc-app' }),
    left: h(doc, 'div', { class: 'tc-group tc-left' }),
    mid: h(doc, 'div', { class: 'tc-group tc-mid' }),
    right: h(doc, 'div', { class: 'tc-group tc-right' }),
  };
  /** @type {any[]} */
  const buttons = [];
  /** @type {Array<()=>void>} */
  const cleanups = [];
  for (const def of TOUCH_BUTTONS) {
    const btn = h(doc, 'button', {
      class: 'tc' + (def.big ? ' tc-big' : '') + ' tc-' + def.name, type: 'button',
      [def.kind === 'app' ? 'data-app' : 'data-action']: def.name, 'aria-label': def.aria,
    }, h(doc, 'span', { class: 'tc-label', 'aria-hidden': 'true', text: def.label }));
    const down = () => { btn.classList.add('is-down'); };
    const up = () => { btn.classList.remove('is-down'); };
    const noMenu = (e) => { if (e && e.preventDefault) e.preventDefault(); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', noMenu);
    cleanups.push(() => {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
      btn.removeEventListener('pointerleave', up);
      btn.removeEventListener('contextmenu', noMenu);
    });
    groups[def.group].appendChild(btn);
    buttons.push(btn);
  }
  const pad = h(doc, 'div', { class: 'tc-pad' }, groups.left, groups.mid, groups.right);
  root.appendChild(groups.app);
  root.appendChild(pad);

  let enabled = false;
  const setEnabled = (on) => {
    enabled = Boolean(on);
    if (enabled) root.removeAttribute('hidden'); else root.setAttribute('hidden', '');
  };
  const search = w && w.location ? w.location.search : '';
  const mm = w && typeof w.matchMedia === 'function' ? (q) => w.matchMedia(q) : null;
  setEnabled(wantsTouchControls(search, mm));

  return {
    get enabled() { return enabled; },
    setEnabled,
    buttons,
    dispose() {
      for (const fn of cleanups.splice(0)) fn();
      if (groups.app.parentNode) groups.app.parentNode.removeChild(groups.app);
      if (pad.parentNode) pad.parentNode.removeChild(pad);
    },
  };
}
