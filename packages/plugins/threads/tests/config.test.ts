import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions } from '../src/plugin/config.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

const DEFAULTS = { sidebar: false, autoPublish: { seconds: 180, startOn: true } };

test('absent, true and empty options all normalise to the defaults', () => {
  for (const raw of [{}, undefined, true]) {
    assert.deepEqual(normalizeOptions(raw), DEFAULTS, String(raw));
  }
});

test('valid values are kept', () => {
  assert.deepEqual(normalizeOptions({ sidebar: true }), { ...DEFAULTS, sidebar: true });
  assert.deepEqual(normalizeOptions({ autoPublish: false }), { sidebar: false, autoPublish: false });
  assert.deepEqual(normalizeOptions({ autoPublish: { seconds: 60, startOn: false } }).autoPublish, { seconds: 60, startOn: false });
  assert.deepEqual(normalizeOptions({ autoPublish: { seconds: 0.5 } }).autoPublish, { seconds: 0.5, startOn: true });
  assert.deepEqual(normalizeOptions({ autoPublish: { startOn: false } }).autoPublish, { seconds: 180, startOn: false });
});

test('invalid values throw threads/config', () => {
  const cases: Array<[unknown, RegExp]> = [
    ['nope', /^threads\/config: plugins\.threads must be an object$/],
    [[], /^threads\/config: plugins\.threads must be an object$/],
    [{ sidebar: 'yes' }, /plugins\.threads\.sidebar must be a boolean/],
    [{ autoPublish: true }, /plugins\.threads\.autoPublish must be an object/],
    [{ autoPublish: 'on' }, /plugins\.threads\.autoPublish must be an object/],
    [{ autoPublish: [] }, /plugins\.threads\.autoPublish must be an object/],
    [{ autoPublish: { seconds: 0 } }, /plugins\.threads\.autoPublish\.seconds must be a positive number/],
    [{ autoPublish: { seconds: -5 } }, /plugins\.threads\.autoPublish\.seconds must be a positive number/],
    [{ autoPublish: { seconds: '60' } }, /plugins\.threads\.autoPublish\.seconds must be a positive number/],
    [{ autoPublish: { seconds: Infinity } }, /plugins\.threads\.autoPublish\.seconds must be a positive number/],
    [{ autoPublish: { seconds: NaN } }, /plugins\.threads\.autoPublish\.seconds must be a positive number/],
    [{ autoPublish: { startOn: 'yes' } }, /plugins\.threads\.autoPublish\.startOn must be a boolean/],
  ];
  for (const [raw, naming] of cases) {
    assert.throws(
      () => normalizeOptions(raw),
      (e: unknown) =>
        e instanceof ThreadsError && e.code === 'config' && e.message.startsWith('threads/config:') && naming.test(e.message),
      JSON.stringify(raw),
    );
  }
});
