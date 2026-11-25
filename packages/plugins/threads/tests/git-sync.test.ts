import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safePath } from '@docmd/utils';
import type { ActionContext, ServerHandle } from '@docmd/api';
import { tempProject, makeCtx } from './helpers.ts';
import { makeRepoTrio, commitOn, removeOn, log, git, BRANCH, type RepoTrio } from './helpers-git.ts';
import { actions } from '../src/plugin/actions.ts';
import { createDraftStore } from '../src/plugin/drafts.ts';
import { assertRuntime, normalizeOptions } from '../src/plugin/config.ts';
import { publish, discard } from '../src/plugin/reviews.ts';
import { getSync, type ExecFile } from '../src/plugin/git-sync.ts';
import { onServerReady, generateScripts } from '../src/index.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

const SENTINEL = 'SENTINEL-7f3a';
const realExec = promisify(nodeExecFile) as unknown as ExecFile;
const ANCHOR = { quote: 'Official Documentation', prefix: null, suffix: null, selector: null, offset: null, blockText: null };
const GIT = { branch: BRANCH, committer: { name: 'Threads Bot', email: 'bot@fixture.invalid' } };
const OK = { stdout: '', stderr: '' };

let trio: RepoTrio;
// Every git process in this file runs without the machine's git configuration.
const saved = { token: process.env.DOCMD_THREADS_GIT_TOKEN, global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
before(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  trio = makeRepoTrio();
  process.env.DOCMD_THREADS_GIT_TOKEN = SENTINEL;
});
after(() => {
  trio.cleanup();
  restore('GIT_CONFIG_GLOBAL', saved.global);
  restore('GIT_CONFIG_SYSTEM', saved.system);
  restore('DOCMD_THREADS_GIT_TOKEN', saved.token);
});
beforeEach(() => trio.reset());

/** Context for the server clone: serve mode with a trusted identity, git on (the remote may be replaced). */
const ctxIn = (root: string, identity: string, git: unknown, mode: 'serve' | 'dev' = 'serve', headers: Record<string, string> = {}): ActionContext =>
  // One identity drafts in most cases here, in a real minute: raise the per-minute rate so they share a window safely.
  makeCtx(root, { mode, config: { src: 'docs', plugins: { threads: { ...(git ? { git } : {}), limits: { commentsPerMinute: 1000 } } } }, caller: { identity, headers } }) as unknown as ActionContext;
const gitCtx = (remote?: string) => ctxIn(trio.server, 'ann', remote ? { ...GIT, remote } : GIT);
const EMAIL = 'ann@example.com';
/** Git on with `authorEmailHeader`; the request carries `headers` (by default the e-mail under that header, in its proxy spelling). */
const emailCtx = (headers: Record<string, string> = { 'x-auth-request-email': EMAIL }) =>
  ctxIn(trio.server, 'ann', { ...GIT, authorEmailHeader: 'X-Auth-Request-Email' }, 'serve', headers);
/** Whether any file of the pushed branch contains `text` (`git grep` exits 1 on no match). */
const remoteTreeHolds = (text: string) => {
  try {
    git(trio.remote, 'grep', '-q', '-F', text, BRANCH, '--');
    return true;
  } catch {
    return false;
  }
};
/** Every file under the server clone outside `.git/` that holds the address. */
const holdingEmail = () => allFiles(trio.server).filter((f) => !f.includes(`${path.sep}.git${path.sep}`) && fs.readFileSync(safePath(path.dirname(f), path.basename(f)), 'utf8').includes(EMAIL));
const draft = (ctx: ActionContext, body: string, file = 'docs/index.md') =>
  actions['threads:add-thread']({ file, body, anchor: ANCHOR }, ctx);
const storeOf = () => createDraftStore(path.join(trio.server, 'docs'), { now: Date.now, defaultMode: () => 'collect' });
const commits = (remote: string) => log(remote, '%H').length;
const manifestFiles = () => {
  const dir = safePath(trio.server, 'docs/.threads/reviews');
  return fs.existsSync(dir) ? fs.readdirSync(safePath(dir, '.')) : [];
};
const allFiles = (dir: string): string[] =>
  fs.readdirSync(safePath(dir, '.'), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** Publish and discard through a git sync built on `execFile` (the actions build their own, with the real one). */
const ANN = { key: 'ann', name: 'Ann Lee', avatarUrl: '', source: 'header' as const, isAdmin: false };
const pub = (ctx: ActionContext, execFile: ExecFile) => publish(ANN, ctx, { store: storeOf(), sync: getSync(ctx, { execFile }) });
const dis = (ctx: ActionContext, reviewId: string, execFile: ExecFile) => discard(ANN, ctx, reviewId, { store: storeOf(), sync: getSync(ctx, { execFile }) });

// ---------------------------------------------------------------------------
// small: the runtime check, onServerReady, and when git is off
// ---------------------------------------------------------------------------

test('assertRuntime: the token is required only when git is configured', () => {
  const withGit = normalizeOptions({ git: { branch: BRANCH } });
  assert.throws(
    () => assertRuntime(withGit, {}),
    (e: unknown) => e instanceof ThreadsError && e.code === 'config' && e.message.startsWith('threads/config:') && e.message.includes('DOCMD_THREADS_GIT_TOKEN'),
  );
  assert.throws(() => assertRuntime(withGit, { DOCMD_THREADS_GIT_TOKEN: '' }), /DOCMD_THREADS_GIT_TOKEN/);
  assert.doesNotThrow(() => assertRuntime(withGit, { DOCMD_THREADS_GIT_TOKEN: 'x' }));
  assert.doesNotThrow(() => assertRuntime(normalizeOptions({}), {}));
});

test('onServerReady: serve rejects without the token; dev ignores git with one line', async () => {
  const lines: string[] = [];
  const spy = mock.method(console, 'log', (...a: unknown[]) => void lines.push(a.join(' ')));
  const stops: Array<() => void | Promise<void>> = [];
  const handle = (mode: 'serve' | 'dev', threads: unknown) =>
    ({ mode, projectRoot: '/x', config: { plugins: { threads } }, onShutdown: (fn: () => void) => stops.push(fn) }) as unknown as ServerHandle;
  const withGit = { git: { branch: 'secret-branch', remote: 'https://u:p@h.invalid/r.git' } };
  try {
    delete process.env.DOCMD_THREADS_GIT_TOKEN;
    await assert.rejects(onServerReady(handle('serve', withGit)), /^ThreadsError: threads\/config: .*DOCMD_THREADS_GIT_TOKEN/);
    await onServerReady(handle('serve', true));
    await onServerReady(handle('dev', true));
    assert.deepEqual(lines, [], 'no git, no line');
    await onServerReady(handle('dev', withGit)); // dev: no token needed, never throws
    assert.equal(lines.length, 1);
    assert.match(lines[0], /ignored under docmd dev/);
    assert.ok(!/secret-branch|h\.invalid|TOKEN/.test(lines[0]), 'the line names no remote, branch or variable');
    process.env.DOCMD_THREADS_GIT_TOKEN = SENTINEL;
    // A runner that reports a clean, level checkout (empty status and log) and records what it was asked.
    const seen: string[][] = [];
    const clean: ExecFile = async (_f, args) => (seen.push(args), OK);
    await onServerReady(handle('serve', withGit), { execFile: clean });
    assert.equal(lines.length, 1, 'serve with the token logs nothing');
    assert.equal(stops.length, 1, 'a clean checkout starts the pull loop');
    for (const value of ['1', 'true']) {
      process.env.DOCMD_THREADS_GIT_COMMIT_PENDING = value;
      seen.length = 0;
      await onServerReady(handle('serve', withGit), { execFile: clean });
      assert.ok(!seen.some((a) => ['commit-tree', 'push', 'reset'].some((v) => a.includes(v))), `clean checkout, variable ${value}: no commit, push or reset`);
    }
    process.env.DOCMD_THREADS_GIT_COMMIT_PENDING = 'yes';
    seen.length = 0;
    await assert.rejects(onServerReady(handle('serve', withGit), { execFile: clean }), /^ThreadsError: threads\/config: .*DOCMD_THREADS_GIT_COMMIT_PENDING must be 1 or true/);
    assert.deepEqual(seen, [], 'a bad value is refused before git runs');
    // Dev never reads the variable and runs no git.
    const before = lines.length;
    await onServerReady(handle('dev', withGit), { execFile: clean });
    assert.deepEqual(seen, [], 'dev runs no git process');
    assert.equal(lines.length, before + 1);
    delete process.env.DOCMD_THREADS_GIT_COMMIT_PENDING;

    // A failing fetch is refused with the reason on one line and no remote address or credential.
    const failing = (verb: string): ExecFile => async (_f, args) => {
      if (args.includes('get-url')) return { stdout: `https://u:${SENTINEL}@h.invalid/r.git\n`, stderr: '' };
      if (args.includes(verb)) throw Object.assign(new Error('Command failed'), { stderr: `fatal: unable to access 'https://u:${SENTINEL}@h.invalid/r.git/': Could not resolve host\nhint: more` });
      return OK;
    };
    await assert.rejects(onServerReady(handle('serve', withGit), { execFile: failing('fetch') }), (e: unknown) =>
      e instanceof ThreadsError && e.code === 'config' && /could not fetch/.test(e.message) && !/\n/.test(e.message) && !e.message.includes(SENTINEL) && !e.message.includes('h.invalid'));
    // Not a working tree: git fails at once (rev-parse); a failing status read is refused the same way.
    for (const verb of ['rev-parse', 'status']) {
      await assert.rejects(onServerReady(handle('serve', withGit), { execFile: failing(verb) }), (e: unknown) =>
        e instanceof ThreadsError && e.code === 'config' && /could not be inspected/.test(e.message) && !e.message.includes(SENTINEL));
    }
    // Commit-pending on git older than 2.40 is refused as such, before any commit or push.
    const old: string[][] = [];
    const git239: ExecFile = async (_f, args) => {
      old.push(args);
      if (args[0] === 'status') return { stdout: ' M docs/a.md\0', stderr: '' };
      return { stdout: args[0] === 'version' ? 'git version 2.39.2' : '', stderr: '' };
    };
    process.env.DOCMD_THREADS_GIT_COMMIT_PENDING = '1';
    await assert.rejects(onServerReady(handle('serve', withGit), { execFile: git239 }), (e: unknown) =>
      e instanceof ThreadsError && e.code === 'config' && /needs git 2.40 or later/.test(e.message));
    assert.ok(!old.some((a) => a.includes('commit-tree') || a.includes('push')), 'no commit or push ran');
    delete process.env.DOCMD_THREADS_GIT_COMMIT_PENDING;
    assert.equal(stops.length, 1 + 2, 'only the starts that were allowed registered a loop');
  } finally {
    await Promise.all(stops.map((stop) => stop()));
    spy.mock.restore();
    delete process.env.DOCMD_THREADS_GIT_COMMIT_PENDING;
    process.env.DOCMD_THREADS_GIT_TOKEN = SENTINEL;
  }
});

test('no git process runs without git under serve, nor under dev whatever git says', async () => {
  const rows: Array<[string, ActionContext]> = [
    ['serve, no git', ctxIn(trio.server, 'ann', null)],
    ['dev, full git', ctxIn(trio.server, 'ann', GIT, 'dev')],
  ];
  for (const [name, ctx] of rows) {
    const calls: unknown[] = [];
    const spy: ExecFile = async (...a) => (calls.push(a), OK);
    const headBefore = git(trio.server, 'rev-parse', 'HEAD');
    // dev takes the caller from the payload, serve from the identity
    const payload = ctx.mode === 'dev' ? { author: 'Ann Lee', authorKey: 'ann' } : {};
    await actions['threads:add-thread']({ file: 'docs/index.md', body: `via ${name}`, anchor: ANCHOR, ...payload }, ctx);
    const { reviewId } = await publish(ANN, ctx, { store: storeOf(), sync: getSync(ctx, { execFile: spy }) });
    assert.equal(manifestFiles().length, 1, `${name}: the manifest is written`);
    await discard(ANN, ctx, reviewId, { store: storeOf(), sync: getSync(ctx, { execFile: spy }) });
    assert.deepEqual(calls, [], name);
    assert.equal(git(trio.server, 'rev-parse', 'HEAD'), headBefore, `${name}: HEAD is unchanged`);
    assert.equal(commits(trio.remote), 1, `${name}: nothing pushed`);
    trio.reset();
  }
});

test('two concurrent publishes commit in call order through the shared docs-root lock', async () => {
  const project = tempProject();
  try {
    const verbs: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let annAtPush!: () => void;
    const reachedPush = new Promise<void>((r) => (annAtPush = r));
    let bobLoaded = false;
    const canned = (who: string): ExecFile => async (_f, args) => {
      const verb = args.find((a) => ['fetch', 'diff-tree', 'reset', 'add', 'commit', 'push'].includes(a))!;
      verbs.push(`${who}:${verb}`);
      if (who === 'ann' && verb === 'push') {
        annAtPush();
        await gate;
      }
      return OK;
    };
    const people = [['ann', 'Ann'], ['bob', 'Bob']] as const;
    const jobs = [];
    for (const [key, name] of people) {
      const ctx = ctxIn(project.root, key, GIT);
      await actions['threads:add-thread']({ file: project.file, body: `by ${key}`, anchor: ANCHOR }, ctx);
      const caller = { key, name, avatarUrl: '', source: 'header' as const, isAdmin: false };
      const real = createDraftStore(path.join(project.root, 'docs'), { now: Date.now, defaultMode: () => 'collect' });
      // bob's first store read is the first thing his publish does under the lock
      const store = key === 'bob' ? { ...real, load: (k: string) => ((bobLoaded = true), real.load(k)) } : real;
      jobs.push(publish(caller, ctx, { store, sync: getSync(ctx, { execFile: canned(key) }) }));
    }
    await reachedPush;
    assert.equal(bobLoaded, false, 'bob has not started while ann waits on her push');
    assert.ok(!verbs.some((v) => v.startsWith('bob:')));
    release();
    await Promise.all(jobs);
    assert.equal(bobLoaded, true);
    assert.deepEqual(verbs.map((v) => v.split(':')[1]), ['fetch', 'diff-tree', 'reset', 'add', 'commit', 'push', 'fetch', 'diff-tree', 'reset', 'add', 'commit', 'push']);
    assert.deepEqual(verbs.map((v) => v.split(':')[0]), ['ann', 'ann', 'ann', 'ann', 'ann', 'ann', 'bob', 'bob', 'bob', 'bob', 'bob', 'bob']);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------------------
// medium: a real bare remote and two clones
// ---------------------------------------------------------------------------

test('publish makes one commit authored by the commenter, with the address from the request header; the token and the address leak nowhere', async () => {
  const ctx = emailCtx();
  await draft(ctx, 'Reword this link text.');
  await draft(ctx, 'And this one.', 'docs/extra.md');
  await actions['threads:update-review']({ title: 'Link wording', summary: '  Why the links change.\n\nSecond paragraph.  ' }, ctx);

  const recorded: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const recording: ExecFile = (file, args, opts) => (recorded.push({ args, env: opts.env }), realExec(file, args, opts));
  const out: string[] = [];
  const spies = [
    mock.method(console, 'log', (...a: unknown[]) => void out.push(a.join(' '))),
    mock.method(console, 'error', (...a: unknown[]) => void out.push(a.join(' '))),
    mock.method(console, 'warn', (...a: unknown[]) => void out.push(a.join(' '))),
    mock.method(process.stdout, 'write', (s: unknown) => (out.push(String(s)), true)),
    mock.method(process.stderr, 'write', (s: unknown) => (out.push(String(s)), true)),
  ];
  try {
    await pub(ctx, recording);
  } finally {
    spies.forEach((s) => s.mock.restore());
  }

  assert.equal(commits(trio.remote), 2, 'exactly one new commit');
  const [a, c, subject] = log(trio.remote, '%an <%ae>%n%cn <%ce>%n%s').slice(-3);
  assert.deepEqual([a, c, subject], [`Ann Lee <${EMAIL}>`, 'Threads Bot <bot@fixture.invalid>', 'Link wording [skip ci]']);
  assert.equal(git(trio.remote, 'log', '-1', '--format=%b', BRANCH).trim(), 'Why the links change.\n\nSecond paragraph.', 'the body is the summary');
  const files = git(trio.remote, 'show', '--name-only', '--format=', BRANCH).split('\n').filter(Boolean).sort();
  assert.equal(files.length, 3, files.join());
  assert.deepEqual(files.filter((f) => !f.includes('/reviews/')), ['docs/extra.md', 'docs/index.md']);
  assert.ok(files.some((f) => /^docs\/\.threads\/reviews\/r-.*\.json$/.test(f)));
  assert.equal(git(trio.server, 'status', '--porcelain').trim(), '');
  assert.equal(git(trio.server, 'rev-parse', 'HEAD').trim(), git(trio.server, 'rev-parse', `origin/${BRANCH}`).trim());
  assert.deepEqual((await storeOf().load(ANN.key)).ops, []);

  // the credential is not in the remote URL, under .git/, or in the output
  assert.ok(!git(trio.server, 'remote', '-v').includes(SENTINEL));
  for (const f of allFiles(path.join(trio.server, '.git'))) {
    assert.ok(!fs.readFileSync(safePath(path.dirname(f), path.basename(f))).includes(SENTINEL), `${f} holds the token`);
  }
  assert.ok(!out.join('\n').includes(SENTINEL));

  // the address is in the commit's author and nowhere else: not in the pushed tree, the clone, the output or the page scripts
  assert.ok(!out.join('\n').includes(EMAIL), 'output');
  assert.equal(remoteTreeHolds(EMAIL), false, 'pushed tree');
  assert.deepEqual(holdingEmail(), [], 'server clone');
  const scripts = generateScripts({ src: path.join(trio.server, 'docs') }, ctx.config.plugins && (ctx.config as { plugins: { threads: unknown } }).plugins.threads);
  assert.ok(!(scripts.headScriptsHtml + scripts.bodyScriptsHtml).includes(EMAIL), 'generateScripts');
  // the argument channel: the token is in no argument, and the push child has it in its environment
  assert.ok(recorded.every((r) => r.args.every((x) => !x.includes(SENTINEL))));
  assert.equal(recorded.find((r) => r.args.includes('push'))?.env.DOCMD_THREADS_GIT_TOKEN, SENTINEL);
});

test('without the option, or when the request lacks the header, the author e-mail is the placeholder', async () => {
  const cases: Array<[string, () => ActionContext]> = [
    ['no option', () => ctxIn(trio.server, 'ann', GIT, 'serve', { 'x-auth-request-email': EMAIL })],
    ['no header', () => emailCtx({})],
  ];
  for (const [name, make] of cases) {
    trio.reset();
    const ctx = make();
    await draft(ctx, 'Reword this link text.');
    await actions['threads:publish-review']({}, ctx);
    assert.equal(log(trio.remote, '%an <%ae>').pop(), 'Ann Lee <ann@threads.invalid>', name);
    assert.equal(remoteTreeHolds('example.com'), false, name);
  }
});

const remoteAuthors = () => JSON.parse(git(trio.remote, 'show', `${BRANCH}:docs/.threads/authors.json`));
const changedFiles = () => git(trio.remote, 'show', '--name-only', '--format=', BRANCH).split('\n').filter(Boolean).sort();

test('a pending profile is committed with the review: pages, manifest and authors.json in one commit, then cleared', async () => {
  const ctx = gitCtx();
  await draft(ctx, 'Reword this link text.');
  await actions['threads:upsert-author']({ name: 'Ann L.', avatarUrl: 'http://a/ann.png' }, ctx);
  assert.equal(commits(trio.remote), 1);
  assert.equal(fs.readFileSync(safePath(trio.server, 'docs/.threads/authors.json'), 'utf8').includes('Ann L.'), false, 'nothing is written before the publish');

  await actions['threads:publish-review']({}, ctx);
  assert.equal(commits(trio.remote), 2, 'exactly one new commit');
  const files = changedFiles();
  assert.deepEqual(files.filter((f) => !f.includes('/reviews/')), ['docs/.threads/authors.json', 'docs/index.md']);
  assert.equal(files.filter((f) => f.includes('/reviews/')).length, 1);
  assert.deepEqual(remoteAuthors(), { ann: { name: 'Ann L.', avatarUrl: 'http://a/ann.png' } });
  assert.equal(git(trio.server, 'status', '--porcelain').trim(), '');
  const journal = await storeOf().load(ANN.key);
  assert.deepEqual([journal.ops, journal.profile], [[], undefined]);
});

test('a profile alone is one commit of authors.json named for the new name, authored with the request address; an entry the repository already holds commits and pushes nothing', async () => {
  const ctx = emailCtx();
  await actions['threads:upsert-author']({ name: 'Ann Lee-Smith' }, ctx);
  const open = (await storeOf().load(ANN.key)).review.id; // saved by the upsert
  assert.deepEqual(await actions['threads:publish-review']({}, ctx), { reviewId: open, skipped: [] });

  assert.equal(commits(trio.remote), 2);
  assert.equal(log(trio.remote, '%s').pop(), 'Ann Lee-Smith updated their profile [skip ci]');
  assert.equal(log(trio.remote, '%ae').pop(), EMAIL);
  assert.deepEqual(changedFiles(), ['docs/.threads/authors.json'], 'no manifest');
  assert.deepEqual(remoteAuthors(), { ann: { name: 'Ann Lee-Smith', avatarUrl: '' } });
  assert.deepEqual(manifestFiles(), []);
  const journal = await storeOf().load(ANN.key);
  assert.deepEqual([journal.review.id, journal.profile], [open, undefined]);

  // the same entry again: nothing is staged
  await actions['threads:upsert-author']({ name: 'Ann Lee-Smith' }, ctx);
  const verbs: string[] = [];
  const recording: ExecFile = (file, args, opts) => (verbs.push(...args), realExec(file, args, opts));
  assert.deepEqual(await pub(ctx, recording), { reviewId: open, skipped: [] });
  assert.equal(commits(trio.remote), 2, 'no new commit');
  assert.ok(!verbs.includes('commit') && !verbs.includes('push'), verbs.join(' '));
  assert.equal((await storeOf().load(ANN.key)).profile, undefined, 'the profile is still cleared');
});

test('discard is one forward commit by the discarding caller, authored with the request address; an open review makes none', async () => {
  const ctx = emailCtx();
  await draft(ctx, 'Reword this.');
  await actions['threads:update-review']({ title: 'Wording', summary: 'Not for the discard commit.' }, ctx);
  // through the handlers, with the real execFile: the remote is a local path
  const { reviewId } = await actions['threads:publish-review']({}, ctx);
  const before = commits(trio.remote);
  await actions['threads:discard-review']({ reviewId }, ctx);

  assert.equal(commits(trio.remote), before + 1);
  const [a, c, s] = log(trio.remote, '%an <%ae>%n%cn <%ce>%n%s').slice(-3);
  assert.deepEqual([a, c, s], [`Ann Lee <${EMAIL}>`, 'Threads Bot <bot@fixture.invalid>', 'revert(threads): discard review "Wording" [skip ci]']);
  assert.equal(remoteTreeHolds(EMAIL), false, 'the address is in no pushed file');
  assert.equal(git(trio.remote, 'log', '-1', '--format=%b', BRANCH).trim(), '', 'a discard commit has no body');
  const files = git(trio.remote, 'show', '--name-only', '--format=', BRANCH).split('\n').filter(Boolean).sort();
  assert.deepEqual(files.filter((f) => !f.includes('/reviews/')), ['docs/index.md']);
  assert.equal(files.length, 2);

  // the caller's open review: emptied, no git process at all
  await draft(ctx, 'Not published.');
  const open = (await storeOf().load(ANN.key)).review.id;
  const calls: string[][] = [];
  await dis(ctx, open, async (...a) => (calls.push(a[1]), OK));
  assert.deepEqual(calls, []);
  assert.equal(commits(trio.remote), before + 1);
});

test('discard reads the manifest from the fetched head: a review discarded on the remote meanwhile is refused', async () => {
  const ctx = gitCtx();
  await draft(ctx, 'Reword this.');
  const { reviewId } = await actions['threads:publish-review']({}, ctx);
  const rel = `docs/.threads/reviews/${reviewId}.json`;
  git(trio.other, 'pull', '-q', 'origin', BRANCH);
  const file = safePath(trio.other, rel);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), state: 'discarded' }, null, 2) + '\n');
  git(trio.other, 'commit', '-qam', 'other: discard elsewhere');
  git(trio.other, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`);
  const before = commits(trio.remote);
  await assert.rejects(actions['threads:discard-review']({ reviewId }, ctx), /already discarded/);
  assert.equal(commits(trio.remote), before, 'nothing was committed');
});

test('a push that loses a race is re-applied on the fresh head; a deleted page is skipped; three rejections leave the review open', async () => {
  const ctx = gitCtx();
  const store = storeOf();
  await draft(ctx, 'Race me.');
  await draft(ctx, 'On a file that goes away.', 'docs/extra.md');
  removeOn(trio.other, 'docs/extra.md'); // the server's clone still has it until it syncs

  // other pushes once, just before the server's first push
  let raced = false;
  const staged: string[][] = [];
  const racing: ExecFile = async (file, args, opts) => {
    if (args.includes('add')) staged.push(args);
    if (!raced && args.includes('push')) {
      raced = true;
      commitOn(trio.other, 'docs/index.md', 'OTHER-WAS-HERE');
    }
    return realExec(file, args, opts);
  };
  await actions['threads:update-review']({ title: 'Raced' }, ctx);
  await pub(ctx, racing);
  assert.deepEqual(log(trio.remote, '%an|%s'), ['seed|base', 'other|other: remove docs/extra.md', 'other|other: OTHER-WAS-HERE', 'Ann Lee|Raced [skip ci]']);
  assert.equal(git(trio.remote, 'log', '-1', '--format=%b', BRANCH).trim(), '', 'no summary: no body');
  const manifestPath = git(trio.remote, 'show', '--name-only', '--format=', BRANCH).split('\n').find((f) => f.includes('/reviews/'))!;
  const manifest = JSON.parse(git(trio.remote, 'show', `${BRANCH}:${manifestPath}`));
  assert.deepEqual(manifest.skipped.map((x: { reason: string }) => x.reason), ['file docs/extra.md not readable'], 'the op on the deleted page is skipped');
  assert.ok(staged.length >= 2 && staged.every((a) => !a.includes('docs/extra.md')), 'git add never names the missing page');
  const final = git(trio.remote, 'show', `${BRANCH}:docs/index.md`);
  assert.ok(final.includes('OTHER-WAS-HERE') && final.includes('Race me.'), 'the second attempt applied on the fresh head');

  // rejected every time: a pre-receive hook refuses while the marker exists
  trio.reset();
  fs.writeFileSync(safePath(trio.remote, 'hooks/pre-receive'), '#!/bin/sh\n[ -e ./reject ] && exit 1\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(safePath(trio.remote, 'reject'), '');
  let pushes = 0;
  const counting: ExecFile = (file, args, opts) => (args.includes('push') && pushes++, realExec(file, args, opts));
  try {
    await draft(ctx, 'Doomed.');
    await assert.rejects(pub(ctx, counting), (e: unknown) => e instanceof ThreadsError && e.code === 'push-failed');
    assert.equal(pushes, 3);
    assert.equal((await store.load(ANN.key)).ops.length, 1, 'the journal keeps every op');
    assert.deepEqual(manifestFiles(), [], 'no manifest left behind');
  } finally {
    fs.rmSync(safePath(trio.remote, 'hooks/pre-receive'));
    fs.rmSync(safePath(trio.remote, 'reject'));
  }
  assert.equal(git(trio.server, 'status', '--porcelain').trim(), '');
  assert.equal(git(trio.server, 'rev-parse', 'HEAD').trim(), git(trio.server, 'rev-parse', `origin/${BRANCH}`).trim());
  assert.equal(commits(trio.remote), 1);
  await pub(ctx, realExec); // the review was left open: the next publish goes through
  assert.equal(commits(trio.remote), 2);
});

test('a commit that fails logs and throws without the request address', async () => {
  const ctx = emailCtx();
  await draft(ctx, 'Reword this link text.');
  const failing: ExecFile = (file, args, opts) =>
    args.includes('commit') ? Promise.reject(new Error(`Command failed: git ${args.join(' ')}`)) : realExec(file, args, opts);
  const logged: string[] = [];
  const spy = mock.method(console, 'error', (...a: unknown[]) => void logged.push(a.join(' ')));
  let err: unknown;
  try {
    err = await pub(ctx, failing).catch((e) => e);
  } finally {
    spy.mock.restore();
  }
  assert.ok(err instanceof ThreadsError && err.code === 'push-failed');
  assert.ok(logged.length > 0 && !logged.join('\n').includes(EMAIL), 'the log');
  const cause = (err as ThreadsError).cause;
  assert.ok(!err.message.includes(EMAIL) && !(cause instanceof Error && cause.message.includes(EMAIL)), 'the error and its cause');
});

test('a staging that fails leaves no manifest, the ops in the journal and no credential in the error; the next publish succeeds', async () => {
  const URL = `https://user:${SENTINEL}@example.invalid/repo.git`;
  const ctx = gitCtx(URL);
  await draft(ctx, 'Keep me.');
  // the fake remote URL stands in for "origin" so the real git can run
  const viaOrigin = (args: string[]) => args.map((a) => (a === URL ? 'origin' : a));
  let failOnce = true;
  const failing: ExecFile = async (file, args, opts) => {
    if (failOnce && args.includes('add')) {
      failOnce = false;
      throw new Error(`boom in ${trio.server} at ${URL}`);
    }
    return realExec(file, viaOrigin(args), opts);
  };
  const logged: string[] = [];
  const spy = mock.method(console, 'error', (...a: unknown[]) => void logged.push(a.join(' ')));
  let err: unknown;
  try {
    err = await pub(ctx, failing).catch((e) => e);
  } finally {
    spy.mock.restore();
  }
  assert.ok(err instanceof ThreadsError && err.code === 'push-failed');
  assert.ok(!err.message.includes(trio.server) && !err.message.includes(SENTINEL) && !err.message.includes('example.invalid'), 'nothing sensitive reaches the client');
  assert.ok(logged.length > 0 && !logged.join('\n').includes(SENTINEL), 'the log is redacted');
  assert.deepEqual(manifestFiles(), []);
  assert.equal((await storeOf().load(ANN.key)).ops.length, 1);
  await pub(ctx, failing);
  assert.equal(commits(trio.remote), 2);
});
