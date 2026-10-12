/**
 * src/render/cameras.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 "Camera" (additive module, imports three).
 * The ORIGINAL camera (default; SPEC 1.4 recipe with setViewOffset, never overwriting camera.aspect), a top-down orthographic debug camera and an
 * orbit debug camera (OrbitControls, pan disabled). The nudge shake shifts the original camera's view-offset window (camera_math.viewOffsetForSize).
 *
 * Mouse view (Options > Mouse Rotates View, on the original camera): drag with the left button to turn the view around the table, wheel to zoom,
 * double-click to go back to the original view. View only: the table, the physics and the flipper halves of the touch screen never change. The
 * whole camera turns rigidly about camera_math.VIEW_PIVOT (the floor point under the centre of the window), so at rest the picture is exactly the
 * original one; the movement is damped.
 *
 * Cinematic camera (frame.cinematic from render/cinematic.js): the camera of the current view is blended (position lerp + rotation slerp,
 * weight = state.weight) towards a close rig around the followed ball: same azimuth as the current view, elevation within CINE_RIG limits,
 * cinematicDistance(speed) away, centred a little ahead of the ball (state.lead), so the ball has open space in front of it. Works on the original (with the mouse view) and the orbit camera;
 * the top camera is orthographic and ignores it.
 *
 * ASSUMPTIONS: the orbit camera starts as a three-quarter view of the whole cabinet; OrbitControls is created lazily on first use of the 'orbit'
 * mode and disabled again when the mode is left. The mouse view listens to pointer events with pointerType 'mouse' only (touch = flippers).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ORIGINAL_CAMERA, viewOffsetForSize, topViewBounds, VIEW_PIVOT, VIEW_BASE, clampView, cinematicDistance, cinematicElevation } from './camera_math.js';

const ROTATE_SPEED = 0.75;          // full canvas height of drag = 0.75 turns
const WHEEL_SPEED = 0.0012;         // zoom factor per wheel pixel (exponential)
const VIEW_RATE = 16;               // 1/s: damping of the mouse view
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

/**
 * @param {{domElement:HTMLCanvasElement}} o
 */
export function createCameras(o) {
  const C = ORIGINAL_CAMERA;
  const dom = o.domElement;
  const original = new THREE.PerspectiveCamera(C.fovDeg, C.aspect, C.near, Math.max(C.far, 260));   // far: the zoomed-out mouse view sees the whole room
  original.position.set(C.position[0], C.position[1], C.position[2]);
  original.up.set(C.up[0], C.up[1], C.up[2]);
  original.lookAt(C.position[0] + C.forward[0], C.position[1] + C.forward[1], C.position[2] + C.forward[2]);
  const basePos = original.position.clone();
  const baseQuat = original.quaternion.clone();
  const pivot = new THREE.Vector3(VIEW_PIVOT[0], VIEW_PIVOT[1], VIEW_PIVOT[2]);
  const baseDir = basePos.clone().sub(pivot).normalize();      // unit offset pivot -> camera of the original view

  const top = new THREE.OrthographicCamera(-10, 10, 16, -16, 0.5, 100);
  top.position.set(0, 40, 0.5);
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0.5);

  const orbit = new THREE.PerspectiveCamera(42, 1, 0.5, 260);
  const ORBIT_HOME = new THREE.Vector3(36, 24, 52);                 // a three-quarter view of the whole cabinet
  const ORBIT_TARGET = new THREE.Vector3(0, -3, -3);
  orbit.position.copy(ORBIT_HOME);
  orbit.lookAt(ORBIT_TARGET);
  /** the orbit camera's stand-in while a cinematic shot runs (OrbitControls owns the orbit camera itself) */
  const orbitCine = new THREE.PerspectiveCamera(42, 1, 0.5, 260);

  /** @type {OrbitControls|null} */
  let controls = null;
  let mode = 'original';
  let w = 365, h = 416;
  let lastShakeX = NaN, lastShakeY = NaN;
  let cineWeight = 0;

  // ---- mouse view ----------------------------------------------------------------------------------------------------------------------
  const view = { yaw: 0, pitch: 0, zoom: 1 };                   // current (damped)
  const goal = { yaw: 0, pitch: 0, zoom: 1 };                   // where the mouse wants it
  let mouseLook = false;
  let drag = null;                                              // {id, x, y}
  const lookActive = () => mouseLook && mode === 'original';
  function setCursor() {
    if (!dom || !dom.style) return;
    dom.style.cursor = lookActive() ? (drag ? 'grabbing' : 'grab') : '';
  }
  function onPointerDown(e) {
    if (!lookActive() || e.pointerType !== 'mouse' || e.button !== 0 || drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { dom.setPointerCapture(e.pointerId); } catch (err) { /* capture is best effort */ }
    setCursor();
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    const k = (2 * Math.PI * ROTATE_SPEED) / Math.max(120, h);
    goal.yaw -= dx * k;
    goal.pitch += dy * k;
    clampView(goal);
  }
  function onPointerUp(e) {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    try { dom.releasePointerCapture(drag.id); } catch (err) { /* already released */ }
    drag = null;
    setCursor();
  }
  function onWheel(e) {
    if (!lookActive()) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * h : e.deltaY;
    goal.zoom *= Math.exp(px * WHEEL_SPEED);
    clampView(goal);
  }
  function onDblClick(e) {
    if (!lookActive()) return;
    if (e && e.preventDefault) e.preventDefault();
    resetView();
  }
  function resetView() {
    goal.yaw = 0; goal.pitch = 0; goal.zoom = 1;
    if (controls) { orbit.position.copy(ORBIT_HOME); controls.target.copy(ORBIT_TARGET); controls.update(); }
  }
  if (dom && typeof dom.addEventListener === 'function') {
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('lostpointercapture', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('dblclick', onDblClick);
  }

  // ---- poses ---------------------------------------------------------------------------------------------------------------------------
  const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qRig = new THREE.Quaternion();
  const rigPos = new THREE.Vector3(), rigQuat = new THREE.Quaternion();
  const cinePos = new THREE.Vector3(), cineQuat = new THREE.Quaternion();
  const tmpV = new THREE.Vector3(), tmpAxis = new THREE.Vector3(), qTilt = new THREE.Quaternion(), ballV = new THREE.Vector3();

  /** Original camera turned rigidly about the pivot by the mouse view -> rigPos / rigQuat. */
  function rigPose() {
    qYaw.setFromAxisAngle(AXIS_Y, view.yaw);
    qPitch.setFromAxisAngle(AXIS_X, -view.pitch);
    qRig.multiplyQuaternions(qYaw, qPitch);
    rigPos.copy(baseDir).applyQuaternion(qRig).multiplyScalar(VIEW_BASE.r * view.zoom).add(pivot);
    rigQuat.multiplyQuaternions(qRig, baseQuat);
  }

  /**
   * Close rig around the ball for a camera at (pos, quat) whose screen centre looks at `centre`: same azimuth, cinematic elevation and distance,
   * moved so that the ball takes the place of `centre` -> cinePos / cineQuat.
   */
  function cinePose(pos, quat, centre, cine) {
    tmpV.copy(pos).sub(centre);
    const r = tmpV.length() || 1;
    tmpV.multiplyScalar(1 / r);
    const el = Math.asin(Math.max(-1, Math.min(1, tmpV.y)));
    const az = Math.atan2(tmpV.x, tmpV.z);
    const elC = cinematicElevation(el);
    tmpAxis.set(Math.cos(az), 0, -Math.sin(az));                  // horizontal axis across the view direction
    qTilt.setFromAxisAngle(tmpAxis, -(elC - el));
    const lx = cine.lead ? cine.lead.x : 0, ly = cine.lead ? cine.lead.y : 0;
    ballV.set(-(cine.target.x + lx), cine.target.z || 0, cine.target.y + ly);   // T-frame -> three; look ahead of the ball
    cinePos.copy(tmpV).applyQuaternion(qTilt).multiplyScalar(cinematicDistance(cine.speed)).add(ballV);
    cineQuat.multiplyQuaternions(qTilt, quat);
  }

  function applyOriginalOffset(shake) {
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
    orbitCine.aspect = w / h;
    orbitCine.updateProjectionMatrix();
  }
  function ensureControls() {
    if (controls) return controls;
    controls = new OrbitControls(orbit, o.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 8;
    controls.maxDistance = 110;
    controls.maxPolarAngle = Math.PI * 0.53;                       // a little below the playfield, never under the floor
    controls.target.copy(ORBIT_TARGET);
    controls.update();
    return controls;
  }

  return {
    original, top, orbit,
    get mode() { return mode; },
    /** @returns {THREE.Camera} the camera of the current mode */
    active() { return mode === 'top' ? top : mode === 'orbit' ? (cineWeight > 0 ? orbitCine : orbit) : original; },
    setMode(m) {
      if (m !== 'original' && m !== 'top' && m !== 'orbit') return;
      mode = m;
      if (m === 'orbit') ensureControls().enabled = true; else if (controls) controls.enabled = false;
      if (drag) onPointerUp();
      lastShakeX = NaN;
      setCursor();
    },
    /** Mouse view on / off (on: left-drag turns, wheel zooms, double-click resets - original camera only). @param {boolean} on */
    setMouseLook(on) {
      mouseLook = !!on;
      if (!mouseLook && drag) onPointerUp();
      setCursor();
    },
    getMouseLook: () => mouseLook,
    /** Back to the original view (and the orbit camera to its start). */
    resetView,
    /** The damped mouse view and its goal (tests / debugging). */
    getView: () => ({ ...view, goal: { ...goal }, dragging: !!drag }),
    /** Set the mouse view directly (tests / debugging); jumps without damping. @param {{yaw?:number, pitch?:number, zoom?:number}} v */
    setView(v) {
      Object.assign(goal, v);
      clampView(goal);
      Object.assign(view, { yaw: goal.yaw, pitch: goal.pitch, zoom: goal.zoom });
    },
    /** Resize the logical viewport (CSS px). */
    resize(cssW, cssH) {
      w = Math.max(1, cssW); h = Math.max(1, cssH);
      lastShakeX = NaN;
      applyTop(); applyOrbit(); applyOriginalOffset({ x: 0, y: 0 });
    },
    /**
     * Per frame: nudge shake (original px at 365 width), the mouse view, the cinematic blend and the orbit damping.
     * @param {{x:number,y:number}|undefined} shake @param {{weight:number, target:{x:number,y:number,z:number}, speed:number}|undefined} [cine]
     * @param {number} [dt] seconds
     */
    update(shake, cine, dt = 1 / 60) {
      const k = 1 - Math.exp(-VIEW_RATE * Math.max(0, Math.min(0.1, dt)));
      view.yaw += (goal.yaw - view.yaw) * k;
      view.pitch += (goal.pitch - view.pitch) * k;
      view.zoom += (goal.zoom - view.zoom) * k;
      cineWeight = cine && cine.weight > 0.0005 && cine.target ? Math.min(1, cine.weight) : 0;
      if (mode === 'original') {
        const sx = shake ? shake.x : 0, sy = shake ? shake.y : 0;
        if (sx !== lastShakeX || sy !== lastShakeY) { lastShakeX = sx; lastShakeY = sy; applyOriginalOffset({ x: sx, y: sy }); }
        rigPose();
        if (cineWeight > 0) {
          cinePose(rigPos, rigQuat, pivot, cine);
          original.position.lerpVectors(rigPos, cinePos, cineWeight);
          original.quaternion.slerpQuaternions(rigQuat, cineQuat, cineWeight);
        } else {
          original.position.copy(rigPos);
          original.quaternion.copy(rigQuat);
        }
        original.updateMatrixWorld();
      } else if (mode === 'orbit' && controls) {
        controls.update();
        if (cineWeight > 0) {
          cinePose(orbit.position, orbit.quaternion, controls.target, cine);
          orbitCine.position.lerpVectors(orbit.position, cinePos, cineWeight);
          orbitCine.quaternion.slerpQuaternions(orbit.quaternion, cineQuat, cineWeight);
          orbitCine.updateMatrixWorld();
        }
      }
    },
    dispose() {
      if (controls) controls.dispose();
      if (dom && typeof dom.removeEventListener === 'function') {
        dom.removeEventListener('pointerdown', onPointerDown);
        dom.removeEventListener('pointermove', onPointerMove);
        dom.removeEventListener('pointerup', onPointerUp);
        dom.removeEventListener('pointercancel', onPointerUp);
        dom.removeEventListener('lostpointercapture', onPointerUp);
        dom.removeEventListener('wheel', onWheel);
        dom.removeEventListener('dblclick', onDblClick);
      }
    },
  };
}
