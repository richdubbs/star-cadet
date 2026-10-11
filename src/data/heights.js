/**
 * src/data/heights.js
 * OWNER: DATA  (ARCHITECT-SEEDED)  SPEC 3.6. Visual heights above the playfield floor, T-frame units. [E] = estimated.
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * Three.js y = height. Only RENDER and ART read this.
 */
import { deepFreeze } from './freeze.js';

export const HEIGHTS = deepFreeze({
  floor: 0, ball: 0.3, ballOnDeck: 1.368, deckSurface: 1.068, tubeBallZ: -4.7,
  cabinetWall: 1.6, wall: 0.85, wallEndCap: 0.9,
  postCap: 0.9, postRubberBand: [0.25, 0.65],
  deckWallTop: 1.75, rampRailAbove: 0.7, slabThickness: 0.12,
  attackBumper: { radius: 0.77, drumTop: 0.6, capTravel: 0.2, baseRingRadius: 0.85 },
  launchBumper: { radius: 0.47, bodyAboveDeck: 0.5, capTravel: 0.25 },
  flipperThickness: 0.36, dropTargetTop: 0.70, dropTargetDropped: -0.05, spotTargetTop: 0.33,
  spotTargetTops: { a_targ10: 0.4, a_targ11: 0.7, a_targ12: 0.45, a_targ13: 0.2, a_targ14: 0.2, a_targ15: 0.2, a_targ22: 0.36 },
  plungerRodDia: 0.5, plungerTravel: 1.0, kickerPlate: 0.4, gateFlap: 0.3, blockerPost: 0.7,
  oneWayWireZ: 0.40, oneWayEndPost: 0.6, oneWayWireRadius: 0.04,
  flagPanelChord: 0.8, flagAxisZ: 0.45, rollover: 0.01, rubberBandTop: 0.6, slingshotBody: 0.85,
  wormholeRubber: 0.5, deckPost: 1.57, lampRaised: 0.5, lampFlat: 0.01, lampOnDeck: 1.078,
  wallTops: { w306_307: 1.6, w308_309: 1.77 },
});
