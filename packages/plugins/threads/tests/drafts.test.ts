import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { safePath } from '@docmd/utils';
import { tempProject, type TempProject } from './helpers.ts';
import { createDraftStore, makeOp, slug, type DraftStore } from '../src/plugin/drafts.ts';
import { ThreadsError } from '../src/plugin/errors.ts';

let project: TempProject;
let docsRoot: string;
let clock = Date.parse('2026-03-10T12:00:00.000Z');
const store = () => createDraftStore(docsRoot, { now: () => clock });
const rd = (p: string) => fs.readFileSync(safePath(path.dirname(p), path.basename(p)), 'utf8');
const rdBytes = (p: string) => fs.readFileSync(safePath(path.dirname(p), path.basename(p)));
const wr = (p: string, text: string) => fs.writeFileSync(safePath(path.dirname(p), path.basename(p)), text);
const ls = (p: string) => fs.readdirSync(safePath(p, '.'));
const draftsDir = () => path.join(docsRoot, '.threads', 'drafts');
const addThread = { kind: 'add-thread', file: 'docs/index.md', threadId: 't-1', commentId: 'c-1', body: 'hi' } as const;
const append = (s: DraftStore, key: string) => s.transact(key, (j, at) => void j.ops.push(makeOp(addThread, at)));

before(() => {
  project = tempProject();
  docsRoot = path.join(project.root, 'docs');
  execFileSync('git', ['init', '-q'], { cwd: project.root });
});
after(() => project.cleanup());
beforeEach(() => {
  fs.rmSync(path.join(docsRoot, '.threads'), { recursive: true, force: true });
  clock = Date.parse('2026-03-10T12:00:00.000Z');
});

test('a write creates <slug>.json holding only version, mode, review and ops, atomically; git ignores it; .gitignore is written once', async () => {
  const key = 'alice smith/1';
  assert.equal(slug(key), 'alice_20smith_2F1');
  const s = store();
  await append(s, key);
  const file = path.join(draftsDir(), 'alice_20smith_2F1.json');
  const journal = JSON.parse(rd(file));
  assert.deepEqual(Object.keys(journal).sort(), ['mode', 'ops', 'review', 'version']);
  assert.deepEqual(Object.keys(journal.review).sort(), ['id', 'updatedAt']);
  assert.equal(journal.review.updatedAt, '2026-03-10T12:00:00.000Z');
  assert.equal(journal.mode, 'collect');
  assert.match(journal.review.id, /^r-[0-9a-f]{8}$/);
  assert.equal(journal.version, 1);
  assert.equal(journal.ops.length, 1);

  const ignore = path.join(draftsDir(), '.gitignore');
  assert.equal(rd(ignore), '*\n!.gitignore\n');
  assert.equal(spawnSync('git', ['check-ignore', '-q', file], { cwd: project.root }).status, 0);
  wr(ignore, '# operator edit\n');
  await append(s, key);
  assert.equal(rd(ignore), '# operator edit\n', '.gitignore is written once, never overwritten');
  assert.deepEqual(ls(draftsDir()).filter((f) => f.endsWith('.tmp')), []);
});

test('a journal survives a new store instance', async () => {
  await append(store(), 'bob');
  const loaded = await store().load('bob');
  assert.deepEqual(loaded.ops.map((o) => o.kind), ['add-thread']);
});

test('a corrupt journal is moved aside and a fresh one is returned', async () => {
  fs.mkdirSync(safePath(docsRoot, '.threads/drafts'), { recursive: true });
  const file = path.join(draftsDir(), 'bob.json');
  wr(file, '{ not json');
  const journal = await store().load('bob');
  assert.deepEqual({ ...journal, review: undefined }, { version: 1, mode: 'collect', review: undefined, ops: [] });
  assert.match(journal.review.id, /^r-[0-9a-f]{8}$/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(rd(`${file}.corrupt-${clock}`), '{ not json');
});

test('a missing journal loads fresh without writing', async () => {
  const fresh = await store().load('x');
  assert.deepEqual(Object.keys(fresh).sort(), ['mode', 'ops', 'review', 'version']);
  assert.match(fresh.review.id, /^r-[0-9a-f]{8}$/);
  assert.deepEqual([fresh.version, fresh.ops], [1, []]);
  assert.equal(fs.existsSync(draftsDir()), false);
});

test('a new journal takes its mode from defaultMode: a value, or a function read for each new journal', async () => {
  assert.equal((await createDraftStore(docsRoot, { now: () => clock, defaultMode: 'auto' }).load('a')).mode, 'auto');
  let next: 'auto' | 'collect' = 'auto';
  const s = createDraftStore(docsRoot, { now: () => clock, defaultMode: () => next });
  assert.equal((await s.load('a')).mode, 'auto');
  next = 'collect';
  assert.equal((await s.load('b')).mode, 'collect');
  await append(s, 'a');
  next = 'auto';
  assert.equal((await s.load('a')).mode, 'collect', 'a saved journal keeps the mode it was created with');
});

const legacyOp = { ...addThread, opId: 'o-00000001', at: '2026-03-10T12:00:00.000Z' };
const legacy: Array<[string, Record<string, unknown>, string | null]> = [
  ['without a review or a mode (no review id yet)', { version: 1, ops: [legacyOp] }, null],
  ['with a review id and no mode or updatedAt', { version: 1, review: { id: 'r-0badcafe' }, ops: [legacyOp] }, 'r-0badcafe'],
];
for (const [name, content, id] of legacy) {
  for (const defaultMode of ['auto', 'collect'] as const) {
    test(`a journal saved ${name} loads as valid in ${defaultMode} mode with a stable updatedAt; the next write keeps its ops`, async () => {
      fs.mkdirSync(safePath(docsRoot, '.threads/drafts'), { recursive: true });
      const file = path.join(draftsDir(), 'bob.json');
      wr(file, JSON.stringify(content));
      const s = createDraftStore(docsRoot, { now: () => clock, defaultMode });
      const first = await s.load('bob');
      clock += 60_000;
      const second = await s.load('bob');
      assert.deepEqual(first.ops.map((o) => o.opId), ['o-00000001']);
      assert.equal(first.mode, defaultMode);
      assert.match(first.review.id, /^r-[0-9a-f]{8}$/);
      if (id) assert.equal(first.review.id, id);
      assert.match(first.review.updatedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
      assert.equal(second.review.updatedAt, first.review.updatedAt, 'two loads without a write agree');
      assert.deepEqual(ls(draftsDir()).filter((f) => f.includes('.corrupt-')), []);

      await append(s, 'bob');
      const saved = JSON.parse(rd(file));
      assert.deepEqual(saved.ops.map((o: { opId: string }) => o.opId).slice(0, 1), ['o-00000001']);
      assert.equal(saved.ops.length, 2);
      assert.equal(saved.mode, defaultMode);
      assert.equal(saved.review.id, first.review.id);
      assert.equal(saved.review.updatedAt, new Date(clock).toISOString());
    });
  }
}

test('transact and setMode stamp review.updatedAt from the clock; a throwing transact leaves it as it was', async () => {
  const s = store();
  const file = path.join(draftsDir(), 'k.json');
  await append(s, 'k');
  assert.equal(JSON.parse(rd(file)).review.updatedAt, '2026-03-10T12:00:00.000Z');
  clock += 5000;
  await s.setMode('k', 'auto');
  const moded = JSON.parse(rd(file));
  assert.deepEqual([moded.mode, moded.review.updatedAt, moded.ops.length], ['auto', '2026-03-10T12:00:05.000Z', 1]);
  clock += 5000;
  await assert.rejects(s.transact('k', () => { throw new ThreadsError('invalid', 'x'); }), /threads\/invalid: x/);
  assert.equal(JSON.parse(rd(file)).review.updatedAt, '2026-03-10T12:00:05.000Z');
  assert.equal((await s.load('k')).review.updatedAt, '2026-03-10T12:00:05.000Z');
});

test('setMode on a missing journal creates it with that mode', async () => {
  const j = await store().setMode('new', 'auto');
  assert.deepEqual([j.mode, j.ops], ['auto', []]);
  assert.equal(JSON.parse(rd(path.join(draftsDir(), 'new.json'))).mode, 'auto');
});

test('ops are stamped from the injected clock', async () => {
  const s = store();
  await append(s, 'k');
  clock += 5000;
  await append(s, 'k');
  const j = await s.load('k');
  assert.deepEqual(j.ops.map((o) => o.at), ['2026-03-10T12:00:00.000Z', '2026-03-10T12:00:05.000Z']);
  assert.match(j.ops[0].opId, /^o-[0-9a-f]{8}$/);
});

test('a throwing transact rejects and leaves the journal file untouched', async () => {
  const s = store();
  await append(s, 'k');
  const file = path.join(draftsDir(), 'k.json');
  const bytes = rdBytes(file);
  await assert.rejects(
    s.transact('k', (j) => { j.ops = []; throw new ThreadsError('not-found', 'x'); }),
    /threads\/not-found: x/,
  );
  assert.deepEqual(rdBytes(file), bytes);
  assert.deepEqual(ls(draftsDir()).filter((f) => f.endsWith('.tmp')), []);
  assert.equal((await s.load('k')).ops.length, 1, 'the store still works after a failed cycle');
});

test('concurrent transact calls on one store keep both ops', async () => {
  const s = store();
  await Promise.all([append(s, 'k'), append(s, 'k')]);
  assert.equal((await s.load('k')).ops.length, 2);
});

test('a failed write leaves no tmp file and the journal as it was', async () => {
  const s = store();
  await append(s, 'k');
  const file = path.join(draftsDir(), 'k.json');
  const bytes = rdBytes(file);
  const rename = mock.method(fs.promises, 'rename', async () => { throw new Error('boom'); });
  try {
    await assert.rejects(append(s, 'k'), /boom/);
  } finally {
    rename.mock.restore();
  }
  assert.deepEqual(ls(draftsDir()).filter((f) => f.endsWith('.tmp')), []);
  assert.deepEqual(rdBytes(file), bytes);
});
