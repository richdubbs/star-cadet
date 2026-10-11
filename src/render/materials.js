/**
 * src/render/materials.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1/9.3 (additive module, imports three): the material kit of the scene.
 * Every ART texture (ArtPack.floor/deck/misc.*) is applied through this file; a MISSING or stub (4x4) canvas silently falls back to a flat colour
 * from PALETTE, so the scene renders with the architect's stubs and with the final art alike.
 *
 * Lighting model (three r160, non-legacy lights): AmbientLight / HemisphereLight / DirectionalLight intensities are ~pi for "full albedo";
 * the scene sets them so that a flat floor ends up close to its painted colour. Materials here are MeshStandardMaterial (lit) except decals
 * and glows (MeshBasicMaterial, additive or alpha-blended, depthWrite off).
 *
 * ASSUMPTIONS: ArtPack.misc.ballEnv is an equirectangular image; metals reflect it (through PMREM) with per-material envMapIntensity.
 *  The chrome BALL has its own studio (geom/envmap.js: pale sky, upper-left soft box, soft horizon, dark bluish ground) so that it reads as polished silver
 *  against the navy floor instead of a glass bead.
 * The consumed ArtPack keys are listed in art_keys.js (checked against ART's output by tests/render.test.mjs).
 */
import * as THREE from 'three';
import { PALETTE } from './art/palette.js';
import { canvasTexture, softDiscTexture, ballDetailTexture, fallbackEnvTexture, chromeEnvTexture, usableCanvas } from './three_utils.js';

/**
 * @param {{art:import('../types.js').ArtPack, renderer:THREE.WebGLRenderer, maxAnisotropy?:number}} o
 */
export function createMaterialKit(o) {
  const art = o.art || /** @type {any} */ ({});
  const misc = art.misc || {};
  const aniso = Math.min(8, o.maxAnisotropy || 4);
  /** @type {THREE.Texture[]} */
  const owned = [];
  /** @type {THREE.Material[]} */
  const mats = [];
  const own = (t) => { if (t) owned.push(t); return t; };
  const mat = (m) => { mats.push(m); return m; };

  const tex = {
    floor: own(canvasTexture(art.floor && art.floor.canvas, { anisotropy: aniso })),
    deck: own(canvasTexture(art.deck && art.deck.canvas, { anisotropy: aniso })),
    metalSide: own(canvasTexture(misc.metalSide, { wrap: 'repeat', anisotropy: aniso })),
    wallTop: own(canvasTexture(misc.wallTop, { anisotropy: aniso })),
    rubber: own(canvasTexture(misc.rubber, { wrap: 'repeat', anisotropy: aniso })),
    postBand: own(canvasTexture(misc.postBand, { wrap: 'repeat', anisotropy: aniso })),
    bumperDrum: own(canvasTexture(misc.bumperDrum, { wrap: 'repeat', anisotropy: aniso })),
    bumperStar: own(canvasTexture(misc.bumperStar, { anisotropy: aniso })),
    bumperCap: own(canvasTexture(misc.bumperCap, { anisotropy: aniso })),
    targetYellow: own(canvasTexture(misc.targetYellow, { anisotropy: aniso })),
    flagPanel: own(canvasTexture(misc.flagPanel, { anisotropy: aniso })),
    flipperBody: own(canvasTexture(misc.flipperBody, { anisotropy: aniso })),
    rampSide: own(canvasTexture(misc.rampSide, { wrap: 'repeat', anisotropy: aniso })),
    plungerRod: own(canvasTexture(misc.plungerRod, { wrap: 'repeat', anisotropy: aniso })),
  };

  // ---- environment for the chrome ball and the metals --------------------------------------------------------------------------------------
  let envSource = usableCanvas(misc.ballEnv) ? canvasTexture(misc.ballEnv, { mipmaps: false }) : null;
  if (!envSource) envSource = fallbackEnvTexture();
  envSource.mapping = THREE.EquirectangularReflectionMapping;
  let envMap = null;
  try {
    const pmrem = new THREE.PMREMGenerator(o.renderer);
    const rt = pmrem.fromEquirectangular(envSource);
    envMap = rt.texture;
    owned.push(envMap);
    pmrem.dispose();
  } catch (e) {
    envMap = null;
  }
  owned.push(envSource);

  // the chrome ball has its own studio (pale sky, upper-left soft box, dark bluish ground): see three_utils.chromeEnvTexture
  const ballEnvSource = chromeEnvTexture();
  let ballEnvMap = null;
  try {
    const pmrem = new THREE.PMREMGenerator(o.renderer);
    ballEnvMap = pmrem.fromEquirectangular(ballEnvSource).texture;
    owned.push(ballEnvMap);
    pmrem.dispose();
  } catch (e) {
    ballEnvMap = null;
  }
  owned.push(ballEnvSource);

  const envProps = (intensity) => (envMap ? { envMap, envMapIntensity: intensity } : {});
  /** Re-bake the PMREM environment (its GPU contents are lost with a WebGL context loss) and re-point every material that used it. */
  function refreshEnv() {
    try {
      const pmrem = new THREE.PMREMGenerator(o.renderer);
      const rt = pmrem.fromEquirectangular(envSource);
      const rtBall = pmrem.fromEquirectangular(ballEnvSource);
      pmrem.dispose();
      const old = envMap, oldBall = ballEnvMap;
      envMap = rt.texture; ballEnvMap = rtBall.texture;
      owned.push(envMap, ballEnvMap);
      for (const m of mats) {
        const mm = /** @type {any} */ (m);
        if (old && mm.envMap === old) { mm.envMap = envMap; m.needsUpdate = true; } else if (oldBall && mm.envMap === oldBall) { mm.envMap = ballEnvMap; m.needsUpdate = true; }
      }
      if (old) old.dispose();
      if (oldBall) oldBall.dispose();
    } catch (e) { /* keep the old one */ }
  }
  const textured = (t, fallbackHex, extra) => mat(new THREE.MeshStandardMaterial({ map: t || null, color: t ? 0xffffff : new THREE.Color(fallbackHex), ...extra }));

  // ---- playfield + deck ------------------------------------------------------------------------------------------------------------------
  const floor = textured(tex.floor, PALETTE.floorNavy, { roughness: 0.55, metalness: 0.04, ...envProps(0.28) });
  const deck = textured(tex.deck, PALETTE.deck, { roughness: 0.5, metalness: 0.06, ...envProps(0.3) });

  // ---- walls / rails ---------------------------------------------------------------------------------------------------------------------
  const wallMetal = textured(tex.metalSide, PALETTE.wallMetal, { roughness: 0.52, metalness: 0.4, ...envProps(0.8) });
  const wallRed = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.railRed), roughness: 0.34, metalness: 0.15, ...envProps(0.6) }));
  const wallCap = textured(tex.wallTop, '#8e94a2', { roughness: 0.58, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...envProps(0.6) });
  const silver = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#9ba0ac'), roughness: 0.55, metalness: 0.6, ...envProps(0.5) }));
  const steelDark = mat(new THREE.MeshStandardMaterial({ color: 0x59606c, roughness: 0.38, metalness: 0.85, ...envProps(1.0) }));
  const rubber = textured(tex.rubber, '#b82828', { roughness: 0.78, metalness: 0.0, emissive: new THREE.Color(0x000000) });
  const rampSide = textured(tex.rampSide, '#2b1f3d', { roughness: 0.5, metalness: 0.25, ...envProps(0.5) });
  const rampRailTop = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#8f8aa6'), roughness: 0.5, metalness: 0.5, ...envProps(0.5) }));

  // ---- posts / bumpers -------------------------------------------------------------------------------------------------------------------
  const postBand = textured(tex.postBand, PALETTE.railRed, { roughness: 0.4, metalness: 0.2 });
  const bumperDrum = textured(tex.bumperDrum, PALETTE.bumperWhite, { roughness: 0.45, metalness: 0.05, ...envProps(0.35) });
  const bumperCap = textured(tex.bumperCap, PALETTE.bumperCap, { roughness: 0.3, metalness: 0.25, ...envProps(0.8) });
  const bumperBase = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#b89868'), roughness: 0.5, metalness: 0.3, ...envProps(0.5) }));

  // ---- targets / flags / flippers / plunger ----------------------------------------------------------------------------------------------
  const targetFace = textured(tex.targetYellow, PALETTE.targetYellow, { roughness: 0.42, metalness: 0.05, emissive: new THREE.Color(0x000000) });
  const targetFrame = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.targetFrame), roughness: 0.5, metalness: 0.3, ...envProps(0.5) }));
  const flagPanel = textured(tex.flagPanel, '#efe6c8', { roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide });
  const flipperTop = textured(tex.flipperBody, PALETTE.flipperBody, { roughness: 0.55, metalness: 0.2, ...envProps(0.45) });
  const flipperSide = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.flipperRim), roughness: 0.4, metalness: 0.2, ...envProps(0.5) }));
  // plunger rod / kickback rods / spring: polished chrome like the ball (the table's dark studio would make them read as dark navy metal)
  const chromeEnv = (k) => (ballEnvMap ? { envMap: ballEnvMap, envMapIntensity: k } : envProps(k));
  const chrome = textured(tex.plungerRod, PALETTE.plunger, { roughness: 0.2, metalness: 0.95, ...chromeEnv(1.5) });
  const spring = mat(new THREE.MeshStandardMaterial({ color: 0xb9bec8, roughness: 0.25, metalness: 0.95, ...chromeEnv(1.4) }));
  const gateFlap = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#6e7480'), roughness: 0.6, metalness: 0.5, ...envProps(0.4) }));
  const hoodDark = textured(tex.rampSide, '#1d1530', { roughness: 0.55, metalness: 0.3, ...envProps(0.4) });
  const black = mat(new THREE.MeshBasicMaterial({ color: 0x050308, side: THREE.DoubleSide }));

  // ---- the ball --------------------------------------------------------------------------------------------------------------------------
  const ballDetail = own(ballDetailTexture());
  const ball = mat(new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.95, roughness: 0.08, map: ballDetail, ...(ballEnvMap ? { envMap: ballEnvMap, envMapIntensity: 2.2 } : envProps(2.3)),
  }));

  // ---- decals / glows --------------------------------------------------------------------------------------------------------------------
  const shadowTex = own(softDiscTexture(64, [0, 0, 8], 1.6, 0.0));
  const pitTex = own(softDiscTexture(64, [3, 2, 5], 3, 0.55));
  const glowTex = own(softDiscTexture(64, [255, 255, 255], 2, 0.0));
  const decal = (map, opacity) => mat(new THREE.MeshBasicMaterial({
    map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const ballShadow = () => decal(shadowTex, 0.5);
  const pit = decal(pitTex, 1.0);
  /** @param {number|string} color */
  const glow = (color) => mat(new THREE.MeshBasicMaterial({
    map: glowTex, color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false,
  }));
  /** Unlit colour (rings, wire insets, star rings): MeshBasic so brightness changes are exact. */
  const basic = (color, extra) => mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(color), ...extra }));
  const standard = (extra) => mat(new THREE.MeshStandardMaterial(extra));

  return {
    tex, envMap, mats, aniso,
    floor, deck, wallMetal, wallRed, wallCap, silver, steelDark, rubber, rampSide, rampRailTop, postBand, bumperDrum, bumperCap, bumperBase,
    targetFace, targetFrame, flagPanel, flipperTop, flipperSide, chrome, spring, gateFlap, hoodDark, black, ball, pit,
    textures: { shadow: shadowTex, pit: pitTex, glow: glowTex, ballDetail },
    ballShadow, glow, basic, standard, decal,
    /** True when the ART texture exists (vs. the flat-colour fallback). */
    has: (name) => !!tex[name],
    refreshEnv,
    dispose() {
      for (const m of mats) m.dispose();
      for (const t of owned) t.dispose();
    },
  };
}
