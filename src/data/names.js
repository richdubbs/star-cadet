/**
 * src/data/names.js
 * OWNER: DATA  (ARCHITECT-SEEDED, REAL VALUES. FROZEN CONTRACT: names may be added, never renamed or removed)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * Canonical DAT component / lamp / group names. These key the PhysicsSnapshot, the LampsView and every lookup table.
 * SPEC 2.1, 5.13, Appendix A. Pure, Node-safe, frozen.
 */
import { deepFreeze } from './freeze.js';

const seq = (prefix, a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(prefix + i); return r; };

/** Component names by category (order = DAT order). */
export const COMPONENT_NAMES = deepFreeze({
  flippers: ['a_flip1', 'a_flip2'],                       // a_flip1 = LEFT on screen (+x side), a_flip2 = RIGHT
  plunger: 'plunger',
  drain: 'drain',
  blocker: 'v_bloc1',
  rampHole: 'ramp_hole',
  demo: 'demo',
  ramps: ['ramp', 's_ramp9'],
  bumpers: seq('a_bump', 1, 7),                           // 1-4 attack, 5-7 launch
  popups: seq('a_targ', 1, 9),                            // drop targets
  solos: seq('a_targ', 10, 22),                           // spot targets
  rebounders: seq('v_rebo', 1, 4),
  kickbacks: ['a_kick1', 'a_kick2'],
  gates: ['v_gate1', 'v_gate2'],
  kickouts: ['a_kout1', 'a_kout2', 'a_kout3'],            // gravity well, hyperspace, black hole
  sinks: ['v_sink1', 'v_sink2', 'v_sink3', 'v_sink7'],    // red, green, yellow wormholes, escape chute
  oneways: ['s_onewy1', 's_onewy4', 's_onewy7', 's_onewy8', 's_onewy9', 's_onewy10', 's_onewy11', 's_onewy12', 's_onewy13'],
  tripwires: seq('s_trip', 1, 5),
  rollovers: [...seq('a_roll', 1, 8), 'a_roll110', 'a_roll111', 'a_roll112', ...seq('a_roll', 179, 184)],   // 17 plain rollovers
  lightRollover: 'a_roll9',                               // space warp (type 1020)
  flags: ['a_flag1', 'a_flag2'],
  attackBumpers: seq('a_bump', 1, 4),
  launchBumpers: seq('a_bump', 5, 7),
});

/** Target banks (SPEC 2.17, 2.18, 5.4). Index inside a bank = array index. */
export const BANKS = deepFreeze({
  booster: ['a_targ1', 'a_targ2', 'a_targ3'],
  medal: ['a_targ4', 'a_targ5', 'a_targ6'],
  multiplier: ['a_targ7', 'a_targ8', 'a_targ9'],
  fuelSpot: ['a_targ10', 'a_targ11', 'a_targ12'],
  missionSpot: ['a_targ13', 'a_targ14', 'a_targ15'],   // top, middle, bottom
  leftHazard: ['a_targ16', 'a_targ17', 'a_targ18'],
  rightHazard: ['a_targ19', 'a_targ20', 'a_targ21'],
  wormholeTarget: ['a_targ22'],
});

/** All 140 lamp names sorted numerically (literoll179..184 last). 'lite192' has no bitmap/position. */
export const LAMP_NAMES = deepFreeze([
  'lite1', 'lite2', 'lite3', 'lite4', 'lite5', 'lite6',
  'lite7', 'lite8', 'lite9', 'lite10', 'lite11', 'lite12',
  'lite13', 'lite16', 'lite17', 'lite18', 'lite19', 'lite20',
  'lite21', 'lite22', 'lite23', 'lite24', 'lite25', 'lite26',
  'lite27', 'lite28', 'lite29', 'lite30', 'lite38', 'lite39',
  'lite40', 'lite44', 'lite45', 'lite46', 'lite47', 'lite48',
  'lite49', 'lite50', 'lite51', 'lite52', 'lite54', 'lite55',
  'lite56', 'lite58', 'lite59', 'lite60', 'lite61', 'lite62',
  'lite63', 'lite64', 'lite65', 'lite66', 'lite67', 'lite68',
  'lite69', 'lite70', 'lite71', 'lite72', 'lite77', 'lite84',
  'lite85', 'lite101', 'lite102', 'lite103', 'lite104', 'lite105',
  'lite106', 'lite107', 'lite108', 'lite109', 'lite110', 'lite130',
  'lite131', 'lite132', 'lite133', 'lite144', 'lite145', 'lite146',
  'lite147', 'lite148', 'lite149', 'lite150', 'lite151', 'lite152',
  'lite154', 'lite155', 'lite156', 'lite157', 'lite158', 'lite159',
  'lite160', 'lite161', 'lite162', 'lite169', 'lite170', 'lite171',
  'lite185', 'lite186', 'lite187', 'lite188', 'lite189', 'lite190',
  'lite191', 'lite192', 'lite193', 'lite194', 'lite195', 'lite196',
  'lite198', 'lite199', 'lite200', 'lite300', 'lite301', 'lite302',
  'lite303', 'lite304', 'lite305', 'lite306', 'lite307', 'lite308',
  'lite309', 'lite310', 'lite311', 'lite312', 'lite313', 'lite314',
  'lite315', 'lite316', 'lite317', 'lite318', 'lite319', 'lite320',
  'lite321', 'lite322', 'literoll179', 'literoll180', 'literoll181', 'literoll182',
  'literoll183', 'literoll184',
]);

/** The 18 light groups (TLightGroup) + the fuel bargraph (TLightBargraph). Members/order: Appendix A (src/data/lamps.js). */
export const LAMP_GROUP_NAMES = deepFreeze([
  'goal_lights', 'middle_circle', 'outer_circle', 'bmpr_inc_lights', 'ramp_bmpr_inc_lights', 'right_target_lights',
  'top_target_lights', 'bumper_target_lights', 'skill_shot_lights', 'hyperspace_lights', 'bpr_solotgt_lights',
  'lchute_tgt_lights', 'top_circle_tgt_lights', 'ramp_tgt_lights', 'bsink_arrow_lights', 'l_trek_lights',
  'r_trek_lights', 'worm_hole_lights',
]);
/** Name of the bargraph (fuel gauge) and of the hidden all-lamps group. */
export const FUEL_BARGRAPH_NAME = 'fuel_bargraph';
export const ALL_LAMPS_GROUP_NAME = 'all';
