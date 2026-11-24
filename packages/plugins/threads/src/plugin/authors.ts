import fs from 'node:fs';
import type { ActionContext } from '@docmd/api';
import { safePath } from '@docmd/utils';
import { docsRootOf } from './reviews.js';
import type { AuthorsMap } from '../types.js';

type RootCtx = Pick<ActionContext, 'projectRoot' | 'config'>;

const threadsDir = (ctx: RootCtx) => safePath(docsRootOf(ctx), '.threads');
const authorsPath = (ctx: RootCtx) => safePath(threadsDir(ctx), 'authors.json');

/** `<docsRoot>/.threads/authors.json` as text; null when the file does not exist, any other failure throws. */
export async function readAuthorsRaw(ctx: RootCtx): Promise<string | null> {
  try {
    return await fs.promises.readFile(authorsPath(ctx), 'utf8');
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
  await fs.promises.mkdir(threadsDir(ctx), { recursive: true });
  await fs.promises.writeFile(authorsPath(ctx), JSON.stringify(authors, null, 2) + '\n');
}
