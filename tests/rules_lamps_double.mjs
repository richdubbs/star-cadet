/**
 * tests/rules_lamps_double.mjs
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * A faithful-but-small local implementation of the Lamps contract (ARCHITECTURE.md 6, SPEC 5.13) used by tests/rules*.test.mjs while / in case
 * the real src/lamps.js is not available (ARCHITECTURE 7.10: "use real createLamps or a local double"). It is NOT part of the app.
 * Implements: integer-ms timer wheel, Lamp (S, overlay, flash waveform, timeout, offAfter, field, onIdx, hooks), LightGroup (counts, nextOn,
 * dropTop, offsetForward, step / animation / light-show / game-over, notify timer, flashWhenOn, broadcast), Bargraph (fuel), per-player save,
 * tilt, fillView. Deterministic: the only randomness is the injected `rand`.
 */
import * as D from '../src/data/index.js';

const ms = (sec) => Math.trunc(sec * 1000);

class Wheel {
  constructor() { this.t = 0; this.seq = 0; this.list = []; }
  now() { return this.t; }
  schedule(delayMs, fn) {
    const id = ++this.seq;
    const due = this.t + Math.max(0, delayMs);
    let i = this.list.length;
    while (i > 0 && this.list[i - 1].due > due) i--;
    this.list.splice(i, 0, { id, due, fn });
    return id;
  }
  cancel(id) {
    if (id === null || id === undefined) return;
    const i = this.list.findIndex((x) => x.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }
  advance(n) {
    const target = this.t + n;
    while (this.list.length && this.list[0].due <= target) {
      const x = this.list.shift();
      this.t = x.due;
      x.fn();
    }
    this.t = target;
  }
}

class Lamp {
  constructor(def, wheel) {
    this.name = def.name; this.def = def; this.w = wheel; this.nStates = def.nStates;
    this.S = false; this.overlay = 'none'; this.phase = false; this.offAfter = false; this.field = 0; this.onIdx = 0;
    this.timeoutH = null; this.flashH = null; this.hook = null;
  }
  setTimeout(t) {
    this.w.cancel(this.timeoutH); this.timeoutH = null;
    if (t > 0) this.timeoutH = this.w.schedule(ms(t), () => this.expire());
  }
  expire() {
    this.timeoutH = null;
    if (this.overlay === 'flash') { this.w.cancel(this.flashH); this.flashH = null; }
    this.overlay = 'none';
    if (this.offAfter) { this.offAfter = false; this.S = false; }
    if (this.hook) this.hook(this.name);
  }
  startFlash() { this.phase = !this.S; this.overlay = 'flash'; this.flashTick(true); }
  flashTick(first) {
    if (!first) this.phase = !this.phase;
    const len = this.phase ? this.def.flash.on : this.def.flash.off;
    this.flashH = this.w.schedule(ms(len), () => this.flashTick(false));
  }
  turnOn() { this.S = true; }
  turnOff() { this.S = false; }
  flasherStart() {
    this.setTimeout(0);
    if (this.overlay !== 'flash' || this.flashH === null) { this.overlay = 'flash'; this.offAfter = false; this.startFlash(); }
  }
  flasherStartTimed(t) {
    if (this.overlay !== 'flash') this.startFlash();
    this.overlay = 'flash'; this.offAfter = false; this.setTimeout(t);
  }
  turnOffTimed(t) {
    if (this.overlay !== 'off') { if (this.overlay === 'flash') { this.w.cancel(this.flashH); this.flashH = null; } this.overlay = 'off'; }
    this.setTimeout(t);
  }
  turnOnTimed(t) {
    if (this.overlay !== 'on') { if (this.overlay === 'flash') { this.w.cancel(this.flashH); this.flashH = null; } this.overlay = 'on'; }
    this.setTimeout(t);
  }
  resetTimed() { this.w.cancel(this.timeoutH); this.timeoutH = null; this.w.cancel(this.flashH); this.flashH = null; this.overlay = 'none'; }
  thenStayOn(t) { this.offAfter = false; this.turnOn(); this.flasherStartTimed(t); }
  thenStayOff(t) { this.flasherStartTimed(t); this.offAfter = true; }
  resetAndOn() { this.turnOn(); this.resetTimed(); }
  resetAndOff() { this.turnOff(); this.resetTimed(); }
  toggleValue(v) { if (Math.floor(v) !== 0) this.turnOn(); else this.turnOff(); }
  resetAndToggle(v) { this.toggleValue(v); this.resetTimed(); }
  setOnIdx(i) { this.onIdx = Math.max(0, Math.min(this.nStates - 1, Math.floor(i))); }
  lightOn() { return this.S || this.overlay === 'on' || this.overlay === 'flash'; }
  isLit() { return this.overlay === 'flash' ? this.phase : this.overlay === 'on' ? true : this.overlay === 'off' ? false : this.S; }
  fullReset() {
    this.resetTimed(); this.S = false; this.offAfter = false; this.onIdx = 0; this.field = 0;
  }
  apply(verb, a) {
    switch (verb) {
      case 'turnOn': this.turnOn(); break;
      case 'turnOff': this.turnOff(); break;
      case 'on': this.resetAndOn(); break;
      case 'off': this.resetAndOff(); break;
      case 'flash': this.flasherStartTimed(a === undefined ? 0 : a); break;
      case 'flasherStart': this.flasherStart(); break;
      case 'flashThenOn': this.thenStayOn(a); break;
      case 'flashThenOff': this.thenStayOff(a); break;
      case 'timedOn': this.turnOnTimed(a === undefined ? 0 : a); break;
      case 'timedOff': this.turnOffTimed(a === undefined ? 0 : a); break;
      case 'resetTimed': this.resetTimed(); break;
      case 'toggleValue': this.toggleValue(a); break;
      case 'resetAndToggleValue': this.resetAndToggle(a); break;
      default: throw new TypeError('unknown lamp verb ' + verb);
    }
  }
}

class Group {
  constructor(name, members, step, wheel, rand) {
    this.name = name; this.lamps = members; this.members = members.map((l) => l.name); this.stepDefault = step; this.w = wheel; this.rand = rand;
    this.anim = null; this.animFlag = false; this.stepH = null; this.notifyH = null; this.notifyFn = null;
  }
  count() { return this.lamps.filter((l) => l.S).length; }
  firstUnlit() { return this.lamps.findIndex((l) => !l.S); }
  topLit() { for (let i = this.lamps.length - 1; i >= 0; i--) if (this.lamps[i].S) return i; return -1; }
  mirror() { for (let i = this.lamps.length - 1; i >= 0; i--) { const l = this.lamps[i]; if (l.S) l.turnOnTimed(0); else l.turnOffTimed(0); } }
  rearm(step, period) {
    this.w.cancel(this.stepH); this.stepH = null;
    if (!step) { this.anim = null; this.animFlag = false; return; }
    const p = step > 0 ? step : this.stepDefault;
    this.stepH = this.w.schedule(ms(p), () => { this.stepH = null; this.run(this.anim, p, true); });
    void period;
  }
  nextOn(t = 2.0) {
    const i = this.firstUnlit();
    if (i < 0) return false;
    if (this.anim || this.animFlag) this.groupReset();
    this.lamps[i].thenStayOn(t);
    return true;
  }
  dropTop() {
    const i = this.topLit();
    if (i < 0) return false;
    this.lamps[i].turnOff();
    if (this.anim) this.mirror();
    return true;
  }
  offsetForward() {
    const i = this.firstUnlit();
    if (i < 0) return false;
    this.lamps[i].turnOn();
    if (this.anim) this.mirror();
    return true;
  }
  stepRotate(dir) {
    const n = this.lamps.length;
    const last = this.lamps[n - 1];
    if (last.overlay !== 'none') return;
    if (this.anim) this.groupReset();
    const S = this.lamps.map((l) => l.S); const F = this.lamps.map((l) => l.field);
    for (let i = 0; i < n; i++) {
      const src = dir > 0 ? (i - 1 + n) % n : (i + 1) % n;     // backward (dir>0): pattern moves toward higher index
      this.lamps[i].S = S[src]; this.lamps[i].field = F[src];
    }
  }
  stepBackward() { this.stepRotate(1); }
  stepForward() { this.stepRotate(-1); }
  rotateOverlay(dir) {
    const n = this.lamps.length;
    const on = this.lamps.map((l) => l.overlay === 'on');
    for (let i = n - 1; i >= 0; i--) {
      const src = dir > 0 ? (i - 1 + n) % n : (i + 1) % n;
      if (on[src]) this.lamps[i].turnOnTimed(0); else this.lamps[i].turnOffTimed(0);
    }
  }
  run(code, step, fromTimer) {
    if (code === 'animBack' || code === 'animFwd') {
      if (!fromTimer && (this.animFlag || !this.anim)) this.mirror();
      this.anim = code; this.animFlag = false;
      this.rotateOverlay(code === 'animBack' ? 1 : -1);
      this.rearm(step);
    } else if (code === 'lightShow') {
      if (!fromTimer && (this.animFlag || !this.anim)) this.mirror();
      this.anim = code; this.animFlag = false;
      for (const l of this.lamps) if (Math.floor(this.rand() * 100) > 70) l.turnOnTimed(0.1 + this.rand() * 3 * step);
      this.rearm(step);
    } else if (code === 'gameOver') {
      if (!fromTimer && (this.animFlag || !this.anim)) this.mirror();
      this.anim = code; this.animFlag = false;
      for (const l of this.lamps) l.resetAndToggle(this.rand() < 0.29 ? 1 : 0);
      this.rearm(step);
    }
  }
  animationBackward(step) { this.run('animBack', step === undefined ? -1 : step, false); }
  animationForward(step) { this.run('animFwd', step === undefined ? -1 : step, false); }
  lightShow(step = 0.2) { this.run('lightShow', step, false); }
  gameOver(step = 1.4) { this.run('gameOver', step, false); }
  isAnimating() { return this.anim !== null; }
  lastFlashing() { return this.lamps[this.lamps.length - 1].overlay === 'flash'; }
  groupReset() {
    this.w.cancel(this.stepH); this.stepH = null;
    if (this.anim === 'animBack' || this.anim === 'animFwd' || this.anim === 'lightShow') this.broadcast('resetTimed');
    this.anim = null; this.animFlag = false;
  }
  restartNotifyTimer(t) {
    this.w.cancel(this.notifyH); this.notifyH = null;
    if (t > 0) this.notifyH = this.w.schedule(ms(t), () => { this.notifyH = null; if (this.notifyFn) this.notifyFn(this.name); });
  }
  onNotifyExpired(fn) { this.notifyFn = fn; }
  flashWhenOn(t) {
    for (let i = this.lamps.length - 1; i >= 0; i--) { const l = this.lamps[i]; if (l.S) { l.turnOff(); l.thenStayOff(t); } }
  }
  broadcast(verb, a) { for (let i = this.lamps.length - 1; i >= 0; i--) this.lamps[i].apply(verb, a); }
  fullReset() { this.w.cancel(this.stepH); this.stepH = null; this.w.cancel(this.notifyH); this.notifyH = null; this.anim = null; this.animFlag = false; }
}

class Bargraph extends Group {
  constructor(def, members, wheel, rand) {
    super(def.name, members, def.step, wheel, rand);
    this.durations = def.durations; this.level = 0; this.levelH = null; this.hooks = {};
  }
  setHooks(h) { this.hooks = h || {}; }
  setLevel(L) {
    this.w.cancel(this.levelH); this.levelH = null;
    let v = Math.floor(L);
    if (v > 11) v = 11;
    if (v < 0) { this.lamps.forEach((l) => l.resetAndOff()); this.level = 0; return; }
    if (this.hooks.beforeSetLevel) this.hooks.beforeSetLevel(v);
    const split = Math.floor(v / 2);
    this.lamps.forEach((l, i) => { if (i > split) l.resetAndOff(); else l.resetAndOn(); });
    if (v % 2 === 0) this.lamps[split].flasherStart();
    this.levelH = this.w.schedule(ms(this.durations[v]), () => this.tick());
    this.level = v;
  }
  tick() {
    this.levelH = null;
    if (this.level > 0) {
      this.setLevel(this.level - 1);
      if (this.hooks.tick) this.hooks.tick(this.level);
    } else {
      this.lamps.forEach((l) => l.resetAndOff());
      if (this.hooks.ended) this.hooks.ended();
    }
  }
  reset() { this.w.cancel(this.levelH); this.levelH = null; this.level = 0; this.lamps.forEach((l) => l.resetAndOff()); }
}

/** @returns {import('../src/types.js').Lamps} */
export function createLampsDouble(opts = {}) {
  const rand = opts.rand || Math.random;
  const wheel = new Wheel();
  const lamps = new Map(D.LAMPS.map((def) => [def.name, new Lamp(def, wheel)]));
  const L = (name) => {
    const l = lamps.get(name);
    if (!l) throw new TypeError('unknown lamp ' + name);
    return l;
  };
  const groups = new Map();
  for (const g of D.LAMP_GROUPS) groups.set(g.name, new Group(g.name, g.members.map(L), g.step, wheel, rand));
  groups.set('all', new Group('all', D.LAMP_NAMES.map(L), 0.2, wheel, rand));
  const bargraph = new Bargraph(D.FUEL_BARGRAPH, D.FUEL_BARGRAPH.members.map(L), wheel, rand);
  const saved = [[], [], [], []];
  let acc = 0;
  const api = {
    advance(dt) { acc += dt * 1000; const whole = Math.floor(acc + 1e-9); if (whole > 0) { acc -= whole; wheel.advance(whole); } },
    advanceMs(n) { wheel.advance(n); },
    nowMs: () => wheel.now(),
    isLit: (n) => L(n).isLit(), lightOn: (n) => L(n).lightOn(), steady: (n) => L(n).S, overlay: (n) => L(n).overlay,
    getField: (n) => L(n).field, setField: (n, v) => { L(n).field = Math.floor(v); },
    getOnIdx: (n) => L(n).onIdx, setOnIdx: (n, i) => L(n).setOnIdx(i),
    on: (n) => L(n).resetAndOn(), off: (n) => L(n).resetAndOff(), turnOn: (n) => L(n).turnOn(), turnOff: (n) => L(n).turnOff(),
    flash: (n, t) => L(n).flasherStartTimed(t === undefined ? 0 : t), flasherStart: (n) => L(n).flasherStart(),
    flashThenOn: (n, t) => L(n).thenStayOn(t), flashThenOff: (n, t) => L(n).thenStayOff(t),
    timedOn: (n, t) => L(n).turnOnTimed(t), timedOff: (n, t) => L(n).turnOffTimed(t), resetTimed: (n) => L(n).resetTimed(),
    toggleValue: (n, v) => L(n).toggleValue(v), resetAndToggleValue: (n, v) => L(n).resetAndToggle(v),
    group: (n) => {
      const g = groups.get(n);
      if (!g) throw new TypeError('unknown group ' + n);
      return g;
    },
    fuel: bargraph,
    onLampTimer: (n, fn) => {
      if (!D.LAMP_HOOK_NAMES.includes(n)) throw new TypeError('no timer hook on ' + n);
      L(n).hook = fn;
    },
    tiltOff() { for (const l of lamps.values()) l.turnOffTimed(0); L('lite77').flasherStart(); },
    clearTiltLock() { for (const l of lamps.values()) l.resetTimed(); },
    resetAll() {
      for (const l of lamps.values()) l.fullReset();
      for (const g of groups.values()) g.fullReset();
      bargraph.fullReset(); bargraph.reset();
      for (const sl of saved) sl.length = 0;
    },
    playerChanged(out, inc) {
      for (const [name, l] of lamps) {
        saved[out][name] = { flash: l.overlay === 'flash', onIdx: l.onIdx, S: l.S, field: l.field };
        l.fullReset();
        const sv = saved[inc][name];
        if (sv) {
          l.field = sv.field; if (sv.onIdx) l.setOnIdx(sv.onIdx);
          if (sv.S) l.turnOn();
          if (sv.flash) l.flasherStart();
        }
      }
      for (const g of groups.values()) g.fullReset();
      bargraph.reset();
    },
    fillView(view) {
      let ch = false;
      view.lit = view.lit || {}; view.onIdx = view.onIdx || {};
      for (const [name, l] of lamps) {
        const lit = l.isLit();
        if (view.lit[name] !== lit) { view.lit[name] = lit; ch = true; }
        if (view.onIdx[name] !== l.onIdx) { view.onIdx[name] = l.onIdx; ch = true; }
      }
      if (ch) view.version = (view.version || 0) + 1;
      return view;
    },
    names: D.LAMP_NAMES.slice(),
  };
  return api;
}
