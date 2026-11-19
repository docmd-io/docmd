import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ActionContext } from '@docmd/api';
import { safePath } from '@docmd/utils';
import * as parser from './parser.js';
import { ThreadsError } from './errors.js';
import type { Lock } from './lock.js';
import type { DraftStore } from './drafts.js';
import type { Caller, Comment, DraftOp, ManifestOp, PublishResult, ReviewManifest, Thread } from '../types.js';

const TITLE_MAX = 120;

const day = (iso: string) => iso.slice(0, 10);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let tmpSeq = 0;

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** Page title: frontmatter `title:` if present, else the first `# ` heading, else null. */
export function pageTitleOf(content: string): string | null {
  const lines = content.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^title:\s*(.*)$/.exec(l);
        if (m) {
          const t = m[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
          if (t) return t;
        }
      }
      i = end + 1;
    }
  }
  for (; i < lines.length; i++) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

const oneLine = (s: string, max: number) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/**
 * `Comments by <name>: <N> comment(s) on <first page title>[, +K page(s)]`.
 * N counts the comments a review adds (all ops when it adds none).
 * `pageTitles` maps a file to its page title; a file without one is named by its path.
 */
export function defaultTitle(
  name: string,
  ops: Array<Pick<DraftOp, 'kind' | 'file'>>,
  pageTitles: Record<string, string | null | undefined>,
): string {
  const added = ops.filter((o) => o.kind === 'add-thread' || o.kind === 'add-comment').length;
  const n = added || ops.length;
  const files = [...new Set(ops.map((o) => o.file))];
  const extra = files.length - 1;
  const pages = extra > 0 ? `, +${extra} page${extra === 1 ? '' : 's'}` : '';
  const first = files.length ? pageTitles[files[0]] || files[0] : '';
  return oneLine(`Comments by ${name}: ${n} comment${n === 1 ? '' : 's'} on ${first}${pages}`, TITLE_MAX);
}

// ---------------------------------------------------------------------------
// Applying ops to one file's markdown (pure)
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  authorKey: string;
  authorName: string;
  reviewId: string;
}

export interface ApplyResult {
  content: string;
  applied: ManifestOp[];
  skipped: Array<{ opId: string; reason: string }>;
}

/** A quote line that parses as a container fence would corrupt the threads block on re-parse. */
const unsafeQuote = (quote: string) => quote.split('\n').some((l) => l.trim() === ':::' || l.trim().startsWith('::: '));

/** Pattern for `==quote=={id}`; the quote may span lines. Group 1 is the quote. Without an id it matches any thread's mark. */
const markPattern = (threadId?: string, flags = '') =>
  new RegExp(`==((?:(?!==)[\\s\\S])+)==\\{${threadId === undefined ? '[^}]+' : escapeRe(threadId)}\\}`, flags);

/** Offset of the first line that is exactly `::: threads` (the parser's rule), or -1. */
function threadsBlockStart(content: string): number {
  let offset = 0;
  for (const line of content.split('\n')) {
    if (line.trim() === '::: threads') return offset;
    offset += line.length + 1;
  }
  return -1;
}

/** Ranges of fenced code blocks and inline code spans, where `==q=={id}` would render literally. */
function codeRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let open: { fence: string; from: number } | null = null;
  for (const line of body.split('\n')) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) {
      if (fence && fence[0] === open.fence[0] && fence.length >= open.fence.length) {
        ranges.push([open.from, offset + line.length]);
        open = null;
      }
    } else if (fence) {
      open = { fence, from: offset };
    }
    offset += line.length + 1;
  }
  if (open) ranges.push([open.from, body.length]);
  for (const m of body.matchAll(/(`+)(?!`)(?:(?!\1)[^\n]|\n(?!\n))*?\1(?!`)/g)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/** A quote the highlight syntax cannot carry: the mark closes at the first `==`. */
const unmarkable = (quote: string) => quote.includes('==') || quote.startsWith('=') || quote.endsWith('=');

/**
 * Wrap the first occurrence of `quote` in the body (after the frontmatter, above the
 * threads block) as `==quote=={id}`, skipping occurrences that touch an existing mark
 * or sit in code. No free occurrence: the content is returned unchanged (the anchor is
 * still recorded).
 */
function wrapQuote(content: string, quote: string, threadId: string): string {
  const cut = threadsBlockStart(content);
  const body = cut >= 0 ? content.slice(0, cut) : content;
  const rest = cut >= 0 ? content.slice(cut) : '';
  const from = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(body)?.[0].length ?? 0;
  const spans = [...body.matchAll(markPattern(undefined, 'g'))].map((m) => [m.index, m.index + m[0].length]);
  spans.push(...codeRanges(body));
  let at = body.indexOf(quote, from);
  while (at >= 0 && spans.some(([a, b]) => at < b && at + quote.length > a)) at = body.indexOf(quote, at + 1);
  if (at < 0) return content;
  return body.slice(0, at) + `==${quote}=={${threadId}}` + body.slice(at + quote.length) + rest;
}

const unwrapThread = (content: string, threadId: string) => content.replace(markPattern(threadId, 'g'), '$1');

/**
 * Apply one file's ops (in order) to its markdown. Ops whose target is gone are
 * skipped with a reason. `applied` carries `before` (the state an op replaced),
 * `quote` (add-thread) and `pageTitle`. Replaying is safe for adds, edits and
 * deletes: an add whose id already carries this review's id counts as applied,
 * any other existing id is skipped. Resolve and reaction ops toggle.
 */
export function applyOps(content: string, ops: DraftOp[], opts: ApplyOptions): ApplyResult {
  const threads: Thread[] = parser.parseThreadsFromContent(content);
  const pageTitle = pageTitleOf(content) ?? undefined;
  const applied: ManifestOp[] = [];
  const skipped: ApplyResult['skipped'] = [];
  let text = content;
  let changed = false;

  const skip = (op: DraftOp, reason: string) => void skipped.push({ opId: op.opId, reason });
  const done = (op: DraftOp, extra: Partial<ManifestOp> = {}) => {
    const entry = { ...op, ...extra } as ManifestOp;
    if (pageTitle) entry.pageTitle = pageTitle;
    applied.push(entry);
  };

  for (const op of ops) {
    const thread = threads.find((t) => t.id === op.threadId);
    const comment = (id: string) => thread?.comments.find((c) => c.id === id);
    switch (op.kind) {
      case 'add-thread': {
        const quote = op.anchor?.quote;
        if (thread) {
          if (comment(op.commentId)?.reviewId === opts.reviewId) done(op, quote ? { quote } : {});
          else skip(op, `thread ${op.threadId} already exists`);
          break;
        }
        if (quote && unsafeQuote(quote)) {
          skip(op, 'anchor quote contains a container fence');
          break;
        }
        const first: Comment = {
          id: op.commentId, thread_id: op.threadId, parent_id: null, author: opts.authorName,
          date: day(op.at), edited_at: null, authorKey: opts.authorKey, reviewId: opts.reviewId,
          body: op.body, reactions: [],
        };
        const t: Thread = { id: op.threadId, resolved: false, resolved_by: null, resolved_at: null, comments: [first] };
        if (quote) {
          t.anchor = { quote };
          if (!unmarkable(quote)) text = wrapQuote(text, quote, op.threadId);
        }
        threads.push(t);
        changed = true;
        done(op, quote ? { quote } : {});
        break;
      }
      case 'add-comment': {
        if (!thread) {
          skip(op, `thread ${op.threadId} not found`);
          break;
        }
        const existing = comment(op.commentId);
        if (existing) {
          if (existing.reviewId === opts.reviewId) done(op);
          else skip(op, `comment ${op.commentId} already exists`);
          break;
        }
        thread.comments.push({
          id: op.commentId, thread_id: op.threadId, parent_id: op.parentId, author: opts.authorName,
          date: day(op.at), edited_at: null, authorKey: opts.authorKey, reviewId: opts.reviewId,
          body: op.body, reactions: [],
        });
        changed = true;
        done(op);
        break;
      }
      case 'edit-comment': {
        const c = comment(op.commentId);
        if (!c) {
          skip(op, thread ? `comment ${op.commentId} not found` : `thread ${op.threadId} not found`);
          break;
        }
        const before = { body: c.body, edited_at: c.edited_at };
        c.body = op.body;
        c.edited_at = day(op.at);
        changed = true;
        done(op, { before });
        break;
      }
      case 'delete-comment': {
        const idx = thread ? thread.comments.findIndex((c) => c.id === op.commentId) : -1;
        if (!thread || idx < 0) {
          skip(op, thread ? `comment ${op.commentId} not found` : `thread ${op.threadId} not found`);
          break;
        }
        const [removed] = thread.comments.splice(idx, 1);
        changed = true;
        done(op, { before: { comment: removed, index: idx } });
        break;
      }
      case 'delete-thread': {
        const idx = threads.findIndex((t) => t.id === op.threadId);
        if (idx < 0) {
          skip(op, `thread ${op.threadId} not found`);
          break;
        }
        const [removed] = threads.splice(idx, 1);
        text = unwrapThread(text, op.threadId);
        changed = true;
        done(op, { before: { thread: removed, index: idx } });
        break;
      }
      case 'resolve-thread': {
        if (!thread) {
          skip(op, `thread ${op.threadId} not found`);
          break;
        }
        const before = { resolved: thread.resolved, resolved_by: thread.resolved_by, resolved_at: thread.resolved_at };
        if (thread.resolved) {
          thread.resolved = false;
          thread.resolved_by = null;
          thread.resolved_at = null;
        } else {
          thread.resolved = true;
          thread.resolved_by = opts.authorName;
          thread.resolved_at = day(op.at);
        }
        changed = true;
        done(op, { before });
        break;
      }
      case 'toggle-reaction': {
        const c = comment(op.commentId);
        if (!c) {
          skip(op, thread ? `comment ${op.commentId} not found` : `thread ${op.threadId} not found`);
          break;
        }
        c.reactions ??= [];
        const r = c.reactions.find((x) => x.emoji === op.emoji);
        const present = !!r && r.authors.includes(opts.authorName);
        if (!r) c.reactions.push({ emoji: op.emoji, authors: [opts.authorName] });
        else if (!present) r.authors.push(opts.authorName);
        else {
          r.authors = r.authors.filter((a) => a !== opts.authorName);
          if (!r.authors.length) c.reactions = c.reactions.filter((x) => x !== r);
        }
        changed = true;
        done(op, { before: { present } });
        break;
      }
    }
  }

  if (!changed) return { content, applied, skipped };
  return { content: parser.replaceThreadsBlock(text, threads), applied, skipped };
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

/** `<docsRoot>`: the project root joined with the configured docs source folder. */
export const docsRootOf = (ctx: ActionContext): string => safePath(ctx.projectRoot, ctx.config?.src || '.');
const reviewsDir = (ctx: ActionContext) => safePath(docsRootOf(ctx), path.join('.threads', 'reviews'));

const isNotFound = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Atomic: written to a temporary file, then renamed into place. */
export async function writeManifest(ctx: ActionContext, manifest: ReviewManifest): Promise<void> {
  const dir = reviewsDir(ctx);
  await fs.promises.mkdir(safePath(dir, '.'), { recursive: true });
  const file = safePath(dir, `${manifest.id}.json`);
  const tmp = safePath(dir, `${manifest.id}.json.${process.pid}.${tmpSeq++}.tmp`);
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n');
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

/** The manifest, or null when there is none (or it is not a v1 manifest). */
export async function readManifest(ctx: ActionContext, id: string): Promise<ReviewManifest | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(safePath(reviewsDir(ctx), `${path.basename(id)}.json`), 'utf8');
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  try {
    const m = JSON.parse(text);
    return m && m.version === 1 && typeof m.id === 'string' && Array.isArray(m.ops) ? (m as ReviewManifest) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export interface PublishDeps {
  store: DraftStore;
  /** One lock per docs root: publishes of different callers never interleave. */
  lock: Lock;
  now?: () => number;
  newId?: (prefix: string) => string;
}

/** The key lands in `by <key>` and the name in `"<name>"`: the parser must read both back unchanged. */
function assertWritable({ key, name }: Caller): void {
  const parsed = parser.parseCommentInfo(`comment c-0 "${name}" "2026-01-01" by ${key}`);
  if (parsed?.authorKey !== key) {
    throw new ThreadsError('invalid', `threads:publish-review: author key ${JSON.stringify(key)} cannot be written (no whitespace allowed)`);
  }
  if (parsed.author !== name || /["\r\n]/.test(name)) {
    throw new ThreadsError('invalid', `threads:publish-review: author name ${JSON.stringify(name)} cannot be written (no quotes or line breaks)`);
  }
}

/**
 * Write the caller's journal into the markdown files it targets, record the
 * review manifest, and drop the published ops from the journal. All touched
 * pages and the manifest are written under one lock, or none are.
 */
export async function publish(
  caller: Caller,
  ctx: ActionContext,
  { store, lock, now = Date.now, newId = (prefix) => prefix + crypto.randomBytes(4).toString('hex') }: PublishDeps,
): Promise<PublishResult> {
  assertWritable(caller);
  return lock.withLock(async () => {
    const journal = await store.load(caller.key);
    if (!journal.ops.length) throw new ThreadsError('empty-review', 'there is nothing to publish');
    const ops = journal.ops;
    let reviewId = journal.review.id;
    const files = [...new Set(ops.map((o) => o.file))];
    const order = new Map(ops.map((o, i) => [o.opId, i]));

    // An earlier publish of this review wrote its files and manifest but failed to reset the
    // journal: do not apply again (toggles would flip back), only finish the reset.
    const earlier = await readManifest(ctx, reviewId);
    if (earlier?.state === 'published') {
      if (earlier.authorKey === caller.key) {
        await finishEarlierPublish(ctx, store, caller.key, newId);
        return { reviewId, skipped: earlier.skipped };
      }
      // The id belongs to someone else's review (an id collision): this journal moves to a fresh one.
      reviewId = newId('r-');
      await store.transact(caller.key, (j) => void (j.review.id = reviewId));
    }

    const applied: ManifestOp[] = [];
    const skipped: PublishResult['skipped'] = [];
    const titles: Record<string, string | null> = {};
    const results: Array<{ file: string; original: string; next: string }> = [];
    for (const file of files) {
      const fileOps = ops.filter((o) => o.file === file);
      let content: string;
      try {
        content = await ctx.readFile(file);
      } catch {
        for (const o of fileOps) skipped.push({ opId: o.opId, reason: `file ${file} not readable` });
        continue;
      }
      titles[file] = pageTitleOf(content);
      const result = applyOps(content, fileOps, { authorKey: caller.key, authorName: caller.name, reviewId });
      applied.push(...result.applied);
      skipped.push(...result.skipped);
      results.push({ file, original: content, next: result.content });
    }
    applied.sort((a, b) => (order.get(a.opId) ?? 0) - (order.get(b.opId) ?? 0));

    // Write everything or nothing: a failure restores the files already written.
    const written: typeof results = [];
    try {
      for (const r of results) {
        if (r.next === r.original) continue;
        written.push(r);
        await ctx.writeFile(r.file, r.next);
      }
      await writeManifest(ctx, {
        version: 1,
        id: reviewId,
        authorKey: caller.key,
        authorName: caller.name,
        title: defaultTitle(caller.name, applied.length ? applied : ops, titles),
        state: 'published',
        publishedAt: new Date(now()).toISOString(),
        ops: applied,
        skipped,
      });
    } catch (e) {
      const stuck: string[] = [];
      for (const r of written.reverse()) {
        try {
          await ctx.writeFile(r.file, r.original);
        } catch {
          stuck.push(r.file);
        }
      }
      if (stuck.length) {
        throw new ThreadsError(
          'invalid',
          `publish failed on the server (${e instanceof Error ? e.message : String(e)}) and these files could not be restored, check them: ${stuck.join(', ')}`,
          { cause: e },
        );
      }
      throw e;
    }

    // Drop what was published (ops drafted meanwhile stay) and start a fresh review.
    const published = new Set(ops.map((o) => o.opId));
    await store.transact(caller.key, (j) => {
      j.ops = j.ops.filter((o) => !published.has(o.opId));
      j.review.id = newId('r-');
    });
    return { reviewId, skipped };
  });
}

/**
 * Finish a publish whose files and manifest were written but whose journal reset failed:
 * drop the ops the manifest recorded (applied and skipped) and rotate the review id, so
 * ops still in the journal stand for what is really pending and later edits of the
 * published comments become real edit/delete ops. A no-op when the journal's review has no
 * published manifest.
 */
export async function finishEarlierPublish(
  ctx: ActionContext,
  store: DraftStore,
  key: string,
  newId: (prefix: string) => string = (prefix) => prefix + crypto.randomBytes(4).toString('hex'),
): Promise<void> {
  const manifest = await readManifest(ctx, (await store.load(key)).review.id);
  if (manifest?.state !== 'published' || manifest.authorKey !== key) return;
  const done = new Set([...manifest.ops.map((o) => o.opId), ...manifest.skipped.map((x) => x.opId)]);
  await store.transact(key, (j) => {
    if (j.review.id !== manifest.id) return;
    j.ops = j.ops.filter((o) => !done.has(o.opId));
    j.review.id = newId('r-');
  });
}
