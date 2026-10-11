/**
 * src/render/cameras.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 "Camera" (additive module, imports three).
 * The ORIGINAL camera (default; SPEC 1.4 recipe with setViewOffset, never overwriting camera.aspect), a top-down orthographic debug camera and an
 * orbit debug camera (OrbitControls, pan disabled). The nudge shake shifts the original camera's view-offset window (camera_math.viewOffsetForSize).
 *
 * ASSUMPTIONS: the orbit camera starts roughly where the original one is, but with a wider field of view and free rotation about the table centre;
 * OrbitControls is created lazily on first use of the 'orbit' mode and disabled again when the mode is left.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ORIGINAL_CAMERA, viewOffsetForSize, topViewBounds } from './camera_math.js';

/**
 * @param {{domElement:HTMLCanvasElement}} o
 */
export function createCameras(o) {
  const C = ORIGINAL_CAMERA;
  const original = new THREE.PerspectiveCamera(C.fovDeg, C.aspect, C.near, C.far);
  original.position.set(C.position[0], C.position[1], C.position[2]);
  original.up.set(C.up[0], C.up[1], C.up[2]);
  original.lookAt(C.position[0] + C.forward[0], C.position[1] + C.forward[1], C.position[2] + C.forward[2]);

  const top = new THREE.OrthographicCamera(-10, 10, 16, -16, 0.5, 100);
  top.position.set(0, 40, 0.5);
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0.5);

  const orbit = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
  orbit.position.set(0, 30, 26);
  orbit.lookAt(0, 0, 0.5);

  /** @type {OrbitControls|null} */
  let controls = null;
  let mode = 'original';
  let w = 365, h = 416;
  let lastShakeX = NaN, lastShakeY = NaN;

  function applyOriginal(shake) {
    const off = viewOffsetForSize(w, h, shake);
    original.setViewOffset(off.fullW, off.fullH, off.x, off.y, off.w, off.h);   // also updates the projection matrix
  }
  function applyTop() {
    const b = topViewBounds(w / h, 0.4);
    top.left = b.left; top.right = b.right; top.top = b.top; top.bottom = b.bottom;
    top.updateProjectionMatrix();
  }
  function applyOrbit() {
    orbit.aspect = w / h;
    orbit.updateProjectionMatrix();
  }
  function ensureControls() {
    if (controls) return controls;
    controls = new OrbitControls(orbit, o.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 8;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, 0, 0.5);
    controls.update();
    return controls;
  }

  return {
    original, top, orbit,
    get mode() { return mode; },
    /** @returns {THREE.Camera} the camera of the current mode */
    active() { return mode === 'top' ? top : mode === 'orbit' ? orbit : original; },
    setMode(m) {
      if (m !== 'original' && m !== 'top' && m !== 'orbit') return;
      mode = m;
      if (m === 'orbit') ensureControls().enabled = true; else if (controls) controls.enabled = false;
      lastShakeX = NaN;
    },
    /** Resize the logical viewport (CSS px). */
    resize(cssW, cssH) {
      w = Math.max(1, cssW); h = Math.max(1, cssH);
      lastShakeX = NaN;
      applyTop(); applyOrbit(); applyOriginal({ x: 0, y: 0 });
    },
    /** Per frame: nudge shake (original px at 365 width) and orbit damping. */
    update(shake) {
      if (mode === 'original') {
        const sx = shake ? shake.x : 0, sy = shake ? shake.y : 0;
        if (sx !== lastShakeX || sy !== lastShakeY) { lastShakeX = sx; lastShakeY = sy; applyOriginal({ x: sx, y: sy }); }
      } else if (mode === 'orbit' && controls) controls.update();
    },
    dispose() { if (controls) controls.dispose(); },
  };
}
