/**
 * tests/ui_helpers/fake_dom.mjs
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * A very small DOM double for the UI role's Node tests (not a *.test.mjs file, so the runner does not execute it).
 * It implements exactly the DOM subset src/ui uses: createElement/createTextNode/getElementById, attributes, classList, hidden/disabled/value/
 * checked properties, textContent, append/removeChild/contains, querySelector(All) for simple selectors (tag, #id, .class, [attr], [attr=v],
 * compound + descendant), event listeners with capture/bubble/stopPropagation/preventDefault, focus()/blur()/activeElement/focusin, click().
 *
 *   const doc = createFakeDocument();
 *   const el = doc.createElement('div'); doc.body.appendChild(el);
 *   fire(el, 'keydown', { key: 'Escape' });
 */

import { createFakeCanvas } from '../helpers/fake_canvas.mjs';

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = true;
    Object.assign(this, init);
    this.defaultPrevented = false;
    this._stopped = false;
    this.target = init.target || null;
    this.currentTarget = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
}

class FakeNode {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = [];
  }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i < 0) throw new Error('removeChild: not a child');
    this.childNodes.splice(i, 1);
    n.parentNode = null;
    const doc = this.ownerDocument || this;
    if (doc && doc.activeElement && n.contains && n.contains(doc.activeElement)) doc.activeElement = doc.body;
    return n;
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  addEventListener(type, fn, opts) {
    const capture = opts === true || Boolean(opts && opts.capture);
    this._listeners.push({ type, fn, capture });
  }
  removeEventListener(type, fn, opts) {
    const capture = opts === true || Boolean(opts && opts.capture);
    const i = this._listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this._listeners.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    const run = (node, capturePhase, atTarget) => {
      ev.currentTarget = node;
      for (const l of node._listeners.slice()) {
        if (l.type !== ev.type) continue;
        if (!atTarget && l.capture !== capturePhase) continue;
        l.fn.call(node, ev);
      }
    };
    for (let i = path.length - 1; i > 0 && !ev._stopped; i--) run(path[i], true, false);
    if (!ev._stopped) {
      ev.currentTarget = this;
      for (const l of this._listeners.slice()) if (l.type === ev.type && l.capture) l.fn.call(this, ev);
      for (const l of this._listeners.slice()) if (l.type === ev.type && !l.capture) l.fn.call(this, ev);
    }
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stopped; i++) run(path[i], false, false);
    return !ev.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

function parseSelector(sel) {
  return sel.split(',').map((part) => part.trim().split(/\s+/).map((c) => {
    const m = { tag: null, id: null, classes: [], attrs: [] };
    const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/;
    let rest = c;
    while (rest) {
      const x = re.exec(rest);
      if (!x) throw new Error('fake dom: unsupported selector ' + sel);
      if (x[1]) m.tag = x[1].toLowerCase();
      else if (x[2]) m.id = x[2];
      else if (x[3]) m.classes.push(x[3]);
      else m.attrs.push([x[4], x[5] ?? x[6] ?? x[7] ?? null]);
      rest = rest.slice(x[0].length);
    }
    return m;
  }));
}

function matchesCompound(el, m) {
  if (m.tag && el.tagName.toLowerCase() !== m.tag) return false;
  if (m.id && el.id !== m.id) return false;
  for (const c of m.classes) if (!el.classList.contains(c)) return false;
  for (const [name, val] of m.attrs) {
    const a = el.getAttribute(name);
    if (a === null) return false;
    if (val !== null && a !== val) return false;
  }
  return true;
}

function matchesChain(el, chain) {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let idx = chain.length - 2;
  for (let a = el.parentNode; a && idx >= 0; a = a.parentNode) {
    if (a.nodeType === 1 && matchesCompound(a, chain[idx])) idx--;
  }
  return idx < 0;
}

export class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this._attrs = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this._value = '';
    this._checked = false;
    this.selected = false;
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, force) => {
        const on = force === undefined ? !self.classList.contains(c) : Boolean(force);
        if (on) self.classList.add(c); else self.classList.remove(c);
        return on;
      },
    };
  }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  hasAttribute(n) { return this._attrs.has(n); }
  removeAttribute(n) { this._attrs.delete(n); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get multiple() { return this.hasAttribute('multiple'); }
  set multiple(v) { if (v) this.setAttribute('multiple', ''); else this.removeAttribute('multiple'); }
  get type() { return this.getAttribute('type') || ''; }
  get value() {
    if (this.tagName === 'OPTION') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
    if (this.tagName === 'SELECT') {
      const opts = this.children.filter((c) => c.tagName === 'OPTION');
      return this._value !== '' ? this._value : (opts[0] ? opts[0].getAttribute('value') : '');
    }
    return this._value;
  }
  set value(v) { if (this.tagName === 'OPTION') this.setAttribute('value', v); else this._value = String(v); }
  get checked() { return this._checked; }
  set checked(v) { this._checked = Boolean(v); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes.slice()) this.removeChild(c);
    if (v !== '' && v !== null && v !== undefined) this.appendChild(new FakeText(this.ownerDocument, v));
  }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(this.ownerDocument, n) : n); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  select() { this.selected = true; }
  focus() {
    const doc = this.ownerDocument;
    if (!doc.documentElement.contains(this) || this.disabled || this.hidden) return;
    for (let a = this.parentNode; a && a.nodeType === 1; a = a.parentNode) if (a.hidden) return;
    if (doc.activeElement === this) return;
    const prev = doc.activeElement;
    doc.activeElement = this;
    if (prev && prev !== this) prev.dispatchEvent(new FakeEvent('focusout', { relatedTarget: this }));
    this.dispatchEvent(new FakeEvent('focusin', { relatedTarget: prev }));
  }
  blur() {
    const doc = this.ownerDocument;
    if (doc.activeElement === this) {
      doc.activeElement = doc.body;
      this.dispatchEvent(new FakeEvent('focusout', { relatedTarget: null }));
    }
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click', {}));
  }
  querySelectorAll(sel) {
    const chains = parseSelector(sel);
    const out = [];
    const visit = (node) => {
      for (const c of node.children) {
        if (chains.some((ch) => matchesChain(c, ch))) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    const chains = parseSelector(sel);
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (chains.some((ch) => matchesChain(n, ch))) return n;
    return null;
  }
}

/**
 * @param {{search?:string, coarse?:boolean}} [opts]  search = fake location.search, coarse = matchMedia('(pointer: coarse)')
 */
export function createFakeDocument(opts = {}) {
  const doc = new FakeNode(null);
  doc.ownerDocument = doc;
  doc.nodeType = 9;
  doc.createElement = (tag) => {
    const el = new FakeElement(doc, tag);
    if (String(tag).toLowerCase() === 'canvas') {                  // a canvas element backed by the recording fake canvas (strict API)
      const c = createFakeCanvas(300, 150, { strict: true });
      el.getContext = () => c.getContext('2d');
      el.ops = c.ops;
    }
    return el;
  };
  doc.createTextNode = (s) => new FakeText(doc, s);
  doc.documentElement = new FakeElement(doc, 'html');
  doc.appendChild(doc.documentElement);
  doc.body = new FakeElement(doc, 'body');
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.getElementById = (id) => doc.body.querySelector('#' + id);
  doc.defaultView = {
    location: { search: opts.search || '' },
    matchMedia: (q) => ({ matches: Boolean(opts.coarse) && q.includes('coarse'), media: q }),
    addEventListener() {}, removeEventListener() {},
  };
  return doc;
}

/** Dispatch a new event on `target` and return it. @param {any} target @param {string} type @param {object} [init] */
export function fire(target, type, init = {}) {
  const ev = new FakeEvent(type, { target, ...init });
  target.dispatchEvent(ev);
  return ev;
}

/** Depth-first list of all descendant elements matching `pred`. */
export function findAll(root, pred) {
  const out = [];
  const visit = (n) => { for (const c of n.children) { if (pred(c)) out.push(c); visit(c); } };
  visit(root);
  return out;
}
