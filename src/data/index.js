/**
 * src/data/index.js
 * OWNER: DATA
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 * CONTRACT: ARCHITECTURE.md 3: the data barrel (import * as data from "./data/index.js")
 * Re-exports every src/data module. Export names must stay unique across modules.
 */
export * from './freeze.js';
export * from './constants.js';
export * from './events.js';
export * from './heights.js';
export * from './materials.js';
export * from './scoring.js';
export * from './text.js';
export * from './names.js';
export * from './sounds.js';
export * from './walls.js';
export * from './components.js';
export * from './ramps.js';
export * from './lamps.js';
export * from './missions.js';
