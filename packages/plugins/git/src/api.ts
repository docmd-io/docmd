/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/plugin-git
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

export type ExecFile = (
  file: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer?: number }
) => Promise<{ stdout: string; stderr: string }>;

export const defaultExecFile: ExecFile = promisify(nodeExecFile) as unknown as ExecFile;

const MAX_BUFFER = 64 * 1024 * 1024;

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'generic';

export interface ParsedRemote {
  provider: GitProvider;
  hostname: string;
  owner: string;
  repo: string;
  fullPath: string; // e.g. "docmd-io/docmd" or "group/subgroup/project"
  rawUrl: string;
  isSsh: boolean;
  isHttps: boolean;
}

export interface RemoteUrlOptions {
  branch?: string;
  editSubpath?: string;
}

export interface GitRemoteUrls {
  provider: GitProvider;
  baseUrl: string;
  editUrl: string;
  blobUrl: string;
  commitUrl: (hash: string) => string;
  historyUrl: string;
  branchUrl: string;
}

export interface GitAuthOptions {
  token?: string;
  username?: string;
  provider?: GitProvider;
  envTokenVar?: string;
}

export interface GitAuthResolution {
  token?: string;
  username: string;
  envVar?: string;
  source: 'options' | 'env' | 'none';
}

export interface GitStatusResult {
  clean: boolean;
  branch: string;
  modified: string[];
  staged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface GitAuthor {
  name: string;
  email: string;
}

export interface CommitOptions {
  author?: GitAuthor;
  committer?: GitAuthor;
  skipHooks?: boolean;
}

export interface PushOptions {
  force?: boolean;
  setUpstream?: boolean;
  maxRetries?: number;
}

export interface PullOptions {
  resetHard?: boolean;
  rebase?: boolean;
}

export interface LogOptions {
  filePath?: string;
  maxCommits?: number;
  follow?: boolean;
}

export interface GitClientCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  timestamp: number;
  message: string;
}

export interface GitClientOptions {
  cwd?: string;
  remote?: string;
  branch?: string;
  auth?: GitAuthOptions;
  tokenEnvVar?: string;
  username?: string;
  execFile?: ExecFile;
}

export interface GitClient {
  readonly cwd: string;
  isInstalled(): Promise<boolean>;
  isRepository(): Promise<boolean>;
  getRoot(): Promise<string>;
  getCurrentBranch(): Promise<string>;
  getHeadCommit(): Promise<string>;
  getStatus(): Promise<GitStatusResult>;
  isClean(): Promise<boolean>;
  getRemoteUrl(remote?: string): Promise<string>;
  getParsedRemote(remote?: string): Promise<ParsedRemote | null>;
  fetch(remote?: string, branch?: string): Promise<void>;
  pull(remote?: string, branch?: string, options?: PullOptions): Promise<void>;
  stage(files: string | string[]): Promise<void>;
  commit(message: string, options?: CommitOptions): Promise<string>;
  push(remote?: string, branch?: string, options?: PushOptions): Promise<void>;
  getLog(options?: LogOptions): Promise<GitClientCommit[]>;
  getDiff(from?: string, to?: string, files?: string[]): Promise<string>;
}

// ---------------------------------------------------------------------------
// Remote URL Parsing & Provider Detection
// ---------------------------------------------------------------------------

/**
 * Parse any git remote URL (HTTPS, SSH, git://, scp-style) into structured provider metadata.
 * Detects GitHub, GitLab (including self-hosted / enterprise instances), Bitbucket, and generic hosts.
 */
export function parseRemoteUrl(rawUrl: string): ParsedRemote {
  const trimmed = (rawUrl || '').trim();
  let hostname = '';
  let pathPart = '';
  let isSsh = false;
  let isHttps = false;

  // SCP-style: git@github.com:owner/repo.git
  const scpMatch = trimmed.match(/^(?:[\w-]+@)?([^:]+):(.+)$/);
  // Standard URI: https://github.com/owner/repo.git or ssh://git@host:port/path
  const uriMatch = trimmed.match(/^(https?|ssh|git):\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/i);

  if (uriMatch) {
    const proto = uriMatch[1].toLowerCase();
    hostname = uriMatch[2].toLowerCase();
    pathPart = uriMatch[3];
    isHttps = proto === 'https';
    isSsh = proto === 'ssh';
  } else if (scpMatch) {
    hostname = scpMatch[1].toLowerCase();
    pathPart = scpMatch[2];
    isSsh = true;
  } else {
    // Fallback: treat whole input as path or host
    hostname = 'generic';
    pathPart = trimmed;
  }

  // Strip trailing slashes and .git suffix safely without polynomial backtracking
  let cleanPath = pathPart;
  while (cleanPath.endsWith('/')) {
    cleanPath = cleanPath.slice(0, -1);
  }
  if (cleanPath.toLowerCase().endsWith('.git')) {
    cleanPath = cleanPath.slice(0, -4);
  }
  const segments = cleanPath.split('/').filter(Boolean);

  let provider: GitProvider = 'generic';
  if (hostname === 'github.com' || hostname.includes('github')) {
    provider = 'github';
  } else if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
    provider = 'gitlab';
  } else if (hostname === 'bitbucket.org' || hostname.includes('bitbucket')) {
    provider = 'bitbucket';
  }

  const repo = segments.length > 0 ? segments[segments.length - 1] : '';
  const owner = segments.length > 1 ? segments.slice(0, segments.length - 1).join('/') : '';
  const fullPath = segments.join('/');

  return {
    provider,
    hostname,
    owner,
    repo,
    fullPath,
    rawUrl: trimmed,
    isSsh,
    isHttps
  };
}

/**
 * Remove embedded tokens or passwords from a git URL so it is safe to log.
 */
export function sanitizeGitUrl(url: string): string {
  if (!url) return '';
  return url.replace(/^(https?:\/\/)([^:@]+)(?::[^@]+)?@/i, '$1***@');
}

// ---------------------------------------------------------------------------
// Remote Link URL Generation
// ---------------------------------------------------------------------------

/**
 * Generate edit, view, history, and commit URLs for GitHub, GitLab, and Bitbucket.
 */
export function buildRemoteUrls(
  remoteInput: ParsedRemote | string,
  filePath: string = '',
  options: RemoteUrlOptions = {}
): GitRemoteUrls {
  const remote = typeof remoteInput === 'string' ? parseRemoteUrl(remoteInput) : remoteInput;
  const branch = options.branch || 'main';
  let cleanFile = filePath.replace(/\\/g, '/');
  while (cleanFile.startsWith('/')) {
    cleanFile = cleanFile.slice(1);
  }
  const baseWebUrl = `https://${remote.hostname}/${remote.fullPath}`;

  let editUrl = '';
  let blobUrl = '';
  let historyUrl = '';
  let commitUrl: (hash: string) => string;

  switch (remote.provider) {
    case 'github': {
      editUrl = cleanFile ? `${baseWebUrl}/edit/${branch}/${cleanFile}` : `${baseWebUrl}/edit/${branch}`;
      blobUrl = cleanFile ? `${baseWebUrl}/blob/${branch}/${cleanFile}` : `${baseWebUrl}/tree/${branch}`;
      historyUrl = cleanFile ? `${baseWebUrl}/commits/${branch}/${cleanFile}` : `${baseWebUrl}/commits/${branch}`;
      commitUrl = (hash: string) => `${baseWebUrl}/commit/${hash}`;
      break;
    }
    case 'gitlab': {
      editUrl = cleanFile ? `${baseWebUrl}/-/edit/${branch}/${cleanFile}` : `${baseWebUrl}/-/edit/${branch}`;
      blobUrl = cleanFile ? `${baseWebUrl}/-/blob/${branch}/${cleanFile}` : `${baseWebUrl}/-/tree/${branch}`;
      historyUrl = cleanFile ? `${baseWebUrl}/-/commits/${branch}/${cleanFile}` : `${baseWebUrl}/-/commits/${branch}`;
      commitUrl = (hash: string) => `${baseWebUrl}/-/commit/${hash}`;
      break;
    }
    case 'bitbucket': {
      editUrl = cleanFile ? `${baseWebUrl}/src/${branch}/${cleanFile}?mode=edit` : `${baseWebUrl}/src/${branch}`;
      blobUrl = cleanFile ? `${baseWebUrl}/src/${branch}/${cleanFile}` : `${baseWebUrl}/src/${branch}`;
      historyUrl = cleanFile ? `${baseWebUrl}/history-node/${branch}/${cleanFile}` : `${baseWebUrl}/commits/branch/${branch}`;
      commitUrl = (hash: string) => `${baseWebUrl}/commits/${hash}`;
      break;
    }
    default: {
      editUrl = cleanFile ? `${baseWebUrl}/${branch}/${cleanFile}` : `${baseWebUrl}/${branch}`;
      blobUrl = cleanFile ? `${baseWebUrl}/${branch}/${cleanFile}` : `${baseWebUrl}/${branch}`;
      historyUrl = `${baseWebUrl}/commits/${branch}`;
      commitUrl = (hash: string) => `${baseWebUrl}/commit/${hash}`;
      break;
    }
  }

  return {
    provider: remote.provider,
    baseUrl: baseWebUrl,
    editUrl,
    blobUrl,
    historyUrl,
    branchUrl: `${baseWebUrl}/tree/${branch}`,
    commitUrl
  };
}

export function getEditUrl(remoteInput: ParsedRemote | string, filePath: string, options: RemoteUrlOptions = {}): string {
  return buildRemoteUrls(remoteInput, filePath, options).editUrl;
}

export function getBlobUrl(remoteInput: ParsedRemote | string, filePath: string, options: RemoteUrlOptions = {}): string {
  return buildRemoteUrls(remoteInput, filePath, options).blobUrl;
}

export function getHistoryUrl(remoteInput: ParsedRemote | string, filePath: string, options: RemoteUrlOptions = {}): string {
  return buildRemoteUrls(remoteInput, filePath, options).historyUrl;
}

export function getCommitUrl(remoteInput: ParsedRemote | string, hash: string): string {
  return buildRemoteUrls(remoteInput).commitUrl(hash);
}

// ---------------------------------------------------------------------------
// Authentication & Credential Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve remote git access token and username.
 * Inspects explicit options first, then known environment variables:
 * - DOCMD_GIT_TOKEN
 * - DOCMD_THREADS_GIT_TOKEN
 * - GITHUB_TOKEN / GH_TOKEN
 * - GITLAB_TOKEN / GL_TOKEN
 * - GIT_TOKEN
 */
export function resolveGitAuth(options: GitAuthOptions = {}): GitAuthResolution {
  if (options.token) {
    return {
      token: options.token,
      username: options.username || defaultUsernameFor(options.provider),
      source: 'options'
    };
  }

  const envVarsToCheck: string[] = [];
  if (options.envTokenVar) envVarsToCheck.push(options.envTokenVar);
  envVarsToCheck.push('DOCMD_GIT_TOKEN', 'DOCMD_THREADS_GIT_TOKEN');

  if (options.provider === 'github' || !options.provider) {
    envVarsToCheck.push('GITHUB_TOKEN', 'GH_TOKEN');
  }
  if (options.provider === 'gitlab' || !options.provider) {
    envVarsToCheck.push('GITLAB_TOKEN', 'GL_TOKEN');
  }
  envVarsToCheck.push('GIT_TOKEN');

  for (const varName of envVarsToCheck) {
    const val = process.env[varName];
    if (val && val.trim()) {
      return {
        token: val.trim(),
        username: options.username || defaultUsernameFor(options.provider),
        envVar: varName,
        source: 'env'
      };
    }
  }

  return {
    token: undefined,
    username: options.username || defaultUsernameFor(options.provider),
    source: 'none'
  };
}

function defaultUsernameFor(provider?: GitProvider): string {
  switch (provider) {
    case 'gitlab':
      return 'oauth2';
    case 'bitbucket':
      return 'x-token-auth';
    case 'github':
    default:
      return 'x-access-token';
  }
}

/**
 * Build a safe git credential helper command that streams username and password
 * from the child process environment without leaking tokens on command line or disk.
 */
export function createCredentialHelper(
  tokenEnvVar: string = 'DOCMD_GIT_TOKEN',
  username: string = 'x-access-token'
): string {
  return `!f(){ echo username=${username}; echo "password=$${tokenEnvVar}"; }; f`;
}

/**
 * Returns arguments configuring an ephemeral credential helper for git commands.
 */
export function getAuthArgs(
  tokenEnvVar: string = 'DOCMD_GIT_TOKEN',
  username: string = 'x-access-token'
): string[] {
  return ['-c', 'credential.helper=', '-c', `credential.helper=${createCredentialHelper(tokenEnvVar, username)}`];
}

/**
 * Validate and sanitize a git remote (name or URL) against argument injection.
 */
export function sanitizeRemote(remote: string): string {
  if (typeof remote !== 'string') {
    throw new TypeError('Expected git remote to be a string');
  }
  const trimmed = remote.trim();
  if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('-')) {
    throw new Error(`Invalid git remote: "${remote}" cannot start with a dash or be empty`);
  }
  if (trimmed.startsWith('--upload-pack') || trimmed.startsWith('--receive-pack')) {
    throw new Error(`Forbidden git remote argument: "${remote}"`);
  }
  if (trimmed.startsWith('git@')) {
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1 || colonIdx === 4 || colonIdx === trimmed.length - 1) {
      throw new Error(`Invalid git remote URL: "${remote}"`);
    }
    const host = trimmed.slice(4, colonIdx);
    const repoPath = trimmed.slice(colonIdx + 1);
    if (!/^[a-zA-Z0-9_.-]+$/.test(host) || /[\s"';`$<>|&]/.test(repoPath)) {
      throw new Error(`Invalid git remote URL: "${remote}"`);
    }
  } else if (trimmed.includes('://')) {
    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:', 'git:', 'ssh:'].includes(parsed.protocol) || /[\s"';`$<>|&]/.test(trimmed)) {
        throw new Error();
      }
    } catch {
      throw new Error(`Invalid git remote URL: "${remote}"`);
    }
  } else if (!/^[a-zA-Z0-9._/-]+$/.test(trimmed)) {
    throw new Error(`Invalid git remote name: "${remote}"`);
  }
  return trimmed;
}

/**
 * Validate and sanitize a git branch name against argument injection.
 */
export function sanitizeBranch(branch: string): string {
  if (typeof branch !== 'string') {
    throw new TypeError('Expected git branch to be a string');
  }
  const trimmed = branch.trim();
  if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('-') || !/^[a-zA-Z0-9._/-]+$/.test(trimmed)) {
    throw new Error(`Invalid git branch name: "${branch}"`);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Git Client Implementation
// ---------------------------------------------------------------------------

export function createGitClient(options: GitClientOptions = {}): GitClient {
  const cwd = path.resolve(options.cwd || process.cwd());
  const runExec: ExecFile = options.execFile || defaultExecFile;
  const tokenEnvVar = options.tokenEnvVar || options.auth?.envTokenVar || 'DOCMD_GIT_TOKEN';

  const runGit = async (args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string }> => {
    for (const arg of args) {
      if (typeof arg !== 'string') {
        throw new TypeError('Git argument must be a string');
      }
      if (arg.startsWith('--upload-pack') || arg.startsWith('--receive-pack')) {
        throw new Error(`Forbidden git argument: ${arg}`);
      }
    }
    return runExec('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...extraEnv
      },
      maxBuffer: MAX_BUFFER
    });
  };

  const getAuthCLIArgs = (): string[] => {
    const auth = resolveGitAuth({
      ...options.auth,
      envTokenVar: tokenEnvVar,
      username: options.username || options.auth?.username
    });
    const effectiveVar = auth.envVar || tokenEnvVar;
    return getAuthArgs(effectiveVar, auth.username);
  };

  return {
    get cwd() {
      return cwd;
    },

    async isInstalled(): Promise<boolean> {
      try {
        await runGit(['--version']);
        return true;
      } catch {
        return false;
      }
    },

    async isRepository(): Promise<boolean> {
      try {
        const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree']);
        return stdout.trim() === 'true';
      } catch {
        return false;
      }
    },

    async getRoot(): Promise<string> {
      const { stdout } = await runGit(['rev-parse', '--show-toplevel']);
      return stdout.trim();
    },

    async getCurrentBranch(): Promise<string> {
      try {
        const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
        const branch = stdout.trim();
        if (branch && branch !== 'HEAD') return branch;
      } catch { /* ignore */ }
      const { stdout } = await runGit(['rev-parse', '--short', 'HEAD']);
      return stdout.trim();
    },

    async getHeadCommit(): Promise<string> {
      const { stdout } = await runGit(['rev-parse', 'HEAD']);
      return stdout.trim();
    },

    async getStatus(): Promise<GitStatusResult> {
      const { stdout } = await runGit(['status', '--porcelain=v1', '-b']);
      const lines = stdout.split('\n').filter(Boolean);

      let branch = '';
      let ahead = 0;
      let behind = 0;
      const modified: string[] = [];
      const staged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        if (line.startsWith('## ')) {
          const header = line.slice(3);
          const branchMatch = header.match(/^([^.\s]+)/);
          if (branchMatch) branch = branchMatch[1];
          const aheadMatch = header.match(/ahead (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          const behindMatch = header.match(/behind (\d+)/);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
          continue;
        }

        const indexStatus = line[0];
        const worktreeStatus = line[1];
        const filePath = line.slice(3).trim();

        if (indexStatus === '?' && worktreeStatus === '?') {
          untracked.push(filePath);
        } else {
          if (indexStatus && indexStatus !== ' ') {
            staged.push(filePath);
          }
          if (worktreeStatus && worktreeStatus !== ' ') {
            modified.push(filePath);
          }
        }
      }

      const clean = modified.length === 0 && staged.length === 0 && untracked.length === 0;

      return {
        clean,
        branch,
        modified,
        staged,
        untracked,
        ahead,
        behind
      };
    },

    async isClean(): Promise<boolean> {
      const status = await this.getStatus();
      return status.clean;
    },

    async getRemoteUrl(remote: string = 'origin'): Promise<string> {
      const safeRemote = sanitizeRemote(remote);
      const { stdout } = await runGit(['remote', 'get-url', '--', safeRemote]);
      return stdout.trim();
    },

    async getParsedRemote(remote: string = 'origin'): Promise<ParsedRemote | null> {
      try {
        const url = await this.getRemoteUrl(remote);
        return parseRemoteUrl(url);
      } catch {
        return null;
      }
    },

    async fetch(remote: string = 'origin', branch: string = 'main'): Promise<void> {
      const safeRemote = sanitizeRemote(remote);
      const safeBranch = sanitizeBranch(branch);
      const authArgs = getAuthCLIArgs();
      await runGit([...authArgs, 'fetch', '--', safeRemote, `+refs/heads/${safeBranch}:refs/remotes/${safeRemote}/${safeBranch}`]);
    },

    async pull(remote: string = 'origin', branch: string = 'main', pullOpts: PullOptions = {}): Promise<void> {
      const safeRemote = sanitizeRemote(remote);
      const safeBranch = sanitizeBranch(branch);
      await this.fetch(safeRemote, safeBranch);
      if (pullOpts.resetHard) {
        await runGit(['reset', '--hard', `${safeRemote}/${safeBranch}`]);
      } else if (pullOpts.rebase) {
        await runGit(['rebase', `${safeRemote}/${safeBranch}`]);
      } else {
        await runGit(['merge', '--ff-only', `${safeRemote}/${safeBranch}`]);
      }
    },

    async stage(files: string | string[]): Promise<void> {
      const fileList = Array.isArray(files) ? files : [files];
      if (fileList.length === 0) return;
      await runGit(['add', '--', ...fileList]);
    },

    async commit(message: string, commitOpts: CommitOptions = {}): Promise<string> {
      const args = ['commit', '-m', message];
      if (commitOpts.author) {
        const cleanName = commitOpts.author.name.replace(/[<>\r\n]+/g, ' ').trim();
        const cleanEmail = commitOpts.author.email.replace(/[<>\r\n]+/g, ' ').trim();
        args.push(`--author=${cleanName} <${cleanEmail}>`);
      }
      if (commitOpts.skipHooks) {
        args.push('--no-verify');
      }

      const extraEnv: NodeJS.ProcessEnv = {};
      if (commitOpts.committer) {
        extraEnv.GIT_COMMITTER_NAME = commitOpts.committer.name;
        extraEnv.GIT_COMMITTER_EMAIL = commitOpts.committer.email;
      }

      await runGit(args, extraEnv);
      return this.getHeadCommit();
    },

    async push(remote: string = 'origin', branch: string = 'main', pushOpts: PushOptions = {}): Promise<void> {
      const safeRemote = sanitizeRemote(remote);
      const safeBranch = sanitizeBranch(branch);
      const authArgs = getAuthCLIArgs();
      const args = [...authArgs, 'push'];
      if (pushOpts.force) args.push('--force');
      if (pushOpts.setUpstream) args.push('-u');
      args.push('--', safeRemote, `HEAD:refs/heads/${safeBranch}`);

      const maxRetries = pushOpts.maxRetries ?? 3;
      let attempt = 0;
      let lastError: any;

      while (attempt < maxRetries) {
        attempt++;
        try {
          await runGit(args);
          return;
        } catch (err: any) {
          lastError = err;
          if (attempt >= maxRetries) break;
          // Fetch latest upstream before retry
          try {
            await this.fetch(remote, branch);
          } catch { /* ignore fetch error on retry */ }
        }
      }

      throw lastError;
    },

    async getLog(logOpts: LogOptions = {}): Promise<GitClientCommit[]> {
      const maxCommits = logOpts.maxCommits || 10;
      const args = ['log', '-n', maxCommits.toString(), '--format=%H|%h|%an|%ae|%at|%s'];
      if (logOpts.follow) args.push('--follow');
      if (logOpts.filePath) {
        args.push('--', logOpts.filePath);
      }

      const { stdout } = await runGit(args);
      const lines = stdout.trim().split('\n').filter(Boolean);

      return lines.map((line) => {
        const [hash, shortHash, author, email, timestamp, ...messageParts] = line.split('|');
        const ts = parseInt(timestamp, 10) * 1000;
        return {
          hash,
          shortHash,
          author,
          email,
          timestamp: ts,
          date: new Date(ts).toISOString(),
          message: messageParts.join('|')
        };
      });
    },

    async getDiff(from?: string, to?: string, files?: string[]): Promise<string> {
      const args = ['diff'];
      if (from && to) {
        args.push(from, to);
      } else if (from) {
        args.push(from);
      }
      if (files && files.length > 0) {
        args.push('--', ...files);
      }
      const { stdout } = await runGit(args);
      return stdout;
    }
  };
}
