/**
 * src/data/missions.js
 * OWNER: DATA
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 3.9; type MissionDef; SPEC 5.7 (hand-written from the SPEC text, verified by tests/data.test.mjs)
 * MISSION_STATE (field(lite198) values), MISSIONS[id] for ids 2..18 (SPEC 5.7.3 / 5.7.4 / 5.7.5), MISSION_SELECT (rank group x spot-target level,
 * SPEC 5.7.2), rankGroupOf, missionForRank. Pure, Node-safe, frozen.
 *
 * MissionDef (typedef in src/types.js) plus ADDITIVE fields:
 *   stageCounters  counter of each entry of `states` (same order, null = that stage is not counter based). `counter` = the first non-null one
 *                  (null for the missions without a counter: Stray Comet, Black Hole, Space Radiation, Secret).
 *   doneBox        'mission' (default) or 'info': which text box shows `doneText` (Maelstrom! goes to the info box, SPEC 5.7.3). `doneText` is
 *                  always a key of MISSION_TEXT (the Maelstrom key was added there; INFO.maelstrom holds the same string).
 *   doneTextAlt    Time Warp only: the backward-branch completion text ('timeWarpBackward'); `doneText` is the forward one.
 * ASSUMPTIONS: Time Warp `rankPts` 12 is the forward value (the backward branch demotes and gives no rank points, RULES handles it);
 * Alien Menace `counter` 8 belongs to part 2 (state 20), part 1 (state 10) is "raise an attack-bumper level above 0"; Rescue counter 1 is the
 * single hyperspace entry; Recon/Doomsday/Satellite counters are the lane-pass / outlane-pass / a_bump4-hit counts of SPEC 5.7.4.
 */
import { deepFreeze } from './freeze.js';

/** field(lite198) values (SPEC 5.7.1). */
export const MISSION_STATE = deepFreeze({
  WAITING_DEPLOYMENT: 0, SELECT_MISSION: 1, TARGET_PRACTICE: 2, LAUNCH_TRAINING: 3, REENTRY_TRAINING: 4, SCIENCE: 5,
  STRAY_COMET: 6, BLACK_HOLE: 7, SPACE_RADIATION: 8, BUG_HUNT: 9, ALIEN_MENACE: 10, RESCUE: 11, SATELLITE: 12,
  RECONNAISSANCE: 13, DOOMSDAY_MACHINE: 14, COSMIC_PLAGUE: 15, SECRET_YELLOW: 16, TIME_WARP: 17, MAELSTROM: 18,
  ALIEN_MENACE_2: 20, COSMIC_PLAGUE_2: 21, SECRET_RED: 22, SECRET_GREEN: 23, TIME_WARP_2: 24,
  MAELSTROM_2: 25, MAELSTROM_3: 26, MAELSTROM_4: 27, MAELSTROM_5: 28, MAELSTROM_6: 29, MAELSTROM_7: 30, MAELSTROM_8: 31,
  GAME_OVER: 32,
});

/**
 * The 17 missions, keyed by mission id (= the state the mission starts in). accept = SpecialAdd on acceptance (10,000 ids 2-5, 20,000 ids 6-14,
 * 30,000 ids 15-18), reward = SpecialAdd on completion (no field multiplier), rankPts = AddRankProgress points (18 = one promotion).
 * @type {Readonly<Record<number, import('../types.js').MissionDef>>}
 */
export const MISSIONS = deepFreeze({
  2: { id: 2, key: 'targetPractice', name: 'Target Practice', counter: 8, accept: 10000, reward: 500000, rankPts: 6,
    doneText: 'targetTrainingPassed', states: [2], stageCounters: [8], doneBox: 'mission', doneTextAlt: null },
  3: { id: 3, key: 'launchTraining', name: 'Launch Training', counter: 3, accept: 10000, reward: 500000, rankPts: 6,
    doneText: 'launchTrainingPassed', states: [3], stageCounters: [3], doneBox: 'mission', doneTextAlt: null },
  4: { id: 4, key: 'reentryTraining', name: 'Re-Entry Training', counter: 3, accept: 10000, reward: 500000, rankPts: 6,
    doneText: 'reentryTrainingPassed', states: [4], stageCounters: [3], doneBox: 'mission', doneTextAlt: null },
  5: { id: 5, key: 'science', name: 'Science', counter: 9, accept: 10000, reward: 750000, rankPts: 9,
    doneText: 'scienceMissionCompleted', states: [5], stageCounters: [9], doneBox: 'mission', doneTextAlt: null },
  6: { id: 6, key: 'strayComet', name: 'Stray Comet', counter: null, accept: 20000, reward: 1000000, rankPts: 8,
    doneText: 'cometDestroyed', states: [6], stageCounters: [null], doneBox: 'mission', doneTextAlt: null },
  7: { id: 7, key: 'blackHole', name: 'Black Hole', counter: null, accept: 20000, reward: 1000000, rankPts: 8,
    doneText: 'blackHoleEliminated', states: [7], stageCounters: [null], doneBox: 'mission', doneTextAlt: null },
  8: { id: 8, key: 'spaceRadiation', name: 'Space Radiation', counter: null, accept: 20000, reward: 1000000, rankPts: 8,
    doneText: 'radiationEliminated', states: [8], stageCounters: [null], doneBox: 'mission', doneTextAlt: null },
  9: { id: 9, key: 'bugHunt', name: 'Bug Hunt', counter: 15, accept: 20000, reward: 750000, rankPts: 7,
    doneText: 'xenomorphsDestroyed', states: [9], stageCounters: [15], doneBox: 'mission', doneTextAlt: null },
  10: { id: 10, key: 'alienMenace', name: 'Alien Menace', counter: 8, accept: 20000, reward: 750000, rankPts: 7,
    doneText: 'aliensRepelled', states: [10, 20], stageCounters: [null, 8], doneBox: 'mission', doneTextAlt: null },
  11: { id: 11, key: 'rescue', name: 'Rescue', counter: 1, accept: 20000, reward: 750000, rankPts: 7,
    doneText: 'survivorsRescued', states: [11], stageCounters: [1], doneBox: 'mission', doneTextAlt: null },
  12: { id: 12, key: 'satellite', name: 'Satellite Retrieval', counter: 3, accept: 20000, reward: 1250000, rankPts: 9,
    doneText: 'satelliteRepaired', states: [12], stageCounters: [3], doneBox: 'mission', doneTextAlt: null },
  13: { id: 13, key: 'recon', name: 'Recon', counter: 15, accept: 20000, reward: 1250000, rankPts: 9,
    doneText: 'surveyComplete', states: [13], stageCounters: [15], doneBox: 'mission', doneTextAlt: null },
  14: { id: 14, key: 'doomsdayMachine', name: 'Doomsday Machine', counter: 3, accept: 20000, reward: 1250000, rankPts: 9,
    doneText: 'doomsdayMachineDestroyed', states: [14], stageCounters: [3], doneBox: 'mission', doneTextAlt: null },
  15: { id: 15, key: 'cosmicPlague', name: 'Cosmic Plague', counter: 75, accept: 30000, reward: 1750000, rankPts: 11,
    doneText: 'plagueEliminated', states: [15, 21], stageCounters: [75, null], doneBox: 'mission', doneTextAlt: null },
  16: { id: 16, key: 'secret', name: 'Secret', counter: null, accept: 30000, reward: 1500000, rankPts: 10,
    doneText: 'plansRecovered', states: [16, 22, 23], stageCounters: [null, null, null], doneBox: 'mission', doneTextAlt: null },
  17: { id: 17, key: 'timeWarp', name: 'Time Warp', counter: 25, accept: 30000, reward: 2000000, rankPts: 12,
    doneText: 'timeWarpForward', states: [17, 24], stageCounters: [25, null], doneBox: 'mission', doneTextAlt: 'timeWarpBackward' },
  18: { id: 18, key: 'maelstrom', name: 'Maelstrom', counter: 3, accept: 30000, reward: 5000000, rankPts: 18,
    doneText: 'maelstrom', states: [18, 25, 26, 27, 28, 29, 30, 31], stageCounters: [3, 3, 5, null, null, null, null, null],
    doneBox: 'info', doneTextAlt: null },
});

/** Mission id chosen by [rankGroup][level-1]; level 1/2/3 = top/middle/bottom mission spot target, 4 = all three (SPEC 5.7.2). */
export const MISSION_SELECT = deepFreeze({
  1: [3, 4, 2, 5],        // Cadet:            Launch Training, Re-Entry Training, Target Practice, Science
  2: [9, 11, 10, 16],     // Ensign, Lt:       Bug Hunt, Rescue, Alien Menace, Secret
  3: [6, 8, 7, 15],       // Captain, Lt Cdr:  Stray Comet, Space Radiation, Black Hole, Cosmic Plague
  4: [12, 13, 14, 17],    // Cdr, Commodore:   Satellite, Recon, Doomsday, Time Warp
  5: [15, 16, 17, 18],    // Admiral, Fleet:   Cosmic Plague, Secret, Time Warp, Maelstrom
});

/** rank 1..9 -> rank group 1..5. */
export function rankGroupOf(rank) {
  if (rank <= 1) return 1;
  if (rank <= 3) return 2;
  if (rank <= 5) return 3;
  if (rank <= 7) return 4;
  return 5;
}

/** Mission id for a rank (1..9) and level (1..4). */
export function missionForRank(rank, level) {
  return MISSION_SELECT[rankGroupOf(rank)][level - 1];
}
