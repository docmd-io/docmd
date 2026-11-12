/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * MCP over HTTP under `docmd serve`: the `serve.mcp` config and banner,
 * the stateless `POST /mcp` transport (in process), and real `docmd serve`
 * spawns: tools over HTTP, `read_doc` confinement, the Origin rule,
 * read-only `get_llms_context`, and `--config` honoured by the tools.
 *
 * Run: `node tests/runner.js --only=serve-mcp`
 * --------------------------------------------------------------------
 */

import http from 'node:http';
import fs from 'node:fs';
import { setup, writeFile, runTestFile } from '../shared.js';
import { freePort, request, spawnServe, waitForHealthz, stopServe } from '../_lib/serve-harness.js';
import { normalizeServeConfig, validateServeConfig } from '../../packages/core/dist/server/serve-config.js';
import { mcpBanner, createServeRouter } from '../../packages/core/dist/commands/serve.js';
import { createMcpHandler } from '../../packages/core/dist/commands/mcp.js';
import { createMcpHttpHandler } from '../../packages/core/dist/server/mcp-http.js';
import { safePath } from '../../packages/utils/dist/path.js';

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

/** POST `body` (string or object) to /mcp; resolves { status, headers, body, json }. */
function post(port, body, headers = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(text); } catch { /* empty or non-JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const textOf = (r) => r.json?.result?.content?.[0]?.text || '';
const stripAnsi = (s) => s.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
const TOOLS = ['search_docs', 'list_docs', 'read_doc', 'get_config', 'validate_docs', 'get_llms_context'];

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

export const test = runTestFile({
  name: 'MCP over HTTP under docmd serve',
  emoji: '🌐',
  run: async () => {
    // ── Config and banner ───────────────────────────────────────────────
    {
      const d = normalizeServeConfig(undefined).mcp;
      assert(d.enabled === false && d.origins.length === 0, 'MCP is off by default, with no origins');
      for (const bad of [null, 'x', { mcp: 'on' }, { mcp: { enabled: 'true' } }, { mcp: { enabled: 1, origins: 'x' } }]) {
        const n = normalizeServeConfig(bad).mcp;
        assert(n.enabled === false && n.origins.length === 0, `normalizeServeConfig(${JSON.stringify(bad)}) does not throw and keeps MCP off`);
      }
      const on = normalizeServeConfig({ mcp: { enabled: true, origins: ['https://docs.example.com'] } }).mcp;
      assert(on.enabled === true && on.origins[0] === 'https://docs.example.com', 'enabled: true turns MCP on and keeps the origins');

      const errorsFor = (mcp) => validateServeConfig(normalizeServeConfig({ mcp }));
      assert(errorsFor({ enabled: true }).length === 0, 'MCP on without origins is valid (non-browser clients only)');
      assert(errorsFor({ enabled: true, origins: ['https://docs.example.com', 'http://127.0.0.1:4100'] }).length === 0, 'full origins are valid');
      const errs = errorsFor({ enabled: true, origins: ['*', 'docs.example.com', 'ftp://x.example'] });
      assert(errs.length === 3 && errs.every((e) => e.startsWith('serve.mcp.origins contains an invalid origin')), 'every invalid MCP origin is reported, "*" included');
      assert(errorsFor({ enabled: false, origins: ['*'] }).length === 1, 'origins are checked even with MCP off');

      assert(mcpBanner(normalizeServeConfig(undefined).mcp) === 'off', 'banner: off by default');
      assert(mcpBanner(on) === 'on at POST /mcp (read-only; browser origins: https://docs.example.com)', 'banner: on, read-only, with the browser origins');
      assert(mcpBanner(normalizeServeConfig({ mcp: { enabled: true } }).mcp) === 'on at POST /mcp (read-only; no browser origins)', 'banner: on without browser origins');
    }

    // ── Router: /mcp only reaches MCP when it is on ─────────────────────
    {
      const out = setup('serve-mcp-router');
      writeFile(out, 'index.html', '<p>home</p>');
      let hits = 0;
      const withMcp = http.createServer((req, res) => createServeRouter({ outputDir: () => out, version: 't', mcp: async (_q, s) => { hits++; s.end('mcp'); } })(req, res));
      const without = http.createServer((req, res) => createServeRouter({ outputDir: () => out, version: 't' })(req, res));
      const [a, b] = await Promise.all([listen(withMcp), listen(without)]);
      try {
        const r = await request(a, '/mcp?x=1', 'POST');
        assert(r.body === 'mcp' && hits === 1, 'MCP on: /mcp (with a query string) goes to the MCP handler');
        assert((await request(a, '/mcp/other')).status === 404 && hits === 1, 'MCP on: only the exact /mcp path is MCP');
        assert((await request(b, '/mcp', 'POST')).status === 404, 'MCP off: /mcp is the static handler (404 here)');
      } finally {
        await Promise.all([new Promise((r) => withMcp.close(r)), new Promise((r) => without.close(r))]);
      }
    }

    // ── HTTP transport in process (no tool touches the disk here) ───────
    {
      const allowedOrigin = 'https://docs.example.com';
      const handler = createMcpHandler({ readOnly: true });
      const open = http.createServer(createMcpHttpHandler({ handler, origins: [allowedOrigin] }));
      const closed = http.createServer(createMcpHttpHandler({ handler, origins: [] }));
      const [openPort, closedPort] = await Promise.all([listen(open), listen(closed)]);
      try {
        const i = await post(openPort, init);
        assert(i.status === 200 && /^application\/json/.test(i.headers['content-type']) && i.json?.result?.serverInfo?.name === 'docmd-mcp-server',
          'initialize: 200 JSON with serverInfo.name docmd-mcp-server');
        assert(i.headers['mcp-session-id'] === undefined && i.headers['cache-control'] === 'no-store', 'initialize: no Mcp-Session-Id, Cache-Control no-store');

        const l = await post(openPort, toolsList);
        assert(JSON.stringify(l.json?.result?.tools?.map((t) => t.name)) === JSON.stringify(TOOLS), 'tools/list: the same six tools as docmd mcp');

        const n = await post(openPort, initialized);
        assert(n.status === 202 && n.body === '', 'notification: 202 with an empty body');
        const b = await post(openPort, [init, initialized]);
        assert(b.status === 200 && Array.isArray(b.json) && b.json.length === 1 && b.json[0].result?.serverInfo?.name === 'docmd-mcp-server',
          'batch [initialize, notification]: 200 with a one-element array');
        const nb = await post(openPort, [initialized, initialized]);
        assert(nb.status === 202 && nb.body === '', 'batch of notifications only: 202');
        const empty = await post(openPort, []);
        assert(empty.status === 400 && empty.json?.error?.code === -32600, 'empty batch: 400 Invalid Request');
        const scalar = await post(openPort, '42');
        assert(scalar.status === 200 && scalar.json?.error?.code === -32600, 'a JSON scalar: Invalid Request');
        const nul = await post(openPort, 'null');
        assert(nul.status === 200 && nul.json?.error?.code === -32600, 'a JSON null: Invalid Request, not a parse error');
        const nulBatch = await post(openPort, '[null, {"jsonrpc":"2.0","id":7,"method":"ping"}]');
        assert(nulBatch.json?.[0]?.error?.code === -32600 && nulBatch.json?.[1]?.id === 7, 'a null inside a batch: Invalid Request for it, the rest answered');
        const wrong = await post(openPort, { jsonrpc: '1.0', id: 5, method: 'ping' });
        assert(wrong.json?.error?.code === -32600 && wrong.json?.id === 5, 'jsonrpc other than 2.0: Invalid Request with the id');
        const unknown = await post(openPort, { jsonrpc: '2.0', id: 6, method: 'nope' });
        assert(unknown.json?.error?.code === -32601, 'unknown method: -32601');

        for (const method of ['GET', 'DELETE', 'PUT']) {
          const r = await post(openPort, undefined, {}, method);
          assert(r.status === 405 && r.headers.allow === 'POST', `${method} /mcp: 405 with Allow: POST`);
        }

        const bad = await post(openPort, '{not json');
        assert(bad.status === 400 && bad.json?.error?.code === -32700, 'invalid JSON: 400 with parse error -32700');
        const big = await post(openPort, JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping', params: { pad: 'x'.repeat(1024 * 1024 + 1) } }));
        assert(big.status === 413, 'body over 1 MiB: 413');

        // Announced length over the limit: 413 before the body arrives.
        const early = await new Promise((resolve) => {
          const timer = setTimeout(() => { req.destroy(); resolve('hung'); }, 2000);
          const req = http.request({ host: '127.0.0.1', port: openPort, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2097152 } }, (res) => {
            clearTimeout(timer);
            res.resume();
            resolve(res.statusCode);
            req.destroy();
          });
          req.on('error', () => {});
          req.write('{"jsonrpc"');
        });
        assert(early === 413, 'Content-Length over 1 MiB: 413 without waiting for the body');

        const sess = await post(openPort, init, { 'Mcp-Session-Id': 'abc', 'MCP-Protocol-Version': '1999-01-01' });
        assert(sess.status === 200 && sess.json?.result?.serverInfo?.name === 'docmd-mcp-server', 'Mcp-Session-Id and MCP-Protocol-Version request headers are ignored');

        // Origin: checked when present, before the method.
        const foreign = await post(openPort, init, { Origin: 'https://evil.example' });
        assert(foreign.status === 403 && foreign.json?.error?.message === 'Origin not allowed', 'origins [x]: a foreign Origin is 403');
        assert((await post(openPort, init, { Origin: 'https://docs.example.com:8443' })).status === 403, 'origins [x]: same host on another port is 403');
        assert((await post(openPort, undefined, { Origin: 'https://evil.example' }, 'GET')).status === 403, 'a foreign Origin is 403 whatever the method');
        assert((await post(openPort, init, { Origin: allowedOrigin })).status === 200, 'origins [x]: the listed Origin is 200');
        assert((await post(closedPort, init, { Origin: allowedOrigin })).status === 403, 'origins []: any Origin is 403');
        assert((await post(closedPort, init, { Origin: 'null' })).status === 403, 'origins []: Origin "null" is 403');
        assert((await post(closedPort, init)).status === 200, 'origins []: no Origin (a non-browser client) is 200');
      } finally {
        open.closeAllConnections?.();
        closed.closeAllConnections?.();
        await Promise.all([new Promise((r) => open.close(r)), new Promise((r) => closed.close(r))]);
      }
    }

    // ── Real docmd serve with serve.mcp on ───────────────────────────────
    {
      const port = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      const dir = setup('serve-mcp-spawn');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'T', src: 'docs', out: 'site', url: 'https://example.test',
        serve: { mcp: { enabled: true, origins: [origin] } },
      }));
      writeFile(dir, '.env', 'SECRET=hunter2\n');
      writeFile(dir, 'notes.md', '# Not a doc\nPRIVATE NOTE\n');
      writeFile(dir, 'docs/index.md', '# Home\n\nWelcome page.\n');
      writeFile(dir, 'docs/intro.md', '# Intro content\n');
      const handle = spawnServe(dir, ['--port', String(port)]);
      try {
        await waitForHealthz(port, handle);
        assert(/MCP\s+on at POST \/mcp \(read-only; browser origins: http:\/\/127\.0\.0\.1:\d+\)/.test(stripAnsi(handle.output.text)),
          'banner shows MCP on, read-only, with the browser origin');

        const r = await post(port, init, { Origin: origin });
        assert(r.status === 200 && r.json?.result?.serverInfo?.name === 'docmd-mcp-server', 'POST /mcp initialize with the configured Origin is 200');
        assert((await post(port, init)).status === 200, 'POST /mcp without Origin is 200');
        assert((await post(port, init, { Origin: 'http://localhost:' + port })).status === 403, 'POST /mcp from an unlisted origin is 403');
        assert((await request(port, '/mcp', 'GET')).status === 405, 'GET /mcp is 405');
        assert((await request(port, '/')).status === 200, 'the site is still served next to /mcp');

        const tools = await post(port, toolsList);
        assert(JSON.stringify(tools.json?.result?.tools?.map((t) => t.name)) === JSON.stringify(TOOLS), 'tools/list over HTTP lists the six tools');

        // read_doc confinement still applies over HTTP.
        for (const route of ['.env', 'notes.md', '../serve-mcp-spawn/.env', 'docmd.config.json', 'site/index.html']) {
          const t = textOf(await post(port, call(10, 'read_doc', { route })));
          assert(/^Error:/.test(t) && !t.includes('hunter2') && !t.includes('PRIVATE NOTE'), `read_doc "${route}" over HTTP is refused`);
        }
        const abs = textOf(await post(port, call(11, 'read_doc', { route: safePath(dir, '.env') })));
        assert(/Absolute paths are not allowed/.test(abs), 'read_doc with an absolute path over HTTP is refused');
        assert(textOf(await post(port, call(12, 'read_doc', { route: 'docs/intro.md' }))).includes('# Intro content'), 'read_doc "docs/intro.md" over HTTP returns the file');
        const listed = textOf(await post(port, call(13, 'list_docs')));
        assert(listed.includes('docs/intro.md') && !listed.includes('notes.md'), 'list_docs over HTTP lists the source directory only');
        const searched = textOf(await post(port, call(14, 'search_docs', { query: 'welcome' })));
        assert(searched.includes('docs/index.md'), 'search_docs over HTTP finds a page');

        // get_llms_context is read-only: it returns the served file and never rebuilds.
        const llmsFile = safePath(dir, 'site/llms-full.txt');
        assert(fs.existsSync(llmsFile), 'the startup build wrote site/llms-full.txt');
        const indexFile = safePath(dir, 'site/index.html');
        const indexBefore = fs.statSync(indexFile).mtimeMs;
        fs.writeFileSync(llmsFile, 'SENTINEL-LLMS');
        const ctx = textOf(await post(port, call(15, 'get_llms_context')));
        assert(ctx === 'SENTINEL-LLMS', 'get_llms_context returns the served llms-full.txt as is (no rebuild overwrote it)');
        assert(fs.statSync(indexFile).mtimeMs === indexBefore, 'get_llms_context leaves the served site untouched');
        const res = await post(port, { jsonrpc: '2.0', id: 16, method: 'resources/read', params: { uri: 'docmd://context/llms.txt' } });
        assert(res.json?.result?.contents?.[0]?.text === 'SENTINEL-LLMS', 'resources/read llms.txt returns the served file');
      } finally {
        await stopServe(handle);
      }
    }

    // ── --config: the tools read the config serve was started with ──────
    {
      const port = await freePort();
      const dir = setup('serve-mcp-config');
      writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'Default', src: 'docs', out: 'site' }));
      writeFile(dir, 'other.config.json', JSON.stringify({
        title: 'Other', src: 'content', out: 'out', url: 'https://example.test',
        serve: { mcp: { enabled: true } },
      }));
      writeFile(dir, 'docs/default-only.md', '# Default only\n');
      writeFile(dir, 'content/index.md', '# Other home\n');
      writeFile(dir, 'content/guide.md', '# Other guide\n');
      const handle = spawnServe(dir, ['--port', String(port), '--config', 'other.config.json']);
      try {
        await waitForHealthz(port, handle);
        const listed = textOf(await post(port, call(1, 'list_docs')));
        assert(listed.includes('content/guide.md') && !listed.includes('default-only'), 'list_docs lists the --config source directory');
        const other = textOf(await post(port, call(2, 'read_doc', { route: 'docs/default-only.md' })));
        assert(/outside the documentation source directory/.test(other), 'read_doc of the default config source directory is refused');
        assert(textOf(await post(port, call(3, 'read_doc', { route: 'content/guide.md' }))).includes('# Other guide'), 'read_doc reads the --config source directory');
        assert(JSON.parse(textOf(await post(port, call(4, 'get_config'))) || '{}').title === 'Other', 'get_config reports the --config file');
      } finally {
        await stopServe(handle);
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
