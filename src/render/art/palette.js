/**
 * src/render/art/palette.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2; SPEC 6.8
 * PALETTE (original look, SPEC 6.8 colours) and bumper level ring colours (SPEC 9 #17). ART may add keys; RENDER may import this file.
 * Pure data (frozen); no imports.
 */
export const PALETTE = Object.freeze({
  // --- keys fixed by the architecture (never rename / remove) ---
  floorNavy: '#182848', floorNavy2: '#1f2342', vein: '#385868', ringCyan: '#3f98b7', gravityDot: '#741111', rimBrown: '#2a1512',
  lampOrange: '#ba4c0d', lampBlue: '#0c1c8a', lilacLight: '#9878b8', lilacMid: '#684888', lilacDark: '#5848a8', pink: '#c458c5',
  deck: '#8c70ab', deckRim: '#4a2a28', wallMetal: '#484848', wallMetalDark: '#383838', railSilver: '#b4b8c0', railRed: '#c41315',
  copper: '#865a43', copperLight: '#c89050', bumperWhite: '#e5d9d0', bumperCap: '#0b1a86', targetYellow: '#faf947',
  targetFrame: '#b89868', flipperBody: '#c9ccd2', flipperRim: '#e85050', apron: '#181818', ball: '#c8ccd2', plunger: '#a0a4ac',
  // --- ART additions (SPEC 6.8 / ui.md L5-L6 colour notes) ---
  copperDark: '#784838', copperEdge: '#5a3426', bandLight: '#9376b3', bandMid: '#73598f', bandDark: '#60437a', rampSide: '#1d1431',
  spikeViolet: '#6e568b', spikeViolet2: '#64457e', starOutline: '#462047', spikeBlue: '#5941ad',
  nebulaHaze: '#542829', nebulaCore: '#d1c9c8', rockGrey: '#5e5c5a', rocketRed: '#9e2923', patchRed: '#b4766e', outlineBlue: '#6fb4e8',
  blueX: '#1c2ea0', apronText: '#6a2020', olive: '#79780f', oliveDark: '#515109', webTeal: '#313358', studWhite: '#e8e8f0',
  panelBezel: '#888888', panelHi: '#b8b8b8', panelLo: '#484848', dotMid: '#7858e8', dotHi: '#98c8f8', dotShade: '#282858',
  logoFace: '#c8a8e8', logoFace2: '#b898d8', logoShadow: '#9878b8', logoSmall: '#8868f8', ballText: '#b82828', ballTextDark: '#780808',
  hazardYellow: '#e8c020', hazardBlack: '#15110c',
});
/** Ring colour per bumper level 0..3 (red->orange->yellow->white attack; blue->cyan->green->white launch). */
export const BUMPER_RING_COLORS = Object.freeze({
  attack: Object.freeze(['#c41315', '#e8651a', '#f0c020', '#ffffff']),
  launch: Object.freeze(['#815cd2', '#3cb4e0', '#3cc860', '#ffffff']),
});
/** @param {'attack'|'launch'} kind @param {number} level 0..3 */
export function bumperRingColor(kind, level) { return BUMPER_RING_COLORS[kind][Math.max(0, Math.min(3, level | 0))]; }
