import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseThreadsFromContent,
  serializeThreadsBlock,
  replaceThreadsBlock,
} from '../src/plugin/parser.ts';

const fullContent = `# My Document

Some content here.

::: threads
  ::: thread t-abc123
    ::: comment "alice" "2026-03-07"
      This is the first comment
    :::

    ::: comment "bob" "2026-03-08" edited "2026-03-09"
      I agree, let's reword it

      ::: reactions
        - 👍 charlie, dave
        - 🎉 alice
      :::
    :::
  :::

  ::: thread t-def456 resolved "charlie" "2026-03-08"
    ::: comment "charlie" "2026-03-08"
      Typo in this section
    :::
  :::
:::

Some trailing content.
`;

const newThreads = [
  {
    id: 't-new',
    resolved: false,
    resolved_by: null,
    resolved_at: null,
    comments: [
      {
        id: 'c-newid000',
        thread_id: 't-new',
        author: 'newuser',
        date: '2026-06-01',
        edited_at: null,
        body: 'New comment',
        reactions: [],
      },
    ],
  },
];

const existingContent = `# Document

Some text.

::: threads
  ::: thread t-old
    ::: comment "olduser" "2025-01-01"
      Old comment
    :::
  :::
:::

Footer text.
`;

test('parses a full threads block', () => {
  const threads = parseThreadsFromContent(fullContent);
  assert.equal(threads.length, 2);

  const t1 = threads[0];
  assert.equal(t1.id, 't-abc123');
  assert.equal(t1.resolved, false);
  assert.equal(t1.resolved_by, null);
  assert.equal(t1.resolved_at, null);
  assert.equal(t1.comments.length, 2);

  const c1 = t1.comments[0];
  assert.equal(c1.author, 'alice');
  assert.equal(c1.date, '2026-03-07');
  assert.equal(c1.edited_at, null);
  assert.equal(c1.body, 'This is the first comment');
  assert.equal(c1.reactions.length, 0);
  assert.ok(c1.id.startsWith('c-'));
  assert.equal(c1.id.length, 10);
  assert.equal(c1.thread_id, 't-abc123');

  const c2 = t1.comments[1];
  assert.equal(c2.author, 'bob');
  assert.equal(c2.date, '2026-03-08');
  assert.equal(c2.edited_at, '2026-03-09');
  assert.equal(c2.body, "I agree, let's reword it");
  assert.equal(c2.reactions.length, 2);
  assert.equal(c2.reactions[0].emoji, '👍');
  assert.deepEqual(c2.reactions[0].authors, ['charlie', 'dave']);
  assert.equal(c2.reactions[1].emoji, '🎉');
  assert.deepEqual(c2.reactions[1].authors, ['alice']);

  const t2 = threads[1];
  assert.equal(t2.id, 't-def456');
  assert.equal(t2.resolved, true);
  assert.equal(t2.resolved_by, 'charlie');
  assert.equal(t2.resolved_at, '2026-03-08');
  assert.equal(t2.comments.length, 1);
  assert.equal(t2.comments[0].author, 'charlie');
  assert.equal(t2.comments[0].body, 'Typo in this section');
});

test('content without a threads block parses to an empty array', () => {
  const result = parseThreadsFromContent(`# Just a document\n\nNo threads here.\n`);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test('round-trip serialize then parse keeps the thread structure', () => {
  const threadData = [
    {
      id: 't-111111',
      resolved: false,
      resolved_by: null,
      resolved_at: null,
      comments: [
        {
          id: 'c-aabbccdd',
          thread_id: 't-111111',
          author: 'eve',
          date: '2026-01-01',
          edited_at: null,
          body: 'Hello world',
          reactions: [],
        },
      ],
    },
    {
      id: 't-222222',
      resolved: true,
      resolved_by: 'frank',
      resolved_at: '2026-02-15',
      comments: [
        {
          id: 'c-11223344',
          thread_id: 't-222222',
          author: 'frank',
          date: '2026-02-10',
          edited_at: '2026-02-12',
          body: 'Multi-line\ncontent here',
          reactions: [{ emoji: '👍', authors: ['eve'] }],
        },
      ],
    },
  ];

  const serialized = serializeThreadsBlock(threadData);
  assert.ok(serialized.startsWith('::: threads\n'));
  assert.ok(serialized.trimEnd().endsWith(':::'));

  const reparsed = parseThreadsFromContent(serialized);
  assert.equal(reparsed.length, 2);

  assert.equal(reparsed[0].id, 't-111111');
  assert.equal(reparsed[0].resolved, false);
  assert.equal(reparsed[0].comments[0].author, 'eve');
  assert.equal(reparsed[0].comments[0].body, 'Hello world');

  assert.equal(reparsed[1].id, 't-222222');
  assert.equal(reparsed[1].resolved, true);
  assert.equal(reparsed[1].resolved_by, 'frank');
  assert.equal(reparsed[1].resolved_at, '2026-02-15');
  assert.equal(reparsed[1].comments[0].author, 'frank');
  assert.equal(reparsed[1].comments[0].edited_at, '2026-02-12');
  assert.equal(reparsed[1].comments[0].body, 'Multi-line\ncontent here');
  assert.equal(reparsed[1].comments[0].reactions.length, 1);
  assert.equal(reparsed[1].comments[0].reactions[0].emoji, '👍');
  assert.deepEqual(reparsed[1].comments[0].reactions[0].authors, ['eve']);
});

test('replaces the threads block in an existing file', () => {
  const replaced = replaceThreadsBlock(existingContent, newThreads);
  assert.ok(replaced.includes('# Document'));
  assert.ok(replaced.includes('Footer text.'));
  assert.ok(replaced.includes('t-new'));
  assert.ok(!replaced.includes('t-old'));
  assert.ok(!replaced.includes('olduser'));

  const reparsed = parseThreadsFromContent(replaced);
  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].id, 't-new');
});

test('adds a threads block to a file that has none', () => {
  const withThreads = replaceThreadsBlock(`# My Page\n\nJust some content.\n`, newThreads);
  assert.ok(withThreads.includes('# My Page'));
  assert.ok(withThreads.includes('::: threads'));
  assert.ok(withThreads.includes('t-new'));

  const reparsed = parseThreadsFromContent(withThreads);
  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].id, 't-new');
});

test('replacing with no threads removes the block', () => {
  const cleared = replaceThreadsBlock(existingContent, []);
  assert.ok(!cleared.includes('::: threads'));
  assert.ok(cleared.includes('# Document'));
  assert.ok(cleared.includes('Footer text.'));
});

test('multi-paragraph comment body is preserved', () => {
  const content = `::: threads
  ::: thread t-mp
    ::: comment "alice" "2026-03-01"
      First paragraph.

      Second paragraph.

      Third paragraph.
    :::
  :::
:::
`;
  const threads = parseThreadsFromContent(content);
  assert.equal(threads.length, 1);
  assert.equal(
    threads[0].comments[0].body,
    'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
  );
});

test('comment ids are unique', () => {
  const ids = new Set<string>();
  for (const thread of parseThreadsFromContent(fullContent)) {
    for (const comment of thread.comments) {
      assert.ok(!ids.has(comment.id), `comment id ${comment.id} repeated`);
      ids.add(comment.id);
    }
  }
  assert.equal(ids.size, 3);
});

type Expected = { authorKey?: string; reviewId?: string; parent_id?: string; edited_at?: string };
const tokenCases: Array<[string, string, Expected]> = [
  ['none', '', {}],
  ['reply-to', ' reply-to c-0', { parent_id: 'c-0' }],
  ['edited', ' edited "2026-01-03"', { edited_at: '2026-01-03' }],
  ['by', ' by alice@x.y', { authorKey: 'alice@x.y' }],
  ['review', ' review r-0000aaaa', { reviewId: 'r-0000aaaa' }],
  [
    'all',
    ' reply-to c-0 edited "2026-01-03" by alice@x.y review r-0000aaaa',
    { parent_id: 'c-0', edited_at: '2026-01-03', authorKey: 'alice@x.y', reviewId: 'r-0000aaaa' },
  ],
];
for (const [name, tokens, expected] of tokenCases) {
  test(`comment tokens parse and serialise in fixed order: ${name}`, () => {
    const line = `comment c-1 "Alice" "2026-01-02"${tokens}`;
    const content = `::: threads\n  ::: thread t-1\n    ::: ${line}\n      hi\n    :::\n  :::\n:::\n`;
    const [t] = parseThreadsFromContent(content);
    const c = t.comments[0];
    assert.equal(c.id, 'c-1');
    assert.equal(c.parent_id, expected.parent_id ?? null);
    assert.equal(c.edited_at, expected.edited_at ?? null);
    assert.equal(c.authorKey, expected.authorKey);
    assert.equal(c.reviewId, expected.reviewId);
    assert.equal(serializeThreadsBlock([t]), content);
  });
}

test('anchor child parses to thread.anchor and serialises first, only when set', () => {
  const content = `::: threads
  ::: thread t-1
    ::: anchor
      quoted text
    :::

    ::: comment c-1 "Alice" "2026-01-02"
      hi
    :::
  :::
  ::: thread t-2
    ::: comment c-2 "Bob" "2026-01-02"
      yo
    :::
  :::
:::
`;
  const [t1, t2] = parseThreadsFromContent(content);
  assert.deepEqual(t1.anchor, { quote: 'quoted text' });
  assert.equal(t1.comments.length, 1);
  assert.equal(t2.anchor, undefined);
  assert.equal(serializeThreadsBlock([t1, t2]), content);
});

test('an anchor that is not the first child is kept and serialised first', () => {
  const content = `::: threads
  ::: thread t-1
    ::: comment c-1 "Alice" "2026-01-02"
      hi
    :::
    ::: anchor
      late quote
    :::
  :::
:::
`;
  const [t] = parseThreadsFromContent(content);
  assert.deepEqual(t.anchor, { quote: 'late quote' });
  assert.ok(serializeThreadsBlock([t]).indexOf('::: anchor') < serializeThreadsBlock([t]).indexOf('::: comment'));
});
