import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ActionContext, ServerHandle } from '@docmd/api';
import { safePath } from '@docmd/utils';
import fs from 'node:fs';
import { ThreadsError } from './errors.js';
import { getOptions, type ThreadsOptions } from './config.js';
import { createNoGitSync, lockFor, type Applied, type Lock, type PublishMeta, type Sync } from './lock.js';
import { docsRootOf } from './reviews.js';

export type ExecFile = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

export interface GitSyncDeps {
  cwd: string;
  /** The docs root: the key of the pages still to rebuild, and the folder a page must be under. */
  root: string;
  lock: Lock;
  execFile?: ExecFile;
}

const MAX_ATTEMPTS = 3;

/** Reads the token from the child environment: it is never an argument, a URL or a file. */
const CREDENTIAL_HELPER = '!f(){ echo username=x-access-token; echo "password=$DOCMD_THREADS_GIT_TOKEN"; }; f';

const AUTH = ['-c', 'credential.helper=', '-c', `credential.helper=${CREDENTIAL_HELPER}`];

const realExec = (): ExecFile => promisify(nodeExecFile) as unknown as ExecFile;
const firstLine = (text: string): string | undefined => text.split('\n').find((l) => l.trim());

/** Runs git in `cwd` with the server's environment (the credential helper reads the token from it); resolves to trimmed stdout. */
const gitRunner = (run: ExecFile, cwd: string) => async (args: string[]): Promise<string> =>
  (await run('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();

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

  const commit = async (meta: PublishMeta, applied: Applied) => {
    const subject = meta.kind === 'discard'
      ? `revert(threads): discard review "${applied.title}" ${skipDeployMarker}`
      : `${applied.title} ${skipDeployMarker}`;
    // The caller key is the email when it looks like one, else a placeholder address on a reserved domain.
    const email = meta.authorKey.includes('@') ? meta.authorKey : `${meta.authorKey.replace(/[^a-z0-9._-]+/gi, '-')}@threads.invalid`;
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
  const fail = (what: string, cause: unknown, after = '') => {
    const raw = cause instanceof Error ? cause.message : String(cause);
    console.error(`[threads] git ${what} failed: ${raw.replace(/\/\/[^@/\s]*@/g, '//***@')}`);
    return new ThreadsError('push-failed', `could not ${what} the remote branch ${branch}${after}; the review is unchanged, try again`, { cause });
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
          await commit(meta, applied);
        } catch (e) {
          await resetQuietly(meta);
          throw fail('commit to', e);
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

/**
 * The sync for this call: git-backed when `plugins.threads.git` is set and the host is
 * `docmd serve` (one per docs root), else the no-git one: under `docmd dev` the option is
 * ignored and no process is ever spawned. Both wrap the docs root's lock. An injected
 * `execFile` (tests) builds a fresh git sync on the same lock.
 */
export function getSync(ctx: ActionContext, deps: { execFile?: ExecFile } = {}): Sync {
  const root = docsRootOf(ctx);
  const lock = lockFor(root);
  const git = ctx.mode === 'serve' ? getOptions(ctx).git : null;
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
