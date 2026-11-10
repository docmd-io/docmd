/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Action dispatcher context (caller, mode, worker pool, rebuild,
 * written files) and `onServerReady` registration.
 *
 * Run: `node tests/runner.js --only=action-dispatcher`
 * --------------------------------------------------------------------
 */

import { setup, writeFile, runTestFile } from '../shared.js';
import { safePath } from '../../packages/utils/dist/path.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const apiDist = (f) =>
  pathToFileURL(path.resolve(import.meta.dirname, '../../packages/api/dist', f)).href;

export const test = runTestFile({
  name: 'Action dispatcher context + onServerReady',
  emoji: '🔌',
  run: async () => {
    const { createActionDispatcher } = await import(apiDist('rpc.js'));
    const { loadPlugins, hooks, getPluginErrors, TUI } = await import(apiDist('index.js'));

    const proj = setup('action-dispatcher');
    writeFile(proj, 'docs/a.md', 'Hello world\n');

    // Handlers record the ctx they receive.
    let seen;
    const rec = async (_p, ctx) => { seen = ctx; return 'ok'; };
    const actionHooks = {
      actions: {
        rec,
        write: async (_p, ctx) => { await ctx.writeFile('docs/w.md', 'x'); },
        srcWrite: async (_p, ctx) => {
          await ctx.source.replaceBlock('docs/a.md', [1, 1], 'Changed');
        },
        noop: async () => 1,
        worker: (_p, ctx) => ctx.runWorkerTask('m', 'f', [1]),
      },
      events: { rec: (_d, ctx) => { seen = ctx; } },
    };

    const tasks = [];
    const fakePool = { runTask: async (t) => { tasks.push(t); return 'pool-result'; } };
    const rebuilds = [];
    const base = { projectRoot: proj, config: {}, broadcast() {} };

    // runWorkerTask uses getWorkerPool()
    {
      const d = createActionDispatcher(actionHooks, { ...base, getWorkerPool: () => fakePool });
      const r = await d.handleCall('worker', {});
      assert(r.result === 'pool-result', 'runWorkerTask returns pool.runTask result');
      assert(JSON.stringify(tasks[0]) === JSON.stringify({ type: 'plugin-task', modulePath: 'm', functionName: 'f', args: [1] }),
        'pool received plugin-task payload');

      const d2 = createActionDispatcher(actionHooks, {
        ...base, config: { _workerPool: fakePool }, getWorkerPool: () => undefined,
      });
      let msg = '';
      try { await d2.handleCall('worker', {}); } catch (e) { msg = e.message; }
      assert(msg === 'WorkerPool is not initialized', 'undefined pool rejects; config._workerPool ignored');
    }

    // optional caller defaults to a local caller; mode
    {
      const d = createActionDispatcher(actionHooks, { ...base, mode: 'serve' });
      await d.handleCall('rec', {});
      assert(seen.caller.transport === 'local' && seen.caller.connectionId === 'local'
        && JSON.stringify(seen.caller.headers) === '{}', 'handleCall without caller gets local caller');
      assert(seen.mode === 'serve', 'ctx.mode mirrors options.mode');

      const caller = { transport: 'websocket', headers: { 'x-user': 'a' }, origin: 'https://e.com',
        remoteAddress: '1.2.3.4', connectionId: 'c1', connectedAt: 1 };
      await d.handleCall('rec', {}, caller);
      assert(seen.caller === caller, 'handleCall passes caller through');
      seen = undefined;
      d.handleEvent('rec', {}, caller);
      assert(seen.caller === caller && seen.mode === 'serve', 'handleEvent passes caller and mode');
      d.handleEvent('rec', {});
      assert(seen.caller.transport === 'local', 'handleEvent without caller gets local caller');
    }

    // requestRebuild forwards
    {
      const files = ['docs/a.md'];
      const rbHooks = { actions: { rb: (_p, ctx) => ctx.requestRebuild(files) }, events: {} };
      const d = createActionDispatcher(rbHooks,
        { ...base, requestRebuild: async (f) => { rebuilds.push(f); return 'sentinel'; } });
      const r = await d.handleCall('rb', {});
      assert(rebuilds.length === 1 && rebuilds[0] === files, 'requestRebuild forwards the same array');
      assert(r.result === 'sentinel', 'requestRebuild returns the host promise value');

      const dFail = createActionDispatcher(rbHooks,
        { ...base, requestRebuild: async () => { throw new Error('build failed'); } });
      let msg = '';
      try { await dFail.handleCall('rb', {}); } catch (e) { msg = e.message; }
      assert(msg === 'build failed', 'requestRebuild propagates host rejection');
    }

    // writtenFiles
    {
      const d = createActionDispatcher(actionHooks, base);
      const w = await d.handleCall('write', {});
      assert(w.reload === true && w.writtenFiles.length === 1 && w.writtenFiles[0] === path.join(proj, 'docs/w.md'),
        'ctx.writeFile path reported in writtenFiles');
      const s = await d.handleCall('srcWrite', {});
      assert(s.reload === true && s.writtenFiles.length === 1 && s.writtenFiles[0] === path.join(proj, 'docs/a.md')
        && fs.readFileSync(safePath(proj, 'docs/a.md'), 'utf8').includes('Changed'),
        'ctx.source write path reported in writtenFiles');
      const n = await d.handleCall('noop', {});
      assert(Array.isArray(n.writtenFiles) && n.writtenFiles.length === 0 && n.reload === false,
        'writtenFiles is [] when nothing written');
    }

    // system:ping
    {
      const d = createActionDispatcher({ actions: {}, events: {} }, base);
      const r = await d.handleCall('system:ping');
      assert(r.result.ok === true && typeof r.result.timestamp === 'number' && r.reload === false,
        'system:ping unchanged');
    }

    // onServerReady registration
    {
      const mk = (dir, caps, body, extra = '') => {
        writeFile(proj, `plugins/${dir}/package.json`, JSON.stringify({ name: dir, version: '1.0.0', type: 'module', main: 'index.js' }));
        writeFile(proj, `plugins/${dir}/index.js`, [
          `export const plugin = { name: '${dir}', version: '1.0.0', capabilities: ${JSON.stringify(caps)} };`,
          `export async function onServerReady(h) { ${body} }`, extra, '',
        ].join('\n'));
        return `./plugins/${dir}`;
      };
      const withCap = mk('srv-ok', ['server'], 'throw new Error("boom");');
      const noCap = mk('srv-nocap', ['actions'], '',
        "export const actions = { 'nocap:ping': async () => 1 };");
      // Local plugin paths resolve against cwd.
      const cwd = process.cwd();
      process.chdir(proj);
      try {
        const run = (p) => loadPlugins({ title: 't', src: './docs', plugins: { [p]: {} } },
          { resolvePaths: [proj] });

        await run(withCap);
        assert(hooks.onServerReady.length === 1, 'onServerReady registered with server capability');
        let thrown = '';
        try { await hooks.onServerReady[0]({}); } catch (e) { thrown = e.message; }
        assert(thrown === 'boom', 'throwing onServerReady rejects to the host');
        assert(getPluginErrors().some((e) => e.hook === 'onServerReady'), 'throw also recorded in plugin errors');

        const warns = [];
        const origWarn = TUI.warn;
        TUI.warn = (...a) => { warns.push(a.join(' ')); };
        try { await run(noCap); } finally { TUI.warn = origWarn; }
        assert(hooks.onServerReady.length === 0, 'onServerReady skipped without server capability');
        assert(typeof hooks.actions['nocap:ping'] === 'function', 'skipped plugin itself still loaded');
        assert(warns.some((w) => /exports onServerReady but didn't declare "server" capability/.test(w)),
          'skip warns with the capability warning');
      } finally {
        process.chdir(cwd);
      }
    }

  },
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
