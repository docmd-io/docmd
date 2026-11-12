/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Plugin actions under `docmd serve`: the `serve.actions` config, the
 * write guard (writes need a trusted identity), and two real `docmd serve`
 * spawns calling the serve-plugin fixture: one with an identity header
 * configured, one without.
 *
 * Run: `node tests/runner.js --only=serve-actions`
 * --------------------------------------------------------------------
 */

import { setup, writeFile, runTestFile, DOCMD } from '../shared.js';
import { freePort, canConnect, request, spawnServe, waitForHealthz, exitWithin, copyServePlugin } from '../_lib/serve-harness.js';
import { normalizeServeConfig, validateServeConfig } from '../../packages/core/dist/server/serve-config.js';
import { actionsBanner } from '../../packages/core/dist/commands/serve.js';
import { createActionDispatcher } from '../../packages/api/dist/index.js';
import { safePath } from '../../packages/utils/dist/path.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';

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

/** Status of a WebSocket upgrade: 'open' or the HTTP status that refused it. */
function upgradeStatus(port, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, origin ? { origin } : {});
    ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('error', () => resolve('error'));
  });
}

/** Connected client that records frames and resolves `call`s by id. */
function connect(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { origin: `http://127.0.0.1:${port}`, headers });
  const frames = [];
  const waiters = [];
  let nextId = 1;
  const opened = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const closed = new Promise((resolve) => ws.once('close', resolve));
  ws.on('message', (raw) => {
    const text = raw.toString();
    let json = null;
    try { json = JSON.parse(text); } catch { /* bare text frame */ }
    const frame = { text, json };
    frames.push(frame);
    for (const w of [...waiters]) if (w.pred(frame)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frame); }
  });
  const waitFor = (pred, timeoutMs = 10000) => {
    const hit = frames.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const waiter = { pred, resolve: (frame) => { clearTimeout(timer); resolve(frame); } };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error('waitFor timed out'));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };
  /** Resolves `{ result }` or `{ error }`; never throws for an action error. */
  const call = async (action, payload) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, type: 'call', action, payload }));
    const frame = await waitFor((f) => f.json && f.json.id === id);
    return frame.json.error ? { error: frame.json.error } : { result: frame.json.result };
  };
  return { ws, frames, opened, closed, call, waitFor };
}

const isRebuilt = (f) => f.json && f.json.type === 'event' && f.json.name === 'system:rebuilt';

/** Poll a URL until `pred(response)` holds or the deadline passes; null on timeout. */
async function pollPage(port, urlPath, pred, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(port, urlPath).catch(() => null);
    if (res && pred(res)) return res;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** A project with the fixture plugin, threads (a live-server plugin) and actions on. */
function actionsProject(name, origin, actions) {
  const dir = setup(name);
  writeFile(dir, 'docs/index.md', '# Home\n');
  writeFile(dir, 'docs/other.md', '# Other\n\nfirst version\n');
  copyServePlugin(dir);
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Actions',
    src: './docs',
    out: './site',
    plugins: { threads: {}, './plugins/serve-plugin': {} },
    serve: { actions: { enabled: true, origins: [origin], ...actions } },
  }, null, 2) + '\n');
  return dir;
}

const readDoc = (dir, rel) => fs.readFileSync(safePath(dir, rel), 'utf8');

export const test = runTestFile({
  name: 'Serve actions: config, origin allowlist, trusted identity for writes',
  emoji: '🛰️',
  run: async () => {
    // ── serve.actions config ────────────────────────────
    {
      const d = normalizeServeConfig(undefined).actions;
      assert(d.enabled === false && d.origins.length === 0 && d.identityHeader === null, 'actions are off by default, with no origins and no identity header');
      for (const bad of [null, 'x', 42, [], { actions: 'on' }, { actions: { enabled: 'true', origins: 'x', identityHeader: 7 } }]) {
        const n = normalizeServeConfig(bad).actions;
        assert(n.enabled === false && n.origins.length === 0 && n.identityHeader === null, `normalizeServeConfig(${JSON.stringify(bad)}) does not throw and keeps actions off`);
      }
      const n = normalizeServeConfig({ actions: { enabled: true, origins: ['https://docs.example.com', 42], identityHeader: '  X-Auth-Request-Email ' } }).actions;
      assert(n.enabled === true && n.origins[0] === 'https://docs.example.com' && n.origins[1] === '42', 'enabled: true turns actions on; origins are kept as strings');
      assert(n.identityHeader === 'x-auth-request-email', 'identityHeader is trimmed and lower-cased');
      assert(normalizeServeConfig({ actions: { identityHeader: '   ' } }).actions.identityHeader === null, 'a blank identityHeader means none');

      const errorsFor = (actions) => validateServeConfig(normalizeServeConfig({ actions }));
      assert(errorsFor(undefined).length === 0, 'the default serve block is valid');
      assert(errorsFor({ enabled: true, origins: ['https://docs.example.com'], identityHeader: 'x-user' }).length === 0, 'a full actions block is valid');
      assert(errorsFor({ enabled: true, origins: ['http://127.0.0.1:4100'] }).length === 0, 'actions without identityHeader are valid (writes are refused)');
      assert(errorsFor({ enabled: true }).some((e) => e.includes('at least one origin')), 'enabled without origins is an error');
      for (const o of ['*', 'docs.example.com', 'ftp://docs.example.com', 'null']) {
        assert(errorsFor({ enabled: true, origins: [o] }).some((e) => e.includes(`"${o}"`)), `origin ${JSON.stringify(o)} is an error`);
      }
      for (const h of ['cookie', 'Set-Cookie', 'x user', 'x-user:']) {
        assert(errorsFor({ enabled: true, origins: ['https://a.example'], identityHeader: h }).some((e) => e.includes('identityHeader')), `identityHeader ${JSON.stringify(h)} is an error`);
      }

      assert(actionsBanner(normalizeServeConfig(undefined).actions) === 'off', 'banner: off by default');
      assert(actionsBanner(n) === 'on (origins: https://docs.example.com, 42; writes need x-auth-request-email)', 'banner: on, origins and the identity header');
      assert(/writes refused/.test(actionsBanner(normalizeServeConfig({ actions: { enabled: true, origins: ['https://a.example'] } }).actions)), 'banner: says writes are refused without identityHeader');
    }

    // ── Write guard in the dispatcher ───────────────────
    {
      const proj = setup('serve-actions-guard');
      writeFile(proj, 'docs/a.md', 'original\n');
      const actions = {
        write: async (_p, ctx) => { await ctx.writeFile('docs/a.md', 'changed\n'); return 'ok'; },
        insert: async (_p, ctx) => { await ctx.source.insertAfter('docs/a.md', 1, 'added'); return 'ok'; },
        read: async (_p, ctx) => ctx.readFile('docs/a.md'),
      };
      const caller = (identity) => ({
        transport: 'websocket', headers: {}, origin: 'https://a.example', remoteAddress: null,
        connectionId: 'c', connectedAt: 0, identity,
      });
      const dispatcher = (mode, identityHeader) => createActionDispatcher({ actions, events: {} }, {
        projectRoot: proj, config: {}, broadcast: () => {}, mode, identityHeader,
      });
      const outcome = async (d, action, c) => {
        try { return { result: await d.handleCall(action, null, c) }; } catch (e) { return { error: e.message }; }
      };

      const noSource = dispatcher('serve', null);
      for (const action of ['write', 'insert']) {
        const r = await outcome(noSource, action, caller('alice'));
        assert(r.error && r.error.includes('no trusted identity source is configured'), `serve without identityHeader refuses ctx ${action === 'write' ? 'writeFile' : 'source'} writes`);
      }
      assert(readDoc(proj, 'docs/a.md') === 'original\n', 'a refused write leaves the file untouched');
      const read = await outcome(noSource, 'read', caller(null));
      assert(read.result && read.result.result === 'original\n', 'reads work under serve without any identity');

      const withSource = dispatcher('serve', 'x-user');
      for (const action of ['write', 'insert']) {
        const r = await outcome(withSource, action, caller(null));
        assert(r.error && r.error.includes('missing x-user header'), `serve refuses ${action === 'write' ? 'a writeFile' : 'a source edit'} from a caller without identity`);
      }
      const local = await outcome(withSource, 'write', undefined);
      assert(local.error && local.error.includes('missing x-user header'), 'serve refuses a write from the local caller (no identity)');
      assert(readDoc(proj, 'docs/a.md') === 'original\n', 'the file is still untouched');
      const ok = await outcome(withSource, 'write', caller('alice'));
      assert(ok.result && ok.result.writtenFiles.length === 1 && readDoc(proj, 'docs/a.md') === 'changed\n', 'serve allows a write from a caller with a trusted identity');
      const okInsert = await outcome(withSource, 'insert', caller('alice'));
      assert(okInsert.result && readDoc(proj, 'docs/a.md').includes('added'), 'serve allows a source edit from a caller with a trusted identity');

      writeFile(proj, 'docs/a.md', 'original\n');
      const dev = await outcome(dispatcher('dev', null), 'write', caller(null));
      assert(dev.result && readDoc(proj, 'docs/a.md') === 'changed\n', 'dev writes without an identity, as before');
    }

    // ── Spawn: actions on, identity header configured ───
    {
      const port = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      const dir = actionsProject('serve-actions', origin, { identityHeader: 'X-User' });
      const handle = spawnServe(dir, ['--port', String(port)]);
      try {
        await waitForHealthz(port, handle);

        const home = await request(port, '/');
        const body = home.body.slice(home.body.indexOf('<body'));
        assert(body.includes('assets/js/docmd-api.js'), 'the served HTML loads docmd-api.js from <body>');
        assert(home.body.includes('assets/js/threads.js') && home.body.includes('assets/css/threads.css'), 'the served HTML keeps the assets of a live-server plugin');
        for (const asset of ['assets/js/docmd-api.js', 'assets/js/threads.js', 'assets/css/threads.css']) {
          assert((await request(port, `/${asset}`)).status === 200, `/${asset} is served 200`);
        }
        assert(/Actions\s+on \(origins: http:\/\/127\.0\.0\.1:\d+; writes need x-user\)/.test(handle.output.text), 'banner shows actions on, the origin and the identity header');

        assert((await upgradeStatus(port, origin)) === 'open', 'an allowed origin upgrades');
        assert((await upgradeStatus(port, 'http://evil.example')) === 403, 'a foreign origin gets 403');
        assert((await upgradeStatus(port, `http://127.0.0.1:${port + 1}`)) === 403, 'the same host on another port gets 403');
        assert((await upgradeStatus(port, null)) === 403, 'a missing Origin gets 403');

        const alice = connect(port, { 'x-user': 'alice@example.com', cookie: 's=1' });
        const anon = connect(port);
        const blank = connect(port, { 'x-user': '   ' });
        await Promise.all([alice.opened, anon.opened, blank.opened]);

        const who = (await alice.call('test:whoami')).result;
        assert(who && who.mode === 'serve' && who.origin === origin, 'ctx.mode is "serve" and ctx.caller.origin is the allowed origin');
        const dump = (await alice.call('test:whoami', { dump: true })).result;
        assert(dump.trustedIdentity === 'alice@example.com' && dump.transport === 'websocket', 'ctx.caller.identity is the identity header value');
        assert(dump.headers['x-user'] === 'alice@example.com' && !('cookie' in dump.headers), 'caller headers carry the identity header and no cookie');
        assert((await anon.call('test:whoami', { dump: true })).result.trustedIdentity === null, 'ctx.caller.identity is null without the header');
        assert((await alice.call('test:worker', { n: 7 })).result === 49, 'ctx.runWorkerTask runs on the serve worker pool');

        const refused = await anon.call('test:write', { file: 'docs/other.md', content: '# Other\n\nanon\n' });
        assert(refused.error && refused.error.includes('missing x-user header'), 'a write without the identity header is refused');
        const refusedBlank = await blank.call('test:write', { file: 'docs/other.md', content: '# Other\n\nblank\n' });
        assert(refusedBlank.error && refusedBlank.error.includes('missing x-user header'), 'a write with a blank identity header is refused');
        assert(readDoc(dir, 'docs/other.md') === '# Other\n\nfirst version\n', 'refused writes leave the source untouched');

        const wrote = await alice.call('test:write', { file: 'docs/other.md', content: '# Other\n\nsecond version\n' });
        assert(wrote.result && wrote.result.written === 'docs/other.md', 'a write with the identity header is allowed');
        const rebuilt = await alice.waitFor(isRebuilt).catch(() => null);
        assert(rebuilt !== null && rebuilt.json.data.files.includes('docs/other.md'), 'the write is rebuilt and announced with system:rebuilt');
        assert(await pollPage(port, '/other/', (r) => r.status === 200 && r.body.includes('second version')) !== null, 'the served page shows the written content');

        fs.writeFileSync(safePath(dir, 'docs/other.md'), '# Other\n\nthird version\n');
        const viaHandle = await anon.call('test:handle-rebuild', { files: ['docs/other.md'] });
        assert(viaHandle.result && viaHandle.result.mode === 'serve', 'handle.rebuild needs no identity (it writes nothing)');
        assert(await pollPage(port, '/other/', (r) => r.body.includes('third version')) !== null, 'handle.rebuild publishes an out-of-band edit');
        assert(!alice.frames.some((f) => f.text === 'reload'), 'serve never sends the dev reload frame');

        const closedInTime = Promise.race([alice.closed.then(() => true), new Promise((res) => setTimeout(() => res(false), 5000))]);
        handle.child.kill('SIGTERM');
        const r = await exitWithin(handle, 5000);
        assert(await closedInTime, 'SIGTERM closes open action sockets');
        assert(r.code === 0 && !r.timedOut, 'SIGTERM exits 0 within 5 s');
        assert(!(await canConnect('127.0.0.1', port)), 'the port refuses connections after SIGTERM');
      } finally {
        if (handle.child.exitCode === null) { handle.child.kill('SIGKILL'); await handle.exited; }
      }
    }

    // ── Spawn: actions on, no identity source ───────────
    {
      const port = await freePort();
      const dir = actionsProject('serve-actions-no-identity', `http://127.0.0.1:${port}`, {});
      const handle = spawnServe(dir, ['--port', String(port)]);
      try {
        await waitForHealthz(port, handle);
        assert(/Actions\s+on \(origins: [^)]*; writes refused \(no identityHeader\)\)/.test(handle.output.text), 'banner says writes are refused');
        const client = connect(port, { 'x-user': 'alice@example.com' });
        await client.opened;
        const dump = (await client.call('test:whoami', { dump: true })).result;
        assert(dump.trustedIdentity === null && dump.headers['x-user'] === 'alice@example.com', 'without identityHeader no header becomes ctx.caller.identity');
        const refused = await client.call('test:write', { file: 'docs/other.md', content: 'x\n' });
        assert(refused.error && refused.error.includes('no trusted identity source is configured'), 'every write is refused without an identity source');
        assert(readDoc(dir, 'docs/other.md') === '# Other\n\nfirst version\n', 'the source is untouched');
        client.ws.close();
      } finally {
        handle.child.kill('SIGTERM');
        const r = await exitWithin(handle, 5000);
        assert(r.code === 0, 'serve without an identity source stops cleanly');
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
