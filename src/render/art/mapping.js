/**
 * src/render/art/mapping.js
 * OWNER: ART
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.2; type CanvasPatch
 * REAL, shared by ART and RENDER: T-frame <-> patch pixels / UV. px = (xMax-x)/(xMax-xMin)*W ; py = (y-yMin)/(yMax-yMin)*H ; u = px/W ; v = 1 - py/H.
 * Pure (no imports).  The canvas looks exactly like the table seen from above by the player: x = +8 is at the LEFT edge, y = -14 at the top.
 *
 * Additive helpers (ART-owned, optional for RENDER): DECK_RECT, patchHeight, lampCellUV.
 */
/** Whole playfield rectangle painted into ArtPack.floor. */
export const FLOOR_RECT = Object.freeze({ xMin: -8, xMax: 8, yMin: -14, yMax: 15 });
/** Bounding box of shell 103 (SPEC 3.5.2) = the rectangle painted into ArtPack.deck. */
export const DECK_RECT = Object.freeze({ xMin: 1.04, xMax: 7.65, yMin: -2.06, yMax: 7.94 });

/** Height in px of a patch of the given width so that px per unit is the same in x and y. */
export function patchHeight(rect, widthPx) {
  return Math.round((widthPx * (rect.yMax - rect.yMin)) / (rect.xMax - rect.xMin));
}

/** @param {{rect:{xMin:number,xMax:number,yMin:number,yMax:number}, width:number, height:number}} patch @returns {[number, number]} */
export function patchPx(patch, x, y) {
  const r = patch.rect;
  return [((r.xMax - x) / (r.xMax - r.xMin)) * patch.width, ((y - r.yMin) / (r.yMax - r.yMin)) * patch.height];
}
/** Inverse of patchPx. @returns {[number, number]} T-frame [x, y] */
export function pxToTable(patch, px, py) {
  const r = patch.rect;
  return [r.xMax - (px / patch.width) * (r.xMax - r.xMin), r.yMin + (py / patch.height) * (r.yMax - r.yMin)];
}
/** Three.js texture UV (flipY = true). @returns {[number, number]} */
export function patchUV(patch, x, y) {
  const [px, py] = patchPx(patch, x, y);
  return [px / patch.width, 1 - py / patch.height];
}
/** Pixels per table unit (x direction) of a patch. */
export function patchScale(patch) { return patch.width / (patch.rect.xMax - patch.rect.xMin); }

/**
 * UV (flipY convention, like patchUV) inside an atlas cell of a point given in the lamp quad's LOCAL T-frame coordinates (before the
 * quad is rotated by LampDef.rot): lx along T +x (screen-left), ly along T +y (toward the player), (0,0) = quad centre.
 * The cell is painted as seen from above, so local +x is the cell's LEFT edge and local +y its BOTTOM edge:
 *   u = u0 + (0.5 - lx/w) * (u1-u0)     v = v1 - (ly/h + 0.5) * (v1-v0)
 * @param {{u0:number,v0:number,u1:number,v1:number}} cell @param {[number,number]} size LampDef.size @returns {[number, number]}
 */
export function lampCellUV(cell, size, lx, ly) {
  return [cell.u0 + (0.5 - lx / size[0]) * (cell.u1 - cell.u0), cell.v1 - (ly / size[1] + 0.5) * (cell.v1 - cell.v0)];
}
