import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownIt } from './helpers.ts';
import { setup } from '../src/plugin/containers.ts';

const md = MarkdownIt({ html: true });
setup(md);

const has = (html: string, s: string) => assert.ok(html.includes(s), `expected to contain: ${s}\n${html.slice(0, 500)}`);
const lacks = (html: string, s: string) => assert.ok(!html.includes(s), `expected NOT to contain: ${s}\n${html.slice(0, 500)}`);

test('full threads block renders correct structure', () => {
  const fullInput = `::: threads
  ::: thread t-abc123
    ::: comment "alice" "2026-03-07"
      This is the first comment
    :::
  :::
:::
`;

  const html1 = md.render(fullInput);

  has(html1, 'class="threads-sidebar"');
  has(html1, 'class="threads-thread"');
  has(html1, 'data-thread-id="t-abc123"');
  has(html1, 'class="threads-comment"');
  has(html1, 'data-author="alice"');
  has(html1, 'data-date="2026-03-07"');
  has(html1, 'class="threads-comment__meta"');
  has(html1, 'class="threads-comment__body"');
  has(html1, 'This is the first comment');
});

test('thread id attribute', () => {
  const idInput = `::: threads
  ::: thread t-xyz789
    ::: comment "bob" "2026-01-01"
      Test
    :::
  :::
:::
`;

  const html2 = md.render(idInput);
  has(html2, 'data-thread-id="t-xyz789"');
});

test('resolved thread has resolved class', () => {
  const resolvedInput = `::: threads
  ::: thread t-res001 resolved "charlie" "2026-03-08"
    ::: comment "charlie" "2026-03-08"
      Fixed the typo
    :::
  :::
:::
`;

  const html3 = md.render(resolvedInput);
  has(html3, 'threads-thread--resolved');
  has(html3, 'data-thread-id="t-res001"');
});

test('comment data attributes', () => {
  const commentInput = `::: threads
  ::: thread t-c001
    ::: comment "dave" "2026-05-15"
      Comment with attributes
    :::
  :::
:::
`;

  const html4 = md.render(commentInput);
  has(html4, 'data-author="dave"');
  has(html4, 'data-date="2026-05-15"');
});

test('comment meta header', () => {
  const metaInput = `::: threads
  ::: thread t-m001
    ::: comment "eve" "2026-06-20"
      Testing meta
    :::
  :::
:::
`;

  const html5 = md.render(metaInput);
  has(html5, '<strong>eve</strong>');
  has(html5, '2026-06-20');
});

test('reactions container', () => {
  const reactionsInput = `::: threads
  ::: thread t-r001
    ::: comment "frank" "2026-07-01"
      Comment with reactions

      ::: reactions
        - 👍 alice, bob
        - 🎉 charlie
      :::
    :::
  :::
:::
`;

  const html6 = md.render(reactionsInput);
  has(html6, 'class="threads-reactions"');
});

test('multiple threads', () => {
  const multiInput = `::: threads
  ::: thread t-first
    ::: comment "alice" "2026-01-01"
      First thread
    :::
  :::

  ::: thread t-second
    ::: comment "bob" "2026-01-02"
      Second thread
    :::
  :::
:::
`;

  const html7 = md.render(multiInput);
  has(html7, 'data-thread-id="t-first"');
  has(html7, 'data-thread-id="t-second"');
});

test('unresolved thread lacks resolved class', () => {
  const unresolvedInput = `::: threads
  ::: thread t-unres
    ::: comment "alice" "2026-01-01"
      Not resolved
    :::
  :::
:::
`;

  const html8 = md.render(unresolvedInput);
  has(html8, 'data-thread-id="t-unres"');
  lacks(html8, 'threads-thread--resolved');
});

test('edited comment has data-edited', () => {
  const editedInput = `::: threads
  ::: thread t-ed01
    ::: comment "alice" "2026-01-01" edited "2026-01-02"
      Edited comment
    :::
  :::
:::
`;

  const html9 = md.render(editedInput);
  has(html9, 'data-edited="2026-01-02"');
});

test('comment body rendered as markdown', () => {
  const markdownBodyInput = `::: threads
  ::: thread t-md01
    ::: comment "alice" "2026-01-01"
      This has **bold** and *italic* text
    :::
  :::
:::
`;

  const html10 = md.render(markdownBodyInput);
  has(html10, '<strong>bold</strong>');
  has(html10, '<em>italic</em>');
});

test('comment body escapes raw HTML', () => {
  const rawHtmlInput = `::: threads
  ::: thread t-html01
    ::: comment "alice" "2026-01-01"
      <span data-test="raw">raw html</span>
      This still has **bold** text
    :::
  :::
:::
`;

  const html11 = md.render(rawHtmlInput);
  assert.ok(!html11.includes('<span data-test="raw">raw html</span>'));
  assert.ok(html11.includes('&lt;span') || html11.includes('&amp;lt;span'));
  has(html11, '<strong>bold</strong>');
});

test('empty threads block', () => {
  const emptyInput = `::: threads
:::
`;

  const html12 = md.render(emptyInput);
  has(html12, 'class="threads-sidebar"');
});

test('comment with id in info string', () => {
  const commentWithIdInput = `::: threads
  ::: thread t-id01
    ::: comment c-abc12345 "alice" "2026-03-07"
      Comment with persistent ID
    :::
  :::
:::
`;

  const html13 = md.render(commentWithIdInput);
  has(html13, 'data-comment-id="c-abc12345"');
  has(html13, 'data-author="alice"');
  has(html13, 'data-date="2026-03-07"');
});

test('comment with id and edited', () => {
  const commentWithIdEditedInput = `::: threads
  ::: thread t-id02
    ::: comment c-def67890 "bob" "2026-03-07" edited "2026-03-08"
      Edited comment with ID
    :::
  :::
:::
`;

  const html14 = md.render(commentWithIdEditedInput);
  has(html14, 'data-comment-id="c-def67890"');
  has(html14, 'data-author="bob"');
  has(html14, 'data-edited="2026-03-08"');
});

test('anchor renders as blockquote.threads-anchor inside the thread', () => {
  const html = md.render(`::: threads
  ::: thread t-anc
    ::: anchor
      quoted <b>text</b>
    :::

    ::: comment c-1 "alice" "2026-01-01"
      hi
    :::
  :::
:::
`);
  has(html, '<blockquote class="threads-anchor">quoted &lt;b&gt;text&lt;/b&gt;</blockquote>');
  assert.ok(html.indexOf('threads-thread') < html.indexOf('threads-anchor'));
  assert.ok(html.indexOf('threads-anchor') < html.indexOf('threads-comment"'));
  lacks(html, '<p>:::');
  lacks(html, '<p>quoted');
});

test('thread without anchor renders no anchor element', () => {
  const html = md.render(`::: threads
  ::: thread t-none
    ::: comment c-1 "alice" "2026-01-01"
      hi
    :::
  :::
:::
`);
  lacks(html, 'threads-anchor');
});
