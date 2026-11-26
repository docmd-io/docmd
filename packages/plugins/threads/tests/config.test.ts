import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions } from '../src/plugin/config.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

const DEFAULTS = { sidebar: false, autoPublish: { seconds: 180, startOn: true }, permissions: { admins: [], resolve: 'anyone' }, limits: { maxCommentChars: 5000, commentsPerMinute: 10 }, reactions: { emoji: ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'], restricted: false }, profileUrl: null, git: null };

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

test('reactions: defaults, a custom list, restricted, skin-tone and ZWJ sequences, exactly 20', () => {
  const defaults = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];
  assert.deepEqual(normalizeOptions({ reactions: {} }).reactions, { emoji: defaults, restricted: false });
  assert.deepEqual(normalizeOptions({ reactions: { restricted: true } }).reactions, { emoji: defaults, restricted: true });
  assert.deepEqual(normalizeOptions({ reactions: { emoji: ['✅'] } }).reactions, { emoji: ['✅'], restricted: false });
  const rich = ['👍🏽', '👨‍👩‍👧', '🇧🇷', '1️⃣'];
  assert.deepEqual(normalizeOptions({ reactions: { emoji: rich, restricted: true } }).reactions, { emoji: rich, restricted: true });
  const twenty = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x1f600 + i));
  assert.equal(normalizeOptions({ reactions: { emoji: twenty } }).reactions.emoji.length, 20);
  const input = { reactions: { emoji: ['🎉'] } };
  normalizeOptions(input).reactions.emoji.push('x');
  assert.deepEqual(input.reactions.emoji, ['🎉'], 'the result does not alias the input');
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
    [{ reactions: 'all' }, /plugins\.threads\.reactions must be an object/],
    [{ reactions: [] }, /plugins\.threads\.reactions must be an object/],
    [{ reactions: { emoji: [] } }, /plugins\.threads\.reactions\.emoji must be an array of 1 to 20 emoji/],
    [{ reactions: { emoji: '👍' } }, /plugins\.threads\.reactions\.emoji must be an array/],
    [{ reactions: { emoji: Array.from({ length: 21 }, (_, i) => String.fromCodePoint(0x1f600 + i)) } }, /plugins\.threads\.reactions\.emoji must be an array of 1 to 20 emoji/],
    [{ reactions: { emoji: ['👍', 'x'] } }, /plugins\.threads\.reactions\.emoji entry 1 must be a single emoji/],
    [{ reactions: { emoji: ['👍👎'] } }, /plugins\.threads\.reactions\.emoji entry 0 must be a single emoji/],
    [{ reactions: { emoji: ['👍,'] } }, /plugins\.threads\.reactions\.emoji entry 0/],
    [{ reactions: { emoji: [7] } }, /plugins\.threads\.reactions\.emoji entry 0/],
    [{ reactions: { emoji: ['👍', '🎉', '👍'] } }, /plugins\.threads\.reactions\.emoji must not repeat an emoji/],
    [{ reactions: { restricted: 'yes' } }, /plugins\.threads\.reactions\.restricted must be a boolean/],
    [{ profileUrl: 5 }, /plugins\.threads\.profileUrl must be an absolute http or https URL containing \{id\}/],
    [{ profileUrl: '' }, /plugins\.threads\.profileUrl must be an absolute/],
    [{ profileUrl: 'https://github.com/' }, /plugins\.threads\.profileUrl must be an absolute http or https URL containing \{id\}/],
    [{ profileUrl: '/users/{id}' }, /plugins\.threads\.profileUrl must be an absolute/],
    [{ profileUrl: 'users/{id}' }, /plugins\.threads\.profileUrl must be an absolute/],
    [{ profileUrl: 'javascript:alert({id})' }, /plugins\.threads\.profileUrl must be an absolute/],
    [{ profileUrl: 'ftp://host/{id}' }, /plugins\.threads\.profileUrl must be an absolute/],
    [{ profileUrl: 'mailto:{id}@x.io' }, /plugins\.threads\.profileUrl must be an absolute/],
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

test('profileUrl: null by default, null kept, http and https patterns kept as written', () => {
  assert.equal(normalizeOptions({}).profileUrl, null);
  assert.equal(normalizeOptions({ profileUrl: null }).profileUrl, null);
  for (const url of ['https://github.com/{id}', 'http://intranet/u/{id}/profile', 'https://{id}.example.com/', 'https://x.io/?user={id}&a={id}']) {
    assert.equal(normalizeOptions({ profileUrl: url }).profileUrl, url);
  }
});
