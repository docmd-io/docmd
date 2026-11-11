/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Test fixture root: every test run gets its own dir under os.tmpdir(),
 * child test processes of a run reuse their parent's dir, and a run
 * removes its dir when it exits. Two runs on one host must never share
 * fixture dirs.
 *
 * Run: `node tests/runner.js --only=test-root`
 * --------------------------------------------------------------------
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEST_ROOT, runTestFile } from '../shared.js';

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

const SHARED = path.resolve(import.meta.dirname, '..', 'shared.js');

// Load shared.js in a fresh node process and print the TEST_ROOT it picked.
function childRoot(env) {
  const script = `import(${JSON.stringify(SHARED)}).then((m) => console.log(m.TEST_ROOT));`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env,
    encoding: 'utf8'
  }).trim();
}

export const test = runTestFile({
  name: 'Test fixture root is unique per run',
  emoji: '📁',
  run: () => {
    assert(path.dirname(TEST_ROOT) === os.tmpdir(), 'TEST_ROOT is directly under os.tmpdir()');
    assert(path.basename(TEST_ROOT).startsWith('docmd-tests-'), 'TEST_ROOT is named docmd-tests-*');
    assert(fs.existsSync(TEST_ROOT), 'TEST_ROOT exists while the run is going');

    const env = { ...process.env };
    delete env.DOCMD_TEST_ROOT;
    const otherRun = childRoot(env);
    assert(otherRun !== TEST_ROOT, 'a second run gets a different TEST_ROOT');
    assert(!fs.existsSync(otherRun), 'a run removes its TEST_ROOT when it exits');

    const child = childRoot({ ...process.env, DOCMD_TEST_ROOT: TEST_ROOT });
    assert(child === TEST_ROOT, 'a child test process reuses its parent run\'s TEST_ROOT');
    assert(fs.existsSync(TEST_ROOT), 'a child process does not remove its parent run\'s TEST_ROOT');
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
