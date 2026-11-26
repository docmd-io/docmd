import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { identityFromWhoami, resolveIdentity, showContext } from '../src/client/lib/identity-mode.ts';
import { canShow, deleteCommentTarget } from '../src/client/lib/can-show.ts';
import { rows, who } from './fixtures/permissions-table.ts';

test('identityFromWhoami: header, payload, none', () => {
  const header = who('alice', { name: 'Alice', avatarUrl: 'a.png', isAdmin: true });
  assert.deepEqual(identityFromWhoami({ identity: header }), {
    mode: 'header', payload: { author: 'Alice', authorKey: 'alice', avatarUrl: 'a.png' }, isAdmin: true,
  });
  assert.deepEqual(identityFromWhoami({ identity: who('dev', { source: 'payload' }) }), { mode: 'local' });
  assert.deepEqual(identityFromWhoami({ identity: null }), { mode: 'local' });
  assert.deepEqual(identityFromWhoami(undefined), { mode: 'local' });
  assert.deepEqual(identityFromWhoami(null), { mode: 'local' });
});

test('canShow matches the server decision table', () => {
  for (const [label, caller, action, target, resolve, allowed] of rows) {
    // Only the actions the live UI renders a button for; edits and profile writes are server-only here.
    if (action !== 'delete-comment' && action !== 'delete-thread' && action !== 'resolve-thread' && action !== 'discard-review') continue;
    const shown = canShow(action, { callerKey: caller.key, isAdmin: caller.isAdmin, source: caller.source, resolveRule: resolve }, target);
    assert.equal(shown, allowed, label);
  }
});

test('resolveIdentity: a rejected whoami (no live server) is local mode', async () => {
  assert.deepEqual(await resolveIdentity(() => Promise.reject(new Error('offline'))), { mode: 'local' });
  assert.deepEqual(await resolveIdentity(() => new Promise(() => {}), 0), { mode: 'local' }, 'no answer in time');
  const header = who('alice', { name: 'Alice' });
  assert.equal((await resolveIdentity(() => Promise.resolve({ identity: header }))).mode, 'header');
});

test('showContext maps identity and injected config onto canShow', () => {
  const alice = identityFromWhoami({ identity: who('alice') });
  const root = identityFromWhoami({ identity: who('root', { isAdmin: true }) });
  const local = { mode: 'local' } as const;
  assert.deepEqual(showContext(root, { permissions: { resolve: 'author' } }, 'ignored'),
    { callerKey: 'root', isAdmin: true, source: 'header', resolveRule: 'author' });
  assert.deepEqual(showContext(alice, { permissions: { resolve: 'anyone' } }, null),
    { callerKey: 'alice', isAdmin: false, source: 'header', resolveRule: 'anyone' });
  assert.deepEqual(showContext(local, { permissions: { resolve: 'author' } }, 'me'),
    { callerKey: 'me', isAdmin: false, source: 'payload', resolveRule: 'author' });
  for (const cfg of [undefined, null, {}, { permissions: {} }, { permissions: { resolve: 'admins' } }, 'x']) {
    assert.equal(showContext(alice, cfg, null).resolveRule, 'anyone');
  }
});

test('deleteCommentTarget: an opener with replies is admin only, like the server', () => {
  const c = (id: string, authorKey: string, draft?: true) => ({ id, authorKey, draft });
  assert.deepEqual(deleteCommentTarget([c('1', 'a'), c('2', 'b')], '1'), { authorKey: null, drafted: false });
  assert.deepEqual(deleteCommentTarget([c('1', 'a'), c('2', 'b')], '2'), { authorKey: 'b', drafted: false });
  assert.deepEqual(deleteCommentTarget([c('1', 'a')], '1'), { authorKey: 'a', drafted: false });
  assert.deepEqual(deleteCommentTarget([c('1', 'a')], 'nope'), { authorKey: null });
  assert.deepEqual(deleteCommentTarget([c('1', 'a'), c('2', 'a', true)], '1'), { authorKey: 'a', drafted: false });
  assert.deepEqual(deleteCommentTarget([c('1', 'a'), c('2', 'b', true)], '2'), { authorKey: 'b', drafted: true });
});

// ---------------------------------------------------------------------------
// The module identity: initIdentity, ensureAuthor, getIdentityPayload, canShowFor
// ---------------------------------------------------------------------------

const storage = new Map<string, string>();
let prompts = 0;
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const win: Record<string, unknown> = {};
const STUBS: Record<string, unknown> = {
  window: win,
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
  prompt: () => { prompts++; return 'Prompted'; },
};
type Identity = typeof import('../src/client/lib/identity.ts');
let identity: Identity;

before(async () => {
  for (const [k, v] of Object.entries(STUBS)) {
    saved[k] = Object.getOwnPropertyDescriptor(g, k);
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  }
  identity = await import('../src/client/lib/identity.ts');
});
after(() => {
  for (const k of Object.keys(STUBS)) {
    const d = saved[k] as PropertyDescriptor | undefined;
    if (d) Object.defineProperty(g, k, d);
    else delete g[k];
  }
});
beforeEach(() => {
  storage.clear();
  prompts = 0;
  for (const k of Object.keys(win)) delete win[k];
});

const header = (key = 'ann@x', over = {}) => () => Promise.resolve({ identity: who(key, { name: 'Ann', avatarUrl: 'u', ...over }) });

test('header mode: the server identity is returned, nobody is prompted, __docmd_dev is not stored', async () => {
  win.__docmd_dev = { name: 'Dev', email: 'd@x', gravatarUrl: 'g' };
  await identity.initIdentity(header());
  assert.equal(identity.ensureAuthor(), 'Ann');
  assert.deepEqual(identity.getIdentityPayload(), { author: 'Ann', authorKey: 'ann@x', avatarUrl: 'u' });
  assert.equal(prompts, 0);
  assert.equal(storage.size, 0);
  identity.setHeaderProfile('Bo', 'v');
  assert.deepEqual(identity.getIdentityPayload(), { author: 'Bo', authorKey: 'ann@x', avatarUrl: 'v' });
});

test('local mode: whoami with no identity, or rejecting, seeds from __docmd_dev and prompts when nothing is stored', async () => {
  for (const whoami of [() => Promise.resolve({ identity: null }), () => Promise.reject(new Error('offline'))]) {
    storage.clear();
    prompts = 0;
    win.__docmd_dev = { name: 'Dev', email: 'd@x', gravatarUrl: 'g' };
    await identity.initIdentity(whoami);
    assert.equal(prompts, 0, 'initIdentity never prompts');
    assert.equal(identity.ensureAuthor(), 'Dev');
    assert.equal(storage.get('threads_email'), 'd@x');
    storage.clear();
    delete win.__docmd_dev;
    assert.equal(identity.ensureAuthor(), 'Prompted');
    assert.equal(prompts, 1);
  }
});

test('setHeaderProfile leaves local mode alone', async () => {
  await identity.initIdentity(() => Promise.resolve({ identity: null }));
  identity.setHeaderProfile('Bo', 'v');
  assert.deepEqual(identity.getIdentityMode(), { mode: 'local' });
});

test('canShowFor: header mode follows permissions.resolve, local mode shows everything', async () => {
  win.__threads_config = { permissions: { resolve: 'author' } };
  await identity.initIdentity(header('ann'));
  assert.equal(identity.canShowFor('resolve-thread', { threadAuthor: 'bob' }), false);
  assert.equal(identity.canShowFor('resolve-thread', { threadAuthor: 'ann' }), true);
  await identity.initIdentity(() => Promise.resolve({ identity: null }));
  assert.equal(identity.canShowFor('resolve-thread', { threadAuthor: 'bob' }), true);
  assert.equal(identity.canShowFor('delete-comment', { authorKey: 'bob' }), true);
});
