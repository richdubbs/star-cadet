/**
 * src/render/art/index.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2; type ArtPack
 * paintAll(data, opts) -> ArtPack. Pure given opts.createCanvas (browser canvas or tests/helpers/fake_canvas.mjs). Deterministic for a given seed:
 * every painter gets its own mulberry32 stream derived from the seed, so the same seed gives identical drawing operations and changing one
 * painter never shifts the random numbers of another.
 * ASSUMPTIONS: quality 'high' / 'normal' / 'low' = floor width 2048 / 1536 / 1024 px, deck width = floor width / 2, lamp cells 128 px (64 px at 'low');
 * an unknown quality string falls back to 'normal'.
 */
import { mulberry32 } from './rng.js';
import { paintFloor } from './floor.js';
import { paintDeck } from './deck.js';
import { buildLampAtlas } from './lamps.js';
import { paintPanel } from './panel.js';
import { paintMisc } from './misc.js';

const FLOOR_WIDTH = { high: 2048, normal: 1536, low: 1024 };
const CELL_PX = { high: 128, normal: 128, low: 64 };

/**
 * @param {import('../../types.js').DataModule} data
 * @param {import('../../types.js').PaintOpts} opts
 * @returns {import('../../types.js').ArtPack}
 */
export function paintAll(data, opts) {
  if (!opts || typeof opts.createCanvas !== 'function') throw new TypeError('paintAll: opts.createCanvas(w, h) is required');
  const quality = FLOOR_WIDTH[opts.quality] ? opts.quality : 'normal';
  const seed = (opts.seed ?? 1995) >>> 0;
  const stream = (k) => mulberry32((seed + Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  const w = FLOOR_WIDTH[quality];
  return {
    floor: paintFloor(data, opts.createCanvas, stream(0), w),
    deck: paintDeck(data, opts.createCanvas, stream(1), Math.round(w / 2)),
    lampAtlas: buildLampAtlas(data, opts.createCanvas, stream(2), CELL_PX[quality]),
    misc: paintMisc(data, opts.createCanvas, stream(3)),
    panel: paintPanel(data, opts.createCanvas, stream(4)),
  };
}
