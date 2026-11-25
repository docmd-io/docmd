import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActionContext } from '@docmd/api';
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
  lock: Lock;
  execFile?: ExecFile;
}

const MAX_ATTEMPTS = 3;

/** Reads the token from the child environment: it is never an argument, a URL or a file. */
const CREDENTIAL_HELPER = '!f(){ echo username=x-access-token; echo "password=$DOCMD_THREADS_GIT_TOKEN"; }; f';

/** A name or email as `--author` takes it: no angle brackets or line breaks. */
const ident = (s: string): string => s.replace(/[<>\r\n]+/g, ' ').trim();

/**
 * Git-backed sync: one commit per publish or discard, authored by the caller,
 * committed by the configured bot, pushed to the configured branch. A rejected
 * push is retried from the fresh remote head (the change is applied again).
 */
export function createGitSync(opts: NonNullable<ThreadsOptions['git']>, deps: GitSyncDeps): Sync {
  const { cwd, lock } = deps;
  const run: ExecFile = deps.execFile ?? (promisify(nodeExecFile) as unknown as ExecFile);
  const { branch, remote, skipDeployMarker, committer } = opts;

  // The child gets the server's environment: the credential helper reads the token from it.
  const git = (args: string[]) => run('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const auth = ['-c', 'credential.helper=', '-c', `credential.helper=${CREDENTIAL_HELPER}`];

  const syncToRemoteHead = async () => {
    await git([...auth, 'fetch', remote, `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
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

  const push = () => git([...auth, 'push', remote, `HEAD:refs/heads/${branch}`]);

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
  if (deps.execFile) return createGitSync(git, { cwd: ctx.projectRoot, lock, execFile: deps.execFile });
  let sync = syncs.get(`git:${root}`);
  if (!sync) syncs.set(`git:${root}`, (sync = createGitSync(git, { cwd: ctx.projectRoot, lock })));
  return sync;
}
