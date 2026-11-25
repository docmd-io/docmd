import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, snapshotTree, type TempProject } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { canDo } from '../src/plugin/permissions.ts';
import type { Comment, DraftOp, Thread } from '../src/types.ts';
import { rows } from './fixtures/permissions-table.ts';

// ---------------------------------------------------------------------------
// canDo: the decision table
// ---------------------------------------------------------------------------

test('canDo decision table', () => {
  for (const [label, caller, action, target, resolve, allowed] of rows) {
    assert.equal(canDo(caller, action, target, { resolve }), allowed, label);
  }
});

// ---------------------------------------------------------------------------
// Wiring: each handler binds the right target. One thread per test: order-independent.
// ---------------------------------------------------------------------------

let project: TempProject;
// `seed` adds many threads and comments per key within one minute, so this file raises the per-minute rate.
const threadsCfg = { permissions: { admins: ['root'], resolve: 'author' }, limits: { commentsPerMinute: 1000 } };
const ctxFor = (key: string) =>
  makeCtx(project.root, { mode: 'serve', config: { src: 'docs', plugins: { threads: threadsCfg } }, caller: { identity: key } });
type Json = Record<string, unknown>;
const call = (name: string, key: string, payload: Json = {}): Promise<never> =>
  (actions as Record<string, (p: Json, c: unknown) => Promise<unknown>>)[`threads:${name}`]({ file: project.file, ...payload }, ctxFor(key)) as Promise<never>;
const forbidden = (p: Promise<unknown>) => assert.rejects(p, /^ThreadsError: threads\/forbidden: /);
const anchor = { quote: 'x', prefix: null, suffix: null, selector: null, offset: null, blockText: null };
const view = async (key: string, id: string): Promise<Thread> => (await call('get-threads', key)).find((t: Thread) => t.id === id);
const bodies = async (id: string) => (await view('carol', id)).comments.map((c: Comment) => c.body);
/** The kinds of the caller's drafted ops on one thread. */
const draftedOn = async (key: string, threadId: string) =>
  ((await call('whoami', key)).journal.ops as DraftOp[]).filter((o) => o.threadId === threadId);
/** alice's published thread, optionally with published replies by the given callers. */
async function seed(opener: string, body: string, replies: Array<[string, string]> = []): Promise<Thread> {
  const t: Thread = await call('add-thread', opener, { body, anchor });
  await call('publish-review', opener);
  for (const [who, text] of replies) {
    await call('add-comment', who, { threadId: t.id, body: text });
    await call('publish-review', who);
  }
  return view('carol', t.id) as Promise<Thread>;
}

let tEdit: Thread, tDel: Thread, tOpen: Thread, tSelf: Thread, tStaleOpener: Thread, tStaleThread: Thread;
let aliceReview: string, bobReview: string, legacyReview: string;
let tThread: Thread, tBob: Thread, tRes: Thread, tOwn: Thread;
before(async () => {
  project = tempProject();
  tEdit = await seed('alice', 'edit me');
  tDel = await seed('alice', 'opening', [['alice', 'reply']]);
  tOpen = await seed('alice', 'opening', [['bob', 'flat reply']]);
  tSelf = await seed('alice', 'opening');
  tStaleOpener = await seed('alice', 'opening');
  tStaleThread = await seed('alice', 'all mine');
  tThread = await seed('alice', 'opening', [['bob', 'bob was here']]);
  tBob = await seed('bob', 'bob only');
  tRes = await seed('alice', 'resolve me');
  tOwn = await seed('alice', 'opening', [['alice', 'my reply']]);
  // Published reviews to discard: one of alice's, one of bob's, one whose manifest has no author key.
  const review = async (key: string, body: string) => {
    await call('add-thread', key, { body, anchor });
    return (await call('publish-review', key)).reviewId as string;
  };
  aliceReview = await review('alice', 'alice review');
  bobReview = await review('bob', 'bob review');
  legacyReview = await review('carol', 'legacy review');
  const legacyFile = path.join(project.root, 'docs', '.threads', 'reviews', `${legacyReview}.json`);
  const legacy = JSON.parse(fs.readFileSync(safePath(path.dirname(legacyFile), path.basename(legacyFile)), 'utf8'));
  delete legacy.authorKey;
  fs.writeFileSync(safePath(path.dirname(legacyFile), path.basename(legacyFile)), JSON.stringify(legacy));
});
after(() => project.cleanup());

test('edit-comment: a stranger is forbidden and the journal is unchanged; the author and an admin are not', async () => {
  const id = tEdit.comments[0].id;
  await forbidden(call('edit-comment', 'bob', { threadId: tEdit.id, commentId: id, body: 'x' }));
  assert.deepEqual(await draftedOn('bob', tEdit.id), [], 'the refusal drafted nothing');
  await call('edit-comment', 'alice', { threadId: tEdit.id, commentId: id, body: 'mine' });
  await call('edit-comment', 'root', { threadId: tEdit.id, commentId: id, body: 'admin' });
  assert.deepEqual((await draftedOn('alice', tEdit.id)).map((o) => o.kind), ['edit-comment']);
  assert.deepEqual((await draftedOn('root', tEdit.id)).map((o) => o.kind), ['edit-comment']);
});

test('a legacy comment, with no author key, is editable and deletable by an admin only', async () => {
  await forbidden(call('edit-comment', 'alice', { threadId: 't-thread1', commentId: 'c1-1', body: 'x' }));
  await forbidden(call('delete-comment', 'alice', { threadId: 't-thread1', commentId: 'c1-1' }));
  await call('edit-comment', 'root', { threadId: 't-thread1', commentId: 'c1-1', body: 'x' });
  await call('delete-comment', 'root', { threadId: 't-thread1', commentId: 'c1-2' });
});

test('delete-comment: a stranger is forbidden, the author is not', async () => {
  const reply = tDel.comments[1].id;
  await forbidden(call('delete-comment', 'bob', { threadId: tDel.id, commentId: reply }));
  await call('delete-comment', 'alice', { threadId: tDel.id, commentId: reply });
  await call('publish-review', 'alice');
  assert.deepEqual(await bodies(tDel.id), ['opening']);
});

test('delete-comment on the opening comment of a thread with replies: admin only, drafts delete-thread, and the thread goes', async () => {
  const opener = tOpen.comments[0].id;
  await forbidden(call('delete-comment', 'alice', { threadId: tOpen.id, commentId: opener }));
  await call('delete-comment', 'root', { threadId: tOpen.id, commentId: opener });
  const ops = await draftedOn('root', tOpen.id);
  assert.deepEqual(ops.map((o) => o.kind), ['delete-thread']);
  assert.deepEqual((ops[0] as { commentIds?: string[] }).commentIds, tOpen.comments.map((c) => c.id));
  await call('publish-review', 'root');
  assert.equal(await view('carol', tOpen.id), undefined);
});

test('an opener whose only reply is the author\'s own draft is deleted by its author, and publish keeps the reply', async () => {
  await call('add-comment', 'alice', { threadId: tSelf.id, body: 'my own reply' });
  await call('delete-comment', 'alice', { threadId: tSelf.id, commentId: tSelf.comments[0].id });
  assert.deepEqual((await draftedOn('alice', tSelf.id)).map((o) => o.kind), ['add-comment', 'delete-comment']);
  await call('publish-review', 'alice');
  assert.deepEqual(await bodies(tSelf.id), ['my own reply']);
});

test('dev callers keep the single-comment opener delete, at draft and at publish', async () => {
  const devCall = (name: string, payload: Json, who: string) =>
    (actions as Record<string, (p: Json, c: unknown) => Promise<never>>)[`threads:${name}`](
      { file: project.file, author: who, authorKey: who, ...payload }, makeCtx(project.root, { config: { src: 'docs' } }));
  const t = await devCall('add-thread', { body: 'opening', anchor }, 'pa');
  await devCall('publish-review', {}, 'pa');
  await devCall('add-comment', { threadId: t.id, body: 'flat reply' }, 'pb');
  await devCall('publish-review', {}, 'pb');
  await devCall('delete-comment', { threadId: t.id, commentId: t.comments[0].id }, 'pa');
  assert.deepEqual((await devCall('whoami', {}, 'pa')).journal.ops.map((o: { kind: string }) => o.kind), ['delete-comment']);
  await devCall('publish-review', {}, 'pa');
  assert.deepEqual(await bodies(t.id), ['flat reply']);
});

test('a stale opener delete is skipped at publish when the thread has gained a reply', async () => {
  await call('delete-comment', 'alice', { threadId: tStaleOpener.id, commentId: tStaleOpener.comments[0].id }); // her view: no replies
  await call('add-comment', 'carol', { threadId: tStaleOpener.id, body: 'flat reply' });
  await call('publish-review', 'carol');
  const result = await call('publish-review', 'alice');
  assert.deepEqual(result.skipped.map((s: { reason: string }) => s.reason), ['opening comment has replies; delete the thread']);
  assert.deepEqual(await bodies(tStaleOpener.id), ['opening', 'flat reply']);
});

test('a stale delete-thread is skipped at publish when the thread has gained a comment', async () => {
  await call('delete-thread', 'alice', { threadId: tStaleThread.id }); // her view: every comment is hers
  await call('add-comment', 'dave', { threadId: tStaleThread.id, body: 'dave arrived' });
  await call('publish-review', 'dave');
  const result = await call('publish-review', 'alice');
  assert.deepEqual(result.skipped.map((s: { reason: string }) => s.reason), ['thread has new comments']);
  assert.deepEqual(await bodies(tStaleThread.id), ['all mine', 'dave arrived']);
});

test('delete-thread after deleting one\'s own reply still publishes: the stale check sees the published comments', async () => {
  await call('delete-comment', 'alice', { threadId: tOwn.id, commentId: tOwn.comments[1].id });
  await call('delete-thread', 'alice', { threadId: tOwn.id });
  const ops = await draftedOn('alice', tOwn.id);
  assert.deepEqual(ops.map((o) => o.kind), ['delete-thread']);
  assert.deepEqual((ops[0] as { commentIds?: string[] }).commentIds, tOwn.comments.map((c) => c.id));
  const result = await call('publish-review', 'alice');
  assert.deepEqual((result as { skipped: unknown[] }).skipped, []);
  assert.equal(await view('carol', tOwn.id), undefined);
});

test('delete-thread: forbidden unless every published comment is the caller\'s; own drafts do not count; an admin may', async () => {
  await forbidden(call('delete-thread', 'alice', { threadId: tThread.id }));
  await forbidden(call('delete-thread', 'bob', { threadId: tThread.id }));
  await call('add-comment', 'bob', { threadId: tBob.id, body: 'bob draft' });
  await call('delete-thread', 'bob', { threadId: tBob.id });
  assert.deepEqual((await draftedOn('bob', tBob.id)).map((o) => o.kind), ['delete-thread']);
  await call('delete-thread', 'root', { threadId: tThread.id });
});

test('resolve-thread with resolve: author binds the thread\'s first comment; a drafted thread is its drafter\'s', async () => {
  await forbidden(call('resolve-thread', 'bob', { threadId: tRes.id }));
  await call('resolve-thread', 'alice', { threadId: tRes.id });
  await call('resolve-thread', 'root', { threadId: tRes.id });
  const drafted: Thread = await call('add-thread', 'erin', { body: 'mine', anchor });
  assert.equal(drafted.draft, true);
  await call('resolve-thread', 'erin', { threadId: drafted.id });
  const mine = await call('get-threads', 'erin');
  assert.equal(mine.find((t: Thread) => t.id === drafted.id).draft, true);
  assert.equal(Object.hasOwn(mine.find((t: Thread) => t.id === tRes.id), 'draft'), false, 'a published thread carries no draft key');
});

test('discard-review: only the review\'s author or an admin; a manifest without an author key is admin-only; a refusal changes nothing', async () => {
  const state = (id: string) => JSON.parse(fs.readFileSync(safePath(path.join(project.root, 'docs', '.threads', 'reviews'), `${id}.json`), 'utf8')).state;
  const docsRoot = path.join(project.root, 'docs');
  const tree = snapshotTree(docsRoot);
  await forbidden(call('discard-review', 'bob', { reviewId: aliceReview }));
  await forbidden(call('discard-review', 'alice', { reviewId: legacyReview }));
  assert.deepEqual(snapshotTree(docsRoot), tree, 'a refusal changes nothing under the docs root');
  assert.deepEqual(await call('discard-review', 'alice', { reviewId: aliceReview }), { discarded: true });
  await call('discard-review', 'root', { reviewId: bobReview });
  await call('discard-review', 'root', { reviewId: legacyReview });
  assert.deepEqual([aliceReview, bobReview, legacyReview].map(state), ['discarded', 'discarded', 'discarded']);
});
