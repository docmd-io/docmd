import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isThreadsTag, pathHasThreadsElement, inDocumentTree } from '../src/client/lib/selection.ts';

test('isThreadsTag: our components by tag name, any case, nothing else', () => {
  assert.equal(isThreadsTag('THREADS-THREAD'), true);
  assert.equal(isThreadsTag('threads-editor'), true);
  assert.equal(isThreadsTag('Threads-Button'), true);
  assert.equal(isThreadsTag('DIV'), false);
  assert.equal(isThreadsTag('THREAD'), false);
  assert.equal(isThreadsTag('MY-THREADS-X'), false);
  assert.equal(isThreadsTag(''), false);
  assert.equal(isThreadsTag(null), false);
  assert.equal(isThreadsTag(undefined), false);
});

test('pathHasThreadsElement: a click inside a card has one on its composed path, one on the page does not', () => {
  const inCard = [{ tagName: 'P' }, { tagName: 'DIV' }, { tagName: 'THREADS-COMMENT' }, { tagName: 'THREADS-THREAD' }, { tagName: 'ARTICLE' }, { tagName: 'BODY' }];
  const onPage = [{ tagName: 'P' }, { tagName: 'ARTICLE' }, { tagName: 'BODY' }];
  assert.equal(pathHasThreadsElement(inCard), true);
  assert.equal(pathHasThreadsElement(onPage), false);
});

test('pathHasThreadsElement: window, document and text nodes on the path have no tag and are skipped', () => {
  assert.equal(pathHasThreadsElement([{}, { tagName: undefined }, { tagName: null }]), false);
  assert.equal(pathHasThreadsElement([]), false);
});

test('inDocumentTree: only nodes whose root is the document count', () => {
  const doc = { kind: 'document' };
  const shadow = { kind: 'shadow-root' };
  assert.equal(inDocumentTree({ getRootNode: () => doc }, doc), true);
  assert.equal(inDocumentTree({ getRootNode: () => shadow }, doc), false);
  assert.equal(inDocumentTree({}, doc), false, 'not a node');
});
