import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import * as parser from './parser.js';
import { markPattern, splitPage, threadsBlockStart } from './marks.js';
import type { Thread } from '../types.js';

const SKIPPED_DIRS = new Set(['.threads', 'node_modules', '.git']);
const BATCH = 32;

const errorCode = (e: unknown): unknown => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);

/**
 * Flag every thread whose anchor quote has lost its `==...=={id}` mark in the page body
 * (the part above the threads block). Threads without an anchor are never flagged.
 * Pure: returns copies, the input is untouched.
 */
export function markOrphans(content: string, threads: Thread[]): Thread[] {
  const { body } = splitPage(content);
  return threads.map((t) => {
    if (!t.anchor?.quote) return t;
    return markPattern(t.id).test(body) ? t : { ...t, orphaned: true };
  });
}

/** Exported as the parameter type of `countOrphanedBy`. */
export interface OrphanScanDeps {
  /** Content of a file given the path `listMarkdown` returned. */
  readFile: (file: string) => Promise<string>;
  /** Every markdown file under `root`. */
  listMarkdown: (root: string) => Promise<string[]>;
}

/** Disk-backed deps for one docs root: recursive `*.md` listing, skipping `.threads`, `node_modules` and `.git`. */
export const fsOrphanScanDeps = (docsRoot: string): OrphanScanDeps => ({
  readFile: (file) => fs.promises.readFile(safePath(docsRoot, path.relative(docsRoot, file)), 'utf8'),
  async listMarkdown(root) {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(safePath(dir, '.'), { withFileTypes: true });
      } catch (e) {
        if (errorCode(e) === 'ENOENT') return;
        throw e;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!SKIPPED_DIRS.has(e.name)) await walk(path.join(dir, e.name));
        } else if (e.isFile() && e.name.endsWith('.md')) out.push(path.join(dir, e.name));
      }
    };
    await walk(root);
    return out;
  },
});

/**
 * Orphaned published threads, under `docsRoot`, whose first comment was written by
 * `authorKey`. Files without a threads block are not parsed; `.threads/`,
 * `node_modules` and `.git` are skipped whatever `listMarkdown` returns.
 */
export async function countOrphanedBy(docsRoot: string, authorKey: string, deps: OrphanScanDeps): Promise<number> {
  const files = (await deps.listMarkdown(docsRoot)).filter(
    (f) => !path.relative(docsRoot, f).split(/[\\/]/).some((seg) => SKIPPED_DIRS.has(seg)),
  );
  const countIn = async (file: string): Promise<number> => {
    let content: string;
    try {
      content = await deps.readFile(file);
    } catch (e) {
      // Gone since the listing (a publish or a pull replaced it): nothing to count.
      if (errorCode(e) === 'ENOENT') return 0;
      throw e;
    }
    if (threadsBlockStart(content) < 0) return 0;
    return markOrphans(content, parser.parseThreadsFromContent(content)).filter(
      (t) => t.orphaned && t.comments[0]?.authorKey === authorKey,
    ).length;
  };
  let total = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    total += (await Promise.all(files.slice(i, i + BATCH).map(countIn))).reduce((a, b) => a + b, 0);
  }
  return total;
}
