/**
 * tests/rules_rig.mjs
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * Test rig shared by tests/rules*.test.mjs: real createRules + a recording fake physics + a lamps engine (the real src/lamps.js when it is
 * implemented, else the local double of tests/rules_lamps_double.mjs; env RULES_LAMPS=double forces the double) + a recording SoundPort.
 * The rig drives time like src/game.js does per step: rules.onPhysicsEvents(events) -> rules.tick(dt) -> lamps.advance(dt).
 */
import { createRules } from '../src/rules.js';
import { createLamps } from '../src/lamps.js';
import { createLampsDouble } from './rules_lamps_double.mjs';
import { createFakePhysics } from './helpers/fake_physics.mjs';
import { mulberry32 } from './helpers/seeded_rand.mjs';
import { soundDuration, MISSION_SELECT, MISSIONS } from '../src/data/index.js';

export const STEP = 1 / 120;

/** True when src/lamps.js is a real implementation (not the inert stub). */
export function realLampsAvailable() {
  try { return createLamps().names.length === 140; } catch (_) { return false; }
}

/**
 * @param {{seed?:number, rand?:()=>number, players?:number, realLamps?:boolean, highScores?:object, sound?:object}} [o]
 */
export function makeRig(o = {}) {
  const rand = o.rand || mulberry32(o.seed === undefined ? 1 : o.seed);
  // The real src/lamps.js is used whenever it is implemented (ARCHITECTURE 7.10); RULES_LAMPS=double forces the local double
  const useReal = o.realLamps || (process.env.RULES_LAMPS !== 'double' && realLampsAvailable());
  const lamps = useReal ? createLamps({ rand }) : createLampsDouble({ rand });
  const fp = createFakePhysics();
  const played = [];
  const sound = o.sound || { play(key) { played.push(key); return soundDuration(key); } };
  const rules = createRules({ physics: fp.physics, lamps, sound, rand, highScores: o.highScores });
  const view = rules.getView();
  const rig = {
    rules, lamps, fp, view, played, rand,
    /** emit one physics event and hand it to the rules */
    ev(type, payload = {}) { fp.emit({ type, ...payload }); rules.onPhysicsEvents(fp.physics.drainEvents()); },
    /** advance `sec` simulated seconds (rules timers + lamps) */
    tick(sec) {
      const n = Math.round(sec / STEP);
      for (let i = 0; i < n; i++) { rules.tick(STEP); lamps.advance(STEP); }
    },
    score: () => rules.getView().score,
    info: () => rules.getView().info,
    mission: () => rules.getView().mission,
    state: () => rules.getView().missionState,
    on: (n) => lamps.lightOn(n),
    count: (g) => lamps.group(g).count(),
    clearPlayed() { played.length = 0; },
    calls: (name) => fp.callsOf(name),
    /** new game, run the light show out, ball 1 is being fed */
    start(players = 1) {
      rules.newGame({ players });
      rig.tick(6);
      return rig;
    },
    /** the fed ball appears at the plunger */
    fed(ballId = 1) { fp.state.ballsInPlay = 1; rig.ev('plungerFed', { ballId }); return rig; },
    /** the ball drains (remaining balls in play afterwards) */
    drain(remaining = 0, via = 'drain') { fp.state.ballsInPlay = remaining; rig.ev('drain', { ballId: 1, remaining, via }); return rig; },
    /** drop the ball-save lamp so the next drain is a REAL end of ball */
    noSave() { lamps.off('lite200'); return rig; },
    /** fresh game in playing phase with the first ball fed and no ball save */
    play(players = 1) { rig.start(players); rig.fed(); rig.noSave(); return rig; },
    /** play one whole ball: real drain + the 1.82 s timer + feed + fed */
    endBall() { rig.noSave(); rig.drain(0); rig.tick(1.9); rig.fed(); rig.noSave(); return rig; },
    /** refuel through the top fuel rollover (level 11, 72 s countdown) */
    refuel() { rig.ev('rolloverEnter', { name: 'a_roll184' }); },
    /** leave state 0: the ball crosses the deployment chute exit */
    deploy() { rig.ev('oneway', { name: 's_onewy10' }); },
    /** set the rank to r (1..9) directly on the rank lamps (no texts, no sounds) */
    rank(r) { while (lamps.group('middle_circle').count() < r) lamps.group('middle_circle').offsetForward(); return rig; },
    /**
     * Select mission `id` (rank group chosen from MISSION_SELECT) and accept it with a ramp shot.
     * Leaves the rig in the mission's first state. Returns the score before the accept ramp event.
     */
    accept(id) {
      let group = 0; let level = 0;
      for (const [g, list] of Object.entries(MISSION_SELECT)) {
        const i = list.indexOf(id);
        if (i >= 0) { group = Number(g); level = i + 1; break; }
      }
      if (!group) throw new Error('mission ' + id + ' not selectable');
      const rankOfGroup = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 8 }[group];
      if (rig.state() === 0) rig.deploy();
      rig.rank(rankOfGroup);
      if (lamps.fuel.level <= 0) rig.refuel();
      const targets = level === 4 ? [0, 1, 2] : [level - 1];
      for (const idx of targets) { rig.ev('soloHit', { name: 'a_targ' + (13 + idx), impact: 5 }); rig.tick(0.6); }
      const before = rig.score();
      rig.ev('rampLine1');
      return before;
    },
    MISSIONS,
  };
  return rig;
}
