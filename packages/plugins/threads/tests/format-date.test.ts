import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime } from '../src/client/lib/format-date.ts';

/** Run `fn` with the process in another time zone (Node re-reads TZ when it is set). */
function inZone<T>(zone: string, fn: () => T): T {
  const saved = process.env['TZ'];
  process.env['TZ'] = zone;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env['TZ'];
    else process.env['TZ'] = saved;
  }
}

test('a stored date is written the way the page language writes it', () => {
  assert.equal(formatDateTime('2026-03-05', 'en'), 'Mar 5, 2026');
  assert.equal(formatDateTime('2026-11-26', 'de'), '26. Nov. 2026');
  assert.match(formatDateTime('2026-03-05', 'es'), /^5 mar 2026$/);
  assert.match(formatDateTime('2026-03-05', 'ko'), /2026/);
});

test('a date-only value is the same day in every time zone', () => {
  for (const zone of ['Pacific/Honolulu', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
    assert.equal(inZone(zone, () => formatDateTime('2026-03-05', 'en')), 'Mar 5, 2026', zone);
  }
});

test('a value with a time shows the time too, in the reader time zone', () => {
  assert.equal(inZone('UTC', () => formatDateTime('2026-11-19T10:00:00Z', 'en')), 'Nov 19, 2026, 10:00 AM');
  assert.equal(inZone('Asia/Kolkata', () => formatDateTime('2026-11-19T10:00:00Z', 'en')), 'Nov 19, 2026, 3:30 PM');
  assert.match(inZone('UTC', () => formatDateTime('2026-11-19T15:45:00Z', 'de')), /^19\. Nov\. 2026,? 15:45$/);
});

test('a value that is not a date comes back as written; an empty one is empty', () => {
  assert.equal(formatDateTime('yesterday', 'en'), 'yesterday');
  assert.equal(formatDateTime('  2026-13-45 ', 'en'), '2026-13-45');
  assert.equal(formatDateTime('', 'en'), '');
  assert.equal(formatDateTime('   ', 'en'), '');
  assert.equal(formatDateTime(undefined as unknown as string, 'en'), '');
});

test('an unknown language falls back to the browser default instead of throwing', () => {
  assert.doesNotThrow(() => formatDateTime('2026-03-05', 'not a language'));
  assert.match(formatDateTime('2026-03-05', 'not a language'), /2026/);
});

test('the page language is the default', () => {
  const g = globalThis as Record<string, unknown>;
  const had = 'document' in g;
  const saved = g['document'];
  g['document'] = { documentElement: { lang: 'de' } };
  try {
    assert.equal(formatDateTime('2026-11-26'), '26. Nov. 2026');
  } finally {
    if (had) g['document'] = saved;
    else delete g['document'];
  }
});
