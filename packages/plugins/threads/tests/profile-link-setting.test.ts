import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLinkAvailable, choiceFromLink, linkFromChoice, LINK_MAX } from '../src/client/lib/profile-link-setting.ts';

test('choiceFromLink: absent is automatic when the site has a pattern, else no link', () => {
  assert.equal(choiceFromLink(undefined, true), 'auto');
  assert.equal(choiceFromLink(undefined, false), 'none');
});

test('choiceFromLink: false is no link and a string is custom, whatever the site offers', () => {
  for (const auto of [true, false]) {
    assert.equal(choiceFromLink(false, auto), 'none');
    assert.equal(choiceFromLink('https://a.b/c', auto), 'custom');
  }
});

test('linkFromChoice: automatic sends null, no link sends false', () => {
  assert.deepEqual(linkFromChoice('auto', '', true), { ok: true, value: null });
  assert.deepEqual(linkFromChoice('none', 'https://ignored.example', true), { ok: true, value: false });
});

test('linkFromChoice: automatic that is not offered falls back to no link', () => {
  assert.deepEqual(linkFromChoice('auto', '', false), { ok: true, value: false });
});

test('linkFromChoice: a custom http(s) link is sent trimmed', () => {
  assert.deepEqual(linkFromChoice('custom', '  https://example.org/~me  ', true), { ok: true, value: 'https://example.org/~me' });
  assert.deepEqual(linkFromChoice('custom', 'http://example.org', false), { ok: true, value: 'http://example.org' });
});

test('linkFromChoice: other schemes, relative, empty and over-long links are refused', () => {
  for (const bad of ['', '   ', 'javascript:alert(1)', 'data:text/html,x', 'ftp://a.b', '//a.b', '/me', 'example.org', 'not a url', 'mailto:a@b.c']) {
    assert.deepEqual(linkFromChoice('custom', bad, true), { ok: false }, JSON.stringify(bad));
  }
  const long = 'https://a.b/' + 'x'.repeat(LINK_MAX);
  assert.deepEqual(linkFromChoice('custom', long, true), { ok: false });
  const exact = 'https://a.b/' + 'x'.repeat(LINK_MAX - 'https://a.b/'.length);
  assert.equal(exact.length, LINK_MAX);
  assert.deepEqual(linkFromChoice('custom', exact, true), { ok: true, value: exact });
});

test('autoLinkAvailable: offered whenever the site sets a pattern, in any identity mode', () => {
  assert.equal(autoLinkAvailable('https://github.com/{id}'), true);
  for (const none of ['', undefined, null, 5, {}]) assert.equal(autoLinkAvailable(none), false);
});
