/**
 * src/data/constants.js
 * OWNER: DATA  (ARCHITECT-SEEDED, real values. DATA must verify against SPEC and may ADD exports; never rename/remove.)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * SPEC refs: 1.1-1.7, 4.1, 5.12, 6.1-6.3, 7. Pure, Node-safe, frozen.
 * T-frame everywhere: +x = screen-LEFT, +y = toward the player, +z = up.
 */
import { deepFreeze } from './freeze.js';

/** Playfield rectangle, ball, drain (SPEC 1.1). */
export const TABLE = deepFreeze({
  xMin: -8, xMax: 8, yMin: -14, yMax: 15, width: 16, height: 29,
  R: 0.3,                       // ball radius = wall inflation offset
  drainY: 14.437246,            // drain line (off-screen)
  visibleBottomY: 13.496,       // last visible table row in the original view
  centerX: 0, centerY: 0.5,     // table centre (Three.js: x=0, z=0.5)
});

/** Physics constants (SPEC 4.1). */
export const PHYS = deepFreeze({
  gravity: [3.916845e-6, 11.985638],   // u/s^2 ; +y is toward the player
  drag: 0.2,                           // linear drag per second (also ramp extra drag)
  jitter: 0.2,                         // lateral jitter coefficient: ax += -(0.5-rand01)*speed*0.2
  maxSpeed: 60,                        // 200*R
  subStep: 0.15,                       // R/2
  dt: 1 / 120,                         // fixed update
  maxFrameDt: 0.1,
  rayMinDist: 0.002,
  separationEps: 0.0005,
  cornerScale: 1.001,                  // corner circle radius = offset * 1.001
  slowSpeed: 0.8, slowDt: 0.01,        // slow-ball dt cap
  ballPairBox: 0.9, ballContact: 0.598,
  unstuckSpeed: 0.8, unstuckSeconds: 0.5, unstuckMaxCount: 20,
  maxBalls: 20,
  grid: { boxesX: 10, boxesY: 15 },
  outlineKicker: { threshold: 5, boost: 15 },   // table outline lines (never inflated)
  tableOutline: [[8, 15], [-8, 15], [-8, -14], [8, -14], [8, 15]],
  rampForceScale: 25,                  // plane force = 25*sin(g1)*(cos g2, sin g2)
  exactThrowBug: true,                 // SPEC 4.9.6 / 9 #14
});

/** Collision mask bits (SPEC 1.5). */
export const MASKS = deepFreeze({ PLAYFIELD: 1, RAMP: 2, DECK: 4, SHELL103: 6 });

/** Heights used by physics bookkeeping (SPEC 1.5). */
export const Z = deepFreeze({ floor: 0, ball: 0.3, deck: 1.068, ballOnDeck: 1.368, tubeBall: -4.7, holeRelease: 0.325772 });

/** Original camera (SPEC 1.3/1.4). */
export const CAMERA = deepFreeze({
  matrixRows: [[1, 0, 0, 0], [0, -0.913545, 0.406737, 3.791398], [0, -0.406737, -0.913545, 24.675402]],
  D: -400.000702,
  principal: [183, 238],               // px inside the 365x470 table bitmap
  viewport: [365, 416],                // visible window
  fullFrame: [366, 476],               // symmetric frustum used with setViewOffset
  fovDeg: 61.505,
  near: 0.5, far: 120,
  position: [0, 13.5, 21.0],           // T-frame
  forward: [0, -0.406737, -0.913545],  // T-frame
  up: [0, -0.913545, 0.406737],        // T-frame screen-up
});

/** Reference layout space of the original window + panel fields in PANEL-LOCAL px (SPEC 6.1-6.3). */
export const PANEL = deepFreeze({
  virtual: { w: 600, h: 416 },
  table: { x: 0, y: 0, w: 365, h: 416 },
  rect: { x: 386, y: 12, w: 203, h: 394 },        // panel bitmap position in the 600x416 space
  fields: {                                         // local to the panel bitmap (original rect minus (386,12))
    score1:   { x: 47,  y: 185, w: 135, h: 22, cellW: 15, cells: 9 },
    player1:  { x: 17,  y: 185, w: 15,  h: 22 },
    ball1:    { x: 167, y: 140, w: 15,  h: 22 },
    info:     { x: 19,  y: 227, w: 165, h: 44, cellW: 11, cellH: 22, cols: 15, rows: 2 },
    mission:  { x: 19,  y: 291, w: 165, h: 88, cellW: 11, cellH: 22, cols: 15, rows: 4 },
  },
  colors: { dotMid: '#7858e8', dotHi: '#98c8f8', dotShade: '#282858', black: '#000000',
            bezel: '#888888', bezelHi: '#b8b8b8', bezelLo: '#484848' },
});

/** Default key bindings: GameAction -> KeyboardEvent.code (SPEC 6.5). */
export const DEFAULT_KEYS = deepFreeze({
  flipperLeft: 'KeyZ', flipperRight: 'Slash', plunger: 'Space',
  nudgeLeft: 'KeyX', nudgeRight: 'Period', nudgeBottom: 'ArrowUp',
});

/** Id -> component-name lookups shared by physics (snapshot keys), rules and render. */
export const NAMES = deepFreeze({
  kickout:  { 1: 'a_kout1', 2: 'a_kout2', 3: 'a_kout3' },
  sink:     { 1: 'v_sink1', 2: 'v_sink2', 3: 'v_sink3', 7: 'v_sink7' },
  kickback: { 1: 'a_kick1', 2: 'a_kick2' },
  gate:     { 1: 'v_gate1', 2: 'v_gate2' },
});

/** Every timer in seconds (SPEC 4.14, 5.12). */
export const TIMING = deepFreeze({
  bumperHit: 0.1, rebounderFlash: 0.1, popupRepop: 0.25, soloRearm: 0.1, rolloverRearm: 0.1, rolloverSprite: 0.15,
  kickbackArm: 0.7, kickbackTick: 0.1,
  kickoutDefaultHold: 1.5, kickoutRearm: 0.05, sinkHold: 2.0, sinkBusyRetry: 0.5, rampHoleHold: 0.5, rampHoleDrop: 0.5,
  drainDelay: 1.82, feedDelay: 0.96, feedRetry: 1.0,
  plungerTick: 0.025, plungerRelaunchTick: 0.025 / 4,
  nudgeUndo: 0.4, nudgeWarn: 0.5, nudgeTilt: 1.0, nudgeRise: 4, nudgeGrace: -2,
  tiltTimeout: 30, carefulText: 2.0,
  gameOverToEnd: 3.0, demoRestart: 5.0, lightShowFallback: 5.0, lightShowStep: 0.2,
  centerPostOn: 55, centerPostFlash: 5, extraBallOn: 55, extraBallFlash: 5,
  upgradeWindow: 60, bumperDecay: 60, hyperspaceDecay: 60, medalDecay: 30, multiplierDecay: 30,
  reflexWindow: 5, ballSaveSteady: 5, ballSaveFlash: 5,
  skillLampFlash: 1.0, rankFlash: 5, lampFlash: 2,
  textMinDisplay: 0.25, textSkipOverdue: 2.0,
});

// ---------------------------------------------------------------------------------------------------
// Original-camera projection (SPEC 1.3). Real code - DATA tests assert the SPEC checkpoints.
// ---------------------------------------------------------------------------------------------------
const _Y1 = [-0.913545, 0.406737, 3.791398];
const _Z1 = [-0.406737, -0.913545, 24.675402];

/**
 * T-frame point -> pixel in the 365x470 table bitmap of the original camera.
 * @param {number} x @param {number} y @param {number} [z=0]
 * @returns {[number, number]}
 */
export function projectToTablePx(x, y, z = 0) {
  const y1 = _Y1[0] * y + _Y1[1] * z + _Y1[2];
  const z1 = _Z1[0] * y + _Z1[1] * z + _Z1[2];
  return [x * CAMERA.D / z1 + CAMERA.principal[0], y1 * CAMERA.D / z1 + CAMERA.principal[1]];
}

/**
 * Inverse of projectToTablePx for a point on the floor (z = 0).
 * @param {number} px @param {number} py
 * @returns {[number, number]}  T-frame [x, y]
 */
export function unprojectFloor(px, py) {
  const x2 = (px - CAMERA.principal[0]) / CAMERA.D;
  const y2 = (py - CAMERA.principal[1]) / CAMERA.D;
  const y = (y2 * 24.675402 - 3.791398) / (-0.913545 + 0.406737 * y2);
  const x = x2 * (24.675402 - 0.406737 * y);
  return [x, y];
}
