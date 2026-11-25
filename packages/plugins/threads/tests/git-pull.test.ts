import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safePath } from '@docmd/utils';
import type { ActionContext, ServerHandle } from '@docmd/api';
import { makeCtx } from './helpers.ts';
import { makeRepoTrio, commitOn, removeOn, git, BRANCH, type RepoTrio } from './helpers-git.ts';
import { actions } from '../src/plugin/actions.ts';
import { createLock, lockFor } from '../src/plugin/lock.ts';
import { pullOnce, startPullLoop, type ExecFile } from '../src/plugin/git-sync.ts';
import { docsRootOf } from '../src/plugin/reviews.ts';
import { onServerReady } from '../src/index.ts';

const realExec = promisify(nodeExecFile) as unknown as ExecFile;
const ANCHOR = { quote: 'Official Documentation', prefix: null, suffix: null, selector: null, offset: null, blockText: null };
const GIT = { branch: BRANCH, committer: { name: 'Threads Bot', email: 'bot@fixture.invalid' } };

let trio: RepoTrio;
const saved = { token: process.env.DOCMD_THREADS_GIT_TOKEN, global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
before(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  process.env.DOCMD_THREADS_GIT_TOKEN = 'token-for-tests';
  trio = makeRepoTrio();
});
after(() => {
  trio.cleanup();
  restore('GIT_CONFIG_GLOBAL', saved.global);
  restore('GIT_CONFIG_SYSTEM', saved.system);
  restore('DOCMD_THREADS_GIT_TOKEN', saved.token);
});
beforeEach(() => trio.reset());

type Rebuild = (files?: string[]) => Promise<void>;
/** A serve (or dev) handle for `root`; `rebuild` records what the host is asked to rebuild. */
function handleFor(root: string, rebuild: Rebuild, extra: { mode?: 'serve' | 'dev'; git?: unknown; shutdown?: Array<() => void | Promise<void>> } = {}): ServerHandle {
  const threads = extra.git === undefined ? { git: GIT } : extra.git ? { git: extra.git } : {};
  return {
    mode: extra.mode ?? 'serve',
    projectRoot: root,
    config: { src: 'docs', plugins: { threads } },
    rebuild,
    broadcast: () => assert.fail('threads never broadcasts'),
    onShutdown: (fn) => void extra.shutdown?.push(fn),
  } as unknown as ServerHandle;
}
const recorder = () => {
  const calls: Array<string[] | undefined> = [];
  const rebuild: Rebuild = async (files) => void calls.push(files);
  return { calls, rebuild };
};
const serverHandle = (rebuild: Rebuild) => handleFor(trio.server, rebuild);
const head = (dir: string, ref = 'HEAD') => git(dir, 'rev-parse', ref).trim();

/** Canned git for the small cases: HEAD and origin differ (or not), the diff is `diff`. */
const canned = (moved: boolean, diff: string, log: string[] = []): ExecFile => async (_f, args) => {
  const verb = args.find((a) => ['fetch', 'rev-parse', 'diff-tree', 'reset'].includes(a)) ?? args[0];
  log.push(verb);
  if (verb === 'rev-parse') return { stdout: args.includes('HEAD') && moved ? 'aaa\n' : 'bbb\n', stderr: '' };
  if (verb === 'diff-tree') return { stdout: diff, stderr: '' };
  return { stdout: '', stderr: '' };
};

// ---------------------------------------------------------------------------
// medium: a real bare remote and two clones
// ---------------------------------------------------------------------------

test('a page edit on the remote resets the checkout and rebuilds that page only; the journal survives', async () => {
  const journal = safePath(trio.server, 'docs/.threads/drafts/ann.json');
  fs.mkdirSync(safePath(trio.server, 'docs/.threads/drafts'), { recursive: true });
  fs.writeFileSync(journal, '{"threads":[{"body":"mine"}]}\n');
  const before = fs.readFileSync(journal);
  commitOn(trio.other, 'docs/index.md', 'edited elsewhere');
  const { calls, rebuild } = recorder();

  await pullOnce(serverHandle(rebuild));

  assert.equal(head(trio.server), head(trio.remote, BRANCH));
  assert.match(fs.readFileSync(safePath(trio.server, 'docs/index.md'), 'utf8'), /edited elsewhere/);
  assert.deepEqual(calls, [['docs/index.md']]);
  assert.deepEqual(fs.readFileSync(journal), before, 'the journal is byte-identical');
});

test('a page with a non-ASCII name is rebuilt on its own, whatever the git colour settings', async () => {
  const name = 'docs/guía-ñ.md';
  fs.writeFileSync(safePath(trio.other, name), '# g\n');
  git(trio.other, 'add', '-A'); git(trio.other, 'commit', '-m', 'add'); git(trio.other, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`);
  git(trio.server, 'pull', '-q', 'origin', BRANCH);
  commitOn(trio.other, name, 'edited');
  const { calls, rebuild } = recorder();
  const colored: ExecFile = (f, args, o) => realExec(f, ['-c', 'color.ui=always', '-c', 'core.quotePath=true', ...args], o);
  await pullOnce(serverHandle(rebuild), { execFile: colored });
  assert.deepEqual(calls, [[name]]);
});

const edits: Array<[string, () => void]> = [
  ['a page added', () => { fs.writeFileSync(safePath(trio.other, 'docs/new.md'), '# new\n'); git(trio.other, 'add', '-A'); git(trio.other, 'commit', '-m', 'add'); git(trio.other, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`); }],
  ['a page deleted', () => removeOn(trio.other, 'docs/extra.md')],
  ['a page renamed', () => { git(trio.other, 'mv', 'docs/extra.md', 'docs/renamed.md'); git(trio.other, 'commit', '-m', 'mv'); git(trio.other, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`); }],
  ['a non-page file edited', () => commitOn(trio.other, 'docs/.threads/authors.json', '')],
  ['a markdown file outside the docs source edited', () => {
    fs.writeFileSync(safePath(trio.other, 'README.md'), '# r\n');
    git(trio.other, 'add', '-A'); git(trio.other, 'commit', '-m', 'readme'); git(trio.other, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`);
    git(trio.server, 'pull', '-q', 'origin', BRANCH); // the server has the README; the edit below is a modification
    commitOn(trio.other, 'README.md', 'edited');
  }],
];

test('anything but a page edit rebuilds the whole site; an unmoved remote runs the fetch and two rev-parses only', async () => {
  for (const [name, edit] of edits) {
    trio.reset();
    edit();
    const { calls, rebuild } = recorder();
    await pullOnce(serverHandle(rebuild));
    assert.deepEqual(calls, [undefined], name);
    assert.equal(head(trio.server), head(trio.remote, BRANCH), name);
  }
  trio.reset();
  const verbs: string[] = [];
  const spy: ExecFile = (f, args, o) => (verbs.push(args.find((a) => ['fetch', 'rev-parse', 'reset', 'diff-tree'].includes(a)) ?? args[0]), realExec(f, args, o));
  const { calls, rebuild } = recorder();
  await pullOnce(serverHandle(rebuild), { execFile: spy });
  assert.deepEqual(verbs, ['fetch', 'rev-parse', 'rev-parse']);
  assert.deepEqual(calls, []);
});

test('pages a publish brought in with its reset are rebuilt by the next pull', async () => {
  const ctx = makeCtx(trio.server, { mode: 'serve', config: { src: 'docs', plugins: { threads: { git: GIT } } }, caller: { identity: 'ann' } }) as unknown as ActionContext;
  await actions['threads:add-thread']({ file: 'docs/index.md', body: 'Reword.', anchor: ANCHOR }, ctx);
  await actions['threads:update-review']({ title: 'Wording' }, ctx);
  commitOn(trio.other, 'docs/extra.md', 'page B moved');
  const { calls, rebuild } = recorder();

  await actions['threads:publish-review']({}, ctx);
  assert.equal(head(trio.server), head(trio.remote, BRANCH), 'the publish left the checkout at the remote head');
  assert.deepEqual(calls, []);
  await pullOnce(serverHandle(rebuild)); // the remote did not move since the publish

  assert.deepEqual(calls, [['docs/extra.md']]);
  await pullOnce(serverHandle(rebuild));
  assert.equal(calls.length, 1, 'nothing is pending after the rebuild');
});

test('a tick during a running pull is skipped; the next one after it runs', { timeout: 5000 }, async () => {
  const ticks: Array<() => void> = [];
  const timers = { setInterval: (fn: () => void) => (ticks.push(fn), { unref() {} }) as never, clearInterval: () => undefined };
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const verbs: string[] = [];
  let started = 0;
  let enter!: () => void;
  let entered = new Promise<void>((r) => (enter = r));
  const rebuild: Rebuild = async () => { started++; enter(); if (started === 1) await gate; };
  const handle = handleFor('/proj-inflight', rebuild);
  const stop = startPullLoop(handle, timers, { execFile: canned(true, 'M\0docs/a.md\0', verbs) });
  ticks[0]();
  await entered;
  const fetches = () => verbs.filter((v) => v === 'fetch').length;
  assert.equal(fetches(), 1);
  ticks[0](); // skipped: the first pull's rebuild is still running
  // A pull that was not skipped has queued its git work on the lock already: wait it out.
  await lockFor(docsRootOf(handle)).withLock(async () => undefined);
  await new Promise((r) => setImmediate(r));
  assert.equal(fetches(), 1, 'no second pull ran');
  release();
  await new Promise((r) => setImmediate(r));
  entered = new Promise<void>((r) => (enter = r));
  ticks[0]();
  await entered;
  assert.equal(fetches(), 2, 'the tick after the pull finished runs');
  stop();
});

test('a failing pull logs one redacted line per tick and the loop keeps ticking', { timeout: 5000 }, async () => {
  const broken = `${trio.remote}-missing`;
  git(trio.server, 'remote', 'set-url', 'origin', broken);
  const lines: string[] = [];
  let logged!: () => void;
  const spy = mock.method(console, 'error', (...a: unknown[]) => { lines.push(a.join(' ')); logged(); });
  const ticks: Array<() => void> = [];
  const timers = { setInterval: (fn: () => void) => (ticks.push(fn), { unref() {} }) as never, clearInterval: () => undefined };
  try {
    startPullLoop(serverHandle(async () => undefined), timers);
    for (let i = 0; i < 2; i++) {
      const one = new Promise<void>((r) => (logged = r));
      ticks[0]();
      await one;
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    spy.mock.restore();
    git(trio.server, 'remote', 'set-url', 'origin', trio.remote);
  }
  assert.equal(lines.length, 2, 'one line per tick');
  for (const line of lines) {
    assert.match(line, /^\[threads\] git pull failed: .*does not appear to be a git repository/);
    assert.ok(!line.includes(broken) && !line.includes('-missing'), line);
    assert.ok(!line.includes('\n'));
  }
});

test('a credential in the git error is redacted even when it is not the configured remote', { timeout: 5000 }, async () => {
  const lines: string[] = [];
  const spy = mock.method(console, 'error', (...a: unknown[]) => void lines.push(a.join(' ')));
  const ticks: Array<() => void> = [];
  const timers = { setInterval: (fn: () => void) => (ticks.push(fn), { unref() {} }) as never, clearInterval: () => undefined };
  const exec: ExecFile = async (_f, args) => {
    if (args.includes('get-url')) return { stdout: 'https://other.invalid/x.git\n', stderr: '' };
    throw Object.assign(new Error('Command failed'), { stderr: "fatal: unable to access 'https://u:p@h.invalid/r.git/': Could not resolve host\nhint: more\n" });
  };
  try {
    startPullLoop(handleFor('/proj-redact', async () => undefined), timers, { execFile: exec });
    ticks[0]();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  } finally {
    spy.mock.restore();
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\/\/\*\*\*@h\.invalid/);
  assert.ok(!lines[0].includes('u:p') && !lines[0].includes('\n'), lines[0]);
});

// ---------------------------------------------------------------------------
// small: canned git, the shared lock, the timers
// ---------------------------------------------------------------------------

test('the pull waits behind a publish holding the docs-root lock and rebuilds after releasing it', async () => {
  const root = '/proj-lock';
  const handleRoot = handleFor(root, async () => undefined);
  const shared = lockFor(docsRootOf(handleRoot));
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let held = false;
  const probe = { withLock: <T,>(fn: () => Promise<T>) => shared.withLock(async () => { held = true; try { return await fn(); } finally { held = false; } }) };
  const heldAtRebuild: boolean[] = [];
  const handle = handleFor(root, async () => { heldAtRebuild.push(held); order.push('rebuild'); });
  const exec: ExecFile = async (f, args, o) => { order.push(`git ${args.includes('fetch') ? 'fetch' : ''}`.trim()); return canned(true, 'M\0docs/a.md\0')(f, args, o); };

  const publishing = shared.withLock(async () => { order.push('publish in'); await gate; order.push('publish out'); });
  const pulling = pullOnce(handle, { execFile: exec, lock: probe });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['publish in'], 'the pull has not started git');
  release();
  await Promise.all([publishing, pulling]);
  assert.equal(order[1], 'publish out');
  assert.equal(order[2], 'git fetch');
  assert.equal(order.at(-1), 'rebuild');
  assert.deepEqual(heldAtRebuild, [false]);
});

test('a rebuild that rejects is logged as a build failure, kept pending and retried on the next pull', async () => {
  const attempts: Array<string[] | undefined> = [];
  let fail = true;
  const rebuilding = handleFor('/proj-retry', async (files) => { attempts.push(files); if (fail) { fail = false; throw new Error('boom\nsecond line'); } });
  const lines: string[] = [];
  const spy = mock.method(console, 'error', (...a: unknown[]) => void lines.push(a.join(' ')));
  const lock = createLock();
  try {
    await pullOnce(rebuilding, { execFile: canned(true, 'M\0docs/a.md\0M\0docs/b.md\0'), lock });
    assert.deepEqual(lines, ['[threads] rebuild after pull failed: boom']);
    await pullOnce(rebuilding, { execFile: canned(false, ''), lock }); // the remote did not move
    assert.deepEqual(attempts, [['docs/a.md', 'docs/b.md'], ['docs/a.md', 'docs/b.md']]);
    await pullOnce(rebuilding, { execFile: canned(false, ''), lock });
    assert.equal(attempts.length, 2, 'nothing pending after a successful rebuild');
  } finally {
    spy.mock.restore();
  }
});

test('the loop: one unref-ed interval of pullSeconds, stop clears it; nothing starts without git or under dev', async () => {
  const rows: Array<[string, 'serve' | 'dev', unknown, boolean]> = [
    ['serve with git', 'serve', { ...GIT, pullSeconds: 7 }, true],
    ['serve without git', 'serve', null, false],
    ['dev with git', 'dev', GIT, false],
  ];
  for (const [name, mode, gitOpt, starts] of rows) {
    const set: Array<{ ms: number; id: { unrefs: number } }> = [];
    const cleared: unknown[] = [];
    const timers = {
      setInterval: (_fn: () => void, ms: number) => { const id = { unrefs: 0, unref() { this.unrefs++; } }; set.push({ ms, id }); return id as never; },
      clearInterval: (id: unknown) => void cleared.push(id),
    };
    const stops: Array<() => void | Promise<void>> = [];
    const execs: unknown[] = [];
    const handle = handleFor('/proj-loop', async () => undefined, { mode, git: gitOpt, shutdown: stops });

    const stop = startPullLoop(handle, timers);
    await pullOnce(handle, { execFile: async (...a) => (execs.push(a), { stdout: '', stderr: '' }) });
    const globalSet = mock.method(globalThis, 'setInterval', () => ({ unref() {} }) as never);
    try {
      await onServerReady(handle, { execFile: async () => ({ stdout: '', stderr: '' }) }); // a clean, level checkout
    } finally {
      assert.equal(globalSet.mock.callCount(), starts ? 1 : 0, `${name}: onServerReady timer`);
      globalSet.mock.restore();
    }
    assert.equal(stops.length, starts ? 1 : 0, `${name}: onShutdown callback`);
    assert.equal(set.length, starts ? 1 : 0, `${name}: interval`);
    assert.equal(execs.length, starts ? 3 : 0, `${name}: pullOnce runs the fetch and two rev-parses with git under serve, nothing otherwise`);
    if (starts) {
      assert.equal(set[0].ms, 7000);
      assert.equal(set[0].id.unrefs, 1);
      stop();
      assert.deepEqual(cleared, [set[0].id]);
    }
  }
});
