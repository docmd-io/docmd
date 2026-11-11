/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/parser
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 *
 * Non-index pages are written to `<slug>/index.html`, one directory deeper
 * than the markdown file. Relative links get an extra `../` so they still
 * resolve from that folder. `index.md` and `README.md` normalise to the
 * current directory (`''`), and that case used to skip the shift, so the
 * link pointed at the page itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownProcessor, processContentAsync } from '../dist/index.js';

function render(markdown, env) {
  const md = createMarkdownProcessor({}, () => {});
  return processContentAsync(markdown, md, {}, env);
}

test('non-index page: index.md and README.md link to the parent directory', async () => {
  const r = await render(
    [
      '# Guide',
      '',
      '[Overview](index.md)',
      '',
      '[Setup](index.md#setup)',
      '',
      '[Readme](README.md)',
      '',
      '[Sibling](other.md)',
      '',
      '[Here](#local)',
      '',
      '::: button "Home" url:index.md',
      ''
    ].join('\n'),
    { isIndex: false, relativePathToRoot: '../../', filePath: 'docs/guide.md' }
  );

  assert.match(r.htmlContent, /<a href="\.\.\/">Overview<\/a>/);
  assert.match(r.htmlContent, /<a href="\.\.\/#setup">Setup<\/a>/);
  assert.match(r.htmlContent, /<a href="\.\.\/">Readme<\/a>/);
  assert.match(r.htmlContent, /<a href="\.\.\/other\/">Sibling<\/a>/);
  assert.match(r.htmlContent, /<a href="#local">Here<\/a>/);
  assert.match(r.htmlContent, /<a href="\.\.\/" class="docmd-button"/);
});

test('index page: index.md#setup stays an anchor on this page', async () => {
  const r = await render(
    '[Overview](index.md)\n\n[Setup](index.md#setup)\n\n[Here](#local)\n',
    { isIndex: true, relativePathToRoot: './', filePath: 'docs/index.md' }
  );

  assert.doesNotMatch(r.htmlContent, /href="\.\.\//);
  assert.match(r.htmlContent, /<a href="\.\/">Overview<\/a>/);
  assert.match(r.htmlContent, /<a href="#setup">Setup<\/a>/);
  assert.match(r.htmlContent, /<a href="#local">Here<\/a>/);
});
