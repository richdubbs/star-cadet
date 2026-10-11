/**
 * src/render/geom/envmap.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 (pure helper, no three): the pixels of the chrome ball's private environment.
 * The original ball is a polished silver sphere seen from above: a pale sky gradient overhead, a bright soft box at the upper left (the specular
 * highlight), a long strip light, a soft darker horizon and a dark bluish ground with a few table-coloured bounces (so the lower rim is dark but never
 * black against the navy floor). three_utils.chromeEnvTexture() wraps these pixels into an equirectangular DataTexture (the table metals keep ART's
 * `misc.ballEnv`).
 *
 * Layout: RGBA8, rows run from the NADIR (row 0) to the ZENITH (a DataTexture is not flipped); u = 0.5 + atan2(z, x) / 2pi (three.js equirect convention),
 * elevation = (row + 0.5) / H * pi - pi / 2. Values are sRGB-encoded.
 */

const DEG = Math.PI / 180;
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let x = (a - b) % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x < -Math.PI) x += 2 * Math.PI; return x; };
/** soft rectangle in (azimuth, elevation): 1 inside, 0 beyond `soft` radians outside the half sizes */
const rect = (phi, el, p0, e0, hw, hh, soft) => {
  const dx = Math.abs(angDiff(phi, p0)) * Math.max(0.35, Math.cos(el)), dy = Math.abs(el - e0);
  return (1 - sm(hw, hw + soft, dx)) * (1 - sm(hh, hh + soft, dy));
};
/** spherical gaussian blob */
const blob = (phi, el, p0, e0, rad) => { const dx = angDiff(phi, p0) * Math.max(0.3, Math.cos(el)), dy = el - e0; return Math.exp(-(dx * dx + dy * dy) / (rad * rad)); };

/** table-coloured bounces on the ground: [azimuth deg, elevation deg, radius deg, rgb, amplitude] */
const BLOBS = [[60, -34, 26, [0.95, 0.5, 0.18], 0.34], [-125, -30, 30, [0.55, 0.32, 0.95], 0.3], [175, -26, 24, [0.2, 0.75, 0.95], 0.28], [-20, -40, 30, [0.9, 0.2, 0.3], 0.18]];

/** Direction (azimuth / elevation in degrees, three.js equirect convention) of the soft box that makes the specular highlight. */
export const CHROME_KEY_LIGHT = Object.freeze({ azimuthDeg: -148, elevationDeg: 38 });

/**
 * @param {number} [W=256] @param {number} [H=128]
 * @returns {Uint8Array} RGBA8, W*H*4, rows nadir -> zenith
 */
export function chromeEnvPixels(W = 256, H = 128) {
  const d = new Uint8Array(W * H * 4);
  for (let r = 0; r < H; r++) {
    const el = ((r + 0.5) / H - 0.5) * Math.PI;
    for (let c = 0; c < W; c++) {
      const phi = ((c + 0.5) / W - 0.5) * 2 * Math.PI;
      // sky (above the horizon) and ground (below) are both evaluated and cross-faded over +-7 degrees: the horizon is a soft band, not a seam
      const t = sm(0, 1, Math.max(0, el) / (Math.PI / 2));
      const sR = mix(0.24, 0.6, t), sG = mix(0.28, 0.65, t), sB = mix(0.4, 0.8, t);
      const s = Math.pow(sm(0, 1, Math.max(0, -el) / (Math.PI / 2)), 0.6);
      let gR = mix(0.15, 0.03, s), gG = mix(0.16, 0.034, s), gB = mix(0.26, 0.07, s);
      for (const [p0, e0, rad, col, amp] of BLOBS) {
        const k = blob(phi, el, p0 * DEG, e0 * DEG, rad * DEG) * amp * (1 - sm(-8 * DEG, 4 * DEG, el));
        gR += col[0] * k; gG += col[1] * k; gB += col[2] * k;
      }
      const w = sm(-7 * DEG, 7 * DEG, el);
      let R = mix(gR, sR, w), G = mix(gG, sG, w), B = mix(gB, sB, w);
      const key = rect(phi, el, CHROME_KEY_LIGHT.azimuthDeg * DEG, CHROME_KEY_LIGHT.elevationDeg * DEG, 15 * DEG, 9 * DEG, 9 * DEG);
      const rim = rect(phi, el, 20 * DEG, 20 * DEG, 30 * DEG, 2.5 * DEG, 5 * DEG) * 0.7;      // a long strip light behind the ball
      const top = sm(78 * DEG, 88 * DEG, el) * 0.35;                                           // a pale overhead panel
      const lit = Math.max(key, rim, top);
      R = Math.min(1, mix(R, 1, lit)); G = Math.min(1, mix(G, 1, lit)); B = Math.min(1, mix(B, 1, lit));
      const o = (r * W + c) * 4;
      d[o] = Math.round(R * 255); d[o + 1] = Math.round(G * 255); d[o + 2] = Math.round(B * 255); d[o + 3] = 255;
    }
  }
  return d;
}
