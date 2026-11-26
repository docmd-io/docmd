import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placePopover } from '../src/client/lib/popover-position.ts';

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };

test('below the anchor, left edges aligned', () => {
  assert.deepEqual(placePopover({ top: 100, left: 300, width: 24, height: 24 }, size, viewport), { top: 130, left: 300 });
});

test('flips above when there is no room below and more above', () => {
  assert.deepEqual(placePopover({ top: 740, left: 300, width: 24, height: 24 }, size, viewport), { top: 634, left: 300 });
});

test('stays below when neither side fits but below has more room', () => {
  const tall = { width: 200, height: 900 };
  const placed = placePopover({ top: 100, left: 300, width: 24, height: 24 }, tall, viewport);
  assert.equal(placed.top, 8, 'clamped into the viewport');
});

test('keeps inside the viewport horizontally', () => {
  assert.equal(placePopover({ top: 100, left: 950, width: 24, height: 24 }, size, viewport).left, 792);
  assert.equal(placePopover({ top: 100, left: -30, width: 24, height: 24 }, size, viewport).left, 8);
});

test('a card wider than the viewport sits at the left margin', () => {
  assert.equal(placePopover({ top: 100, left: 20, width: 24, height: 24 }, { width: 1200, height: 50 }, viewport).left, 8);
});

test('gap and margin are adjustable', () => {
  assert.deepEqual(placePopover({ top: 10, left: 10, width: 10, height: 10 }, size, viewport, 0, 0), { top: 20, left: 10 });
});
