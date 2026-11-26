import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, failingReset, failingWrites, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { createDraftStore, makeOp, slug, type DraftStore } from '../src/plugin/drafts.ts';
import { applyOps, defaultTitle, deriveTargets, finishEarlierPublish, pageTitleOf, publish } from '../src/plugin/reviews.ts';
import { createLock, createNoGitSync } from '../src/plugin/lock.ts';
import { ThreadsError } from '../src/plugin/errors.ts';
import * as parser from '../src/plugin/parser.ts';
import type { Comment, DraftOp, Journal, NewDraftOp, PublishResult, Thread } from '../src/types.ts';

const AT = '2026-03-10T12:00:00.000Z';
const OPTS = { authorKey: 'k-alice', authorName: 'Alice', reviewId: 'r-00000001' };
const mk = (op: NewDraftOp): DraftOp => makeOp(op, AT);
const FILE = 'docs/index.md';
const OTHER = 'docs/other.md';
const anchor = (q: string) => ({ quote: q, prefix: null, suffix: null, selector: null, offset: null, blockText: null });

// ---------------------------------------------------------------------------
// applyOps and titles: small, pure
// ---------------------------------------------------------------------------

const THREADS = `::: threads
  ::: thread t-1
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
:::
`;
const PAGE = `---
title: Sample
---

Some ==marked text=={t-1} here and plain target text.

${THREADS}`;

type Applied = DraftOp & { quote?: string; before?: Record<string, unknown> };
const by = (applied: Array<{ kind: string }>, kind: string) => applied.find((o) => o.kind === kind) as Applied;
const idOf = (v: unknown) => (v as { id: string }).id;

test('applyOps writes each op kind with its tokens, mark and anchor, and records what a reversal needs', () => {
  const ops = [
    mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor('plain target text'), body: 'New thread' }),
    mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-reply', parentId: 'c-3', body: 'Reply' }),
    mk({ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-2', body: 'Second, edited.' }),
    mk({ kind: 'delete-comment', file: FILE, threadId: 't-1', commentId: 'c-1' }),
    mk({ kind: 'resolve-thread', file: FILE, threadId: 't-2' }),
    mk({ kind: 'toggle-reaction', file: FILE, threadId: 't-1', commentId: 'c-2', emoji: '🎉' }),
  ];
  const { content, applied, skipped } = applyOps(PAGE, ops, OPTS);
  assert.deepEqual(skipped, []);
  assert.equal(applied.length, 6);

  assert.match(content, /Some ==marked text=={t-1} here and ==plain target text=={t-new}\./);
  assert.match(content, /::: comment c-new "Alice" "2026-03-10" by k-alice review r-00000001/);
  assert.match(content, /::: comment c-reply "Alice" "2026-03-10" reply-to c-3 by k-alice review r-00000001/);
  const threads = parser.parseThreadsFromContent(content);
  const added = threads.find((t) => t.id === 't-new')!;
  assert.deepEqual(added.anchor, { quote: 'plain target text' });
  assert.deepEqual([added.comments[0].authorKey, added.comments[0].reviewId, added.comments[0].body], ['k-alice', 'r-00000001', 'New thread']);
  const t1 = threads.find((t) => t.id === 't-1')!;
  assert.deepEqual(t1.comments.map((c) => [c.id, c.body, c.edited_at]), [['c-2', 'Second, edited.', '2026-03-10']]);
  assert.deepEqual(t1.comments[0].reactions, [{ emoji: '🎉', authors: ['Alice'] }]);
  assert.deepEqual(threads.find((t) => t.id === 't-2')!.resolved_by, 'Alice');

  assert.equal(by(applied, 'add-thread').quote, 'plain target text');
  assert.ok(applied.every((o) => o.pageTitle === 'Sample'));
  assert.deepEqual(by(applied, 'edit-comment').before, { body: 'Second.', edited_at: null });
  assert.equal(idOf(by(applied, 'delete-comment').before?.comment), 'c-1');
  assert.equal(by(applied, 'delete-comment').before?.index, 0);
  assert.deepEqual(by(applied, 'resolve-thread').before, { resolved: false, resolved_by: null, resolved_at: null });
  assert.deepEqual(by(applied, 'toggle-reaction').before, { present: false });
  const gone = applyOps(PAGE, [mk({ kind: 'delete-thread', file: FILE, threadId: 't-1' })], OPTS).applied[0] as Applied;
  assert.equal(idOf(gone.before?.thread), 't-1');
});

test('applyOps skips ops whose target is gone, with a reason, and applies the rest', () => {
  const missingThread = mk({ kind: 'add-comment', file: FILE, threadId: 't-gone', commentId: 'c-x', parentId: null, body: 'x' });
  const missingComment = mk({ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-gone', body: 'x' });
  const good = mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-ok', parentId: null, body: 'kept' });
  const { content, applied, skipped } = applyOps(PAGE, [missingThread, missingComment, good], OPTS);
  assert.deepEqual(skipped.map((s) => s.opId), [missingThread.opId, missingComment.opId]);
  assert.match(skipped[0].reason, /t-gone/);
  assert.match(skipped[1].reason, /c-gone/);
  assert.deepEqual(applied.map((o) => o.opId), [good.opId]);
  assert.match(content, /c-ok/);
  assert.equal(applyOps(PAGE, [missingThread], OPTS).content, PAGE, 'nothing applied leaves the page byte-identical');
});

test('applyOps with enforce skips an opener delete that has others\' replies and a stale delete-thread; without it nothing is skipped', () => {
  const page = PAGE; // t-1: c-1 (Bob), c-2 (Bob); t-2: c-3 (Bob)
  const openerDelete = mk({ kind: 'delete-comment', file: FILE, threadId: 't-1', commentId: 'c-1' });
  const stale = mk({ kind: 'delete-thread', file: FILE, threadId: 't-1', commentIds: ['c-1'] });
  const fresh = mk({ kind: 'delete-thread', file: FILE, threadId: 't-1', commentIds: ['c-1', 'c-2'] });
  const unchecked = mk({ kind: 'delete-thread', file: FILE, threadId: 't-2' });
  const enforced = { ...OPTS, enforce: true };

  const a = applyOps(page, [openerDelete], enforced);
  assert.deepEqual(a.skipped, [{ opId: openerDelete.opId, reason: 'opening comment has replies; delete the thread' }]);
  assert.equal(a.content, page);
  const b = applyOps(page, [stale], enforced);
  assert.deepEqual(b.skipped, [{ opId: stale.opId, reason: 'thread has new comments' }]);
  assert.equal(b.content, page);
  assert.deepEqual(applyOps(page, [fresh], enforced).skipped, [], 'the caller saw every comment');
  assert.deepEqual(applyOps(page, [unchecked], enforced).skipped, [], 'a delete-thread without commentIds applies unchecked');
  for (const op of [openerDelete, stale]) {
    assert.deepEqual(applyOps(page, [op], OPTS).skipped, [], 'a dev publish never skips for these reasons');
  }

  // Replies from the same review do not block the opener delete; replies of other reviews do.
  const own = mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-own', parentId: null, body: 'mine' });
  const ownOpener = mk({ kind: 'delete-comment', file: FILE, threadId: 't-2', commentId: 'c-3' });
  const same = applyOps(page, [own, ownOpener], enforced);
  assert.deepEqual(same.skipped, []);
  assert.equal(parser.parseThreadsFromContent(same.content).find((t) => t.id === 't-2')!.comments.map((c) => c.id).join(), 'c-own');
});

test('applyOps places marks: not in the frontmatter, an existing mark or the threads block; next free occurrence; fences skipped', () => {
  const wrap = (page: string, quote: string) =>
    applyOps(page, [mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor(quote), body: 'x' })], OPTS);
  const markOf = (page: string) => /==[^=]*=={t-new}/.exec(page)?.[0];

  // "Sample" is in the frontmatter title and in the body: the body one is used
  const fm = wrap(PAGE.replace('plain target text', 'Sample text'), 'Sample');
  assert.equal(fm.content.split('\n')[1], 'title: Sample');
  assert.equal(markOf(fm.content), '==Sample=={t-new}');

  // the only occurrence is inside an existing mark: no new mark, the anchor is still written
  const inside = wrap(PAGE, 'marked text');
  assert.doesNotMatch(inside.content, /\{t-new\}\n|=\{t-new\}/);
  assert.match(inside.content, /==marked text=={t-1}/);
  assert.equal(parser.parseThreadsFromContent(inside.content).find((t) => t.id === 't-new')!.anchor!.quote, 'marked text');

  // an occurrence that overlaps an existing mark is passed over for the next free one
  const next = wrap(PAGE.replace('plain target text', 'plain target text, marked text again'), 'marked text');
  assert.match(next.content, /==marked text=={t-1} here/);
  assert.match(next.content, /==marked text=={t-new} again/);

  // text that only appears inside the threads block gets no mark
  const block = wrap(PAGE, 'Other.');
  assert.equal(markOf(block.content), undefined);
  assert.equal(parser.parseThreadsFromContent(block.content).length, 3);

  // text after the threads block is page text too: it gets the mark, and no block is added
  const after = wrap(`${PAGE}\nClosing words here.\n`, 'Closing words');
  assert.equal(markOf(after.content), '==Closing words=={t-new}');
  assert.equal(after.content.split('::: threads').length - 1, 1);
  assert.ok(after.content.endsWith('==Closing words=={t-new} here.\n'));

  // a quote the highlight syntax cannot carry gets its anchor but no mark, and deleting the thread leaves the text alone
  for (const q of ['a == b', '=x', 'x=']) {
    const page = PAGE.replace('plain target text', `${q} here`);
    const r = wrap(page, q);
    assert.equal(r.content.split('::: threads')[0], page.split('::: threads')[0], q);
    assert.equal(parser.parseThreadsFromContent(r.content).find((t) => t.id === 't-new')!.anchor!.quote, q);
    const gone = applyOps(r.content, [mk({ kind: 'delete-thread', file: FILE, threadId: 't-new' })], OPTS).content;
    assert.equal(gone.split('::: threads')[0], page.split('::: threads')[0], q);
  }

  // only an exact `::: threads` line starts the block; code is never marked
  const lookalike = wrap(`Body.\n\n::: threads-x\nzzz target\n\n${THREADS}`, 'target');
  assert.match(lookalike.content, /zzz ==target=={t-new}/);
  const code = wrap(`Fence:\n\n\`\`\`\nuse target here\n\`\`\`\n\nInline \`target\` and real target.\n\n${THREADS}`, 'target');
  assert.match(code.content, /use target here/);
  assert.match(code.content, /`target` and real ==target=={t-new}\./);

  // a quote line that is a container fence would break the block on re-parse
  for (const bad of ['a\n:::\nb', 'a\n::: threads\nb', 'x\n  ::: comment c "A" "d"']) {
    const r = wrap(PAGE, bad);
    assert.equal(r.content, PAGE);
    assert.deepEqual([r.applied.length, r.skipped.length], [0, 1]);
    assert.match(r.skipped[0].reason, /fence/);
  }
});

test('applyOps leaves a fenced `::: threads` example alone and writes to the real block', () => {
  const example = '```markdown\n::: threads\n  ::: thread t-example\n    ::: comment c-x "Doc" "2026-01-01"\n      Example\n    :::\n  :::\n:::\n```\n';
  const page = PAGE.replace('Some ==marked', `${example}\nSome ==marked`);
  const { content, skipped } = applyOps(page, [
    mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-reply', parentId: 'c-3', body: 'Reply' }),
    mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor('plain target text'), body: 'New' }),
  ], OPTS);
  assert.deepEqual(skipped, []);
  assert.ok(content.includes(example), 'the example is byte-identical');
  assert.equal(content.split('::: threads').length - 1, 2, 'no block is added');
  assert.deepEqual(parser.parseThreadsFromContent(content).map((t) => t.id), ['t-1', 't-2', 't-new']);
});

test('applyOps marks a quote below the first block, but never inside any block or a fenced example', () => {
  const second = THREADS.replace('t-1', 't-3').replace('t-2', 't-4').replace(/c-(\d)/g, 'c-9$1');
  const page = `${PAGE}\nBetween the blocks sits the target.\n\n${second}\nFooter.\n`;
  const wrap = (p: string, quote: string) =>
    applyOps(p, [mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor(quote), body: 'x' })], OPTS).content;
  const markOf = (p: string) => /==[^=]*=={t-new}/.exec(p)?.[0];

  const between = wrap(page, 'the target');
  assert.match(between, /Between the blocks sits ==the target=={t-new}\./);
  assert.equal(between.split('::: threads').length - 1, 2);
  assert.deepEqual(parser.parseThreadsFromContent(between).map((t) => t.id), ['t-1', 't-2', 't-3', 't-4', 't-new']);

  // "Other." is only in comment bodies of both blocks
  assert.equal(markOf(wrap(page, 'Other.')), undefined);

  // a fenced `::: threads` example is code: not marked, and text after it is still page text
  const example = '```markdown\n::: threads\nfenced target\n:::\n```\n';
  const fenced = wrap(`Intro.\n\n${example}\nLater target.\n\n${THREADS}`, 'target');
  assert.ok(fenced.includes(example));
  assert.match(fenced, /Later ==target=={t-new}\./);
});

test('applyOps on a thread id held by two blocks writes to the first copy, the one get-threads shows', () => {
  const copy = THREADS.replace('t-2', 't-9').replace(/c-(\d)/g, 'c-8$1');
  const page = `${PAGE}\nBetween.\n\n${copy}`;
  const { content } = applyOps(page, [mk({ kind: 'add-comment', file: FILE, threadId: 't-1', commentId: 'c-reply', parentId: 'c-2', body: 'Reply' })], OPTS);
  const t1 = parser.parseThreadsFromContent(content).filter((t) => t.id === 't-1');
  assert.equal(t1.length, 1);
  assert.deepEqual(t1[0].comments.map((c) => c.id), ['c-1', 'c-2', 'c-reply']);
  const later = parser.findThreadsBlocks(content.split('\n'))[1].threads;
  assert.deepEqual(later.map((t) => [t.id, t.comments.map((c) => c.id)]), [['t-1', ['c-81', 'c-82']], ['t-9', ['c-83']]], 'the later copy is unchanged');
});

test('applyOps removes what delete-thread owns: single- and two-line marks, and an emptied block', () => {
  const page = `Target line one\nline two here and ==one liner=={t-b} too.\n\n${THREADS.replace('t-1', 't-a').replace('t-2', 't-b')}`
    .replace('Target line one\nline two', 'Target ==line one\nline two=={t-a}');
  const del = (p: string, id: string) => applyOps(p, [mk({ kind: 'delete-thread', file: FILE, threadId: id })], OPTS).content;

  const noA = del(page, 't-a');
  assert.match(noA, /^Target line one\nline two here and ==one liner=={t-b} too\./, 'two-line mark unwrapped, plain text kept');
  const noB = del(page, 't-b');
  assert.match(noB, /and one liner too\./);
  assert.match(noB, /==line one\nline two=={t-a}/, 'the other thread keeps its mark');

  const none = del(del(page, 't-a'), 't-b');
  assert.doesNotMatch(none, /::: threads|=\{t-/);
  assert.match(none, /Target line one\nline two here and one liner too\./);
});

test('applying twice gives the same page for add, edit and delete ops; a foreign existing id is skipped', () => {
  const ops = [
    mk({ kind: 'add-thread', file: FILE, threadId: 't-new', commentId: 'c-new', anchor: anchor('plain target text'), body: 'New' }),
    mk({ kind: 'add-comment', file: FILE, threadId: 't-2', commentId: 'c-reply', parentId: null, body: 'Reply' }),
    mk({ kind: 'edit-comment', file: FILE, threadId: 't-1', commentId: 'c-2', body: 'Edited' }),
    mk({ kind: 'delete-comment', file: FILE, threadId: 't-1', commentId: 'c-1' }),
  ];
  const once = applyOps(PAGE, ops, OPTS);
  const twice = applyOps(once.content, ops, OPTS);
  assert.equal(twice.content, once.content);
  assert.deepEqual(twice.applied.map((o) => o.kind), ['add-thread', 'add-comment', 'edit-comment'], 'adds and edits count as applied again');
  assert.deepEqual(twice.skipped.map((s) => s.opId), [ops[3].opId], 'the deleted comment is gone the second time');

  const del = mk({ kind: 'delete-thread', file: FILE, threadId: 't-2' });
  const afterDel = applyOps(PAGE, [del], OPTS).content;
  assert.equal(applyOps(afterDel, [del], OPTS).content, afterDel);

  // ids that exist from another review are not overwritten
  const foreign = applyOps(once.content, ops.slice(0, 2), { ...OPTS, reviewId: 'r-00000002' });
  assert.equal(foreign.content, once.content);
  assert.equal(foreign.skipped.length, 2);
  assert.match(foreign.skipped[0].reason, /already exists/);
});

test('toggle ops set the state deriveTargets computed from the first read, so a re-run changes nothing', () => {
  const ops = [
    mk({ kind: 'resolve-thread', file: FILE, threadId: 't-1' }),
    mk({ kind: 'toggle-reaction', file: FILE, threadId: 't-1', commentId: 'c-1', emoji: '👍' }),
    mk({ kind: 'toggle-reaction', file: FILE, threadId: 't-1', commentId: 'c-1', emoji: '👍' }),
    mk({ kind: 'toggle-reaction', file: FILE, threadId: 't-1', commentId: 'c-2', emoji: '🎉' }),
  ];
  const targets = deriveTargets(PAGE, ops, OPTS.authorName);
  assert.deepEqual(targets, {
    [ops[0].opId]: true, // t-1 is open in PAGE, so resolving it targets resolved
    [ops[1].opId]: true,
    [ops[2].opId]: false,
    [ops[3].opId]: true,
  });
  const once = applyOps(PAGE, ops, { ...OPTS, targets });
  assert.notEqual(once.content, PAGE);
  assert.equal(applyOps(once.content, ops, { ...OPTS, targets }).content, once.content, 'same targets over the output change nothing');
  assert.equal(applyOps(PAGE, ops, { ...OPTS, targets }).content, once.content, 'a retry on the original page ends the same');
  assert.notEqual(applyOps(once.content, ops, OPTS).content, once.content, 'without targets a re-run flips the toggles back');
});

test('pageTitleOf prefers frontmatter, then the first heading, else null', () => {
  const cases: Array<[string, string | null]> = [
    ['---\ntitle: "Quoted"\n---\n# Heading', 'Quoted'],
    ['---\ndescription: x\n---\n\n# Heading ##\ntext', 'Heading'],
    ['intro\n# First\n# Second', 'First'],
    ['no title here\n## sub only', null],
    ['---\ntitle: Plain\n---', 'Plain'],
  ];
  for (const [content, want] of cases) assert.equal(pageTitleOf(content), want, content);
});

test('defaultTitle: plural, +K pages, cap, newline stripping, path when untitled', () => {
  const op = (kind: DraftOp['kind'], file: string) => ({ kind, file });
  const titles = { 'a.md': 'Page A', 'b.md': 'Page B', 'c.md': null };
  const cases: Array<[string, ReturnType<typeof op>[], string]> = [
    ['Ann', [op('add-thread', 'a.md')], 'Comments by Ann: 1 comment on Page A'],
    ['Ann', [op('add-thread', 'a.md'), op('add-comment', 'a.md'), op('resolve-thread', 'a.md')], 'Comments by Ann: 2 comments on Page A'],
    ['Ann', [op('add-comment', 'a.md'), op('add-comment', 'b.md')], 'Comments by Ann: 2 comments on Page A, +1 page'],
    ['Ann', [op('add-comment', 'b.md'), op('add-comment', 'a.md'), op('add-comment', 'c.md')], 'Comments by Ann: 3 comments on Page B, +2 pages'],
    ['Ann', [op('resolve-thread', 'c.md')], 'Comments by Ann: 1 comment on c.md'],
    ['Line\nBreak', [op('add-comment', 'a.md')], 'Comments by Line Break: 1 comment on Page A'],
  ];
  for (const [name, ops, want] of cases) assert.equal(defaultTitle(name, ops, titles), want);
  assert.equal(defaultTitle('N'.repeat(300), [op('add-comment', 'a.md')], titles).length, 120);
});

// ---------------------------------------------------------------------------
// publish: medium, one temp project per file
// ---------------------------------------------------------------------------

let project: TempProject;
let docsRoot: string;
before(() => {
  project = tempProject();
  docsRoot = path.join(project.root, 'docs');
});
after(() => project.cleanup());
beforeEach(() => {
  project.reset();
  fs.writeFileSync(safePath(project.root, OTHER), '# Other Page\n\nTarget sentence here.\n');
  fs.rmSync(path.join(docsRoot, '.threads'), { recursive: true, force: true });
});

const store = () => createDraftStore(docsRoot);
const read = (rel: string) => fs.readFileSync(safePath(project.root, rel), 'utf8');
const readAt = (p: string) => fs.readFileSync(safePath(path.dirname(p), path.basename(p)), 'utf8');
const reviewsDir = () => path.join(docsRoot, '.threads', 'reviews');
const manifestPath = (id: string) => path.join(reviewsDir(), `${id}.json`);
const manifests = () => (fs.existsSync(reviewsDir()) ? fs.readdirSync(safePath(reviewsDir(), '.')) : []);
const journalFile = (key: string) => path.join(docsRoot, '.threads', 'drafts', `${slug(key)}.json`);
const ctx = (extra: Partial<TestCtx> = {}) => makeCtx(project.root, { config: { src: 'docs' }, ...extra });
const ALICE = { key: 'k-alice', name: 'Alice' };
const who = { author: 'Alice', authorKey: 'k-alice' };
const fill = (key: string, ops: NewDraftOp[], s: DraftStore = store()) =>
  s.transact(key, (j, at) => void j.ops.push(...ops.map((o) => makeOp(o, at))));
const publishAction = (payload: Record<string, unknown> = who, extra: Partial<TestCtx> = {}) =>
  (actions['threads:publish-review'] as (p: unknown, c: TestCtx) => Promise<PublishResult>)(payload, ctx(extra));
const getThreads = (file = FILE, payload: Record<string, unknown> = who, extra: Partial<TestCtx> = {}) =>
  (actions['threads:get-threads'] as (p: unknown, c: TestCtx) => Promise<Thread[]>)({ file, ...payload }, ctx(extra));
const call = (name: string, payload: Record<string, unknown>) =>
  (actions[name] as (p: unknown, c: TestCtx) => Promise<unknown>)(payload, ctx());
const pageThreads = (rel: string) => parser.parseThreadsFromContent(read(rel));
const deps = (s: DraftStore = store()) => ({ store: s, sync: createNoGitSync(createLock()), now: () => Date.parse('2030-01-02T03:04:05.000Z'), newId: () => 'r-aaaaaaaa' });

/** The projection published and drafted views must agree on. */
const shape = (threads: Thread[]) =>
  threads.map((t) => ({
    id: t.id, resolved: t.resolved, resolved_by: t.resolved_by,
    comments: t.comments.map((c: Comment) => ({ id: c.id, author: c.author, body: c.body, edited_at: c.edited_at, reactions: c.reactions })),
  }));

test('a retried apply reuses the first read\'s toggle targets', async () => {
  await call('threads:resolve-thread', { file: FILE, threadId: 't-thread2', ...who });
  await call('threads:toggle-reaction', { file: FILE, threadId: 't-thread2', commentId: 'c2-1', emoji: '🎉', ...who });
  const j = await store().load('k-alice');
  assert.equal(j.ops.length, 2);
  const once = pageThreads(FILE).find((t) => t.id === 't-thread2')!;
  // A sync that runs apply twice without restoring the files: a replay must not flip the toggles back.
  let runs = 0;
  const twice = {
    withLock: <T,>(fn: () => Promise<T>) => fn(),
    publishWithRetry: async (apply: () => Promise<{ title: string }>) => {
      await apply();
      runs++;
      await apply();
      runs++;
    },
  };
  await publish(ALICE, ctx() as never, { ...deps(), sync: twice });
  assert.equal(runs, 2);
  const after = pageThreads(FILE).find((t) => t.id === 't-thread2')!;
  assert.equal(after.resolved, !once.resolved, 'resolved by the first attempt, still resolved after the second');
  const reactions = after.comments.find((c) => c.id === 'c2-1')!.reactions ?? [];
  assert.equal(reactions.some((r) => r.emoji === '🎉' && r.authors.includes('Alice')), true);
});

test('publish-review writes two pages and a manifest; the journal is emptied; get-threads is unchanged by it', async () => {
  const added = (await call('threads:add-thread', { file: FILE, ...who, body: 'New on index', anchor: anchor('parser rules') })) as Thread;
  const reply = (await call('threads:add-comment', { file: FILE, threadId: 't-thread2', parentId: 'c2-1', body: 'Reply', ...who })) as Comment;
  await call('threads:add-thread', { file: OTHER, ...who, body: 'New on other' });
  await call('threads:edit-comment', { file: FILE, threadId: 't-thread1', commentId: 'c1-2', body: 'Bob, edited', ...who });
  await call('threads:resolve-thread', { file: FILE, threadId: 't-thread2', ...who });
  await call('threads:toggle-reaction', { file: FILE, threadId: 't-thread2', commentId: 'c2-1', emoji: '🎉', ...who });
  await call('threads:delete-comment', { file: FILE, threadId: 't-thread3', commentId: 'c3-2', ...who });
  const drafted = { [FILE]: shape(await getThreads(FILE)), [OTHER]: shape(await getThreads(OTHER)) };
  const reviewBefore = (await store().load('k-alice')).review.id;
  const draftIds = (threads: Thread[]) => threads.flatMap((t) => t.comments).filter((c) => c.draft).map((c) => c.id).sort();
  const beforeView = await getThreads(FILE);
  assert.deepEqual(draftIds(beforeView), [added.comments[0].id, reply.id].sort(), 'only the drafted comments are flagged');
  assert.deepEqual(beforeView.filter((t) => t.draft).map((t) => t.id), [added.id], 'only the drafted thread is flagged');
  await call('threads:set-mode', { ...who, mode: 'collect' });

  const result = await publishAction();
  assert.match(result.reviewId, /^r-[0-9a-f]{8}$/);
  assert.equal(result.reviewId, reviewBefore);
  assert.deepEqual(result.skipped, []);

  for (const rel of [FILE, OTHER]) {
    const mine = pageThreads(rel).flatMap((t) => t.comments).filter((c) => c.reviewId);
    assert.ok(mine.length > 0, rel);
    assert.ok(mine.every((c) => c.authorKey === 'k-alice' && c.reviewId === result.reviewId && c.author === 'Alice'), rel);
  }
  assert.match(read(FILE), new RegExp(`==parser rules==\\{${added.id}\\}`));
  assert.equal(pageThreads(FILE).find((t) => t.id === added.id)!.anchor!.quote, 'parser rules');
  assert.ok(pageThreads(FILE).some((t) => t.id === added.id && t.comments[0].id === added.comments[0].id), 'drafted ids are kept');

  const m = JSON.parse(readAt(manifestPath(result.reviewId)));
  assert.deepEqual(Object.keys(m).sort(), ['authorKey', 'authorName', 'id', 'ops', 'publishedAt', 'skipped', 'state', 'summary', 'title', 'version']);
  assert.deepEqual([m.version, m.id, m.state, m.authorKey, m.authorName], [1, result.reviewId, 'published', 'k-alice', 'Alice']);
  assert.match(m.title, /^Comments by Alice: 3 comments on docmd _playground, \+1 page$/);
  assert.ok(!Number.isNaN(Date.parse(m.publishedAt)));
  assert.deepEqual(m.skipped, []);
  for (const o of m.ops) {
    if (['edit-comment', 'delete-comment', 'delete-thread', 'resolve-thread', 'toggle-reaction'].includes(o.kind)) assert.ok(o.before, o.kind);
    if (o.file === FILE) assert.equal(o.pageTitle, 'docmd _playground');
  }
  assert.equal(m.ops.find((o: { kind: string; quote?: string }) => o.kind === 'add-thread' && o.quote)?.quote, 'parser rules');
  assert.deepEqual(m.ops.find((o: { pageTitle?: string; file: string }) => o.file === OTHER).pageTitle, 'Other Page');

  const journal = await store().load('k-alice');
  assert.deepEqual(journal.ops, []);
  assert.notEqual(journal.review.id, result.reviewId);
  assert.equal(journal.mode, 'collect', 'publish keeps the mode, not the default (auto)');
  assert.ok(!Number.isNaN(Date.parse(journal.review.updatedAt)));
  const after = { [FILE]: await getThreads(FILE), [OTHER]: await getThreads(OTHER) };
  assert.deepEqual(draftIds(after[FILE]), [], 'published comments are no longer drafts');
  assert.deepEqual({ [FILE]: shape(after[FILE]), [OTHER]: shape(after[OTHER]) }, drafted);
  const ids = after[FILE].flatMap((t) => t.comments.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length, 'each comment once');
  assert.ok(after[FILE].flatMap((t) => t.comments).filter((c) => c.reviewId).every((c) => c.authorKey === 'k-alice'));
});

test('publish uses the injected clock and ids', async () => {
  await fill('k-alice', [{ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-b', parentId: null, body: 'Hi' }]);
  const { reviewId } = await publish(ALICE, ctx() as never, deps());
  const m = JSON.parse(readAt(manifestPath(reviewId)));
  assert.equal(m.publishedAt, '2030-01-02T03:04:05.000Z');
  assert.equal(m.title, 'Comments by Alice: 1 comment on docmd _playground');
  assert.equal((await store().load('k-alice')).review.id, 'r-aaaaaaaa');
});

test('publish edits a thread in the second top-level block in place and leaves the first block byte-identical', async () => {
  const page = `# Split page

::: threads
  ::: thread t-first
    ::: comment c-first "Alice" "2026-01-01"
      First
    :::
  :::
:::

Discussion for the next section.

::: threads
  ::: thread t-second
    ::: comment c-second "Bob" "2026-01-02"
      Second
    :::
  :::
:::

After both.
`;
  fs.writeFileSync(safePath(project.root, FILE), page);
  const secondStart = page.indexOf('::: threads', page.indexOf('Discussion for the next section.'));
  await fill('k-alice', [
    { kind: 'add-comment', file: FILE, threadId: 't-second', commentId: 'c-reply', parentId: 'c-second', body: 'Reply in second' },
  ]);
  const result = await publishAction();
  assert.deepEqual(result.skipped, []);
  const out = read(FILE);
  const firstBlock = page.slice(0, page.indexOf('Discussion for the next section.'));
  const secondBlock = page.slice(secondStart);
  assert.ok(out.startsWith(firstBlock), 'the first block is untouched');
  assert.ok(out.includes(secondBlock.slice(0, secondBlock.indexOf('c-second') + 'c-second'.length)), 'the second block is not moved');
  assert.match(out, /::: comment c-reply "Alice" "[0-9-]+" reply-to c-second/);
  assert.deepEqual(pageThreads(FILE).map((t) => t.id), ['t-first', 't-second']);
  assert.equal(pageThreads(FILE).find((t) => t.id === 't-second')!.comments[1].id, 'c-reply');
});

test('an empty or missing journal rejects with empty-review and writes nothing', async () => {
  const bytes = read(FILE);
  await assert.rejects(publishAction({ author: 'Nobody', authorKey: 'k-none' }), (e: unknown) => e instanceof ThreadsError && e.message.startsWith('threads/empty-review'));
  await fill('k-alice', [{ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-x', parentId: null, body: 'x' }]);
  await call('threads:delete-comment', { file: FILE, threadId: 't-thread1', commentId: 'c-x', ...who });
  assert.deepEqual((await store().load('k-alice')).ops, []);
  await assert.rejects(publishAction(), /threads\/empty-review/);
  assert.equal(read(FILE), bytes);
  assert.equal(fs.existsSync(reviewsDir()), false);
});

test('ops on an unreadable file or a missing target are skipped and listed; the rest is written', async () => {
  await fill('k-alice', [
    { kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-ok', parentId: null, body: 'kept' },
    { kind: 'edit-comment', file: FILE, threadId: 't-thread2', commentId: 'c-gone', body: 'dangling' },
    { kind: 'add-comment', file: 'docs/missing.md', threadId: 't-x', commentId: 'c-x', parentId: null, body: 'nowhere' },
  ]);
  await fill('k-alice', [{ kind: 'edit-comment', file: OTHER, threadId: 't-none', commentId: 'c-none', body: 'dangling' }]);
  const written: string[] = [];
  const result = await publishAction(who, {
    async writeFile(rel: string, content: string) {
      written.push(rel);
      fs.writeFileSync(safePath(project.root, rel), content);
    },
  });
  assert.deepEqual(written, [FILE], 'a page none of whose ops applied is not rewritten');
  assert.equal(result.skipped.length, 3);
  assert.match(result.skipped[0].reason, /c-gone/);
  assert.match(result.skipped[1].reason, /not readable/);
  assert.match(read(FILE), /c-ok/);
  const m = JSON.parse(readAt(manifestPath(result.reviewId)));
  assert.deepEqual(m.skipped, result.skipped);
  assert.deepEqual(m.ops.map((o: { commentId: string }) => o.commentId), ['c-ok']);
  assert.equal(m.title, 'Comments by Alice: 1 comment on docmd _playground', 'skipped ops are not counted');
});

const twoPages = (): NewDraftOp[] => [
  { kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-1', parentId: null, body: 'one' },
  { kind: 'add-thread', file: OTHER, threadId: 't-oth', commentId: 'c-oth', anchor: anchor('Target sentence'), body: 'two' },
];

test('a write failing on the second page restores the first, writes no manifest and keeps the journal; the retry equals a clean run', async () => {
  await fill('k-alice', twoPages());
  const bytes = { [FILE]: read(FILE), [OTHER]: read(OTHER) };
  const journalBytes = fs.readFileSync(safePath(path.dirname(journalFile('k-alice')), path.basename(journalFile('k-alice'))));
  await assert.rejects(publish(ALICE, ctx(failingWrites(project.root, 2, true)) as never, deps()), /disk full/);
  assert.equal(read(FILE), bytes[FILE]);
  assert.equal(read(OTHER), bytes[OTHER]);
  assert.deepEqual(manifests(), []);
  assert.deepEqual(readAt(journalFile('k-alice')), journalBytes.toString());

  const retry = await publish(ALICE, ctx() as never, deps());
  const retried = { md: [read(FILE), read(OTHER)], manifest: readAt(manifestPath(retry.reviewId)) };

  // a clean run from the same starting point
  project.reset();
  fs.writeFileSync(safePath(project.root, OTHER), bytes[OTHER]);
  fs.rmSync(reviewsDir(), { recursive: true, force: true });
  fs.writeFileSync(safePath(path.dirname(journalFile('k-alice')), path.basename(journalFile('k-alice'))), journalBytes);
  const clean = await publish(ALICE, ctx() as never, deps());
  assert.deepEqual({ md: [read(FILE), read(OTHER)], manifest: readAt(manifestPath(clean.reviewId)) }, retried);
});

test('when the restore fails too, the error names the files and keeps the first failure as cause', async () => {
  await fill('k-alice', twoPages());
  await assert.rejects(publish(ALICE, ctx(failingWrites(project.root, 2)) as never, deps()), (e: unknown) => {
    assert.ok(e instanceof ThreadsError);
    assert.match(e.message, /could not be restored.*docs\/index\.md/);
    assert.match(String((e.cause as Error).message), /disk full/);
    return true;
  });
});

const authorsPath = () => path.join(docsRoot, '.threads', 'authors.json');
const readAuthors = () => JSON.parse(readAt(authorsPath()));
const PROFILE = { name: 'Alice B', avatarUrl: 'http://a/b.png' };
const withProfile = (key: string, profile = PROFILE, s: DraftStore = store()) => s.transact(key, (j) => void (j.profile = profile));
const COMMENT: NewDraftOp = { kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-p', parentId: null, body: 'p' };

test('a failure after the profile write puts authors.json and the pages back and keeps the ops and the profile', async () => {
  fs.mkdirSync(safePath(docsRoot, '.threads'), { recursive: true });
  fs.writeFileSync(safePath(path.dirname(authorsPath()), 'authors.json'), JSON.stringify({ bob: { name: 'Bob', avatarUrl: '' } }));
  await fill('k-alice', [COMMENT]);
  await withProfile('k-alice');
  const bytes = { page: read(FILE), authors: readAt(authorsPath()) };
  // the manifest is written last, after the profile: a stubbed write of it fails exactly there (a stub, not chmod: it holds as root)
  const realWrite = fs.promises.writeFile;
  const stub = mock.method(fs.promises, 'writeFile', ((file: unknown, ...rest: unknown[]) =>
    String(file).includes(`${path.sep}reviews${path.sep}`)
      ? Promise.reject(new Error('manifest write denied'))
      : (realWrite as (...a: unknown[]) => Promise<void>)(file, ...rest)) as typeof fs.promises.writeFile);
  try {
    await assert.rejects(publish(ALICE, ctx() as never, deps()), /manifest write denied/);
    assert.equal(read(FILE), bytes.page);
    assert.equal(readAt(authorsPath()), bytes.authors);
    const kept = await store().load('k-alice');
    assert.deepEqual([kept.ops.length, kept.profile], [1, PROFILE]);

    // with no authors.json before, the undo removes the file it created
    fs.rmSync(authorsPath());
    await assert.rejects(publish(ALICE, ctx() as never, deps()), /manifest write denied/);
    assert.equal(fs.existsSync(authorsPath()), false);
  } finally {
    stub.mock.restore();
  }
});

test('a profile edited again while the publish runs stays in the journal with the newer value', async () => {
  await fill('k-alice', [COMMENT]);
  await withProfile('k-alice');
  const newer = { name: 'Alice C', avatarUrl: '' };
  let edited = false;
  const during: Partial<TestCtx> = {
    async writeFile(rel: string, content: string) {
      fs.writeFileSync(safePath(project.root, rel), content);
      if (!edited) {
        edited = true;
        await withProfile('k-alice', newer);
      }
    },
  };
  await publish(ALICE, ctx(during) as never, deps());
  assert.deepEqual(readAuthors()['k-alice'], PROFILE, 'the value read at the start was written');
  assert.deepEqual((await store().load('k-alice')).profile, newer);
});

test('on the failed-reset path the earlier manifest is only finished: the profile is not written again and stays in the journal', async () => {
  await fill('k-alice', [COMMENT]);
  await withProfile('k-alice');
  const real = store();
  await assert.rejects(publish(ALICE, ctx() as never, deps(failingReset(real))), /journal write failed/);
  assert.deepEqual(readAuthors()['k-alice'], PROFILE);
  const newer = { name: 'Alice D', avatarUrl: '' };
  await withProfile('k-alice', newer, real);
  await publish(ALICE, ctx() as never, deps(real));
  assert.deepEqual(readAuthors()['k-alice'], PROFILE, 'not written by the finishing publish');
  assert.deepEqual((await real.load('k-alice')).profile, newer);
});

test('after a failed journal reset the next publish does not apply again; it returns the manifest skipped list and empties the journal', async () => {
  await fill('k-alice', [
    { kind: 'resolve-thread', file: FILE, threadId: 't-thread2' },
    { kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-1', parentId: null, body: 'one' },
    { kind: 'edit-comment', file: FILE, threadId: 't-thread2', commentId: 'c-gone', body: 'dangling' },
  ]);
  await call('threads:set-mode', { ...who, mode: 'collect' });
  const real = createDraftStore(docsRoot, { defaultMode: 'auto' }); // differs from the 'collect' set above
  await assert.rejects(publish(ALICE, ctx() as never, deps(failingReset(real))), /journal write failed/);
  const id = (await real.load('k-alice')).review.id;
  const bytes = [read(FILE), readAt(manifestPath(id))];
  assert.equal((await real.load('k-alice')).ops.length, 3, 'the journal still lists the ops');

  const second = await publish(ALICE, ctx() as never, deps(real));
  assert.equal(second.reviewId, id);
  assert.equal(second.skipped.length, 1);
  assert.deepEqual(second.skipped, JSON.parse(bytes[1]).skipped);
  assert.deepEqual([read(FILE), readAt(manifestPath(id))], bytes, 'the resolve is not toggled back');
  assert.equal(pageThreads(FILE).find((t) => t.id === 't-thread2')!.resolved, true);
  const journal = await real.load('k-alice');
  assert.deepEqual(journal.ops, []);
  assert.notEqual(journal.review.id, id);
  assert.equal(journal.mode, 'collect', 'finishing an earlier publish keeps the mode, not the default (auto)');
  assert.ok(!Number.isNaN(Date.parse(journal.review.updatedAt)));
});

test('an op drafted after a failed journal reset keeps its place under a new review and is published next', async () => {
  await fill('k-alice', [{ kind: 'resolve-thread', file: FILE, threadId: 't-thread2' }]);
  const real = store();
  await assert.rejects(publish(ALICE, ctx() as never, deps(failingReset(real))), /journal write failed/);
  const id = (await real.load('k-alice')).review.id;
  const manifest = readAt(manifestPath(id));

  await call('threads:add-comment', { file: FILE, threadId: 't-thread3', body: 'late', ...who });
  const left = await real.load('k-alice');
  assert.deepEqual(left.ops.map((o) => o.kind), ['add-comment'], 'only the late op is pending');
  assert.notEqual(left.review.id, id);

  const next = await publish(ALICE, ctx() as never, deps(real));
  assert.notEqual(next.reviewId, id);
  assert.match(read(FILE), /late/);
  assert.equal(pageThreads(FILE).find((t) => t.id === 't-thread2')!.resolved, true, 'the published resolve stays');
  assert.equal(readAt(manifestPath(id)), manifest);
  assert.equal(JSON.parse(readAt(manifestPath(next.reviewId))).ops.length, 1);
});

test('in the failed-reset window edits and deletes of the published comments reach the markdown, and get-threads shows the published state', async () => {
  await fill('k-alice', [
    { kind: 'resolve-thread', file: FILE, threadId: 't-thread2' },
    { kind: 'toggle-reaction', file: FILE, threadId: 't-thread2', commentId: 'c2-1', emoji: '🎉' },
    { kind: 'add-comment', file: FILE, threadId: 't-thread2', commentId: 'c-rep', parentId: null, body: 'reply' },
    { kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-del', parentId: null, body: 'doomed' },
  ]);
  const real = store();
  await assert.rejects(publish(ALICE, ctx() as never, deps(failingReset(real))), /journal write failed/);

  const view = await getThreads(FILE);
  const t2 = view.find((t) => t.id === 't-thread2')!;
  assert.equal(t2.resolved, true, 'a resolve the review published is not flipped back');
  assert.deepEqual(t2.comments[0].reactions, [{ emoji: '🎉', authors: ['Alice'] }]);
  assert.deepEqual((await real.load('k-alice')).ops, [], 'get-threads finished the earlier publish');

  await call('threads:edit-comment', { file: FILE, threadId: 't-thread2', commentId: 'c-rep', body: 'edited', ...who });
  await call('threads:delete-comment', { file: FILE, threadId: 't-thread1', commentId: 'c-del', ...who });
  assert.deepEqual((await real.load('k-alice')).ops.map((o) => o.kind), ['edit-comment', 'delete-comment']);
  await publish(ALICE, ctx() as never, deps(real));
  const threads = pageThreads(FILE);
  assert.equal(threads.find((t) => t.id === 't-thread2')!.comments.find((c) => c.id === 'c-rep')!.body, 'edited');
  assert.equal(threads.find((t) => t.id === 't-thread1')!.comments.some((c) => c.id === 'c-del'), false);
});

for (const state of ['published', 'discarded']) test(`a ${state} manifest of another author under this journal's review id is not taken for this review's`, async () => {
  await fill('k-alice', [{ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-a', parentId: null, body: 'a' }]);
  const id = (await store().load('k-alice')).review.id;
  fs.mkdirSync(safePath(reviewsDir(), '.'), { recursive: true });
  const other = { version: 1, id, authorKey: 'k-bob', authorName: 'Bob', title: 't', state, publishedAt: AT, ops: [], skipped: [] };
  fs.writeFileSync(safePath(reviewsDir(), `${id}.json`), JSON.stringify(other));

  await getThreads(); // finishing an earlier publish must leave the journal alone
  assert.equal((await store().load('k-alice')).ops.length, 1);
  const result = await publish(ALICE, ctx() as never, deps());
  assert.equal(result.reviewId, 'r-aaaaaaaa');
  assert.match(read(FILE), /c-a/);
  assert.deepEqual(JSON.parse(readAt(manifestPath(id))), other, "the other author's manifest is untouched");
  assert.equal(JSON.parse(readAt(manifestPath('r-aaaaaaaa'))).authorKey, 'k-alice');
});

test('a journal from before reviews existed is still finished after a failed reset', async () => {
  fs.mkdirSync(safePath(docsRoot, '.threads/drafts'), { recursive: true });
  const op = { kind: 'resolve-thread', opId: 'o-00000001', at: AT, file: FILE, threadId: 't-thread2' };
  const file = journalFile('k-alice');
  fs.writeFileSync(safePath(path.dirname(file), path.basename(file)), JSON.stringify({ version: 1, ops: [op] }));
  const real = store();
  await assert.rejects(publish(ALICE, ctx() as never, deps(failingReset(real))), /journal write failed/);
  const published = read(FILE);
  await publish(ALICE, ctx() as never, deps(real));
  assert.equal(read(FILE), published, 'the resolve was not applied a second time');
  assert.deepEqual((await real.load('k-alice')).ops, []);
});

test('finishing an earlier publish leaves a journal that has already moved to another review alone', async () => {
  const op = { kind: 'resolve-thread', opId: 'o-00000001', at: AT, file: FILE, threadId: 't-thread2' } as DraftOp;
  await fill('k-alice', [{ kind: 'resolve-thread', file: FILE, threadId: 't-thread2' }]);
  await publish(ALICE, ctx() as never, deps()); // publishes review r-?, journal now on r-aaaaaaaa
  const stale = (await store().load('k-alice')).review.id;
  await store().transact('k-alice', (j) => void j.ops.push(op));
  const published = JSON.parse(readAt(path.join(reviewsDir(), fs.readdirSync(safePath(reviewsDir(), '.'))[0])));
  published.ops.push(op);
  fs.writeFileSync(safePath(reviewsDir(), `${published.id}.json`), JSON.stringify(published));
  const real = store();
  // load reports the published review, the journal on disk has moved on
  const behind = { ...real, load: async (key: string) => ({ ...(await real.load(key)), review: { id: published.id } }) };
  await finishEarlierPublish(ctx() as never, behind, 'k-alice');
  const left = await real.load('k-alice');
  assert.deepEqual([left.review.id, left.ops.length], [stale, 1]);
});

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** An in-memory store: everything settles on microtasks. */
function memStore(journals: Record<string, Journal>, onLoad: (key: string) => Promise<void> = async () => {}): DraftStore {
  return {
    load: async (key) => {
      await onLoad(key);
      return structuredClone(journals[key]);
    },
    transact: async (key, fn) => {
      const j = structuredClone(journals[key]);
      fn(j, AT);
      journals[key] = j;
      return structuredClone(j);
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

test('a second publish waits for the first to finish; both comments land and each has a manifest', async () => {
  const comment = (id: string): NewDraftOp => ({ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: id, parentId: null, body: id });
  const journals: Record<string, Journal> = {
    'k-alice': { version: 1, review: { id: 'r-00000001' }, ops: [makeOp(comment('c-a'), AT)] },
    'k-bob': { version: 1, review: { id: 'r-00000002' }, ops: [makeOp(comment('c-b'), AT)] },
  };
  const pages = new Map([[FILE, read(FILE)]]);
  const log: string[] = [];
  const gate = deferred();
  const memCtx = (name: string) =>
    ctx({
      async readFile(rel: string) {
        log.push(`read:${name}`);
        return pages.get(rel) as string;
      },
      async writeFile(rel: string, content: string) {
        log.push(`write:${name}`);
        pages.set(rel, content);
      },
    }) as never;
  const sync = createNoGitSync(createLock());
  // Alice sits inside the lock, at her first store call, until the gate opens.
  const onLoad = async (key: string) => {
    log.push(`load:${key}`);
    if (key === 'k-alice') await gate.promise;
  };
  const base = { store: memStore(journals, onLoad), sync };
  const alice = publish({ key: 'k-alice', name: 'Alice' }, memCtx('alice'), base);
  const bob = publish({ key: 'k-bob', name: 'Bob' }, memCtx('bob'), base);

  await flush();
  assert.deepEqual(log, ['load:k-alice'], 'Bob has not started while Alice holds the lock');
  gate.resolve();
  const [a, b] = await Promise.all([alice, bob]);
  assert.deepEqual(log, [
    'load:k-alice', 'read:alice', 'write:alice',
    'load:k-bob', 'read:bob', 'write:bob',
  ]);
  const ids = parser.parseThreadsFromContent(pages.get(FILE) as string).flatMap((t) => t.comments.map((c) => c.id));
  assert.ok(ids.includes('c-a') && ids.includes('c-b'), 'Bob started from the page Alice wrote');
  assert.deepEqual(manifests().sort(), [`${a.reviewId}.json`, `${b.reviewId}.json`].sort());
});

test('an op the publisher drafts while its publish runs stays in the journal', async () => {
  await fill('k-alice', [{ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-a', parentId: null, body: 'a' }]);
  let drafted = false;
  const during: Partial<TestCtx> = {
    async writeFile(rel: string, content: string) {
      fs.writeFileSync(safePath(project.root, rel), content);
      if (!drafted) {
        drafted = true;
        await call('threads:add-comment', { file: FILE, threadId: 't-thread1', body: 'meanwhile', ...who });
      }
    },
  };
  await publishAction(who, during);
  const left = await store().load('k-alice');
  assert.equal(left.ops.length, 1);
  assert.equal((left.ops[0] as { body: string }).body, 'meanwhile');
  assert.match(read(FILE), /c-a/);
});

test("a journal saved by the earlier drafts step (no review, no anchor) works and publishes", async () => {
  fs.mkdirSync(safePath(docsRoot, '.threads/drafts'), { recursive: true });
  const op = { kind: 'add-thread', opId: 'o-00000001', at: AT, file: FILE, threadId: 't-old', commentId: 'c-old', body: 'old draft' };
  const file = journalFile('k-alice');
  fs.writeFileSync(safePath(path.dirname(file), path.basename(file)), JSON.stringify({ version: 1, ops: [op] }));

  assert.ok((await getThreads()).some((t) => t.id === 't-old'), 'get-threads overlays it');
  await call('threads:add-comment', { file: FILE, threadId: 't-old', body: 'follow-up', ...who });
  assert.equal((await store().load('k-alice')).ops.length, 2, 'a mutation appends');
  assert.deepEqual(fs.readdirSync(safePath(path.dirname(file), '.')).filter((f) => f.includes('.corrupt-')), []);

  const result = await publishAction();
  assert.match(result.reviewId, /^r-[0-9a-f]{8}$/);
  const t = pageThreads(FILE).find((x) => x.id === 't-old')!;
  assert.deepEqual(t.comments.map((c) => [c.id, c.authorKey, c.reviewId]), [['c-old', 'k-alice', result.reviewId], [t.comments[1].id, 'k-alice', result.reviewId]]);
  assert.equal(JSON.parse(readAt(manifestPath(result.reviewId))).ops.length, 2);
});

test('serve publishes only for a trusted identity; dev publishes from the payload', async () => {
  const bytes = read(FILE);
  await assert.rejects(publishAction(who, { mode: 'serve', caller: { identity: null } }), /threads\/no-identity/);
  assert.equal(read(FILE), bytes);
  assert.equal(fs.existsSync(path.join(docsRoot, '.threads')), false, 'no manifest dir, no journal');

  // The payload names someone else: the key and the name come from the identity and authors.json.
  const authorsFile = path.join(docsRoot, '.threads', 'authors.json');
  const asAlice: Partial<TestCtx> = { mode: 'serve', caller: { identity: 'alice' } };
  const mallory = { author: 'Mallory', authorKey: 'mallory', avatarUrl: 'x' };
  await (actions['threads:add-thread'] as (p: unknown, c: TestCtx) => Promise<unknown>)({ file: FILE, ...mallory, body: 'from serve' }, ctx(asAlice));
  assert.equal(fs.existsSync(authorsFile), false, 'a serve add never writes authors.json');
  const served = await publishAction(mallory, asAlice);
  assert.match(read(FILE), /::: comment c-[0-9a-f]{8} "alice" "[0-9-]+" by alice review /);
  assert.doesNotMatch(read(FILE), /Mallory|by mallory/);
  assert.ok(fs.existsSync(manifestPath(served.reviewId)));
  fs.mkdirSync(safePath(docsRoot, '.threads'), { recursive: true });
  fs.writeFileSync(safePath(docsRoot, '.threads/authors.json'), JSON.stringify({ alice: { name: 'Alice A', avatarUrl: '' } }));
  await fill('alice', [{ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-s', parentId: null, body: 'serve' }]);
  await publishAction(mallory, asAlice);
  assert.match(read(FILE), /::: comment c-s "Alice A" "[0-9-]+" by alice review /);
  assert.equal(JSON.parse(fs.readFileSync(safePath(path.dirname(authorsFile), 'authors.json'), 'utf8')).mallory, undefined);

  await fill('k-dev', [{ kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-d', parentId: null, body: 'dev' }]);
  await publishAction({ author: 'Dev', authorKey: 'k-dev' }, { mode: 'dev' });
  assert.match(read(FILE), /::: comment c-d "Dev" "[0-9-]+" by k-dev review /);
});

test('an author key or name the parser cannot read back is refused without writes; one it can is published and parsed back', async () => {
  const op: NewDraftOp = { kind: 'add-comment', file: FILE, threadId: 't-thread1', commentId: 'c-k', parentId: null, body: 'k' };
  const bytes = read(FILE);
  for (const key of ['two words', 'tab\tkey', 'new\nline']) {
    await fill(key, [op]);
    await assert.rejects(publishAction({ author: 'A', authorKey: key }), (e: unknown) => e instanceof ThreadsError && e.code === 'invalid', JSON.stringify(key));
    assert.equal(read(FILE), bytes);
    assert.equal(fs.existsSync(reviewsDir()), false);
    assert.equal((await store().load(key)).ops.length, 1, 'the journal is untouched');
  }
  for (const name of ['Ann "A" Lee', 'Line\nBreak']) {
    await fill('k-name', [op]);
    await assert.rejects(publishAction({ author: name, authorKey: 'k-name' }), (e: unknown) => e instanceof ThreadsError && e.code === 'invalid', JSON.stringify(name));
    assert.equal(read(FILE), bytes);
    assert.equal(fs.existsSync(reviewsDir()), false);
  }
  // Under serve an identity with whitespace is encoded, and the parser reads the key back.
  await fill('Jane%20Doe', [{ ...op, commentId: 'c-jane' }]);
  await publishAction({}, { mode: 'serve', caller: { identity: ' Jane Doe ' } });
  assert.match(read(FILE), /::: comment c-jane "Jane%20Doe" "[0-9-]+" by Jane%20Doe review /);
  assert.equal(pageThreads(FILE).flatMap((t) => t.comments).find((c) => c.id === 'c-jane')!.authorKey, 'Jane%20Doe');
  for (const key of ['alice', 'a.b-c_d', 'me@example.com', 'ünï']) {
    const ok: NewDraftOp = { ...op, commentId: `c-${slug(key).slice(0, 6)}` };
    await fill(key, [ok]);
    await publishAction({ author: 'A', authorKey: key });
    assert.equal(pageThreads(FILE).flatMap((t) => t.comments).find((c) => c.id === ok.commentId)!.authorKey, key);
  }
});
