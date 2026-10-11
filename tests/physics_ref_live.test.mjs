/**
 * tests/physics_ref_live.test.mjs
 * OWNER: PHYSICS
 * STATUS: IMPLEMENTED
 * OPTIONAL live cross-check: runs the reference port (research/physics_ref_sim.py) through tests/physics_ref_driver.py with `python -I`
 * and compares the fresh numbers with the ones embedded in tests/physics_ref_data.mjs (used by tests/physics.test.mjs). Off by default
 * (it needs Python and takes ~6 s); enable with   PHYSICS_LIVE_REF=1 node --test tests/physics_ref_live.test.mjs
 * (PowerShell: $env:PHYSICS_LIVE_REF=1; node --test tests/physics_ref_live.test.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REF_FREEFALL, REF_LAUNCH, REF_FLIPPER } from './physics_ref_data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.PHYSICS_LIVE_REF === '1';
const HAS_RESEARCH = fs.existsSync(path.join(ROOT, 'research', 'physics_ref_sim.py')); // research/ is not part of the public repo

test('live reference port reproduces the embedded numbers of tests/physics_ref_data.mjs', { skip: (!LIVE && 'set PHYSICS_LIVE_REF=1 to run (needs python)') || (!HAS_RESEARCH && 'needs the private research/ folder') }, () => {
  const r = spawnSync('python', ['-I', path.join(ROOT, 'tests', 'physics_ref_driver.py'), path.join(ROOT, 'research')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, `python failed: ${r.stderr || r.error}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.freefall, REF_FREEFALL);
  assert.deepEqual(out.launch, REF_LAUNCH);
  assert.deepEqual(out.flipper, REF_FLIPPER);
});
