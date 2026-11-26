import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideRawSidebars } from '../src/client/lib/raw-sidebars.ts';

// A fake document: markdown-it renders one `.threads-sidebar` per `::: threads` block.
function page(blocks: number) {
  const sidebars = Array.from({ length: blocks }, () => ({ style: { display: '' } }));
  const other = { style: { display: '' } };
  const root = {
    querySelector: (sel: string) => (sel === '.threads-sidebar' ? sidebars[0] ?? null : other),
    querySelectorAll: (sel: string) => (sel === '.threads-sidebar' ? sidebars : [other]),
  };
  return { root: root as unknown as ParentNode, sidebars, other };
}

test('hideRawSidebars hides the raw sidebar of every threads block, and nothing else', () => {
  const { root, sidebars, other } = page(3);
  hideRawSidebars(root);
  assert.deepEqual(sidebars.map((s) => s.style.display), ['none', 'none', 'none']);
  assert.equal(other.style.display, '');
});

test('hideRawSidebars on a page without threads blocks does nothing', () => {
  const { root, other } = page(0);
  hideRawSidebars(root);
  assert.equal(other.style.display, '');
});

test('hideRawSidebars with onlyIfEmpty preserves sidebars with remaining threads and hides empty ones', () => {
  const emptySidebar = { style: { display: '' }, querySelectorAll: () => [] };
  const nonEmptySidebar = { style: { display: '' }, querySelectorAll: () => [{}] };
  const root = {
    querySelectorAll: (sel: string) => (sel === '.threads-sidebar' ? [emptySidebar, nonEmptySidebar] : []),
  } as unknown as ParentNode;
  hideRawSidebars(root, true);
  assert.equal(emptySidebar.style.display, 'none');
  assert.equal(nonEmptySidebar.style.display, '');
});
