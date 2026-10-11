/**
 * src/render/art_keys.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.3 (additive pure module; no three import)
 * The ArtPack members RENDER reads, in one place, so tests/render.test.mjs can prove that ART delivers every one of them
 * (RENDER itself tolerates any of them being missing and falls back to a flat PALETTE colour).
 */

/** ArtPack.misc keys consumed by materials.js (name -> where it is used). */
export const MISC_KEYS_USED = Object.freeze({
  ballEnv: 'equirectangular environment of the chrome ball and of every metal (PMREM)',
  metalSide: 'cabinet and wall sides',
  wallTop: 'rail ribbons on top of the walls (v across the rail: red edge stripes)',
  rubber: 'slingshot / rebounder / wormhole rubbers',
  postBand: 'red band of the guide posts',
  bumperDrum: 'pop bumper drum',
  bumperStar: 'pop bumper star ring (white, tinted per level)',
  bumperCap: 'pop bumper cap',
  targetYellow: 'drop and spot target faces',
  flagPanel: 'flag spinner panels',
  flipperBody: 'flipper top (u along the long axis)',
  rampSide: 'ramp / deck rails and the tube hood',
  plungerRod: 'plunger head and shaft',
});

/** Top-level ArtPack members consumed: floor / deck patches (canvas + rect + width + height) and the lamp atlas (canvas + cells). */
export const ARTPACK_MEMBERS_USED = Object.freeze(['floor', 'deck', 'lampAtlas', 'misc']);
