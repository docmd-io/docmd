import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ActionContext } from '@docmd/api';
import { safePath } from '@docmd/utils';
import * as parser from './parser.js';
import { ThreadsError } from './errors.js';
import { markPattern, splitPage } from './marks.js';
import type { Sync } from './lock.js';
import { authorEmailOf } from './author-email.js';
import { authorsFileOf, setAuthorEntry } from './authors.js';
import type { DraftStore } from './drafts.js';
import type { Caller, Comment, DraftOp, Journal, ManifestOp, PublishResult, ReviewManifest, ReviewSummary, Thread } from '../types.js';

const TITLE_MAX = 120;
const SUMMARY_MAX = 2000;

const day = (iso: string) => iso.slice(0, 10);
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

/** A review title from the commenter: one line, at most 120 characters; empty means none. */
export const cleanTitle = (title: string): string | null => oneLine(title, TITLE_MAX) || null;

/** A review summary from the commenter: line breaks kept, trimmed, at most 2000 characters; blank means none. */
export const cleanSummary = (summary: string): string | null => summary.trim().slice(0, SUMMARY_MAX).trim() || null;

/**
 * The `title` / `summary` keys of an update-review payload, cleaned. A key that is absent stays absent;
 * `null` or a blank string clears; any other type, or neither key, is `threads/invalid`.
 */
export function parseReviewFields(payload: unknown): { title?: string | null; summary?: string | null } {
  const input = (payload ?? {}) as Record<string, unknown>;
  const out: { title?: string | null; summary?: string | null } = {};
  for (const [field, clean] of [['title', cleanTitle], ['summary', cleanSummary]] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new ThreadsError('invalid', `threads:update-review: ${field} must be a string or null`);
    out[field] = value === null ? null : clean(value);
  }
  if (!('title' in out) && !('summary' in out)) throw new ThreadsError('invalid', `threads:update-review: title or summary is required`);
  return out;
}

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
  /** Desired end state per opId for resolve-thread (resolved) and toggle-reaction (present); see deriveTargets. */
  targets?: Record<string, boolean>;
  /** Skip a delete of a thread's opening comment while others' replies exist, and a `delete-thread` that missed comments (set for serve callers). */
  enforce?: boolean;
}

export interface ApplyResult {
  content: string;
  applied: ManifestOp[];
  skipped: Array<{ opId: string; reason: string }>;
}

/** A quote line that parses as a container fence would corrupt the threads block on re-parse. */
const unsafeQuote = (quote: string) => quote.split('\n').some((l) => l.trim() === ':::' || l.trim().startsWith('::: '));

/**
 * `content` with every threads block blanked to line breaks (same length, so offsets
 * still match), and the ranges those blocks cover. Blank lines end any code span or
 * mark that would otherwise reach across a block.
 */
function maskThreadsBlocks(content: string): { text: string; blocks: Array<[number, number]> } {
  const lines = content.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const blocks = parser.findThreadsBlocks(lines).map(({ start, end }): [number, number] => [starts[start], starts[end] + lines[end].length]);
  let text = content;
  for (const [a, b] of blocks) text = text.slice(0, a) + '\n'.repeat(b - a) + text.slice(b);
  return { text, blocks };
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
 * Wrap the first occurrence of `quote` in the page text (after the frontmatter, outside
 * every threads block) as `==quote=={id}`, skipping occurrences that touch an existing
 * mark or sit in code. No free occurrence: the content is returned unchanged (the anchor
 * is still recorded).
 */
function wrapQuote(content: string, quote: string, threadId: string): string {
  const { text, blocks } = maskThreadsBlocks(content);
  const from = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)?.[0].length ?? 0;
  const spans = [...text.matchAll(markPattern(undefined, 'g'))].map((m) => [m.index, m.index + m[0].length]);
  spans.push(...codeRanges(text), ...blocks);
  let at = content.indexOf(quote, from);
  while (at >= 0 && spans.some(([a, b]) => at < b && at + quote.length > a)) at = content.indexOf(quote, at + 1);
  if (at < 0) return content;
  return content.slice(0, at) + `==${quote}=={${threadId}}` + content.slice(at + quote.length);
}

const unwrapThread = (content: string, threadId: string) => content.replace(markPattern(threadId, 'g'), '$1');

/**
 * Turn the toggle ops of one file into desired end states, from the file as first read:
 * resolve-thread -> resolved, toggle-reaction -> the author is present. Ops are walked in
 * order, so a second toggle of the same target flips the first one's result. Passing the
 * result to applyOps makes a re-run a no-op.
 */
export function deriveTargets(content: string, ops: DraftOp[], authorName: string): Record<string, boolean> {
  const threads = parser.parseThreadsFromContent(content);
  const resolved = new Map(threads.map((t) => [t.id, t.resolved]));
  const present = new Map<string, boolean>();
  for (const t of threads) {
    for (const c of t.comments) {
      for (const r of c.reactions ?? []) present.set(`${t.id}\0${c.id}\0${r.emoji}`, r.authors.includes(authorName));
    }
  }
  const targets: Record<string, boolean> = {};
  for (const op of ops) {
    if (op.kind === 'resolve-thread') {
      targets[op.opId] = !(resolved.get(op.threadId) ?? false);
      resolved.set(op.threadId, targets[op.opId]);
    } else if (op.kind === 'toggle-reaction') {
      const key = `${op.threadId}\0${op.commentId}\0${op.emoji}`;
      targets[op.opId] = !(present.get(key) ?? false);
      present.set(key, targets[op.opId]);
    }
  }
  return targets;
}

/**
 * Apply one file's ops (in order) to its markdown. Ops whose target is gone are
 * skipped with a reason. `applied` carries `before` (the state an op replaced),
 * `quote` (add-thread) and `pageTitle`. Replaying is safe for adds, edits and
 * deletes: an add whose id already carries this review's id counts as applied,
 * any other existing id is skipped. Resolve and reaction ops set the state in
 * `opts.targets` (see deriveTargets), or toggle when there is none.
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
        if (opts.enforce && idx === 0 && thread.comments.some((c, i) => i > 0 && c.reviewId !== opts.reviewId)) {
          skip(op, 'opening comment has replies; delete the thread');
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
        const seen = op.commentIds;
        if (opts.enforce && seen && threads[idx].comments.some((c) => !seen.includes(c.id))) {
          skip(op, 'thread has new comments');
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
        const want = opts.targets?.[op.opId] ?? !thread.resolved;
        if (want && !thread.resolved) {
          thread.resolved = true;
          thread.resolved_by = opts.authorName;
          thread.resolved_at = day(op.at);
          changed = true;
        } else if (!want && thread.resolved) {
          thread.resolved = false;
          thread.resolved_by = null;
          thread.resolved_at = null;
          changed = true;
        }
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
        const want = opts.targets?.[op.opId] ?? !present;
        if (want && !present) {
          if (r) r.authors.push(opts.authorName);
          else c.reactions.push({ emoji: op.emoji, authors: [opts.authorName] });
          changed = true;
        } else if (!want && present && r) {
          r.authors = r.authors.filter((a) => a !== opts.authorName);
          if (!r.authors.length) c.reactions = c.reactions.filter((x) => x !== r);
          changed = true;
        }
        done(op, { before: { present } });
        break;
      }
    }
  }

  if (!changed) return { content, applied, skipped };
  return { content: parser.replaceThreadsBlock(text, threads), applied, skipped };
}

/** What `applyOps` records in `before`, by op kind. */
interface Before {
  thread?: Thread;
  comment?: Comment;
  index: number;
  body: string;
  edited_at: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  present?: boolean;
}

interface ReverseResult {
  content: string;
  skipped: Array<{ opId: string; reason: string }>;
}

/**
 * Reverse one file's published ops (newest first) from the `before` states the manifest
 * recorded. Ops whose target is gone are skipped with a reason. Idempotent: a second run
 * changes nothing, because every step sets a state (removes an id, restores a value,
 * inserts only when absent) rather than flipping one. `authorName` is the review author's
 * display name: reactions are stored by name and a manifest op does not carry it.
 */
export function reverseOps(content: string, manifestOps: ManifestOp[], opts: { authorName: string }): ReverseResult {
  const threads: Thread[] = parser.parseThreadsFromContent(content);
  const skipped: ReverseResult['skipped'] = [];
  let text = content;
  let changed = false;

  for (const op of [...manifestOps].reverse()) {
    const skip = (reason: string): false => {
      skipped.push({ opId: op.opId, reason });
      return false;
    };
    const thread = threads.find((t) => t.id === op.threadId);
    const before = op.before as unknown as Before | undefined;
    switch (op.kind) {
      case 'add-thread': {
        if (!thread) {
          skip(`thread ${op.threadId} not found`);
          break;
        }
        threads.splice(threads.indexOf(thread), 1);
        text = unwrapThread(text, op.threadId);
        changed = true;
        break;
      }
      case 'delete-thread': {
        if (!before?.thread) {
          skip('no recorded before-state');
          break;
        }
        if (thread) break;
        const restored: Thread = before.thread;
        threads.splice(Math.min(before.index, threads.length), 0, restored);
        if (restored.anchor?.quote && !unsafeQuote(restored.anchor.quote)) text = wrapQuote(text, restored.anchor.quote, restored.id);
        changed = true;
        break;
      }
      default: {
        if (!thread) {
          skip(`thread ${op.threadId} not found`);
          break;
        }
        if (reverseInThread(thread, op, before, opts.authorName, skip)) changed = true;
      }
    }
  }

  if (!changed) return { content, skipped };
  return { content: parser.replaceThreadsBlock(text, threads), skipped };
}

/** Reverse one op that works inside an existing thread; true when the thread changed. */
function reverseInThread(
  thread: Thread,
  op: ManifestOp,
  before: Before | undefined,
  authorName: string,
  skip: (reason: string) => false,
): boolean {
  if (op.kind === 'resolve-thread') {
    if (!before) return skip('no recorded before-state');
    const was = [thread.resolved, thread.resolved_by, thread.resolved_at];
    thread.resolved = before.resolved;
    thread.resolved_by = before.resolved_by;
    thread.resolved_at = before.resolved_at;
    return was[0] !== before.resolved || was[1] !== before.resolved_by || was[2] !== before.resolved_at;
  }
  if (op.kind === 'add-thread' || op.kind === 'delete-thread') return false;
  const idx = thread.comments.findIndex((c) => c.id === op.commentId);
  const c = thread.comments[idx];
  if (op.kind === 'delete-comment') {
    if (!before?.comment) return skip('no recorded before-state');
    if (c) return false;
    thread.comments.splice(Math.min(before.index, thread.comments.length), 0, before.comment);
    return true;
  }
  if (!c) return skip(`comment ${op.commentId} not found`);
  switch (op.kind) {
    case 'add-comment': {
      thread.comments.splice(idx, 1);
      for (const r of thread.comments) if (r.parent_id === c.id) r.parent_id = c.parent_id;
      return true;
    }
    case 'edit-comment': {
      if (!before) return skip('no recorded before-state');
      const was = c.body !== before.body || c.edited_at !== before.edited_at;
      c.body = before.body;
      c.edited_at = before.edited_at;
      return was;
    }
    case 'toggle-reaction': {
      if (typeof before?.present !== 'boolean') return skip('no recorded before-state');
      c.reactions ??= [];
      const r = c.reactions.find((x) => x.emoji === op.emoji);
      const present = !!r && r.authors.includes(authorName);
      if (present === before.present) return false;
      if (before.present) {
        if (r) r.authors.push(authorName);
        else c.reactions.push({ emoji: op.emoji, authors: [authorName] });
      } else if (r) {
        r.authors = r.authors.filter((a) => a !== authorName);
        if (!r.authors.length) c.reactions = c.reactions.filter((x) => x !== r);
      }
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

/**
 * `<docsRoot>`: the docs source folder of the project that holds `file` (under a workspace, the
 * subproject's own `src`), as the host resolves it; without a host resolver, the project root
 * joined with the configured docs source folder.
 */
export const docsRootOf = (ctx: Pick<ActionContext, 'projectRoot' | 'config' | 'docsRootOf'>, file?: string): string =>
  ctx.docsRootOf?.(file) ?? safePath(ctx.projectRoot, ctx.config?.src || '.');
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
    if (!m || m.version !== 1 || typeof m.id !== 'string' || !Array.isArray(m.ops)) return null;
    // A manifest written before summaries existed has none.
    return { ...m, summary: typeof m.summary === 'string' ? m.summary : null } as ReviewManifest;
  } catch {
    return null;
  }
}

/** Every readable v1 manifest under the docs root, in no particular order; none when the directory is missing. */
export async function listManifests(ctx: ActionContext): Promise<ReviewManifest[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(safePath(reviewsDir(ctx), '.'));
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  const found = await Promise.all(
    names.filter((n) => n.endsWith('.json')).map((n) => readManifest(ctx, n.slice(0, -'.json'.length)).catch(() => null)),
  );
  // A manifest the listing cannot project (no times or title, a non-object op) is left out like a corrupt file.
  return found.filter(
    (m): m is ReviewManifest =>
      m !== null &&
      typeof m.publishedAt === 'string' &&
      typeof m.title === 'string' &&
      m.ops.every((o) => o !== null && typeof o === 'object'),
  );
}

/** Listing order: newest `publishedAt` first, equal times by id so the order never depends on the directory. */
export const newestFirst = (a: Pick<ReviewManifest, 'id' | 'publishedAt'>, b: Pick<ReviewManifest, 'id' | 'publishedAt'>): number =>
  b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);

/** The listing projection of a manifest. */
export const summarize = (m: ReviewManifest): ReviewSummary => ({
  id: m.id,
  authorKey: m.authorKey,
  authorName: m.authorName,
  title: m.title,
  publishedAt: m.publishedAt,
  state: m.state,
  ops: m.ops.map((o) => ({ file: o.file, threadId: o.threadId, quote: o.quote ?? null, pageTitle: o.pageTitle ?? null })),
});

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Write every changed file, then `beforeFinal` (the author profile), then `finalWrite` (the manifest). A failure
 * puts the profile back first, then the files already written; files that cannot be restored are named in a `threads/invalid` error.
 */
async function writeAllOrNothing(
  ctx: ActionContext,
  results: Array<{ file: string; original: string; next: string }>,
  finalWrite: () => Promise<void>,
  label: 'publish' | 'discard',
  /** Runs after the pages and before `finalWrite`; returns its undo, which runs first on a failure. */
  beforeFinal?: () => Promise<{ file: string; undo: () => Promise<void> }>,
): Promise<void> {
  const written: typeof results = [];
  let extra: Awaited<ReturnType<NonNullable<typeof beforeFinal>>> | undefined;
  try {
    for (const r of results) {
      if (r.next === r.original) continue;
      written.push(r);
      await ctx.writeFile(r.file, r.next);
    }
    extra = await beforeFinal?.();
    await finalWrite();
  } catch (e) {
    const stuck: string[] = [];
    if (extra) {
      try {
        await extra.undo();
      } catch {
        stuck.push(extra.file);
      }
    }
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
        `${label} failed on the server (${e instanceof Error ? e.message : String(e)}) and these files could not be restored, check them: ${stuck.join(', ')}`,
        { cause: e },
      );
    }
    throw e;
  }
}

export interface PublishDeps {
  store: DraftStore;
  /** Locks the docs root (publishes of different callers never interleave) and, with git on, commits and pushes. */
  sync: Sync;
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

/** The request's commit author e-mail as a meta fragment (empty when it carries none). */
const emailMeta = (ctx: ActionContext): { authorEmail?: string } => {
  const authorEmail = authorEmailOf(ctx);
  return authorEmail ? { authorEmail } : {};
};

/** A path as the sync is told about it: relative to the project root, like a target file. */
const manifestFileOf = (ctx: ActionContext, id: string): string => path.relative(ctx.projectRoot, safePath(reviewsDir(ctx), `${id}.json`));

type Profile = NonNullable<Journal['profile']>;

/** Drop the journal's profile when it is still the one that was written (edited again meanwhile: it stays). */
function clearProfile(j: Journal, written: Profile): void {
  if (j.profile?.name === written.name && j.profile.avatarUrl === written.avatarUrl) delete j.profile;
}

/**
 * A journal with a pending profile and no ops: write `authors.json[key]` alone and commit it
 * as its own change (no manifest, no new review). A profile the repository already holds
 * stages nothing, so the sync commits and pushes nothing.
 */
async function publishProfileOnly(caller: Caller, ctx: ActionContext, store: DraftStore, sync: Sync, journal: Journal): Promise<PublishResult> {
  const profile = journal.profile as Profile;
  const file = authorsFileOf(ctx);
  await sync.publishWithRetry(
    async () => {
      await setAuthorEntry(ctx, caller.key, profile);
      return { title: oneLine(`${profile.name} updated their profile`, TITLE_MAX) };
    },
    { authorKey: caller.key, authorName: caller.name, ...emailMeta(ctx), kind: 'publish', files: [file] },
  );
  await store.transact(caller.key, (j) => clearProfile(j, profile));
  return { reviewId: journal.review.id, skipped: [] };
}

/**
 * Write the caller's journal into the markdown files it targets, record the
 * review manifest, and drop the published ops from the journal. All touched
 * pages and the manifest are written under one lock, or none are. The write runs
 * inside `sync.publishWithRetry`: with git it may run again on a fresh checkout.
 */
export async function publish(
  caller: Caller,
  ctx: ActionContext,
  { store, sync, now = Date.now, newId = (prefix) => prefix + crypto.randomBytes(4).toString('hex') }: PublishDeps,
): Promise<PublishResult> {
  assertWritable(caller);
  return sync.withLock(async () => {
    let journal = await store.load(caller.key);
    let earlier = await readManifest(ctx, journal.review.id);
    if (earlier?.state === 'discarded' && earlier.authorKey === caller.key) {
      // The journal's review was published, then discarded, but its reset never finished: finish it
      // now so only ops drafted since are published (under the new id), never the discarded ones.
      await finishEarlierPublish(ctx, store, caller.key, newId);
      journal = await store.load(caller.key);
      earlier = await readManifest(ctx, journal.review.id);
    }
    const ops = journal.ops;
    if (!ops.length && !journal.profile) throw new ThreadsError('empty-review', 'there is nothing to publish');
    if (!ops.length) return publishProfileOnly(caller, ctx, store, sync, journal);
    let reviewId = journal.review.id;
    // Written with the pages, unless this publish only finishes an earlier one (below).
    const profile = journal.profile;
    const files = [...new Set(ops.map((o) => o.file))];
    const order = new Map(ops.map((o, i) => [o.opId, i]));

    // An earlier publish of this review wrote its files and manifest but failed to reset the
    // journal: do not apply again (toggles would flip back), only finish the reset.
    if (earlier) {
      if (earlier.authorKey === caller.key && earlier.state === 'published') {
        await finishEarlierPublish(ctx, store, caller.key, newId);
        return { reviewId, skipped: earlier.skipped };
      }
      // The id belongs to someone else's review, or to one this caller discarded (an id collision):
      // this journal moves to a fresh one.
      reviewId = newId('r-');
      await store.transact(caller.key, (j) => void (j.review.id = reviewId));
    }

    const authorsFile = authorsFileOf(ctx);
    let skipped: PublishResult['skipped'] = [];
    // Toggle targets come from the first read of each file and are reused by any retry of apply.
    const targetsByFile = new Map<string, Record<string, boolean>>();
    await sync.publishWithRetry(
      async () => {
        const applied: ManifestOp[] = [];
        skipped = [];
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
          if (!targetsByFile.has(file)) targetsByFile.set(file, deriveTargets(content, fileOps, caller.name));
          const result = applyOps(content, fileOps, {
            authorKey: caller.key, authorName: caller.name, reviewId, targets: targetsByFile.get(file), enforce: caller.source === 'header',
          });
          applied.push(...result.applied);
          skipped.push(...result.skipped);
          results.push({ file, original: content, next: result.content });
        }
        applied.sort((a, b) => (order.get(a.opId) ?? 0) - (order.get(b.opId) ?? 0));

        // Write everything or nothing: a failure restores the files already written.
        const title = journal.review.title || defaultTitle(caller.name, applied.length ? applied : ops, titles);
        const summary = journal.review.summary || null;
        await writeAllOrNothing(ctx, results, () => writeManifest(ctx, {
          version: 1,
          id: reviewId,
          authorKey: caller.key,
          authorName: caller.name,
          title,
          summary,
          state: 'published',
          publishedAt: new Date(now()).toISOString(),
          ops: applied,
          skipped,
        }), 'publish', profile && (async () => ({
          file: authorsFile,
          undo: await setAuthorEntry(ctx, caller.key, profile),
        })));
        return { title, summary };
      },
      {
        authorKey: caller.key, authorName: caller.name, ...emailMeta(ctx), kind: 'publish',
        files: profile ? [...files, authorsFile] : files, manifest: manifestFileOf(ctx, reviewId),
      },
    );

    // Drop what was published (ops drafted meanwhile stay) and start a fresh review.
    const published = new Set(ops.map((o) => o.opId));
    await store.transact(caller.key, (j) => {
      if (profile) clearProfile(j, profile);
      j.ops = j.ops.filter((o) => !published.has(o.opId));
      j.review.id = newId('r-');
      j.review.title = null;
      j.review.summary = null;
    });
    return { reviewId, skipped };
  });
}

/**
 * Finish a publish whose files and manifest were written but whose journal reset failed:
 * drop the ops the manifest recorded (applied and skipped) and rotate the review id, so
 * ops still in the journal stand for what is really pending and later edits of the
 * published comments become real edit/delete ops. A no-op when the journal's review has no
 * manifest; finishes the reset for a published or discarded one
 * (a discard must not let the old ops be applied again).
 */
export async function finishEarlierPublish(
  ctx: ActionContext,
  store: DraftStore,
  key: string,
  newId: (prefix: string) => string = (prefix) => prefix + crypto.randomBytes(4).toString('hex'),
): Promise<void> {
  const manifest = await readManifest(ctx, (await store.load(key)).review.id);
  if (!manifest || manifest.authorKey !== key) return;
  const done = new Set([...manifest.ops.map((o) => o.opId), ...manifest.skipped.map((x) => x.opId)]);
  await store.transact(key, (j) => {
    if (j.review.id !== manifest.id) return;
    j.ops = j.ops.filter((o) => !done.has(o.opId));
    j.review.id = newId('r-');
    j.review.title = null;
    j.review.summary = null;
  });
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

export interface DiscardDeps {
  store: DraftStore;
  /** The same sync `publish` uses, so both share one lock. */
  sync: Sync;
  now?: () => number;
  /**
   * Permission check, run under the lock on the manifest as read there (null when the review has
   * no manifest, i.e. the caller's own open one) and again on the manifest read after any git
   * reset. It throws to refuse; a refused discard changes nothing.
   */
  authorize?: (manifest: ReviewManifest | null) => void;
}

/**
 * Take a review back. A published review is reversed from its manifest as a forward change
 * (files first, all or nothing, then the manifest is marked `discarded`); the caller's own
 * open review is only emptied. Runs under the same lock as `publish`, the file work inside
 * `sync.publishWithRetry` (with git, one forward commit).
 */
export async function discard(
  caller: Caller,
  ctx: ActionContext,
  reviewId: string,
  { store, sync, now = Date.now, authorize }: DiscardDeps,
): Promise<{ discarded: true }> {
  return sync.withLock(async () => {
    const manifest = await readManifest(ctx, reviewId);
    authorize?.(manifest);
    if (!manifest) {
      const journal = await store.load(caller.key);
      if (journal.review.id !== reviewId) throw new ThreadsError('not-found', `review ${reviewId} not found`);
      await store.transact(caller.key, (j) => {
        if (j.review.id === reviewId) j.ops = [];
      });
      return { discarded: true } as const;
    }
    if (manifest.state === 'discarded') throw new ThreadsError('invalid', `review ${reviewId} is already discarded`);

    const files = [...new Set(manifest.ops.map((o) => o.file))];
    await sync.publishWithRetry(
      async () => {
        // With git the checkout was just reset to the remote head: read the manifest as it is there.
        const current = await readManifest(ctx, reviewId);
        if (!current) throw new ThreadsError('not-found', `review ${reviewId} not found`);
        authorize?.(current);
        if (current.state === 'discarded') throw new ThreadsError('invalid', `review ${reviewId} is already discarded`);
        const discardSkipped: Array<{ opId: string; reason: string }> = [];
        const results: Array<{ file: string; original: string; next: string }> = [];
        for (const file of files) {
          const fileOps = current.ops.filter((o) => o.file === file);
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch {
            for (const o of fileOps) discardSkipped.push({ opId: o.opId, reason: `file ${file} not readable` });
            continue;
          }
          const result = reverseOps(content, fileOps, { authorName: current.authorName });
          discardSkipped.push(...result.skipped);
          results.push({ file, original: content, next: result.content });
        }

        await writeAllOrNothing(ctx, results, () => writeManifest(ctx, {
          ...current,
          state: 'discarded',
          discardedAt: new Date(now()).toISOString(),
          discardedBy: caller.key,
          discardSkipped,
        }), 'discard');
        return { title: current.title };
      },
      { authorKey: caller.key, authorName: caller.name, ...emailMeta(ctx), kind: 'discard', files, manifest: manifestFileOf(ctx, reviewId) },
    );
    return { discarded: true } as const;
  });
}
