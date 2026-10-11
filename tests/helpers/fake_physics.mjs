/**
 * tests/helpers/fake_physics.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * A recording Physics double for RULES tests. Every command is appended to `calls` as [name, ...args]; tests inject physics events
 * with emit() and feed them to rules.onPhysicsEvents(physics.drainEvents()).
 *
 *   const fp = createFakePhysics();
 *   const rules = createRules({ physics: fp.physics, lamps, sound: SILENT_SOUND, rand });
 *   fp.emit({ type: 'rolloverEnter', name: 'a_roll1' });
 *   rules.onPhysicsEvents(fp.physics.drainEvents());
 *   assert.deepEqual(fp.calls.at(-1), ['startFeed', {}]);
 */
import { createSnapshot } from '../../src/physics/snapshot.js';

const COMMANDS = [
  'step', 'setFlipperButton', 'setPlungerButton', 'nudge', 'startFeed', 'relaunch', 'launchInstant', 'gateSetEnabled',
  'blockerSetEnabled', 'popupReenable', 'kickoutSetActive', 'kickoutSetHold', 'sinkSetRoute', 'setTiltLock', 'setFlippersEnabled',
  'setDemoTriggers', 'forceDrainAll', 'removeAllBalls', 'resetTable', 'spawnBall', 'debugGrab', 'debugDrag', 'debugRelease',
];

export function createFakePhysics(state = {}) {
  const calls = [];
  const queue = [];
  const st = { ballsInPlay: 0, ballAtPlunger: false, tilt: false, nudgeCount: 0, time: 0, ...state };
  const snap = createSnapshot();
  const physics = {
    balls: [],
    drainEvents: () => queue.splice(0, queue.length),
    snapshot: () => snap,
    ballsInPlay: () => st.ballsInPlay,
    ballAtPlunger: () => st.ballAtPlunger,
    getNudgeCount: () => st.nudgeCount,
    isTiltLocked: () => st.tilt,
  };
  for (const name of COMMANDS) {
    physics[name] = (...args) => {
      calls.push([name, ...args]);
      if (name === 'setTiltLock') st.tilt = !!args[0];
      if (name === 'launchInstant' || name === 'setFlipperButton' || name === 'nudge') return true;
      return undefined;
    };
  }
  return {
    physics, calls, state: st,
    emit(e) { queue.push({ t: st.time, ...e }); },
    /** All recorded calls of one command. */
    callsOf: (name) => calls.filter((c) => c[0] === name),
    clearCalls: () => { calls.length = 0; },
  };
}
