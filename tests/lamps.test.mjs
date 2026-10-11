/**
 * tests/lamps.test.mjs
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * Acceptance tests of the lamp engine (ARCHITECTURE.md 6.7, 13.2; SPEC 5.13.6 vectors T1-T6, Appendix D #7 and #9).
 * Time is driven only through lamps.advanceMs(ms) / lamps.advance(dt) - no wall clock, no Math.random.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLamps } from '../src/lamps.js';
import { TimerWheel, secondsToMs, timeoutMs } from '../src/lamps/wheel.js';
import { Lamp } from '../src/lamps/lamp.js';
import { LightGroup } from '../src/lamps/group.js';
import { LightBargraph } from '../src/lamps/bargraph.js';
import * as data from '../src/data/index.js';
import { mulberry32, constantRand, sequenceRand } from './helpers/seeded_rand.mjs';

const { LAMP_NAMES, LAMP_GROUPS, LAMP_GROUP_NAMES, LAMPS, FUEL_BARGRAPH, LAMP_HOOK_NAMES, LAMP_FLASH_OVERRIDES } = data;

/** Advance one millisecond at a time, calling check(t) BEFORE every millisecond for t = from .. to - 1. */
function eachMs(l, from, to, check) {
  for (let t = from; t < to; t++) {
    check(t);
    l.advanceMs(1);
  }
}

const lampsLit = (l, names) => names.map((n) => l.isLit(n));
const steadyOf = (l, names) => names.map((n) => l.steady(n));

// =====================================================================================================================================
// TimerWheel
// =====================================================================================================================================
test('wheel: fires in (time, priority, insertion) order, now() is the due time inside callbacks', () => {
  const w = new TimerWheel();
  const log = [];
  w.schedule(10, () => log.push(['b', w.now()]));
  w.schedule(5, () => log.push(['a', w.now()]));
  w.schedule(10, () => log.push(['c', w.now()]));
  w.schedule(10, () => log.push(['flash', w.now()]), 1);
  w.schedule(10, () => log.push(['d', w.now()]), 0);
  w.advance(9);
  assert.deepEqual(log, [['a', 5]]);
  assert.equal(w.now(), 9);
  w.advance(1);
  assert.deepEqual(log.slice(1), [['b', 10], ['c', 10], ['d', 10], ['flash', 10]]);
  assert.equal(w.size(), 0);
});

test('wheel: re-entrant - timers scheduled by a callback fire in the same advance, relative to the due time', () => {
  const w = new TimerWheel();
  const log = [];
  w.schedule(100, () => {
    log.push(['first', w.now()]);
    w.schedule(50, () => log.push(['second', w.now()]));
    w.schedule(0, () => log.push(['zero', w.now()]));
    w.schedule(1000, () => log.push(['far', w.now()]));
  });
  w.advance(500);
  assert.deepEqual(log, [['first', 100], ['zero', 100], ['second', 150]]);
  assert.equal(w.now(), 500);
  assert.equal(w.size(), 1);
  w.advance(600);
  assert.deepEqual(log.at(-1), ['far', 1100]);
});

test('wheel: cancel (also of a timer due at the same instant, from a callback) and stale ids', () => {
  const w = new TimerWheel();
  const log = [];
  const idB = w.schedule(10, () => log.push('b'));
  w.schedule(10, () => { log.push('a'); w.cancel(idB); });
  const idC = w.schedule(20, () => log.push('c'));
  w.cancel(idC);
  w.cancel(idC); w.cancel(0); w.cancel(99999);
  // idB was inserted first so it fires before the canceller; make the canceller earlier
  w.advance(30);
  assert.deepEqual(log, ['b', 'a']);
  const w2 = new TimerWheel();
  const log2 = [];
  let idB2 = 0;
  w2.schedule(10, () => { log2.push('a'); w2.cancel(idB2); });
  idB2 = w2.schedule(10, () => log2.push('b'));
  w2.advance(30);
  assert.deepEqual(log2, ['a']);
});

test('wheel: nested advance does not recurse, a throwing callback leaves the wheel usable, bad input ignored', () => {
  const w = new TimerWheel();
  const log = [];
  w.schedule(10, () => { w.advance(100); log.push(['inner-returned', w.now()]); });
  w.schedule(60, () => log.push(['t60', w.now()]));
  w.advance(20);
  assert.deepEqual(log, [['inner-returned', 10], ['t60', 60]]);
  assert.equal(w.now(), 120);
  w.advance(-5); w.advance(NaN); w.advance(0.4); w.advance(Infinity);
  assert.equal(w.now(), 120);
  w.schedule(1, () => { throw new Error('boom'); });
  assert.throws(() => w.advance(5), /boom/);
  const seen = [];
  w.schedule(1, () => seen.push(w.now()));
  w.advance(5);
  assert.equal(seen.length, 1);
  assert.throws(() => w.schedule(1, null), TypeError);
});

test('wheel: randomized comparison with a naive scheduler (order, times, cancellation, re-entrant scheduling)', () => {
  const rand = mulberry32(2024);
  const w = new TimerWheel();
  // naive reference: array scanned for the minimum (time, prio, seq)
  const ref = { now: 0, seq: 0, list: [] };
  const refSchedule = (ms, tag, prio) => { const r = { time: ref.now + Math.trunc(ms), prio, seq: ref.seq++, tag, live: true }; ref.list.push(r); return r; };
  const refAdvance = (ms, onFire) => {
    const target = ref.now + ms;
    for (;;) {
      let best = null;
      for (const r of ref.list) {
        if (!r.live || r.time > target) continue;
        if (!best || r.time < best.time || (r.time === best.time && (r.prio < best.prio || (r.prio === best.prio && r.seq < best.seq)))) best = r;
      }
      if (!best) break;
      best.live = false;
      ref.now = Math.max(ref.now, best.time);
      onFire(best);
    }
    ref.now = target;
    ref.list = ref.list.filter((r) => r.live);
  };
  const logReal = [];
  const logRef = [];
  const handles = []; // [{id, r}]
  let tagCounter = 0;
  // callbacks spawn follow-ups deterministically from their tag so both sides do the same
  const spawnFor = (tag) => ((tag * 7919) % 5 === 0 ? [(tag * 13) % 40, ((tag * 31) % 3)] : null);
  const realFire = (tag) => () => {
    logReal.push([tag, w.now()]);
    const sp = spawnFor(tag);
    if (sp) { const t2 = ++tagCounter; w.schedule(sp[0], realFire(t2), sp[1]); }
  };
  const refFireCb = (r) => {
    logRef.push([r.tag, ref.now]);
    const sp = spawnFor(r.tag);
    if (sp) { const t2 = ++refTag; refSchedule(sp[0], t2, sp[1]); }
  };
  let refTag = 0;
  for (let step = 0; step < 400; step++) {
    const k = Math.floor(rand() * 4);
    if (k <= 1) {
      const ms = Math.floor(rand() * 60);
      const prio = Math.floor(rand() * 3);
      const tag = ++tagCounter;
      refTag = tagCounter;
      const id = w.schedule(ms, realFire(tag), prio);
      const r = refSchedule(ms, tag, prio);
      handles.push({ id, r });
    } else if (k === 2 && handles.length) {
      const h = handles[Math.floor(rand() * handles.length)];
      w.cancel(h.id);
      h.r.live = false;
    } else {
      const ms = 1 + Math.floor(rand() * 40);
      refTag = tagCounter;
      w.advance(ms);
      refAdvance(ms, refFireCb);
      tagCounter = Math.max(tagCounter, refTag);
    }
  }
  assert.equal(w.now(), ref.now);
  assert.deepEqual(logReal, logRef);
  assert.ok(logReal.length > 50, `only ${logReal.length} timers fired`);
});

test('wheel: seconds -> ms conversions truncate like Math.trunc(seconds * 1000)', () => {
  assert.equal(secondsToMs(5), 5000);
  assert.equal(secondsToMs(0.1), 100);
  assert.equal(secondsToMs(0.57), 570);
  assert.equal(secondsToMs(0.0509), 50);
  assert.equal(secondsToMs(0), 0);
  assert.equal(secondsToMs(-1), 0);
  assert.equal(secondsToMs(NaN), 0);
  assert.equal(timeoutMs(0.0004), 1);
  assert.equal(timeoutMs(0), 0);
  assert.equal(timeoutMs(2), 2000);
});

// =====================================================================================================================================
// Construction, names, errors
// =====================================================================================================================================
test('createLamps: 140 lamps, 18 groups + all + fuel, classes, unknown names throw TypeError', () => {
  const l = createLamps();
  assert.equal(l.names.length, 140);
  assert.deepEqual(l.names, [...LAMP_NAMES]);
  for (const n of l.names) { assert.equal(l.isLit(n), false); assert.equal(l.lightOn(n), false); assert.equal(l.overlay(n), 'none'); }
  for (const g of LAMP_GROUPS) {
    const grp = l.group(g.name);
    assert.ok(grp instanceof LightGroup);
    assert.deepEqual(grp.members, [...g.members]);
    assert.equal(grp.name, g.name);
    assert.equal(l.group(g.name), grp, 'same object every call');
  }
  assert.deepEqual([...LAMP_GROUP_NAMES].sort(), LAMP_GROUPS.map((g) => g.name).sort());
  assert.deepEqual(l.group('all').members, [...LAMP_NAMES]);
  assert.ok(l.fuel instanceof LightBargraph);
  assert.equal(l.group('fuel_bargraph'), l.fuel);
  assert.deepEqual(l.fuel.members, [...FUEL_BARGRAPH.members]);
  assert.ok(new Lamp(new TimerWheel(), LAMPS[0], 0) instanceof Lamp);

  const nameFns = ['isLit', 'lightOn', 'steady', 'overlay', 'getField', 'getOnIdx', 'setField', 'setOnIdx', 'on', 'off', 'turnOn', 'turnOff', 'flash',
    'flasherStart', 'flashThenOn', 'flashThenOff', 'timedOn', 'timedOff', 'resetTimed', 'toggleValue', 'resetAndToggleValue'];
  for (const fn of nameFns) {
    assert.throws(() => l[fn]('nope', 1), TypeError, fn);
    assert.throws(() => l[fn](undefined, 1), TypeError, fn);
  }
  assert.throws(() => l.group('nope'), TypeError);
  assert.throws(() => l.onLampTimer('nope', () => {}), TypeError);
});

test('verb argument-less / defaults: flash(L) and flashThenOff(L, 0) flash until reset', () => {
  const l = createLamps();
  l.flash('lite1');
  l.advanceMs(100000);
  assert.equal(l.overlay('lite1'), 'flash');
  l.resetTimed('lite1');
  assert.equal(l.overlay('lite1'), 'none');
  l.on('lite8');
  l.flashThenOff('lite8', 0);
  l.advanceMs(100000);
  assert.equal(l.overlay('lite8'), 'flash');
  assert.equal(l.steady('lite8'), true, 'S stays true while flashing forever');
});

// =====================================================================================================================================
// SPEC 5.13.6 test vectors
// =====================================================================================================================================
test('T1 flash(L, 5) on an off lamp: lit [0,100), dark [100,200), ...; timeout wins the tie at 5000, no extra pulse', () => {
  const l = createLamps();
  l.flash('lite1', 5);
  assert.equal(l.steady('lite1'), false);
  assert.equal(l.lightOn('lite1'), true, 'FLASH counts as light_on');
  eachMs(l, 0, 6000, (t) => {
    const expected = t < 5000 && Math.floor(t / 100) % 2 === 0;
    assert.equal(l.isLit('lite1'), expected, `t=${t}`);
    if (t >= 5000) { assert.equal(l.overlay('lite1'), 'none'); assert.equal(l.steady('lite1'), false); assert.equal(l.lightOn('lite1'), false); }
  });
});

test('T2 group nextOn on an all-off 3-lamp group; a second nextOn at 500 targets lamp1 and lamp0 keeps flashing', () => {
  const l = createLamps();
  const g = l.group('bsink_arrow_lights'); // lite2, lite3, lite4
  assert.deepEqual(g.members, ['lite2', 'lite3', 'lite4']);
  assert.equal(g.nextOn(), true);
  assert.equal(l.steady('lite2'), true, 'S true immediately');
  assert.equal(g.count(), 1);
  eachMs(l, 0, 2600, (t) => {
    if (t === 500) {
      assert.equal(l.isLit('lite2'), true);
      assert.equal(g.nextOn(), true);
      assert.equal(g.count(), 2);
      assert.equal(l.steady('lite3'), true);
      assert.equal(l.isLit('lite2'), true, 'lamp0 flash continues');
    }
    const e0 = t < 2000 ? Math.floor(t / 100) % 2 === 1 : true;
    const e1 = t < 500 ? false : t < 2500 ? Math.floor((t - 500) / 100) % 2 === 1 : true;
    assert.equal(l.isLit('lite2'), e0, `lamp0 t=${t}`);
    assert.equal(l.isLit('lite3'), e1, `lamp1 t=${t}`);
    assert.equal(l.isLit('lite4'), false);
  });
  assert.equal(l.overlay('lite2'), 'none');
  assert.equal(l.overlay('lite3'), 'none');
  // all lit: returns false and does nothing
  assert.equal(g.nextOn(), true);
  assert.equal(g.count(), 3);
  assert.equal(g.nextOn(), false);
  assert.equal(g.count(), 3);
});

test('T3 three lane lamps lit then completed: count 3 -> broadcast flash(5) + turnOff: count 0 at once, blink in sync (dark first) until 5000', () => {
  const l = createLamps();
  const g = l.group('bmpr_inc_lights');
  for (const m of g.members) l.on(m);
  assert.equal(g.count(), 3);
  g.broadcast('flash', 5);
  g.broadcast('turnOff');
  assert.equal(g.count(), 0, 'count 0 at once');
  eachMs(l, 0, 5600, (t) => {
    const expected = t < 5000 && Math.floor(t / 100) % 2 === 1; // dark first
    for (const m of g.members) assert.equal(l.isLit(m), expected, `${m} t=${t}`);
    if (t >= 5000) for (const m of g.members) { assert.equal(l.overlay(m), 'none'); assert.equal(l.steady(m), false); }
    if (t < 5000) assert.ok(g.members.every((m) => l.overlay(m) === 'flash'), 'a flashing lane (ignores passes) is observable');
  });
});

test('T4 tilt: every lamp dark at once, lite77 flashes lit 800 / dark 200 (lit first), steady flags unchanged, clearTiltLock restores', () => {
  const l = createLamps();
  const hooked = [];
  l.onLampTimer('lite200', (n) => hooked.push(n));
  l.on('lite1'); l.on('lite8'); l.on('literoll179');
  l.flash('lite2', 10);
  l.timedOn('lite3', 2);
  l.timedOn('lite200', 3);
  l.group('hyperspace_lights').nextOn(5);
  l.advanceMs(1234);
  const steadyBefore = steadyOf(l, l.names);
  l.tiltOff();
  const T = l.nowMs();
  assert.deepEqual(steadyOf(l, l.names), steadyBefore, 'steady flags unchanged');
  for (const n of l.names) if (n !== 'lite77') assert.equal(l.isLit(n), false, n);
  eachMs(l, 0, 3000, (dt) => {
    const phase = dt % 1000;
    assert.equal(l.isLit('lite77'), phase < 800, `lite77 dt=${dt}`);
    if (dt % 500 === 0) for (const n of l.names) if (n !== 'lite77') assert.equal(l.isLit(n), false, `${n} dt=${dt}`);
  });
  assert.equal(T, 1234);
  assert.deepEqual(hooked, [], 'tilt cancels timeouts silently (no hook)');
  assert.deepEqual(steadyOf(l, l.names), steadyBefore);
  l.clearTiltLock();
  for (const n of l.names) { assert.equal(l.overlay(n), 'none', n); assert.equal(l.isLit(n), steadyBefore[l.names.indexOf(n)], n); }
  l.advanceMs(20000);
  assert.deepEqual(hooked, []);
  assert.equal(l.isLit('lite1'), true);
  assert.equal(l.isLit('lite77'), false);
});

test('T4b tilt: the lamp flashing before the tilt does not resume, group chases keep running invisibly, fuel countdown is cleared', () => {
  const l = createLamps();
  const g = l.group('outer_circle');
  for (let i = 0; i < 4; i++) g.nextOn(0.01);
  l.advanceMs(100);
  g.animationBackward(0.1);
  l.fuel.setLevel(11);
  const ended = [];
  l.fuel.setHooks({ ended: () => ended.push(l.nowMs()), tick: () => ended.push('tick') });
  l.tiltOff();
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  for (let i = 0; i < 50; i++) {
    l.advanceMs(37);
    for (const n of l.names) if (n !== 'lite77') assert.equal(l.isLit(n), false, `${n} visible during tilt`);
  }
  assert.equal(g.isAnimating(), true);
  l.advanceMs(100000);
  assert.deepEqual(ended, [], 'fuel hooks do not fire after a tilt');
  l.clearTiltLock();
  // the chase now becomes visible again (its next tick re-applies the overlay layer)
  l.advanceMs(100);
  assert.ok(g.members.some((m) => l.overlay(m) !== 'none'));
});

test('T5 fuel: ticks at 4,7,13,16,24,27,37,40,52,55,69 s, dark + ended at 72 s (App. D #7); beforeSetLevel / tick ordering', () => {
  const l = createLamps();
  const events = [];
  const members = l.fuel.members;
  const litCount = () => members.filter((m) => l.steady(m)).length;
  l.fuel.setHooks({
    beforeSetLevel: (L) => events.push({ k: 'before', L, level: l.fuel.level, lit: litCount(), t: l.nowMs() }),
    tick: (level) => events.push({ k: 'tick', level, now: l.fuel.level, lit: litCount(), t: l.nowMs() }),
    ended: () => events.push({ k: 'ended', level: l.fuel.level, lit: litCount(), t: l.nowMs() }),
  });
  l.advanceMs(1000); // start the countdown at a non-zero absolute time
  l.fuel.setLevel(11);
  assert.deepEqual(events, [{ k: 'before', L: 11, level: 0, lit: 0, t: 1000 }], 'beforeSetLevel runs BEFORE the update');
  assert.equal(l.fuel.level, 11);
  assert.equal(litCount(), 6);
  events.length = 0;
  const tickTimes = [4, 7, 13, 16, 24, 27, 37, 40, 52, 55, 69];
  const levels = [];
  let t = 0;
  for (const s of tickTimes) {
    l.advanceMs(s * 1000 - 1 - t);
    levels.push(l.fuel.level);
    l.advanceMs(1);
    t = s * 1000;
    levels.push(l.fuel.level);
  }
  const expectedLevels = [];
  for (let L = 11; L >= 1; L--) expectedLevels.push(L, L - 1);
  assert.deepEqual(levels, expectedLevels);
  // events: before(L-1) then tick(L-1) at every change, the update lies between them
  const ticks = events.filter((e) => e.k === 'tick');
  assert.deepEqual(ticks.map((e) => (e.t - 1000) / 1000), tickTimes);
  assert.deepEqual(ticks.map((e) => e.level), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  for (let i = 0; i < ticks.length; i++) {
    const b = events[2 * i];
    const k = events[2 * i + 1];
    assert.equal(b.k, 'before');
    assert.equal(k.k, 'tick');
    assert.equal(b.L, 10 - i);
    assert.equal(b.level, 11 - i, 'before: still the OLD level');
    assert.equal(b.lit, Math.floor((11 - i) / 2) + 1, 'before: lamps not yet updated');
    assert.equal(k.now, 10 - i, 'tick: updated');
    assert.equal(k.lit, Math.floor((10 - i) / 2) + 1, 'tick: lamps updated');
  }
  assert.equal(events.filter((e) => e.k === 'ended').length, 0);
  l.advanceMs(2999);
  assert.equal(events.filter((e) => e.k === 'ended').length, 0);
  assert.equal(l.fuel.level, 0);
  assert.equal(litCount(), 1, 'level 0 still shows the last lamp (flashing)');
  l.advanceMs(1);
  const ended = events.filter((e) => e.k === 'ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].t, 1000 + 72000);
  assert.equal(ended[0].lit, 0, 'everything is dark when ended is raised');
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  for (const m of members) { assert.equal(l.isLit(m), false); assert.equal(l.overlay(m), 'none'); }
  const n = events.length;
  l.advanceMs(500000);
  assert.equal(events.length, n, 'nothing more after the end');
});

test('fuel lamps per level: floor(level/2)+1 lit, the top lit lamp flashes at every EVEN level (dark first)', () => {
  const l = createLamps();
  const members = [...FUEL_BARGRAPH.members];
  for (let L = 11; L >= 0; L--) {
    l.fuel.setLevel(L);
    const lit = members.filter((m) => l.steady(m));
    assert.equal(lit.length, Math.floor(L / 2) + 1, `level ${L}`);
    assert.deepEqual(lit, members.slice(0, lit.length), 'lamps 0..split are the lit ones');
    const flashing = members.filter((m) => l.overlay(m) === 'flash');
    if (L % 2 === 0) assert.deepEqual(flashing, [members[Math.floor(L / 2)]], `level ${L}`); else assert.deepEqual(flashing, []);
    if (L % 2 === 0) {
      const top = members[Math.floor(L / 2)];
      assert.equal(l.isLit(top), false, 'flash starts dark (S is true)');
      l.advanceMs(100); assert.equal(l.isLit(top), true);
      l.advanceMs(100); assert.equal(l.isLit(top), false);
    }
  }
  assert.equal(l.fuel.level, 0);
});

test('fuel: refuel restarts the countdown, level clamps / floors, negative level turns everything off, NaN throws', () => {
  const l = createLamps();
  const ticks = [];
  l.fuel.setHooks({ tick: (v) => ticks.push([v, l.nowMs()]) });
  l.fuel.setLevel(11);
  l.advanceMs(2000);
  l.fuel.setLevel(11);
  l.advanceMs(3999);
  assert.deepEqual(ticks, []);
  l.advanceMs(1);
  assert.deepEqual(ticks, [[10, 6000]], 'second refuel at 2 s restarts the 4 s level-11 timer');
  l.fuel.setLevel(99);
  assert.equal(l.fuel.level, 11);
  l.fuel.setLevel(3.9);
  assert.equal(l.fuel.level, 3);
  l.fuel.setLevel(-1);
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  assert.ok(l.fuel.members.every((m) => !l.steady(m) && l.overlay(m) === 'none'));
  const before = ticks.length;
  l.advanceMs(200000);
  assert.equal(ticks.length, before);
  assert.throws(() => l.fuel.setLevel(NaN), TypeError);
  assert.throws(() => l.fuel.setLevel('3'), TypeError);
});

test('fuel quirk: all six lamps may be lit by the rules while level stays 0 with no countdown', () => {
  const l = createLamps();
  const seen = [];
  l.fuel.setHooks({ beforeSetLevel: (v) => seen.push(['b', v]), tick: (v) => seen.push(['t', v]), ended: () => seen.push(['e']) });
  for (const m of l.fuel.members) l.on(m);
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  l.advanceMs(100000);
  assert.deepEqual(seen, []);
  assert.ok(l.fuel.members.every((m) => l.isLit(m)));
});

test('fuel: reset(), hook replacement, re-entrancy (tick hook refuels), no hooks from reset', () => {
  const l = createLamps();
  const log = [];
  l.fuel.setHooks({ tick: (v) => log.push(['A', v]) });
  l.fuel.setHooks({ ended: () => log.push(['ended']) }); // replaces: tick hook gone
  l.fuel.setLevel(11);
  l.advanceMs(4000);
  assert.deepEqual(log, []);
  l.fuel.reset();
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  assert.ok(l.fuel.members.every((m) => !l.steady(m)));
  l.advanceMs(100000);
  assert.deepEqual(log, []);

  const l2 = createLamps();
  const times = [];
  let refuelled = false;
  l2.fuel.setHooks({
    tick: (v) => {
      times.push([v, l2.nowMs()]);
      if (v === 1 && !refuelled) { refuelled = true; l2.fuel.setLevel(11); l2.timedOn(l2.fuel.members[0], 1); }
    },
  });
  l2.fuel.setLevel(11);
  l2.advanceMs(55000);
  assert.deepEqual(times.at(-1), [1, 55000]);
  assert.equal(l2.fuel.level, 11, 'refuelled from inside the tick hook');
  l2.advanceMs(4000);
  assert.deepEqual(times.at(-1), [10, 59000]);
});

// =====================================================================================================================================
// T6 + hooks and re-entrancy
// =====================================================================================================================================
test('T6 ball save lite200: on, timedOn(5): light_on true until t=10 via the hook idiom (flashThenOff(5)); flashing 5..10; off at 10', () => {
  const l = createLamps();
  const calls = [];
  l.onLampTimer('lite200', (name) => {
    calls.push([name, l.nowMs(), l.overlay(name), l.steady(name)]);
    if (l.getField(name) === 0) { l.flashThenOff(name, 5); l.setField(name, 1); } else { l.setField(name, 0); }
  });
  l.on('lite200');
  l.timedOn('lite200', 5);
  eachMs(l, 0, 10500, (t) => {
    if (t < 5000) {
      assert.equal(l.overlay('lite200'), 'on', `t=${t}`);
      assert.equal(l.isLit('lite200'), true);
      assert.equal(l.lightOn('lite200'), true);
    } else if (t < 10000) {
      assert.equal(l.overlay('lite200'), 'flash', `t=${t}`);
      assert.equal(l.lightOn('lite200'), true, `light_on true through the flash t=${t}`);
      assert.equal(l.steady('lite200'), true);
      assert.equal(l.isLit('lite200'), Math.floor((t - 5000) / 100) % 2 === 1, `t=${t}`); // dark first (S is true)
    } else {
      assert.equal(l.lightOn('lite200'), false, `t=${t}`);
      assert.equal(l.isLit('lite200'), false);
      assert.equal(l.steady('lite200'), false);
      assert.equal(l.overlay('lite200'), 'none');
    }
  });
  // the hook saw the finished state: overlay already NONE; at the second expiry S already false
  assert.deepEqual(calls, [['lite200', 5000, 'none', true], ['lite200', 10000, 'none', false]]);
  assert.equal(l.getField('lite200'), 0);
});

test('hooks: only LAMP_HOOK_NAMES, replace on re-register, null clears, a hook may re-arm its own lamp, errors are TypeErrors', () => {
  const l = createLamps();
  assert.deepEqual([...LAMP_HOOK_NAMES], ['lite17', 'lite59', 'lite60', 'lite200']);
  for (const h of LAMP_HOOK_NAMES) l.onLampTimer(h, () => {});
  assert.throws(() => l.onLampTimer('lite1', () => {}), TypeError);
  assert.throws(() => l.onLampTimer('lite17', 42), TypeError);
  const a = []; const b = [];
  l.onLampTimer('lite59', () => a.push(l.nowMs()));
  l.onLampTimer('lite59', () => b.push(l.nowMs()));
  l.timedOn('lite59', 1);
  l.advanceMs(1000);
  assert.deepEqual(a, []);
  assert.deepEqual(b, [1000]);
  l.onLampTimer('lite59', null);
  l.timedOn('lite59', 1);
  l.advanceMs(1000);
  assert.deepEqual(b, [1000]);
  // hook re-arms and flashes the SAME lamp: timed on twice, then flashes once
  const c = [];
  const t0 = l.nowMs();
  l.onLampTimer('lite60', (n) => { c.push(l.nowMs() - t0); if (c.length < 3) l.timedOn(n, 0.5); else l.flash(n, 0.2); });
  l.timedOn('lite60', 0.5);
  l.advanceMs(1000);
  assert.deepEqual(c, [500, 1000]);
  l.advanceMs(500);
  assert.deepEqual(c, [500, 1000, 1500]);
  assert.equal(l.overlay('lite60'), 'flash');
  l.advanceMs(200);
  assert.deepEqual(c, [500, 1000, 1500, 1700], 'the flash timeout raises the hook as well; it flashes again');
  assert.equal(l.overlay('lite60'), 'flash');
  l.resetTimed('lite60');
  l.onLampTimer('lite60', null);
  l.advanceMs(10000);
  assert.equal(c.length, 4);
});

test('hooks: a hook that touches other lamps / the same timestamp is processed in the same advanceMs call (single big advance)', () => {
  const l = createLamps();
  const seen = [];
  l.onLampTimer('lite17', (n) => {
    seen.push([n, l.nowMs()]);
    if (l.overlay(n) === 'none' && l.steady(n)) { l.flashThenOff('lite18', 5); l.flashThenOff(n, 5); }
  });
  l.onLampTimer('lite59', (n) => seen.push([n, l.nowMs()]));
  l.on('lite17'); l.on('lite18');
  l.timedOn('lite17', 55);
  l.timedOn('lite18', 55);
  l.timedOn('lite59', 60);
  l.advanceMs(120000); // one big call
  // lite59's timeout (inserted at t=0) precedes lite17's second timeout (inserted by the hook at 55000) at the shared millisecond 60000
  assert.deepEqual(seen, [['lite17', 55000], ['lite59', 60000], ['lite17', 60000]]);
  assert.equal(l.steady('lite17'), false, 'off after 55 + 5');
  assert.equal(l.steady('lite18'), false);
  assert.equal(l.overlay('lite17'), 'none');
});

// =====================================================================================================================================
// Lamp verbs
// =====================================================================================================================================
test('verbs: on/off reset overlays, turnOn/turnOff touch only S, lightOn vs isLit under FORCE_OFF', () => {
  const l = createLamps();
  l.flash('lite1', 5);
  l.turnOn('lite1');
  assert.equal(l.overlay('lite1'), 'flash');
  assert.equal(l.steady('lite1'), true);
  l.on('lite1');
  assert.equal(l.overlay('lite1'), 'none');
  assert.equal(l.isLit('lite1'), true);
  l.timedOff('lite1', 2);
  assert.equal(l.isLit('lite1'), false, 'visual state is dark');
  assert.equal(l.lightOn('lite1'), true, 'rules still see it as lit (FORCE_OFF does not count as off)');
  l.turnOff('lite1');
  assert.equal(l.lightOn('lite1'), false);
  l.advanceMs(2000);
  assert.equal(l.overlay('lite1'), 'none');
  assert.equal(l.isLit('lite1'), false);
  l.timedOn('lite1', 2);
  assert.equal(l.isLit('lite1'), true);
  assert.equal(l.steady('lite1'), false);
  assert.equal(l.lightOn('lite1'), true, 'FORCE_ON counts');
  l.advanceMs(2000);
  assert.equal(l.isLit('lite1'), false, 'timedOn returns to S (off), not to on');
  l.off('lite1');
  assert.equal(l.steady('lite1'), false);
});

test('verbs: timedOn returns to S (lit stays lit), ONE shared timeout (the last timed verb wins), tiny durations never become indefinite', () => {
  const l = createLamps();
  l.on('lite1');
  l.timedOff('lite1', 1);
  l.advanceMs(999);
  assert.equal(l.isLit('lite1'), false);
  l.advanceMs(1);
  assert.equal(l.isLit('lite1'), true);
  // shared timeout: second verb replaces the first timeout
  l.timedOn('lite8', 1);
  l.timedOn('lite8', 3);
  l.advanceMs(2999);
  assert.equal(l.overlay('lite8'), 'on');
  l.advanceMs(1);
  assert.equal(l.overlay('lite8'), 'none');
  // truncation to ms
  l.timedOn('lite9', 0.0509);
  l.advanceMs(49); assert.equal(l.overlay('lite9'), 'on');
  l.advanceMs(1); assert.equal(l.overlay('lite9'), 'none');
  // sub-millisecond duration expires after 1 ms and is not indefinite
  l.timedOn('lite10', 0.0004);
  assert.equal(l.overlay('lite10'), 'on');
  l.advanceMs(1);
  assert.equal(l.overlay('lite10'), 'none');
  // t = 0 is indefinite and cancels an earlier timeout
  l.timedOff('lite11', 1);
  l.timedOff('lite11', 0);
  l.advanceMs(100000);
  assert.equal(l.overlay('lite11'), 'off');
  l.resetTimed('lite11');
  assert.equal(l.overlay('lite11'), 'none');
});

test('verbs: flash waveform starts opposite of S, a second flash verb does not restart it, flasherStart cancels the timeout', () => {
  const l = createLamps();
  l.on('lite1');
  l.flash('lite1', 10);
  assert.equal(l.isLit('lite1'), false, 'S true -> dark first');
  l.advanceMs(150);
  assert.equal(l.isLit('lite1'), true);
  l.flash('lite1', 10); // waveform not restarted
  assert.equal(l.isLit('lite1'), true);
  l.advanceMs(49); assert.equal(l.isLit('lite1'), true);
  l.advanceMs(1); assert.equal(l.isLit('lite1'), false, 'toggle stays on the original 100 ms grid');
  // replaced timeout: now 10 s from the second flash call at t=150
  l.advanceMs(10150 - 200 - 1);
  assert.equal(l.overlay('lite1'), 'flash');
  l.advanceMs(1);
  assert.equal(l.overlay('lite1'), 'none');
  assert.equal(l.steady('lite1'), true);
  // flasherStart cancels the timeout
  l.flash('lite8', 1);
  l.flasherStart('lite8');
  l.advanceMs(5000);
  assert.equal(l.overlay('lite8'), 'flash');
  l.flasherStart('lite8'); // no restart
  const lit = l.isLit('lite8');
  l.advanceMs(1);
  assert.equal(l.isLit('lite8'), lit);
});

test('verbs: flashThenOn counts at once and ends lit; flashThenOff stays S until the timeout; flashThenOn after flashThenOff cancels the off', () => {
  const l = createLamps();
  const g = l.group('bmpr_inc_lights');
  l.flashThenOn('lite8', 2);
  assert.equal(g.count(), 1);
  l.advanceMs(2000);
  assert.equal(l.steady('lite8'), true);
  assert.equal(l.overlay('lite8'), 'none');
  l.flashThenOff('lite8', 2);
  assert.equal(l.steady('lite8'), true);
  l.advanceMs(1999); assert.equal(l.steady('lite8'), true);
  l.advanceMs(1); assert.equal(l.steady('lite8'), false);
  l.on('lite9');
  l.flashThenOff('lite9', 2);
  l.flashThenOn('lite9', 1);
  l.advanceMs(1000);
  assert.equal(l.steady('lite9'), true, 'offAfter was cleared by flashThenOn');
  // flashThenOff on an unlit lamp: lit first
  l.flashThenOff('lite10', 1);
  assert.equal(l.isLit('lite10'), true);
  l.advanceMs(1000);
  assert.equal(l.isLit('lite10'), false);
});

test('verbs: toggleValue / resetAndToggleValue / field / onIdx', () => {
  const l = createLamps();
  l.flash('lite1', 5);
  l.toggleValue('lite1', 1);
  assert.equal(l.steady('lite1'), true);
  assert.equal(l.overlay('lite1'), 'flash');
  l.resetAndToggleValue('lite1', 0);
  assert.equal(l.steady('lite1'), false);
  assert.equal(l.overlay('lite1'), 'none');
  l.toggleValue('lite1', 2.7);
  assert.equal(l.steady('lite1'), true);
  l.toggleValue('lite1', 0.9);
  assert.equal(l.steady('lite1'), false, 'floor(0.9) == 0');
  l.setField('lite198', 7.9);
  assert.equal(l.getField('lite198'), 7);
  l.setField('lite198', -2.5);
  assert.equal(l.getField('lite198'), -3);
  l.setField('lite198', NaN);
  assert.equal(l.getField('lite198'), 0);
  // ResetTimed keeps S / field / onIdx
  l.setField('lite2', 5); l.setOnIdx('lite2', 2); l.on('lite2'); l.flash('lite2', 3); l.resetTimed('lite2');
  assert.equal(l.steady('lite2'), true); assert.equal(l.getField('lite2'), 5); assert.equal(l.getOnIdx('lite2'), 2);
  // onIdx clamps to nStates - 1 (3 images only on lite2/3/4)
  for (const n of ['lite2', 'lite3', 'lite4']) {
    l.setOnIdx(n, 5); assert.equal(l.getOnIdx(n), 2);
    l.setOnIdx(n, -3); assert.equal(l.getOnIdx(n), 0);
    l.setOnIdx(n, 1.9); assert.equal(l.getOnIdx(n), 1);
  }
  for (const n of ['lite1', 'lite5', 'lite200', 'literoll179']) { l.setOnIdx(n, 2); assert.equal(l.getOnIdx(n), 0, n); }
});

test('flash timing per lamp comes from the data: 131 lamps 0.1/0.1, nine overrides', () => {
  const overrides = Object.keys(LAMP_FLASH_OVERRIDES);
  assert.deepEqual(overrides.sort(), ['lite29', 'lite30', 'lite5', 'lite6', 'lite62', 'lite7', 'lite77', 'lite84', 'lite85']);
  for (const def of LAMPS) {
    const l = createLamps();
    l.flasherStart(def.name); // S false -> lit first, lit phase = on, dark phase = off
    const onMs = Math.round(def.flash.on * 1000);
    const offMs = Math.round(def.flash.off * 1000);
    assert.equal(l.isLit(def.name), true);
    l.advanceMs(onMs - 1); assert.equal(l.isLit(def.name), true, `${def.name} lit phase`);
    l.advanceMs(1); assert.equal(l.isLit(def.name), false, `${def.name} dark phase starts at ${onMs}`);
    l.advanceMs(offMs - 1); assert.equal(l.isLit(def.name), false);
    l.advanceMs(1); assert.equal(l.isLit(def.name), true);
  }
  assert.deepEqual({ ...LAMP_FLASH_OVERRIDES.lite5 }, { off: 0.1, on: 0.2 });
  assert.deepEqual({ ...LAMP_FLASH_OVERRIDES.lite77 }, { off: 0.2, on: 0.8 });
  assert.deepEqual({ ...LAMP_FLASH_OVERRIDES.lite29 }, { off: 0.1, on: 0.4 });
  assert.deepEqual({ ...LAMP_FLASH_OVERRIDES.lite62 }, { off: 0.2, on: 0.2 });
});

test('a timeout and a flash toggle due on the same ms: the timeout wins even if the toggle was inserted first', () => {
  const l = createLamps();
  l.flasherStart('lite1'); // toggles at 100, 200, ...
  l.advanceMs(4950); // at 4950 the pending toggle is due at 5000 and is already inserted
  l.flash('lite1', 0.05); // timeout also due at 5000
  const lit4999 = [];
  eachMs(l, 4950, 5001, (t) => lit4999.push([t, l.isLit('lite1'), l.overlay('lite1')]));
  const at5000 = lit4999.at(-1);
  assert.equal(at5000[0], 5000);
  assert.equal(at5000[2], 'none', 'timeout processed at 5000');
  assert.equal(l.isLit('lite1'), false);
  l.advanceMs(1000);
  assert.equal(l.isLit('lite1'), false, 'no stray toggle fired after the timeout');
  assert.equal(l.overlay('lite1'), 'none');
});

test('advance(dt): fractional ms are carried; 120 steps of 1/120 s are exactly 1000 ms; bad dt is ignored', () => {
  const l = createLamps();
  for (let i = 0; i < 120; i++) l.advance(1 / 120);
  assert.equal(l.nowMs(), 1000);
  for (let i = 0; i < 12000; i++) l.advance(1 / 120);
  assert.equal(l.nowMs(), 101000);
  const m = createLamps();
  for (let i = 0; i < 10; i++) m.advance(0.0004);
  assert.equal(m.nowMs(), 4);
  m.advance(-1); m.advance(NaN); m.advance(0); m.advance(Infinity);
  assert.equal(m.nowMs(), 4);
  m.flash('lite1', 0.25);
  for (let i = 0; i < 30; i++) m.advance(1 / 120); // 250 ms
  assert.equal(m.overlay('lite1'), 'none');
});

// =====================================================================================================================================
// Group verbs
// =====================================================================================================================================
test('group: count / nextOn picks the lowest unlit / dropTop picks the highest lit (steady, no flash) / offsetForward', () => {
  const l = createLamps();
  const g = l.group('right_target_lights'); // lite61, lite60, lite59, lite58
  assert.deepEqual(g.members, ['lite61', 'lite60', 'lite59', 'lite58']);
  assert.equal(g.dropTop(), false);
  assert.equal(g.offsetForward(), true);
  assert.deepEqual(steadyOf(l, g.members), [true, false, false, false]);
  assert.equal(l.overlay('lite61'), 'none', 'offsetForward is steady, no flash');
  assert.equal(g.nextOn(), true);
  assert.deepEqual(steadyOf(l, g.members), [true, true, false, false]);
  assert.equal(l.overlay('lite60'), 'flash');
  assert.equal(g.nextOn(5), true);
  assert.equal(g.nextOn(5), true);
  assert.equal(g.nextOn(), false);
  assert.equal(g.count(), 4);
  assert.equal(g.offsetForward(), false);
  assert.equal(g.dropTop(), true);
  assert.deepEqual(steadyOf(l, g.members), [true, true, true, false]);
  assert.equal(l.overlay('lite58'), 'none', 'dropTop cancels the pending flash of the top lamp');
  assert.equal(l.isLit('lite58'), false);
  // dropTop leaves a hole-free ladder from the bottom: hole case
  l.off('lite60');
  assert.equal(g.nextOn(), true, 'nextOn fills the lowest unlit member');
  assert.equal(l.steady('lite60'), true);
  l.advanceMs(2000);
  assert.equal(l.overlay('lite60'), 'none');
  assert.equal(g.dropTop(), true);
  assert.deepEqual(steadyOf(l, g.members), [true, true, false, false]);
});

test('group: stepBackward moves the pattern toward higher index with wrap, stepForward the other way; field travels with S', () => {
  const l = createLamps();
  const g = l.group('bmpr_inc_lights'); // lite8, lite9, lite10
  l.on('lite8');
  l.setField('lite8', 7);
  const pat = () => steadyOf(l, g.members).map(Number).join('');
  assert.equal(pat(), '100');
  g.stepBackward(); assert.equal(pat(), '010'); assert.equal(l.getField('lite9'), 7); assert.equal(l.getField('lite8'), 0);
  g.stepBackward(); assert.equal(pat(), '001');
  g.stepBackward(); assert.equal(pat(), '100', 'wraps'); assert.equal(l.getField('lite8'), 7);
  g.stepForward(); assert.equal(pat(), '001', 'wraps the other way');
  g.stepForward(); assert.equal(pat(), '010');
  g.stepForward(); assert.equal(pat(), '100');
  // two lit lamps rotate together
  l.on('lite9');
  g.stepBackward(); assert.equal(pat(), '011');
  g.stepBackward(); assert.equal(pat(), '101');
  // ignored while the LAST member is flashing / in any overlay
  l.flash('lite10', 5);
  g.stepBackward(); assert.equal(pat(), '101');
  g.stepForward(); assert.equal(pat(), '101');
  l.resetTimed('lite10');
  l.timedOn('lite10', 5);
  g.stepBackward(); assert.equal(pat(), '101');
  l.resetTimed('lite10');
  // a flashing NON-last member does not block, the overlay stays with the lamp position
  l.flash('lite8', 5);
  g.stepBackward(); assert.equal(pat(), '110');
  assert.equal(l.overlay('lite8'), 'flash');
  // single-member / empty safety: stepping a group never throws
  for (const name of LAMP_GROUP_NAMES) { l.group(name).stepBackward(); l.group(name).stepForward(); }
});

test('group chase: first frame already shifted, repeats every step, S untouched, groupReset restores the display', () => {
  const l = createLamps();
  const g = l.group('bmpr_inc_lights'); // default step 0.08 -> 80 ms
  l.on('lite8');
  const disp = () => lampsLit(l, g.members).map(Number).join('');
  const stdy = () => steadyOf(l, g.members).map(Number).join('');
  assert.equal(g.isAnimating(), false);
  g.animationBackward(0);
  assert.equal(g.isAnimating(), true);
  assert.equal(disp(), '010', 'shifted by one in the same call');
  assert.equal(stdy(), '100', 'steady layer untouched');
  l.advanceMs(79); assert.equal(disp(), '010');
  l.advanceMs(1); assert.equal(disp(), '001');
  l.advanceMs(80); assert.equal(disp(), '100');
  l.advanceMs(80); assert.equal(disp(), '010');
  assert.equal(stdy(), '100');
  g.groupReset();
  assert.equal(g.isAnimating(), false);
  assert.equal(disp(), '100', 'back to S');
  assert.ok(g.members.every((m) => l.overlay(m) === 'none'));
  l.advanceMs(1000);
  assert.equal(disp(), '100');

  // Forward = toward lower index; explicit step
  g.animationForward(0.25);
  assert.equal(disp(), '001');
  l.advanceMs(249); assert.equal(disp(), '001');
  l.advanceMs(1); assert.equal(disp(), '010');
  l.advanceMs(250); assert.equal(disp(), '100');
  // restart: re-mirrors S
  g.animationBackward(0.1);
  assert.equal(disp(), '010');
  l.advanceMs(100); assert.equal(disp(), '001');
  g.groupReset();

  // 0.2 s default for the trek groups, 0.08 for the rest
  const t = l.group('l_trek_lights');
  l.on('lite190');
  t.animationBackward();
  assert.equal(l.isLit('lite191'), true);
  l.advanceMs(199); assert.equal(l.isLit('lite191'), true);
  l.advanceMs(1); assert.equal(l.isLit('lite192'), true);
  assert.equal(t.members.length, 5);
  t.groupReset();
  assert.equal(l.isLit('lite190'), true);
});

test('group chase over a 9-lamp ring wraps and keeps one lit lamp moving; mirror of a group with no lit lamp stays dark', () => {
  const l = createLamps();
  const g = l.group('middle_circle');
  g.animationBackward(); // all off: nothing visible
  for (let i = 0; i < 30; i++) { assert.ok(g.members.every((m) => !l.isLit(m))); l.advanceMs(80); }
  g.groupReset();
  l.on('lite154');
  g.animationBackward();
  const seen = [];
  for (let i = 0; i < 10; i++) { seen.push(g.members.findIndex((m) => l.isLit(m))); l.advanceMs(80); }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 0, 1]);
  g.groupReset();
  assert.equal(l.isLit('lite154'), true);
});

test('groupReset on a group that is not animating keeps flashing members; it stops game-over animation without touching overlays', () => {
  const l = createLamps();
  const g = l.group('bmpr_inc_lights');
  l.flash('lite8', 5);
  g.groupReset();
  assert.equal(l.overlay('lite8'), 'flash');
  l.flash('lite9', 5);
  l.group('bmpr_inc_lights').gameOver(1.4);
  assert.equal(g.isAnimating(), true);
  g.groupReset();
  assert.equal(g.isAnimating(), false);
});

test('lightShow: 29 % of the members get a forced-on pulse of 0.1 + u*3*step every step (scripted rand)', () => {
  // per tick 3 members: [hit u=.5], [miss], [hit u=0]  -> 0.9 .5 | 0.1 | 0.75 0
  const l = createLamps({ rand: sequenceRand([0.9, 0.5, 0.1, 0.75, 0.0]) });
  const g = l.group('bmpr_inc_lights');
  g.lightShow(0.2);
  assert.equal(g.isAnimating(), true);
  l.advanceMs(199);
  assert.ok(g.members.every((m) => !l.isLit(m)));
  l.advanceMs(1); // tick 1 at 200
  assert.deepEqual(lampsLit(l, g.members), [true, false, true]);
  l.advanceMs(99); assert.deepEqual(lampsLit(l, g.members), [true, false, true]);
  l.advanceMs(1); assert.deepEqual(lampsLit(l, g.members), [true, false, false], 'lamp2 pulse = 0.1 s');
  l.advanceMs(99); // t=399
  assert.deepEqual(lampsLit(l, g.members), [true, false, false]);
  l.advanceMs(1); // tick 2 at 400: same script again -> lamp0 pulse restarts (0.4 s), lamp2 lit again
  assert.deepEqual(lampsLit(l, g.members), [true, false, true]);
  l.advanceMs(399); // t=799
  assert.equal(l.isLit('lite8'), true);
  g.groupReset();
  assert.equal(g.isAnimating(), false);
  assert.ok(g.members.every((m) => l.overlay(m) === 'none'), 'groupReset clears every pulse');
  l.advanceMs(5000);
  assert.ok(g.members.every((m) => !l.isLit(m)));
});

test('lightShow on the all-lamps group hits about 29 % of the 140 lamps per tick and is deterministic for a seed', () => {
  let total = 0;
  const runs = 40;
  for (let seed = 1; seed <= runs; seed++) {
    const l = createLamps({ rand: mulberry32(seed) });
    l.group('all').lightShow();
    l.advanceMs(200);
    total += l.names.filter((n) => l.overlay(n) === 'on').length;
  }
  const mean = total / runs;
  assert.ok(mean > 0.25 * 140 && mean < 0.33 * 140, `mean hits ${mean}`);
  const a = createLamps({ rand: mulberry32(7) }); const b = createLamps({ rand: mulberry32(7) });
  a.group('all').lightShow(); b.group('all').lightShow();
  for (let i = 0; i < 40; i++) { a.advanceMs(100); b.advanceMs(100); assert.deepEqual(lampsLit(a, a.names), lampsLit(b, b.names)); }
});

test('gameOver: immediately and every 1.4 s each lamp is set steady on (29 %) or off, killing overlays; stops on groupReset / resetAll', () => {
  // 3 members: per tick -> lamp0 hit (0.9), lamp1 miss (0.1), lamp2 hit (0.8)
  const l = createLamps({ rand: sequenceRand([0.9, 0.1, 0.8, 0.2, 0.95, 0.3]) });
  const g = l.group('bmpr_inc_lights');
  l.flash('lite9', 20);
  l.timedOn('lite10', 20);
  g.gameOver();
  assert.deepEqual(steadyOf(l, g.members), [true, false, true], 'first tick is immediate');
  assert.ok(g.members.every((m) => l.overlay(m) === 'none'));
  assert.equal(g.isAnimating(), true);
  l.advanceMs(1399);
  assert.deepEqual(steadyOf(l, g.members), [true, false, true]);
  l.advanceMs(1);
  assert.deepEqual(steadyOf(l, g.members), [false, true, false], 'second tick at 1400: 0.2 miss, 0.95 hit, 0.3 miss');
  l.advanceMs(1400);
  assert.deepEqual(steadyOf(l, g.members), [true, false, true]);
  g.groupReset();
  l.advanceMs(10000);
  assert.deepEqual(steadyOf(l, g.members), [true, false, true], 'no more ticks');
  g.gameOver(0.5);
  l.advanceMs(500);
  l.resetAll();
  assert.equal(g.isAnimating(), false);
  assert.deepEqual(steadyOf(l, g.members), [false, false, false]);
  l.advanceMs(5000);
  assert.deepEqual(steadyOf(l, g.members), [false, false, false]);
  // 140-lamp version: about 29 % on
  const m = createLamps({ rand: mulberry32(11) });
  m.group('all').gameOver();
  const on = m.names.filter((n) => m.steady(n)).length;
  assert.ok(on > 20 && on < 62, `on=${on}`);
});

test('flashWhenOn: lit members go S=false at once, blink t seconds (lit first) and end off; unlit members untouched', () => {
  const l = createLamps();
  const g = l.group('skill_shot_lights');
  for (const m of ['lite67', 'lite68', 'lite69']) l.on(m);
  assert.equal(g.count(), 3);
  g.flashWhenOn(1.0);
  assert.equal(g.count(), 0);
  assert.deepEqual(lampsLit(l, g.members), [true, true, true, false, false, false]);
  eachMs(l, 0, 1200, (t) => {
    const expected = t < 1000 && Math.floor(t / 100) % 2 === 0;
    for (const m of ['lite67', 'lite68', 'lite69']) assert.equal(l.isLit(m), expected, `${m} t=${t}`);
    assert.equal(l.overlay('lite131'), 'none');
  });
  assert.ok(g.members.every((m) => !l.steady(m) && l.overlay(m) === 'none'));
});

test('restartNotifyTimer: the group only raises the handler once on expiry; restart replaces; t<=0 cancels; the handler may re-arm', () => {
  const l = createLamps();
  const g = l.group('top_target_lights');
  const calls = [];
  g.onNotifyExpired((name) => calls.push([name, l.nowMs()]));
  g.restartNotifyTimer(30);
  l.advanceMs(29999); assert.deepEqual(calls, []);
  l.advanceMs(1); assert.deepEqual(calls, [['top_target_lights', 30000]]);
  l.advanceMs(100000); assert.equal(calls.length, 1, 'fires once');
  calls.length = 0;
  g.restartNotifyTimer(10);
  l.advanceMs(5000);
  g.restartNotifyTimer(10);
  l.advanceMs(9999); assert.deepEqual(calls, []);
  l.advanceMs(1); assert.equal(calls.length, 1);
  g.restartNotifyTimer(10); g.restartNotifyTimer(0);
  l.advanceMs(100000); assert.equal(calls.length, 1, 'cancelled');
  // the rules idiom: dropTop + restart while count > 0 (the handler runs inside the wheel)
  calls.length = 0;
  for (const m of g.members) l.on(m);
  g.onNotifyExpired((name) => { calls.push(l.nowMs()); g.dropTop(); if (g.count() > 0) g.restartNotifyTimer(30); });
  g.restartNotifyTimer(30);
  l.advanceMs(1000000);
  assert.deepEqual(calls.map((x) => x - calls[0]), [0, 30000, 60000, 90000]);
  assert.equal(g.count(), 0);
  g.onNotifyExpired(null);
  g.restartNotifyTimer(1);
  l.advanceMs(5000);
  assert.equal(calls.length, 4);
});

test('broadcast: LAST member first (observed through same-ms hooks), every verb, unknown verb throws', () => {
  const l = createLamps();
  const g = l.group('right_target_lights'); // lite61, lite60, lite59, lite58
  const order = [];
  l.onLampTimer('lite59', () => order.push('lite59'));
  l.onLampTimer('lite60', () => order.push('lite60'));
  g.broadcast('timedOn', 1);
  l.advanceMs(1000);
  assert.deepEqual(order, ['lite59', 'lite60'], 'index 2 (lite59) before index 1 (lite60)');
  g.broadcast('turnOn'); assert.equal(g.count(), 4);
  g.broadcast('turnOff'); assert.equal(g.count(), 0);
  g.broadcast('on'); assert.equal(g.count(), 4);
  g.broadcast('off'); assert.equal(g.count(), 0);
  g.broadcast('flasherStart'); assert.ok(g.members.every((m) => l.overlay(m) === 'flash'));
  g.broadcast('resetTimed'); assert.ok(g.members.every((m) => l.overlay(m) === 'none'));
  g.broadcast('flashThenOn', 1); assert.equal(g.count(), 4);
  l.advanceMs(1000); assert.ok(g.members.every((m) => l.overlay(m) === 'none' && l.steady(m)));
  g.broadcast('flashThenOff', 1); l.advanceMs(1000); assert.equal(g.count(), 0);
  g.broadcast('timedOff', 1); assert.ok(g.members.every((m) => l.overlay(m) === 'off'));
  g.broadcast('resetTimed');
  g.broadcast('toggleValue', 1); assert.equal(g.count(), 4);
  g.broadcast('resetAndToggleValue', 0); assert.equal(g.count(), 0);
  g.broadcast('flash', 1); assert.ok(g.members.every((m) => l.overlay(m) === 'flash'));
  g.broadcast('resetTimed');
  g.broadcast('setField', 3); assert.ok(g.members.every((m) => l.getField(m) === 3));
  g.broadcast('setField', 0); assert.ok(g.members.every((m) => l.getField(m) === 0));
  assert.throws(() => g.broadcast('nope', 1), TypeError);
  assert.throws(() => g.broadcast('constructor', 1), TypeError);
  assert.throws(() => g.broadcast(undefined), TypeError);
  // the all-lamps group reaches every lamp (high-score flash)
  const all = l.group('all');
  all.broadcast('flashThenOff', 3);
  assert.ok(l.names.every((n) => l.overlay(n) === 'flash'));
  l.advanceMs(3000);
  assert.ok(l.names.every((n) => l.overlay(n) === 'none' && !l.steady(n)));
});

test('group queries: lastFlashing / isAnimating', () => {
  const l = createLamps();
  const g = l.group('bmpr_inc_lights');
  assert.equal(g.lastFlashing(), false);
  l.flash('lite9', 1);
  assert.equal(g.lastFlashing(), false);
  l.flash('lite10', 1);
  assert.equal(g.lastFlashing(), true);
  l.advanceMs(1000);
  assert.equal(g.lastFlashing(), false);
});

// =====================================================================================================================================
// View for render
// =====================================================================================================================================
test('fillView: 140 keys, VISUAL state, version bumps only on change, allocation-free after the first call, onIdx clamped', () => {
  const l = createLamps();
  const view = { version: 0, lit: {}, onIdx: {} };
  const back = l.fillView(view);
  assert.equal(back, view);
  assert.equal(Object.keys(view.lit).length, 140);
  assert.equal(Object.keys(view.onIdx).length, 140);
  assert.equal(view.version, 1, 'a fresh view counts as changed');
  l.fillView(view);
  assert.equal(view.version, 1, 'unchanged');
  l.on('lite1');
  l.fillView(view);
  assert.equal(view.version, 2);
  assert.equal(view.lit.lite1, true);
  l.on('lite8'); l.on('lite9'); l.off('lite10');
  l.fillView(view);
  assert.equal(view.version, 3, 'one bump even if several lamps changed');
  l.turnOn('lite16'); // S true but nothing visible changes? it does (overlay none) -> visible
  l.fillView(view);
  assert.equal(view.version, 4);
  l.timedOff('lite1', 1); // FORCE_OFF: visual dark although S true
  l.fillView(view);
  assert.equal(view.lit.lite1, false);
  assert.equal(view.version, 5);
  l.flasherStart('lite20');
  l.fillView(view); assert.equal(view.lit.lite20, true); const v = view.version;
  l.fillView(view); assert.equal(view.version, v);
  l.advanceMs(99); l.fillView(view); assert.equal(view.version, v, 'no toggle yet');
  l.advanceMs(1); l.fillView(view); assert.equal(view.version, v + 1, 'toggle bumps');
  assert.equal(view.lit.lite20, false);
  // onIdx
  l.setOnIdx('lite2', 9); l.setOnIdx('lite3', 1); l.setOnIdx('lite4', -4); l.setOnIdx('lite1', 2);
  const v2 = view.version;
  l.fillView(view);
  assert.equal(view.version, v2 + 1);
  assert.deepEqual([view.onIdx.lite2, view.onIdx.lite3, view.onIdx.lite4, view.onIdx.lite1], [2, 1, 0, 0]);
  for (const n of l.names) assert.equal(view.lit[n], l.isLit(n), n);
  assert.equal(Object.keys(view.lit).length, 140, 'no keys appear later');
  assert.equal(Object.keys(view).length, 3);
  // independent views
  const view2 = { version: 10, lit: {}, onIdx: {} };
  l.fillView(view2);
  assert.equal(view2.version, 11);
  assert.deepEqual(view2.lit, view.lit);
  // lite192 is part of the view although it has no bitmap
  assert.ok('lite192' in view.lit);
});

// =====================================================================================================================================
// New game, players
// =====================================================================================================================================
test('resetAll: S, overlays, timers, onIdx, field, animations, notify timers, fuel and saved players are cleared; hooks stay registered', () => {
  const l = createLamps();
  const hook = [];
  l.onLampTimer('lite17', (n) => hook.push(n));
  const notify = [];
  l.group('hyperspace_lights').onNotifyExpired((g) => notify.push(g));
  l.on('lite1'); l.flash('lite2', 5); l.timedOn('lite3', 5); l.setField('lite4', 9); l.setOnIdx('lite2', 2);
  l.timedOn('lite17', 1);
  l.group('hyperspace_lights').restartNotifyTimer(1);
  l.group('outer_circle').animationBackward();
  l.group('all').lightShow();
  l.fuel.setLevel(11);
  l.playerChanged(0, 1);
  l.playerChanged(1, 0);
  l.resetAll();
  for (const n of l.names) {
    assert.equal(l.steady(n), false, n); assert.equal(l.overlay(n), 'none', n); assert.equal(l.getField(n), 0, n); assert.equal(l.getOnIdx(n), 0, n);
  }
  assert.equal(l.group('outer_circle').isAnimating(), false);
  assert.equal(l.group('all').isAnimating(), false);
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  l.advanceMs(100000);
  assert.deepEqual(hook, []);
  assert.deepEqual(notify, []);
  // hooks survive a reset
  l.timedOn('lite17', 1);
  l.advanceMs(1000);
  assert.deepEqual(hook, ['lite17']);
  l.group('hyperspace_lights').restartNotifyTimer(1);
  l.advanceMs(1000);
  assert.deepEqual(notify, ['hyperspace_lights']);
  // saved players forgotten
  l.on('lite1');
  l.playerChanged(0, 1);
  l.resetAll();
  l.playerChanged(1, 0);
  assert.equal(l.steady('lite1'), false);
});

test('playerChanged: saves {flashing, onIdx, S, field} of the outgoing player, resets completely, restores the incoming slot (round trip)', () => {
  const l = createLamps();
  const hook = [];
  l.onLampTimer('lite200', (n) => hook.push(n));
  // player 0
  l.on('lite1');
  l.setOnIdx('lite2', 2); l.on('lite2'); l.setField('lite2', 9);
  l.flash('lite3', 5); // timed flash: only "flashing" is saved, the 5 s remainder is lost
  l.on('lite4'); l.timedOff('lite4', 5); // FORCE overlays are not saved
  l.timedOn('lite200', 5); // timeouts are not saved
  l.on('lite8'); l.flashThenOff('lite8', 5); // offAfter is not saved; S true
  l.group('outer_circle').nextOn(2);
  l.advanceMs(500);
  l.playerChanged(0, 1);
  for (const n of l.names) {
    assert.equal(l.steady(n), false, n); assert.equal(l.overlay(n), 'none', n); assert.equal(l.getField(n), 0, n); assert.equal(l.getOnIdx(n), 0, n);
  }
  l.advanceMs(20000);
  assert.deepEqual(hook, [], 'the outgoing player timers are gone');
  // player 1
  l.on('lite5'); l.setField('lite6', 4); l.on('lite6');
  l.playerChanged(1, 0);
  assert.equal(l.steady('lite5'), false);
  assert.equal(l.steady('lite1'), true);
  assert.equal(l.steady('lite2'), true); assert.equal(l.getOnIdx('lite2'), 2); assert.equal(l.getField('lite2'), 9);
  assert.equal(l.overlay('lite3'), 'flash', 'comes back as an INDEFINITE flash');
  assert.equal(l.steady('lite3'), false);
  assert.equal(l.steady('lite4'), true); assert.equal(l.overlay('lite4'), 'none');
  assert.equal(l.steady('lite200'), false); assert.equal(l.overlay('lite200'), 'none');
  assert.equal(l.steady('lite8'), true); assert.equal(l.overlay('lite8'), 'flash', 'it was flashing (S true): flashes on, offAfter lost');
  assert.equal(l.group('outer_circle').count(), 1);
  l.advanceMs(100000);
  assert.equal(l.overlay('lite3'), 'flash');
  assert.equal(l.overlay('lite8'), 'flash');
  assert.equal(l.steady('lite8'), true);
  // and back to player 1
  l.playerChanged(0, 1);
  assert.equal(l.steady('lite5'), true);
  assert.equal(l.steady('lite6'), true); assert.equal(l.getField('lite6'), 4);
  assert.equal(l.steady('lite1'), false);
  // a third and fourth player start blank
  l.playerChanged(1, 3);
  assert.ok(l.names.every((n) => !l.steady(n)));
  assert.throws(() => l.playerChanged(4, 0), TypeError);
  assert.throws(() => l.playerChanged(0, -1), TypeError);
  assert.throws(() => l.playerChanged(0, 1.5), TypeError);
  assert.throws(() => l.playerChanged('0', 1), TypeError);
});

test('playerChanged: groups drop animations and notify timers (not resumed), the bargraph saves its level without a countdown', () => {
  const l = createLamps();
  const notify = [];
  const g = l.group('top_target_lights');
  g.onNotifyExpired((n) => notify.push(n));
  g.restartNotifyTimer(30);
  const chase = l.group('bmpr_inc_lights');
  l.on('lite8');
  chase.animationBackward();
  const ticks = [];
  l.fuel.setHooks({ tick: (v) => ticks.push(v), ended: () => ticks.push('end') });
  l.fuel.setLevel(7);
  l.playerChanged(0, 1);
  assert.equal(chase.isAnimating(), false);
  assert.equal(l.fuel.level, 0);
  assert.equal(l.fuel.running, false);
  l.advanceMs(100000);
  assert.deepEqual(notify, []);
  assert.deepEqual(ticks, []);
  assert.ok(chase.members.every((m) => l.overlay(m) === 'none'));
  l.playerChanged(1, 0);
  assert.equal(l.fuel.level, 7, 'level restored as a number');
  assert.equal(l.fuel.running, false, 'no countdown restarted');
  assert.equal(chase.isAnimating(), false);
  assert.equal(l.steady('lite8'), true);
  l.advanceMs(100000);
  assert.deepEqual(ticks, []);
  l.fuel.reset();
  assert.equal(l.fuel.level, 0);
});

// =====================================================================================================================================
// Injection seams and determinism
// =====================================================================================================================================
test('createLamps honours the injected data module (hook names, flash timings) and rand', () => {
  const custom = { ...data, LAMP_HOOK_NAMES: ['lite1'] };
  const l = createLamps({ data: custom });
  assert.throws(() => l.onLampTimer('lite17', () => {}), TypeError);
  const seen = [];
  l.onLampTimer('lite1', (n) => seen.push(n));
  l.timedOn('lite1', 0.5);
  l.advanceMs(500);
  assert.deepEqual(seen, ['lite1']);
  const fast = { ...data, LAMPS: data.LAMPS.map((d) => (d.name === 'lite1' ? { ...d, flash: { off: 0.05, on: 0.03 } } : d)) };
  const m = createLamps({ data: fast });
  m.flasherStart('lite1');
  assert.equal(m.isLit('lite1'), true);
  m.advanceMs(30); assert.equal(m.isLit('lite1'), false);
  m.advanceMs(50); assert.equal(m.isLit('lite1'), true);
  // default rand is Math.random but nothing consumes it unless an animation runs
  assert.doesNotThrow(() => createLamps({ rand: constantRand(0.5) }));
});

test('determinism: same rand seed + same action script gives identical views', () => {
  const run = (seed) => {
    const l = createLamps({ rand: mulberry32(seed) });
    const trace = [];
    const view = { version: 0, lit: {}, onIdx: {} };
    l.group('all').lightShow();
    l.advanceMs(2000);
    l.group('all').groupReset();
    l.group('all').gameOver();
    l.fuel.setLevel(11);
    l.group('outer_circle').nextOn(2);
    for (let i = 0; i < 100; i++) {
      l.advance(1 / 60);
      l.fillView(view);
      trace.push(view.version, ...l.names.map((n) => (view.lit[n] ? 1 : 0)));
    }
    return trace.join(',');
  };
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});

// =====================================================================================================================================
// Differential test of the Lamp verbs against a direct transcription of the SPEC 5.13.6 reference sketch
// =====================================================================================================================================
test('lamp verbs match an independent transcription of the SPEC reference sketch over random verb scripts', () => {
  class RefSched {
    constructor() { this.now = 0; this.seq = 0; this.items = []; }
    after(ms, fn, prio = 0) { const it = { time: this.now + ms, prio, seq: this.seq++, fn, live: true }; this.items.push(it); return it; }
    cancel(it) { if (it) it.live = false; }
    advance(ms) {
      const target = this.now + ms;
      for (;;) {
        let best = null;
        for (const it of this.items) {
          if (!it.live || it.time > target) continue;
          if (!best || it.time < best.time || (it.time === best.time && (it.prio < best.prio || (it.prio === best.prio && it.seq < best.seq)))) best = it;
        }
        if (!best) break;
        best.live = false;
        this.now = Math.max(this.now, best.time);
        best.fn();
      }
      this.now = target;
      this.items = this.items.filter((i) => i.live);
    }
  }
  class RefLamp {
    constructor(s, off, on, hook) {
      this.s = s; this.S = false; this.overlay = 'none'; this.phase = false; this.offAfter = false; this.timeoutH = null; this.flashH = null;
      this.off = off; this.on = on; this.hook = hook;
    }
    setTimeout(t) {
      this.s.cancel(this.timeoutH); this.timeoutH = null;
      const ms = t > 0 ? Math.max(1, Math.trunc(t * 1000 + 1e-6)) : 0;
      if (ms > 0) this.timeoutH = this.s.after(ms, () => this.expire(), 0);
    }
    expire() {
      this.timeoutH = null;
      if (this.overlay === 'flash') { this.s.cancel(this.flashH); this.flashH = null; }
      this.overlay = 'none';
      if (this.offAfter) { this.offAfter = false; this.S = false; }
      if (this.hook) this.hook();
    }
    startFlash() { this.phase = !this.S; this.overlay = 'flash'; this.flashTick(true); }
    flashTick(first) {
      if (!first) this.phase = !this.phase;
      this.flashH = this.s.after(this.phase ? this.on : this.off, () => this.flashTick(false), 1);
    }
    lit() { return this.overlay === 'flash' ? this.phase : this.overlay === 'on' ? true : this.overlay === 'off' ? false : this.S; }
    lightOn() { return this.S || this.overlay === 'on' || this.overlay === 'flash'; }
    cancelFlash() { this.s.cancel(this.flashH); this.flashH = null; }
    turnOn() { this.S = true; }
    turnOff() { this.S = false; }
    flasherStart() { this.setTimeout(0); if (this.overlay !== 'flash' || !this.flashH) { this.overlay = 'flash'; this.offAfter = false; this.startFlash(); } }
    flasherStartTimed(t) { if (this.overlay !== 'flash') this.startFlash(); this.overlay = 'flash'; this.offAfter = false; this.setTimeout(t); }
    turnOffTimed(t) { if (this.overlay !== 'off') { if (this.overlay === 'flash') this.cancelFlash(); this.overlay = 'off'; } this.setTimeout(t); }
    turnOnTimed(t) { if (this.overlay !== 'on') { if (this.overlay === 'flash') this.cancelFlash(); this.overlay = 'on'; } this.setTimeout(t); }
    resetTimed() { this.s.cancel(this.timeoutH); this.timeoutH = null; this.cancelFlash(); this.overlay = 'none'; }
    thenStayOn(t) { this.offAfter = false; this.turnOn(); this.flasherStartTimed(t); }
    thenStayOff(t) { this.flasherStartTimed(t); this.offAfter = true; }
    resetAndTurnOn() { this.turnOn(); this.resetTimed(); }
    resetAndTurnOff() { this.turnOff(); this.resetTimed(); }
  }
  const rand = mulberry32(99);
  const durations = [0, 0.05, 0.1, 0.25, 0.5, 1, 2.001];
  const lampNames = ['lite1', 'lite5', 'lite77', 'lite200'];
  const l = createLamps();
  const s = new RefSched();
  const hookLog = []; const refHookLog = [];
  l.onLampTimer('lite200', () => hookLog.push(l.nowMs()));
  const refs = new Map();
  for (const n of lampNames) {
    const def = LAMPS.find((d) => d.name === n);
    refs.set(n, new RefLamp(s, Math.round(def.flash.off * 1000), Math.round(def.flash.on * 1000), n === 'lite200' ? () => refHookLog.push(s.now) : null));
  }
  const verbs = [
    ['turnOn', (n) => l.turnOn(n), (r) => r.turnOn()],
    ['turnOff', (n) => l.turnOff(n), (r) => r.turnOff()],
    ['on', (n) => l.on(n), (r) => r.resetAndTurnOn()],
    ['off', (n) => l.off(n), (r) => r.resetAndTurnOff()],
    ['flash', (n, t) => l.flash(n, t), (r, t) => r.flasherStartTimed(t)],
    ['flasherStart', (n) => l.flasherStart(n), (r) => r.flasherStart()],
    ['flashThenOn', (n, t) => l.flashThenOn(n, t), (r, t) => r.thenStayOn(t)],
    ['flashThenOff', (n, t) => l.flashThenOff(n, t), (r, t) => r.thenStayOff(t)],
    ['timedOn', (n, t) => l.timedOn(n, t), (r, t) => r.turnOnTimed(t)],
    ['timedOff', (n, t) => l.timedOff(n, t), (r, t) => r.turnOffTimed(t)],
    ['resetTimed', (n) => l.resetTimed(n), (r) => r.resetTimed()],
  ];
  let compared = 0;
  for (let i = 0; i < 3000; i++) {
    const n = lampNames[Math.floor(rand() * lampNames.length)];
    const v = verbs[Math.floor(rand() * verbs.length)];
    const t = durations[Math.floor(rand() * durations.length)];
    v[1](n, t);
    v[2](refs.get(n), t);
    const chunk = rand() < 0.3 ? 1 : 1 + Math.floor(rand() * 220);
    l.advanceMs(chunk);
    s.advance(chunk);
    for (const name of lampNames) {
      const r = refs.get(name);
      const msg = `step ${i} ${name} after ${v[0]}(${t})`;
      assert.equal(l.steady(name), r.S, msg);
      assert.equal(l.overlay(name), r.overlay, msg);
      assert.equal(l.isLit(name), r.lit(), msg);
      assert.equal(l.lightOn(name), r.lightOn(), msg);
      compared++;
    }
  }
  assert.equal(l.nowMs(), s.now);
  assert.deepEqual(hookLog, refHookLog);
  assert.ok(compared > 10000);
});
