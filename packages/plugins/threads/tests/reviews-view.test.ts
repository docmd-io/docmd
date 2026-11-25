import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { siteFromPage, threadHref, threadIdFromHash } from '../src/client/lib/reviews-view.ts';

describe('threadHref', () => {
  const table: Array<[string, string, string | undefined, string]> = [
    ['docs/guide/intro.md', '/', undefined, '/guide/intro/#thread-t-1'],
    ['docs/index.md', '/', undefined, '/#thread-t-1'],
    ['docs/guide/index.md', '/', undefined, '/guide/#thread-t-1'],
    // Documented limit: README always collapses to its folder, even when the folder also has an index page.
    ['docs/guide/README.md', '/', undefined, '/guide/#thread-t-1'],
    ['docs/README.md', '/', undefined, '/#thread-t-1'],
    ['docs/a/b/c/deep.md', '/', undefined, '/a/b/c/deep/#thread-t-1'],
    ['docs/guide/intro.md', '/site/', undefined, '/site/guide/intro/#thread-t-1'],
    ['docs/guide/intro.md', '/site', undefined, '/site/guide/intro/#thread-t-1'],
    ['docs/My Guide/Getting Started.md', '/', undefined, '/My-Guide/Getting-Started/#thread-t-1'],
    ['content/guide/intro.md', '/', 'content/', '/guide/intro/#thread-t-1'],
  ];
  for (const [file, base, root, want] of table) {
    it(`${file} @ ${base}${root ? ` (root ${root})` : ''} → ${want}`, () => {
      assert.equal(threadHref(file, 't-1', base, root), want);
    });
  }
});

describe('siteFromPage', () => {
  const table: Array<[string, string, string, string]> = [
    ['docs/guide/intro.md', '/guide/intro/', '/', 'docs/'],
    ['docs/index.md', '/', '/', 'docs/'],
    ['docs/index.md', '/site/', '/site/', 'docs/'],
    ['docs/guide/intro.md', '/site/guide/intro/', '/site/', 'docs/'],
    ['docs/guide/README.md', '/site/guide/', '/site/', 'docs/'],
    ['docs/README.md', '/docs/', '/docs/', 'docs/'],
  ];
  for (const [file, path, siteBase, srcRoot] of table) {
    it(`${file} at ${path}`, () => {
      assert.deepEqual(siteFromPage(file, path), { siteBase, srcRoot });
    });
  }

  it('feeds threadHref so a link from another page resolves under the base', () => {
    const { siteBase, srcRoot } = siteFromPage('docs/index.md', '/site/');
    assert.equal(threadHref('docs/guide/intro.md', 't-1', siteBase, srcRoot), '/site/guide/intro/#thread-t-1');
  });
});

describe('threadIdFromHash', () => {
  const table: Array<[string, string | null]> = [
    ['#thread-t-1', 't-1'],
    ['#thread-a%20b%2Fc', 'a b/c'],
    ['#thread-%E0', null],
    ['#other', null],
    ['#thread-', null],
    ['', null],
  ];
  for (const [hash, want] of table) {
    it(`${JSON.stringify(hash)} → ${JSON.stringify(want)}`, () => {
      assert.equal(threadIdFromHash(hash), want);
    });
  }
});
