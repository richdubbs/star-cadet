/**
 * tests/helpers/bot.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * Headless test rig around createGame (real physics + lamps + rules) and a tiny deterministic "player" bot.
 *   createRig({seed, players, ...gameOpts}) -> { game, view, events, step(n), run(seconds), time(), count(type), of(type) }
 *   createBot(rig, opts) -> { tick() }   call after every rig.step(): plunges at full boost, flips balls arriving at the flippers
 * No wall clock, no Math.random: everything derives from the seed and from game.step().
 */
import { createGame } from '../../src/game.js';
import { mulberry32 } from './seeded_rand.mjs';

/** @param {{seed?:number, players?:number, newGame?:boolean} & Record<string,any>} [opts] */
export function createRig(opts = {}) {
  const { seed = 1, players = 1, newGame = false, ...gameOpts } = opts;
  const game = createGame({ rand: mulberry32(seed), ...gameOpts });
  /** @type {any[]} every physics event the rules saw, in order */
  const events = [];
  const original = game.rules.onPhysicsEvents;
  game.rules.onPhysicsEvents = (list) => {
    for (const e of list) events.push(e);
    return original(list);
  };
  const view = game.rules.getView();
  const rig = {
    game, view, events,
    step(n = 1) { for (let i = 0; i < n; i++) game.step(); },
    /** run `seconds` of simulated time in whole 1/120 s steps */
    run(seconds) { rig.step(Math.round(seconds * 120)); },
    time: () => game.simTime(),
    count: (type) => events.reduce((n, e) => n + (e.type === type ? 1 : 0), 0),
    of: (type) => events.filter((e) => e.type === type),
    /** start a game and run until ball 1 rests on the plunger (the 5.045 s light show + the 0.96 s feed + the ~0.4 s drop onto the face) */
    toPlunger() {
      game.rules.newGame({ players });
      rig.run(6.8);
      return rig;
    },
  };
  if (newGame) rig.toPlunger();
  return rig;
}

/**
 * A deterministic bot: holds the plunger 2.6 s (full boost) whenever a ball waits at it, then presses a flipper for 0.2 s whenever a
 * moving ball falls toward it. Good enough to play full games (all three balls) and to touch most of the table.
 * @param {ReturnType<typeof createRig>} rig
 * @param {{plungeSeconds?:number, flipSeconds?:number}} [o]
 */
export function createBot(rig, o = {}) {
  const { game } = rig;
  const plungeSeconds = o.plungeSeconds ?? 2.6;
  const flipSeconds = o.flipSeconds ?? 0.2;
  let plungeStart = -1;
  let cool = 0;
  const flipUntil = { left: -1, right: -1 };
  return {
    tick() {
      const t = game.simTime();
      const p = game.physics;
      if (rig.view.phase !== 'playing' || rig.view.paused) return;
      if (plungeStart < 0 && t > cool && p.ballAtPlunger()) { plungeStart = t; game.rules.input('plunger', true); }
      if (plungeStart >= 0 && t - plungeStart > plungeSeconds) { game.rules.input('plunger', false); plungeStart = -1; cool = t + 1.0; }
      for (const b of p.balls) {
        if (!b || b.active === false || b.mask !== 1 || b.y < 10 || b.y > 13 || b.dy <= 0.3 || b.speed <= 3) continue;
        if (b.x > 0.3 && b.x < 3.4 && flipUntil.left < t) { game.rules.input('flipperLeft', true); flipUntil.left = t + flipSeconds; }
        if (b.x < -0.3 && b.x > -3.4 && flipUntil.right < t) { game.rules.input('flipperRight', true); flipUntil.right = t + flipSeconds; }
      }
      if (flipUntil.left > 0 && flipUntil.left <= t) { game.rules.input('flipperLeft', false); flipUntil.left = -1; }
      if (flipUntil.right > 0 && flipUntil.right <= t) { game.rules.input('flipperRight', false); flipUntil.right = -1; }
    },
  };
}
