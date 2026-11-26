import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
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
  has(html6, '<div class="threads-reactions"><ul><li>👍 alice, bob</li><li>🎉 charlie</li></ul></div>');
});

const reactionsPage = (lines: string) => `::: threads
  ::: thread t-r002
    ::: comment c-r002 "frank" "2026-07-01"
      Body

      ::: reactions
${lines}
      :::
    :::
  :::
:::
`;

test('reactions block shows names only: identity keys never reach the page', () => {
  const html = md.render(reactionsPage('        - 👍 Alice Smith {alice-key}, Bob {8812031}\n        - 🎉 Old Name'));
  has(html, '<div class="threads-reactions"><ul><li>👍 Alice Smith, Bob</li><li>🎉 Old Name</li></ul></div>');
  for (const secret of ['alice-key', '8812031', '{', '}']) lacks(html, secret);
});

test('reactions block: escaped separators in names, two people with one name, HTML escaped', () => {
  const html = md.render(reactionsPage('        - 👍 Smith\\, Anna {a\\,b}, Twin {t1}, Twin {t2}, <b>Eve</b> {e&k}, "Q" {q}'));
  has(html, '<li>👍 Smith, Anna, Twin, Twin, &lt;b&gt;Eve&lt;/b&gt;, &quot;Q&quot;</li>');
  lacks(html, '<b>Eve</b>');
  for (const secret of ['a,b', 't1', 'e&amp;k', 'e&k']) lacks(html, secret);
});

test('reactions block: the comment body around it still renders and a block with no entries is an empty list', () => {
  const html = md.render(reactionsPage('        not a reaction line'));
  has(html, '<div class="threads-reactions"><ul></ul></div>');
  has(html, 'Body');
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

test('::: anchor outside a thread is not turned into an anchor blockquote', () => {
  lacks(md.render('::: anchor\nplain\n:::\n'), 'threads-anchor');
});

// ---------------------------------------------------------------------------
// Profile links in the build-time HTML (names only; the Markdown never stores a link)
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-containers-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const writeAuthors = (authors: unknown): string => {
  const src = fs.mkdtempSync(path.join(root, 'site-'));
  fs.mkdirSync(path.join(src, '.threads'));
  fs.writeFileSync(path.join(src, '.threads', 'authors.json'), JSON.stringify(authors));
  return src;
};
const REL = 'rel="nofollow noopener ugc"';

const linkedPage = `::: threads
  ::: thread t-l
    ::: comment c-l1 "Alice Smith" "2026-07-01" by alice
      First

      ::: reactions
        - 👍 Alice Smith {alice}, Bob {bob}, Walt {walt}
        - 🎉 Old Timer, Quiet {quiet}
      :::
    :::

    ::: comment c-l2 "Bob" "2026-07-02" by bob
      Second
    :::

    ::: comment c-l3 "Walt" "2026-07-03" by walt
      Third
    :::

    ::: comment c-l4 "No Key" "2026-07-04"
      Fourth
    :::
  :::
:::
`;
const siteAuthors = {
  alice: { name: 'Alice Smith', avatarUrl: '' },
  bob: { name: 'Bob', avatarUrl: '', link: 'https://bob.example/~bob?a=1&b="2"' },
  walt: { name: 'Walt', avatarUrl: '', link: false },
  quiet: { name: 'Quiet Renamed', avatarUrl: '', link: false },
};
const render = (src: string, env: Record<string, unknown>) => md.render(linkedPage, env);

test('build links: comment authors and reactors link by the pattern, a custom link, or not at all', () => {
  const src = writeAuthors(siteAuthors);
  const html = render(src, { config: { src, plugins: { threads: { profileUrl: 'https://github.com/{id}' } } } });
  has(html, `<strong><a href="https://github.com/alice" ${REL}>Alice Smith</a></strong>`);
  has(html, `<strong><a href="https://bob.example/~bob?a=1&amp;b=&quot;2&quot;" ${REL}>Bob</a></strong>`);
  has(html, '<strong>Walt</strong>');
  has(html, '<strong>No Key</strong>');
  has(html, `<li>👍 <a href="https://github.com/alice" ${REL}>Alice Smith</a>, <a href="https://bob.example/~bob?a=1&amp;b=&quot;2&quot;" ${REL}>Bob</a>, Walt</li>`);
  has(html, `<li>🎉 Old Timer, Quiet Renamed</li>`);
});

test('build links: a custom link works with no profileUrl, and without one the others stay plain', () => {
  const src = writeAuthors(siteAuthors);
  const html = render(src, { config: { src } });
  has(html, `<a href="https://bob.example/~bob?a=1&amp;b=&quot;2&quot;" ${REL}>Bob</a>`);
  lacks(html, 'github.com');
  has(html, '<strong>Alice Smith</strong>');
});

test('build links: names stay plain when the render env carries no site config or no docs folder', () => {
  const src = writeAuthors(siteAuthors);
  for (const env of [{}, { config: undefined }, { config: { base: '/', strict: false } }, { config: { plugins: { threads: { profileUrl: 'https://github.com/{id}' } } } }]) {
    const html = render(src, env);
    lacks(html, '<a ');
    has(html, '<strong>Alice Smith</strong>');
    has(html, '<li>👍 Alice Smith, Bob, Walt</li>');
  }
});

test('build links: an invalid profileUrl is treated as none and does not break the render', () => {
  const src = writeAuthors({});
  const html = render(src, { config: { src, plugins: { threads: { profileUrl: 'javascript:{id}' } } } });
  lacks(html, '<a ');
  has(html, '<strong>Alice Smith</strong>');
});

test('build links: identity keys are never in the output, and names are escaped inside links', () => {
  const src = writeAuthors({ 'k"ey': { name: 'Q <i>', avatarUrl: '' } });
  const page = `::: threads
  ::: thread t-x
    ::: comment c-x "<b>Eve</b>" "2026-07-01" by k"ey
      Body

      ::: reactions
        - 👍 <b>Eve</b> {k"ey}, Other {secret-key-1}
      :::
    :::
  :::
:::
`;
  const plain = md.render(page, { config: { src } });
  lacks(plain, '<b>Eve</b>');
  for (const secret of ['secret-key-1', 'k"ey', 'k&quot;ey', '{', '}']) lacks(plain.slice(plain.indexOf('threads-reactions')), secret);

  // With a pattern the key is in the link target only, never in the visible text
  const html = md.render(page, { config: { src, plugins: { threads: { profileUrl: 'https://p.example/{id}' } } } });
  lacks(html, '<b>Eve</b>');
  has(html, 'href="https://p.example/k%22ey"');
  has(html, 'href="https://p.example/secret-key-1"');
  const visible = html.replace(/ href="[^"]*"/g, '').replace(/ data-[a-z-]+="[^"]*"/g, '');
  lacks(visible, 'secret-key-1');
  lacks(visible, 'k%22ey');
  has(html, '>&lt;b&gt;Eve&lt;/b&gt;</a></strong>');
  has(html, '>Q &lt;i&gt;</a>');
});

test('build links: through the engine pipeline with the env the generator builds and the options markdownSetup receives', async () => {
  const { createMarkdownProcessor, processContentAsync } = await import('@docmd/parser');
  const { markdownSetup } = await import('../src/index.ts');
  const src = writeAuthors(siteAuthors);
  const options = { profileUrl: 'https://github.com/{id}' };
  const processor = createMarkdownProcessor({}, (m: any) => markdownSetup(m, options));
  // The generator's env.config: base, strict and src, with no `plugins`.
  const env = { config: { base: '/', strict: false, src } };
  const result = await processContentAsync(linkedPage, processor, {}, env, null);
  const html: string = result.htmlContent;
  has(html, `<a href="https://github.com/alice" ${REL}>Alice Smith</a>`);
  has(html, `<a href="https://bob.example/~bob?a=1&amp;b=&quot;2&quot;" ${REL}>Bob</a>`);
  has(html, `<li>👍 <a href="https://github.com/alice" ${REL}>Alice Smith</a>`);
  has(html, '<strong>Walt</strong>');
});
