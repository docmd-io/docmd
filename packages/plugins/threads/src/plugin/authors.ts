import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ActionContext } from '@docmd/api';
import { safePath } from '@docmd/utils';
import { docsRootOf } from './reviews.js';
import { lockFor } from './lock.js';
import type { Author, AuthorsMap } from '../types.js';

type RootCtx = Pick<ActionContext, 'projectRoot' | 'config' | 'docsRootOf'>;

const threadsDir = (ctx: RootCtx) => safePath(docsRootOf(ctx), '.threads');

/** `<docsRoot>/.threads/authors.json` as text; null when the file does not exist, any other failure throws. */
async function readAuthorsRaw(ctx: RootCtx): Promise<string | null> {
  try {
    return await fs.promises.readFile(safePath(threadsDir(ctx), 'authors.json'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

interface LoadedAuthors {
  mtimeMs: number;
  size: number;
  authors: AuthorsMap;
}
const loaded = new Map<string, LoadedAuthors>();

/**
 * The authors map of `<srcDir>/.threads/authors.json` for the build: the page scripts and the
 * build-time comment and reactions rules read it for every page, so it is parsed once per
 * process and again only when the file's modification time or size changes. {} when the file
 * is missing or not a JSON object (one log line per bad version of the file). The result is
 * shared: callers must not change it.
 */
export function loadAuthorsFile(srcDir: string): AuthorsMap {
  const file = path.resolve(srcDir, '.threads', 'authors.json');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    loaded.delete(file);
    return {};
  }
  const hit = loaded.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.authors;
  let authors: AuthorsMap = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Runtime schema is a plain object: arrays and primitives count as empty.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) authors = parsed as AuthorsMap;
  } catch (err) {
    console.error(`[threads] Failed to parse .threads/authors.json: ${(err as Error).message}. Using empty authors.`);
  }
  loaded.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, authors });
  return authors;
}

/** The authors map; {} when the file does not exist. */
export async function readAuthors(ctx: RootCtx): Promise<AuthorsMap> {
  const raw = await readAuthorsRaw(ctx);
  return raw === null ? {} : (JSON.parse(raw) as AuthorsMap);
}

/** Write the authors map, creating the directory if needed. Atomic: a reader sees the old file or the new one, never a partial one. */
async function writeAuthors(ctx: RootCtx, authors: AuthorsMap): Promise<void> {
  const dir = threadsDir(ctx);
  await fs.promises.mkdir(safePath(dir, '.'), { recursive: true });
  const file = safePath(dir, 'authors.json');
  const tmp = safePath(dir, `authors.json.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(authors, null, 2) + '\n');
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

/** The authors file as the sync is told about it: relative to the project root. */
export const authorsFileOf = (ctx: RootCtx): string => path.relative(ctx.projectRoot, safePath(threadsDir(ctx), 'authors.json'));

/**
 * Set one entry as a locked read-modify-write. Returns the undo: it puts the file back as it was
 * (removing it when it did not exist), for a publish that fails after this write.
 */
export function setAuthorEntry(ctx: RootCtx, key: string, entry: Author): Promise<() => Promise<void>> {
  const lock = lockFor(`${docsRootOf(ctx)}#authors`);
  return lock.withLock(async () => {
    const before = await readAuthorsRaw(ctx);
    const authors = before === null ? {} : (JSON.parse(before) as AuthorsMap);
    authors[key] = entry;
    await writeAuthors(ctx, authors);
    return () =>
      lock.withLock(async () => {
        if (before === null) await fs.promises.rm(safePath(threadsDir(ctx), 'authors.json'), { force: true });
        else await fs.promises.writeFile(safePath(threadsDir(ctx), 'authors.json'), before);
      });
  });
}

/** Change the authors map as one locked read-modify-write, so concurrent profile saves do not lose each other. */
export function updateAuthors(ctx: RootCtx, change: (authors: AuthorsMap) => void): Promise<void> {
  return lockFor(`${docsRootOf(ctx)}#authors`).withLock(async () => {
    const authors = await readAuthors(ctx);
    change(authors);
    await writeAuthors(ctx, authors);
  });
}
