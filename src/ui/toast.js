/**
 * src/ui/toast.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.8 (ui.toast(text, ms = 2500) in #toast-root, a polite live region); internal to src/ui.
 * createToasts({root, doc, maxVisible = 3}) -> {show(text, ms?), tick(dt), clear(), count(), dispose()}
 *
 * Transient messages. Time comes only from tick(dt) (the facade calls it from ui.update(view, dt) once per animation frame), so there is no
 * setTimeout and the toasts freeze together with the page's frame loop. A toast gets class `toast-out` for its last 0.35 s (CSS fades it).
 * Showing the same text again while it is still visible only refreshes its timer; more than `maxVisible` toasts drop the oldest.
 * A progress toast (text ending in an ellipsis, e.g. "Loading 3 files...") is withdrawn as soon as any other toast arrives: that one is its result.
 *
 * ASSUMPTIONS: ms <= 0 or non-numeric falls back to the 2500 ms default; empty text is ignored.
 */
import { h } from './dom.js';

const DEFAULT_MS = 2500;
const FADE_S = 0.35;

/**
 * @param {{root:any, doc:Document, maxVisible?:number}} opts
 */
export function createToasts({ root, doc, maxVisible = 3 }) {
  /** @type {Array<{el:any, text:string, left:number, fading:boolean, progress:boolean}>} */
  const live = [];

  function drop(entry) {
    const i = live.indexOf(entry);
    if (i >= 0) live.splice(i, 1);
    if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
  }

  return {
    /** @param {string} text @param {number} [ms] */
    show(text, ms) {
      const t = text === null || text === undefined ? '' : String(text);
      if (t === '') return;
      const seconds = (typeof ms === 'number' && ms > 0 ? ms : DEFAULT_MS) / 1000;
      const same = live.find((e) => e.text === t);
      if (same) {
        same.left = seconds;
        if (same.fading) { same.fading = false; same.el.className = 'toast'; }
        return;
      }
      for (const e of live.slice()) if (e.progress) drop(e);
      const el = h(doc, 'div', { class: 'toast', role: 'status', text: t });
      root.appendChild(el);
      live.push({ el, text: t, left: seconds, fading: false, progress: /\.\.\.$/.test(t) });
      while (live.length > maxVisible) drop(live[0]);
    },
    /** @param {number} dt seconds since the previous frame */
    tick(dt) {
      if (live.length === 0 || !(dt > 0)) return;
      for (const e of live.slice()) {
        e.left -= dt;
        if (e.left <= 0) drop(e);
        else if (!e.fading && e.left <= FADE_S) { e.fading = true; e.el.className = 'toast toast-out'; }
      }
    },
    clear() { for (const e of live.slice()) drop(e); },
    count: () => live.length,
    dispose() { for (const e of live.slice()) drop(e); },
  };
}
