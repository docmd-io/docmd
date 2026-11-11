/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Shared test helpers — extracted from `tests/feature-integration.test.js` so the
 * categorised tests under `tests/` can share a single source of truth
 * for the project-fixture utilities (setup, writeFile, build,
 * readSite, exitCodeOf, assert).
 *
 * Each test file in `tests/` calls `runTestFile({ name, run })` from
 * the runner — the runner owns the pass/fail counter, the TUI section
 * output, and the per-file result aggregation. This file owns ONLY
 * the stateless helpers.
 *
 * Pattern:
 *   import { setup, writeFile, assert, build, readSite, exitCodeOf,
 *           runTestFile, DOCMD } from '../shared.js';
 *
 *   runTestFile({
 *     name: 'Exit-code contract',
 *     emoji: '🚦',
 *     run: ({ assert, setup, writeFile, exitCodeOf }) => {
 *       // ... assertions ...
 *     }
 *   });
 * --------------------------------------------------------------------
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryHit, store as cacheStore } from './_lib/build-cache.mjs';

export const DOCMD = path.resolve(
  import.meta.dirname,
  '..',
  'packages/core/dist/bin/docmd.js'
);

/**
 * Root for every fixture dir of this test run. Each run gets its own
 * dir under os.tmpdir(), so two runs on one host never share fixtures.
 * The first process to load this file creates the dir, exports it as
 * DOCMD_TEST_ROOT so child test processes reuse it, and removes it on
 * exit.
 */
export const TEST_ROOT = process.env.DOCMD_TEST_ROOT || createTestRoot();

function createTestRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmd-tests-'));
  process.env.DOCMD_TEST_ROOT = dir;
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      cleanup();
      process.kill(process.pid, signal);
    });
  }
  return dir;
}
export const PASS = '✅';
export const FAIL = '❌';

/**
 * Create an empty test directory under TEST_ROOT and return its path.
 * The directory is wiped clean on every call (no test-pollution).
 */
export function setup(name) {
  const dir = path.join(TEST_ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Run `node ${DOCMD} build` in `dir`. Returns `{ ok, output }` where
 * `ok` is true on exit 0 and `output` is the captured stdout/stderr.
 * Set `expectFail = true` to invert the meaning of `ok` (the caller
 * is testing a documented failure path).
 */
export function build(dir, expectFail = false, extraArgs = '') {
  const configPath = path.join(dir, 'docmd.config.json') + (extraArgs ? `#${extraArgs}` : '');
  if (!expectFail) {
    const hit = tryHit(dir, configPath);
    if (hit && hit.ok) {
      const cachedSite = hit.siteDir;
      const targetSite = path.join(dir, 'site');
      fs.rmSync(targetSite, { recursive: true, force: true });
      try {
        fs.cpSync(cachedSite, targetSite, { recursive: true, dereference: false });
      } catch {
        fs.rmSync(targetSite, { recursive: true, force: true });
        fs.mkdirSync(targetSite, { recursive: true });
      }
      return { ok: true, output: hit.output, stderr: hit.stderr || '', cached: true };
    }
  }
  const cmd = `node ${DOCMD} build${extraArgs ? ' ' + extraArgs : ''}`;
  try {
    const out = execSync(cmd, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    if (expectFail) return { ok: false, output: out, stderr: '' };
    const siteDir = path.join(dir, 'site');
    if (!expectFail && fs.existsSync(siteDir)) {
      try { cacheStore(dir, configPath, siteDir, true, out); } catch { /* cache best-effort */ }
    }
    return { ok: true, output: out, stderr: '', cached: false };
  } catch (e) {
    if (expectFail) return { ok: true, output: e.stderr || e.stdout || '', stderr: e.stderr || '' };
    return { ok: false, output: e.stderr || e.stdout || '', stderr: e.stderr || '' };
  }
}

/**
 * Run a command in `dir` and return its numeric exit code.
 * 0 = success, 1+ = documented failure, -1 = killed by signal.
 */
export function exitCodeOf(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status == null ? -1 : e.status;
  }
}

/**
 * Write `content` to `<dir>/<filePath>`. Parent directories are
 * created automatically.
 */
export function writeFile(dir, filePath, content) {
  const full = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/**
 * Read `<dir>/site/<filePath>`. Returns `null` if the file does
 * not exist (test fixtures use this to assert "build did not
 * produce output X").
 */
export function readSite(dir, filePath) {
  const full = path.join(dir, 'site', filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

/**
 * `true` if `<dir>/site/<filePath>` exists. Convenience wrapper
 * for the common "did the build produce this asset?" check.
 */
export function siteExists(dir, filePath) {
  return fs.existsSync(path.join(dir, 'site', filePath));
}

/**
 * Run a test file's `run` callback inside a tracked TUI section.
 * The runner reads the per-file results and aggregates them into
 * the global pass/fail counts.
 *
 * @param {object}   opts
 * @param {string}   opts.name    — section title (e.g. "Exit-code contract")
 * @param {string}   opts.emoji   — single emoji (e.g. "🚦")
 * @param {Function} opts.run     — `({ assert }) => void | Promise<void>`
 *                                 Receives the runner's assert helper so
 *                                 the test's pass/fail count feeds into
 *                                 the global counter.
 */
export function runTestFile(opts) {
  if (typeof opts !== 'object' || !opts || typeof opts.run !== 'function') {
    throw new TypeError('runTestFile({ name, emoji, run }) — run must be a function');
  }
  return {
    name: opts.name,
    emoji: opts.emoji || '📦',
    run: opts.run
  };
}