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

type Step = 'ask' | 'cancel' | 'confirm';
const CASES: Array<{ name: string; steps: Step[]; rejection?: unknown; expected: { state: string; calls: string[]; done: number; error: string | null; changes?: number } }> = [
  { name: 'ask then cancel: no call, closed, and the later confirm does nothing', steps: ['ask', 'cancel', 'confirm'], expected: { state: 'closed', calls: [], done: 0, error: null, changes: 2 } },
  { name: 'ask then confirm: one call with the id, onDone once', steps: ['ask', 'confirm'], expected: { state: 'closed', calls: ['r-1'], done: 1, error: null } },
  { name: 'a ThreadsClientError rejection shows its text, no onDone', steps: ['ask', 'confirm'], rejection: new ThreadsClientError('forbidden', 'not your review'), expected: { state: 'closed', calls: ['r-1'], done: 0, error: 'not your review' } },
  { name: 'any other rejection shows the discard-failed string, no onDone', steps: ['ask', 'confirm'], rejection: new Error('socket closed'), expected: { state: 'closed', calls: ['r-1'], done: 0, error: 't:discardFailed' } },
  { name: 'asking again after a failure clears the error', steps: ['ask', 'confirm', 'ask'], rejection: new Error('socket closed'), expected: { state: 'confirming', calls: ['r-1'], done: 0, error: null } },
];

for (const c of CASES) {
  test(c.name, async () => {
    s.error = c.rejection ?? null;
    const d = build();
    for (const step of c.steps) {
      if (step === 'ask') d.ask('r-1');
      else if (step === 'cancel') d.cancel();
      else await d.confirm();
    }
    const { changes, ...rest } = c.expected;
    assert.deepEqual({ state: d.state(), calls: s.calls, done: s.done, error: d.error() }, rest);
    if (changes !== undefined) assert.equal(s.changes, changes);
  });
}

test('a second confirm while the first runs makes no second call', async () => {
  let release!: () => void;
  s.gate = new Promise<void>((r) => { release = r; });
  const c = build();
  c.ask('r-1');
  const first = c.confirm();
  assert.equal(c.state(), 'discarding');
  const second = c.confirm();
  c.cancel();
  assert.equal(c.state(), 'discarding', 'cancel is ignored while the call runs');
  c.ask('r-2');
  assert.equal(c.state(), 'discarding', 'ask is ignored while the call runs');
  await settle();
  release();
  await Promise.all([first, second]);
  assert.deepEqual([s.calls, s.done, c.state()], [['r-1'], 1, 'closed']);
});

test('onOpenChange reports open, then closed with the outcome', async () => {
  const seen: Array<[boolean, string]> = [];
  const mk = () => createDiscardController({ api, t, onDone: () => {}, onChange: () => {}, onOpenChange: (o, r) => void seen.push([o, r]) });
  let c = mk();
  c.ask('r-1'); c.cancel();
  c = mk();
  c.ask('r-1'); await c.confirm();
  s.error = new Error('x');
  c = mk();
  c.ask('r-1'); await c.confirm();
  assert.deepEqual(seen, [[true, 'kept'], [false, 'kept'], [true, 'kept'], [false, 'discarded'], [true, 'kept'], [false, 'failed']]);
});
