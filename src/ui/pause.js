/**
 * src/ui/pause.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: pause overlay of the UI role brief (ARCHITECTURE.md 8 mentions the panel text "Game Paused / F3 to Resume"; this adds a veil on the table);
 * internal to src/ui.
 * createPauseOverlay({host, doc, actions}) -> {update(visible), isShown(), element, dispose()}
 *
 * A dim veil with a "Paused" card and a Resume button, appended to `host` (= #stage) as div#pause-overlay.overlay.pause-overlay[hidden].
 * It covers only the table area (the scoreboard keeps showing "Game Paused / F3 to Resume"), ignores the pointer except for its button,
 * and is shown by the facade only while view.paused is true, no dialog is open and the start overlay is closed.
 * The button calls actions.togglePause() (works on phones that have no F3 key); setTouch(true) rewords the hint for touch screens ("Tap Resume").
 */
import { callAction, h, setHidden } from './dom.js';

/** Hint under "Paused" (keyboard) and its touch-screen wording. */
export const PAUSE_HINT = 'Press F3 or use the button to continue.';
export const PAUSE_HINT_TOUCH = 'Tap Resume to continue.';

/**
 * @param {{host:any, doc:Document, actions?:any}} opts
 */
export function createPauseOverlay({ host, doc, actions = {} }) {
  const hint = h(doc, 'p', { id: 'pause-hint', class: 'pause-hint', text: PAUSE_HINT });
  const resume = h(doc, 'button', { id: 'pause-resume', class: 'btn btn-primary btn-big', type: 'button', text: 'Resume' });
  const el = h(doc, 'div', { id: 'pause-overlay', class: 'overlay pause-overlay', hidden: true, role: 'status' },
    h(doc, 'div', { class: 'pause-card' },
      h(doc, 'p', { class: 'pause-title', text: 'Paused' }),
      hint,
      resume));
  const onResume = () => callAction(actions, 'togglePause');
  resume.addEventListener('click', onResume);
  host.appendChild(el);

  return {
    /** @param {boolean} visible */
    update(visible) { setHidden(el, !visible); },
    isShown: () => !el.hidden,
    /** @param {boolean} on touch screen: no F3 key, say so */
    setTouch(on) { hint.textContent = on ? PAUSE_HINT_TOUCH : PAUSE_HINT; },
    element: el,
    dispose() {
      resume.removeEventListener('click', onResume);
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
