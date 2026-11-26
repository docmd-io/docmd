import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { findCaller, isEmailShaped, resolveCaller } from '../src/plugin/identity.ts';
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

  const bare = { key: 'alice', name: 'alice', avatarUrl: '', source: 'header', isAdmin: false };
  assert.deepEqual(await who('alice'), bare, 'no authors.json: the key names the caller');
  assert.deepEqual(Object.keys((await who('alice'))!).sort(), ['avatarUrl', 'isAdmin', 'key', 'name', 'source']);

  writeAuthors({ alice: { name: 'Alice A', avatarUrl: 'http://a/a.png' }, 'Jane%20Doe': { name: 'Jane', avatarUrl: '' } });
  assert.deepEqual(await who('alice'), { ...bare, name: 'Alice A', avatarUrl: 'http://a/a.png' });
  assert.equal((await who('  alice  '))!.key, 'alice', 'surrounding spaces are trimmed');
  assert.deepEqual([(await who('Jane Doe'))!.key, (await who(' Jane Doe '))!.name], ['Jane%20Doe', 'Jane'], 'inner whitespace is encoded, then looked up');
  assert.equal(await who(null), null);
  assert.equal(await who(''), null);
  assert.equal(await who('   '), null);

  const admins = { permissions: { admins: ['alice', 'Jane Doe'] } };
  assert.equal((await who('alice', admins))!.isAdmin, true);
  assert.equal((await who('Jane Doe', admins))!.isAdmin, true, 'an admin configured with a space matches the encoded key');
  assert.equal((await who('bob', admins))!.isAdmin, false);
});

test('findCaller in dev: the payload names the caller, unenforced; authors.json is not read', async () => {
  writeAuthors('not json'); // an unreadable file cannot cost a dev caller its identity
  const ctx = makeCtx(project.root, { ...dev, config: { src: 'docs', plugins: { threads: { permissions: { admins: ['k'] } } } } });
  assert.deepEqual(await findCaller(ctx, { author: 'Kay', authorKey: 'k', avatarUrl: 'u' }), { key: 'k', name: 'Kay', avatarUrl: 'u', source: 'payload', isAdmin: false });
  assert.deepEqual(await findCaller(ctx, { author: 'Kay' }), { key: 'Kay', name: 'Kay', avatarUrl: '', source: 'payload', isAdmin: false });
  assert.equal(await findCaller(ctx, {}), null);
  // an e-mail-shaped key names the caller Anonymous, never the address; a plain key still names it; dev does not refuse
  assert.deepEqual(await findCaller(ctx, { authorKey: 'me@example.com' }), { key: 'me@example.com', name: 'Anonymous', avatarUrl: '', source: 'payload', isAdmin: false });
  assert.equal((await findCaller(ctx, { authorKey: 'me@example.com', author: 'Me' }))!.name, 'Me');
  assert.equal((await findCaller(ctx, { authorKey: 'me' }))!.name, 'me');
  assert.equal((await resolveCaller(ctx, { authorKey: 'me@example.com' })).key, 'me@example.com');
});

test('isEmailShaped: characters on both sides of an @, no whitespace, after trimming', () => {
  for (const yes of ['ann@example.com', 'a@b', '  ann@x.org  ']) assert.equal(isEmailShaped(yes), true, yes);
  for (const no of ['ann', '12345', '@ann', 'ann@', 'a b@c', 'f3c1-uuid', 'Jane%20Doe']) assert.equal(isEmailShaped(no), false, no);
});

test('an e-mail-shaped identity under serve logs one warning per process, without the value', async () => {
  // A private copy of the module, so its once-per-process latch starts unset whatever ran before.
  const { findCaller: fc, resolveCaller: rc } = (await import('../src/plugin/identity.ts?warn-once')) as typeof import('../src/plugin/identity.ts');
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void lines.push(a.join(' '));
  try {
    const ctx = makeCtx(project.root, serve('ann@example.com'));
    assert.equal(await fc(ctx, {}), null);
    await assert.rejects(rc(ctx, {}), { code: 'email-identity' });
  } finally {
    console.warn = orig;
  }
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('ann@example.com'));
  assert.ok(lines[0].includes('X-Auth-Request-User'));
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

const GIT = { branch: 'main', committer: { name: 'Bot', email: 'bot@x.invalid' } };

test('upsert-author under serve with git waits in the caller\'s journal and leaves authors.json alone; without git, and in dev, it is written at once', async () => {
  const gitServe = serve('alice', { git: GIT });
  writeAuthors({ alice: { name: 'Alice', avatarUrl: 'http://a/a.png' } });
  const before = fs.readFileSync(safePath(threadsDir(), 'authors.json'), 'utf8');
  const stamp = '2020-01-01T00:00:00.000Z';
  fs.mkdirSync(safePath(threadsDir(), 'drafts'), { recursive: true });
  fs.writeFileSync(safePath(threadsDir(), 'drafts/alice.json'), JSON.stringify({ version: 1, mode: 'collect', review: { id: 'r-1', updatedAt: stamp, title: null, summary: null }, ops: [] }));

  await assert.rejects(run('upsert-author', { authorKey: 'bob', name: 'Mallory' }, gitServe), /^ThreadsError: threads\/forbidden: /);
  assert.deepEqual((await run<WhoAmI>('whoami', {}, gitServe)).journal!.review.updatedAt, stamp, 'a refusal journals nothing');

  await run('upsert-author', { name: 'Alice B' }, gitServe);
  const me = await run<WhoAmI>('whoami', {}, gitServe);
  assert.deepEqual(me.journal!.profile, { name: 'Alice B', avatarUrl: 'http://a/a.png' }, 'the avatar defaults to the current one');
  assert.notEqual(me.journal!.review.updatedAt, stamp, 'the auto-publish countdown restarts');
  assert.equal(me.identity!.name, 'Alice', 'the published name is unchanged until the publish');
  await run('upsert-author', { name: 'Alice C', avatarUrl: '' }, gitServe);
  assert.deepEqual((await run<WhoAmI>('whoami', {}, gitServe)).journal!.profile, { name: 'Alice C', avatarUrl: '' }, 'a later edit replaces it');
  assert.equal(fs.readFileSync(safePath(threadsDir(), 'authors.json'), 'utf8'), before, 'authors.json is byte-identical');

  // no file at all stays no file
  fs.rmSync(safePath(threadsDir(), 'authors.json'));
  await run('upsert-author', { name: 'Alice D' }, gitServe);
  assert.equal(fs.existsSync(safePath(threadsDir(), 'authors.json')), false);

  // serve without git, dev with a full git option: written at once, no journal profile
  await run('upsert-author', { name: 'Zoe' }, serve('zoe'));
  await run('upsert-author', { authorKey: 'dev', name: 'Dev' }, { ...dev, config: { src: 'docs', plugins: { threads: { git: GIT } } } });
  assert.deepEqual(readAuthors(), { zoe: { name: 'Zoe', avatarUrl: '' }, dev: { name: 'Dev', avatarUrl: '' } });
  assert.equal((await run<WhoAmI>('whoami', {}, serve('zoe'))).journal!.profile, undefined);
  assert.equal(fs.existsSync(path.join(threadsDir(), 'drafts', 'zoe.json')), false);
  assert.equal(fs.existsSync(path.join(threadsDir(), 'drafts', 'dev.json')), false);
});

test('concurrent profile saves by two users under serve both land', async () => {
  const names = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  await Promise.all(names.map((n) => run('upsert-author', { name: n.toUpperCase() }, serve(n))));
  assert.deepEqual(Object.keys(readAuthors()).sort(), names);
});
