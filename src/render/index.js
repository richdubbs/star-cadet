/**
 * src/render/index.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1; type Renderer / CreateRendererOpts (src/types.js)
 * Facade: createRenderer({data, art, canvas?, quality?}) -> Renderer. The only RENDER module the rest of the app imports.
 * Three.js 0.160.0 (import map). Builds the whole scene once (table.js), then per frame applies the RenderFrame (physics snapshot, lamps view, rules
 * view) and draws with the ORIGINAL camera (default), a top-down orthographic or an orbit debug camera. Bloom (UnrealBloomPass on a multisampled
 * half-float target) is optional; without WebGL a Renderer whose canvas shows "WebGL is not available" is returned (never throws).
 *
 * Renderer surface (types.js): domElement, resize(cssW, cssH, dpr), render(frame), setCameraMode, getCameraMode, cycleCameraMode, pickTable,
 * setQuality, info, dispose. Extra (additive): `debug` = {scene, THREE, table, lamps, balls, cameras, kit} for the browser smoke tests.
 *
 * ASSUMPTIONS:
 *  - frame.dt is the frame time in seconds (clamped to 0.1 s); animation easing uses it, never the wall clock.
 *  - quality defaults: shadows on, bloom on, dprMax 2. `?quality=low` should pass {shadows:false, bloom:false, dprMax:1.5} (main.js decides).
 *  - tilt (physics.tiltLocked) dims the lights to ~55 % with a 0.25 s ease.
 *  - the canvas keeps the CSS size given by css/style.css (setSize(..., false)); resize() only sets the drawing-buffer size.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createMaterialKit } from './materials.js';
import { buildTable } from './table.js';
import { createLampOverlay } from './lamps_overlay.js';
import { createBalls } from './balls.js';
import { createCameras } from './cameras.js';
import { clamp, approach } from './convert.js';

const MODES = ['original', 'top', 'orbit'];
const PI = Math.PI;

/** A Renderer that only shows a message (no WebGL). */
function createFallbackRenderer(canvas, why) {
  const c = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  let mode = 'original';
  let cw = 365, ch = 416;
  const paint = () => {
    if (!c) return;
    try {
      c.width = cw; c.height = ch;
      const g = c.getContext('2d');
      if (!g) return;
      g.fillStyle = '#05050c'; g.fillRect(0, 0, cw, ch);
      g.fillStyle = '#c9c9d8'; g.font = `${Math.max(12, Math.round(cw / 18))}px system-ui, sans-serif`; g.textAlign = 'center';
      g.fillText('WebGL is not available', cw / 2, ch / 2 - 6);
      g.font = `${Math.max(10, Math.round(cw / 28))}px system-ui, sans-serif`;
      g.fillStyle = '#8a8aa0';
      g.fillText('The 3D table needs a WebGL-capable browser.', cw / 2, ch / 2 + 16);
    } catch (e) { /* nothing to do */ }
  };
  paint();
  if (typeof console !== 'undefined' && why) console.warn('[render] WebGL unavailable:', why && why.message ? why.message : why);
  return {
    domElement: /** @type {any} */ (c),
    resize(w, h, dpr) { cw = Math.max(1, Math.round(w * (dpr || 1))); ch = Math.max(1, Math.round(h * (dpr || 1))); paint(); },
    render() {},
    setCameraMode(m) { if (MODES.includes(m)) mode = m; },
    getCameraMode: () => /** @type {any} */ (mode),
    cycleCameraMode() { mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; return /** @type {any} */ (mode); },
    pickTable: () => null,
    setQuality() {},
    info: () => ({ drawCalls: 0, triangles: 0, textures: 0 }),
    dispose() {},
  };
}

/** @param {import('../types.js').CreateRendererOpts} opts @returns {import('../types.js').Renderer} */
export function createRenderer(opts) {
  const { data, art } = opts;
  let quality = { shadows: true, bloom: true, dprMax: 2, ...(opts.quality || {}) };

  // ---- renderer (never throws) ---------------------------------------------------------------------------------------------------------------
  let renderer;
  try {
    const canvas = opts.canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : undefined);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
  } catch (e) {
    return createFallbackRenderer(opts.canvas || null, e);
  }
  const canvas = renderer.domElement;
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !!quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  let lost = false;
  const onLost = (e) => { e.preventDefault(); lost = true; };
  const onRestored = () => { lost = false; kit.refreshEnv(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // ---- scene ---------------------------------------------------------------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const kit = createMaterialKit({ art, renderer, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  const table = buildTable({ data, art, kit });
  scene.add(table.root);
  const lamps = createLampOverlay({ data, art, kit });
  scene.add(lamps.root);
  const balls = createBalls({ data, kit });
  scene.add(balls.root);
  const cameras = createCameras({ domElement: canvas });

  // ---- lights (intensities are "x pi" because three r160 lights are in physical units: pi == full albedo) ------------------------------------------
  const hemi = new THREE.HemisphereLight(0xd6dcff, 0x241f3a, 0.58 * PI);
  const key = new THREE.DirectionalLight(0xfff1de, 0.58 * PI);
  key.position.set(-9, 34, -7);                        // upper-left of the screen, high
  key.target.position.set(0, 0, 0.5);
  const fill = new THREE.DirectionalLight(0x8fa8ff, 0.16 * PI);
  fill.position.set(10, 14, 12);
  scene.add(hemi, key, key.target, fill);
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -19; sc.right = 19; sc.top = 19; sc.bottom = -19; sc.near = 5; sc.far = 90;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 2.5;
  key.castShadow = !!quality.shadows;
  table.setShadows(!!quality.shadows);
  const baseLights = { hemi: hemi.intensity, key: key.intensity, fill: fill.intensity };
  let dim = 1;

  // ---- bloom -------------------------------------------------------------------------------------------------------------------------------
  let composer = null, renderPass = null, bloomPass = null;
  let cssW = 365, cssH = 416, pixelRatio = 1;
  function buildComposer() {
    try {
      const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(cssW * pixelRatio)), Math.max(1, Math.round(cssH * pixelRatio)), { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(cssW, cssH);
      renderPass = new RenderPass(scene, cameras.active());
      bloomPass = new UnrealBloomPass(new THREE.Vector2(cssW * pixelRatio, cssH * pixelRatio), 0.5, 0.5, 1.0);
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    } catch (e) {
      composer = null; renderPass = null; bloomPass = null;
      if (typeof console !== 'undefined') console.warn('[render] bloom disabled:', e && e.message ? e.message : e);
    }
  }
  function disposeComposer() {
    if (!composer) return;
    try { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); for (const p of composer.passes) if (p.dispose) p.dispose(); } catch (e) { /* ignore */ }
    composer = null; renderPass = null; bloomPass = null;
  }
  if (quality.bloom) buildComposer();

  // ---- sizing --------------------------------------------------------------------------------------------------------------------------------
  function resize(w, h, dpr) {
    cssW = Math.max(1, Math.round(w)); cssH = Math.max(1, Math.round(h));
    pixelRatio = clamp(dpr || 1, 0.5, quality.dprMax || 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(cssW, cssH, false);
    if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(cssW, cssH); if (bloomPass) bloomPass.resolution.set(cssW * pixelRatio, cssH * pixelRatio); }
    cameras.resize(cssW, cssH);
  }
  let lastDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  resize(365, 416, lastDpr);

  // Pre-compile the shaders of the parts that are hidden at start (ball meshes, hit glows, pits, the centre post): otherwise the first ball / first bumper
  // hit / first sink capture stalls the frame on a shader compile. Purely an optimisation; any failure is ignored.
  try {
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
    renderer.compile(scene, cameras.active());
    for (const o of hidden) o.visible = false;
  } catch (e) { /* optional */ }

  // ---- per frame -----------------------------------------------------------------------------------------------------------------------------
  let lastTime = null;
  function render(frame) {
    if (lost || !frame || !frame.physics) return;
    let dt = frame.dt;
    if (!(dt > 0)) dt = lastTime === null ? 1 / 60 : frame.time - lastTime;
    lastTime = frame.time;
    dt = clamp(dt, 0, 0.1);
    // tilt dimming
    const target = frame.physics.tiltLocked ? 0.55 : 1;
    dim = approach(dim, target, dt, 0.12);
    hemi.intensity = baseLights.hemi * dim; key.intensity = baseLights.key * dim; fill.intensity = baseLights.fill * dim;
    table.update(frame, dt);
    lamps.update(frame.lamps);
    balls.update(frame.physics.balls, dt, frame.physics.plunger);
    cameras.update(frame.physics.shake);
    const cam = cameras.active();
    renderer.info.reset();
    if (composer && quality.bloom) {
      renderPass.camera = cam;
      composer.render(dt);
    } else {
      renderer.render(scene, cam);
    }
  }

  // ---- picking -------------------------------------------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function pickTable(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    const cam = cameras.active();
    cam.updateMatrixWorld();
    raycaster.setFromCamera(ndc, cam);
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
    const x = -hit.x, y = hit.z;                                   // v2t
    const T = data.TABLE;
    if (x < T.xMin || x > T.xMax || y < T.yMin || y > T.yMax) return null;
    return [x, y];
  }

  const api = {
    domElement: canvas,
    resize(w, h, dpr) { lastDpr = dpr || 1; resize(w, h, lastDpr); },
    render,
    setCameraMode(m) { cameras.setMode(m); },
    getCameraMode() { return /** @type {any} */ (cameras.mode); },
    cycleCameraMode() { const next = MODES[(MODES.indexOf(cameras.mode) + 1) % MODES.length]; cameras.setMode(next); return /** @type {any} */ (next); },
    pickTable,
    setQuality(q) {
      quality = { ...quality, ...q };
      renderer.shadowMap.enabled = !!quality.shadows;
      key.castShadow = !!quality.shadows;
      table.setShadows(!!quality.shadows);
      scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
      if (quality.bloom && !composer) buildComposer();
      else if (!quality.bloom && composer) disposeComposer();
      resize(cssW, cssH, lastDpr);
    },
    info() {
      const i = renderer.info;
      return { drawCalls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures };
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      disposeComposer();
      cameras.dispose();
      balls.dispose(); lamps.dispose(); table.dispose(); kit.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
    },
    debug: { THREE, scene, renderer, table, lamps, balls, cameras, kit, lights: { hemi, key, fill } },
  };
  return /** @type {any} */ (api);
}
