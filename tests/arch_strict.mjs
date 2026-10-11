/**
 * tests/arch_strict.mjs
 * OWNER: INTEGRATOR
 * STATUS: IMPLEMENTED
 * Final gate, cross-platform:  npm run test:strict   (= ARCH_STRICT=1 node --test "tests/**\/*.test.mjs" on every shell, incl. Windows cmd).
 * Strict mode fails on any module that still carries the placeholder status header and on missing role test files.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(process.execPath, ['--test', 'tests/**/*.test.mjs'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ARCH_STRICT: '1' },
});
process.exit(r.status === null ? 1 : r.status);
