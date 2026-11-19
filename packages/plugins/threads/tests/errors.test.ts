import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThreadsError } from '../src/plugin/errors.ts';

test('message carries the threads/<code>: prefix and code is exposed', () => {
  const e = new ThreadsError('not-found', 'Thread not found: t-1');
  assert.equal(e.message, 'threads/not-found: Thread not found: t-1');
  assert.equal(e.code, 'not-found');
});
