import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileHref, isHttpUrl } from '../src/shared/profile-link.ts';
import type { AuthorsMap } from '../src/types.ts';

const PATTERN = 'https://github.com/{id}';
const authors: AuthorsMap = {
  plain: { name: 'Plain', avatarUrl: '' },
  off: { name: 'Off', avatarUrl: '', link: false },
  custom: { name: 'Custom', avatarUrl: '', link: 'https://example.org/~custom' },
  evil: { name: 'Evil', avatarUrl: '', link: 'javascript:alert(1)' },
  data: { name: 'Data', avatarUrl: '', link: 'data:text/html,x' },
  garbage: { name: 'Garbage', avatarUrl: '', link: 'not a url' },
  empty: { name: 'Empty', avatarUrl: '', link: '' },
};

test('profileHref: no key gives no link, with or without a pattern', () => {
  assert.equal(profileHref(null, authors, PATTERN), null);
  assert.equal(profileHref(null, {}, null), null);
});

test('profileHref: link false turns linking off even when the site has a pattern', () => {
  assert.equal(profileHref('off', authors, PATTERN), null);
});

test('profileHref: a custom http(s) link wins over the pattern, and works with no pattern', () => {
  assert.equal(profileHref('custom', authors, PATTERN), 'https://example.org/~custom');
  assert.equal(profileHref('custom', authors, null), 'https://example.org/~custom');
});

test('profileHref: a javascript:, data: or malformed link is never returned; the pattern (or nothing) is used instead', () => {
  for (const key of ['evil', 'data', 'garbage', 'empty']) {
    assert.equal(profileHref(key, authors, PATTERN), `https://github.com/${key}`, key);
    assert.equal(profileHref(key, authors, null), null, key);
  }
});

test('profileHref: the pattern is filled with the key, encoded', () => {
  assert.equal(profileHref('plain', authors, PATTERN), 'https://github.com/plain');
  assert.equal(profileHref('unknown-key', authors, PATTERN), 'https://github.com/unknown-key', 'a key with no authors entry still links by pattern');
  assert.equal(profileHref('a/b?c#d', {}, PATTERN), 'https://github.com/a%2Fb%3Fc%23d');
  assert.equal(profileHref('ünï', {}, PATTERN), 'https://github.com/%C3%BCn%C3%AF');
  assert.equal(profileHref('k', {}, 'https://x.io/{id}/and/{id}'), 'https://x.io/k/and/k', 'every {id} is filled');
});

test('profileHref: a key that already carries %20 is not encoded twice', () => {
  assert.equal(profileHref('Ann%20Lee', {}, PATTERN), 'https://github.com/Ann%20Lee');
  assert.equal(profileHref('Ann Lee', {}, PATTERN), 'https://github.com/Ann%20Lee', 'the raw and the encoded key agree');
  assert.equal(profileHref('a%2Fb', {}, PATTERN), 'https://github.com/a%2Fb');
  assert.equal(profileHref('100%', {}, PATTERN), 'https://github.com/100%25', 'a stray % is encoded as it is');
});

test('profileHref: no pattern and no custom link is no link', () => {
  assert.equal(profileHref('plain', authors, null), null);
  assert.equal(profileHref('plain', {}, null), null);
});

test('profileHref: object-prototype names are not authors entries', () => {
  assert.equal(profileHref('constructor', {}, PATTERN), 'https://github.com/constructor');
  assert.equal(profileHref('__proto__', {}, null), null);
});

test('isHttpUrl: only absolute http and https', () => {
  assert.equal(isHttpUrl('https://a.b/c'), true);
  assert.equal(isHttpUrl('http://a.b'), true);
  for (const bad of ['javascript:alert(1)', 'data:text/plain,x', 'ftp://a.b', '//a.b', '/x', 'a.b', '', 'mailto:a@b.c']) assert.equal(isHttpUrl(bad), false, bad);
});
