/**
 * tests/helpers/fake_canvas.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * A recording CanvasLike for Node tests (ART, UI panel). Every 2D-context method call and property assignment is appended to
 * canvas.ops; gradients/measureText/getImageData return harmless values. Nothing is rasterised.
 *
 *   const { createCanvas, canvases } = createFakeCanvasFactory({ strict: true });
 *   const pack = paintAll(data, { createCanvas, seed: 1 });
 *   opsDigest(pack.floor.canvas)   // stable string for determinism tests
 *
 * strict: true makes the context throw a TypeError on any method or property outside CANVAS_API - this is how ART/UI tests prove they stay
 * inside the 2D-API subset the architecture allows (ARCHITECTURE.md 9.2).
 */

/** The allowed 2D context subset (methods). */
export const CANVAS_API = Object.freeze({
  methods: [
    'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect',
    'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'measureText', 'drawImage',
    'createLinearGradient', 'createRadialGradient', 'createPattern', 'getImageData', 'putImageData', 'createImageData', 'setLineDash',
  ],
  properties: [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'globalAlpha', 'globalCompositeOperation', 'font',
    'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'imageSmoothingEnabled', 'canvas',
  ],
});

export function createFakeCanvas(width = 1, height = 1, { strict = false } = {}) {
  const ops = [];
  const gradient = () => ({ addColorStop: (...a) => ops.push(['addColorStop', ...a]) });
  const store = {};
  const methods = new Set(CANVAS_API.methods);
  const props = new Set(CANVAS_API.properties);
  const ctx = new Proxy(store, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p in t) return t[p];
      if (strict && !methods.has(p) && !props.has(p)) throw new TypeError('canvas API outside the allowed subset: ' + p);
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        return (...a) => { ops.push([p, ...a]); return gradient(); };
      }
      if (p === 'createPattern') return (...a) => { ops.push([p, a.length]); return {}; };
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h });
      if (p === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h });
      return (...a) => { ops.push([p, ...a]); };
    },
    set(t, p, v) {
      if (strict && !props.has(p)) throw new TypeError('canvas property outside the allowed subset: ' + String(p));
      t[p] = v;
      ops.push(['set', p, v]);
      return true;
    },
  });
  const canvas = { width, height, ops, getContext: () => ctx, toDataURL: () => 'data:,', isFakeCanvas: true };
  store.canvas = canvas;
  return canvas;
}

/** @returns {{createCanvas:(w:number,h:number)=>object, canvases:object[]}} */
export function createFakeCanvasFactory(options = {}) {
  const canvases = [];
  return { canvases, createCanvas: (w, h) => { const c = createFakeCanvas(w, h, options); canvases.push(c); return c; } };
}

/** Cheap stable digest of everything drawn on a fake canvas (for "same seed => same output" tests). */
export function opsDigest(canvas) {
  const s = JSON.stringify(canvas.ops);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return canvas.ops.length + ':' + h.toString(16);
}
