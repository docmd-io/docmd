import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Comment } from '../src/types';
import {
  buildCommentTree, summaryText, chooseBodyHtml, canEditComment, canDeleteComment, deleteScope, colorAt, emojiLang, pickerUrls,
} from '../src/client/lib/thread-view.ts';

const c = (id: string, over: Partial<Comment> = {}): Comment => ({
  id, thread_id: 't', parent_id: null, author: 'Ann', date: '2026-01-01', edited_at: null, body: id, reactions: [], ...over,
});

// ---------------------------------------------------------------------------
// buildCommentTree
// ---------------------------------------------------------------------------

test('tree: top-level comments keep their order and have no replies when nobody answered', () => {
  const tree = buildCommentTree([c('a'), c('b')]);
  assert.deepEqual(tree.map((n) => n.comment.id), ['a', 'b']);
  assert.deepEqual(tree.map((n) => n.replies.length), [0, 0]);
});

test('tree: an empty thread has an empty tree', () => {
  assert.deepEqual(buildCommentTree([]), []);
});

test('tree: a reply to a top-level comment sits under it with no replyTo', () => {
  const [node] = buildCommentTree([c('a'), c('r', { parent_id: 'a' })]);
  assert.deepEqual(node!.replies.map((r) => [r.comment.id, r.replyTo]), [['r', null]]);
});

test('tree: replies of replies are flattened under the top-level comment and name the comment they answer', () => {
  const tree = buildCommentTree([
    c('a'),
    c('r1', { parent_id: 'a', author: 'Bo' }),
    c('r2', { parent_id: 'r1', author: 'Cy' }),
    c('r3', { parent_id: 'r2', author: 'Di' }),
  ]);
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0]!.replies.map((r) => r.comment.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(tree[0]!.replies.map((r) => r.replyTo?.id ?? null), [null, 'r1', 'r2']);
  assert.equal(tree[0]!.replies[1]!.replyTo!.author, 'Bo');
});

test('tree: descendants of different top-level comments stay apart', () => {
  const tree = buildCommentTree([
    c('a'), c('b'),
    c('ra', { parent_id: 'a' }), c('rb', { parent_id: 'b' }), c('rra', { parent_id: 'ra' }),
  ]);
  assert.deepEqual(tree.map((n) => n.replies.map((r) => r.comment.id)), [['ra', 'rra'], ['rb']]);
});

test('tree: replies are sorted by date, and ties keep the stored order', () => {
  const [node] = buildCommentTree([
    c('a'),
    c('late', { parent_id: 'a', date: '2026-03-01' }),
    c('early', { parent_id: 'a', date: '2026-01-05' }),
    c('tie1', { parent_id: 'a', date: '2026-02-01' }),
    c('tie2', { parent_id: 'a', date: '2026-02-01' }),
  ]);
  assert.deepEqual(node!.replies.map((r) => r.comment.id), ['early', 'tie1', 'tie2', 'late']);
});

test('tree: a reply whose parent is missing is shown as a top-level comment, not dropped', () => {
  const tree = buildCommentTree([c('a'), c('lost', { parent_id: 'gone' })]);
  assert.deepEqual(tree.map((n) => n.comment.id), ['a', 'lost']);
});

test('tree: a parent cycle does not loop; the first comment of the cycle that is reached stays on top', () => {
  const tree = buildCommentTree([c('x', { parent_id: 'y' }), c('y', { parent_id: 'x' })]);
  const ids = tree.flatMap((n) => [n.comment.id, ...n.replies.map((r) => r.comment.id)]).sort();
  assert.deepEqual(ids, ['x', 'y']);
});

test('tree: a comment that is its own parent is top-level', () => {
  assert.deepEqual(buildCommentTree([c('s', { parent_id: 's' })]).map((n) => n.comment.id), ['s']);
});

// ---------------------------------------------------------------------------
// summaryText
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { tCount, isOne } from '../src/client/lib/plural.ts';

const load = (lang: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../i18n/${lang}.json`, import.meta.url), 'utf8'));
const trFor = (lang: string) => { const d = load(lang); return (k: string) => d[k] ?? k; };
const en = trFor('en');

test('summary: singular for one comment, plural for every other count including zero', () => {
  assert.equal(summaryText(1, ['Ann'], en, 'en'), '1 comment by Ann');
  assert.equal(summaryText(0, [], en, 'en'), '0 comments');
  assert.equal(summaryText(2, ['Ann', 'Ann'], en, 'en'), '2 comments by Ann');
  assert.equal(summaryText(11, ['Ann'], en, 'en'), '11 comments by Ann');
});

test('summary: no authors leaves the count alone', () => {
  assert.equal(summaryText(3, [], en, 'en'), '3 comments');
  assert.equal(summaryText(3, ['', '  '], en, 'en'), '3 comments');
  assert.equal(summaryText(1, [], en, 'en'), '1 comment');
});

test('summary: first names only, distinct, in order of first comment', () => {
  assert.equal(summaryText(3, ['Ann Lee', 'Bo Chan', 'Ann Lee'], en, 'en'), '3 comments by Ann and Bo');
});

test('summary: three authors list all three; more than three show three and the rest as a count', () => {
  assert.equal(summaryText(3, ['Ann', 'Bo', 'Cy'], en, 'en'), '3 comments by Ann, Bo, and Cy');
  assert.equal(summaryText(5, ['Ann', 'Bo', 'Cy', 'Di'], en, 'en'), '5 comments by Ann, Bo, Cy, and 1 more');
  assert.equal(summaryText(9, ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'], en, 'en'), '9 comments by Ann, Bo, Cy, and 3 more');
});

test('summary: whole-sentence templates, so a language sets its own word order and list format', () => {
  const fr = (k: string) => ({ commentSummaryBy: '{n} commentaires de {names}', commentSummaryByOne: '{n} commentaire de {names}' })[k] ?? k;
  assert.equal(summaryText(2, ['Ann', 'Bo'], fr, 'fr'), '2 commentaires de Ann et Bo');
  assert.equal(summaryText(1, ['Ann'], fr, 'fr'), '1 commentaire de Ann');
  assert.equal(summaryText(3, ['Ann', 'Bo'], trFor('ko'), 'ko'), 'Ann 및 Bo의 댓글 3개');
  assert.equal(summaryText(7, ['Ann', 'Bo', 'Cy', 'Di'], trFor('zh'), 'zh'), 'Ann、Bo、Cy和其他 1 人 的 7 条评论');
});

test('plural forms follow the language rules, not n === 1', () => {
  assert.equal(isOne(1, 'en'), true);
  assert.equal(isOne(0, 'en'), false);
  assert.equal(isOne(0, 'hi'), true, 'hindi: 0 takes the one form');
  assert.equal(isOne(1, 'ko'), false, 'korean has one form');
  assert.equal(isOne(1, 'not a lang!'), true, 'a bad language tag falls back to English');
  assert.equal(tCount('unpublishedCount', 1, en, 'en'), '1 unpublished comment');
  assert.equal(tCount('unpublishedCount', 2, en, 'en'), '2 unpublished comments');
  assert.equal(tCount('lostAnchor', 1, en, 'en'), '1 of your comments lost its anchor');
  assert.equal(tCount('lostAnchor', 3, en, 'en'), '3 of your comments lost their anchor');
  assert.equal(tCount('unpublishedCount', 0, trFor('hi'), 'hi'), '0 अप्रकाशित टिप्पणी');
});

// ---------------------------------------------------------------------------
// chooseBodyHtml
// ---------------------------------------------------------------------------

test('body html: a published unchanged comment shows the page html', () => {
  assert.equal(chooseBodyHtml({ bodyHtml: 'S' }, 'P'), 'P');
  assert.equal(chooseBodyHtml({}, 'P'), 'P');
});

test('body html: a draft or a pending edit shows the server html, not the page html', () => {
  assert.equal(chooseBodyHtml({ draft: true, bodyHtml: 'S' }, 'P'), 'S');
  assert.equal(chooseBodyHtml({ pendingEdit: true, bodyHtml: 'S' }, 'P'), 'S');
});

test('body html: falls back to whichever exists, and to empty so the comment shows plain text', () => {
  assert.equal(chooseBodyHtml({ bodyHtml: 'S' }, undefined), 'S');
  assert.equal(chooseBodyHtml({ draft: true }, 'P'), 'P');
  assert.equal(chooseBodyHtml({}, undefined), '');
});

// ---------------------------------------------------------------------------
// canEditComment / canDeleteComment
// ---------------------------------------------------------------------------

test('edit: header mode follows canShow', () => {
  const mine = (_a: string, t: { authorKey?: string | null }) => t.authorKey === 'ann';
  assert.equal(canEditComment(mine, { author: 'Ann', authorKey: 'ann' }, 'Ann', false), true);
  assert.equal(canEditComment(mine, { author: 'Bo', authorKey: 'bo' }, 'Ann', false), false);
});

test('edit: local mode (canShow always true) only on drafts and comments under the viewer name', () => {
  const always = () => true;
  assert.equal(canEditComment(always, { author: 'Ann' }, 'Ann', true), true);
  assert.equal(canEditComment(always, { author: 'Bo' }, 'Ann', true), false);
  assert.equal(canEditComment(always, { author: 'Bo', draft: true }, 'Ann', true), true);
  assert.equal(canEditComment(always, { author: 'Ann' }, '', true), false, 'no name: nothing is the viewer\'s');
});

test('edit: a drafted comment is passed to canShow as drafted', () => {
  let seen: unknown = null;
  canEditComment((_a, t) => { seen = t; return true; }, { author: 'Ann', authorKey: 'k', draft: true }, 'Ann', false);
  assert.deepEqual(seen, { authorKey: 'k', drafted: true });
});

test('delete: a lone comment deletes the thread and is judged by the published authors', () => {
  const thread = { comments: [c('a', { authorKey: 'ann' })] };
  assert.equal(deleteScope(thread), 'thread');
  const calls: Array<[string, unknown]> = [];
  canDeleteComment((a, t) => { calls.push([a, t]); return true; }, thread, 'a');
  assert.deepEqual(calls, [['delete-thread', { authorKeys: ['ann'] }]]);
});

test('delete: a lone draft comment has no published authors to check', () => {
  const calls: unknown[] = [];
  canDeleteComment((_a, t) => { calls.push(t); return true; }, { comments: [c('a', { authorKey: 'ann', draft: true })] }, 'a');
  assert.deepEqual(calls, [{ authorKeys: [] }]);
});

test('delete: with several comments it is a comment delete with the server\'s target (the opener is admin only)', () => {
  const thread = { comments: [c('a', { authorKey: 'ann' }), c('b', { authorKey: 'bo' })] };
  assert.equal(deleteScope(thread), 'comment');
  const seen: unknown[] = [];
  canDeleteComment((a, t) => { seen.push([a, t]); return true; }, thread, 'a');
  canDeleteComment((a, t) => { seen.push([a, t]); return true; }, thread, 'b');
  assert.deepEqual(seen, [
    ['delete-comment', { authorKey: null, drafted: false }],
    ['delete-comment', { authorKey: 'bo', drafted: false }],
  ]);
});

// ---------------------------------------------------------------------------
// colour, picker URLs
// ---------------------------------------------------------------------------

test('colorAt cycles through the six highlight names', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(colorAt), ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'yellow', 'blue']);
  assert.equal(colorAt(-1), 'orange');
});

test('emojiLang: the primary subtag when its data is built, English otherwise', () => {
  assert.equal(emojiLang('zh-CN'), 'zh');
  assert.equal(emojiLang('ko'), 'ko');
  assert.equal(emojiLang('HI_IN'), 'hi');
  assert.equal(emojiLang('fr'), 'en');
  assert.equal(emojiLang(''), 'en');
  assert.equal(emojiLang(null), 'en');
  assert.equal(emojiLang(undefined), 'en');
});

test('pickerUrls: the picker sits next to the bundle, the data one folder up under threads/emoji', () => {
  assert.deepEqual(pickerUrls('https://x.test/base/assets/js/threads.js', 'zh-Hans'), {
    pickerSrc: 'https://x.test/base/assets/js/threads-emoji-picker.js',
    emojiDataSrc: 'https://x.test/base/assets/threads/emoji/zh.json',
  });
  assert.equal(pickerUrls('http://localhost:3000/assets/js/threads.js', 'de').emojiDataSrc, 'http://localhost:3000/assets/threads/emoji/en.json');
});

test('tree: a comment hanging off a parent cycle is still shown', () => {
  const tree = buildCommentTree([c('x', { parent_id: 'y' }), c('y', { parent_id: 'x' }), c('z', { parent_id: 'x' })]);
  const ids = tree.flatMap((n) => [n.comment.id, ...n.replies.map((r) => r.comment.id)]).sort();
  assert.deepEqual(ids, ['x', 'y', 'z']);
});
