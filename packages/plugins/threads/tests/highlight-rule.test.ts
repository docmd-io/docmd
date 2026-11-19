import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownIt } from './helpers.ts';
import { setup } from '../src/plugin/highlight-rule.ts';

const md = MarkdownIt();
setup(md);

test('basic highlight with thread id', () => {
  assert.ok(md.render('==highlighted text=={t-abc123}').includes('<mark class="threads-highlight" data-thread-id="t-abc123">highlighted text</mark>'));
});

test('plain highlight without thread id', () => {
  const html = md.render('==plain highlight==');
  assert.ok(html.includes('<mark class="threads-highlight">plain highlight</mark>'));
  assert.ok(!html.includes('data-thread-id'));
});

test('multiple highlights in one line', () => {
  const html = md.render('==first=={t-1} and ==second=={t-2}');
  assert.ok(html.includes('<mark class="threads-highlight" data-thread-id="t-1">first</mark>'));
  assert.ok(html.includes('<mark class="threads-highlight" data-thread-id="t-2">second</mark>'));
  assert.ok(html.includes(' and '));
});

test('highlight inside a paragraph', () => {
  assert.ok(md.render('This is a ==highlighted phrase=={t-42} in a sentence.').includes('This is a <mark class="threads-highlight" data-thread-id="t-42">highlighted phrase</mark> in a sentence.'));
});

test('highlight with bold inside', () => {
  const html = md.render('==**bold** text=={t-1}');
  assert.ok(html.includes('<mark class="threads-highlight" data-thread-id="t-1">'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('</mark>'));
});

test('single = does not trigger highlight', () => {
  assert.ok(!md.render('a = b and c = d').includes('<mark'));
});

test('empty highlight text is not matched', () => {
  assert.ok(!md.render('===={t-1}').includes('<mark'));
});

test('highlight does not span line breaks', () => {
  assert.ok(!md.render('==start\nend==').includes('<mark'));
});

test('backslash-escaped marker is not a highlight', () => {
  assert.ok(!md.render('\\==not highlighted==').includes('<mark'));
});
