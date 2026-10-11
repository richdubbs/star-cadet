/**
 * src/ui/dom.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: internal helper of src/ui (not part of the public surface). Tiny DOM construction/update helpers shared by menus, dialogs,
 * overlay, toasts and touch controls. Uses only a narrow DOM subset (createElement, createTextNode, setAttribute, appendChild, addEventListener,
 * className, textContent, hidden) so the DOM modules can be exercised against the small fake DOM of tests/ui_helpers/fake_dom.mjs.
 * Safe to import in Node (no DOM access at import time).
 */

/** Properties that must be assigned as properties, not as attributes. */
const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'multiple']);

/**
 * Create an element.
 *   props.class -> className, props.text -> textContent, props.onclick (any on*) -> addEventListener, value/checked/disabled/hidden -> property,
 *   anything else -> attribute (true -> empty attribute, false/null/undefined -> skipped).
 * Children: strings become text nodes, nested arrays are flattened, null/false are skipped.
 * @param {Document} doc @param {string} tag @param {Record<string, any>|null} [props] @param {...any} children @returns {any}
 */
export function h(doc, tag, props, ...children) {
  const el = doc.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === undefined || v === null || v === false) continue;
      if (key === 'class') el.className = String(v);
      else if (key === 'text') el.textContent = String(v);
      else if (key.length > 2 && key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2), v);
      else if (PROP_KEYS.has(key)) el[key] = v;
      else if (v === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(v));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
  }
  return el;
}

/** Set textContent only when it differs (avoids needless DOM writes in per-frame code). @param {any} el @param {string} text */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Set `hidden` only when it differs. @param {any} el @param {boolean} hidden */
export function setHidden(el, hidden) {
  if (el && Boolean(el.hidden) !== hidden) el.hidden = hidden;
}

/** Set an attribute only when it differs. @param {any} el @param {string} name @param {string} value */
export function setAttr(el, name, value) {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Remove every child of `el`. @param {any} el */
export function clearChildren(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Elements inside `container` that can take keyboard focus (visible, enabled).
 * @param {any} container @returns {any[]}
 */
export function focusableIn(container) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children || []) {
      if (child.hidden) continue;
      const tag = String(child.tagName || '').toLowerCase();
      const tabindex = child.getAttribute('tabindex');
      const focusableTag = tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || (tag === 'a' && child.getAttribute('href') !== null);
      if (!child.disabled && child.getAttribute('type') !== 'hidden' && tabindex !== '-1' && (focusableTag || tabindex !== null)) out.push(child);
      visit(child);
    }
  };
  visit(container);
  return out;
}

/**
 * Call `actions[name](...args)` if it exists; a missing callback is not an error (tests pass partial action sets).
 * @param {any} actions @param {string} name @param {...any} args @returns {any}
 */
export function callAction(actions, name, ...args) {
  const fn = actions && actions[name];
  return typeof fn === 'function' ? fn.apply(actions, args) : undefined;
}
