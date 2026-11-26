import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import type { DraftMode, DraftOp, Journal, NewDraftOp } from '../types.js';

export interface DraftStore {
  /** The caller's journal; a fresh (unsaved) one when none exists. */
  load(key: string): Promise<Journal>;
  /**
   * One locked read-modify-write cycle: `fn` sees the journal and the cycle's
   * timestamp and may change `ops`; `review.updatedAt` is stamped after it. A
   * throw leaves the file untouched. Use it whenever a decision depends on the
   * journal's current content.
   */
  transact(key: string, fn: (journal: Journal, at: string) => void): Promise<Journal>;
  /** Change the caller's mode (also stamps `review.updatedAt`). */
  setMode(key: string, mode: DraftMode): Promise<Journal>;
  /** Change the caller's open review (also stamps `review.updatedAt`). */
  setReview(key: string, fields: { title?: string | null; summary?: string | null }): Promise<Journal>;
}

export interface DraftStoreOptions {
  /** Clock, epoch ms. */
  now?: () => number;
  /** Mode of a new journal and of a loaded one that has none; a function is read each time. */
  defaultMode?: DraftMode | (() => DraftMode);
}

/** File name stem for a key. */
export const slug = (key: string): string => encodeURIComponent(key).replace(/%/g, '_');

/** Complete an op with its id and timestamp. */
export const makeOp = (op: NewDraftOp, at: string): DraftOp =>
  ({ ...op, opId: 'o-' + crypto.randomBytes(4).toString('hex'), at }) as DraftOp;

const isNotFound = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT';
const isExists = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'EEXIST';

export function createDraftStore(
  docsRoot: string,
  { now = Date.now, defaultMode = 'collect' }: DraftStoreOptions = {},
): DraftStore {
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

  const modeByDefault = (): DraftMode => (typeof defaultMode === 'function' ? defaultMode() : defaultMode);
  const fresh = (): Journal => ({
    version: 1,
    mode: modeByDefault(),
    review: { id: 'r-' + crypto.randomBytes(4).toString('hex'), updatedAt: iso(), title: null, summary: null },
    ops: [],
  });

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
      if (j && j.version === 1 && Array.isArray(j.ops)) {
        // A journal saved before reviews existed has no id: derive a stable one from its ops, so a
        // publish that fails before the next write finds its own manifest again. The next write saves it.
        const id =
          typeof j.review?.id === 'string' && j.review.id
            ? j.review.id
            : 'r-' + crypto.createHash('sha256').update(JSON.stringify(j.ops)).digest('hex').slice(0, 8);
        // Journals saved before modes existed have no mode or updatedAt: the configured default mode,
        // and the file's own modification time so two loads without a write agree.
        const mode: DraftMode = j.mode === 'auto' || j.mode === 'collect' ? j.mode : modeByDefault();
        const updatedAt =
          typeof j.review?.updatedAt === 'string' && Number.isFinite(Date.parse(j.review.updatedAt))
            ? j.review.updatedAt
            : new Date((await fs.promises.stat(file)).mtimeMs).toISOString();
        const title = typeof j.review?.title === 'string' ? j.review.title : null;
        const summary = typeof j.review?.summary === 'string' ? j.review.summary : null;
        const p = j.profile;
        const profile = p && typeof p.name === 'string' && typeof p.avatarUrl === 'string' ? { name: p.name, avatarUrl: p.avatarUrl } : undefined;
        return { version: 1, mode, review: { id, updatedAt, title, summary }, ops: j.ops, ...(profile ? { profile } : {}) };
      }
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

  /** Read, change, stamp `review.updatedAt`, save. A throw in `fn` saves nothing. */
  const mutate = (key: string, fn: (j: Journal, at: string) => void): Promise<Journal> =>
    locked(async () => {
      const journal = await read(key);
      const at = iso();
      fn(journal, at);
      journal.review.updatedAt = at;
      await write(key, journal);
      return journal;
    });

  return {
    load: (key) => locked(() => read(key)),
    transact: mutate,
    setMode: (key, mode) =>
      mutate(key, (j) => {
        j.mode = mode;
      }),
    setReview: (key, { title, summary }) =>
      mutate(key, (j) => {
        if (title !== undefined) j.review.title = title;
        if (summary !== undefined) j.review.summary = summary;
      }),
  };
}
