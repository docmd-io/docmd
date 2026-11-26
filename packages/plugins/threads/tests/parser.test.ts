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

const twoBlocks = `# Document

Intro.

::: threads
  ::: thread t-first
    ::: comment c-first "Alice" "2026-01-01"
      First block
    :::
  :::
:::

Between blocks.

::: threads
  ::: thread t-second
    ::: comment c-second "Bob" "2026-01-02"
      Second block
    :::
  :::
:::

Outro.
`;

test('all top-level threads blocks are parsed in document order', () => {
  const threads = parseThreadsFromContent(twoBlocks);
  assert.deepEqual(threads.map((t) => t.id), ['t-first', 't-second']);
  assert.deepEqual(threads.map((t) => t.comments[0].body), ['First block', 'Second block']);
});

test('round-trip keeps every threads block at its original position', () => {
  const threads = parseThreadsFromContent(twoBlocks);
  assert.equal(replaceThreadsBlock(twoBlocks, threads), twoBlocks);
});

const newThread = (id: string, body = 'New') => ({
  id,
  resolved: false,
  resolved_by: null,
  resolved_at: null,
  comments: [{
    id: `c-${id}`,
    thread_id: id,
    parent_id: null,
    author: 'Eve',
    date: '2026-01-03',
    edited_at: null,
    body,
    reactions: [],
  }],
});

test('new threads go into the last existing block; no block is opened', () => {
  const threads = [...parseThreadsFromContent(twoBlocks), newThread('t-new', 'New block')];
  const out = replaceThreadsBlock(twoBlocks, threads);
  assert.equal(out.split('::: threads').length - 1, 2);
  assert.ok(out.indexOf('t-first') < out.indexOf('Between blocks.'));
  assert.ok(out.indexOf('Between blocks.') < out.indexOf('t-second'));
  assert.ok(out.indexOf('t-second') < out.indexOf('t-new'));
  assert.ok(out.indexOf('t-new') < out.indexOf('Outro.'));
  assert.ok(out.endsWith('Outro.\n'));
  assert.ok(out.startsWith(twoBlocks.slice(0, twoBlocks.indexOf('Between blocks.'))), 'the first block is untouched');
  assert.deepEqual(parseThreadsFromContent(out).map((t) => t.id), ['t-first', 't-second', 't-new']);
});

test('on a page with one block between text, a new thread joins that block and the footer stays last', () => {
  const page = 'Intro.\n\n' + serializeThreadsBlock([newThread('t-old', 'Old')]) + '\nFooter.\n';
  const out = replaceThreadsBlock(page, [...parseThreadsFromContent(page), newThread('t-new')]);
  assert.equal(out, 'Intro.\n\n' + serializeThreadsBlock([newThread('t-old', 'Old'), newThread('t-new')]) + '\nFooter.\n');
});

test('a new thread added while the last block loses its threads takes that block\'s place', () => {
  const out = replaceThreadsBlock(twoBlocks, [parseThreadsFromContent(twoBlocks)[0], newThread('t-new')]);
  assert.equal(out.split('::: threads').length - 1, 2);
  assert.ok(!out.includes('t-second'));
  assert.ok(out.indexOf('Between blocks.') < out.indexOf('t-new'));
  assert.ok(out.indexOf('t-new') < out.indexOf('Outro.'));
});

test('removing one block while adding a thread to another leaves no double blank line', () => {
  const out = replaceThreadsBlock(twoBlocks, [parseThreadsFromContent(twoBlocks)[1], newThread('t-new')]);
  assert.doesNotMatch(out, /\n\n\n/);
  assert.ok(out.startsWith('# Document\n\nIntro.\n\nBetween blocks.\n\n::: threads\n'));
  assert.deepEqual(parseThreadsFromContent(out).map((t) => t.id), ['t-second', 't-new']);
});

test('deleting the only thread in one block removes that block, not the other', () => {
  const out = replaceThreadsBlock(twoBlocks, parseThreadsFromContent(twoBlocks).filter((t) => t.id !== 't-first'));
  assert.ok(!out.includes('t-first'));
  assert.ok(out.startsWith('# Document\n\nIntro.\n\n'));
  assert.ok(out.includes('Between blocks.\n\n::: threads'));
  assert.ok(out.endsWith('Outro.\n'));
  assert.deepEqual(parseThreadsFromContent(out).map((t) => t.id), ['t-second']);
  assert.equal(out.split('::: threads').length - 1, 1);
});

const example = (fence: string) => `${fence}markdown
::: threads
  ::: thread t-example
    ::: comment c-example "Doc" "2026-01-01"
      Example
    :::
  :::
:::
${fence}
`;

const realBlock = serializeThreadsBlock([newThread('t-real', 'Real')]);

for (const fence of ['```', '~~~', '````']) {
  test(`a threads block inside a ${fence} fence is not parsed or rewritten, before or after the real block`, () => {
    const page = `# Doc\n\n${example(fence)}\nText.\n\n${realBlock}\nMore.\n\n${example(fence)}`;
    assert.deepEqual(parseThreadsFromContent(page).map((t) => t.id), ['t-real']);
    const out = replaceThreadsBlock(page, [...parseThreadsFromContent(page), newThread('t-new')]);
    assert.equal(out, page.replace(realBlock, serializeThreadsBlock([newThread('t-real', 'Real'), newThread('t-new')])));
    const cleared = replaceThreadsBlock(page, []);
    assert.equal(cleared.split(example(fence)).length - 1, 2, 'both examples are kept');
    assert.deepEqual(parseThreadsFromContent(cleared), []);
  });
}

test('a fence only closes on its own character and at least its length', () => {
  const nested = '````markdown\n```\n::: threads\n```\n~~~~\n::: threads\n````\n';
  const page = `${nested}\n${realBlock}`;
  assert.deepEqual(parseThreadsFromContent(page).map((t) => t.id), ['t-real']);
});

test('a page whose only threads block is a fenced example gets a new block for its first thread', () => {
  const page = `# Doc\n\n${example('```')}`;
  assert.deepEqual(parseThreadsFromContent(page), []);
  const out = replaceThreadsBlock(page, [newThread('t-new')]);
  assert.equal(out, `${page.trimEnd()}\n\n${serializeThreadsBlock([newThread('t-new')])}`);
});

test('a thread id in two blocks: the first copy wins for parse and write; the later copy is kept until the thread is deleted', () => {
  const first = serializeThreadsBlock([newThread('t-dup', 'First copy')]);
  const second = serializeThreadsBlock([newThread('t-dup', 'Second copy'), newThread('t-other')]);
  const page = `A.\n\n${first}\nB.\n\n${second}`;
  const threads = parseThreadsFromContent(page);
  assert.deepEqual(threads.map((t) => [t.id, t.comments[0].body]), [['t-dup', 'First copy'], ['t-other', 'New']]);
  assert.equal(replaceThreadsBlock(page, threads), page);

  threads[0].comments[0].body = 'Edited';
  const out = replaceThreadsBlock(page, threads);
  assert.equal(out, `A.\n\n${first.replace('First copy', 'Edited')}\nB.\n\n${second}`);
  assert.equal(parseThreadsFromContent(out)[0].comments[0].body, 'Edited');

  const gone = replaceThreadsBlock(page, threads.filter((t) => t.id !== 't-dup'));
  assert.deepEqual(parseThreadsFromContent(gone).map((t) => t.id), ['t-other'], 'deleting the thread removes every copy');
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
