/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * `docmd serve` startup failures: every one exits 1 (port in use,
 * invalid config, workspace root) and SIGINT
 * shuts a running server down cleanly. One short-lived spawn each.
 *
 * Run: `node tests/runner.js --only=serve-startup`
 * --------------------------------------------------------------------
 */

import { setup, writeFile, runTestFile } from '../shared.js';
import { freePort, canConnect, spawnServe, waitForHealthz, exitWithin } from '../_lib/serve-harness.js';
import net from 'node:net';

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

function project(name, config) {
  const dir = setup(name);
  writeFile(dir, 'docs/index.md', '# Hi\n');
  writeFile(dir, 'docmd.config.json', typeof config === 'string' ? config : JSON.stringify({ title: 'T', src: './docs', out: './site', ...config }, null, 2) + '\n');
  return dir;
}

async function expectExit1(dir, args, timeoutMs = 15000) {
  const handle = spawnServe(dir, args);
  try {
    const r = await exitWithin(handle, timeoutMs);
    return { ...r, text: handle.output.text };
  } finally {
    if (handle.child.exitCode === null) { handle.child.kill('SIGKILL'); await handle.exited; }
  }
}

export const test = runTestFile({
  name: 'Serve startup failures exit 1 and SIGINT stops cleanly',
  emoji: '🚧',
  run: async () => {
    // Port already bound -> exit 1, names the port, no fallback to port + 1.
    {
      const dir = project('serve-startup-port', {});
      const blocker = net.createServer();
      await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
      const { port } = blocker.address();
      try {
        const r = await expectExit1(dir, ['--port', String(port)], 5000);
        assert(r.code === 1 && !r.timedOut, 'port in use exits 1 within 5 s');
        assert(r.text.includes(String(port)), 'output names the port');
        assert(!(await canConnect('127.0.0.1', port + 1)), 'nothing listens on port + 1');
      } finally {
        await new Promise((r) => blocker.close(r));
      }
    }

    // Invalid config -> exit 1, nothing listening.
    {
      const dir = project('serve-startup-badconfig', '{ "title": "x", ');
      const port = await freePort();
      const r = await expectExit1(dir, ['--port', String(port)]);
      assert(r.code === 1, 'syntactically invalid config exits 1');
      assert(!(await canConnect('127.0.0.1', port)), 'nothing listens on the chosen port');
    }

    // Workspace root.
    {
      const dir = project('serve-startup-workspace', {
        workspace: { projects: [{ prefix: '/', src: './docs' }] }
      });
      const r = await expectExit1(dir, ['--port', String(await freePort())]);
      assert(r.code === 1 && r.text.includes('docmd serve does not support workspaces yet'), 'workspace root exits 1 with the message');
    }

    // SIGINT -> exit 0, port closed.
    {
      const dir = project('serve-startup-sigint', {});
      const port = await freePort();
      const handle = spawnServe(dir, ['--port', String(port)]);
      try {
        await waitForHealthz(port, handle);
        handle.child.kill('SIGINT');
        const r = await exitWithin(handle, 5000);
        assert(r.code === 0 && !r.timedOut, 'SIGINT exits 0 within 5 s');
        assert(!(await canConnect('127.0.0.1', port)), 'the port refuses connections after SIGINT');
      } finally {
        if (handle.child.exitCode === null) { handle.child.kill('SIGKILL'); await handle.exited; }
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
