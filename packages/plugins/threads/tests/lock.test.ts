import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLock, lockFor } from '../src/plugin/lock.ts';

/** A promise the test settles by hand. */
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

test('withLock runs callbacks in call order, even when the first is slow', async () => {
  const lock = createLock();
  const log: string[] = [];
  const gate = deferred();
  const first = lock.withLock(async () => {
    log.push('first:start');
    await gate.promise;
    log.push('first:end');
  });
  const second = lock.withLock(async () => void log.push('second'));
  await Promise.resolve();
  assert.deepEqual(log, ['first:start'], 'the second callback waits');
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(log, ['first:start', 'first:end', 'second']);
});

test('a rejected callback rejects its caller but does not block the queue', async () => {
  const lock = createLock();
  const failing = lock.withLock(async () => {
    throw new Error('boom');
  });
  const next = lock.withLock(async () => 'ran');
  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'ran');
  assert.equal(await lock.withLock(async () => 'again'), 'again');
});

test('lockFor gives one lock per docs root', () => {
  assert.equal(lockFor('/a'), lockFor('/a'));
  assert.notEqual(lockFor('/a'), lockFor('/b'));
});
