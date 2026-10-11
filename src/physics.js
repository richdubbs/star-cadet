/**
 * src/physics.js
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 4 + 5; type Physics (src/types.js)
 * Facade: createPhysics(opts) -> Physics. The simulation lives in src/physics/engine.js (update loop, balls, nudge/tilt, feed),
 * src/physics/components.js (every component handler), flipper.js, ramps.js, world.js (edge grid), edges.js, collision.js, timers.js,
 * snapshot.js. Pure Node module (no DOM, no three). It never scores, never plays a sound, never touches lamps: its only outputs are the
 * event queue (drainEvents) and the snapshot.
 *
 * Determinism: same `rand` sequence + same commands + same step() calls => identical events and snapshots.
 * Time advances only through step(dt) (default PHYS.dt = 1/120, clamped to 0.1 s).
 *
 * ASSUMPTIONS (see also the headers of src/physics/*.js):
 *  - `balls` is the live ball array (identity never changes); sink-captured balls stay in it with active === false.
 *  - Unknown component names / ids passed to commands throw TypeError; runtime conditions (no ball, tilted, disabled) never throw.
 *  - resetTable() keeps the physics clock running (snapshot.time never rewinds).
 */
import { Engine } from './physics/engine.js';

/**
 * @param {import('./types.js').CreatePhysicsOpts} [opts]
 * @returns {import('./types.js').Physics}
 */
export function createPhysics(opts = {}) {
  const eng = new Engine(opts);
  return {
    step: (dt) => eng.step(dt),
    drainEvents: () => eng.drainEvents(),
    snapshot: () => eng.snapshot(),
    balls: eng.balls,
    ballsInPlay: () => eng.ballsInPlay(),
    ballAtPlunger: () => eng.ballAtPlunger(),
    getNudgeCount: () => eng.getNudgeCount(),
    isTiltLocked: () => eng.isTiltLocked(),
    setFlipperButton: (side, down) => eng.setFlipperButton(side, down),
    setPlungerButton: (down) => eng.setPlungerButton(down),
    cancelPlunger: () => eng.cancelPlunger(),
    nudge: (dir, down = true) => eng.nudge(dir, down),
    startFeed: (o) => eng.startFeed(o),
    relaunch: () => eng.relaunch(),
    launchInstant: () => eng.launchInstant(),
    gateSetEnabled: (id, enabled) => eng.gateSetEnabled(id, enabled),
    blockerSetEnabled: (enabled) => eng.blockerSetEnabled(enabled),
    popupReenable: (names, immediate) => eng.popupReenable(names, immediate),
    kickoutSetActive: (id, active) => eng.kickoutSetActive(id, active),
    kickoutSetHold: (id, seconds) => eng.kickoutSetHold(id, seconds),
    sinkSetRoute: (id, exitId, hold) => eng.sinkSetRoute(id, exitId, hold),
    setTiltLock: (on) => eng.setTiltLock(on),
    setFlippersEnabled: (on) => eng.setFlippersEnabled(on),
    setDemoTriggers: (on) => eng.setDemoTriggers(on),
    forceDrainAll: () => eng.forceDrainAll(),
    removeAllBalls: () => eng.removeAllBalls(),
    resetTable: () => eng.resetTable(),
    spawnBall: (x, y, o) => eng.spawnBall(x, y, o),
    debugGrab: (x, y) => eng.debugGrab(x, y),
    debugDrag: (x, y) => eng.debugDrag(x, y),
    debugRelease: () => eng.debugRelease(),
  };
}
