import crypto from 'node:crypto';
import type { ActionContext } from '@docmd/api';
import * as parser from './parser.js';
import { ThreadsError } from './errors.js';
import { guardWrite } from './limits.js';
import { createDraftStore, makeOp, type DraftStore } from './drafts.js';
import { overlay } from './overlay.js';
import { countOrphanedBy, fsOrphanScanDeps, markOrphans } from './orphans.js';
import { getSync, gitOn } from './git-sync.js';
import { getOptions } from './config.js';
import { discard, docsRootOf, finishEarlierPublish, listManifests, newestFirst, parseReviewFields, publish, summarize } from './reviews.js';
import { readAuthors, updateAuthors } from './authors.js';
import { claimedAuthorKey, findCaller, headerProfile, payloadProfile, profileFromPayload, resolveCaller } from './identity.js';
import { assertCan } from './permissions.js';
import type { AuthorsMap, Thread, Comment, Reaction, Caller, DraftOp, Journal, NewDraftOp, PublishResult, ReviewManifest, ReviewSummary, Anchor, DraftMode, WhoAmI } from '../types.js';

/** Upsert an author entry. Updates name/avatarUrl if provided. */
async function upsertAuthor(ctx: ActionContext, authorKey: string, name: string, avatarUrl?: string): Promise<void> {
  await updateAuthors(ctx, (authors) => {
    const existing = authors[authorKey] || { name: '', avatarUrl: '' };
    authors[authorKey] = {
      name: name || existing.name || authorKey,
      avatarUrl: avatarUrl || existing.avatarUrl || '',
    };
  });
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
  reviewId: string;
  [key: string]: unknown;
}

/** The rate limiter's clock; it reads the wall clock on every call so tests can mock Date. */
const wallClock = () => Date.now();

/** Validate that required string fields are present and non-empty. */
function requireFields(action: string, payload: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    const value = payload[field];
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw new ThreadsError('invalid', `${action}: ${field} is required`);
    }
  }
}

/**
 * Resolve the caller of a write, then validate the payload. In dev the payload is the identity
 * source, so its fields are validated first (as before). Under serve identity comes first, so a
 * call without an identity never reaches validation, and `author` is not required.
 */
async function begin(ctx: ActionContext, payload: Payload, action: string, fields: string[]): Promise<Caller> {
  if (ctx.mode !== 'serve') requireFields(action, payload, fields);
  const caller = await resolveCaller(ctx, payload);
  if (ctx.mode === 'serve') requireFields(action, payload, fields.filter((f) => f !== 'author'));
  return caller;
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
  /** The published threads as parsed from the page, without any drafts. */
  published: Thread[];
}

/** The ids and author keys of a thread's comments as published: drafted deletes do not hide them. */
const publishedComments = (tx: Tx, threadId: string): Comment[] =>
  tx.published.find((t) => t.id === threadId)?.comments ?? [];
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
 * Run `fn` as one locked read-modify-write of the caller's journal. Returns the published
 * threads with the drafts applied.
 */
async function transact(ctx: ActionContext, caller: Caller, payload: Payload, fn: (tx: Tx) => void): Promise<Thread[]> {
  const store = getStore(ctx);
  await finishEarlierPublish(ctx, store, caller.key);
  const file = payload.file;
  const published = parser.parseThreadsFromContent(await ctx.readFile(file));
  const journal = await store.transact(caller.key, (j, at) =>
    fn({ j, at, file, published, view: overlay(published, j.ops, file, caller) }),
  );
  return overlay(published, journal.ops, file, caller);
}

/** Dev writes the payload's author profile straight to authors.json, as before; under serve the profile is only ever set through `upsert-author`. */
async function recordProfile(ctx: ActionContext, caller: Caller, payload: Payload): Promise<void> {
  if (caller.source !== 'payload') return;
  const profile = payloadProfile(payload);
  if (profile) await upsertAuthor(ctx, profile.key, profile.name, profile.avatarUrl);
}

const handlers: Record<string, (payload: Payload, ctx: ActionContext) => Promise<unknown>> = {
  'threads:get-authors': async (_payload, ctx): Promise<AuthorsMap> => readAuthors(ctx),

  'threads:upsert-author': async (payload, ctx): Promise<{ ok: boolean }> => {
    const caller = await begin(ctx, payload, 'threads:upsert-author', ctx.mode === 'serve' ? ['name'] : ['authorKey', 'name']);
    assertCan(caller, 'upsert-author', { authorKey: claimedAuthorKey(payload) }, getOptions(ctx).permissions);
    if (caller.source === 'header') {
      // The key is the trusted identity: only the caller's own entry changes.
      if (gitOn(ctx)) {
        // With git the working tree stays clean between publishes: the profile waits in the journal and goes out with the next publish.
        const profile = headerProfile(payload, caller);
        await getStore(ctx).transact(caller.key, (j) => void (j.profile = profile));
        return { ok: true };
      }
      await updateAuthors(ctx, (authors) => void (authors[caller.key] = headerProfile(payload, caller)));
      return { ok: true };
    }
    const profile = profileFromPayload(payload);
    await upsertAuthor(ctx, profile.key, profile.name, profile.avatarUrl);
    return { ok: true };
  },

  /** Published threads plus the caller's own drafts. */
  'threads:get-threads': async (payload, ctx): Promise<Thread[]> => {
    requireFields('threads:get-threads', payload, ['file']);
    const content = await ctx.readFile(payload.file);
    const published = markOrphans(content, parser.parseThreadsFromContent(content));
    const caller = await findCaller(ctx, payload);
    if (!caller) return published;
    // After a publish whose journal reset failed, the journal still holds ops the file already has.
    const store = getStore(ctx);
    await finishEarlierPublish(ctx, store, caller.key);
    const journal = await store.load(caller.key);
    return overlay(published, journal.ops, payload.file, caller);
  },

  /**
   * The caller and their journal, or nulls when the call carries no identity. A caller with
   * no journal file gets a fresh, unsaved journal: nothing is written, and its review id and
   * timestamp change on every call until the first write.
   */
  'threads:whoami': async (payload, ctx): Promise<WhoAmI> => {
    const identity = await findCaller(ctx, payload);
    if (!identity) return { identity: null, journal: null, orphanedMine: 0 };
    const store = getStore(ctx);
    // After a publish whose journal reset failed, the journal still holds ops the file already has.
    await finishEarlierPublish(ctx, store, identity.key);
    const journal = await store.load(identity.key);
    // A secondary counter: an unreadable file or directory must not cost the caller identity and journal.
    const docsRoot = docsRootOf(ctx);
    const orphanedMine = await countOrphanedBy(docsRoot, identity.key, fsOrphanScanDeps(docsRoot)).catch(() => 0);
    return { identity, journal, orphanedMine };
  },

  'threads:set-mode': async (payload, ctx): Promise<Journal> => {
    // Under serve the identity comes first, as in `begin`; in dev the mode is checked first, as before.
    const caller = ctx.mode === 'serve' ? await resolveCaller(ctx, payload) : null;
    if (payload?.mode !== 'auto' && payload?.mode !== 'collect') {
      throw new ThreadsError('invalid', "threads:set-mode: mode must be 'auto' or 'collect'");
    }
    return getStore(ctx).setMode((caller ?? (await resolveCaller(ctx, payload))).key, payload.mode);
  },

  /** Every published or discarded review, newest first. A read: needs no identity. */
  'threads:list-reviews': async (_payload, ctx): Promise<ReviewSummary[]> =>
    (await listManifests(ctx))
      .sort(newestFirst)
      .map(summarize),

  /** Name and/or summarize the caller's open review (`null` clears a field, an absent key keeps it); the manifest takes them at publish. */
  'threads:update-review': async (payload, ctx): Promise<Journal> => {
    const caller = ctx.mode === 'serve' ? await resolveCaller(ctx, payload) : null;
    const fields = parseReviewFields(payload);
    return getStore(ctx).setReview((caller ?? (await resolveCaller(ctx, payload))).key, fields);
  },

  'threads:add-thread': async (payload, ctx): Promise<Thread> => {
    const caller = await begin(ctx, payload, 'threads:add-thread', ['file', 'author', 'body']);
    guardWrite(ctx, payload, caller, { rate: true, now: wallClock });
    const threadId = generateThreadId();
    const anchor = anchorFrom(payload.anchor);
    const view = await transact(ctx, caller, payload, (tx) =>
      push(tx, { kind: 'add-thread', file: tx.file, threadId, commentId: generateCommentId(), anchor, body: payload.body }),
    );
    await recordProfile(ctx, caller, payload);
    return findThread(view, threadId);
  },

  'threads:add-comment': async (payload, ctx): Promise<Comment> => {
    const caller = await begin(ctx, payload, 'threads:add-comment', ['file', 'threadId', 'author', 'body']);
    guardWrite(ctx, payload, caller, { rate: true, now: wallClock });
    const commentId = generateCommentId();
    const view = await transact(ctx, caller, payload, (tx) => {
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
    const caller = await begin(ctx, payload, 'threads:edit-comment', ['file', 'threadId', 'commentId', 'body']);
    guardWrite(ctx, payload, caller, { rate: false, now: wallClock });
    const { threadId, commentId, body } = payload;
    const view = await transact(ctx, caller, payload, (tx) => {
      const target = findComment(findThread(tx.view, threadId), commentId);
      assertCan(caller, 'edit-comment', { authorKey: target.authorKey, drafted: target.draft }, getOptions(ctx).permissions);
      const drafted = draftedCommentOp(tx, commentId);
      if (drafted) Object.assign(drafted, { body });
      else push(tx, { kind: 'edit-comment', file: tx.file, threadId, commentId, body });
    });
    return findComment(findThread(view, threadId), commentId);
  },

  'threads:delete-comment': async (payload, ctx): Promise<{ deleted: boolean }> => {
    const caller = await begin(ctx, payload, 'threads:delete-comment', ['file', 'threadId', 'commentId']);
    const { threadId, commentId } = payload;
    await transact(ctx, caller, payload, (tx) => {
      const thread = findThread(tx.view, threadId);
      const target = findComment(thread, commentId);
      const published = publishedComments(tx, threadId);
      // The opening comment of a thread that has other published comments: admin only, and the whole
      // thread goes (nothing records an opener once it is spliced out). Serve callers only.
      const wholeThread = caller.source === 'header' && !target.draft && published.length > 1 && thread.comments[0].id === commentId;
      assertCan(caller, 'delete-comment', { authorKey: wholeThread ? null : target.authorKey, drafted: target.draft }, getOptions(ctx).permissions);
      if (wholeThread) {
        drop(tx, opsOnThread(tx, threadId));
        push(tx, { kind: 'delete-thread', file: tx.file, threadId, commentIds: published.map((c) => c.id) });
        return;
      }
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
    const caller = await begin(ctx, payload, 'threads:delete-thread', ['file', 'threadId']);
    const { threadId } = payload;
    await transact(ctx, caller, payload, (tx) => {
      findThread(tx.view, threadId);
      const published = publishedComments(tx, threadId);
      assertCan(caller, 'delete-thread', { authorKeys: published.map((c) => c.authorKey) }, getOptions(ctx).permissions);
      const drafted = draftedThreadOp(tx, threadId);
      drop(tx, opsOnThread(tx, threadId));
      if (!drafted) push(tx, { kind: 'delete-thread', file: tx.file, threadId, commentIds: published.map((c) => c.id) });
    });
    return { deleted: true };
  },

  'threads:resolve-thread': async (payload, ctx): Promise<Thread> => {
    const caller = await begin(ctx, payload, 'threads:resolve-thread', ['file', 'threadId']);
    const { threadId } = payload;
    const view = await transact(ctx, caller, payload, (tx) => {
      const thread = findThread(tx.view, threadId);
      assertCan(caller, 'resolve-thread', { threadAuthor: thread.comments[0]?.authorKey, drafted: thread.draft }, getOptions(ctx).permissions);
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
    const caller = await begin(ctx, payload, 'threads:toggle-reaction', ['file', 'threadId', 'commentId', 'emoji']);
    const { threadId, commentId, emoji } = payload;
    const view = await transact(ctx, caller, payload, (tx) => {
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
    publish(await resolveCaller(ctx, payload), ctx, { store: getStore(ctx), sync: getSync(ctx) }),

  /** Take a review back: reverse a published one from its manifest, or empty the caller's open one. */
  'threads:discard-review': async (payload, ctx): Promise<{ discarded: true }> => {
    const caller = await begin(ctx, payload, 'threads:discard-review', ['reviewId']);
    if (typeof payload.reviewId !== 'string') throw new ThreadsError('invalid', 'threads:discard-review: reviewId must be a string');
    // The check runs inside discard, under the lock, on the manifest read there.
    const authorize = (manifest: ReviewManifest | null) =>
      assertCan(caller, 'discard-review', { reviewAuthor: manifest ? (manifest.authorKey ?? null) : caller.key }, getOptions(ctx).permissions);
    return discard(caller, ctx, payload.reviewId, { store: getStore(ctx), sync: getSync(ctx), authorize });
  },
};

/**
 * Every action works in the docs root of the page that called it: the client sends that page as
 * `file`, and under a workspace the host maps it to its subproject's docs folder. The root is
 * resolved once per call, so the journal, manifests, authors.json and lock all agree.
 */
export const actions: typeof handlers = Object.fromEntries(
  Object.entries(handlers).map(([name, handler]) => [
    name,
    (payload: Payload, ctx: ActionContext) => {
      const file = typeof payload?.file === 'string' && payload.file ? payload.file : undefined;
      const root = docsRootOf(ctx, file);
      return handler(payload, { ...ctx, docsRootOf: () => root });
    },
  ]),
);
