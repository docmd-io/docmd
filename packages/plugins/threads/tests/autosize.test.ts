import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTOSIZE_MAX_PX, fitHeight, needsAutosize } from '../src/client/lib/autosize';

test('needsAutosize: false when the browser supports field-sizing: content', () => {
  const asked: Array<[string, string]> = [];
  assert.equal(needsAutosize((p, v) => { asked.push([p, v]); return true; }), false);
  assert.deepEqual(asked, [['field-sizing', 'content']]);
});

test('needsAutosize: true when unsupported, when CSS.supports is missing, or when it throws', () => {
  assert.equal(needsAutosize(() => false), true);
  assert.equal(needsAutosize(undefined), true);
  assert.equal(needsAutosize(() => { throw new Error('boom'); }), true);
});

test('fitHeight: content height plus borders, no scrollbar under the cap', () => {
  assert.deepEqual(fitHeight(80, 2), { height: 82, overflowY: 'hidden' });
  assert.deepEqual(fitHeight(0, 2), { height: 2, overflowY: 'hidden' });
});

test('fitHeight: exactly the cap still fits; one pixel over scrolls at the cap', () => {
  assert.deepEqual(fitHeight(AUTOSIZE_MAX_PX - 2, 2), { height: AUTOSIZE_MAX_PX, overflowY: 'hidden' });
  assert.deepEqual(fitHeight(AUTOSIZE_MAX_PX - 1, 2), { height: AUTOSIZE_MAX_PX, overflowY: 'auto' });
  assert.deepEqual(fitHeight(5000, 2), { height: AUTOSIZE_MAX_PX, overflowY: 'auto' });
});

test('fitHeight: honours a custom cap', () => {
  assert.deepEqual(fitHeight(120, 2, 100), { height: 100, overflowY: 'auto' });
});
