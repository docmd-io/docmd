import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, failingReset, failingWrites, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { createDraftStore, makeOp } from '../src/plugin/drafts.ts';
import { applyOps, discard, publish, reverseOps } from '../src/plugin/reviews.ts';
import { createLock, createNoGitSync, type Sync } from '../src/plugin/lock.ts';
import { assertCan } from '../src/plugin/permissions.ts';
import * as parser from '../src/plugin/parser.ts';
import type { Caller, DraftOp, NewDraftOp, PublishResult, WhoAmI } from '../src/types.ts';

const AT = '2026-03-10T12:00:00.000Z';
const FILE = 'docs/index.md';
const OTHER = 'docs/other.md';
const anchor = (q: string) => ({ quote: q, prefix: null, suffix: null, selector: null, offset: null, blockText: null });
const mk = (op: NewDraftOp): DraftOp => makeOp(op, AT);

// ---------------------------------------------------------------------------
// reverseOps: small, pure
// ---------------------------------------------------------------------------

const PAGE = `---
title: Sample
---

Some ==marked text=={t-1} here and plain target text, over
two lines.

::: threads
  ::: thread t-1
    ::: anchor
      marked text
    :::

    ::: comment c-1 "Bob" "2026-03-01"
      First.

      ::: reactions
        - 👍 Bob
      :::
    :::

    ::: comment c-2 "Bob" "2026-03-02"
      Second.
    :::
  :::

  ::: thread t-2
    ::: comment c-3 "Bob" "2026-03-03"
      Other.
    :::
  :::

  ::: thread t-4 resolved "Carol" "2026-03-04"
    ::: comment c-4 "Carol" "2026-03-04"
      Done.
    :::
  :::
:::
`;

/** PAGE as the serializer writes it, so reversals can be compared byte for byte. */
const NORMAL = parser.replaceThreadsBlock(PAGE, parser.parseThreadsFromContent(PAGE));
const apply = (ops: DraftOp[], content = NORMAL, name = 'Alice') =>
  applyOps(content, ops, { authorKey: `k-${name}`, authorName: name, reviewId: 'r-1' });

const rows: Array<{ name: string; author?: string; ops: NewDraftOp[]; changes: RegExp }> = [
  { name: 'add-thread (single-line highlight)', ops: [{ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor('plain target text'), body: 'New' }], changes: /==plain target text=={t-new}/ },
  { name: 'add-thread (multi-line highlight)', ops: [{ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor('over\ntwo lines'), body: 'New' }], changes: /==over\ntwo lines=={t-new}/ },
  { name: 'add-comment', ops: [{ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-r', parentId: 'c-3', body: 'R' }], changes: /c-r/ },
  { name: 'edit-comment', ops: [{ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-2', body: 'Changed' }], changes: /Changed/ },
  { name: 'delete-comment (original position)', ops: [{ kind: 'delete-comment', file: FILE, threadId: 't-1', commentId: 'c-1' }], changes: /^(?![\s\S]*First)/ },
  { name: 'delete-thread (thread and highlight)', ops: [{ kind: 'delete-thread', file: FILE, threadId: 't-1' }], changes: /^(?![\s\S]*thread t-1)/ },
  { name: 'resolve-thread (reopen a resolved thread)', ops: [{ kind: 'resolve-thread', file: FILE, threadId: 't-4' }], changes: /^(?![\s\S]*thread t-4 resolved)/ },
  { name: 'resolve-thread', ops: [{ kind: 'resolve-thread', file: FILE, threadId: 't-2' }], changes: /resolved "Alice"/ },
  { name: 'toggle-reaction (add)', ops: [{ kind: 'toggle-reaction', file: FILE, threadId: 't-1', commentId: 'c-2', emoji: '🎉' }], changes: /🎉/ },
  { name: 'toggle-reaction (remove)', author: 'Bob', ops: [{ kind: 'toggle-reaction', file: FILE, threadId: 't-1', commentId: 'c-1', emoji: '👍' }], changes: /^(?![\s\S]*👍)/ },
];

const appliedRows = new Map<string, ReturnType<typeof apply>>();
before(() => {
  for (const row of rows) appliedRows.set(row.name, apply(row.ops.map(mk), NORMAL, row.author ?? 'Alice'));
});

for (const row of rows) {
  test(`reverseOps undoes ${row.name}`, () => {
    const author = row.author ?? 'Alice';
    const done = appliedRows.get(row.name)!;
    assert.match(done.content, row.changes, 'the op changed the page');
    const back = reverseOps(done.content, done.applied, { authorName: author });
    assert.deepEqual(back.skipped, []);
    assert.deepEqual(parser.parseThreadsFromContent(back.content), parser.parseThreadsFromContent(NORMAL));
    assert.equal(back.content, NORMAL);
  });
}

test('reverseOps removes a started thread with a later reply by someone else', () => {
  const started = appliedRows.get('add-thread (single-line highlight)')!;
  const withBob = apply(
    [mk({ kind: 'add-comment', file: FILE, threadId: 't-new', commentId: 'c-bob', parentId: 'c-new', body: 'Later' })],
    started.content,
    'Bob',
  );
  assert.match(withBob.content, /c-bob/);
  const back = reverseOps(withBob.content, started.applied, { authorName: 'Alice' });
  assert.deepEqual(back.skipped, []);
  assert.equal(back.content, NORMAL);
});

test('reverseOps re-parents later replies to a removed reply', () => {
  const r = apply([mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-r', parentId: 'c-3', body: 'R' })]);
  const later = apply([mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-bob', parentId: 'c-r', body: 'To R' })], r.content, 'Bob');
  const back = reverseOps(later.content, r.applied, { authorName: 'Alice' });
  const t2 = parser.parseThreadsFromContent(back.content).find((t) => t.id === 't-2')!;
  assert.deepEqual(t2.comments.map((c) => [c.id, c.parent_id]), [['c-3', null], ['c-bob', 'c-3']]);
});

test('reverseOps skips ops whose target is gone, reverses the rest, is idempotent and returns an unchanged input as is', () => {
  const ops = apply([
    mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: null, body: 'New' }),
    mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-r', parentId: 'c-3', body: 'R' }),
  ]);
  // someone deleted t-new since the publish
  const gone = parser.replaceThreadsBlock(ops.content, parser.parseThreadsFromContent(ops.content).filter((t) => t.id !== 't-new'));
  const first = reverseOps(gone, ops.applied, { authorName: 'Alice' });
  assert.deepEqual(first.skipped.map((s) => s.opId), [ops.applied[0].opId]);
  assert.match(first.skipped[0].reason, /t-new/);
  assert.equal(first.content, NORMAL);
  const second = reverseOps(first.content, ops.applied, { authorName: 'Alice' });
  assert.equal(second.content, first.content);
});

test('reverseOps returns an input it changes nothing in as the same string, even when it is not in serializer form', () => {
  assert.notEqual(PAGE, NORMAL, 'the raw page differs from its re-serialized form');
  const absent = apply([mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: null, body: 'New' })]);
  const back = reverseOps(PAGE, absent.applied, { authorName: 'Alice' });
  assert.equal(back.content, PAGE);
  assert.deepEqual(back.skipped.map((x) => x.reason), ['thread t-new not found']);
});

test('reverseOps undoes several ops on one comment newest first', () => {
  const twice = apply([
    mk({ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-2', body: 'First edit' }),
    mk({ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-2', body: 'Second edit' }),
  ]);
  assert.match(twice.content, /Second edit/);
  assert.equal(reverseOps(twice.content, twice.applied, { authorName: 'Alice' }).content, NORMAL);
});

test('reverseOps skips an edit with no recorded before-state', () => {
  const edit = apply([mk({ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-2', body: 'Changed' })]);
  const bare = edit.applied.map(({ before: _before, ...rest }) => rest);
  const back = reverseOps(edit.content, bare as never, { authorName: 'Alice' });
  assert.deepEqual(back.skipped.map((s) => s.reason), ['no recorded before-state']);
  assert.equal(back.content, edit.content);
});

// ---------------------------------------------------------------------------
// discard: medium, one temp project per file
// ---------------------------------------------------------------------------

const OTHER_PAGE = `# Other Page

Target sentence here.

::: threads
  ::: thread t-oth
    ::: comment c-o1 "Bob" "2026-03-01"
      First.
    :::
  :::
:::
`;

let project: TempProject;
let docsRoot: string;
const ctx = (extra: Partial<TestCtx> = {}) => makeCtx(project.root, { config: { src: 'docs' }, ...extra });
const read = (rel: string) => fs.readFileSync(safePath(project.root, rel), 'utf8');
const readAt = (p: string) => fs.readFileSync(safePath(path.dirname(p), path.basename(p)), 'utf8');
const manifestPath = (id: string) => path.join(docsRoot, '.threads', 'reviews', `${id}.json`);
const manifestOf = (id: string) => JSON.parse(readAt(manifestPath(id)));
const ALICE = { author: 'Alice', authorKey: 'k-alice' };
const BOB = { author: 'Bob', authorKey: 'k-bob' };
const ALICE_CALLER: Caller = { key: 'k-alice', name: 'Alice', avatarUrl: '', source: 'payload', isAdmin: false };
const store = () => createDraftStore(docsRoot);
const fill = (key: string, ops: NewDraftOp[], s = store()) => s.transact(key, (j, at) => void j.ops.push(...ops.map((o) => makeOp(o, at))));
const call = <T>(name: string, payload: Record<string, unknown>, extra: Partial<TestCtx> = {}) =>
  (actions[name] as (p: unknown, c: TestCtx) => Promise<T>)(payload, ctx(extra));
const pageThreads = (rel: string) => parser.parseThreadsFromContent(read(rel));
const idsOf = (rel: string) => pageThreads(rel).map((t) => t.id);
const commentIds = (rel: string, threadId: string) => pageThreads(rel).find((t) => t.id === threadId)!.comments.map((c) => c.id);
const deps = (extra: { sync?: Sync; now?: () => number } = {}) => ({ store: store(), sync: createNoGitSync(createLock()), ...extra });

const aliceOps = (): NewDraftOp[] => [
  { kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor('parser rules'), body: 'New on index' },
  { kind: 'add-comment', file: OTHER, threadId: 't-oth', commentId: 'c-r', parentId: 'c-o1', body: 'Reply R' },
];
/** Alice publishes `aliceOps`, then Bob replies to her new thread in his own review. Returns Alice's review id. */
async function publishAliceThenBob(): Promise<string> {
  await fill('k-alice', aliceOps());
  const { reviewId } = await call<PublishResult>('threads:publish-review', ALICE);
  await fill('k-bob', [{ kind: 'add-comment', file: FILE, threadId: 't-new', commentId: 'c-bob', parentId: 'c-new', body: 'Later' }]);
  await call('threads:publish-review', BOB);
  return reviewId;
}

let original: string[];
before(() => {
  project = tempProject();
  docsRoot = path.join(project.root, 'docs');
});
after(() => project.cleanup());
beforeEach(() => {
  project.reset();
  fs.writeFileSync(safePath(project.root, OTHER), OTHER_PAGE);
  fs.rmSync(path.join(docsRoot, '.threads'), { recursive: true, force: true });
  original = idsOf(FILE);
});

test('discarding a published review reverses it on both pages and marks the manifest; a second discard is invalid, an unknown id not-found', async () => {
  const id = await publishAliceThenBob();
  assert.match(read(FILE), /==parser rules=={t-new}/);
  assert.deepEqual(commentIds(OTHER, 't-oth'), ['c-o1', 'c-r']);
  const published = manifestOf(id);

  // Called directly (not through the action) to inject the clock for `discardedAt`.
  const result = await discard(ALICE_CALLER, ctx() as never, id, deps({ now: () => Date.parse('2031-02-03T04:05:06.000Z') }));
  assert.deepEqual(result, { discarded: true });

  assert.deepEqual(idsOf(FILE), original, 'T and its replies are gone');
  assert.doesNotMatch(read(FILE), /==parser rules==/);
  assert.match(read(FILE), /parser rules here/, 'the quoted text is plain again');
  assert.deepEqual(commentIds(OTHER, 't-oth'), ['c-o1'], 'R is gone and the thread is intact');
  const m = manifestOf(id);
  assert.deepEqual(
    [m.state, m.discardedAt, m.discardedBy],
    ['discarded', '2031-02-03T04:05:06.000Z', 'k-alice'],
  );
  assert.deepEqual(m.discardSkipped, []);
  assert.deepEqual({ ...m, state: 'published', discardedAt: undefined, discardedBy: undefined, discardSkipped: undefined }, { ...published, discardedAt: undefined, discardedBy: undefined, discardSkipped: undefined }, 'the rest of the manifest is untouched');

  const bytes = [read(FILE), read(OTHER), readAt(manifestPath(id))];
  await assert.rejects(call('threads:discard-review', { reviewId: id, ...ALICE }), /^ThreadsError: threads\/invalid: /);
  await assert.rejects(call('threads:discard-review', { reviewId: 'r-nope', ...ALICE }), /^ThreadsError: threads\/not-found: /);
  assert.deepEqual([read(FILE), read(OTHER), readAt(manifestPath(id))], bytes, 'nothing changed');
});

test('a page that cannot be read at discard time puts its ops in discardSkipped; the other pages are reversed', async () => {
  const id = await publishAliceThenBob();
  fs.rmSync(safePath(project.root, OTHER));
  await call('threads:discard-review', { reviewId: id, ...ALICE });
  assert.deepEqual(idsOf(FILE), original);
  const m = manifestOf(id);
  assert.equal(m.state, 'discarded');
  assert.equal(m.discardSkipped.length, 1);
  assert.equal(m.discardSkipped[0].opId, m.ops.find((o: { file: string }) => o.file === OTHER).opId);
  assert.match(m.discardSkipped[0].reason, /not readable/);
});

test('a write failing on the second page restores the first and keeps the manifest published; the retry equals a clean discard', async () => {
  const id = await publishAliceThenBob();
  const bytes = [read(FILE), read(OTHER), readAt(manifestPath(id))];
  await assert.rejects(call('threads:discard-review', { reviewId: id, ...ALICE }, failingWrites(project.root, 2, true)), /disk full/);
  assert.deepEqual([read(FILE), read(OTHER), readAt(manifestPath(id))], bytes, 'the first page is back, the manifest untouched');
  assert.equal(manifestOf(id).state, 'published');

  await call('threads:discard-review', { reviewId: id, ...ALICE });
  assert.deepEqual(idsOf(FILE), original);
  assert.deepEqual(commentIds(OTHER, 't-oth'), ['c-o1']);
  assert.equal(manifestOf(id).state, 'discarded');
});

test('discarding the open review empties its ops, keeps its id and writes nothing else; another caller\'s open id is not-found', async () => {
  await fill('k-alice', aliceOps());
  await fill('k-bob', [{ kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-b', parentId: null, body: 'b' }]);
  const aliceId = (await store().load('k-alice')).review.id;
  const bobId = (await store().load('k-bob')).review.id;
  const pages = [read(FILE), read(OTHER)];

  assert.deepEqual(await call('threads:discard-review', { reviewId: aliceId, ...ALICE }), { discarded: true });
  const journal = await store().load('k-alice');
  assert.deepEqual([journal.ops, journal.review.id], [[], aliceId]);
  assert.deepEqual([read(FILE), read(OTHER)], pages);
  assert.equal(fs.existsSync(path.join(docsRoot, '.threads', 'reviews')), false, 'no manifest');

  await assert.rejects(call('threads:discard-review', { reviewId: bobId, ...ALICE }), /^ThreadsError: threads\/not-found: /);
  assert.equal((await store().load('k-bob')).ops.length, 1, "bob's journal is unchanged");
});

test('discard and publish on one docs root run one after the other', async () => {
  const id = await publishAliceThenBob();
  await fill('k-bob', [{ kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-b2', parentId: null, body: 'second' }]);
  const log: string[] = [];
  const inner = createLock();
  const sync = createNoGitSync({
    withLock: (fn) => inner.withLock(async () => {
      log.push('enter');
      try {
        return await fn();
      } finally {
        log.push('exit');
      }
    }),
  });
  const [discarded, published] = await Promise.all([
    discard(ALICE_CALLER, ctx() as never, id, deps({ sync })),
    publish({ ...ALICE_CALLER, key: 'k-bob', name: 'Bob' }, ctx() as never, deps({ sync })),
  ]);
  assert.deepEqual(log, ['enter', 'exit', 'enter', 'exit']);
  assert.deepEqual(discarded, { discarded: true });
  assert.deepEqual(published.skipped, []);
  assert.ok(commentIds(FILE, 't-thread2').includes('c-b2'));
  assert.equal(manifestOf(id).state, 'discarded');
});

test('discard checks permission on the manifest read under the lock: an author change before the lock refuses and changes nothing', async () => {
  const id = await publishAliceThenBob();
  const caller: Caller = { ...ALICE_CALLER, source: 'git' };
  let manifestBytes = '';
  const inner = createLock();
  // Another author's publish lands between the caller's first look and the lock being taken.
  const sync = createNoGitSync({
    withLock: (fn) => inner.withLock(async () => {
      fs.writeFileSync(manifestPath(id), JSON.stringify({ ...manifestOf(id), authorKey: 'k-bob' }, null, 2) + '\n');
      manifestBytes = readAt(manifestPath(id));
      return fn();
    }),
  });
  const seen: Array<string | null> = [];
  const authorize = (m: { authorKey?: string | null } | null) => {
    seen.push(m ? (m.authorKey ?? null) : null);
    assertCan(caller, 'discard-review', { reviewAuthor: m ? (m.authorKey ?? null) : caller.key }, { resolve: 'anyone' });
  };
  const pages = [read(FILE), read(OTHER)];
  await assert.rejects(discard(caller, ctx() as never, id, deps({ sync, authorize })), /^ThreadsError: threads\/forbidden: /);
  assert.deepEqual(seen, ['k-bob']);
  assert.deepEqual([read(FILE), read(OTHER)], pages, 'pages unchanged');
  assert.equal(readAt(manifestPath(id)), manifestBytes, 'manifest unchanged');
  assert.equal(manifestOf(id).state, 'published');
});

// The failed-reset window: the files and the manifest were written, the journal reset failed.
async function window(): Promise<{ id: string; manifest: string }> {
  await fill('k-alice', aliceOps());
  const real = store();
  await assert.rejects(publish(ALICE_CALLER, ctx() as never, { store: failingReset(real), sync: createNoGitSync(createLock()) }), /journal write failed/);
  const id = (await real.load('k-alice')).review.id;
  assert.equal((await real.load('k-alice')).ops.length, 2, 'the journal still lists the ops');
  await call('threads:discard-review', { reviewId: id, ...ALICE });
  assert.equal(manifestOf(id).state, 'discarded');
  return { id, manifest: readAt(manifestPath(id)) };
}

test('after a discard in the failed-reset window whoami and get-threads show nothing of it, and publish is empty-review, leaves the manifest alone and rotates the journal', async () => {
  const { id, manifest } = await window();
  const me = await call<WhoAmI>('threads:whoami', ALICE);
  assert.deepEqual(me.journal!.ops, []);
  const view = await call<Array<{ id: string; draft?: boolean }>>('threads:get-threads', { file: FILE, ...ALICE });
  assert.deepEqual(view.filter((t) => t.draft), []);
  assert.deepEqual(view.map((t) => t.id), original);
  await assert.rejects(call('threads:publish-review', ALICE), /^ThreadsError: threads\/empty-review: /);
  assert.equal(readAt(manifestPath(id)), manifest, 'the discarded manifest is byte-identical');
  const journal = await store().load('k-alice');
  assert.deepEqual(journal.ops, []);
  assert.notEqual(journal.review.id, id);
  assert.deepEqual(idsOf(FILE), original, 'the discarded ops were not applied again');
});

test('an op drafted in the window is published under a new review id, without the discarded ops', async () => {
  const { id, manifest } = await window();
  await fill('k-alice', [{ kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-win', parentId: null, body: 'in the window' }]);
  const result = await call<PublishResult>('threads:publish-review', ALICE);
  assert.notEqual(result.reviewId, id);
  assert.equal(readAt(manifestPath(id)), manifest);
  assert.deepEqual(idsOf(FILE), original, 'the discarded thread did not come back');
  assert.ok(commentIds(FILE, 't-thread2').includes('c-win'));
  assert.deepEqual(manifestOf(result.reviewId).ops.map((o: { commentId: string }) => o.commentId), ['c-win']);
});

test('a profile pending in a journal whose review was published, then discarded, is still written', async () => {
  const { id, manifest } = await window();
  const profile = { name: 'Alice B', avatarUrl: '' };
  await store().transact('k-alice', (j) => void (j.profile = profile));
  const result = await call<PublishResult>('threads:publish-review', ALICE);
  assert.notEqual(result.reviewId, id, 'the journal had moved to a new review');
  const authors = JSON.parse(readAt(path.join(docsRoot, '.threads', 'authors.json')));
  assert.deepEqual(authors['k-alice'], profile);
  assert.equal(readAt(manifestPath(id)), manifest, 'the discarded manifest is untouched');
  assert.equal((await store().load('k-alice')).profile, undefined);
});
