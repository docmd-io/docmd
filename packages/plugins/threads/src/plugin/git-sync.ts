import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ActionContext, ServerHandle } from '@docmd/api';
import { safePath } from '@docmd/utils';
import fs from 'node:fs';
import os from 'node:os';
import { ThreadsError } from './errors.js';
import { getOptions, type ThreadsOptions } from './config.js';
import { createNoGitSync, lockFor, type Applied, type Lock, type PublishMeta, type Sync } from './lock.js';
import { docsRootOf } from './reviews.js';

export type ExecFile = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface GitSyncDeps {
  cwd: string;
  /** The docs root: the key of the pages still to rebuild, and the folder a page must be under. */
  root: string;
  lock: Lock;
  execFile?: ExecFile;
}

const MAX_ATTEMPTS = 3;

/** Room for git's output: a big diff or many untracked files must not fail on node's 1 MiB default. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Reads the token from the child environment: it is never an argument, a URL or a file. */
const CREDENTIAL_HELPER = '!f(){ echo username=x-access-token; echo "password=$DOCMD_THREADS_GIT_TOKEN"; }; f';

const AUTH = ['-c', 'credential.helper=', '-c', `credential.helper=${CREDENTIAL_HELPER}`];

const realExec = (): ExecFile => promisify(nodeExecFile) as unknown as ExecFile;
const firstLine = (text: string): string | undefined => text.split('\n').find((l) => l.trim());

/** Runs git in `cwd` with the server's environment (the credential helper reads the token from it); resolves to trimmed stdout. */
const gitRunner = (run: ExecFile, cwd: string, extraEnv: NodeJS.ProcessEnv = {}) => async (args: string[]): Promise<string> =>
  (await run('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv }, maxBuffer: MAX_BUFFER })).stdout.trim();

/** Fetches the branch into `origin/<branch>`, whatever the remote is called. */
const fetchArgs = (remote: string, branch: string): string[] =>
  [...AUTH, 'fetch', remote, `+refs/heads/${branch}:refs/remotes/origin/${branch}`];

/** What the checkout moved past that the host has not rebuilt yet: `all` for a full rebuild, else the pages. */
interface Moved { all: boolean; files: Set<string> }

/** Per docs root; a failed rebuild leaves its pages here for the next pull. */
const pending = new Map<string, Moved>();
const pendingFor = (root: string): Moved => {
  let moved = pending.get(root);
  if (!moved) pending.set(root, (moved = { all: false, files: new Set() }));
  return moved;
};

/**
 * Records what `git reset --hard origin/<branch>` is about to bring in: a modified markdown
 * page under the docs source is a page to rebuild; any other change needs the whole site.
 * Paths are relative to the project, the way `rebuild` takes them.
 */
async function recordChanges(git: (args: string[]) => Promise<string>, branch: string, root: string, cwd: string): Promise<void> {
  const src = path.relative(cwd, root).split(path.sep).join('/');
  const moved = pendingFor(root);
  // Plumbing output: NUL-separated, unquoted, never coloured. A rename or copy carries two paths.
  const tokens = (await git(['diff-tree', '-r', '-z', '--name-status', '--relative', 'HEAD', `origin/${branch}`])).split('\0').filter(Boolean);
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    const paths = tokens.slice(i, i + (/^[RC]/.test(status) ? 2 : 1));
    i += paths.length;
    const file = paths[paths.length - 1];
    if (status === 'M' && file.endsWith('.md') && (!src || file.startsWith(`${src}/`))) moved.files.add(file);
    else moved.all = true;
  }
}

/** A name or email as `--author` takes it: no angle brackets or line breaks. */
const ident = (s: string): string => s.replace(/[<>\r\n]+/g, ' ').trim();

/**
 * Git-backed sync: one commit per publish or discard, authored by the caller,
 * committed by the configured bot, pushed to the configured branch. A rejected
 * push is retried from the fresh remote head (the change is applied again).
 */
export function createGitSync(opts: NonNullable<ThreadsOptions['git']>, deps: GitSyncDeps): Sync {
  const { cwd, lock, root } = deps;
  const { branch, remote, skipDeployMarker, committer } = opts;
  const git = gitRunner(deps.execFile ?? realExec(), cwd);

  const syncToRemoteHead = async () => {
    await git(fetchArgs(remote, branch));
    // Pages other people changed arrive with this reset; the next pull rebuilds them.
    await recordChanges(git, branch, root, cwd);
    await git(['reset', '--hard', `origin/${branch}`]);
  };

  /** The ones of the change's pages that exist (a page deleted upstream is skipped), then the manifest. */
  const stage = async (meta: PublishMeta) => {
    const present = meta.files.filter((f) => fs.existsSync(safePath(cwd, f)));
    const paths = [...present, ...(meta.manifest ? [meta.manifest] : [])];
    if (paths.length) await git(['add', '-A', '--', ...paths]);
  };

  /** Whether staging left anything to commit (a change that matches the head stages nothing). */
  const hasStaged = async () => (await git(['diff', '--cached', '--name-only'])) !== '';

  const commit = async (meta: PublishMeta, applied: Applied) => {
    const subject = meta.kind === 'discard'
      ? `revert(threads): discard review "${applied.title}" ${skipDeployMarker}`
      : `${applied.title} ${skipDeployMarker}`;
    // The request's address when it carried one, else a placeholder on a reserved domain.
    const email = meta.authorEmail ?? `${meta.authorKey.replace(/[^a-z0-9._-]+/gi, '-')}@threads.invalid`;
    await git([
      '-c', `user.name=${committer.name}`, '-c', `user.email=${committer.email}`,
      'commit', `--author=${ident(meta.authorName)} <${ident(email)}>`, '-m', subject,
      ...(applied.summary ? ['-m', applied.summary] : []),
    ]);
  };

  const push = () => git([...AUTH, 'push', remote, `HEAD:refs/heads/${branch}`]);

  /** Back to origin, and drop the manifest the change created, so the review stays open. */
  const resetQuietly = async (meta: PublishMeta) => {
    await git(['reset', '--hard', `origin/${branch}`]).catch(() => undefined);
    if (meta.manifest) await git(['clean', '-fdq', '--', meta.manifest]).catch(() => undefined);
  };

  /** A coded error for the client, with no remote or path in it; the raw error stays in `cause` and is logged with credentials redacted. */
  const fail = (what: string, cause: unknown, after = '', secret?: string) => {
    const raw = cause instanceof Error ? cause.message : String(cause);
    const redacted = (secret ? raw.split(secret).join('***') : raw).replace(/\/\/[^@/\s]*@/g, '//***@');
    console.error(`[threads] git ${what} failed: ${redacted}`);
    // The cause is rebuilt from the redacted text: the raw error names the commit's author argument.
    return new ThreadsError('push-failed', `could not ${what} the remote branch ${branch}${after}; the review is unchanged, try again`, { cause: new Error(redacted) });
  };

  return {
    withLock: (fn) => lock.withLock(fn),
    async publishWithRetry(apply, meta) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await syncToRemoteHead();
        } catch (e) {
          await resetQuietly(meta);
          throw fail('sync with', e);
        }
        let applied: Applied;
        try {
          applied = await apply();
        } catch (e) {
          await resetQuietly(meta);
          throw e;
        }
        try {
          await stage(meta);
          // A change with no manifest (a profile the repository already holds) may stage nothing: then no commit and no push.
          if (!meta.manifest && !(await hasStaged())) return;
          await commit(meta, applied);
        } catch (e) {
          await resetQuietly(meta);
          throw fail('commit to', e, '', meta.authorEmail);
        }
        try {
          await push();
          return;
        } catch (e) {
          lastError = e;
          await resetQuietly(meta);
        }
      }
      throw fail('push to', lastError, ` after ${MAX_ATTEMPTS} attempts`);
    },
  };
}

const syncs = new Map<string, Sync>();

/** Whether git sync runs for this call: only under `docmd serve`, and only when the `git` option is set. */
export const gitOn = (ctx: ActionContext): boolean => ctx.mode === 'serve' && !!getOptions(ctx).git;

/**
 * The sync for this call: git-backed when `plugins.threads.git` is set and the host is
 * `docmd serve` (one per docs root), else the no-git one: under `docmd dev` the option is
 * ignored and no process is ever spawned. Both wrap the docs root's lock. An injected
 * `execFile` (tests) builds a fresh git sync on the same lock.
 */
export function getSync(ctx: ActionContext, deps: { execFile?: ExecFile } = {}): Sync {
  const root = docsRootOf(ctx);
  const lock = lockFor(root);
  const git = gitOn(ctx) ? getOptions(ctx).git : null;
  if (!git) {
    let sync = syncs.get(root);
    if (!sync) syncs.set(root, (sync = createNoGitSync(lock)));
    return sync;
  }
  if (deps.execFile) return createGitSync(git, { cwd: ctx.projectRoot, root, lock, execFile: deps.execFile });
  let sync = syncs.get(`git:${root}`);
  if (!sync) syncs.set(`git:${root}`, (sync = createGitSync(git, { cwd: ctx.projectRoot, root, lock })));
  return sync;
}


interface PullDeps {
  execFile?: ExecFile;
  /** Defaults to the docs root's shared lock, the one publishes queue behind. */
  lock?: Lock;
}

interface PullTimers {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

/**
 * One pull: fetch the branch and, when `origin/<branch>` moved, reset the checkout to it and
 * rebuild what changed (only the pages when every change is a modified markdown page, else the
 * whole site). The git work runs under the docs root's lock, so it never interleaves with a
 * publish; the rebuild runs after it is released. Untracked and ignored files (the journals)
 * survive the reset. Changes whose rebuild failed, and pages a publish's reset brought in,
 * stay pending and are rebuilt by the next call. Does nothing under `docmd dev`.
 */
export async function pullOnce(handle: ServerHandle, deps: PullDeps = {}): Promise<void> {
  const opts = handle.mode === 'serve' ? getOptions(handle).git : null;
  if (!opts) return;
  const { branch, remote } = opts;
  const cwd = handle.projectRoot;
  const root = docsRootOf(handle);
  const git = gitRunner(deps.execFile ?? realExec(), cwd);

  await (deps.lock ?? lockFor(root)).withLock(async () => {
    await git(fetchArgs(remote, branch));
    if ((await git(['rev-parse', 'HEAD'])) === (await git(['rev-parse', `origin/${branch}`]))) return;
    await recordChanges(git, branch, root, cwd);
    await git(['reset', '--hard', `origin/${branch}`]);
  });

  const moved = pendingFor(root);
  if (!moved.all && !moved.files.size) return;
  // Take what is pending now; changes recorded while the rebuild runs stay for the next one.
  const taken = { all: moved.all, files: [...moved.files] };
  moved.all = false;
  taken.files.forEach((f) => moved.files.delete(f));
  try {
    await handle.rebuild(taken.all ? undefined : taken.files);
  } catch (e) {
    // A build failure, not a git one: say so, and keep the changes for the next tick.
    console.error(`[threads] rebuild after pull failed: ${firstLine(String((e as Error)?.message ?? e)) ?? 'build failed'}`);
    if (taken.all) moved.all = true;
    taken.files.forEach((f) => moved.files.add(f));
  }
}

/**
 * Pulls every `git.pullSeconds` under `docmd serve`; a failed pull is logged on one line
 * (without the remote or any credential) and the next tick still runs. A tick while a pull
 * is running is skipped. Returns `stop`.
 */
export function startPullLoop(
  handle: ServerHandle,
  timers: PullTimers = { setInterval, clearInterval },
  deps: { execFile?: ExecFile } = {},
): () => void {
  const opts = handle.mode === 'serve' ? getOptions(handle).git : null;
  if (!opts) return () => undefined;
  let inFlight = false;
  const id = timers.setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    pullOnce(handle, deps)
      .catch(async (e: unknown) => {
        const err = e as { stderr?: unknown; message?: unknown };
        const text = typeof err?.stderr === 'string' && err.stderr.trim()
          ? err.stderr
          : String(err?.message ?? e).split('\n').filter((l) => !l.startsWith('Command failed:')).join('\n');
        let line = firstLine(text) ?? 'git failed';
        // What the remote name points at (a URL or path, maybe with credentials) is kept out of the log.
        const url = await gitRunner(deps.execFile ?? realExec(), handle.projectRoot)(['remote', 'get-url', opts.remote]).catch(() => '');
        for (const secret of [url, opts.remote]) if (secret) line = line.split(secret).join('<remote>');
        console.error(`[threads] git pull failed: ${line.replace(/\/\/[^@/\s]*@/g, '//***@')}`);
      })
      .finally(() => { inFlight = false; });
  }, opts.pullSeconds * 1000);
  (id as { unref?: () => void } | null)?.unref?.();
  return () => timers.clearInterval(id);
}

// ---------------------------------------------------------------------------
// Startup: the checkout must hold nothing the first reset would lose
// ---------------------------------------------------------------------------

interface CheckoutState {
  /** Tracked files with staged or unstaged changes, relative to the project root. */
  tracked: string[];
  /** Untracked, not ignored content files under the docs root, relative to the project root. */
  untracked: string[];
}

/**
 * Sorts `git status --porcelain=v1 -z --untracked-files=all` output into the tracked files that
 * changed and the untracked content files the server writes under the docs root: markdown pages,
 * `.threads/authors.json` and `.threads/reviews/*.json`. Ignored and other untracked files are
 * left out. `prefix` is where the project root sits in the repository (`git rev-parse
 * --show-prefix`, with its trailing slash); `docs` is the docs root relative to the project root.
 */
export function classifyStatus(output: string, where: { prefix?: string; docs?: string } = {}): CheckoutState {
  const prefix = (where.prefix ?? '').replace(/\/+$/, '');
  const docs = where.docs === '.' ? '' : (where.docs ?? '').replace(/^\.\//, '').replace(/\/+$/, '');
  const rel = (p: string) => (prefix ? path.posix.relative(prefix, p) : p);
  const under = (p: string, dir: string) => !dir || p.startsWith(`${dir}/`);
  const isContent = (p: string): boolean => {
    if (p.startsWith('../') || !under(p, docs)) return false;
    const inDocs = docs ? p.slice(docs.length + 1) : p;
    return inDocs.endsWith('.md') || inDocs === '.threads/authors.json' || /^\.threads\/reviews\/[^/]+\.json$/.test(inDocs);
  };
  const state: CheckoutState = { tracked: [], untracked: [] };
  const entries = output.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = rel(entry.slice(3));
    // A rename or copy carries the path it came from as the next entry.
    const from = /[RC]/.test(code) ? rel(entries[++i] ?? '') : '';
    if (code === '??') {
      if (isContent(file)) state.untracked.push(file);
    } else {
      state.tracked.push(file, ...(from ? [from] : []));
    }
  }
  return state;
}

const COMMIT_PENDING = 'DOCMD_THREADS_GIT_COMMIT_PENDING';
const refusal = (message: string, cause?: unknown) => new ThreadsError('config', message, cause === undefined ? undefined : { cause });

/** One line of what git said, with the remote's name and address and any credential in a URL left out. */
async function reasonOf(e: unknown, git: (args: string[]) => Promise<string>, remote: string): Promise<string> {
  const err = e as { stderr?: unknown; message?: unknown };
  const text = typeof err?.stderr === 'string' && err.stderr.trim()
    ? err.stderr
    : String(err?.message ?? e).split('\n').filter((l) => !l.startsWith('Command failed:')).join('\n');
  let line = firstLine(text)?.trim() ?? 'git failed';
  const url = await git(['remote', 'get-url', remote]).catch(() => '');
  for (const secret of [url, remote]) if (secret) line = line.split(secret).join('<remote>');
  return line.replace(/\/\/[^@/\s]*@/g, '//***@');
}

const commitPendingOn = (env: NodeJS.ProcessEnv): boolean => env[COMMIT_PENDING] === '1' || env[COMMIT_PENDING] === 'true';

/**
 * Under `docmd serve` with git sync on: refuses to start (a `config` error that lists them) when
 * the checkout holds work the first publish's or pull's reset would lose: changes to tracked files,
 * untracked pages, `authors.json` or review manifests, or local commits `origin/<branch>` lacks.
 * With DOCMD_THREADS_GIT_COMMIT_PENDING=1 those commits and one commit of the changes are put on
 * top of the remote head and pushed instead; the checkout is touched only once the push succeeded,
 * so any failure leaves it as it was found. Runs under the docs root's lock.
 */
export async function checkStartup(
  handle: ServerHandle,
  deps: { execFile?: ExecFile } = {},
): Promise<void> {
  const opts = handle.mode === 'serve' ? getOptions(handle).git : null;
  if (!opts) return;
  const { branch, remote, committer, skipDeployMarker } = opts;
  const cwd = handle.projectRoot;
  const root = docsRootOf(handle);
  const run = deps.execFile ?? realExec();
  const git = gitRunner(run, cwd);
  const commitPending = commitPendingOn(process.env);

  await lockFor(root).withLock(async () => {
    let prefix: string;
    try {
      prefix = await git(['rev-parse', '--show-prefix']);
    } catch (e) {
      throw refusal(`the checkout could not be inspected: ${await reasonOf(e, git, remote)}`, e);
    }
    try {
      await git(fetchArgs(remote, branch));
    } catch (e) {
      throw refusal(`could not fetch the remote branch ${branch}: ${await reasonOf(e, git, remote)}`, e);
    }
    let state: CheckoutState;
    let ahead: string[];
    try {
      // Untrimmed: the first entry may begin with a space (an unstaged change).
      const { stdout: status } = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: MAX_BUFFER });
      state = classifyStatus(status, { prefix, docs: path.relative(cwd, root).split(path.sep).join('/') });
      ahead = (await git(['log', '--format=%h %s', `origin/${branch}..HEAD`])).split('\n').filter(Boolean);
    } catch (e) {
      throw refusal(`the checkout could not be inspected: ${await reasonOf(e, git, remote)}`, e);
    }
    const changed = [...new Set([...state.tracked, ...state.untracked])];
    if (!changed.length && !ahead.length) return;

    if (!commitPending) {
      const lines = ['docmd serve will not start: the checkout holds work that is not on the remote branch, and the first publish or pull would discard it.'];
      if (state.tracked.length) lines.push('Changed tracked files:', ...state.tracked.map((f) => `  ${f}`));
      if (state.untracked.length) lines.push('Untracked content files:', ...state.untracked.map((f) => `  ${f}`));
      if (ahead.length) lines.push(`Local commits not on ${branch} of the remote:`, ...ahead.map((c) => `  ${c}`));
      lines.push(`Set ${COMMIT_PENDING}=1 to push the local commits and to commit and push the changes as one commit before starting.`);
      throw refusal(lines.join('\n'));
    }

    try {
      await pushPending({ run, cwd, git, branch, remote, committer, marker: skipDeployMarker, changed, commits: ahead.length, prefix });
    } catch (e) {
      if (e instanceof ThreadsError) throw e;
      throw refusal(`the pending work could not be pushed: ${await reasonOf(e, git, remote)}; the checkout is unchanged`, e);
    }
    console.log(`[threads] pushed ${ahead.length} local commit${ahead.length === 1 ? '' : 's'} and committed ${changed.length} file${changed.length === 1 ? '' : 's'} found at startup`);
  });
}

interface PendingJob {
  run: ExecFile;
  cwd: string;
  git: (args: string[]) => Promise<string>;
  branch: string;
  remote: string;
  committer: { name: string; email: string };
  marker: string;
  changed: string[];
  commits: number;
  /** Where the project root sits in the repository, with its trailing slash (empty at the top). */
  prefix: string;
}

/**
 * Builds, without touching the checkout, the local commits and one commit of `changed` on top of
 * `origin/<branch>` (each is replayed with a three-way merge that fails on a conflict), pushes the
 * result, and only then moves the checkout onto it. Git objects are the only thing a failure leaves.
 */
async function pushPending(job: PendingJob): Promise<void> {
  const { run, cwd, git, branch, remote, committer, marker, changed } = job;
  if (await git(['ls-files', '--unmerged'])) throw refusal('the pending work could not be pushed: the checkout has unresolved merge conflicts; the checkout is unchanged');
  if (await git(['rev-list', '--merges', `origin/${branch}..HEAD`])) throw refusal('the pending work could not be pushed: the local commits include a merge commit; the checkout is unchanged');

  // merge-tree --write-tree and --merge-base need git 2.40.
  const version = /(\d+)\.(\d+)/.exec(await git(['version']));
  if (!version || +version[1] < 2 || (+version[1] === 2 && +version[2] < 40)) throw refusal(`${COMMIT_PENDING} needs git 2.40 or later; the checkout is unchanged`);
  // A file with a different staged and working-tree version would lose its staged bytes: the working-tree one is committed, so say so instead.
  const staged = new Set((await git(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean));
  const both = (await git(['diff', '--name-only', '-z'])).split('\0').filter((f) => staged.has(f));
  if (both.length) throw refusal(`the pending work could not be pushed: these files have staged changes that differ from the working tree: ${both.join(', ')}; the checkout is unchanged`);

  const head = await git(['rev-parse', 'HEAD']);
  // The commit of the changes, on HEAD, from a private index so the checkout's own is not read or written.
  let pendingCommit: string | null = null;
  if (changed.length) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'docmd-threads-'));
    try {
      const tmp = gitRunner(run, cwd, { GIT_INDEX_FILE: path.join(scratch, 'index') });
      await tmp(['read-tree', 'HEAD']);
      for (const file of changed) {
        // Git decides: a present file (or symlink) is added, a missing one removed.
        await tmp(['update-index', '--add', '--remove', '--', file]);
      }
      const tree = await tmp(['write-tree']);
      pendingCommit = await gitRunner(run, cwd, identityEnv(committer.name, committer.email))([
        'commit-tree', tree, '-p', head, '-m', `chore(threads): commit changes found at startup ${marker}`, '-m', changed.join('\n'),
      ]);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  // Replay the local commits, then the changes, on the remote head.
  const queue = (await git(['rev-list', '--reverse', `origin/${branch}..HEAD`])).split('\n').filter(Boolean);
  if (pendingCommit) queue.push(pendingCommit);
  let tip = await git(['rev-parse', `origin/${branch}`]);
  for (const commit of queue) {
    const parent = await git(['rev-parse', `${commit}^`]);
    const tree = (await git(['merge-tree', '--write-tree', '--no-messages', `--merge-base=${parent}`, tip, commit])).split('\n')[0];
    const meta = (await git(['log', '-1', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', commit])).split('\0');
    const message = await git(['log', '-1', '--format=%B', commit]);
    tip = await gitRunner(run, cwd, {
      GIT_AUTHOR_NAME: meta[0], GIT_AUTHOR_EMAIL: meta[1], GIT_AUTHOR_DATE: meta[2],
      GIT_COMMITTER_NAME: meta[3], GIT_COMMITTER_EMAIL: meta[4], GIT_COMMITTER_DATE: meta[5],
    })(['commit-tree', tree, '-p', tip, '-m', message]);
  }

  // The move onto the pushed tip (`reset --hard`) writes only the paths that differ between HEAD and the tip, and silently replaces
  // whatever untracked or ignored file is in its way. Look at just those paths (bounded by the diff, not by the repository), from the
  // top level, before pushing, so a refusal leaves everything as found.
  const topDir = await git(['rev-parse', '--show-toplevel']);
  const top = gitRunner(run, topDir);
  const own = new Set(changed.map((f) => path.posix.normalize(path.posix.join(job.prefix, f))));
  const written = (await top(['diff', '--name-only', '--no-renames', '-z', 'HEAD', tip])).split('\0').filter(Boolean);
  const prefixes = (f: string) => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));
  const lookups = [...new Set(written.flatMap((f) => [f, ...prefixes(f)]))];
  const tracked = new Set<string>();
  const folders = new Set<string>();
  for (let i = 0; i < lookups.length; i += 200) {
    for (const entry of (await top(['ls-tree', '-r', '-t', '-z', 'HEAD', '--', ...lookups.slice(i, i + 200)])).split('\0')) {
      const [meta, name] = entry.split('\t');
      if (!name) continue;
      tracked.add(name);
      if (meta.split(' ')[1] === 'tree') folders.add(name);
    }
  }
  // A folder HEAD tracks that the tip turns into a file: the move deletes whatever else sits in it.
  const replaced: string[] = [];
  const maybe = written.filter((f) => folders.has(f));
  for (let i = 0; i < maybe.length; i += 200) {
    for (const entry of (await top(['ls-tree', '-r', '-t', '-z', tip, '--', ...maybe.slice(i, i + 200)])).split('\0')) {
      const [meta, name] = entry.split('\t');
      if (name && maybe.includes(name) && meta.split(' ')[1] !== 'tree') replaced.push(name);
    }
  }
  const strays: string[] = [];
  for (const f of replaced) {
    const left = [
      await top(['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--', f]),
      await top(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', f]),
    ];
    if (left.some(Boolean)) strays.push(f);
  }
  const onDisk = (f: string) => {
    try {
      return fs.lstatSync(safePath(topDir, f), { throwIfNoEntry: false });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined; // a file stands where a folder is expected: its own prefix is the finding
      throw e;
    }
  };
  const collide = [...strays, ...written.filter((f) =>
    (!own.has(f) && !tracked.has(f) && onDisk(f)) ||
    prefixes(f).some((q) => !tracked.has(q) && onDisk(q)?.isDirectory() === false))];
  if (collide.length) throw refusal(`the pending work could not be pushed: untracked or ignored files would be overwritten by files on the remote branch: ${collide.join(', ')}; the checkout is unchanged`);

  await git([...AUTH, 'push', remote, `${tip}:refs/heads/${branch}`]);
  // Pushed: the remote has everything, so the checkout can move onto it.
  try {
    await git(['update-ref', `refs/remotes/origin/${branch}`, tip]);
    await git(['reset', '--hard', `origin/${branch}`]);
  } catch (e) {
    throw refusal(`the pending work was pushed, but the checkout could not be moved onto it: ${await reasonOf(e, git, remote)}`, e);
  }
}

const identityEnv = (name: string, email: string): NodeJS.ProcessEnv => ({
  GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
});
