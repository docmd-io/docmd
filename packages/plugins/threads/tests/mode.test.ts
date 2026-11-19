import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPublishTimer, widgetState, type WidgetState } from '../src/client/lib/mode.ts';

type Input = Parameters<typeof widgetState>[0];
const base: Input = { autoPublish: true, mode: 'collect', pendingCount: 0, publishing: false, armed: true, error: null } as const;

const table: Array<[string, Partial<Input>, Partial<WidgetState>]> = [
  ['collect-only: no play/pause, Publish enabled', { autoPublish: false, mode: 'auto', pendingCount: 2 },
    { variant: 'collect-only', showPlayPause: false, publishDisabled: false, ringRunning: false }],
  ['auto with pending runs the ring', { mode: 'auto', pendingCount: 3 },
    { variant: 'auto', showPlayPause: true, ringRunning: true, publishDisabled: false, label: '3 unpublished comments' }],
  ['auto without pending: no ring, Publish disabled', { mode: 'auto', pendingCount: 0 },
    { ringRunning: false, publishDisabled: true, label: '0 unpublished comments' }],
  ['auto with pending but nothing scheduled (a failed auto publish): no ring', { mode: 'auto', pendingCount: 1, armed: false },
    { ringRunning: false }],
  ['collect: play/pause, never a ring, singular label', { mode: 'collect', pendingCount: 1 },
    { variant: 'collect', showPlayPause: true, ringRunning: false, publishDisabled: false, label: '1 unpublished comment' }],
  ['publishing: Publish disabled, no ring', { mode: 'auto', pendingCount: 2, publishing: true },
    { variant: 'publishing', publishDisabled: true, ringRunning: false }],
  ['unknown count: … and Publish disabled', { mode: 'auto', pendingCount: null },
    { label: '…', publishDisabled: true, ringRunning: false }],
  ['error line echoes the error', { error: 'boom' }, { errorLine: 'boom' }],
  ['no error, no line', {}, { errorLine: null }],
  ['auto offers pause', { mode: 'auto' }, { playPauseAction: 'pause' }],
  ['collect offers play', { mode: 'collect' }, { playPauseAction: 'play' }],
];

test('widgetState table', () => {
  for (const [name, input, expected] of table) {
    const state = widgetState({ ...base, ...input });
    const picked = Object.fromEntries(Object.keys(expected).map((k) => [k, state[k as keyof WidgetState]]));
    assert.deepEqual(picked, expected, name);
  }
});

/** A fake clock and a manual scheduler, built once and reset per test: nothing here waits on real time. */
let clock = 1_000_000;
const pending = new Map<number, { cb: () => void; at: number }>();
let next = 0;
beforeEach(() => {
  clock = 1_000_000;
  pending.clear();
});
const advance = (ms: number) => {
  clock += ms;
  for (const [id, p] of [...pending]) if (p.at <= clock) { pending.delete(id); p.cb(); }
};

/** The system under test: a timer on the shared clock and scheduler. */
function rig(seconds = 60) {
  const timer = createPublishTimer({
    seconds,
    now: () => clock,
    schedule: (cb, ms) => {
      assert.ok(ms >= 0, `scheduled with negative delay ${ms}`);
      const id = next++;
      pending.set(id, { cb, at: clock + ms });
      return () => void pending.delete(id);
    },
  });
  let fired = 0;
  timer.onFire(() => void fired++);
  return { timer, advance, fired: () => fired, pending: () => pending.size, setClock: (n: number) => (clock = n) };
}

const T0 = 1_000_000;

test('timer: fires once at updatedAt + seconds', () => {
  const r = rig();
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  assert.equal(r.timer.remainingMs(), 60_000);
  // The elapsed time the ring offset is derived from.
  assert.equal(r.timer.totalMs() - r.timer.remainingMs()!, 0);
  r.advance(10_000);
  assert.equal(r.timer.totalMs() - r.timer.remainingMs()!, 10_000);
  r.advance(49_999);
  assert.equal(r.fired(), 0);
  r.advance(1);
  assert.equal(r.fired(), 1);
  r.advance(120_000);
  assert.equal(r.fired(), 1);
  assert.equal(r.timer.remainingMs(), null);
});

test('timer: a later updatedAt before firing reschedules', () => {
  const r = rig();
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  r.advance(30_000);
  r.timer.update({ mode: 'auto', updatedAt: T0 + 30_000, pendingCount: 2 });
  assert.equal(r.pending(), 1);
  r.advance(30_000);
  assert.equal(r.fired(), 0);
  r.advance(30_000);
  assert.equal(r.fired(), 1);
});

test('timer: a new timer from the same updatedAt (reload) fires at the same instant', () => {
  const reloaded = rig();
  reloaded.setClock(T0 + 45_000);
  reloaded.timer.update({ mode: 'auto', updatedAt: new Date(T0).toISOString(), pendingCount: 1 });
  assert.equal(reloaded.timer.remainingMs(), 15_000);
  reloaded.advance(15_000);
  assert.equal(reloaded.fired(), 1);
});

test('timer: an updatedAt already past fires immediately', () => {
  const r = rig();
  r.setClock(T0 + 500_000);
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  assert.equal(r.timer.remainingMs(), 0);
  r.advance(0);
  assert.equal(r.fired(), 1);
});

test('timer: never fires in collect mode or with nothing pending, and stop() cancels', () => {
  const r = rig();
  r.timer.update({ mode: 'collect', updatedAt: T0, pendingCount: 2 });
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 0 });
  assert.equal(r.pending(), 0);
  assert.equal(r.timer.remainingMs(), null);
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  r.timer.stop();
  r.advance(120_000);
  assert.equal(r.fired(), 0);
});

test('timer: switching auto → collect cancels the pending fire', () => {
  const r = rig();
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  r.timer.update({ mode: 'collect', updatedAt: T0, pendingCount: 1 });
  r.advance(120_000);
  assert.equal(r.fired(), 0);
});

test('timer: after firing, the same updatedAt does not re-arm (a failed publish does not loop)', () => {
  const r = rig();
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  r.advance(60_000);
  r.timer.update({ mode: 'auto', updatedAt: T0, pendingCount: 1 });
  r.advance(120_000);
  assert.equal(r.fired(), 1);
  r.timer.update({ mode: 'auto', updatedAt: T0 + 70_000, pendingCount: 1 });
  r.advance(120_000);
  assert.equal(r.fired(), 2);
});
