import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playground } from './helpers.ts';
import { parseThreadsFromContent, replaceThreadsBlock } from '../src/plugin/parser.ts';
import { parseCommentInfo } from '../src/plugin/containers.ts';


const withIds = `# Doc

::: threads
  ::: thread t-1
    ::: comment c-0000000a "Alice" "2026-01-01"
      first
    :::

    ::: comment c-0000000b "Bob" "2026-01-02" reply-to c-0000000a edited "2026-01-03"
      second

      ::: reactions
        - 👍 Alice
      :::
    :::
  :::
  ::: thread t-2 resolved "Bob" "2026-01-04"
    ::: comment c-0000000c "Bob" "2026-01-02" edited "2026-01-03"
      third
    :::
  :::
:::
`;

const withoutIds = `::: threads
  ::: thread t-1
    ::: comment "Alice" "2026-01-01"
      legacy
    :::

    ::: comment "Bob" "2026-01-02" edited "2026-01-03"
      legacy edited
    :::
  :::
:::
`;

/** Comments with generated ids compared without them. */
const shape = (content: string) =>
  parseThreadsFromContent(content).map((t) => ({ ...t, comments: t.comments.map(({ id: _id, ...c }) => c) }));

test('id-bearing legacy content round-trips byte-identical', () => {
  assert.equal(replaceThreadsBlock(withIds, parseThreadsFromContent(withIds)), withIds);
});

test('id-less legacy content keeps its structure through a round-trip', () => {
  const out = replaceThreadsBlock(withoutIds, parseThreadsFromContent(withoutIds));
  assert.deepEqual(shape(out), shape(withoutIds));
});

// Structural rather than byte-identical: the fixture's indentation is not the serialiser's canonical form.
test('playground fixture keeps its threads and ids through a round-trip', () => {
  const threads = parseThreadsFromContent(playground);
  assert.equal(threads.length, 3);
  assert.deepEqual(parseThreadsFromContent(replaceThreadsBlock(playground, threads)), threads);
  for (const t of threads) {
    assert.equal(t.anchor, undefined);
    for (const c of t.comments) {
      assert.equal('authorKey' in c, false);
      assert.equal('reviewId' in c, false);
    }
  }
});

test('containers.parseCommentInfo gives the same author/date with and without v2 tokens', () => {
  for (const old of ['c-1 "Alice" "2026-01-02"', 'c-1 "Alice" "2026-01-02" reply-to c-0 edited "2026-01-03"']) {
    const a = parseCommentInfo(old);
    const b = parseCommentInfo(`${old} by alice review r-0000aaaa`);
    assert.equal(b.author, a.author);
    assert.equal(b.date, a.date);
    assert.equal(b.author, 'Alice');
  }
});
