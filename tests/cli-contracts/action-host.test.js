/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Shared WebSocket action host: caller headers, origin allowlist,
 * coalescing rebuilds, `system:rebuilt`, `onServerReady`, shutdown.
 * Two in-process hosts (dev + serve) on port-0 servers, driven by the
 * fixture plugin in `fixtures/serve-plugin`.
 *
 * Run: `node tests/runner.js --only=action-host`
 * --------------------------------------------------------------------
 */

import http from 'node:http';
import { setImmediate } from 'node:timers';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setup, writeFile, runTestFile } from '../shared.js';
import { safePath } from '../../packages/utils/dist/path.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WebSocket = createRequire(path.join(ROOT, 'packages/core/package.json'))('ws');
const coreDist = (f) => pathToFileURL(path.join(ROOT, 'packages/core/dist', f)).href;
const apiDist = (f) => pathToFileURL(path.join(ROOT, 'packages/api/dist', f)).href;

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Fake `opts.rebuild`: every call is parked until the test settles it. */
function parkedRebuild() {
  const calls = [];
  const fn = (files) => {
    const d = deferred();
    calls.push({ files, ...d });
    return d.promise;
  };
  return { fn, calls };
}

/** Fake `opts.rebuild` that succeeds at once. */
function instantRebuild() {
  const calls = [];
  return { fn: async (files) => { calls.push({ files }); }, calls };
}

/** `ws` client that records every frame and resolves calls by id. */
function connect(port, { headers = {}, origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers, origin: origin ?? `http://127.0.0.1:${port}` });
  const frames = [];
  const waiters = [];
  let nextId = 1;
  const opened = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const closed = new Promise((resolve) => ws.once('close', resolve));
  ws.on('message', (raw) => {
    const text = raw.toString();
    let json = null;
    try { json = JSON.parse(text); } catch { /* bare frame such as `reload` */ }
    const frame = { text, json };
    frames.push(frame);
    for (const w of [...waiters]) if (w.pred(frame)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frame); }
  });
  const waitFor = (pred) => {
    const hit = frames.find(pred);
    if (hit) return Promise.resolve(hit);
    const d = deferred();
    waiters.push({ pred, resolve: d.resolve });
    return d.promise.then(() => frames.find(pred));
  };
  const call = async (action, payload) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, type: 'call', action, payload }));
    const frame = await waitFor((f) => f.json && f.json.id === id);
    if (frame.json.error) throw new Error(frame.json.error);
    return frame.json.result;
  };
  return { ws, frames, opened, closed, waitFor, call };
}

const isRebuilt = (f) => f.json && f.json.type === 'event' && f.json.name === 'system:rebuilt';

export const test = runTestFile({
  name: 'Action host: caller, origin allowlist, rebuild, onServerReady, close',
  emoji: '🛰️',
  run: async () => {
    const { createActionHost, buildCaller } = await import(coreDist('server/action-host.js'));
    const { createOriginVerify, createOriginAllowlist } = await import(coreDist('utils/ws-origin-guard.js'));
    const { loadPlugins, hooks, TUI } = await import(apiDist('index.js'));

    // ── allowlist rule ────────────────────────────
    {
      const guard = createOriginAllowlist(['http://127.0.0.1:4100', 'https://Docs.Example.com']);
      const verdict = (origin) => new Promise((resolve) => {
        guard({ origin: origin ?? undefined, req: { headers: {} }, secure: false }, (allowed, code, message) => resolve({ allowed, code, message }));
      });
      for (const o of ['http://127.0.0.1:4100', 'https://docs.example.com']) {
        assert((await verdict(o)).allowed === true, `allowlist accepts ${o}`);
      }
      for (const o of ['http://127.0.0.1:4101', 'https://docs.example.com:444', 'http://evil.example', 'null', 'not a url']) {
        assert((await verdict(o)).allowed === false, `allowlist rejects ${o}`);
      }
      const missing = await verdict(null);
      assert(!missing.allowed && missing.code === 403 && missing.message === 'Origin header required', 'allowlist rejects a missing Origin with 403 "Origin header required"');
      for (const bad of [['*'], ['not a url']]) {
        let threw = false;
        try { createOriginAllowlist(bad); } catch { threw = true; }
        assert(threw, `createOriginAllowlist(${JSON.stringify(bad)}) throws`);
      }
    }

    // ── Project with the fixture plugin ──────────────────
    const proj = setup('action-host');
    writeFile(proj, 'docs/index.md', '# Hi\n');
    const fixtureDir = safePath(import.meta.dirname, 'fixtures/serve-plugin');
    for (const f of fs.readdirSync(fixtureDir)) {
      writeFile(proj, `plugins/serve-plugin/${f}`, fs.readFileSync(safePath(fixtureDir, f), 'utf8'));
    }
    const config = { title: 'Host', src: './docs', out: './site', plugins: { './plugins/serve-plugin': {} } };
    // Local plugin paths resolve against the process cwd.
    const cwd = process.cwd();
    process.chdir(proj);
    try { await loadPlugins(config, { isDev: true }); } finally { process.chdir(cwd); }

    // Recorders sit in front of the plugin's own hooks.
    const seen = { devReady: [], ready: [], connections: 0 };
    hooks.onDevServerReady.unshift(async (_server, wss) => {
      seen.devReady.push(wss);
      wss.on('connection', () => { seen.connections++; });
    });
    hooks.onDevServerReady.push(async () => { throw new Error('fixture onDevServerReady failed'); });
    hooks.onServerReady.unshift(async (handle) => { seen.ready.push(handle.mode); });

    const errors = [];
    const realError = TUI.error;
    TUI.error = (...a) => { errors.push(a.join(' ')); };

    const devServer = http.createServer();
    const serveServer = http.createServer();
    const devPort = await listen(devServer);
    const servePort = await listen(serveServer);
    const devBuild = parkedRebuild();
    const serveBuild = instantRebuild();
    let shutdowns = 0;
    globalThis.__serveFixtureShutdown = () => { shutdowns++; };

    let dev;
    let serve;
    try {
      // ── slow + throwing onServerReady ─
      const gate = deferred();
      globalThis.__serveFixtureGate = gate.promise;
      globalThis.__serveFixtureThrow = true;
      const upgraded = deferred();
      devServer.once('upgrade', () => upgraded.resolve());
      const devOpts = {
        server: devServer, mode: 'dev', projectRoot: proj, config,
        verifyClient: createOriginVerify(), getWorkerPool: () => undefined,
        rebuild: devBuild.fn, loadPlugins: false,
      };
      const devCreation = createActionHost(devOpts);
      const early = connect(devPort, { headers: { 'x-test-identity': 'early' } });
      let earlyOpen = false;
      early.opened.then(() => { earlyOpen = true; }).catch(() => {});
      await upgraded.promise;
      await tick();
      assert(!earlyOpen && seen.connections === 0, 'a client connecting during a slow onServerReady is not accepted yet');
      gate.resolve();
      dev = await devCreation;
      delete globalThis.__serveFixtureGate;
      globalThis.__serveFixtureThrow = false;
      await early.opened;
      assert(earlyOpen && (await early.call('test:whoami')).identity === 'early', 'the early client is served once onServerReady resolved');
      assert(errors.some((e) => /fixture onServerReady failed/.test(e)), 'in dev a throwing onServerReady is logged and the host still accepts connections');
      assert(errors.some((e) => /fixture onDevServerReady failed/.test(e)), 'in dev a throwing onDevServerReady is logged and the host keeps serving');
      assert(seen.ready[0] === 'dev' && dev.handle.mode === 'dev', 'onServerReady receives a handle whose mode equals opts.mode (dev)');
      assert(dev.handle.rebuild === dev.rebuild, 'handle.rebuild is host.rebuild');
      assert(seen.devReady.length === 1 && seen.devReady[0] === dev.wss, 'onDevServerReady runs in dev with the host wss');
      early.ws.close();

      // ── caller headers (dev) ──────────────────────
      const alice = connect(devPort, {
        headers: { 'x-test-identity': 'alice', 'X-Multi': ['a', 'b'], cookie: 's=1' },
        origin: `http://127.0.0.1:${devPort}`,
      });
      await alice.opened;
      const who = await alice.call('test:whoami');
      assert(
        who.identity === 'alice' && who.mode === 'dev' && who.origin === `http://127.0.0.1:${devPort}` && Object.keys(who).length === 3,
        'test:whoami returns { identity, mode, origin }'
      );
      const dump = await alice.call('test:whoami', { dump: true });
      const names = Object.keys(dump.headers);
      assert(names.every((n) => n === n.toLowerCase()) && names.includes('x-test-identity'), 'caller header names are lower-case');
      assert(dump.headers['x-multi'] === 'a, b', 'a multi-value header is joined with ", "');
      assert(!names.includes('cookie') && !names.includes('set-cookie'), 'cookie and set-cookie never reach the caller');
      assert(dump.transport === 'websocket', 'caller.transport is "websocket"');
      const dump2 = await alice.call('test:whoami', { dump: true });
      const bob = connect(devPort);
      await bob.opened;
      const bobDump = await bob.call('test:whoami', { dump: true });
      assert(typeof dump.connectionId === 'string' && dump.connectionId.length > 0 && dump.connectionId === dump2.connectionId, 'connectionId is stable across calls on one socket');
      assert(bobDump.connectionId !== dump.connectionId, 'connectionId differs between sockets');
      bob.ws.close();

      // ── coalescing ────────────────────────────────
      const abs = (f) => path.join(proj, f);
      {
        const files = Array.from({ length: 10 }, (_, i) => `docs/f${i}.md`);
        const all = Promise.all(files.map((f) => dev.rebuild([f])));
        assert(devBuild.calls.length === 1, 'the first rebuild starts at once');
        devBuild.calls[0].resolve();
        await tick();
        assert(devBuild.calls.length === 2, 'overlapping requests coalesce into one follow-up build');
        const follow = devBuild.calls[1].files;
        assert(
          JSON.stringify([...follow].sort()) === JSON.stringify(files.slice(1).map(abs).sort()),
          'the follow-up contains every file the first build did not cover'
        );
        await alice.call('system:ping'); // the first build's frame has arrived
        const rebuiltBefore = alice.frames.filter(isRebuilt).length;
        devBuild.calls[1].resolve();
        await all;
        await alice.call('system:ping');
        const newRebuilt = alice.frames.filter(isRebuilt).slice(rebuiltBefore);
        assert(
          newRebuilt.length === 1 && JSON.stringify([...newRebuilt[0].json.data.files].sort()) === JSON.stringify(files.slice(1).sort()),
          'the follow-up build broadcasts system:rebuilt with its nine project-relative paths'
        );
      }
      {
        const before = devBuild.calls.length;
        const rebuiltBefore = alice.frames.filter(isRebuilt).length;
        const a = dev.rebuild(['docs/a.md']);
        const b = dev.rebuild(['docs/b.md']);
        const c = dev.rebuild();
        devBuild.calls[before].resolve();
        await tick();
        assert(devBuild.calls.length === before + 2 && devBuild.calls[before + 1].files === undefined, 'a full rebuild subsumes the pending set');
        devBuild.calls[before + 1].resolve();
        await Promise.all([a, b, c]);
        await alice.call('system:ping'); // frames arrive in order
        const fullFrames = alice.frames.filter(isRebuilt).slice(rebuiltBefore);
        const last = fullFrames[fullFrames.length - 1];
        assert(last && last.json.data.files === null, 'a full rebuild broadcasts system:rebuilt { files: null }');
      }
      {
        const before = devBuild.calls.length;
        const failing = dev.rebuild(['docs/x.md']);
        devBuild.calls[before].reject(new Error('boom'));
        let msg = null;
        try { await failing; } catch (e) { msg = e.message; }
        assert(msg === 'boom', 'a rejected build rejects its callers');
        const next = dev.rebuild(['docs/y.md']);
        assert(devBuild.calls.length === before + 2, 'the next request after a failure starts a fresh build');
        devBuild.calls[before + 1].resolve();
        await next;
      }

      // ── no automatic rebuild, reload frame ──
      {
        const before = devBuild.calls.length;
        await alice.call('test:write', { file: 'docs/dev-written.md', content: 'x\n' });
        await tick();
        assert(devBuild.calls.length === before, 'in dev a call that writes files triggers no automatic rebuild');
        dev.broadcastReload();
        await alice.call('system:ping');
        assert(alice.frames.some((f) => f.text === 'reload'), 'broadcastReload sends the text frame "reload" in dev');
      }

      // ── identity header: own headers only ─
      {
        const req = (headers) => ({ headers, socket: { remoteAddress: '127.0.0.1' } });
        for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
          assert(buildCaller(req({}), name).identity === null, `an identityHeader named ${name} without that header gives no identity`);
        }
        assert(buildCaller(req({ constructor: 'dana' }), 'constructor').identity === 'dana', 'an identityHeader named constructor reads the request header of that name');
        assert(buildCaller(req({ 'x-user': '' }), 'x-user').identity === null, 'an empty identity header gives no identity');
      }

      // ── throw rejects, then a working host ─
      globalThis.__serveFixtureThrow = true;
      const serveOpts = {
        server: serveServer, mode: 'serve', projectRoot: proj, config,
        verifyClient: createOriginAllowlist([`http://127.0.0.1:${servePort}`]),
        identityHeader: 'X-Test-Identity',
        getWorkerPool: () => undefined, rebuild: serveBuild.fn, loadPlugins: false,
      };
      let serveErr = null;
      const shutdownsBeforeReject = shutdowns;
      try { await createActionHost(serveOpts); } catch (e) { serveErr = e; }
      assert(shutdowns === shutdownsBeforeReject + 1, 'a rejected createActionHost runs the onShutdown callbacks plugins already registered');
      assert(serveErr && /fixture onServerReady failed/.test(serveErr.message), 'in serve a throwing onServerReady rejects createActionHost');
      globalThis.__serveFixtureThrow = false;
      serve = await createActionHost(serveOpts);
      assert(seen.ready[seen.ready.length - 1] === 'serve' && serve.handle.mode === 'serve', 'onServerReady receives mode "serve" in serve');
      assert(seen.devReady.length === 1, 'onDevServerReady is never called in serve');

      // ── auto-rebuild, system:rebuilt, no reload ─
      {
        const client = connect(servePort, { headers: { 'x-test-identity': 'carol' } });
        await client.opened;
        await client.call('test:write', { file: 'docs/written.md', content: 'hello\n' });
        const rebuilt = await client.waitFor(isRebuilt);
        assert(serveBuild.calls.length === 1 && serveBuild.calls[0].files.length === 1 && serveBuild.calls[0].files[0] === abs('docs/written.md'), 'in serve a call with writtenFiles triggers host.rebuild(writtenFiles)');
        assert(JSON.stringify(rebuilt.json.data) === JSON.stringify({ files: ['docs/written.md'] }), 'system:rebuilt carries project-relative files');
        await client.call('test:rebuild', { files: ['docs/other.md'] });
        assert(serveBuild.calls.length === 2 && serveBuild.calls[1].files[0] === abs('docs/other.md'), 'ctx.requestRebuild reaches opts.rebuild');
        await client.call('test:handle-rebuild');
        assert(serveBuild.calls.length === 3, 'handle.rebuild reaches opts.rebuild');
        serve.broadcastReload();
        await client.call('system:ping'); // frames arrive in order: a reload frame would precede this reply
        assert(!client.frames.some((f) => f.text === 'reload'), 'serve mode never sends the reload frame');
        client.ws.close();
      }

      // ── Cleanup: close() ─────────────────────────────────
      await serve.close();
      const sawClose = alice.closed;
      const shutdownsBefore = shutdowns;
      await dev.close();
      await sawClose;
      assert(dev.wss.clients.size === 0 && alice.ws.readyState === WebSocket.CLOSED, 'close() closes open sockets (bounded by the runner timeout)');
      assert(shutdowns === shutdownsBefore + 1, 'close() runs onShutdown callbacks');
    } finally {
      TUI.error = realError;
      await loadPlugins({ plugins: {} }, { isDev: true }); // reset the shared hooks
      delete globalThis.__serveFixtureGate;
      delete globalThis.__serveFixtureThrow;
      delete globalThis.__serveFixtureShutdown;
      devServer.close();
      serveServer.close();
      devServer.closeAllConnections?.();
      serveServer.closeAllConnections?.();
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
