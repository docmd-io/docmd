import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscardController } from '../src/client/lib/discard-controller.ts';
import { ThreadsClientError } from '../src/client/lib/api.ts';

// One stub api, built once; `beforeEach` resets what a test steers.
const s = { calls: [] as string[], gate: null as Promise<void> | null, error: null as unknown, done: 0, changes: 0 };
const api = {
  async discardReview(id: string): Promise<void> {
    s.calls.push(id);
    if (s.gate) await s.gate;
    if (s.error) throw s.error;
  },
};
const t = (k: string): string => `t:${k}`;
const build = () => createDiscardController({ api, t, onDone: () => void s.done++, onChange: () => void s.changes++ });
const settle = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => Object.assign(s, { calls: [], gate: null, error: null, done: 0, changes: 0 }));

test('ask then cancel makes no call and ends closed', async () => {
  const c = build();
  c.ask('r-1');
  assert.equal(c.state(), 'confirming');
  c.cancel();
  await c.confirm();
  assert.deepEqual([c.state(), s.calls, s.done], ['closed', [], 0]);
  assert.ok(s.changes >= 2, 'every state change asks for a render');
});

test('confirm without ask makes no call', async () => {
  const c = build();
  await c.confirm();
  assert.deepEqual([c.state(), s.calls], ['closed', []]);
});

test('ask then confirm makes one call with the id and calls onDone once', async () => {
  const c = build();
  c.ask('r-1');
  await c.confirm();
  assert.deepEqual([c.state(), s.calls, s.done, c.error()], ['closed', ['r-1'], 1, null]);
});

test('a second confirm while the first runs makes no second call', async () => {
  let release!: () => void;
  s.gate = new Promise<void>((r) => { release = r; });
  const c = build();
  c.ask('r-1');
  const first = c.confirm();
  assert.equal(c.state(), 'discarding');
  const second = c.confirm();
  c.cancel();
  c.ask('r-2');
  await settle();
  release();
  await Promise.all([first, second]);
  assert.deepEqual([s.calls, s.done, c.state()], [['r-1'], 1, 'closed']);
});

test('a ThreadsClientError rejection exposes its text, any other the discard-failed string; onDone is not called', async () => {
  const c = build();
  s.error = new ThreadsClientError('forbidden', 'not your review');
  c.ask('r-1');
  await c.confirm();
  assert.deepEqual([c.error(), c.state(), s.done], ['not your review', 'closed', 0]);
  s.error = new Error('socket closed');
  c.ask('r-1');
  await c.confirm();
  assert.deepEqual([c.error(), s.done], ['t:discardFailed', 0]);
  s.error = null;
  c.ask('r-1');
  assert.equal(c.error(), null, 'asking again clears the last error');
});
