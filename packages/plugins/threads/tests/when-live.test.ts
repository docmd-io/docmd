import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whenLive } from '../src/client/lib/when-live.ts';

const TICK = 250;
const MAX = 30_000;

test('whenLive: fires once when live arrives later, and stops polling', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let live = false;
  let n = 0;
  let calls = 0;
  whenLive(() => { calls++; return live; }, () => n++);
  t.mock.timers.tick(TICK * 3);
  assert.equal(n, 0);
  live = true;
  t.mock.timers.tick(TICK);
  assert.equal(n, 1);
  const after = calls;
  t.mock.timers.tick(TICK * 20);
  assert.equal(n, 1);
  assert.equal(calls, after, 'polling stopped');
});

test('whenLive: never live gives up after the bound and reports it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let n = 0;
  let gaveUp = 0;
  let calls = 0;
  whenLive(() => { calls++; return false; }, () => n++, () => gaveUp++);
  t.mock.timers.tick(MAX);
  const after = calls;
  t.mock.timers.tick(MAX);
  assert.equal(n, 0);
  assert.equal(gaveUp, 1);
  assert.equal(calls, after, 'polling stopped');
});
