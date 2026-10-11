// Builds desktop/dist/StarCadet.exe: the game files plus a local copy of three.js, embedded in a small launcher
// (desktop/StarCadet.cs) compiled with the .NET Framework 4 C# compiler that ships with Windows.
// Usage: node desktop/build.mjs        (needs Node, npm and Windows; downloads three@0.160.0 from npm once)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, '.cache');
const STAGE = path.join(CACHE, 'web');
const DIST = path.join(HERE, 'dist');
const THREE_VERSION = '0.160.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

// 1. three.js from npm (once)
const THREE = path.join(CACHE, 'package');
if (!fs.existsSync(path.join(THREE, 'build', 'three.module.js'))) {
  fs.mkdirSync(CACHE, { recursive: true });
  execFileSync('npm', ['pack', `three@${THREE_VERSION}`, '--silent'], { cwd: CACHE, stdio: 'inherit', shell: true });
  execFileSync('tar', ['-xzf', `three-${THREE_VERSION}.tgz`], { cwd: CACHE, stdio: 'inherit' });
}

// 2. stage the web files: index.html (import map pointed at the local three.js), css/, src/
fs.rmSync(STAGE, { recursive: true, force: true });
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mapped = html.replace(`${CDN}build/three.module.js`, './vendor/three/build/three.module.js').replace(`${CDN}examples/jsm/`, './vendor/three/examples/jsm/');
if (mapped.includes(CDN) || mapped === html) throw new Error('index.html import map not as expected: ' + CDN);
fs.mkdirSync(STAGE, { recursive: true });
fs.writeFileSync(path.join(STAGE, 'index.html'), mapped);
const sources = [...walk(path.join(ROOT, 'css')), ...walk(path.join(ROOT, 'src'))];
for (const f of sources) copy(f, path.join(STAGE, rel(f)));

// 3. vendor exactly the three.js modules the game imports (addons and their relative imports)
const vendor = (from) => copy(path.join(THREE, from), path.join(STAGE, 'vendor', 'three', from));
vendor('build/three.module.js');
vendor('LICENSE');
const queue = new Set();
for (const f of sources.filter((f) => f.endsWith('.js'))) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/from 'three\/addons\/([^']+)'/g)) queue.add('examples/jsm/' + m[1]);
}
for (const mod of queue) {
  vendor(mod);
  for (const m of fs.readFileSync(path.join(THREE, mod), 'utf8').matchAll(/(?:from|import)\s*'(\.{1,2}\/[^']+)'/g)) {
    queue.add(path.posix.normalize(path.posix.join(path.posix.dirname(mod), m[1])));
  }
}

// 4. icon (drawn here: a yellow star on a dark blue disc, with a silver ball)
const ICON = path.join(CACHE, 'StarCadet.ico');
fs.writeFileSync(ICON, makeIco([256, 48, 32, 16]));

// 5. compile
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) throw new Error('C# compiler not found: ' + csc);
fs.mkdirSync(DIST, { recursive: true });
const staged = walk(STAGE);
const rsp = [
  '/nologo', '/target:winexe', '/optimize+', '/r:System.dll', '/r:System.Windows.Forms.dll', '/r:System.Management.dll',
  `"/win32icon:${ICON}"`, `"/out:${path.join(DIST, 'StarCadet.exe')}"`,
  ...staged.map((f) => `"/resource:${f},web/${path.relative(STAGE, f).split(path.sep).join('/')}"`),
  `"${path.join(HERE, 'StarCadet.cs')}"`,
];
const RSP = path.join(CACHE, 'build.rsp');
fs.writeFileSync(RSP, rsp.join('\r\n'));
execFileSync(csc, ['@' + RSP], { stdio: 'inherit' });
const size = fs.statSync(path.join(DIST, 'StarCadet.exe')).size;
console.log(`built desktop/dist/StarCadet.exe (${(size / 1048576).toFixed(1)} MB, ${staged.length} embedded files)`);

// ---------------------------------------------------------------------------------------------------------------------
function drawIcon(n) {
  const px = Buffer.alloc(n * n * 4);
  const S = 4; // supersampling per axis
  const star = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.2 : 0.47;
    star.push([0.5 + r * Math.cos(a), 0.47 + r * Math.sin(a)]);
  }
  const inPoly = (x, y, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let py = 0; py < n; py++) for (let qx = 0; qx < n; qx++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = (qx + (sx + 0.5) / S) / n, y = (py + (sy + 0.5) / S) / n;
      const dx = x - 0.5, dy = y - 0.5, d = Math.hypot(dx, dy);
      const bx = x - 0.73, by = y - 0.74, bd = Math.hypot(bx, by);
      let c = null;
      if (bd < 0.15) { const l = Math.max(0, 1 - Math.hypot(bx + 0.05, by + 0.05) / 0.17); c = [120 + 135 * l, 125 + 130 * l, 140 + 115 * l]; }
      else if (inPoly(x, y, star)) c = [255, 205 + 40 * (1 - y), 40];
      else if (d < 0.48) c = d > 0.45 ? [180, 160, 255] : [18 + 40 * (1 - d * 2), 16 + 30 * (1 - d * 2), 70 + 60 * (1 - d * 2)];
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
    }
    const k = S * S, o = (py * n + qx) * 4, cov = a / k / 255;
    px[o] = cov ? r / k / cov : 0; px[o + 1] = cov ? g / k / cov : 0; px[o + 2] = cov ? b / k / cov : 0; px[o + 3] = a / k;
  }
  return px;
}

function png(n, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function makeIco(sizes) {
  const images = sizes.map((n) => png(n, drawIcon(n)));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((n, i) => {
    const e = 6 + 16 * i;
    head[e] = n >= 256 ? 0 : n; head[e + 1] = n >= 256 ? 0 : n; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}
