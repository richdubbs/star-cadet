/**
 * tests/cabinet.test.mjs
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * Pure parts of the cabinet and the camera rig: the backbox dot-matrix display (src/render/dmd.js) and the mouse view / cinematic framing maths
 * of src/render/camera_math.js. Pure Node (fake canvas), no three.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDmd, dmdScore, dmdWidth, DMD } from '../src/render/dmd.js';
import { VIEW_PIVOT, VIEW_BASE, VIEW_LIMITS, clampView, cinematicDistance, cinematicElevation, CINE_RIG, ORIGINAL_CAMERA } from '../src/render/camera_math.js';
import { projectToTablePx } from '../src/data/constants.js';
import { createFakeCanvasFactory } from './helpers/fake_canvas.mjs';

const view = (o = {}) => ({ phase: 'playing', demo: false, tilted: false, player: 1, ballNumber: 2, score: 1234567, info: '', mission: '', ...o });

test('dmd: score with thousands separators, blank when negative; widths in dots', () => {
  assert.equal(dmdScore(0), '0');
  assert.equal(dmdScore(1234567), '1,234,567');
  assert.equal(dmdScore(999999999), '999,999,999');
  assert.equal(dmdScore(-1), '');
  assert.equal(dmdWidth('8'), 5);
  assert.equal(dmdWidth('88'), 11);
  assert.equal(dmdWidth('88', 2), 22);
  assert.equal(dmdWidth(''), 0);
});

test('dmd: the screens follow the rules view (title, play, tilt, game over, demo)', () => {
  const f = createFakeCanvasFactory({ strict: true });
  const d = createDmd(f.createCanvas);
  assert.equal(d.canvas.width, DMD.cols * DMD.cell);
  assert.equal(d.canvas.height, DMD.rows * DMD.cell);
  assert.deepEqual(d.text(null, 0), ['title', 'STAR CADET', 'PRESS START']);
  assert.deepEqual(d.text(view({ phase: 'idle' }), 0.6), ['title', 'STAR CADET', ''], 'blinks');
  assert.deepEqual(d.text(view()), ['play', 'PLAYER 1', 'BALL 2', '1,234,567', '']);
  assert.deepEqual(d.text(view({ info: 'Skill Shot\n25000' })), ['play', '', '', '1,234,567', 'SKILL SHOT 25000']);
  assert.deepEqual(d.text(view({ mission: 'Fuel Chaser\nhit the lights' })), ['play', '', '', '1,234,567', 'FUEL CHASER']);
  assert.deepEqual(d.text(view({ info: 'Player 1' })), ['play', 'PLAYER 1', 'BALL 2', '1,234,567', ''], 'no duplicated PLAYER 1');
  assert.deepEqual(d.text(view({ tilted: true })), ['big', 'TILT', '1,234,567']);
  assert.deepEqual(d.text(view({ phase: 'gameOver' })), ['big', 'GAME OVER', '1,234,567']);
  assert.equal(d.text(view({ demo: true }))[0], 'title');
});

test('dmd: repaints only when the text changes; the strict canvas subset is enough; long lines never throw', () => {
  const f = createFakeCanvasFactory({ strict: true });
  const d = createDmd(f.createCanvas);
  assert.equal(d.draw(view(), 0), true);
  const ops = d.canvas.ops.length;
  assert.ok(ops > 50, 'lit dots were drawn');
  assert.equal(d.draw(view(), 0.1), false, 'same text: nothing to do');
  assert.equal(d.canvas.ops.length, ops);
  assert.equal(d.draw(view({ score: 1234568 }), 0.1), true);
  assert.equal(d.draw(view({ score: 999999999, info: 'a very long message that does not fit the display at all ~~~ {}' }), 0.2), true);
  assert.equal(d.draw(view({ player: 0, ballNumber: 0, score: -1 }), 0.2), true);
});

test('camera_math: VIEW_PIVOT is the floor point in the centre of the original window; VIEW_BASE describes the original camera from it', () => {
  const [x, y] = projectToTablePx(-VIEW_PIVOT[0], VIEW_PIVOT[2], 0);
  assert.ok(Math.abs(x - ORIGINAL_CAMERA.winW / 2) < 1e-6 && Math.abs(y - ORIGINAL_CAMERA.winH / 2) < 1e-6, `centre ${x}, ${y}`);
  const p = ORIGINAL_CAMERA.position;
  assert.ok(Math.abs(VIEW_BASE.r - Math.hypot(p[0] - VIEW_PIVOT[0], p[1], p[2] - VIEW_PIVOT[2])) < 1e-9);
  assert.ok(VIEW_BASE.elevation > 1.0 && VIEW_BASE.elevation < 1.1, 'about 62 degrees above the table');
});

test('camera_math: clampView keeps zoom and elevation inside the limits and a close camera above the glass', () => {
  const L = VIEW_LIMITS;
  assert.deepEqual(clampView({ yaw: 3, pitch: 0, zoom: 1 }), { yaw: 3, pitch: 0, zoom: 1 }, 'the original view is valid; yaw is free');
  assert.equal(clampView({ yaw: 0, pitch: 0, zoom: 99 }).zoom, L.zoomMax);
  assert.equal(clampView({ yaw: 0, pitch: 0, zoom: 0 }).zoom, L.zoomMin);
  const up = clampView({ yaw: 0, pitch: 5, zoom: 1 });
  assert.ok(Math.abs(VIEW_BASE.elevation + up.pitch - L.elevationMax) < 1e-12);
  const far = clampView({ yaw: 0, pitch: -5, zoom: L.zoomMax });
  assert.ok(Math.abs(VIEW_BASE.elevation + far.pitch - L.elevationMin) < 1e-12, 'far away: the lowest elevation');
  const near = clampView({ yaw: 0, pitch: -5, zoom: L.zoomMin });
  const r = VIEW_BASE.r * L.zoomMin;
  assert.ok(r * Math.sin(VIEW_BASE.elevation + near.pitch) >= L.minHeight - 1e-9, 'close: still above the glass');
  assert.deepEqual(clampView({ yaw: NaN, pitch: NaN, zoom: NaN }), { yaw: 0, pitch: 0, zoom: 1 });
});

test('camera_math: the cinematic camera is close, pulls back for fast balls and keeps the elevation of the view inside its limits', () => {
  assert.equal(cinematicDistance(0), CINE_RIG.distance);
  assert.ok(cinematicDistance(30) > cinematicDistance(10));
  assert.equal(cinematicDistance(1000), cinematicDistance(CINE_RIG.maxSpeed), 'capped');
  assert.ok(cinematicDistance(60) < VIEW_BASE.r * 0.6, 'always a real zoom-in');
  assert.ok(Math.abs(cinematicElevation(VIEW_BASE.elevation) - VIEW_BASE.elevation + CINE_RIG.tilt) < 1e-12, 'as steep as the normal view');
  assert.equal(cinematicElevation(0), CINE_RIG.elevationMin);
  assert.equal(cinematicElevation(Math.PI / 2), CINE_RIG.elevationMax);
});
