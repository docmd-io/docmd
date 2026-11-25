import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { safePath } from '@docmd/utils';
import type { ServerHandle } from '@docmd/api';
import { makeRepoTrio, commitOn, log, git, BRANCH, type RepoTrio } from './helpers-git.ts';
import { classifyStatus } from '../src/plugin/git-sync.ts';
import { onServerReady } from '../src/index.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

const SENTINEL = 'SENTINEL-startup-9c1d';
const COMMITTER = { name: 'Threads Bot', email: 'bot@fixture.invalid' };
const MARKER = '[skip ci]';
const MANIFEST = 'docs/.threads/reviews/r-1.json';
const VAR = 'DOCMD_THREADS_GIT_COMMIT_PENDING';

let trio: RepoTrio;
const saved = { token: process.env.DOCMD_THREADS_GIT_TOKEN, global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
before(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  process.env.DOCMD_THREADS_GIT_TOKEN = SENTINEL;
  trio = makeRepoTrio();
});
after(() => {
  trio.cleanup();
  restore('GIT_CONFIG_GLOBAL', saved.global);
  restore('GIT_CONFIG_SYSTEM', saved.system);
  restore('DOCMD_THREADS_GIT_TOKEN', saved.token);
  delete process.env[VAR];
});
beforeEach(() => {
  trio.reset();
  delete process.env[VAR];
});

// ---------------------------------------------------------------------------
// small: which paths count
// ---------------------------------------------------------------------------

test('classifyStatus: tracked changes of every kind, and only the untracked content files the server writes', () => {
  const z = (...entries: string[]) => entries.join('\0') + '\0';
  const status = z(
    ' D docs/deleted.md',
    'R  docs/new-name.md', 'docs/old-name.md',
    'M  docs/staged.md',
    ' M docs/modified.md',
    'UU docs/conflict.md',
    'T  docs/typechange.md',
    '?? docs/new.md',
    '?? docs/.threads/authors.json',
    '?? docs/.threads/reviews/r-1.json',
    '?? notes.txt',
    '?? README.md',
    '?? docs/data.json',
    '?? docs/.threads/reviews/nested/r-2.json',
  );
  assert.deepEqual(classifyStatus(status, { docs: 'docs' }), {
    tracked: ['docs/deleted.md', 'docs/new-name.md', 'docs/old-name.md', 'docs/staged.md', 'docs/modified.md', 'docs/conflict.md', 'docs/typechange.md'],
    untracked: ['docs/new.md', 'docs/.threads/authors.json', 'docs/.threads/reviews/r-1.json'],
  });
  // A project in a subfolder of the repository: paths come back relative to it, whatever is outside is not a content file.
  assert.deepEqual(classifyStatus(z(' M site/docs/a.md', '?? site/docs/b.md', '?? other/docs/c.md', ' M top.txt'), { prefix: 'site/', docs: 'docs' }), {
    tracked: ['docs/a.md', '../top.txt'],
    untracked: ['docs/b.md'],
  });
  // A hidden docs folder keeps its dot; a project in a subfolder with docs at its root ignores paths outside it.
  assert.deepEqual(classifyStatus(z('?? .docs/new.md', '?? docs/x.md'), { docs: '.docs' }).untracked, ['.docs/new.md']);
  assert.deepEqual(classifyStatus(z('?? other/x.md'), { prefix: 'site/', docs: '' }).untracked, []);
  assert.deepEqual(classifyStatus(z('?? a.md'), { docs: '.' }).untracked, ['a.md']);
  // The docs root is the project root.
  assert.deepEqual(classifyStatus(z('?? index.md', '?? .threads/authors.json'), { docs: '' }).untracked, ['index.md', '.threads/authors.json']);
  assert.deepEqual(classifyStatus('', { docs: 'docs' }), { tracked: [], untracked: [] });
});

// ---------------------------------------------------------------------------
// medium: a real server clone, a bare remote and a second clone
// ---------------------------------------------------------------------------

const handle = (stops: Array<() => void | Promise<void>> = []): ServerHandle =>
  ({
    mode: 'serve',
    projectRoot: trio.server,
    config: { src: 'docs', plugins: { threads: { git: { branch: BRANCH, committer: COMMITTER, skipDeployMarker: MARKER } } } },
    onShutdown: (fn: () => void) => void stops.push(fn),
  }) as unknown as ServerHandle;

const bytes = (rel: string) => fs.readFileSync(safePath(trio.server, rel), 'utf8');
const status = () => git(trio.server, 'status', '--porcelain');
const headOf = (ref = 'HEAD') => git(trio.server, 'rev-parse', ref).trim();
const dirty = () => {
  fs.appendFileSync(safePath(trio.server, 'docs/index.md'), '\nserver edit\n');
  // The fixture tracks authors.json, so the untracked content file here is a review manifest.
  fs.mkdirSync(safePath(trio.server, 'docs/.threads/reviews'), { recursive: true });
  fs.writeFileSync(safePath(trio.server, MANIFEST), '{"id":"r-1"}\n');
};
const localCommit = (file: string, text: string) => {
  fs.appendFileSync(safePath(trio.server, file), `\n${text}\n`);
  git(trio.server, 'add', '-A');
  git(trio.server, 'commit', '-m', `local: ${text}`, '--author', 'Lou Local <lou@fixture.invalid>');
};

/** Runs `fn` with every console line captured; the token must be in none of them. */
async function captured<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; error: unknown; lines: string[] }> {
  const lines: string[] = [];
  const spies = (['log', 'error', 'warn', 'info'] as const).map((m) => mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(' '))));
  let result: T | undefined;
  let error: unknown;
  try {
    result = await fn();
  } catch (e) {
    error = e;
  } finally {
    spies.forEach((s) => s.mock.restore());
  }
  assert.ok(!lines.some((l) => l.includes(SENTINEL)), 'the token is in no output line');
  if (error) assert.ok(!String((error as Error).message).includes(SENTINEL), 'the token is in no error message');
  return { result, error, lines };
}

test('a dirty checkout is refused with both groups listed and the variable named; nothing changes and no loop starts', async () => {
  dirty();
  const before = { status: status(), head: headOf(), index: bytes('docs/index.md'), authors: bytes(MANIFEST), commits: log(trio.remote, '%H') };
  const stops: Array<() => void | Promise<void>> = [];
  const { error } = await captured(() => onServerReady(handle(stops)));
  assert.ok(error instanceof ThreadsError && error.code === 'config', 'threads/config');
  const message = (error as Error).message;
  assert.match(message, /Changed tracked files:\n {2}docs\/index\.md\nUntracked content files:\n {2}docs\/\.threads\/reviews\/r-1\.json/);
  assert.ok(message.includes(`${VAR}=1`));
  assert.deepEqual({ status: status(), head: headOf(), index: bytes('docs/index.md'), authors: bytes(MANIFEST), commits: log(trio.remote, '%H') }, before);
  assert.equal(stops.length, 0, 'the pull loop did not start');
});

test('the variable commits exactly the listed paths as one committer commit on the remote and starts', async () => {
  // The base for a folder the remote will later turn into a file: both clones track docs/dir/page.md.
  fs.mkdirSync(safePath(trio.other, 'docs/dir'), { recursive: true });
  commitOn(trio.other, 'docs/dir/page.md', 'a page in a folder');
  git(trio.server, 'pull', '-q', '--ff-only', 'origin', BRANCH);
  dirty();
  const edited = bytes('docs/index.md');
  process.env[VAR] = '1';
  // First, untracked files the remote branch also tracks (same path, and a folder where the remote has a file) must survive: refused, nothing pushed.
  fs.writeFileSync(safePath(trio.server, 'docs/data.json'), 'mine\n');
  fs.mkdirSync(safePath(trio.server, 'docs/nested'), { recursive: true });
  fs.writeFileSync(safePath(trio.server, 'docs/nested/x.txt'), 'mine too\n');
  fs.writeFileSync(safePath(trio.server, 'docs/folder'), 'a file where the remote has a folder\n');
  fs.mkdirSync(safePath(trio.other, 'docs/folder'), { recursive: true });
  commitOn(trio.other, 'docs/folder/y.txt', 'theirs');
  // The server holds an ignored journal file at a path the remote force-added.
  fs.mkdirSync(safePath(trio.server, 'docs/.threads/drafts'), { recursive: true });
  fs.writeFileSync(safePath(trio.server, 'docs/.threads/drafts/d.json'), 'ignored, mine\n');
  fs.mkdirSync(safePath(trio.other, 'docs/.threads/drafts'), { recursive: true });
  fs.writeFileSync(safePath(trio.other, 'docs/.threads/drafts/d.json'), 'theirs\n');
  git(trio.other, 'add', '-f', 'docs/.threads/drafts/d.json');
  git(trio.other, 'commit', '-q', '-m', 'other: force-add a journal');
  git(trio.other, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`);
  commitOn(trio.other, 'docs/data.json', 'theirs');
  commitOn(trio.other, 'docs/nested', 'theirs');
  // The folder the server tracks becomes a file on the remote, and the server keeps an untracked file in it.
  fs.writeFileSync(safePath(trio.server, 'docs/dir/keep.txt'), 'keep me\n');
  git(trio.other, 'rm', '-q', 'docs/dir/page.md');
  fs.writeFileSync(safePath(trio.other, 'docs/dir'), 'now a file\n');
  git(trio.other, 'add', 'docs/dir');
  git(trio.other, 'commit', '-q', '-m', 'other: a folder becomes a file');
  git(trio.other, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`);
  const collided = { status: status(), head: headOf(), remote: log(trio.remote, '%H') };
  const refused = await captured(() => onServerReady(handle()));
  assert.ok(refused.error instanceof ThreadsError && refused.error.code === 'config');
  assert.match((refused.error as Error).message, /would be overwritten by files on the remote branch: .*docs\/data\.json/);
  assert.match((refused.error as Error).message, /docs\/nested(,|;)/);
  assert.match((refused.error as Error).message, /docs\/\.threads\/drafts\/d\.json/, 'an ignored file counts');
  assert.match((refused.error as Error).message, /docs\/folder\/y\.txt/);
  assert.deepEqual({ status: status(), head: headOf(), remote: log(trio.remote, '%H') }, collided);
  assert.match((refused.error as Error).message, /docs\/dir(,|;)/);
  assert.equal(bytes('docs/dir/keep.txt'), 'keep me\n');
  assert.equal(bytes('docs/data.json'), 'mine\n');
  assert.equal(bytes('docs/nested/x.txt'), 'mine too\n');
  assert.equal(bytes('docs/.threads/drafts/d.json'), 'ignored, mine\n');
  // Out of the way, the run goes through; the remote has moved on by the other clone's commits.
  fs.rmSync(safePath(trio.server, 'docs/data.json'));
  fs.rmSync(safePath(trio.server, 'docs/folder'));
  fs.rmSync(safePath(trio.server, 'docs/.threads/drafts/d.json'));
  fs.rmSync(safePath(trio.server, 'docs/nested'), { recursive: true });
  fs.rmSync(safePath(trio.server, 'docs/dir/keep.txt'));
  // The remote also edits a page both clones track: an ordinary change the move must allow.
  commitOn(trio.other, 'docs/extra.md', 'remote edit');
  const remoteBefore = log(trio.remote, '%H').length;
  const stops: Array<() => void | Promise<void>> = [];
  const { error, lines } = await captured(() => onServerReady(handle(stops)));
  try {
    assert.equal(error, undefined);
    assert.equal(log(trio.remote, '%H').length, remoteBefore + 1, 'the remote gained exactly one commit');
    const tip = log(trio.remote, '%H').at(-1)!;
    assert.deepEqual(git(trio.remote, 'diff-tree', '-r', '--no-commit-id', '--name-only', tip).split('\n').filter(Boolean).sort(), ['docs/.threads/reviews/r-1.json', 'docs/index.md']);
    assert.equal(git(trio.remote, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', tip).trim(), 'Threads Bot <bot@fixture.invalid>|Threads Bot <bot@fixture.invalid>');
    assert.equal(git(trio.remote, 'log', '-1', '--format=%s', tip).trim(), `chore(threads): commit changes found at startup ${MARKER}`);
    assert.match(git(trio.remote, 'log', '-1', '--format=%b', tip), /docs\/index\.md\ndocs\/\.threads\/reviews\/r-1\.json/);
    assert.equal(status(), '');
    assert.equal(headOf(), headOf('origin/main'));
    assert.equal(headOf(), tip);
    assert.equal(bytes('docs/index.md'), edited);
    assert.match(bytes('docs/extra.md'), /remote edit/);
    assert.equal(stops.length, 1, 'the pull loop started');
    assert.deepEqual(lines.filter((l) => l.startsWith('[threads]')), ['[threads] pushed 0 local commits and committed 2 files found at startup']);
  } finally {
    await Promise.all(stops.map((stop) => stop()));
  }
});

test('a conflict with the remote leaves the checkout as found and refuses', async () => {
  dirty();
  commitOn(trio.other, 'docs/index.md', 'other side edit');
  // Both sides appended at the same place: a content conflict.
  const before = { status: status(), head: headOf(), index: bytes('docs/index.md'), authors: bytes(MANIFEST) };
  const remoteBefore = log(trio.remote, '%H');
  process.env[VAR] = 'true';
  const stops: Array<() => void | Promise<void>> = [];
  const { error } = await captured(() => onServerReady(handle(stops)));
  assert.ok(error instanceof ThreadsError && error.code === 'config');
  assert.match((error as Error).message, /the pending work could not be pushed/);
  assert.ok(!/\n/.test((error as Error).message), 'the reason is on one line');
  assert.deepEqual({ status: status(), head: headOf(), index: bytes('docs/index.md'), authors: bytes(MANIFEST) }, before);
  assert.deepEqual(log(trio.remote, '%H'), remoteBefore, 'the remote holds only the other clone\'s commit');
  assert.equal(remoteBefore.length, 2);
  assert.equal(stops.length, 0);

  // A file whose staged and working-tree versions differ is refused too, not committed half-way.
  trio.reset();
  fs.appendFileSync(safePath(trio.server, 'docs/index.md'), '\nstaged edit\n');
  git(trio.server, 'add', 'docs/index.md');
  fs.appendFileSync(safePath(trio.server, 'docs/index.md'), '\nunstaged edit\n');
  const staged = { status: status(), head: headOf(), index: bytes('docs/index.md') };
  const split = await captured(() => onServerReady(handle()));
  assert.ok(split.error instanceof ThreadsError && split.error.code === 'config');
  assert.match((split.error as Error).message, /staged changes that differ from the working tree: docs\/index\.md/);
  assert.deepEqual({ status: status(), head: headOf(), index: bytes('docs/index.md') }, staged);
});

test('local commits ahead are refused and listed; the variable pushes them with the pending commit; behind-only starts', async () => {
  localCommit('docs/extra.md', 'local one');
  const localTip = headOf();
  const short = git(trio.server, 'rev-parse', '--short', 'HEAD').trim();
  const refused = await captured(() => onServerReady(handle()));
  assert.ok(refused.error instanceof ThreadsError && refused.error.code === 'config');
  assert.ok((refused.error as Error).message.includes(`${short} local: local one`));
  assert.ok((refused.error as Error).message.includes(`${VAR}=1`));
  assert.doesNotMatch((refused.error as Error).message, /Changed tracked files|Untracked content files/);
  assert.equal(headOf(), localTip);
  assert.equal(log(trio.remote, '%H').length, 1);

  // With the variable and a modified page too: the local commit, then one committer commit.
  fs.appendFileSync(safePath(trio.server, 'docs/index.md'), '\nserver edit\n');
  process.env[VAR] = '1';
  const stops: Array<() => void | Promise<void>> = [];
  const pushed = await captured(() => onServerReady(handle(stops)));
  assert.equal(pushed.error, undefined);
  assert.equal(stops.length, 1);
  assert.deepEqual(log(trio.remote, '%an <%ae>|%s'), [
    'seed <seed@fixture.invalid>|base',
    'Lou Local <lou@fixture.invalid>|local: local one',
    `Threads Bot <bot@fixture.invalid>|chore(threads): commit changes found at startup ${MARKER}`,
  ]);
  const [, localOnRemote, pendingOnRemote] = log(trio.remote, '%H');
  assert.deepEqual(git(trio.remote, 'diff-tree', '-r', '--no-commit-id', '--name-only', localOnRemote).trim().split('\n'), ['docs/extra.md']);
  assert.deepEqual(git(trio.remote, 'diff-tree', '-r', '--no-commit-id', '--name-only', pendingOnRemote).trim().split('\n'), ['docs/index.md']);
  assert.ok(pushed.lines.includes('[threads] pushed 1 local commit and committed 1 file found at startup'));
  assert.equal(status(), '');
  assert.equal(headOf(), headOf('origin/main'));
  assert.equal(headOf(), pendingOnRemote);
  await Promise.all(stops.map((stop) => stop()));

  // Only behind the remote: starts, and nothing is committed.
  delete process.env[VAR];
  git(trio.other, 'pull', '-q', '--ff-only', 'origin', BRANCH);
  commitOn(trio.other, 'docs/extra.md', 'remote moved');
  const remoteCommits = log(trio.remote, '%H').length;
  const behind = await captured(() => onServerReady(handle(stops)));
  assert.equal(behind.error, undefined);
  assert.equal(log(trio.remote, '%H').length, remoteCommits);
  await Promise.all(stops.map((stop) => stop()));
});
