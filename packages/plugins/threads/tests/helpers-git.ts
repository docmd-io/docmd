import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safePath } from '@docmd/utils';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = safePath(path.resolve(here, '..'), 'e2e/fixtures/playground-index.md');

export const BRANCH = 'main';

/** Run git in `cwd`; returns stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
}

const identify = (dir: string, name: string) => {
  git(dir, 'config', 'user.name', name);
  git(dir, 'config', 'user.email', `${name}@fixture.invalid`);
};

export interface RepoTrio {
  /** The bare repository the other two push to. */
  remote: string;
  /** The clone the plugin works in (the project root). */
  server: string;
  /** A second clone, to push behind the server's back. */
  other: string;
  /** The commit every case starts from. */
  base: string;
  /** Put remote and server back on the base commit and drop untracked files. */
  reset(): void;
  cleanup(): void;
}

/** A bare remote with one commit (docs/index.md and authors.json) and two clones of it. */
export function makeRepoTrio(): RepoTrio {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-git-'));
  const remote = path.join(dir, 'remote.git');
  const seed = path.join(dir, 'seed');
  const server = path.join(dir, 'server');
  const other = path.join(dir, 'other');
  git(dir, 'init', '--bare', '-b', BRANCH, remote);
  git(dir, 'init', '-b', BRANCH, seed);
  identify(seed, 'seed');
  fs.mkdirSync(safePath(seed, 'docs/.threads'), { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(seed, 'docs', 'index.md'));
  fs.copyFileSync(FIXTURE, path.join(seed, 'docs', 'extra.md'));
  fs.writeFileSync(
    safePath(seed, 'docs/.threads/authors.json'),
    JSON.stringify({ ann: { name: 'Ann Lee', avatarUrl: '' } }, null, 2) + '\n',
  );
  // Drafts are per-server state, never committed.
  fs.writeFileSync(safePath(seed, '.gitignore'), 'docs/.threads/drafts/\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'base');
  git(seed, 'push', remote, `HEAD:refs/heads/${BRANCH}`);
  const base = git(seed, 'rev-parse', 'HEAD').trim();
  for (const [clone, name] of [[server, 'server'], [other, 'other']] as const) {
    git(dir, 'clone', '-b', BRANCH, remote, clone);
    identify(clone, name);
  }
  return {
    remote, server, other, base,
    reset() {
      git(remote, 'update-ref', `refs/heads/${BRANCH}`, base);
      git(server, 'fetch', 'origin');
      git(server, 'reset', '--hard', base);
      git(server, 'clean', '-fdx');
      git(other, 'fetch', 'origin');
      git(other, 'reset', '--hard', base);
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Append `text` to `file` in the clone, commit and push it. */
export function commitOn(clone: string, file: string, text: string): void {
  fs.appendFileSync(safePath(clone, file), `\n${text}\n`);
  git(clone, 'add', '-A');
  git(clone, 'commit', '-m', `other: ${text}`);
  git(clone, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`);
}

/** Delete `file` in the clone, commit and push it. */
export function removeOn(clone: string, file: string): void {
  git(clone, 'rm', '-q', file);
  git(clone, 'commit', '-m', `other: remove ${file}`);
  git(clone, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`);
}

/** `git log --format=<fmt>` on the remote's branch, oldest first. */
export function log(remote: string, fmt: string): string[] {
  return git(remote, 'log', '--reverse', `--format=${fmt}`, BRANCH).split('\n').filter(Boolean);
}
