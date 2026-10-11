/**
 * src/physics/snapshot.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 5.2; type PhysicsSnapshot
 * createSnapshot(data) builds the IDLE PhysicsSnapshot (all component records present, flippers at rest, no balls). REAL helper: PHYSICS
 * keeps it and mutates the returned object in place from then on (never reallocate; RENDER keeps no references across frames).
 * fillSnapshot(snap, engine) refreshes it in place from the running engine (called lazily by Physics.snapshot()).
 *
 * ASSUMPTIONS: `balls` is rebuilt in place from a pool of BallSnap objects (the array identity and the BallSnap objects are reused);
 * balls captured by a sink (active === false) are not listed; a ball held by a kickout / the ramp hole is listed with held: true.
 */
import * as DEFAULT_DATA from '../data/index.js';

/**
 * @param {import('../types.js').DataModule} [data]
 * @returns {import('../types.js').PhysicsSnapshot}
 */
export function createSnapshot(data = DEFAULT_DATA) {
  const N = data.COMPONENT_NAMES;
  const rec = (names, make) => Object.fromEntries(names.map((n) => [n, make(n)]));
  return {
    time: 0, tiltLocked: false, nudgeCount: 0, shake: { x: 0, y: 0 }, balls: [],
    flippers: rec(N.flippers, () => ({ angle: 0, up: false })),
    plunger: { pull: 0, boost: 0, charging: false, fired: false },
    popups: rec(N.popups, () => ({ up: true })),
    solos: rec(N.solos, () => ({ flash: 0 })),
    bumpers: rec(N.bumpers, () => ({ hit: false })),
    rebounders: rec(N.rebounders, () => ({ flash: false })),
    kickbacks: rec(N.kickbacks, () => ({ kicked: false, armed: false })),
    gates: rec(N.gates, () => ({ enabled: true })),
    blocker: { up: false },
    flags: rec(N.flags, () => ({ frame: 0, angle: 0, spinning: false })),
    kickouts: rec(N.kickouts, (n) => ({ active: n !== 'a_kout1', held: false })),
    sinks: rec(N.sinks, () => ({ occupied: false })),
    rampHole: { occupied: false, drop: 0 },
    rolloverSprites: { [N.lightRollover]: { lit: false } },
  };
}

const NEG_Z_VISIBLE = 0;
const MAX_SPEED = 60;

/**
 * Refresh `snap` in place from the engine. Returns `snap`.
 * @param {import('../types.js').PhysicsSnapshot} snap
 * @param {any} eng the Engine (src/physics/engine.js)
 */
export function fillSnapshot(snap, eng) {
  const time = eng.time;
  const table = eng.table;
  snap.time = time;
  snap.tiltLocked = eng.tilt;
  snap.nudgeCount = eng.nudgeCount;
  snap.shake.x = eng.shake.x;
  snap.shake.y = eng.shake.y;

  // balls: pooled records
  const out = snap.balls;
  let n = 0;
  for (let i = 0; i < eng.balls.length; i++) {
    const b = eng.balls[i];
    if (b.dead || !b.active) continue;
    let s = out[n];
    if (!s) { s = { id: 0, x: 0, y: 0, z: 0, mask: 1, visible: true, held: false, speed: 0 }; out[n] = s; }
    s.id = b.id; s.x = b.x; s.y = b.y; s.z = b.z; s.mask = b.mask;
    s.speed = b.speed > MAX_SPEED ? MAX_SPEED : b.speed;      // a hard hit may add a boost; the 60 u/s cap is applied by the next update
    s.held = !!b.heldBy;
    s.visible = !(b.mask === 2 && b.z < NEG_Z_VISIBLE);
    n++;
  }
  out.length = n;

  for (const f of eng.flippers) {
    const r = snap.flippers[f.name];
    if (r) { r.angle = f.cur; r.up = f.button; }
  }
  const pl = table.plunger;
  if (pl) {
    snap.plunger.pull = pl.pull(time);
    snap.plunger.boost = pl.boost;
    snap.plunger.charging = pl.charging;
    snap.plunger.fired = pl.fired(time);
  }
  for (const c of table.popups) { const r = snap.popups[c.name]; if (r) r.up = c.up; }
  for (const c of table.solos) { const r = snap.solos[c.name]; if (r) r.flash = c.flash(time); }
  for (const c of table.bumpers) { const r = snap.bumpers[c.name]; if (r) r.hit = time < c.hitUntil - 1e-9; }
  for (const c of table.rebounders) { const r = snap.rebounders[c.name]; if (r) r.flash = time < c.flashUntil - 1e-9; }
  for (const c of table.kickbackList) {
    const r = snap.kickbacks[c.name];
    if (r) { r.kicked = c.kicked; r.armed = c.armed; }
  }
  for (const c of table.gateList) {
    const r = snap.gates[c.name];
    if (r) r.enabled = c.enabled;
  }
  if (table.blocker) snap.blocker.up = table.blocker.up;
  for (const c of table.flags) {
    const r = snap.flags[c.name];
    if (r) { r.frame = c.frame; r.angle = c.frame * Math.PI / 4; r.spinning = c.spinning; }
  }
  for (const c of table.kickoutList) {
    const r = snap.kickouts[c.name];
    if (r) { r.active = c.active; r.held = !!c.ball; }
  }
  for (const c of table.sinkList) { const r = snap.sinks[c.name]; if (r) r.occupied = c.count > 0; }
  if (table.hole) { snap.rampHole.occupied = !!table.hole.ball; snap.rampHole.drop = table.hole.drop; }
  for (const c of table.rollovers) {
    if (!c.light) continue;
    const r = snap.rolloverSprites[c.name];
    if (r) r.lit = time < c.litUntil - 1e-9;
  }
  return snap;
}
