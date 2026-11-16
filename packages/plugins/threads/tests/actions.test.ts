/**
 * Coverage map. Every threads mutation now lands in the caller's draft journal
 * instead of the markdown, so the old immediate-write cases became drafts cases:
 *
 *  - "add-thread creates a thread", "add-comment appends"          → "add-thread and add-comment draft..."
 *  - "get-threads reads the threads of the fixture page"            → "get-threads returns published threads plus the caller's own drafts"
 *  - "edit-comment", "delete-comment", "delete-thread",
 *    "resolve-thread", "toggle-reaction"                            → "mutations on published and drafted targets" (table)
 *  - delete-comment on a drafted comment, replies, first comment    → "deleting a drafted comment removes its drafted replies" and "deleting a drafted first comment removes the thread"
 *  - "add-thread with an anchor wraps the quote in highlight
 *    markup", "add-thread anchor does not match text inside the
 *    threads block", "delete-thread removes the highlight markup"   → moved to publish (drafts never write markdown)
 *  - input validation, threads/<code> prefixes                      → kept
 *  - plugin surface                                                 → kept, plus the ten action names
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, MarkdownIt, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { slug } from '../src/plugin/drafts.ts';
import * as plugin from '../src/index.ts';
import { ThreadsError } from '../src/plugin/errors.ts';
import type { Thread, Comment, DraftOp, Reaction } from '../src/types.ts';

let project: TempProject;
let docsRoot: string;
before(() => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-10T12:00:00Z') });
  project = tempProject();
  docsRoot = path.join(project.root, 'docs');
});
after(() => {
  mock.timers.reset();
  project.cleanup();
});
beforeEach(() => {
  project.reset();
  fs.rmSync(path.join(docsRoot, '.threads'), { recursive: true, force: true });
});

const ALICE = { author: 'Alice', authorKey: 'alice' };
const BOB = { author: 'Bob', authorKey: 'bob' };
const journalPath = (key: string) => path.join(docsRoot, '.threads', 'drafts', `${slug(key)}.json`);
const readJson = (p: string) => JSON.parse(fs.readFileSync(safePath(path.dirname(p), path.basename(p)), 'utf8'));
const journalOps = (key: string): DraftOp[] => readJson(journalPath(key)).ops;
const read = () => fs.readFileSync(safePath(project.root, project.file), 'utf8');

type Handler = (payload: Record<string, unknown>, ctx: TestCtx) => Promise<unknown>;
/** Call an action like the dispatcher does. */
async function call<T = unknown>(name: string, payload: Record<string, unknown>, extra: Partial<TestCtx> = {}) {
  const handler = (actions as unknown as Record<string, Handler>)[name];
  assert.ok(handler, `Unknown action: ${name}`);
  const ctx = makeCtx(project.root, { config: { src: 'docs' }, ...extra });
  return { result: (await handler(payload, ctx)) as T, ctx };
}
const as = (who: Record<string, string>, payload: Record<string, unknown>) => ({ file: project.file, ...who, ...payload });

const addThread = async (who = ALICE, body = 'draft thread') =>
  (await call<Thread>('threads:add-thread', as(who, { body }))).result;
const addComment = async (threadId: string, extra: Record<string, unknown> = {}, who = ALICE) =>
  (await call<Comment>('threads:add-comment', as(who, { threadId, body: 'draft reply', ...extra }))).result;
const getThreads = async (payload: Record<string, unknown>, extra: Partial<TestCtx> = {}) =>
  (await call<Thread[]>('threads:get-threads', { file: project.file, ...payload }, extra)).result;

test('add-thread and add-comment draft without touching the markdown', async () => {
  const before = fs.readFileSync(safePath(project.root, project.file));
  const { result: thread, ctx: threadCtx } = await call<Thread>('threads:add-thread', as(ALICE, { body: 'draft thread' }));
  const { result: comment, ctx } = await call<Comment>('threads:add-comment', as(ALICE, { threadId: 't-thread1', parentId: 'c1-1', body: 'reply' }));

  assert.deepEqual(fs.readFileSync(safePath(project.root, project.file)), before);
  assert.deepEqual([threadCtx.source._modified, ctx.source._modified], [false, false]);
  assert.match(thread.id, /^t-[0-9a-f]{8}$/);
  assert.match(comment.id, /^c-[0-9a-f]{8}$/);

  const ops = journalOps('alice');
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], {
    kind: 'add-thread', opId: ops[0].opId, at: '2026-03-10T12:00:00.000Z', file: project.file,
    threadId: thread.id, commentId: thread.comments[0].id, body: 'draft thread',
  });
  assert.deepEqual(ops[1], {
    kind: 'add-comment', opId: ops[1].opId, at: '2026-03-10T12:00:00.000Z', file: project.file,
    threadId: 't-thread1', commentId: comment.id, parentId: 'c1-1', body: 'reply',
  });
  assert.equal(thread.comments[0].author, 'Alice');
  assert.equal(thread.comments[0].date, '2026-03-10');
  assert.equal(comment.parent_id, 'c1-1');
  assert.deepEqual(Object.keys(readJson(journalPath('alice'))).sort(), ['ops', 'version']);
});

// Depends on e2e/fixtures/playground-index.md: update together if that fixture's threads change.
test("get-threads returns published threads plus the caller's own drafts", async () => {
  const thread = await addThread();
  const reply = await addComment('t-thread2');
  const ids = (ts: Thread[]) => ts.map((t) => t.id);

  const mine = await getThreads(ALICE);
  assert.deepEqual(ids(mine), ['t-thread1', 't-thread2', 't-thread3', thread.id]);
  assert.deepEqual(mine[1].comments.map((c) => c.id), ['c2-1', reply.id]);
  assert.deepEqual(await getThreads(ALICE), mine, 'read back from disk, same result');

  for (const other of [BOB, {}]) {
    const theirs = await getThreads(other);
    assert.deepEqual(ids(theirs), ['t-thread1', 't-thread2', 't-thread3']);
    assert.deepEqual(theirs[0].comments.map((c) => c.author), ['Alice', 'Bob']);
    assert.equal(theirs[2].resolved_by, 'Alice');
    assert.equal(theirs[1].comments.length, 1);
  }
});

test('get-threads on a file without threads returns [] and does not write', async () => {
  fs.writeFileSync(safePath(project.root, project.file), '# Plain\n');
  const { result, ctx } = await call<Thread[]>('threads:get-threads', as(ALICE, {}));
  assert.deepEqual(result, []);
  assert.equal(ctx.source._modified, false);
  assert.equal(fs.existsSync(path.join(docsRoot, '.threads', 'drafts')), false);
});

/** A published target and a drafted one for each of the five handlers. */
interface Row {
  name: string;
  action: string;
  published: (extra?: Record<string, unknown>) => Record<string, unknown>;
  /** From a fresh drafted thread t (first comment c) and a drafted reply r. */
  drafted: (t: Thread, r: Comment) => Record<string, unknown>;
  /** Kinds in the journal after the call on a published target (journal holds one unrelated op beforehand). */
  kind: string;
  /** After the call on a drafted target: the check on ops (count is unchanged unless `shrinks`). */
  check: (ops: DraftOp[], t: Thread, r: Comment) => void;
  shrinks?: number;
}
const rows: Row[] = [
  {
    name: 'edit-comment', action: 'threads:edit-comment', kind: 'edit-comment',
    published: () => ({ threadId: 't-thread1', commentId: 'c1-2', body: 'edited' }),
    drafted: (t, r) => ({ threadId: t.id, commentId: r.id, body: 'edited' }),
    check: (ops, _t, r) => assert.equal((ops.find((o) => o.kind === 'add-comment' && o.commentId === r.id) as { body: string }).body, 'edited'),
  },
  {
    name: 'delete-comment', action: 'threads:delete-comment', kind: 'delete-comment',
    published: () => ({ threadId: 't-thread1', commentId: 'c1-2' }),
    drafted: (t, r) => ({ threadId: t.id, commentId: r.id }),
    check: (ops, _t, r) => assert.ok(!ops.some((o) => 'commentId' in o && o.commentId === r.id)),
    shrinks: 1,
  },
  {
    name: 'delete-thread', action: 'threads:delete-thread', kind: 'delete-thread',
    published: () => ({ threadId: 't-thread2' }),
    drafted: (t) => ({ threadId: t.id }),
    check: (ops, t) => assert.ok(!ops.some((o) => o.threadId === t.id)),
    shrinks: 2,
  },
  {
    name: 'resolve-thread', action: 'threads:resolve-thread', kind: 'resolve-thread',
    published: () => ({ threadId: 't-thread2' }),
    drafted: (t) => ({ threadId: t.id }),
    check: (ops) => assert.ok(!ops.some((o) => o.kind === 'resolve-thread')),
  },
  {
    name: 'toggle-reaction', action: 'threads:toggle-reaction', kind: 'toggle-reaction',
    published: () => ({ threadId: 't-thread1', commentId: 'c1-1', emoji: '👍' }),
    drafted: (t, r) => ({ threadId: t.id, commentId: r.id, emoji: '👍' }),
    check: (ops) => assert.ok(!ops.some((o) => o.kind === 'toggle-reaction')),
  },
];

for (const row of rows) {
  test(`${row.name}: a published target appends one op`, async () => {
    await addThread(); // one unrelated op
    await call(row.action, as(ALICE, row.published()));
    const ops = journalOps('alice');
    assert.equal(ops.length, 2);
    assert.equal(ops[1].kind, row.kind);
    assert.equal(read().includes('c1-2'), true, 'markdown untouched');
  });

  test(`${row.name}: a drafted target is changed in place`, async () => {
    const t = await addThread();
    const r = await addComment(t.id);
    // toggle-reaction and resolve-thread need a first op to cancel.
    if (row.name === 'toggle-reaction' || row.name === 'resolve-thread') {
      await call(row.action, as(ALICE, row.drafted(t, r)));
      assert.equal(journalOps('alice').length, 3, 'first call appends');
    }
    const count = journalOps('alice').length;
    await call(row.action, as(ALICE, row.drafted(t, r)));
    const ops = journalOps('alice');
    if (row.name === 'toggle-reaction' || row.name === 'resolve-thread') assert.equal(ops.length, count - 1, 'second call cancels the first');
    else assert.equal(ops.length, count - (row.shrinks ?? 0));
    row.check(ops, t, r);
  });
}

test('toggle-reaction returns the overlaid reactions and edit-comment the overlaid comment', async () => {
  const t = await addThread();
  const { result: reactions } = await call<Reaction[]>('threads:toggle-reaction', as(ALICE, { threadId: 't-thread1', commentId: 'c1-1', emoji: '🎉' }));
  assert.deepEqual(reactions, [{ emoji: '🎉', authors: ['Alice'] }]);
  const { result: edited } = await call<Comment>('threads:edit-comment', as(ALICE, { threadId: t.id, commentId: t.comments[0].id, body: 'v2' }));
  assert.deepEqual([edited.body, edited.author], ['v2', 'Alice']);
  const { result: resolved } = await call<Thread>('threads:resolve-thread', as(ALICE, { threadId: 't-thread1' }));
  assert.deepEqual([resolved.resolved, resolved.resolved_by, resolved.resolved_at], [true, 'Alice', '2026-03-10']);
});

test('deleting a drafted comment removes its drafted replies, transitively, and ops on them', async () => {
  const t = await addThread();
  const mid = await addComment(t.id);
  const leaf = await addComment(t.id, { parentId: mid.id });
  const sibling = await addComment(t.id);
  await call('threads:toggle-reaction', as(ALICE, { threadId: t.id, commentId: leaf.id, emoji: '👍' }));

  await call('threads:delete-comment', as(ALICE, { threadId: t.id, commentId: mid.id }));
  const ops = journalOps('alice');
  assert.deepEqual(ops.map((o) => o.kind), ['add-thread', 'add-comment']);
  assert.equal((ops[1] as { commentId: string }).commentId, sibling.id);
});

test('deleting a drafted first comment removes the thread and every op on it', async () => {
  const t = await addThread();
  await addComment(t.id);
  const keep = await addThread(ALICE, 'other');
  await call('threads:delete-comment', as(ALICE, { threadId: t.id, commentId: t.comments[0].id }));
  assert.deepEqual(journalOps('alice').map((o) => o.threadId), [keep.id]);
});

test('deleting a published comment or thread first drops the caller\'s earlier ops on it', async () => {
  await call('threads:edit-comment', as(ALICE, { threadId: 't-thread1', commentId: 'c1-2', body: 'x' }));
  await call('threads:toggle-reaction', as(ALICE, { threadId: 't-thread1', commentId: 'c1-2', emoji: '👍' }));
  await call('threads:delete-comment', as(ALICE, { threadId: 't-thread1', commentId: 'c1-2' }));
  assert.deepEqual(journalOps('alice').map((o) => o.kind), ['delete-comment']);

  await call('threads:resolve-thread', as(ALICE, { threadId: 't-thread2' }));
  await addComment('t-thread2');
  await call('threads:delete-thread', as(ALICE, { threadId: 't-thread2' }));
  assert.deepEqual(journalOps('alice').map((o) => o.kind), ['delete-comment', 'delete-thread']);
});

test('concurrent calls are one locked read-modify-write each', async () => {
  const t = await addThread();
  const toggle = () => call('threads:toggle-reaction', as(ALICE, { threadId: t.id, commentId: t.comments[0].id, emoji: '👍' }));
  await Promise.all([toggle(), toggle()]);
  assert.deepEqual(journalOps('alice').map((o) => o.kind), ['add-thread']);

  await Promise.all([addComment(t.id), addComment(t.id)]);
  assert.equal(journalOps('alice').filter((o) => o.kind === 'add-comment').length, 2);
});

const MUTATIONS: Array<[string, Record<string, unknown>]> = [
  ['threads:add-thread', { body: 'b' }],
  ['threads:add-comment', { threadId: 't-thread1', body: 'b' }],
  ['threads:edit-comment', { threadId: 't-thread1', commentId: 'c1-1', body: 'b' }],
  ['threads:delete-comment', { threadId: 't-thread1', commentId: 'c1-2' }],
  ['threads:delete-thread', { threadId: 't-thread3' }],
  ['threads:resolve-thread', { threadId: 't-thread2' }],
  ['threads:toggle-reaction', { threadId: 't-thread1', commentId: 'c1-1', emoji: '👍' }],
];

test('serve without a trusted identity refuses every mutation; dev succeeds; get-threads works in both', async () => {
  for (const [name, payload] of MUTATIONS) {
    await assert.rejects(
      call(name, as(ALICE, payload), { mode: 'serve', caller: { identity: null } }),
      (e: unknown) => e instanceof ThreadsError && e.code === 'no-identity' && /no trusted identity/.test(e.message),
      name,
    );
    assert.equal(fs.existsSync(path.join(docsRoot, '.threads')), false, `${name} wrote nothing`);
  }
  for (const [name, payload] of MUTATIONS) {
    await call(name, as(ALICE, payload), { mode: 'dev', caller: { identity: null } });
  }
  for (const mode of ['serve', 'dev'] as const) {
    const out = await getThreads(mode === 'dev' ? BOB : {}, { mode, caller: { identity: null } });
    assert.deepEqual(out.map((t) => t.id).slice(0, 3), ['t-thread1', 't-thread2', 't-thread3'], mode);
  }
});

test('serve keys journals on the trusted identity, not the payload', async () => {
  const serve = (identity: string): Partial<TestCtx> => ({ mode: 'serve', caller: { identity } });
  const t = (await call<Thread>('threads:add-thread', as({ author: 'Mallory', authorKey: 'bob' }, { body: 'mine' }), serve('alice'))).result;
  assert.equal(fs.existsSync(journalPath('bob')), false);
  assert.equal(journalOps('alice').length, 1);
  assert.equal(t.comments[0].author, 'Mallory', 'the payload still supplies the display name');

  const asBob = await getThreads({ author: 'Bob', authorKey: 'alice' }, serve('bob'));
  assert.ok(!asBob.some((x) => x.id === t.id), "bob does not see alice's drafts");
  const asAlice = await getThreads({}, serve('alice'));
  assert.ok(asAlice.some((x) => x.id === t.id));
});

test('upsert-author and drafting calls with an authorKey write authors.json', async () => {
  const authors = () => readJson(path.join(docsRoot, '.threads', 'authors.json'));
  await call('threads:upsert-author', { authorKey: 'zed', name: 'Zed', avatarUrl: 'http://z/a.png' });
  assert.deepEqual(authors(), { zed: { name: 'Zed', avatarUrl: 'http://z/a.png' } });
  await call('threads:add-thread', as({ ...ALICE, avatarUrl: 'http://a/a.png' }, { body: 'b' }));
  await call('threads:add-comment', as({ ...BOB }, { threadId: 't-thread1', body: 'b' }));
  assert.deepEqual(authors(), {
    zed: { name: 'Zed', avatarUrl: 'http://z/a.png' },
    alice: { name: 'Alice', avatarUrl: 'http://a/a.png' },
    bob: { name: 'Bob', avatarUrl: '' },
  });
  assert.deepEqual((await call('threads:get-authors', {})).result, authors());
});

test('input validation rejects missing fields', async () => {
  const rejects = (name: string, payload: Record<string, unknown>, msg: string) =>
    assert.rejects(call(name, payload), (e: Error) => e.message.includes(msg));

  await rejects('threads:get-threads', {}, 'threads/invalid: threads:get-threads: file is required');
  await rejects('threads:add-thread', { file: '', author: 'alice', body: 'hi' }, 'file is required');
  await rejects('threads:add-thread', { file: project.file, author: '', body: 'hi' }, 'author is required');
  await rejects('threads:add-thread', { file: project.file, author: 'alice', body: '   ' }, 'body is required');
  await rejects('threads:edit-comment', { file: project.file, threadId: 't-thread1', commentId: 'c1-1', body: 'x' },
    'threads/invalid: caller identity is required');
  assert.equal(fs.existsSync(path.join(docsRoot, '.threads')), false);
});

test('lookup and validation failures carry the threads/<code> prefix', async () => {
  const rejects = (name: string, payload: Record<string, unknown>, msg: string) =>
    assert.rejects(call(name, as(ALICE, payload)), (e: Error) => e.message === msg);
  await rejects('threads:edit-comment', { threadId: 't-nope', commentId: 'c-1', body: 'x' },
    'threads/not-found: Thread not found: t-nope');
  await rejects('threads:edit-comment', { threadId: 't-thread1', commentId: 'c-nope', body: 'x' },
    'threads/not-found: Comment not found: c-nope');
  await rejects('threads:delete-thread', { threadId: 't-nope' }, 'threads/not-found: Thread not found: t-nope');
  assert.equal(fs.existsSync(journalPath('alice')), false, 'a failed mutation writes no journal');
});

test('plugin surface: descriptor, hooks and action names', () => {
  assert.equal(plugin.plugin.name, 'threads');
  assert.ok(plugin.plugin.capabilities?.includes('actions'));
  assert.equal(plugin.plugin.requiresLiveServer, true);
  assert.equal(typeof plugin.markdownSetup, 'function');
  assert.equal(typeof plugin.generateScripts, 'function');
  assert.equal(typeof plugin.getAssets, 'function');
  assert.equal(typeof plugin.actions, 'object');
  assert.deepEqual(Object.keys(plugin.actions).sort(), [
    'threads:add-comment', 'threads:add-thread', 'threads:delete-comment', 'threads:delete-thread',
    'threads:edit-comment', 'threads:get-authors', 'threads:get-threads', 'threads:resolve-thread',
    'threads:toggle-reaction', 'threads:upsert-author',
  ]);
  const assets = plugin.getAssets();
  const scripts = plugin.generateScripts({ src: path.join(project.root, 'docs') }, { sidebar: true });
  assert.ok(scripts.bodyScriptsHtml.includes('window.__threads_config={"sidebar":true};'));
  for (const opts of [{}, undefined]) {
    const out = plugin.generateScripts({ src: path.join(project.root, 'docs') }, opts);
    assert.ok(out.bodyScriptsHtml.includes('window.__threads_config={"sidebar":false};'));
  }
  // An invalid value surfaces as a config error, once; later pages fall back to defaults.
  const bad = { sidebar: 'yes' };
  assert.throws(
    () => plugin.generateScripts({ src: path.join(project.root, 'docs') }, bad),
    (e: unknown) => e instanceof ThreadsError && e.code === 'config',
  );
  assert.ok(plugin.generateScripts({ src: path.join(project.root, 'docs') }, bad)
    .bodyScriptsHtml.includes('window.__threads_config={"sidebar":false};'));
  // markdownSetup wires containers and the highlight rule together.
  const md = MarkdownIt();
  plugin.markdownSetup(md);
  const html = md.render('==x=={t-1}\n\n::: threads\n  ::: thread t-1\n    ::: comment c-1 "a" "2026-01-01"\n      hi\n    :::\n  :::\n:::\n');
  assert.ok(html.includes('threads-thread'));
  assert.ok(html.includes('<mark'));
  assert.deepEqual(assets.map((a: { dest: string }) => a.dest), ['assets/js/threads.js', 'assets/css/threads.css']);
});
