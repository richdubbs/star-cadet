/**
 * src/data/text.js
 * OWNER: DATA  (ARCHITECT-SEEDED, FROZEN CONTRACT: keys may be added, never renamed/removed)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * SPEC 5.11. Exact English strings of the two panel text boxes. `\n` = line break. Templates use printf-style
 * %ld / %d / %s, expanded by fmt(). In-game numbers are PLAIN decimals (no thousands separators, SPEC 0.3 E3).
 * Pure, Node-safe, frozen.
 */
import { deepFreeze } from './freeze.js';

export const APP_TITLE = 'Star Cadet';

/** Replace %ld / %d / %s left to right with args (numbers via String(Math.trunc) for %ld/%d). */
export function fmt(template, ...args) {
  let i = 0;
  return String(template).replace(/%(ld|d|s)/g, (m, k) => {
    const v = args[i++];
    return k === 's' ? String(v) : String(Math.trunc(Number(v)));
  });
}

/** info_text_box strings (score events / status). */
export const INFO = deepFreeze({
  replayAwarded: 'Replay Earned',
  centerPost: 'Center Post\n%ld',
  bonusAwarded: 'Bonus Awarded\n%ld',
  bonusActivated: 'Bonus Lit',
  weaponsUpgraded: 'Weapons Powered Up',
  engineUpgraded: 'Engines Powered Up',
  extraBallAvailable: 'Extra Ball Lit\n%ld',
  extraBall: 'Extra Ball',
  reflexShotAward: 'Reflex Shot\n%ld',
  hyperspaceBonus: 'Hyperspace Bonus\n%ld',
  jackpotAwarded: 'Jackpot!\n%ld',
  jackpotActivated: 'Jackpot Lit',
  skillShot: 'Skill Shot\n%ld',
  gamePaused: 'Game Paused\nF3 to Resume',
  continuePlay: 'Continue Play',
  f2StartsNewGame: 'F2 Starts New Game',
  careful: 'Easy Now...',
  player: 'Player %d',                 // Player 1..4
  demoPlayer: 'Demo\nPlayer %d',
  gameOver: 'Game Over',
  tilt: 'TILT!',
  shipRefueled: 'Fuel Tanks Full',
  gravityWellCheat: 'Gravity Well',
  wormhole: 'Wormhole',
  flagsUpgraded: 'Flags Powered Up',
  bonusHold: 'Bonus Hold',
  levelOneCommendation: 'Commendation: Level 1',
  levelTwoCommendation: 'Commendation: Level 2',
  levelThreeCommendation: 'Commendation: Level 3',
  fieldMultiplier: ['Score Multiplier 2x', 'Score Multiplier 3x', 'Score Multiplier 5x', 'Score Multiplier 10x'], // index = ScoreMultiplier-1
  blackHole: 'Black Hole\n%ld',
  gravityNormalized: 'Gravity Restored\n%ld',
  gravityWell: 'Gravity Well\n%ld',
  wormholeOpened: 'Wormhole Open',
  crashBonus: 'Crash Bonus\n%ld',
  replayBall: 'Replay Ball',
  redeploy: 'Ball Saved',
  playerShootAgain: 'Player %d Shoots Again',
  maelstrom: 'Maelstrom!',
});

/** mission_text_box strings. */
export const MISSION_TEXT = deepFreeze({
  awaitingDeployment: 'Ready for Launch',
  timeWarpForward: 'Time Warp Forward',
  timeWarpBackward: 'Time Warp Backward',
  missionAccepted: 'Mission Started\n%ld',
  missionCompleted: 'Mission Complete\n%ld',
  promotionTo: 'Promoted to %s',
  demotionTo: 'Demoted to %s',
  hitMissionTargets: 'Hit Mission Targets to Pick a Mission',
  refuelShip: 'Refuel the Ship',
  launchRampToAccept: 'Launch Ramp Starts %s Mission',
  attackBumperHitsLeft: 'Attack Bumpers Hits\nTo Go: %d',
  targetTrainingPassed: 'Target Practice Complete',
  missionAborted: 'Mission Failed',
  launchesLeft: 'Launches To Go: %d',
  launchTrainingPassed: 'Launch Training Complete',
  reentriesLeft: 'Re-Entries To Go: %d',
  reentryTrainingPassed: 'Re-Entry Training Complete',
  dropTargetsLeft: 'Drop Targets\nTo Go: %d',
  scienceMissionCompleted: 'Science Mission Complete',
  warningLowFuel: 'Low Fuel Warning',
  fillRightHazardBanks: 'Light Right Hazard Banks',
  hyperspaceLaunch: 'Hyperspace Launch',
  cometDestroyed: 'Comet Blasted',
  enterWormhole: 'Shoot the Wormhole',
  radiationEliminated: 'Radiation Cleared',
  upgradeLaunchBumpers: 'Power Up Launch Bumpers',
  enterBlackHole: 'Shoot the Black Hole',
  blackHoleEliminated: 'Black Hole Collapsed',
  targetsLeft: 'Targets\nTo Go: %d',
  xenomorphsDestroyed: 'Bugs Exterminated',
  upgradeFlags: 'Power Up Flags',
  survivorsRescued: 'Crew Rescued',
  aliensRepelled: 'Aliens Driven Off',
  remoteAttackBumperHitsLeft: 'Remote Attack Bumper Hits\nTo Go: %d',
  satelliteRepaired: 'Satellite Recovered',
  lanePassesLeft: 'Lane Passes\nTo Go: %d',
  surveyComplete: 'Recon Complete',
  outLanePassesLeft: 'Out Lane Passes\nTo Go: %d',
  doomsdayMachineDestroyed: 'Doomsday Machine Down',
  rollFlags: 'Flag Rolls: %d',
  hitSpaceWarpRollover: 'Roll Over Space Warp',
  plagueEliminated: 'Plague Cured',
  hitYellowWormhole: 'Shoot Yellow Wormhole',
  hitRedWormhole: 'Shoot Red Wormhole',
  hitGreenWormhole: 'Shoot Green Wormhole',
  plansRecovered: 'Secret Plans Found',
  reboundHitsLeft: 'Rebound Hits\nTo Go: %d',
  hitHyperspaceChuteOrLaunchRamp: 'Shoot Hyperspace Chute or Launch Ramp',
  dropTargetHitsLeft: 'Drop Target Hits\nTo Go: %d',
  spotTargetHitsLeft: 'Spot Target Hits\nTo Go: %d',
  lanesPassesLeft: 'Lanes Passes\nTo Go: %d',
  shootBallUpFuelChute: 'Shoot the Fuel Chute',
  hitLaunchRamp: 'Shoot Launch Ramp',
  hitFlags: 'Shoot the Flags',
  hitWormHole: 'Find the Wormhole',
  hyperspaceChuteToEndMaelstrom: 'Hyperspace Chute Ends Maelstrom',
  title: 'Star Cadet\nPinball',
  upgradeAttackBumpers: 'Power Up Attack Bumpers',
  fillLeftHazardBanks: 'Light Left Hazard Banks',
  highScore: 'HIGH SCORE',
  playerScore: "Player %d's Score\n%ld",
  highScoreN: 'High Score %d\n%ld',
  maelstrom: 'Maelstrom!',            // additive: MissionDef.doneText key of mission 18 (shown in the INFO box, same string as INFO.maelstrom)
});

/** Rank names, index = rank-1 (SPEC 5.8). */
export const RANK_NAMES = deepFreeze([
  'Cadet', 'Ensign', 'Lieutenant', 'Captain', 'Lt Commander', 'Commander', 'Commodore', 'Admiral', 'Fleet Admiral',
]);

/** Mission id -> display name (SPEC 5.7.2). */
export const MISSION_NAMES = deepFreeze({
  2: 'Target Practice', 3: 'Launch Training', 4: 'Re-Entry Training', 5: 'Science', 6: 'Stray Comet',
  7: 'Black Hole', 8: 'Space Radiation', 9: 'Bug Hunt', 10: 'Alien Menace', 11: 'Rescue',
  12: 'Satellite Retrieval', 13: 'Recon', 14: 'Doomsday Machine', 15: 'Cosmic Plague', 16: 'Secret',
  17: 'Time Warp', 18: 'Maelstrom',
});
