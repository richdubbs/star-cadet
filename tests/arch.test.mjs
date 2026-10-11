/**
 * tests/arch.test.mjs
 * OWNER: INTEGRATOR  (content written by ARCHITECT)
 * STATUS: IMPLEMENTED
 * Architecture conformance guard. Runs against the stubs today and keeps every role honest while the modules are implemented:
 *   - every contracted file exists and carries an `OWNER: <ROLE>` header naming the contracted owner
 *   - every Node-importable module exports every contracted name (so parallel work never breaks an import)
 *   - the data barrel re-exports every data module name
 *   - the import graph obeys the layering rules (tests/arch_manifest.mjs IMPORT_RULES)
 *   - package.json / index.html basics
 * ARCH_STRICT=1 additionally fails on any module whose header still declares the placeholder status and on missing role test files (final gate).
 * Integration pass: also covers EXTRA_FILES (additive internals of the roles) and checks that every file under src/ and tools/ is listed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FILES, EXTRA_FILES, ROLE_TESTS, IMPORT_RULES, REQUIRED_IDS } from './arch_manifest.mjs';

/** every listed file: the contracted ones and the additive internals */
const ALL = [...FILES, ...EXTRA_FILES];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.env.ARCH_STRICT === '1';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(dir, out = []) {
  for (const name of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + name.name;
    if (name.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(src) {
  const code = stripComments(src);
  const re = /(?:^|[\s;])(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const out = [];
  for (let m; (m = re.exec(code));) out.push(m[1] || m[2] || m[3]);
  return out;
}

test('layout: every contracted file exists and names its owner in the header', () => {
  const problems = [];
  for (const f of ALL) {
    if (!exists(f.path)) { problems.push('missing ' + f.path); continue; }
    if (!/\.(js|mjs)$/.test(f.path)) continue;
    const head = read(f.path).slice(0, 1500);
    const m = /OWNER:\s*([A-Z]+)/.exec(head);
    if (!m) problems.push('no OWNER header in ' + f.path);
    else if (m[1] !== f.owner) problems.push(`${f.path}: header owner ${m[1]} != contracted ${f.owner}`);
  }
  assert.deepEqual(problems, []);
});

test('exports: every Node-importable module exports the contracted names', async () => {
  const problems = [];
  for (const f of ALL) {
    if (!f.exports || f.node === false || !/\.(js|mjs)$/.test(f.path) || !exists(f.path)) continue;
    let mod;
    try { mod = await import(pathToFileURL(path.join(ROOT, f.path)).href); } catch (e) { problems.push(`${f.path}: import failed: ${e.message}`); continue; }
    for (const name of f.exports) if (!(name in mod)) problems.push(`${f.path}: missing export ${name}`);
  }
  assert.deepEqual(problems, []);
});

test('data barrel re-exports every data module name', async () => {
  const barrel = await import(pathToFileURL(path.join(ROOT, 'src/data/index.js')).href);
  const problems = [];
  for (const f of FILES.filter((x) => x.path.startsWith('src/data/') && x.exports && x.path !== 'src/data/index.js')) {
    for (const name of f.exports) if (!(name in barrel)) problems.push(`${name} (from ${f.path}) missing in src/data/index.js`);
  }
  assert.deepEqual(problems, []);
});

test('imports: the module graph obeys the layering rules', () => {
  const problems = [];
  const files = [...walk('src'), ...walk('tools')].filter((p) => /\.(js|mjs)$/.test(p));
  for (const rel of files) {
    const rule = IMPORT_RULES.filter((r) => rel.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!rule) { problems.push(`${rel}: no layering rule matches (add one to tests/arch_manifest.mjs)`); continue; }
    if (rule.allow.includes('*')) continue;
    for (const spec of importsOf(read(rel))) {
      let target = spec;
      if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      const exactOk = rule.allow.some((a) => /\.m?js$/.test(a) && a === target);
      if (exactOk) continue;
      if ((rule.deny || []).some((d) => target.startsWith(d))) { problems.push(`${rel} must not import ${spec}`); continue; }
      if (!rule.allow.some((a) => target.startsWith(a))) problems.push(`${rel} must not import ${spec}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('package.json is an ES-module project with a test script and no runtime dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.scripts && pkg.scripts.test, 'scripts.test missing');
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'runtime dependencies are forbidden');
});

test('index.html: import map pins three@0.160.0 and every mount point id exists exactly once', () => {
  const html = read('index.html');
  assert.match(html, /three@0\.160\.0\/build\/three\.module\.js/);
  assert.match(html, /type="importmap"/);
  assert.match(html, /<script type="module" src="src\/main\.js">/);
  for (const id of REQUIRED_IDS) {
    const n = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    assert.equal(n, 1, `id="${id}" must appear exactly once in index.html (found ${n})`);
  }
});

test('ARCHITECTURE.md mentions every contracted file', () => {
  const doc = read('ARCHITECTURE.md');
  const missing = FILES.filter((f) => !doc.includes(f.path)).map((f) => f.path);
  assert.deepEqual(missing, []);
});

test('every file under src/ and tools/ is listed in FILES or EXTRA_FILES, with the owner its directory implies', () => {
  const listed = new Map(ALL.map((f) => [f.path, f.owner]));
  const ownerOf = (p) => (p.startsWith('src/data/') || p.startsWith('tools/') ? 'DATA'
    : p.startsWith('src/physics') ? 'PHYSICS' : p.startsWith('src/lamps') ? 'LAMPS' : p.startsWith('src/rules') ? 'RULES'
      : p.startsWith('src/audio') ? 'AUDIO' : p.startsWith('src/render/art/') ? 'ART' : p.startsWith('src/render/') ? 'RENDER'
        : p.startsWith('src/ui/') ? 'UI' : 'INTEGRATOR');
  const problems = [];
  for (const rel of [...walk('src'), ...walk('tools')].filter((p) => /\.(js|mjs)$/.test(p))) {
    if (!listed.has(rel)) problems.push('unlisted ' + rel + ' (append it to EXTRA_FILES in tests/arch_manifest.mjs)');
    else if (listed.get(rel) !== ownerOf(rel)) problems.push(`${rel}: listed owner ${listed.get(rel)} != directory owner ${ownerOf(rel)}`);
  }
  const dupes = ALL.map((f) => f.path).filter((p, i, a) => a.indexOf(p) !== i);
  assert.deepEqual(dupes, [], 'a path is listed twice');
  assert.deepEqual(problems, []);
});

test('status report (informational; strict mode fails on placeholder modules and missing role tests)', (t) => {
  const stubs = [];
  const PLACEHOLDER = new RegExp('STATUS:\s*' + 'ST' + 'UB');
  for (const f of ALL) {
    if (!/\.(js|mjs)$/.test(f.path) || !exists(f.path)) continue;
    if (PLACEHOLDER.test(read(f.path).slice(0, 1500))) stubs.push(`${f.owner}:${f.path}`);
  }
  const noTests = Object.entries(ROLE_TESTS).filter(([, p]) => !exists(p)).map(([r, p]) => `${r}:${p}`);
  t.diagnostic(`${stubs.length} stub module(s) remaining`);
  t.diagnostic(`${noTests.length} role test file(s) missing`);
  if (STRICT) {
    assert.deepEqual(stubs, [], 'stubs remain');
    assert.deepEqual(noTests, [], 'role tests missing');
  }
});
