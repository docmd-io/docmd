import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarInitial } from '../src/client/lib/avatar.ts';

test('avatarInitial: first letter, upper-cased', () => {
  assert.equal(avatarInitial('alice'), 'A');
  assert.equal(avatarInitial('Bob Smith'), 'B');
});

test('avatarInitial: trims, keeps whole characters, falls back to ?', () => {
  assert.equal(avatarInitial('  zoe'), 'Z');
  assert.equal(avatarInitial('émile'), 'É');
  assert.equal(avatarInitial('😀 smile'), '😀');
  assert.equal(avatarInitial(''), '?');
  assert.equal(avatarInitial('   '), '?');
});
