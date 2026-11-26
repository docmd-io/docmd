import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBodyHtml } from '../src/plugin/body-html.ts';

test('renderBodyHtml: each config object gets a renderer made from its own markdown options', () => {
  const keepBreaks = { markdown: { breaks: true } };
  const joinLines = { markdown: { breaks: false } };
  assert.match(renderBodyHtml(keepBreaks, 'one\ntwo'), /<br>/);
  assert.doesNotMatch(renderBodyHtml(joinLines, 'one\ntwo'), /<br>/, 'a second site is not rendered with the first site options');
  assert.match(renderBodyHtml(keepBreaks, 'one\ntwo'), /<br>/, 'and the first keeps its own');
});

test('renderBodyHtml: raw HTML is escaped whatever the config says, and a bare call works', () => {
  const html = renderBodyHtml({ security: { html: 'allow' } }, '<b>x</b>');
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(renderBodyHtml(undefined, 'plain'), /<p>plain<\/p>/);
  assert.match(renderBodyHtml(null, 'plain'), /<p>plain<\/p>/);
});
