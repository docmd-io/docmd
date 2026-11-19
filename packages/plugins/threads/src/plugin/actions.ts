import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ActionContext } from '@docmd/api';
import * as parser from './parser.js';
import { ThreadsError } from './errors.js';
import { safePath } from '@docmd/utils';
import { createDraftStore, makeOp, type DraftStore } from './drafts.js';
import { overlay } from './overlay.js';
import { lockFor } from './lock.js';
import { getOptions } from './config.js';
import { docsRootOf, finishEarlierPublish, publish } from './reviews.js';
import { findCaller, payloadProfile, profileFromPayload, resolveCaller } from './identity.js';
import type { Thread, Comment, Reaction, Caller, DraftOp, Journal, NewDraftOp, PublishResult, Anchor, DraftMode, WhoAmI } from '../types.js';

interface AuthorsMap {
  [key: string]: { name: string; avatarUrl: string };
}

/**
 * Read the authors map from <docsRoot>/.threads/authors.json.
 * Returns {} if file doesn't exist.
 */
async function readAuthors(ctx: ActionContext): Promise<AuthorsMap> {
  const filePath = safePath(safePath(docsRootOf(ctx), '.threads'), 'authors.json');
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content) as AuthorsMap;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * Write the authors map to <docsRoot>/.threads/authors.json.
 * Creates the directory if needed.
 */
async function writeAuthors(ctx: ActionContext, authors: AuthorsMap): Promise<void> {
  const dirPath = safePath(docsRootOf(ctx), '.threads');
  const filePath = safePath(dirPath, 'authors.json');
  await fs.promises.mkdir(dirPath, { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(authors, null, 2) + '\n');
}

/**
 * Upsert an author entry. Updates name/avatarUrl if provided.
 */
async function upsertAuthor(ctx: ActionContext, authorKey: string, name: string, avatarUrl?: string): Promise<void> {
  const authors = await readAuthors(ctx);
  const existing = authors[authorKey] || { name: '', avatarUrl: '' };
  authors[authorKey] = {
    name: name || existing.name || authorKey,
    avatarUrl: avatarUrl || existing.avatarUrl || '',
  };
  await writeAuthors(ctx, authors);
}

const generateThreadId = () => 't-' + crypto.randomBytes(4).toString('hex');
const generateCommentId = () => 'c-' + crypto.randomBytes(4).toString('hex');

/**
 * One store per docs root, so its lock covers every caller whatever the config; `Date.now` is the
 * production clock. The mode of a new journal follows the config of the latest call.
 */
const stores = new Map<string, DraftStore>();
const newJournalModes = new Map<string, DraftMode>();
function getStore(ctx: ActionContext): DraftStore {
  const root = docsRootOf(ctx);
  let store = stores.get(root);
  if (!store) {
    store = createDraftStore(root, { now: Date.now, defaultMode: () => newJournalModes.get(root) ?? 'collect' });
    stores.set(root, store);
  }
  const { autoPublish } = getOptions(ctx);
  newJournalModes.set(root, autoPublish && autoPublish.startOn ? 'auto' : 'collect');
  return store;
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The anchor a client sent, reduced to the Anchor fields; null when it has no quote. */
function anchorFrom(sent: unknown): Anchor | null {
  const a = (sent ?? {}) as Record<string, unknown>;
  if (typeof a.quote !== 'string' || !a.quote) return null;
  return {
    quote: a.quote,
    prefix: strOrNull(a.prefix),
    suffix: strOrNull(a.suffix),
    selector: strOrNull(a.selector),
    offset: typeof a.offset === 'number' && Number.isFinite(a.offset) ? a.offset : null,
    blockText: strOrNull(a.blockText),
  };
}

/** Wire payload; `requireFields` has checked the fields an action needs. */
interface Payload {
  file: string;
  threadId: string;
  commentId: string;
  parentId?: string | null;
  body: string;
  emoji: string;
  [key: string]: unknown;
}

/** Validate that required string fields are present and non-empty. */
function requireFields(action: string, payload: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    const value = payload[field];
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw new ThreadsError('invalid', `${action}: ${field} is required`);
    }
  }
}

function findThread(view: Thread[], threadId: string): Thread {
  const thread = view.find((t) => t.id === threadId);
  if (!thread) throw new ThreadsError('not-found', `Thread not found: ${threadId}`);
  return thread;
}

function findComment(thread: Thread, commentId: string): Comment {
  const comment = thread.comments.find((c) => c.id === commentId);
  if (!comment) throw new ThreadsError('not-found', `Comment not found: ${commentId}`);
  return comment;
}

/** The state a mutation decides on, inside one locked read-modify-write of the caller's journal. */
interface Tx {
  j: Journal;
  at: string;
  file: string;
  /** Published threads with the caller's drafts applied, as of the start of this cycle. */
  view: Thread[];
}

const fileOps = (tx: Tx) => tx.j.ops.filter((o) => o.file === tx.file);
const draftedThreadOp = (tx: Tx, threadId: string) =>
  fileOps(tx).find((o) => o.kind === 'add-thread' && o.threadId === threadId);
const draftedCommentOp = (tx: Tx, commentId: string) =>
  fileOps(tx).find((o) => (o.kind === 'add-thread' || o.kind === 'add-comment') && o.commentId === commentId);
const opsOnThread = (tx: Tx, threadId: string) => fileOps(tx).filter((o) => o.threadId === threadId);
const opsOnComment = (tx: Tx, commentId: string) =>
  fileOps(tx).filter((o) => 'commentId' in o && o.commentId === commentId);
const push = (tx: Tx, op: NewDraftOp) => void tx.j.ops.push(makeOp(op, tx.at));
const drop = (tx: Tx, ops: DraftOp[]) => {
  const gone = new Set(ops.map((o) => o.opId));
  tx.j.ops = tx.j.ops.filter((o) => !gone.has(o.opId));
};
/** Ops on a comment plus, transitively, the caller's drafted replies to it (deleting a comment deletes those replies). */
function opsOnCommentTree(tx: Tx, commentId: string): DraftOp[] {
  const out = new Set<DraftOp>();
  const queue = [commentId];
  while (queue.length) {
    const id = queue.pop() as string;
    for (const o of opsOnComment(tx, id)) out.add(o);
    for (const o of fileOps(tx)) if (o.kind === 'add-comment' && o.parentId === id) queue.push(o.commentId);
  }
  return [...out];
}

/**
 * Resolve the caller (a serve call without a trusted identity is refused here,
 * before anything is written), then run `fn` as one locked read-modify-write
 * of their journal. Returns the published threads with the drafts applied.
 */
async function transact(ctx: ActionContext, payload: Payload, fn: (tx: Tx) => void): Promise<Thread[]> {
  const caller = resolveCaller(ctx, payload);
  const store = getStore(ctx);
  await finishEarlierPublish(ctx, store, caller.key);
  const file = payload.file;
  const published = parser.parseThreadsFromContent(await ctx.readFile(file));
  const journal = await store.transact(caller.key, (j, at) =>
    fn({ j, at, file, view: overlay(published, j.ops, file, caller) }),
  );
  return overlay(published, journal.ops, file, caller);
}

/** Author profiles are written straight to authors.json, as before. */
async function recordProfile(ctx: ActionContext, caller: Caller, payload: Payload): Promise<void> {
  const profile = payloadProfile(ctx, caller, payload);
  if (profile) await upsertAuthor(ctx, profile.key, profile.name, profile.avatarUrl);
}

export const actions: Record<string, (payload: Payload, ctx: ActionContext) => Promise<unknown>> = {
  'threads:get-authors': async (_payload, ctx): Promise<AuthorsMap> => readAuthors(ctx),

  'threads:upsert-author': async (payload, ctx): Promise<{ ok: boolean }> => {
    requireFields('threads:upsert-author', payload, ['authorKey', 'name']);
    const profile = profileFromPayload(payload);
    await upsertAuthor(ctx, profile.key, profile.name, profile.avatarUrl);
    return { ok: true };
  },

  /** Published threads plus the caller's own drafts. */
  'threads:get-threads': async (payload, ctx): Promise<Thread[]> => {
    requireFields('threads:get-threads', payload, ['file']);
    const published = parser.parseThreadsFromContent(await ctx.readFile(payload.file));
    const caller = findCaller(ctx, payload);
    if (!caller) return published;
    // After a publish whose journal reset failed, the journal still holds ops the file already has.
    const store = getStore(ctx);
    await finishEarlierPublish(ctx, store, caller.key);
    const journal = await store.load(caller.key);
    return overlay(published, journal.ops, payload.file, caller);
  },

  /**
   * The caller's journal, or `{ journal: null }` when the call carries no identity. A caller with
   * no journal file gets a fresh, unsaved journal: nothing is written, and its review id and
   * timestamp change on every call until the first write.
   */
  'threads:whoami': async (payload, ctx): Promise<WhoAmI> => {
    const caller = findCaller(ctx, payload);
    if (!caller) return { journal: null };
    const store = getStore(ctx);
    // After a publish whose journal reset failed, the journal still holds ops the file already has.
    await finishEarlierPublish(ctx, store, caller.key);
    return { journal: await store.load(caller.key) };
  },

  'threads:set-mode': async (payload, ctx): Promise<Journal> => {
    if (payload?.mode !== 'auto' && payload?.mode !== 'collect') {
      throw new ThreadsError('invalid', "threads:set-mode: mode must be 'auto' or 'collect'");
    }
    return getStore(ctx).setMode(resolveCaller(ctx, payload).key, payload.mode);
  },

  'threads:add-thread': async (payload, ctx): Promise<Thread> => {
    requireFields('threads:add-thread', payload, ['file', 'author', 'body']);
    const caller = resolveCaller(ctx, payload);
    const threadId = generateThreadId();
    const anchor = anchorFrom(payload.anchor);
    const view = await transact(ctx, payload, (tx) =>
      push(tx, { kind: 'add-thread', file: tx.file, threadId, commentId: generateCommentId(), anchor, body: payload.body }),
    );
    await recordProfile(ctx, caller, payload);
    return findThread(view, threadId);
  },

  'threads:add-comment': async (payload, ctx): Promise<Comment> => {
    requireFields('threads:add-comment', payload, ['file', 'threadId', 'author', 'body']);
    const caller = resolveCaller(ctx, payload);
    const commentId = generateCommentId();
    const view = await transact(ctx, payload, (tx) => {
      findThread(tx.view, payload.threadId);
      push(tx, {
        kind: 'add-comment', file: tx.file, threadId: payload.threadId, commentId,
        parentId: payload.parentId || null, body: payload.body,
      });
    });
    await recordProfile(ctx, caller, payload);
    return findComment(findThread(view, payload.threadId), commentId);
  },

  'threads:edit-comment': async (payload, ctx): Promise<Comment> => {
    requireFields('threads:edit-comment', payload, ['file', 'threadId', 'commentId', 'body']);
    const { threadId, commentId, body } = payload;
    const view = await transact(ctx, payload, (tx) => {
      findComment(findThread(tx.view, threadId), commentId);
      const drafted = draftedCommentOp(tx, commentId);
      if (drafted) Object.assign(drafted, { body });
      else push(tx, { kind: 'edit-comment', file: tx.file, threadId, commentId, body });
    });
    return findComment(findThread(view, threadId), commentId);
  },

  'threads:delete-comment': async (payload, ctx): Promise<{ deleted: boolean }> => {
    requireFields('threads:delete-comment', payload, ['file', 'threadId', 'commentId']);
    const { threadId, commentId } = payload;
    await transact(ctx, payload, (tx) => {
      findComment(findThread(tx.view, threadId), commentId);
      const drafted = draftedCommentOp(tx, commentId);
      if (drafted?.kind === 'add-thread') {
        // The first comment of a drafted thread: the thread goes with it.
        drop(tx, opsOnThread(tx, threadId));
        return;
      }
      drop(tx, opsOnCommentTree(tx, commentId));
      if (!drafted) push(tx, { kind: 'delete-comment', file: tx.file, threadId, commentId });
    });
    return { deleted: true };
  },

  'threads:delete-thread': async (payload, ctx): Promise<{ deleted: boolean }> => {
    requireFields('threads:delete-thread', payload, ['file', 'threadId']);
    const { threadId } = payload;
    await transact(ctx, payload, (tx) => {
      findThread(tx.view, threadId);
      const drafted = draftedThreadOp(tx, threadId);
      drop(tx, opsOnThread(tx, threadId));
      if (!drafted) push(tx, { kind: 'delete-thread', file: tx.file, threadId });
    });
    return { deleted: true };
  },

  'threads:resolve-thread': async (payload, ctx): Promise<Thread> => {
    requireFields('threads:resolve-thread', payload, ['file', 'threadId']);
    const { threadId } = payload;
    const view = await transact(ctx, payload, (tx) => {
      findThread(tx.view, threadId);
      // A drafted thread has no resolved field to flip: a second toggle cancels the first.
      const pending = draftedThreadOp(tx, threadId)
        ? opsOnThread(tx, threadId).find((o) => o.kind === 'resolve-thread')
        : undefined;
      if (pending) drop(tx, [pending]);
      else push(tx, { kind: 'resolve-thread', file: tx.file, threadId });
    });
    return findThread(view, threadId);
  },

  'threads:toggle-reaction': async (payload, ctx): Promise<Reaction[]> => {
    requireFields('threads:toggle-reaction', payload, ['file', 'threadId', 'commentId', 'emoji']);
    const { threadId, commentId, emoji } = payload;
    const view = await transact(ctx, payload, (tx) => {
      findComment(findThread(tx.view, threadId), commentId);
      // On a drafted comment a second toggle of the same emoji cancels the first.
      const pending = draftedCommentOp(tx, commentId)
        ? opsOnComment(tx, commentId).find((o) => o.kind === 'toggle-reaction' && o.emoji === emoji)
        : undefined;
      if (pending) drop(tx, [pending]);
      else push(tx, { kind: 'toggle-reaction', file: tx.file, threadId, commentId, emoji });
    });
    return findComment(findThread(view, threadId), commentId).reactions;
  },

  /** Write the caller's drafts into the markdown and record a manifest: all pages or none. */
  'threads:publish-review': async (payload, ctx): Promise<PublishResult> =>
    publish(resolveCaller(ctx, payload), ctx, { store: getStore(ctx), lock: lockFor(docsRootOf(ctx)) }),
};
