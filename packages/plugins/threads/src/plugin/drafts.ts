import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import type { DraftOp, Journal, NewDraftOp } from '../types.js';

export interface DraftStore {
  /** The caller's journal; a fresh (unsaved) one when none exists. */
  load(key: string): Promise<Journal>;
  /**
   * One locked read-modify-write cycle: `fn` sees the journal and the cycle's
   * timestamp and may change `ops`. A throw leaves the file untouched. Use it
   * whenever a decision depends on the journal's current content.
   */
  transact(key: string, fn: (journal: Journal, at: string) => void): Promise<Journal>;
}

export interface DraftStoreOptions {
  /** Clock, epoch ms. */
  now?: () => number;
}

/** File name stem for a key. */
export const slug = (key: string): string => encodeURIComponent(key).replace(/%/g, '_');

/** Complete an op with its id and timestamp. */
export const makeOp = (op: NewDraftOp, at: string): DraftOp =>
  ({ ...op, opId: 'o-' + crypto.randomBytes(4).toString('hex'), at }) as DraftOp;

const isNotFound = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT';
const isExists = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'EEXIST';

export function createDraftStore(docsRoot: string, { now = Date.now }: DraftStoreOptions = {}): DraftStore {
  const dir = safePath(docsRoot, path.join('.threads', 'drafts'));
  const nameOf = (key: string) => `${slug(key)}.json`;
  const iso = () => new Date(now()).toISOString();

  // One queue per store: read-modify-write cycles never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const fresh = (): Journal => ({ version: 1, ops: [] });

  async function read(key: string): Promise<Journal> {
    const file = safePath(dir, nameOf(key));
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (e) {
      if (isNotFound(e)) return fresh();
      throw e;
    }
    try {
      const j = JSON.parse(text);
      if (j && j.version === 1 && Array.isArray(j.ops)) return { version: 1, ops: j.ops };
    } catch {
      // fall through: corrupt
    }
    await fs.promises.rename(file, `${file}.corrupt-${now()}`);
    return fresh();
  }

  async function write(key: string, journal: Journal): Promise<void> {
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      await fs.promises.writeFile(safePath(dir, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' });
    } catch (e) {
      if (!isExists(e)) throw e;
    }
    const file = safePath(dir, nameOf(key));
    const tmp = safePath(dir, `${nameOf(key)}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`);
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(journal, null, 2) + '\n');
      await fs.promises.rename(tmp, file);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw e;
    }
  }

  return {
    load: (key) => locked(() => read(key)),
    transact: (key, fn) =>
      locked(async () => {
        const journal = await read(key);
        fn(journal, iso());
        await write(key, journal);
        return journal;
      }),
  };
}
