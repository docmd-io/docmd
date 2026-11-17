import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safePath } from '@docmd/utils';
import { createPublishController } from '../src/client/lib/publish-controller.ts';
import { createPublishTimer } from '../src/client/lib/mode.ts';
import { ThreadsClientError } from '../src/client/lib/api.ts';
import type { DraftMode, Journal, PublishResult, WhoAmI } from '../src/types.ts';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN: Record<string, string> = JSON.parse(fs.readFileSync(safePath(pluginRoot, 'i18n/en.json'), 'utf8'));
const T0 = 1_000_000;
const SECONDS = 60;

const journal = (ops: number, mode: DraftMode = 'collect', updatedAt = new Date(T0).toISOString()): Journal => ({
  version: 1,
  mode,
  review: { id: 'r-1', updatedAt },
  ops: Array.from({ length: ops }, (_, i) => ({ kind: 'delete-thread', opId: `o-${i}`, at: updatedAt, file: 'a.md', threadId: 't-1' })),
});

// Fakes, built once; `beforeEach` resets what a test steers.
const s = {
  journal: null as Journal | null,
  whoamiError: null as unknown,
  setModeError: null as unknown,
  publishError: null as unknown,
  skipped: 0,
  gate: null as Promise<void> | null,
  whoamiGates: [] as Array<Promise<void> | null>,
  setModeGate: null as Promise<void> | null,
  calls: [] as string[],
};
const api = {
  async whoami(): Promise<WhoAmI> {
    s.calls.push('whoami');
    const answer = { journal: s.journal };
    const gate = s.whoamiGates.shift();
    if (gate) await gate;
    if (s.whoamiError) throw s.whoamiError;
    return answer;
  },
  async setMode(mode: DraftMode): Promise<Journal> {
    s.calls.push(`setMode:${mode}`);
    if (s.setModeGate) await s.setModeGate;
    if (s.setModeError) throw s.setModeError;
    s.journal = { ...(s.journal as Journal), mode };
    return s.journal;
  },
  async publishReview(): Promise<PublishResult> {
    s.calls.push('publishReview');
    if (s.gate) await s.gate;
    if (s.publishError) throw s.publishError;
    s.journal = journal(0, s.journal?.mode);
    return { reviewId: 'r-1', skipped: Array.from({ length: s.skipped }, (_, i) => ({ opId: `o-${i}`, reason: 'gone' })) };
  },
};

/** A stub clock and a manual scheduler: nothing waits on real time. */
let clock = T0;
const scheduled = new Map<number, { cb: () => void; at: number }>();
let nextId = 0;
const advance = (ms: number) => {
  clock += ms;
  for (const [id, p] of [...scheduled]) if (p.at <= clock) { scheduled.delete(id); p.cb(); }
};
const settle = () => new Promise<void>((r) => setImmediate(r));

function build(autoPublish = true) {
  const timer = autoPublish
    ? createPublishTimer({
        seconds: SECONDS,
        now: () => clock,
        schedule: (cb, ms) => {
          const id = nextId++;
          scheduled.set(id, { cb, at: clock + ms });
          return () => void scheduled.delete(id);
        },
      })
    : null;
  let changes = 0;
  const c = createPublishController({ api, timer, t: (k) => EN[k] ?? k, onChange: () => void changes++ });
  return { c, changes: () => changes };
}

beforeEach(() => {
  Object.assign(s, { journal: null, whoamiError: null, setModeError: null, publishError: null, skipped: 0, gate: null, whoamiGates: [], setModeGate: null, calls: [] });
  clock = T0;
  scheduled.clear();
});

test('refresh: the count is the ops of the latest whoami; no journal is 0', async () => {
  const { c, changes } = build();
  assert.equal(c.view().state.label, '…', 'unknown before the first answer');
  s.journal = journal(3);
  await c.refresh();
  assert.equal(c.view().state.label, '3 unpublished comments');
  assert.equal(c.view().state.publishDisabled, false);
  s.journal = journal(1);
  await c.refresh();
  assert.equal(c.view().state.label, '1 unpublished comment');
  s.journal = null;
  await c.refresh();
  assert.deepEqual([c.view().state.label, c.view().state.publishDisabled, c.view().state.errorLine], ['0 unpublished comments', true, null]);
  assert.ok(changes() >= 3, 'every refresh asks for a render');
});

test('refresh: a rejected whoami shows …, disables Publish and shows the error text or the load-failed line', async () => {
  const { c } = build();
  s.journal = journal(2);
  await c.refresh();
  s.whoamiError = new ThreadsClientError('invalid', 'caller identity is required');
  await c.refresh();
  assert.deepEqual(
    [c.view().state.label, c.view().state.publishDisabled, c.view().state.errorLine],
    ['…', true, 'caller identity is required'],
  );
  s.whoamiError = new Error('socket closed');
  await c.refresh();
  assert.equal(c.view().state.errorLine, EN.loadFailed);
  s.whoamiError = null;
  await c.refresh();
  assert.deepEqual([c.view().state.label, c.view().state.errorLine], ['2 unpublished comments', null], 'a good answer clears the error');
});

test('play/pause: auto calls setMode(collect) and collect calls setMode(auto), taking the mode from the journal returned', async () => {
  const { c } = build();
  s.journal = journal(1, 'auto');
  await c.refresh();
  assert.equal(c.view().state.playPauseAction, 'pause');
  await c.toggleMode();
  assert.deepEqual(s.calls.slice(-1), ['setMode:collect']);
  assert.deepEqual([c.view().mode, c.view().state.playPauseAction], ['collect', 'play']);
  await c.toggleMode();
  assert.deepEqual(s.calls.slice(-1), ['setMode:auto']);
  assert.equal(c.view().mode, 'auto');
});

test('play/pause: a rejection shows the error text or the mode-failed line and keeps the mode', async () => {
  const { c } = build();
  s.journal = journal(1, 'auto');
  await c.refresh();
  s.setModeError = new ThreadsClientError('no-identity', 'no trusted identity');
  await c.toggleMode();
  assert.deepEqual([c.view().mode, c.view().state.errorLine], ['auto', 'no trusted identity']);
  s.setModeError = new Error('socket closed');
  await c.toggleMode();
  assert.deepEqual([c.view().mode, c.view().state.errorLine], ['auto', EN.modeFailed]);
});

test('refresh: an older whoami resolving or rejecting after a newer one does not touch the newer state', async () => {
  for (const rejects of [false, true]) {
    const { c } = build();
    let open!: () => void;
    s.whoamiError = null;
    s.journal = journal(3);
    s.whoamiGates = [new Promise<void>((r) => (open = r))];
    const slow = c.refresh();
    s.journal = journal(0);
    await c.refresh();
    if (rejects) s.whoamiError = new ThreadsClientError('invalid', 'late failure');
    open();
    await slow;
    assert.deepEqual([c.view().state.label, c.view().state.errorLine], ['0 unpublished comments', null], rejects ? 'rejection' : 'answer');
  }
});

test('play/pause: a second click while setMode is in flight sends nothing', async () => {
  const { c } = build();
  s.journal = journal(1, 'auto');
  await c.refresh();
  let open!: () => void;
  s.setModeGate = new Promise<void>((r) => (open = r));
  const first = c.toggleMode();
  await c.toggleMode();
  open();
  await first;
  assert.equal(s.calls.filter((x) => x.startsWith('setMode')).length, 1);
  s.setModeGate = null;
  await c.toggleMode();
  assert.equal(s.calls.filter((x) => x.startsWith('setMode')).length, 2, 'a later click works again');
});

test('Publish calls publishReview then whoami, and the label becomes 0', async () => {
  const { c } = build();
  s.journal = journal(2);
  await c.refresh();
  s.calls.length = 0;
  await c.publish();
  assert.deepEqual(s.calls, ['publishReview', 'whoami']);
  assert.deepEqual([c.view().state.label, c.view().state.publishDisabled, c.view().state.errorLine], ['0 unpublished comments', true, null]);
});

test('Publish shows how many ops were skipped, singular and plural', async () => {
  const { c } = build();
  for (const [n, line] of [[1, EN.skippedOpsOne], [3, EN.skippedOps]] as const) {
    s.journal = journal(2);
    s.skipped = n;
    await c.refresh();
    await c.publish();
    assert.equal(c.view().state.errorLine, line.replace('{n}', String(n)));
  }
});

test('Publish rejection shows the error text or the publish-failed line and keeps the count', async () => {
  const { c } = build();
  s.journal = journal(2);
  await c.refresh();
  s.publishError = new ThreadsClientError('invalid', 'author key cannot be written');
  await c.publish();
  assert.deepEqual([c.view().state.errorLine, c.view().state.label], ['author key cannot be written', '2 unpublished comments']);
  s.publishError = new Error('socket closed');
  await c.publish();
  assert.deepEqual([c.view().state.errorLine, c.view().state.label], [EN.publishFailed, '2 unpublished comments']);
  assert.equal(c.view().state.publishDisabled, false, 'Publish can be retried');
});

test('a second Publish while one runs makes no second call, and Publish with nothing pending makes none', async () => {
  const { c } = build();
  s.journal = journal(2);
  await c.refresh();
  let open!: () => void;
  s.gate = new Promise<void>((r) => (open = r));
  const first = c.publish();
  assert.equal(c.view().state.variant, 'publishing');
  await c.publish();
  open();
  await first;
  assert.equal(s.calls.filter((x) => x === 'publishReview').length, 1);
  s.calls.length = 0;
  await c.publish();
  assert.deepEqual(s.calls, [], 'a journal with no ops is not published');
});

test('auto: the timer fire publishes once; collect never does', async () => {
  const { c } = build();
  s.journal = journal(1, 'auto');
  await c.refresh();
  assert.notEqual(c.view().ring, null, 'a countdown is running');
  advance(SECONDS * 1000 - 1);
  assert.equal(s.calls.includes('publishReview'), false);
  advance(1);
  await settle();
  assert.equal(s.calls.filter((x) => x === 'publishReview').length, 1);
  assert.equal(c.view().ring, null, 'the ring goes when the timer fires');

  s.journal = journal(1, 'collect');
  await c.refresh();
  assert.equal(c.view().ring, null);
  advance(SECONDS * 5000);
  await settle();
  assert.equal(s.calls.filter((x) => x === 'publishReview').length, 1, 'collect mode never auto-publishes');
});

test('auto: a failed auto publish shows its error, drops the ring and does not retry until the journal changes', async () => {
  const { c } = build();
  s.journal = journal(1, 'auto');
  await c.refresh();
  s.publishError = new ThreadsClientError('invalid', 'author key cannot be written');
  advance(SECONDS * 1000);
  await settle();
  assert.deepEqual([c.view().state.errorLine, c.view().ring], ['author key cannot be written', null]);
  advance(SECONDS * 10_000);
  await settle();
  assert.equal(s.calls.filter((x) => x === 'publishReview').length, 1);
  s.journal = journal(2, 'auto', new Date(clock).toISOString());
  await c.refresh();
  advance(SECONDS * 1000);
  await settle();
  assert.equal(s.calls.filter((x) => x === 'publishReview').length, 2, 'a new edit arms the timer again');
});

test('collect-only (no autoPublish): no play/pause, no timer, Publish works', async () => {
  const { c } = build(false);
  s.journal = journal(1, 'auto');
  await c.refresh();
  assert.deepEqual([c.view().state.variant, c.view().state.showPlayPause, c.view().ring], ['collect-only', false, null]);
  await c.publish();
  assert.deepEqual(s.calls.slice(0, 2), ['whoami', 'publishReview']);
});
