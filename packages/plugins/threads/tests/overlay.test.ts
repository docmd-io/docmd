import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlay } from '../src/plugin/overlay.ts';
import type { Thread, DraftOp } from '../src/types.ts';

const who = { name: 'Me' };
const F = 'docs/a.md';
const at = '2026-04-01T10:00:00.000Z';
const published = (): Thread[] => [{
  id: 't-pub', resolved: false, resolved_by: null, resolved_at: null,
  comments: [
    { id: 'c-1', thread_id: 't-pub', parent_id: null, author: 'Ann', date: '2026-01-01', edited_at: null, body: 'one', reactions: [] },
    { id: 'c-2', thread_id: 't-pub', parent_id: null, author: 'Bo', date: '2026-01-02', edited_at: null, body: 'two',
      reactions: [{ emoji: '👍', authors: ['Ann'] }] },
  ],
}];
const base = { opId: 'o', at, file: F };

const table: Array<[string, DraftOp[], (t: Thread[]) => void]> = [
  ['add-thread', [{ ...base, kind: 'add-thread', threadId: 't-new', commentId: 'c-new', body: 'hello' }], (t) => {
    assert.equal(t.length, 2);
    assert.deepEqual(t[1], {
      id: 't-new', resolved: false, resolved_by: null, resolved_at: null, draft: true,
      comments: [{ id: 'c-new', thread_id: 't-new', parent_id: null, author: 'Me', date: '2026-04-01', edited_at: null, body: 'hello', reactions: [], draft: true }],
    });
  }],
  ['add-thread with an anchor keeps its quote only', [{ ...base, kind: 'add-thread', threadId: 't-new', commentId: 'c-new', body: 'hello', anchor: { quote: 'some text', prefix: 'p', suffix: null, selector: null, offset: 3, blockText: null } }], (t) => {
    assert.deepEqual(t[1]!.anchor, { quote: 'some text' });
    assert.equal(t[1]!.draft, true);
  }],
  ['add-comment', [{ ...base, kind: 'add-comment', threadId: 't-pub', commentId: 'c-3', parentId: 'c-1', body: 'reply' }], (t) => {
    assert.equal(t[0].comments.length, 3);
    assert.deepEqual([t[0].comments[2].author, t[0].comments[2].date, t[0].comments[2].parent_id], ['Me', '2026-04-01', 'c-1']);
    assert.equal(t[0].comments[2].draft, true);
    assert.equal(Object.hasOwn(t[0].comments[0], 'draft'), false, 'published comments carry no draft key');
    assert.equal(Object.hasOwn(t[0], 'draft'), false, 'a thread carries no draft key');
  }],
  ['edit-comment', [{ ...base, kind: 'edit-comment', threadId: 't-pub', commentId: 'c-1', body: 'edited' }], (t) => {
    assert.deepEqual([t[0].comments[0].body, t[0].comments[0].edited_at], ['edited', '2026-04-01']);
    assert.equal(Object.hasOwn(t[0].comments[0], 'draft'), false, 'an edit does not make a published comment a draft');
  }],
  ['delete-comment', [{ ...base, kind: 'delete-comment', threadId: 't-pub', commentId: 'c-1' }], (t) => {
    assert.deepEqual(t[0].comments.map((c) => c.id), ['c-2']);
  }],
  ['delete-thread', [{ ...base, kind: 'delete-thread', threadId: 't-pub' }], (t) => assert.deepEqual(t, [])],
  ['resolve-thread toggles', [{ ...base, kind: 'resolve-thread', threadId: 't-pub' }], (t) => {
    assert.deepEqual([t[0].resolved, t[0].resolved_by, t[0].resolved_at], [true, 'Me', '2026-04-01']);
  }],
  ['resolve-thread twice unresolves', [{ ...base, kind: 'resolve-thread', threadId: 't-pub' }, { ...base, opId: 'o2', kind: 'resolve-thread', threadId: 't-pub' }], (t) => {
    assert.deepEqual([t[0].resolved, t[0].resolved_by, t[0].resolved_at], [false, null, null]);
  }],
  ['toggle-reaction joins an existing reaction', [{ ...base, kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-2', emoji: '👍' }], (t) => {
    assert.deepEqual(t[0].comments[1].reactions, [{ emoji: '👍', authors: ['Ann', 'Me'] }]);
  }],
  ['toggle-reaction leaves an existing reaction', [
    { ...base, kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-2', emoji: '👍' },
    { ...base, opId: 'o2', kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-2', emoji: '👍' },
  ], (t) => assert.deepEqual(t[0].comments[1].reactions, [{ emoji: '👍', authors: ['Ann'] }])],
  ['toggle-reaction new, then off removes the reaction', [
    { ...base, kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-1', emoji: '🎉' },
    { ...base, opId: 'o2', kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-1', emoji: '🎉' },
  ], (t) => assert.deepEqual(t[0].comments[0].reactions, [])],
  ['ops of another file are ignored', [{ ...base, file: 'docs/b.md', kind: 'delete-thread', threadId: 't-pub' }], (t) => assert.deepEqual(t, published())],
  ['ops on missing targets are ignored', [
    { ...base, kind: 'add-comment', threadId: 't-gone', commentId: 'c-x', parentId: null, body: 'x' },
    { ...base, opId: 'o2', kind: 'edit-comment', threadId: 't-pub', commentId: 'c-gone', body: 'x' },
    { ...base, opId: 'o3', kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-gone', emoji: '👍' },
    { ...base, opId: 'o4', kind: 'resolve-thread', threadId: 't-gone' },
  ], (t) => assert.deepEqual(t, published())],
  ['ops apply in order: a drafted comment can be reacted to', [
    { ...base, kind: 'add-comment', threadId: 't-pub', commentId: 'c-3', parentId: null, body: 'r' },
    { ...base, opId: 'o2', kind: 'toggle-reaction', threadId: 't-pub', commentId: 'c-3', emoji: '❤️' },
  ], (t) => assert.deepEqual(t[0].comments[2].reactions, [{ emoji: '❤️', authors: ['Me'] }])],
];

for (const [name, ops, check] of table) {
  test(`overlay: ${name}`, () => {
    const input = published();
    check(overlay(input, ops, F, who));
    assert.deepEqual(input, published(), 'input is not mutated');
  });
}
