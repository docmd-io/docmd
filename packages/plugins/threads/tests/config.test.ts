import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions } from '../src/plugin/config.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

const DEFAULTS = { sidebar: false, autoPublish: { seconds: 180, startOn: true }, permissions: { admins: [], resolve: 'anyone' } };

test('absent, true and empty options all normalise to the defaults', () => {
  for (const raw of [{}, undefined, true]) {
    assert.deepEqual(normalizeOptions(raw), DEFAULTS, String(raw));
  }
});

test('valid values are kept', () => {
  assert.deepEqual(normalizeOptions({ sidebar: true }), { ...DEFAULTS, sidebar: true });
  assert.deepEqual(normalizeOptions({ autoPublish: false }), { ...DEFAULTS, autoPublish: false });
  assert.deepEqual(normalizeOptions({ autoPublish: { seconds: 60, startOn: false } }).autoPublish, { seconds: 60, startOn: false });
  assert.deepEqual(normalizeOptions({ autoPublish: { seconds: 0.5 } }).autoPublish, { seconds: 0.5, startOn: true });
  assert.deepEqual(normalizeOptions({ autoPublish: { startOn: false } }).autoPublish, { seconds: 180, startOn: false });
  assert.deepEqual(
    normalizeOptions({ permissions: { admins: ['a@x'], resolve: 'author' } }).permissions,
    { admins: ['a@x'], resolve: 'author' },
  );
  assert.deepEqual(normalizeOptions({ permissions: { admins: ['a@x'] } }).permissions, { admins: ['a@x'], resolve: 'anyone' });
  assert.deepEqual(normalizeOptions({ permissions: { resolve: 'author' } }).permissions, { admins: [], resolve: 'author' });
});

test('the identity header option is not read: the plugin trusts the core identity only', () => {
  assert.equal(Object.hasOwn(normalizeOptions({ identityHeader: 'X-A' }), 'identityHeader'), false);
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
    [{ permissions: 'all' }, /plugins\.threads\.permissions must be an object/],
    [{ permissions: [] }, /plugins\.threads\.permissions must be an object/],
    [{ permissions: { admins: 'a@x' } }, /plugins\.threads\.permissions\.admins must be an array of strings/],
    [{ permissions: { admins: ['a@x', 3] } }, /plugins\.threads\.permissions\.admins must be an array of strings/],
    [{ permissions: { resolve: 'nobody' } }, /plugins\.threads\.permissions\.resolve must be 'anyone' or 'author'/],
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
