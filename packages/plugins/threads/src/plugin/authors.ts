import fs from 'node:fs';
import type { ActionContext } from '@docmd/api';
import { safePath } from '@docmd/utils';
import { docsRootOf } from './reviews.js';
import type { AuthorsMap } from '../types.js';

type RootCtx = Pick<ActionContext, 'projectRoot' | 'config'>;

const threadsDir = (ctx: RootCtx) => safePath(docsRootOf(ctx), '.threads');

/** `<docsRoot>/.threads/authors.json` as text; null when the file does not exist, any other failure throws. */
export async function readAuthorsRaw(ctx: RootCtx): Promise<string | null> {
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

/** Write the authors map, creating the directory if needed. */
export async function writeAuthors(ctx: RootCtx, authors: AuthorsMap): Promise<void> {
  const dir = threadsDir(ctx);
  await fs.promises.mkdir(safePath(dir, '.'), { recursive: true });
  await fs.promises.writeFile(safePath(dir, 'authors.json'), JSON.stringify(authors, null, 2) + '\n');
}
