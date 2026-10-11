/**
 * src/game.js
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED (executable specification of the fixed-step contract; INTEGRATOR may extend, never reorder the step)
 * CONTRACT: ARCHITECTURE.md 12 (main loop order, clock ownership, pause); type Game (src/types.js)
 *
 * Headless composition of physics + rules + lamps. NO DOM, NO three, NO audio objects (sound is injected as a SoundPort).
 * Safe to run in Node: this is what tests/integration.test.mjs drives.
 *
 * ONE simulation clock lives here. Everything in the sim advances in whole steps of PHYS.dt = 1/120 s, always in this order:
 *   1. physics.step(dt)                                 (inputs were already applied synchronously by rules.input() between frames)
 *   2. rules.onPhysicsEvents(physics.drainEvents())     (rules reacts; may call physics commands, lamp verbs, sound.play)
 *   3. rules.tick(dt)                                   (rules timers)
 *   4. lamps.advance(dt)                                (lamp timers; lamp hooks call back into rules)
 * Paused => advance() runs no steps at all (rendering and UI keep running). A step that throws clears the accumulator (no backlog snowball) and rethrows.
 *
 * Presentation only: buildRenderFrame() blends every ball between its position before the last step and after it by the fraction of a step still
 * waiting in the accumulator, so 144/165 Hz displays and jittery 60 Hz frames move smoothly although the simulation ticks at 120 Hz. Physics,
 * rules and lamps never see the blended values (snapshot() is refilled from the engine on every call).
 */
import * as DEFAULT_DATA from './data/index.js';
import { SILENT_SOUND } from './data/sounds.js';
import { createPhysics } from './physics.js';
import { createLamps } from './lamps.js';
import { createRules } from './rules.js';

/**
 * @param {import('./types.js').CreateGameOpts} [opts]
 * @returns {import('./types.js').Game}
 */
export function createGame(opts = {}) {
  const data = opts.data || DEFAULT_DATA;
  const rand = opts.rand || Math.random;
  const sound = opts.sound || SILENT_SOUND;
  const f = opts.factories || {};
  const physics = (f.createPhysics || createPhysics)({ rand, data });
  const lamps = (f.createLamps || createLamps)({ rand, data });
  const rules = (f.createRules || createRules)({ physics, lamps, sound, rand, highScores: opts.highScores, data });

  const DT = data.PHYS.dt;
  const MAX_FRAME = data.PHYS.maxFrameDt;
  let acc = 0;
  let time = 0;
  let paused = false;

  // --- render interpolation state (see the header) -------------------------------------------------------------------------------------
  const BLEND_MAX2 = 1.5 * 1.5;       // a ball that moved further than this in ONE step was teleported (sink re-emit, feed): never blend
  /** @type {{id:number,x:number,y:number,z:number}[]} pooled: ball positions BEFORE the most recent step */
  const prevBalls = [];
  let prevN = 0;
  let alpha = 1;                      // 1 = show the newest state (also what a bare step() leaves behind), < 1 = blend with the previous step

  /** @type {import('./types.js').RenderFrame} */
  const frame = { time: 0, dt: 0, physics: /** @type {any} */ (null), lamps: { version: 0, lit: {}, onIdx: {} }, rules: /** @type {any} */ (null) };

  function recordPrev() {
    const list = physics.balls;
    let n = 0;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || b.dead || b.active === false) continue;
        let r = prevBalls[n];
        if (!r) { r = { id: 0, x: 0, y: 0, z: 0 }; prevBalls[n] = r; }
        r.id = b.id; r.x = b.x; r.y = b.y; r.z = b.z;
        n++;
      }
    }
    prevN = n;
  }

  function stepOnce() {
    recordPrev();
    physics.step(DT);
    rules.onPhysicsEvents(physics.drainEvents());
    rules.tick(DT);
    lamps.advance(DT);
    time += DT;
  }

  /** one fixed step; a caller that steps by hand wants the newest state in the next render frame, not a blend */
  function step() {
    stepOnce();
    alpha = 1;
  }

  function advance(frameDt) {
    if (paused) return 0;
    acc += Math.min(Math.max(Number(frameDt) || 0, 0), MAX_FRAME);
    let n = 0;
    try {
      while (acc >= DT - 1e-9) {
        stepOnce();
        acc -= DT;
        n++;
      }
    } catch (err) {
      // a step threw (a bug): drop the backlog, otherwise a persistent fault would grow `acc` every frame and the first good frame after
      // a restart (F2) would have to run minutes of steps at once. The caller reports the error and keeps its loop alive.
      acc = 0;
      throw err;
    }
    if (acc < 0) acc = 0;
    alpha = acc >= DT ? 1 : acc / DT;
    return n;
  }

  function setPaused(on) {
    on = !!on;
    if (on === paused) return;
    paused = on;
    if (!on) acc = 0;
    rules.setPaused(on);
  }

  /** move each snapshot ball from its pre-step position toward its current one by `alpha` (balls without a previous record are left alone) */
  function blendBalls(balls) {
    for (let i = 0; i < balls.length; i++) {
      const s = balls[i];
      for (let j = 0; j < prevN; j++) {
        const r = prevBalls[j];
        if (r.id !== s.id) continue;
        const dx = s.x - r.x, dy = s.y - r.y, dz = s.z - r.z;
        if (dx * dx + dy * dy + dz * dz <= BLEND_MAX2) { s.x = r.x + dx * alpha; s.y = r.y + dy * alpha; s.z = r.z + dz * alpha; }
        break;
      }
    }
  }

  function buildRenderFrame(dt, out) {
    const f = out || frame;
    f.time = time;
    f.dt = dt;
    f.physics = physics.snapshot();
    if (alpha < 1 && prevN > 0 && f.physics && f.physics.balls) blendBalls(f.physics.balls);
    if (!f.lamps) f.lamps = { version: 0, lit: {}, onIdx: {} };
    lamps.fillView(f.lamps);
    f.rules = rules.getView();
    return f;
  }

  return { physics, lamps, rules, step, advance, setPaused, isPaused: () => paused, simTime: () => time, buildRenderFrame };
}
