import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublishTimer, widgetState } from '../src/client/lib/mode.ts';

const base = { autoPublish: true, mode: 'collect', pendingCount: 0, publishing: false, armed: true, error: null } as const;

test('widgetState: autoPublish false is collect-only with no play/pause, Publish enabled', () => {
  const s = widgetState({ ...base, autoPublish: false, mode: 'auto', pendingCount: 2 });
  assert.equal(s.variant, 'collect-only');
  assert.equal(s.showPlayPause, false);
  assert.equal(s.publishDisabled, false);
  assert.equal(s.ringRunning, false);
});

test('widgetState: auto with pending runs the ring; without pending it does not and Publish is disabled', () => {
  const on = widgetState({ ...base, mode: 'auto', pendingCount: 3 });
  assert.deepEqual([on.variant, on.showPlayPause, on.ringRunning, on.publishDisabled], ['auto', true, true, false]);
  assert.equal(on.label, '3 unpublished comments');
  const off = widgetState({ ...base, mode: 'auto', pendingCount: 0 });
  assert.deepEqual([off.ringRunning, off.publishDisabled, off.label], [false, true, '0 unpublished comments']);
});

test('widgetState: auto with pending but no scheduled fire (a failed auto publish) shows no ring', () => {
  assert.equal(widgetState({ ...base, mode: 'auto', pendingCount: 1, armed: false }).ringRunning, false);
});

test('widgetState: collect mode shows play/pause but never runs the ring', () => {
  const s = widgetState({ ...base, mode: 'collect', pendingCount: 1 });
  assert.deepEqual([s.variant, s.showPlayPause, s.ringRunning, s.publishDisabled], ['collect', true, false, false]);
  assert.equal(s.label, '1 unpublished comment');
});

test('widgetState: publishing disables Publish and stops the ring', () => {
  const s = widgetState({ ...base, mode: 'auto', pendingCount: 2, publishing: true });
  assert.deepEqual([s.variant, s.publishDisabled, s.ringRunning], ['publishing', true, false]);
});

test('widgetState: an unknown count shows … and Publish is disabled', () => {
  const s = widgetState({ ...base, mode: 'auto', pendingCount: null });
  assert.deepEqual([s.label, s.publishDisabled, s.ringRunning], ['…', true, false]);
});

test('widgetState: errorLine echoes the error and playPauseAction is the opposite of the mode', () => {
  assert.equal(widgetState({ ...base, error: 'boom' }).errorLine, 'boom');
  assert.equal(widgetState({ ...base }).errorLine, null);
  assert.equal(widgetState({ ...base, mode: 'auto' }).playPauseAction, 'pause');
  assert.equal(widgetState({ ...base, mode: 'collect' }).playPauseAction, 'play');
});

/** A fake clock and a manual scheduler: nothing here waits on real time. */
function rig(seconds = 60) {
  let clock = 1_000_000;
  const pending = new Map<number, { cb: () => void; at: number }>();
  let next = 0;
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
  const advance = (ms: number) => {
    clock += ms;
    for (const [id, p] of [...pending]) if (p.at <= clock) { pending.delete(id); p.cb(); }
  };
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
