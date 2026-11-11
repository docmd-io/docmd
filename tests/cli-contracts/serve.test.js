/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * `docmd serve`: bind precedence, `serve` config, router, stop predicate
 * (small / in-process) and one long-lived serve spawn covering the
 * startup build, production page, no dev behaviour, upgrade 404 and
 * graceful shutdown.
 *
 * Run: `node tests/runner.js --only=serve`
 * --------------------------------------------------------------------
 */

import { setup, writeFile, build, runTestFile, DOCMD } from '../shared.js';
import { freePort, canConnect, request, spawnServe, waitForHealthz, stopServe } from '../_lib/serve-harness.js';
import { resolveServeBind, normalizeServeConfig } from '../../packages/core/dist/server/serve-config.js';
import { createServeRouter, outputDirConflict } from '../../packages/core/dist/commands/serve.js';
import { isDocmdCommand } from '../../packages/core/dist/commands/stop.js';
import { safePath } from '../../packages/utils/dist/path.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { WebSocket } = createRequire(DOCMD)('ws');

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

function upgradeStatus(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('error', () => resolve('error'));
  });
}

export const test = runTestFile({
  name: 'Serve: production command, config, router, graceful shutdown',
  emoji: '🚀',
  run: async () => {
    // Precedence table.
    {
      const cfg = { host: 'cfg.host', port: 5000 };
      const rows = [
        ['only CLI', { cli: { host: 'cli.host', port: '4001' }, env: {}, config: { host: '127.0.0.1', port: 3000 } }, { host: 'cli.host', port: 4001 }],
        ['only env', { cli: {}, env: { DOCMD_HOST: 'env.host', PORT: '4002' }, config: { host: '127.0.0.1', port: 3000 } }, { host: 'env.host', port: 4002 }],
        ['only config', { cli: {}, env: {}, config: cfg }, { host: 'cfg.host', port: 5000 }],
        ['nothing', { cli: {}, env: {}, config: normalizeServeConfig(undefined) }, { host: '127.0.0.1', port: 3000 }],
        ['all set', { cli: { host: 'cli.host', port: '4001' }, env: { DOCMD_HOST: 'env.host', PORT: '4002' }, config: cfg }, { host: 'cli.host', port: 4001 }],
        ['env + config', { cli: {}, env: { DOCMD_HOST: 'env.host', PORT: '4002' }, config: cfg }, { host: 'env.host', port: 4002 }],
      ];
      for (const [name, input, want] of rows) {
        const got = resolveServeBind(input);
        assert(got.host === want.host && got.port === want.port, `precedence (${name}) -> ${want.host}:${want.port}`);
      }
    }

    // Config defaults.
    {
      const defaults = normalizeServeConfig(undefined);
      assert(JSON.stringify(defaults) === JSON.stringify({ host: '127.0.0.1', port: 3000, actions: { enabled: false, origins: [], identityHeader: null }, mcp: { enabled: false, origins: [] } }),
        'normalizeServeConfig(undefined) returns the documented defaults');
      const partial = normalizeServeConfig({ port: '4100' });
      assert(partial.port === 4100 && partial.host === '127.0.0.1',
        'partial serve block keeps user values, fills the rest, string port becomes a number');
      for (const bad of [null, 'x', 42, []]) {
        const n = normalizeServeConfig(bad);
        assert(n.host === '127.0.0.1' && n.port === 3000, `normalizeServeConfig(${JSON.stringify(bad)}) falls back to the defaults`);
      }
      assert(normalizeServeConfig({ host: '' }).host === '127.0.0.1', 'an empty host falls back to the default');
    }

    // Router seam, in-process on port 0, output dir has no index.html.
    {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmd-serve-router-'));
      const server = http.createServer(createServeRouter({ outputDir: () => outDir, version: '9.9.9' }));
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address();
      try {
        const get = await request(port, '/healthz');
        assert(get.status === 200 && /^application\/json/.test(get.headers['content-type']) &&
          get.body.includes('"status":"ok"') && get.body.includes('"version":"9.9.9"'), 'GET /healthz is 200 JSON with status and version');
        const head = await request(port, '/healthz', 'HEAD');
        assert(head.status === 200 && /^application\/json/.test(head.headers['content-type']) && head.body === '', 'HEAD /healthz is 200 JSON without a body');
        const post = await request(port, '/healthz', 'POST');
        assert(post.status === 405, 'POST /healthz is 405');
        const other = await request(port, '/missing.html');
        assert(other.status === 404 && other.headers['x-content-type-options'] === 'nosniff', 'unknown paths fall through to the static handler (404)');
      } finally {
        await new Promise((r) => server.close(r));
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }

    // Output-dir guard table.
    {
      const cwd = '/p/proj';
      const src = '/p/proj/docs';
      const rows = [
        ['/', '/', true], ['.', '/p/proj', true], ['..', '/p', true], ['src dir', '/p/proj/docs', true],
        ['parent of src', '/p/proj', true], ['normal site', '/p/proj/site', false], ['sibling', '/p/other', false],
      ];
      for (const [name, out, want] of rows) assert(outputDirConflict(out, cwd, src) === want, `output dir guard: ${name} -> ${want ? 'refused' : 'allowed'}`);
    }

    // Stop predicate.
    {
      const rows = [
        ['node /x/packages/core/dist/bin/docmd.js serve --port 4100', true],
        ['docmd serve', true],
        ['docmd dev', true],
        ['docmd stop', false],
        ['node other.js serve -p 4100', false],
      ];
      for (const [cmd, want] of rows) assert(isDocmdCommand(cmd) === want, `isDocmdCommand("${cmd}") is ${want}`);
    }

    // The fixture project, built once with `docmd build`, then served.
    const dir = setup('serve-fixture');
    const cfgPort = await freePort();
    writeFile(dir, 'docs/index.md', '# Home\n\nHello serve.\n');
    writeFile(dir, 'docs/other.md', '# Other\n');
    writeFile(dir, 'docmd.config.json', JSON.stringify({
      title: 'Serve', src: './docs', out: './site', serve: { host: '127.0.0.1', port: cfgPort }
    }, null, 2) + '\n');

    const built = build(dir, false, '2>&1');
    assert(built.ok && !/Unknown property/.test(built.output), '`docmd build` with a serve block prints no unknown-key warning');

    fs.writeFileSync(safePath(dir, 'site/stale.html'), '<h1>stale</h1>');

    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'docmd-serve-fakeopen-'));
    const marker = path.join(fakeBin, 'opened');
    for (const name of ['xdg-open', 'open']) {
      const p = safePath(fakeBin, name);
      fs.writeFileSync(p, `#!/bin/sh\necho "$@" >> "${marker}"\n`);
      fs.chmodSync(p, 0o755);
    }

    const cliPort = await freePort();
    const envPort = await freePort();
    const handle = spawnServe(dir, ['--port', String(cliPort)], {
      PORT: String(envPort),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    });
    let stopped = false;
    try {
      const health = await waitForHealthz(cliPort, handle);
      assert(health.status === 200, 'serve listens on the CLI port although PORT is set');
      assert(!(await canConnect('127.0.0.1', envPort)), 'nothing listens on the PORT env value');

      const indexOnDisk = fs.readFileSync(safePath(dir, 'site/index.html'), 'utf8');
      const root = await request(cliPort, '/');
      assert(root.status === 200 && root.body === indexOnDisk, 'GET / is 200 with site/index.html content');
      assert(!/docmd-api\.js|__docmd_dev|\/__dev\//.test(root.body), 'served HTML has no dev or api script');

      assert((await request(cliPort, '/stale.html')).status === 404, 'a stale file from an earlier build is not served');
      assert(/Production Server Running/i.test(handle.output.text) &&
        /Serving from\s+\S*site/i.test(handle.output.text), 'banner shows Production Server Running and the output dir');

      assert(/Actions\s+off/.test(handle.output.text), 'banner shows Actions off when serve.actions is not configured');
      assert(/MCP\s+off/.test(handle.output.text), 'banner shows MCP off when serve.mcp is not configured');
      assert((await request(cliPort, '/mcp', 'POST')).status === 404, 'POST /mcp is 404 when serve.mcp is not configured');
      assert(await upgradeStatus(cliPort) === 404, 'WebSocket upgrade gets HTTP 404');

      // SIGTERM -> exit 0 within 5 s, port closed.
      const started = Date.now();
      const exit = await Promise.race([
        stopServe(handle),
        new Promise((r) => setTimeout(() => r({ code: null, timedOut: true }), 5000)),
      ]);
      stopped = exit.code !== null;
      assert(exit.code === 0 && Date.now() - started <= 5000, 'SIGTERM exits 0 within 5 s');
      assert(!(await canConnect('127.0.0.1', cliPort)), 'the port refuses connections after SIGTERM');
      assert(!fs.existsSync(marker), 'no browser was opened');
    } finally {
      if (!stopped) {
        handle.child.kill('SIGKILL');
        await handle.exited;
      }
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
