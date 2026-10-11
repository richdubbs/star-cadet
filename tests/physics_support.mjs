/**
 * tests/physics_support.mjs
 * OWNER: PHYSICS (test support, imported by tests/physics*.test.mjs)
 * STATUS: IMPLEMENTED
 * Small helpers shared by the physics tests: table construction with data overrides (empty table, "only these tables"), stepping
 * helpers, event collection. No timers, no Math.random, no clocks.
 */
import * as data from '../src/data/index.js';
import { createPhysics } from '../src/physics.js';
import { constantRand } from './helpers/seeded_rand.mjs';

export { data };

/** Every geometry table emptied (the physics engine tolerates missing tables). Constants (PHYS, TIMING, ...) are kept. */
export const EMPTY = {
  WALLS: [], POSTS: [], TABLE_OUTLINE: null, BUMPERS: [], POPUP_TARGETS: [], SOLO_TARGETS: [], KICKBACKS: [], GATES: [], BLOCKER: null,
  DRAIN: null, PLUNGER: null, KICKOUTS: [], SINKS: [], RAMP_HOLE: null, ONEWAYS: [], TRIPWIRES: [], ROLLOVERS: [], FLAGS: [],
  DEMO_TRIGGERS: [], RAMPS: null, FLIPPERS: [],
};

/** Data module with ONLY the named tables kept, e.g. only('ONEWAYS'). */
export function only(...keys) {
  const keep = {};
  for (const k of keys) keep[k] = data[k];
  return { ...data, ...EMPTY, ...keep };
}

/** The table with the named tables emptied. */
export function without(...keys) {
  const d = { ...data };
  for (const k of keys) d[k] = EMPTY[k];
  return d;
}

/** Physics with a constant 0.5 random source (no lateral jitter, no throw jitter). */
export function mk(opts = {}) {
  return createPhysics({ rand: constantRand(0.5), ...opts });
}

/** Advance n fixed steps; returns the physics for chaining. */
export function stepN(p, n) {
  for (let i = 0; i < n; i++) p.step();
  return p;
}

/** Advance `seconds` of physics time (rounded to whole 1/120 s steps) and return every event emitted meanwhile. */
export function run(p, seconds) {
  const out = [];
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) {
    p.step();
    for (const e of p.drainEvents()) out.push(e);
  }
  return out;
}

/**
 * Step until `pred(events)` is true for the events of one step or `maxSeconds` pass. Returns {events (all), hit (bool), steps}.
 */
export function runUntil(p, pred, maxSeconds = 10) {
  const events = [];
  const n = Math.round(maxSeconds * 120);
  for (let i = 1; i <= n; i++) {
    p.step();
    const es = p.drainEvents();
    for (const e of es) events.push(e);
    if (pred(es)) return { events, hit: true, steps: i };
  }
  return { events, hit: false, steps: n };
}

/** Events of one type (optionally with matching fields). */
export function ofType(events, type, fields = {}) {
  return events.filter((e) => e.type === type && Object.entries(fields).every(([k, v]) => e[k] === v));
}

/** Velocity vector of a ball. */
export const vel = (b) => [b.dx * b.speed, b.dy * b.speed];

/** Seconds per step. */
export const DT = data.PHYS.dt;
