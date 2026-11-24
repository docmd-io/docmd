import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { findCaller } from '../src/plugin/identity.ts';
import type { Comment, Thread, WhoAmI } from '../src/types.ts';

let project: TempProject;
before(() => {
  project = tempProject();
});
after(() => project.cleanup());
beforeEach(() => {
  project.reset();
  fs.rmSync(path.join(project.root, 'docs', '.threads'), { recursive: true, force: true });
});

const threadsDir = () => path.join(project.root, 'docs', '.threads');
const authorsFile = () => path.join(threadsDir(), 'authors.json');
const writeAuthors = (authors: unknown) => {
  fs.mkdirSync(safePath(project.root, 'docs/.threads'), { recursive: true });
  fs.writeFileSync(safePath(threadsDir(), 'authors.json'), typeof authors === 'string' ? authors : JSON.stringify(authors));
};
const readAuthors = () => JSON.parse(fs.readFileSync(safePath(threadsDir(), 'authors.json'), 'utf8'));
const serve = (identity: string | null, threads: unknown = {}): Partial<TestCtx> =>
  ({ mode: 'serve', caller: { identity }, config: { src: 'docs', plugins: { threads } } });
const dev: Partial<TestCtx> = { mode: 'dev', caller: { identity: null }, config: { src: 'docs' } };
const run = <T = unknown>(name: string, payload: Record<string, unknown>, extra: Partial<TestCtx>) =>
  (actions as Record<string, (p: unknown, c: unknown) => Promise<unknown>>)[`threads:${name}`](payload, makeCtx(project.root, extra)) as Promise<T>;

const anchor = { quote: 'x', prefix: null, suffix: null, selector: null, offset: null, blockText: null };

test('findCaller under serve: key from the identity, name and avatar from authors.json, exact keys', async () => {
  const mallory = { author: 'Mallory', authorKey: 'mallory', avatarUrl: 'x' };
  const who = (identity: string | null, threads: unknown = {}, payload: Record<string, unknown> = mallory) =>
    findCaller(makeCtx(project.root, serve(identity, threads)), payload);

  const bare = { key: 'alice@example.com', name: 'alice@example.com', avatarUrl: '', source: 'header', isAdmin: false };
  assert.deepEqual(await who('alice@example.com'), bare, 'no authors.json: the key names the caller');
  assert.deepEqual(Object.keys((await who('alice@example.com'))!).sort(), ['avatarUrl', 'isAdmin', 'key', 'name', 'source']);

  writeAuthors({ 'alice@example.com': { name: 'Alice A', avatarUrl: 'http://a/a.png' }, 'Jane%20Doe': { name: 'Jane', avatarUrl: '' } });
  assert.deepEqual(await who('alice@example.com'), { ...bare, name: 'Alice A', avatarUrl: 'http://a/a.png' });
  assert.equal((await who('  alice@example.com  '))!.key, 'alice@example.com', 'surrounding spaces are trimmed');
  assert.deepEqual([(await who('Jane Doe'))!.key, (await who(' Jane Doe '))!.name], ['Jane%20Doe', 'Jane'], 'inner whitespace is encoded, then looked up');
  assert.equal(await who(null), null);
  assert.equal(await who(''), null);
  assert.equal(await who('   '), null);

  const admins = { permissions: { admins: ['alice@example.com', 'Jane Doe'] } };
  assert.equal((await who('alice@example.com', admins))!.isAdmin, true);
  assert.equal((await who('Jane Doe', admins))!.isAdmin, true, 'an admin configured with a space matches the encoded key');
  assert.equal((await who('bob', admins))!.isAdmin, false);
});

test('findCaller in dev: the payload names the caller, unenforced; authors.json is not read', async () => {
  writeAuthors('not json'); // an unreadable file cannot cost a dev caller its identity
  const ctx = makeCtx(project.root, { ...dev, config: { src: 'docs', plugins: { threads: { permissions: { admins: ['k'] } } } } });
  assert.deepEqual(await findCaller(ctx, { author: 'Kay', authorKey: 'k', avatarUrl: 'u' }), { key: 'k', name: 'Kay', avatarUrl: 'u', source: 'payload', isAdmin: false });
  assert.deepEqual(await findCaller(ctx, { author: 'Kay' }), { key: 'Kay', name: 'Kay', avatarUrl: '', source: 'payload', isAdmin: false });
  assert.equal(await findCaller(ctx, {}), null);
});

test('findCaller under serve: a missing authors.json is fine, an unreadable one rejects', async () => {
  const ctx = makeCtx(project.root, serve('alice'));
  assert.equal((await findCaller(ctx, {}))!.key, 'alice');
  fs.mkdirSync(safePath(project.root, 'docs/.threads/authors.json'), { recursive: true }); // a directory where the file should be
  await assert.rejects(findCaller(ctx, {}), /EISDIR/);
  fs.rmSync(safePath(threadsDir(), 'authors.json'), { recursive: true });
  writeAuthors('{ broken');
  await assert.rejects(findCaller(ctx, {}), SyntaxError);
});

test('under serve an identified caller drafts without an author field', async () => {
  const t = await run<Thread>('add-thread', { file: project.file, body: 'hi', anchor }, serve('alice'));
  const c = await run<Comment>('add-comment', { file: project.file, threadId: t.id, body: 'reply' }, serve('alice'));
  assert.equal(c.author, 'alice');
});

test('upsert-author under serve: a foreign key is forbidden, the caller\'s own entry is written at once, nothing else changes', async () => {
  const admin = serve('root', { permissions: { admins: ['root'] } });
  writeAuthors({ alice: { name: 'Alice', avatarUrl: 'http://a/a.png' }, bob: { name: 'Bob', avatarUrl: '' } });
  const before = fs.readFileSync(safePath(threadsDir(), 'authors.json'), 'utf8');

  for (const extra of [serve('alice'), admin]) {
    await assert.rejects(
      run('upsert-author', { authorKey: 'bob', name: 'Mallory' }, extra),
      /^ThreadsError: threads\/forbidden: /,
    );
  }
  assert.equal(fs.readFileSync(safePath(threadsDir(), 'authors.json'), 'utf8'), before, 'a refusal changes nothing');
  assert.equal(fs.existsSync(path.join(threadsDir(), 'drafts')), false, 'no journal is written');

  await run('upsert-author', { name: 'Alice B' }, serve('alice'));
  assert.deepEqual(readAuthors(), { alice: { name: 'Alice B', avatarUrl: 'http://a/a.png' }, bob: { name: 'Bob', avatarUrl: '' } }, 'the avatar defaults to the current one');
  await run('upsert-author', { authorKey: 'alice', name: 'Alice C', avatarUrl: 'http://a/b.png' }, serve('alice'));
  await run('upsert-author', { name: 'Alice C', avatarUrl: '' }, serve('alice'));
  assert.equal(readAuthors().alice.avatarUrl, '', 'an empty avatar clears it');
  await run('upsert-author', { name: 'Alice C', avatarUrl: 'http://a/b.png' }, serve('alice'));
  await run('upsert-author', { authorKey: 'root', name: 'Root' }, admin);
  assert.deepEqual(readAuthors(), {
    alice: { name: 'Alice C', avatarUrl: 'http://a/b.png' },
    bob: { name: 'Bob', avatarUrl: '' },
    root: { name: 'Root', avatarUrl: '' },
  });
  assert.equal(fs.existsSync(path.join(threadsDir(), 'drafts')), false, 'no journal is written');
  assert.equal((await run<WhoAmI>('whoami', {}, serve('alice'))).identity?.name, 'Alice C', 'the next request sees the new name');

  await assert.rejects(run('upsert-author', {}, serve('alice')), /^ThreadsError: threads\/invalid: threads:upsert-author: name is required/);
});

test('concurrent profile saves by two users under serve both land', async () => {
  const names = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  await Promise.all(names.map((n) => run('upsert-author', { name: n.toUpperCase() }, serve(n))));
  assert.deepEqual(Object.keys(readAuthors()).sort(), names);
});
