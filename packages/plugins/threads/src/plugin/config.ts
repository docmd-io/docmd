import { ThreadsError } from './errors.js';

export interface ThreadsOptions {
  sidebar: boolean;
  /** `false`: collect-only. Otherwise drafts publish `seconds` after the last edit while a user's mode is auto. */
  autoPublish: false | { seconds: number; startOn: boolean };
  /** Who may change what under `docmd serve`: `admins` may do everything; `resolve` says who may resolve a thread. */
  permissions: { admins: string[]; resolve: 'anyone' | 'author' };
  /** Guards against a runaway agent: the longest comment body (code points) and the most new threads plus comments per author key per minute. */
  limits: { maxCommentChars: number; commentsPerMinute: number };
  /** Git sync of published reviews; used under `docmd serve` only. `null` is off. */
  git: null | {
    branch: string;
    remote: string;
    /** Appended to every commit subject so the host's CI skips the deploy. */
    skipDeployMarker: string;
    /** How often the server fetches the branch and rebuilds what other people changed. */
    pullSeconds: number;
    /**
     * The request header (case-insensitive) that carries the commenter's e-mail, e.g. a proxy's
     * `X-Auth-Request-Email`. Read only while making that person's commit; never stored. Only a
     * proxy that strips the client's own copy of the header may set it.
     */
    authorEmailHeader?: string;
    /** Who commits; the commenter is the author. */
    committer: { name: string; email: string };
  };
}

const bad = (key: string, why: string): never => {
  const where = key ? `plugins.threads.${key}` : 'plugins.threads';
  throw new ThreadsError('config', `${where} ${why}`);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A sub-object option: absent gives {}, anything else must be an object. */
function section(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = raw[key];
  if (v === undefined) return {};
  if (!isObject(v)) bad(key, 'must be an object');
  return v as Record<string, unknown>;
}

function positiveNumber(obj: Record<string, unknown>, path: string, key: string, def: number): number {
  const v = obj[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) bad(`${path}.${key}`, 'must be a positive number');
  return v as number;
}

function positiveInteger(obj: Record<string, unknown>, path: string, key: string, def: number): number {
  const v = obj[key] ?? def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) bad(`${path}.${key}`, 'must be a positive integer');
  return v as number;
}

function nonEmptyString(obj: Record<string, unknown>, path: string, key: string, def?: string): string {
  const v = obj[key] ?? def;
  if (typeof v !== 'string' || !v.trim()) bad(`${path}.${key}`, 'must be a non-empty string');
  return v as string;
}

/** A value that goes into a git argument: a leading dash would be read as an option. */
function gitArgument(obj: Record<string, unknown>, key: string, def?: string): string {
  const v = nonEmptyString(obj, 'git', key, def);
  if (v.trim().startsWith('-')) bad(`git.${key}`, 'must not start with "-"');
  return v;
}

function optionalBoolean(obj: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = obj[key] ?? def;
  if (typeof v !== 'boolean') bad(key, 'must be a boolean');
  return v as boolean;
}

/**
 * Turn the raw `plugins.threads` value (object, `true`, or absent) into a
 * complete ThreadsOptions. Pure: no I/O.
 */
export function normalizeOptions(rawInput?: unknown): ThreadsOptions {
  if (rawInput !== undefined && rawInput !== true && rawInput !== null && !isObject(rawInput)) {
    bad('', 'must be an object');
  }
  const raw: Record<string, unknown> = isObject(rawInput) ? rawInput : {};

  let autoPublish: ThreadsOptions['autoPublish'];
  if (raw.autoPublish === false) {
    autoPublish = false;
  } else {
    const ap = section(raw, 'autoPublish');
    const startOn = ap.startOn ?? true;
    if (typeof startOn !== 'boolean') bad('autoPublish.startOn', 'must be a boolean');
    autoPublish = { seconds: positiveNumber(ap, 'autoPublish', 'seconds', 180), startOn: startOn as boolean };
  }

  const perms = section(raw, 'permissions');
  const admins = perms.admins ?? [];
  if (!Array.isArray(admins) || admins.some((a) => typeof a !== 'string')) {
    bad('permissions.admins', 'must be an array of strings');
  }
  const resolve = perms.resolve ?? 'anyone';
  if (resolve !== 'anyone' && resolve !== 'author') bad('permissions.resolve', "must be 'anyone' or 'author'");

  const lim = section(raw, 'limits');

  let git: ThreadsOptions['git'] = null;
  if (raw.git !== undefined && raw.git !== null) {
    const g = section(raw, 'git');
    const c = g.committer === undefined ? {} : isObject(g.committer) ? g.committer : bad('git.committer', 'must be an object');
    const authorEmailHeader = g.authorEmailHeader === undefined ? undefined : nonEmptyString(g, 'git', 'authorEmailHeader');
    if (authorEmailHeader !== undefined && /^(set-)?cookie$/i.test(authorEmailHeader.trim())) {
      bad('git.authorEmailHeader', 'must not be cookie or set-cookie');
    }
    git = {
      branch: gitArgument(g, 'branch'),
      remote: gitArgument(g, 'remote', 'origin'),
      skipDeployMarker: nonEmptyString(g, 'git', 'skipDeployMarker', '[skip ci]'),
      pullSeconds: positiveNumber(g, 'git', 'pullSeconds', 60),
      ...(authorEmailHeader !== undefined ? { authorEmailHeader: authorEmailHeader.trim() } : {}),
      committer: {
        name: nonEmptyString(c, 'git.committer', 'name', 'docmd threads'),
        email: nonEmptyString(c, 'git.committer', 'email', 'threads@docmd.invalid'),
      },
    };
  }

  return {
    sidebar: optionalBoolean(raw, 'sidebar', false),
    autoPublish,
    permissions: { admins: [...(admins as string[])], resolve: resolve as 'anyone' | 'author' },
    limits: {
      maxCommentChars: positiveInteger(lim, 'limits', 'maxCommentChars', 5000),
      commentsPerMinute: positiveInteger(lim, 'limits', 'commentsPerMinute', 10),
    },
    git,
  };
}

/**
 * Checks that need the process environment, run when the server starts: with git
 * sync on, the push credential must be set (there is no default).
 */
export function assertRuntime(opts: ThreadsOptions, env: NodeJS.ProcessEnv): void {
  if (opts.git && !env.DOCMD_THREADS_GIT_TOKEN) {
    throw new ThreadsError('config', 'DOCMD_THREADS_GIT_TOKEN is required when plugins.threads.git is set');
  }
  const pending = env.DOCMD_THREADS_GIT_COMMIT_PENDING;
  if (opts.git && pending && pending !== '1' && pending !== 'true') {
    throw new ThreadsError('config', 'DOCMD_THREADS_GIT_COMMIT_PENDING must be 1 or true, or unset');
  }
}

/** The normalized plugin options for the project an action call belongs to. */
export function getOptions(ctx: { config?: { plugins?: { threads?: unknown } } }): ThreadsOptions {
  return normalizeOptions(ctx.config?.plugins?.threads);
}
