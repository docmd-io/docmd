import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ActionContext } from '@docmd/api';
import { safePath } from '@docmd/utils';
import { docsRootOf } from './reviews.js';
import { lockFor } from './lock.js';
import type { AuthorsMap } from '../types.js';

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
export function setAuthorEntry(ctx: RootCtx, key: string, entry: { name: string; avatarUrl: string }): Promise<() => Promise<void>> {
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
