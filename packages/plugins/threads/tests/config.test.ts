import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions } from '../src/plugin/config.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

const DEFAULTS = { sidebar: false, autoPublish: { seconds: 180, startOn: true }, permissions: { admins: [], resolve: 'anyone' }, limits: { maxCommentChars: 5000, commentsPerMinute: 10 }, git: null };

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
  assert.deepEqual(normalizeOptions({ limits: { maxCommentChars: 10 } }).limits, { maxCommentChars: 10, commentsPerMinute: 10 });
  assert.deepEqual(normalizeOptions({ limits: { commentsPerMinute: 2 } }).limits, { maxCommentChars: 5000, commentsPerMinute: 2 });
});

test('git defaults fill in around the required branch; null is off; explicit values are kept', () => {
  assert.deepEqual(normalizeOptions({ git: { branch: 'main' } }).git, {
    branch: 'main', remote: 'origin', skipDeployMarker: '[skip ci]', pullSeconds: 60, committer: { name: 'docmd threads', email: 'threads@docmd.invalid' },
  });
  assert.equal(normalizeOptions({ git: null }).git, null);
  assert.equal(normalizeOptions({ git: { branch: 'main' } }).git?.authorEmailHeader, undefined, 'the e-mail header is optional');
  assert.equal(normalizeOptions({ git: { branch: 'main', authorEmailHeader: ' X-Auth-Request-Email ' } }).git?.authorEmailHeader, 'X-Auth-Request-Email');
  assert.deepEqual(
    normalizeOptions({ git: { branch: 'docs', remote: 'up', skipDeployMarker: '[ci skip]', pullSeconds: 5, committer: { name: 'Bot', email: 'b@x.io' } } }).git,
    { branch: 'docs', remote: 'up', skipDeployMarker: '[ci skip]', pullSeconds: 5, committer: { name: 'Bot', email: 'b@x.io' } },
  );
  assert.deepEqual(normalizeOptions({ git: { branch: 'main', committer: { name: 'Bot' } } }).git?.committer, { name: 'Bot', email: 'threads@docmd.invalid' });
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
    [{ limits: 'x' }, /plugins\.threads\.limits must be an object/],
    [{ limits: { maxCommentChars: 0 } }, /plugins\.threads\.limits\.maxCommentChars must be a positive integer/],
    [{ limits: { maxCommentChars: -1 } }, /plugins\.threads\.limits\.maxCommentChars/],
    [{ limits: { maxCommentChars: '5' } }, /plugins\.threads\.limits\.maxCommentChars/],
    [{ limits: { commentsPerMinute: 0.5 } }, /plugins\.threads\.limits\.commentsPerMinute must be a positive integer/],
    [{ permissions: 'all' }, /plugins\.threads\.permissions must be an object/],
    [{ permissions: [] }, /plugins\.threads\.permissions must be an object/],
    [{ permissions: { admins: 'a@x' } }, /plugins\.threads\.permissions\.admins must be an array of strings/],
    [{ permissions: { admins: ['a@x', 3] } }, /plugins\.threads\.permissions\.admins must be an array of strings/],
    [{ git: 'main' }, /plugins\.threads\.git must be an object/],
    [{ git: [] }, /plugins\.threads\.git must be an object/],
    [{ git: {} }, /plugins\.threads\.git\.branch must be a non-empty string/],
    [{ git: { branch: '  ' } }, /plugins\.threads\.git\.branch must be a non-empty string/],
    [{ git: { branch: 3 } }, /plugins\.threads\.git\.branch must be a non-empty string/],
    [{ git: { branch: '--force' } }, /plugins\.threads\.git\.branch must not start with "-"/],
    [{ git: { branch: 'm', remote: '--upload-pack=x' } }, /plugins\.threads\.git\.remote must not start with "-"/],
    [{ git: { branch: 'm', remote: '' } }, /plugins\.threads\.git\.remote must be a non-empty string/],
    [{ git: { branch: 'm', skipDeployMarker: ' ' } }, /plugins\.threads\.git\.skipDeployMarker must be a non-empty string/],
    [{ git: { branch: 'm', pullSeconds: 0 } }, /plugins\.threads\.git\.pullSeconds must be a positive number/],
    [{ git: { branch: 'm', pullSeconds: -5 } }, /plugins\.threads\.git\.pullSeconds must be a positive number/],
    [{ git: { branch: 'm', pullSeconds: '30' } }, /plugins\.threads\.git\.pullSeconds must be a positive number/],
    [{ git: { branch: 'm', authorEmailHeader: '' } }, /plugins\.threads\.git\.authorEmailHeader must be a non-empty string/],
    [{ git: { branch: 'm', authorEmailHeader: 7 } }, /plugins\.threads\.git\.authorEmailHeader must be a non-empty string/],
    [{ git: { branch: 'm', authorEmailHeader: 'cookie' } }, /plugins\.threads\.git\.authorEmailHeader must not be cookie or set-cookie/],
    [{ git: { branch: 'm', authorEmailHeader: 'Set-Cookie' } }, /plugins\.threads\.git\.authorEmailHeader must not be cookie or set-cookie/],
    [{ git: { branch: 'm', committer: 'bot' } }, /plugins\.threads\.git\.committer must be an object/],
    [{ git: { branch: 'm', committer: { name: '' } } }, /plugins\.threads\.git\.committer\.name must be a non-empty string/],
    [{ git: { branch: 'm', committer: { email: 7 } } }, /plugins\.threads\.git\.committer\.email must be a non-empty string/],
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
