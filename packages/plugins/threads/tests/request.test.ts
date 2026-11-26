import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRequest, requestErrorMessage, type RequestDetail } from '../src/client/lib/request';

type Detail = { body: string } & RequestDetail;

function target(listener?: (detail: Detail, e: CustomEvent) => void): EventTarget {
  const el = new EventTarget();
  if (listener) el.addEventListener('threads-submit', (e) => listener((e as CustomEvent<Detail>).detail, e as CustomEvent));
  return el;
}

test('no listener calls waitUntil: null, so the component goes straight back to idle', () => {
  assert.equal(dispatchRequest(target(), 'threads-submit', { body: 'x' }), null);
  assert.equal(dispatchRequest(target(() => {}), 'threads-submit', { body: 'x' }), null);
});

test('the event bubbles, is composed, and carries the data next to waitUntil', () => {
  let seen: CustomEvent | null = null;
  let detail: Detail | null = null;
  dispatchRequest(target((d, e) => { seen = e; detail = d; }), 'threads-submit', { body: 'hello' });
  assert.equal(seen!.type, 'threads-submit');
  assert.equal(seen!.bubbles, true);
  assert.equal(seen!.composed, true);
  assert.equal(detail!.body, 'hello');
  assert.equal(typeof detail!.waitUntil, 'function');
});

test('one waitUntil: the caller gets that promise\'s value', async () => {
  const result = dispatchRequest(target((d) => d.waitUntil(Promise.resolve(['👍']))), 'threads-submit', { body: 'x' });
  assert.deepEqual(await result, ['👍']);
});

test('a rejected promise rejects the request', async () => {
  const result = dispatchRequest(target((d) => d.waitUntil(Promise.reject(new Error('nope')))), 'threads-submit', { body: 'x' });
  await assert.rejects(result as Promise<unknown>, /nope/);
});

test('several waitUntil calls settle together and one rejection rejects all', async () => {
  const ok = dispatchRequest(target((d) => { d.waitUntil(Promise.resolve(1)); d.waitUntil(Promise.resolve(2)); }), 'threads-submit', { body: 'x' });
  assert.deepEqual(await ok, [1, 2]);
  const bad = dispatchRequest(target((d) => { d.waitUntil(Promise.resolve(1)); d.waitUntil(Promise.reject(new Error('second'))); }), 'threads-submit', { body: 'x' });
  await assert.rejects(bad as Promise<unknown>, /second/);
});

test('a waitUntil after dispatch returned is ignored', () => {
  let late: (() => void) | null = null;
  const result = dispatchRequest(target((d) => { late = () => d.waitUntil(Promise.resolve()); }), 'threads-submit', { body: 'x' });
  late!();
  assert.equal(result, null);
});

test('a non-promise value is accepted by waitUntil', async () => {
  const result = dispatchRequest(target((d) => d.waitUntil(5 as unknown as Promise<unknown>)), 'threads-submit', { body: 'x' });
  assert.equal(await result, 5);
});

test('requestErrorMessage: the limit codes get their own text, anything else the generic line', () => {
  assert.match(requestErrorMessage(new Error('threads/limit-chars: too long')), /too long/i);
  assert.match(requestErrorMessage(new Error('threads/rate-limited: slow down')), /too fast/i);
  assert.equal(requestErrorMessage(new Error('boom')), 'Could not save. Try again.');
  assert.equal(requestErrorMessage('a string'), 'Could not save. Try again.');
  assert.equal(requestErrorMessage(null), 'Could not save. Try again.');
});

test('requestErrorMessage: a reaction the site does not allow says so; other codes stay generic', () => {
  assert.equal(requestErrorMessage(new Error('threads/reaction-not-allowed: 🦄 is not on the list')), 'This emoji is not allowed on this site');
  assert.equal(requestErrorMessage(new Error('threads/invalid: not an emoji')), 'Could not save. Try again.');
  assert.equal(requestErrorMessage(new Error('threads/forbidden: not yours')), 'Could not save. Try again.');
});
