/**
 * src/data/scoring.js
 * OWNER: DATA  (ARCHITECT-SEEDED, FROZEN CONTRACT: keys may be added, never renamed/removed)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * SPEC 5.1, 5.3. All raw point values. Rules apply the field multiplier (MULTIPLIERS[idx]) only inside AddScore.
 * Pure, Node-safe, frozen.
 */
import { deepFreeze } from './freeze.js';

export const SCORE = deepFreeze({
  bumperAttack: [500, 1000, 1500, 2000],       // a_bump1-4 by bumper level 0..3
  bumperLaunch: [1500, 2500, 3500, 4500],      // a_bump5-7 by level 0..3
  reentryLane: 2000,                           // a_roll1-3
  launchLane: 500,                             // a_roll110-112
  rebounder: 500,                              // v_rebo1-4
  outlane: 20000,                              // a_roll4, a_roll8
  returnLane: 5000,                            // a_roll6, a_roll7
  returnLaneLit: 25000,                        // when lite27 (roll6) / lite28 (roll7) lit
  bonusLaneUnlit: 10000,                       // a_roll5 with lite16 unlit (lit: pays BonusScore via SpecialAdd)
  fuelRollover: 500,                           // a_roll179-184
  flagFrame: 500, flagFrameUpgraded: 2500,     // per sprite step; upgraded when lite20 lit
  spaceWarp: 10000,                            // a_roll9
  rampPlain: 5000,                             // launch ramp with no ramp lamp
  reflexShotStart: 25000,                      // ReflexShotScore at every ball feed
  skillShot: [15000, 30000, 75000, 30000, 15000, 7500],   // index = lit skill-shot lamps - 1
  hyperspace: [10000, null, 20000, 50000, 150000],        // by n = lit hyper lamps BEFORE the hit; null = pays JackpotScore (SpecialAdd)
  blackHole: 20000,
  gravityWell: 50000,
  wormhole: { none: 2500, match: 5000, mismatch: 7500 },
  booster: { each: 500, setComplete: 5000, allLitExtra: 5000 },         // a_targ1-3
  medal: { each: 1500, level1: 10000, level2: 50000 },                  // a_targ4-6 (level 3 = extra ball, no points)
  multiplier: { each: 500, setComplete: 1500 },                         // a_targ7-9
  fuelSpot: 750, missionSpot: 1000, hazard: 750, wormholeTarget: 750,  // a_targ10-12 / 13-15 / 16-21 / 22
  acceptMission: { low: 10000, mid: 20000, high: 30000 },              // ids 2-5 / 6-14 / 15-18 (see acceptScoreFor)
});

/** Field multiplier by ScoreMultiplier index 0..4. */
export const MULTIPLIERS = deepFreeze([1, 2, 3, 5, 10]);

/** Bonus / jackpot pot constants (SPEC 5.1, 5.4.7). */
export const POTS = deepFreeze({
  bonusNewGame: 10000, bonusAfterBall: 25000, jackpotStart: 20000, cap: 5000000,
  grandRewardMin: 100000, maxScore: 999999999, e9: 1000000000,
});

/** Mission accept score by mission id (SPEC 5.7.2). */
export function acceptScoreFor(id) {
  if (id >= 15) return SCORE.acceptMission.high;
  if (id >= 6) return SCORE.acceptMission.mid;
  return SCORE.acceptMission.low;
}
