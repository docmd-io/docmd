/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * `pnpm -r run build` must not dirty a clean checkout: the committed
 * plugin registry is byte-for-byte reproducible, and the per-platform
 * Rust binaries that `build.js` writes are ignored (except the one
 * that is committed).
 *
 * Run: `node tests/runner.js --only=build-clean-tree`
 * --------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTestFile } from '../shared.js';
import { safePath } from '../../packages/utils/dist/path.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = path.join(ROOT, 'scripts', 'build-plugin-registry.mjs');
const REGISTRY = path.join(ROOT, 'packages', 'api', 'registry', 'plugins.generated.json');
const BIN_DIR = 'packages/engines/rust-binaries/bin';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failed++;
    failures.push(message);
    console.log(`    ❌ ${message}`);
  } else {
    passed++;
    console.log(`    ✅ ${message}`);
  }
}

function generate() {
  execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, stdio: 'pipe' });
  return fs.readFileSync(safePath(ROOT, REGISTRY));
}

function isIgnored(relPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', relPath], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (e) {
    if (e.status === 1) return false;
    throw e;
  }
}

export const test = runTestFile({
  name: 'Build leaves the git tree clean',
  emoji: '🧹',
  run: async () => {
    const first = generate();
    await new Promise((r) => setTimeout(r, 5));
    const second = generate();
    assert(first.equals(second), 'build-plugin-registry writes identical bytes on every run');
    assert(!/"generatedAt"/.test(first.toString('utf8')), 'plugins.generated.json carries no build timestamp');

    for (const platform of ['darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']) {
      const rel = `${BIN_DIR}/docmd-engine-${platform}.node`;
      assert(isIgnored(rel), `${rel} is gitignored`);
    }
    const committed = `${BIN_DIR}/docmd-engine-darwin-arm64.node`;
    assert(!isIgnored(committed), `${committed} is not gitignored (it is committed)`);
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
