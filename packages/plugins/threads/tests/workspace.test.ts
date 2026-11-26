/**
 * Under a workspace config every action keeps its data in the docs root of the subproject that
 * holds the calling page (its own `src`), not in the workspace root. Driven through the real action
 * dispatcher, which maps a page to its subproject the way `ctx.readFile` finds the page.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createActionDispatcher } from '@docmd/api';
import { safePath } from '@docmd/utils';
import { playground } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { slug } from '../src/plugin/drafts.ts';
import type { Thread } from '../src/types.ts';

let root: string;
let mainDocs: string;
let apiDocs: string;
/** Pages as the generator names them: relative to their subproject's directory. */
const MAIN_PAGE = 'docs/index.md';
const API_PAGE = 'content/guide.md';
const ALICE = { author: 'Alice', authorKey: 'alice' };

const workspace = { workspace: { projects: [{ prefix: '/', src: 'main' }, { prefix: '/api', src: 'api' }] } };

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-ws-')));
  mainDocs = path.join(root, 'main', 'docs');
  apiDocs = path.join(root, 'api', 'content');
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const dir of ['main/docs', 'api/content']) fs.mkdirSync(safePath(root, dir), { recursive: true });
  fs.writeFileSync(safePath(mainDocs, 'index.md'), playground);
  fs.writeFileSync(safePath(apiDocs, 'guide.md'), playground);
});

/** What workspace dev hands the dispatcher: subproject dir → its docs source dir. */
const docsRoots = () => new Map([
  [path.join(root, 'main'), mainDocs],
  [path.join(root, 'api'), apiDocs],
]);

function dispatcher(config: Record<string, unknown>, workspaceDocsRoots?: Map<string, string>) {
  const d = createActionDispatcher({ actions, events: {} }, {
    projectRoot: root, config, broadcast: () => {}, workspaceDocsRoots,
  });
  return async <T = unknown>(action: string, payload: Record<string, unknown>) =>
    (await d.handleCall(action, payload)).result as T;
}

const exists = (...p: string[]) => fs.existsSync(path.join(...p));
const journal = (docsRoot: string) => path.join(docsRoot, '.threads', 'drafts', `${slug('alice')}.json`);
const readJson = (p: string) => JSON.parse(fs.readFileSync(safePath(path.dirname(p), path.basename(p)), 'utf8'));

test('drafting on a subproject page writes its journal and authors.json under that subproject', async () => {
  const call = dispatcher(workspace, docsRoots());
  await call('threads:add-thread', { file: API_PAGE, ...ALICE, body: 'on the api page' });

  assert.ok(exists(journal(apiDocs)), 'journal under api/content');
  assert.deepEqual(readJson(journal(apiDocs)).ops.map((o: { file: string }) => o.file), [API_PAGE]);
  assert.equal(readJson(path.join(apiDocs, '.threads', 'authors.json')).alice.name, 'Alice');
  assert.ok(!exists(root, '.threads'), 'nothing in the workspace root');
  assert.ok(!exists(mainDocs, '.threads'), 'nothing in the other subproject');
});

test('each subproject keeps its own journal, and reads only its own', async () => {
  const call = dispatcher(workspace, docsRoots());
  await call('threads:add-thread', { file: MAIN_PAGE, ...ALICE, body: 'main draft' });
  await call('threads:add-thread', { file: API_PAGE, ...ALICE, body: 'api draft' });

  const bodies = (d: string) => readJson(journal(d)).ops.map((o: { body: string }) => o.body);
  assert.deepEqual(bodies(mainDocs), ['main draft']);
  assert.deepEqual(bodies(apiDocs), ['api draft']);

  const who = await call<{ journal: { ops: unknown[] } }>('threads:whoami', { file: API_PAGE, ...ALICE });
  assert.equal(who.journal.ops.length, 1);
  const threads = await call<Thread[]>('threads:get-threads', { file: API_PAGE, ...ALICE });
  assert.ok(threads.some((t) => t.comments[0]?.body === 'api draft'));
  assert.ok(!threads.some((t) => t.comments[0]?.body === 'main draft'));
  const authors = await call<Record<string, unknown>>('threads:get-authors', { file: MAIN_PAGE });
  assert.deepEqual(Object.keys(authors), ['alice']);
});

test('publish-review writes the page and the manifest in the subproject and empties its journal', async () => {
  const call = dispatcher(workspace, docsRoots());
  await call('threads:add-thread', { file: API_PAGE, ...ALICE, body: 'published on api' });
  await call('threads:set-mode', { file: API_PAGE, ...ALICE, mode: 'collect' });
  const { reviewId } = await call<{ reviewId: string }>('threads:publish-review', { file: API_PAGE, ...ALICE });

  assert.ok(fs.readFileSync(safePath(apiDocs, 'guide.md'), 'utf8').includes('published on api'));
  assert.equal(fs.readFileSync(safePath(mainDocs, 'index.md'), 'utf8'), playground);
  assert.equal(readJson(path.join(apiDocs, '.threads', 'reviews', `${reviewId}.json`)).state, 'published');
  assert.deepEqual(readJson(journal(apiDocs)).ops, []);
  assert.ok(!exists(root, '.threads'));
  assert.ok(!exists(mainDocs, '.threads', 'reviews'));

  // Discard without file (as the client sends it) reverses the published review in the subproject
  const result = await call<{ discarded: boolean }>('threads:discard-review', { ...ALICE, reviewId });
  assert.equal(result.discarded, true);
  assert.ok(!fs.readFileSync(safePath(apiDocs, 'guide.md'), 'utf8').includes('published on api'));
  assert.equal(readJson(path.join(apiDocs, '.threads', 'reviews', `${reviewId}.json`)).state, 'discarded');
});

test('discard-review empties the caller open review draft in a subproject without file', async () => {
  const call = dispatcher(workspace, docsRoots());
  await call('threads:add-thread', { file: API_PAGE, ...ALICE, body: 'draft on api to discard' });
  const who = await call<{ journal: { review: { id: string }; ops: unknown[] } }>('threads:whoami', { file: API_PAGE, ...ALICE });
  assert.equal(who.journal.ops.length, 1);
  const openReviewId = who.journal.review.id;

  const result = await call<{ discarded: boolean }>('threads:discard-review', { ...ALICE, reviewId: openReviewId });
  assert.equal(result.discarded, true);

  const whoAfter = await call<{ journal: { ops: unknown[] } }>('threads:whoami', { file: API_PAGE, ...ALICE });
  assert.equal(whoAfter.journal.ops.length, 0);
});

test('without a subproject for the page, the root config decides, as for a single project', async () => {
  // A page no subproject holds, and a call that names no page.
  fs.mkdirSync(safePath(root, 'docs'), { recursive: true });
  fs.writeFileSync(safePath(root, 'docs/index.md'), playground);
  const call = dispatcher({ ...workspace, src: 'docs' }, docsRoots());
  await call('threads:add-thread', { file: 'docs/index.md', ...ALICE, body: 'root page' });
  await call('threads:upsert-author', { authorKey: 'bob', name: 'Bob' });
  assert.ok(exists(journal(path.join(root, 'docs'))));
  assert.ok(exists(root, 'docs', '.threads', 'authors.json'));
  assert.ok(!exists(apiDocs, '.threads') && !exists(mainDocs, '.threads'));
});

test('a single-project config keeps <projectRoot>/<src>', async () => {
  fs.mkdirSync(safePath(root, 'docs'), { recursive: true });
  fs.writeFileSync(safePath(root, 'docs/index.md'), playground);
  const call = dispatcher({ src: 'docs' });
  await call('threads:add-thread', { file: 'docs/index.md', ...ALICE, body: 'single' });
  assert.ok(exists(journal(path.join(root, 'docs'))));
  assert.ok(!exists(root, '.threads'));
});
