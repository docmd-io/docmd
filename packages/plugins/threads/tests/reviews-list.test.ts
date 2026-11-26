/**
 * threads:list-reviews and threads:update-review, through the action handlers.
 * Listing runs against manifests written once in before(); the title tests publish
 * in a project of their own so the two never see each other's manifests.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, failingReset, snapshotTree, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { createDraftStore } from '../src/plugin/drafts.ts';
import { createLock, createNoGitSync } from '../src/plugin/lock.ts';
import { newestFirst, publish, writeManifest } from '../src/plugin/reviews.ts';
import { ThreadsError } from '../src/plugin/errors.ts';
import type { Caller, Journal, ManifestOp, PublishResult, ReviewManifest, ReviewSummary, WhoAmI } from '../src/types.ts';

type Handler = (payload: Record<string, unknown>, ctx: TestCtx) => Promise<unknown>;

let listing: TempProject;
let titling: TempProject;
const root = (p: TempProject) => path.join(p.root, 'docs');
const call = async <T>(p: TempProject, name: string, payload: Record<string, unknown> = {}, extra: Partial<TestCtx> = {}): Promise<T> =>
  (await (actions as unknown as Record<string, Handler>)[name](payload, makeCtx(p.root, { config: { src: 'docs' }, ...extra }))) as T;
const ctxOf = (p: TempProject) => makeCtx(p.root, { config: { src: 'docs' } });
const ALICE = { author: 'Alice', authorKey: 'k-alice' };
const ALICE_CALLER: Caller = { key: 'k-alice', name: 'Alice', avatarUrl: '', source: 'payload', isAdmin: false };

const op = (threadId: string, extra: Partial<ManifestOp> = {}): ManifestOp =>
  ({ kind: 'add-thread', opId: `o-${threadId}`, at: '2026-03-01T00:00:00.000Z', file: 'docs/index.md', threadId, commentId: `c-${threadId}`, anchor: null, body: 'x', ...extra }) as ManifestOp;
const manifest = (id: string, publishedAt: string, extra: Partial<ReviewManifest> = {}): ReviewManifest => ({
  version: 1, id, authorKey: 'k-alice', authorName: 'Alice', title: `Title ${id}`, summary: null, state: 'published', publishedAt,
  ops: [op(`t-${id}`)], skipped: [], ...extra,
});

before(async () => {
  listing = tempProject();
  titling = tempProject();
  const ctx = ctxOf(listing);
  await writeManifest(ctx as never, manifest('r-middle', '2026-03-02T00:00:00.000Z', {
    ops: [op('t-a', { before: { body: 'old' }, quote: 'some quote', pageTitle: 'Page A' } as Partial<ManifestOp>), op('t-b', { file: 'docs/other.md' })],
    skipped: [{ opId: 'o-x', reason: 'gone' }],
  }));
  await writeManifest(ctx as never, manifest('r-newest', '2026-03-03T00:00:00.000Z'));
  await writeManifest(ctx as never, manifest('r-oldest', '2026-03-01T00:00:00.000Z', {
    state: 'discarded', discardedAt: '2026-03-04T00:00:00.000Z', discardedBy: 'k-bob', discardSkipped: [],
  }));
  for (const id of ['r-tie-b', 'r-tie-a']) await writeManifest(ctx as never, manifest(id, '2026-03-02T12:00:00.000Z'));
  const dir = path.join(root(listing), '.threads', 'reviews');
  fs.writeFileSync(safePath(dir, 'bad.json'), '{ not json');
  fs.writeFileSync(safePath(dir, 'no-time.json'), JSON.stringify({ version: 1, id: 'no-time', title: 'No time', ops: [] }));
  fs.mkdirSync(safePath(dir, 'a-directory.json'));
  fs.writeFileSync(safePath(dir, 'v2.json'), JSON.stringify({ version: 2, id: 'v2', ops: [] }));
  fs.writeFileSync(safePath(dir, 'r-newest.back'), JSON.stringify(manifest('r-stray', '2026-03-09T00:00:00.000Z')));
});
after(() => {
  listing.cleanup();
  titling.cleanup();
});

test('list-reviews returns the manifests newest first, projected to the summary fields; bad and non-json files are left out', async () => {
  const out = await call<ReviewSummary[]>(listing, 'threads:list-reviews');
  assert.deepEqual(out.map((r) => r.id), ['r-newest', 'r-tie-a', 'r-tie-b', 'r-middle', 'r-oldest']);
  assert.deepEqual(out[3], {
    id: 'r-middle', authorKey: 'k-alice', authorName: 'Alice', title: 'Title r-middle',
    publishedAt: '2026-03-02T00:00:00.000Z', state: 'published',
    ops: [
      { file: 'docs/index.md', threadId: 't-a', quote: 'some quote', pageTitle: 'Page A' },
      { file: 'docs/other.md', threadId: 't-b', quote: null, pageTitle: null },
    ],
  });
  assert.equal(out[4].state, 'discarded');
  assert.deepEqual(Object.keys(out[4]).sort(), ['authorKey', 'authorName', 'id', 'ops', 'publishedAt', 'state', 'title']);
});

test('newestFirst orders equal publishedAt by id, whatever order the directory lists them in', () => {
  const at = '2026-03-02T00:00:00.000Z';
  const ids = [{ id: 'b', publishedAt: at }, { id: 'c', publishedAt: '2026-03-03T00:00:00.000Z' }, { id: 'a', publishedAt: at }].sort(newestFirst);
  assert.deepEqual(ids.map((m) => m.id), ['c', 'a', 'b']);
});

test('list-reviews is [] without a reviews directory', async () => {
  assert.deepEqual(await call(listing, 'threads:list-reviews', {}, { config: { src: 'no-docs' } }), []);
});

test('list-reviews under serve without an identity succeeds and writes nothing', async () => {
  const tree = snapshotTree(root(listing));
  const out = await call<ReviewSummary[]>(listing, 'threads:list-reviews', {}, { mode: 'serve', caller: { identity: null } });
  assert.equal(out.length, 5);
  assert.deepEqual(snapshotTree(root(listing)), tree);
});

test('update-review names the open review through the handler and returns the journal; a bad title is refused', async () => {
  const j = await call<Journal>(titling, 'threads:update-review', { ...ALICE, title: '  My review  ' });
  assert.equal(j.review.title, 'My review');
  const tree = snapshotTree(root(titling));
  for (const title of [5, { a: 1 }, undefined]) {
    await assert.rejects(
      call(titling, 'threads:update-review', { ...ALICE, title }),
      (e: unknown) => e instanceof ThreadsError && e.code === 'invalid',
    );
  }
  assert.deepEqual(snapshotTree(root(titling)), tree, 'a refused title changes nothing');
  assert.equal((await call<Journal>(titling, 'threads:update-review', { ...ALICE, title: null })).review.title, null);
});

test('update-review through the handler: a title-only call keeps the summary; a refused payload changes nothing', async () => {
  const saved = await call<Journal>(titling, 'threads:update-review', { ...ALICE, summary: '  line one\nline two  ' });
  assert.equal(saved.review.summary, 'line one\nline two');
  assert.equal((await call<Journal>(titling, 'threads:update-review', { ...ALICE, title: 'T' })).review.summary, 'line one\nline two');
  const tree = snapshotTree(root(titling));
  await assert.rejects(
    call(titling, 'threads:update-review', { ...ALICE, summary: 5 }),
    (e: unknown) => e instanceof ThreadsError && e.code === 'invalid',
  );
  assert.deepEqual(snapshotTree(root(titling)), tree, 'a refused call changes nothing');
});

test('a published review takes the commenter\'s title; the next review is untitled, also after a finished failed reset', async () => {
  const draft = (who: Record<string, string>) =>
    call(titling, 'threads:add-thread', { file: titling.file, ...who, body: 'a comment' });
  const manifestOf = (r: PublishResult) =>
    JSON.parse(fs.readFileSync(safePath(path.join(root(titling), '.threads', 'reviews'), `${r.reviewId}.json`), 'utf8')) as ReviewManifest;
  const whoami = (who: Record<string, string>) => call<WhoAmI>(titling, 'threads:whoami', who);

  await call(titling, 'threads:update-review', { ...ALICE, title: 'My review', summary: 'Why.' });
  await draft(ALICE);
  const titled = await call<PublishResult>(titling, 'threads:publish-review', ALICE);
  assert.equal(manifestOf(titled).title, 'My review');
  assert.equal(manifestOf(titled).summary, 'Why.');
  assert.equal((await whoami(ALICE)).journal?.review.title, null);
  assert.equal((await whoami(ALICE)).journal?.review.summary, null);
  await draft(ALICE);
  assert.equal(manifestOf(await call<PublishResult>(titling, 'threads:publish-review', ALICE)).summary, null, 'no summary: null in the manifest');

  // The publish wrote its manifest, then the journal reset failed; the next read finishes it.
  const bob = { author: 'Bob', authorKey: 'k-bob' };
  await call(titling, 'threads:update-review', { ...bob, title: 'Bob titled', summary: 'Bob explains' });
  await draft(bob);
  const real = createDraftStore(root(titling));
  const bobCaller: Caller = { ...ALICE_CALLER, key: 'k-bob', name: 'Bob' };
  await assert.rejects(publish(bobCaller, ctxOf(titling) as never, { store: failingReset(real), sync: createNoGitSync(createLock()) }), /journal write failed/);
  const journal = (await whoami(bob)).journal!;
  assert.equal(journal.review.title, null);
  assert.equal(journal.review.summary, null);
  assert.deepEqual(journal.ops, []);
});
