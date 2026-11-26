import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, type TempProject } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import { countOrphanedBy, markOrphans } from '../src/plugin/orphans.ts';
import type { Thread, WhoAmI } from '../src/types.ts';

const thread = (id: string, quote?: string, by = 'k-alice'): Thread => ({
  id, resolved: false, resolved_by: null, resolved_at: null,
  comments: [{ id: `c-${id}`, thread_id: id, parent_id: null, author: 'A', date: '2026-03-01', edited_at: null, authorKey: by, body: 'hi', reactions: [] }],
  ...(quote ? { anchor: { quote } } : {}),
});

const block = (ids: string[]) => `\n::: threads\n${ids.map((i) => `  ::: thread ${i}\n    ::: comment c-${i} "A" "2026-03-01" by k-alice\n      hi\n    :::\n  :::\n`).join('')}:::\n`;

// ---------------------------------------------------------------------------
// markOrphans: pure
// ---------------------------------------------------------------------------

const cases: Array<[string, string, Thread, boolean]> = [
  ['mark present', 'Some ==quoted text=={t-1} here.\n' + block(['t-1']), thread('t-1', 'quoted text'), false],
  ['mark absent', 'Some plain text here.\n' + block(['t-1']), thread('t-1', 'quoted text'), true],
  ['mark of another thread only', 'Some ==quoted text=={t-2} here.\n' + block(['t-1']), thread('t-1', 'quoted text'), true],
  ['id appears only inside the threads block', 'Plain.\n' + block(['t-1']).replace('hi', 'see ==x=={t-1}'), thread('t-1', 'quoted text'), true],
  ['multi-line quote, mark present', 'A ==line one\nline two=={t-1} b\n' + block(['t-1']), thread('t-1', 'line one\nline two'), false],
  ['no anchor (legacy / general)', 'Plain.\n' + block(['t-1']), thread('t-1'), false],
  ['no threads block at all', 'Plain.\n', thread('t-1', 'quoted text'), true],
  ['id with regex characters', 'A ==q=={t.1} b\n' + block(['t.1']), thread('t.1', 'q'), false],
];
for (const [name, content, t, orphaned] of cases) {
  test(`markOrphans: ${name}`, () => {
    const [out] = markOrphans(content, [t]);
    assert.equal(out.orphaned, orphaned ? true : undefined);
    assert.equal('orphaned' in out, orphaned);
    assert.equal(out.anchor?.quote, t.anchor?.quote);
  });
}

test('markOrphans does not mutate its input', () => {
  const t = thread('t-1', 'q');
  const input = [t];
  const [out] = markOrphans('Plain.\n', input);
  assert.equal(out.orphaned, true);
  assert.notEqual(out, t);
  assert.equal('orphaned' in t, false);
  assert.deepEqual(input, [t]);
});

// ---------------------------------------------------------------------------
// countOrphanedBy: in-memory file map
// ---------------------------------------------------------------------------

const ROOT = '/docs';
const orphan = (id: string, by: string) => `Plain.\n::: threads\n  ::: thread ${id}\n    ::: anchor\n      gone text\n    :::\n    ::: comment c-${id} "A" "2026-03-01" by ${by}\n      hi\n    :::\n  :::\n:::\n`;
const FILES: Record<string, string> = {
  '/docs/a.md': orphan('t-a1', 'k-alice'),
  '/docs/bob.md': orphan('t-a2', 'k-bob'),
  '/docs/sub/b.md': orphan('t-b', 'k-alice'),
  '/docs/.threads/x.md': orphan('t-x', 'k-alice'),
  '/docs/.git/x.md': orphan('t-g', 'k-alice'),
  '/docs/node_modules/pkg/y.md': orphan('t-y', 'k-alice'),
  '/docs/plain.md': 'No threads here.\n',
  '/docs/marked.md': 'Has ==gone text=={t-m} still.\n' + orphan('t-m', 'k-alice').replace('Plain.\n', ''),
};
const deps = {
  readFile: async (f: string) => FILES[f],
  listMarkdown: async () => Object.keys(FILES),
};

test('countOrphanedBy counts across files by first-comment key and skips .threads, .git and node_modules', async () => {
  assert.equal(await countOrphanedBy(ROOT, 'k-alice', deps), 2);
  assert.equal(await countOrphanedBy(ROOT, 'k-bob', deps), 1);
  assert.equal(await countOrphanedBy(ROOT, 'k-nobody', deps), 0);
});

test('countOrphanedBy skips a file that vanished between listing and reading', async () => {
  const d = {
    readFile: async (f: string) => {
      if (f === '/docs/sub/b.md') throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return FILES[f];
    },
    listMarkdown: async () => Object.keys(FILES),
  };
  assert.equal(await countOrphanedBy(ROOT, 'k-alice', d), 1);
});

test('countOrphanedBy counts by the first comment, not a later reply', async () => {
  const files: Record<string, string> = {
    '/docs/r.md': orphan('t-r', 'k-bob').replace('  :::\n:::\n', '    ::: comment c-2 "A" "2026-03-02" reply-to c-t-r by k-alice\n      re\n    :::\n  :::\n:::\n'),
  };
  const d = { readFile: async (f: string) => files[f], listMarkdown: async () => Object.keys(files) };
  assert.equal(await countOrphanedBy(ROOT, 'k-alice', d), 0);
  assert.equal(await countOrphanedBy(ROOT, 'k-bob', d), 1);
});

// ---------------------------------------------------------------------------
// get-threads / whoami through the actions: one temp project
// ---------------------------------------------------------------------------

let project: TempProject;
before(() => { project = tempProject(); });
after(() => project.cleanup());

const ALICE = { author: 'Alice', authorKey: 'k-alice' };
const BOB = { author: 'Bob', authorKey: 'k-bob' };
const call = <T = unknown>(name: string, payload: Record<string, unknown>): Promise<T> =>
  (actions as Record<string, (p: unknown, c: unknown) => Promise<unknown>>)[name](payload, makeCtx(project.root, { config: { src: 'docs' } })) as Promise<T>;

const ANCHOR = (quote: string) => ({ quote, prefix: null, suffix: null, selector: null, offset: null, blockText: null });
const QUOTE = 'Developer Checklist';
const TWO_LINES = 'first half of\nthe second half';
const TWO = path.join('docs', 'two.md');

const fresh = () => {
  project.reset();
  fs.rmSync(safePath(project.root, path.join('docs', '.threads')), { recursive: true, force: true });
  fs.writeFileSync(safePath(project.root, TWO), `# Two\n\nA ${TWO_LINES} sentence.\n`);
};
const find = async (file: string, id: string, who: Record<string, unknown> = ALICE): Promise<Thread> =>
  (await call<Thread[]>('threads:get-threads', { file, ...who })).find((t) => t.id === id)!;

/** Alice publishes a thread on `quote` in `file`, then the marked text is edited out of the page. */
async function publishThenOrphan(file: string, quote: string): Promise<string> {
  const added = await call<Thread>('threads:add-thread', { file, ...ALICE, body: 'Orphan me', anchor: ANCHOR(quote) });
  await call('threads:publish-review', { ...ALICE });
  const published = fs.readFileSync(safePath(project.root, file), 'utf8');
  assert.ok(published.includes(`==${quote}=={${added.id}}`));
  assert.equal((await find(file, added.id)).orphaned, undefined, 'a thread publish just marked is not orphaned');
  fs.writeFileSync(safePath(project.root, file), published.replace(`==${quote}=={${added.id}}`, 'something else'));
  return added.id;
}

for (const [name, file, quote] of [['single-line', path.join('docs', 'index.md'), QUOTE], ['two-line', TWO, TWO_LINES]] as const) {
  test(`get-threads flags a published ${name} thread once its quote is edited out, for its author and for another caller`, async () => {
    fresh();
    const id = await publishThenOrphan(file, quote);
    for (const who of [ALICE, BOB]) {
      const t = await find(file, id, who);
      assert.equal(t.orphaned, true);
      assert.equal(t.anchor?.quote, quote);
    }
  });
}

test('get-threads never flags the caller\'s drafted anchored thread and still overlays drafts', async () => {
  fresh();
  const file = project.file;
  const id = await publishThenOrphan(file, QUOTE);
  await call('threads:add-comment', { file, ...ALICE, threadId: id, body: 'Draft reply' });
  const draft = await call<Thread>('threads:add-thread', { file, ...ALICE, body: 'Still a draft', anchor: ANCHOR('Component Verification') });

  const threads = await call<Thread[]>('threads:get-threads', { file, ...ALICE });
  assert.equal(threads.find((t) => t.id === id)!.orphaned, true);
  assert.ok(threads.find((t) => t.id === id)!.comments.some((c) => c.draft && c.body === 'Draft reply'), 'drafts overlaid');
  const d = threads.find((t) => t.id === draft.id)!;
  assert.equal(d.draft, true);
  assert.equal('orphaned' in d, false);
});

test('whoami counts the starter\'s orphan, not another caller\'s, and not a drafted thread', async () => {
  fresh();
  await publishThenOrphan(project.file, QUOTE);
  await call('threads:add-thread', { file: project.file, ...ALICE, body: 'Still a draft', anchor: ANCHOR('Component Verification') });
  assert.equal((await call<WhoAmI>('threads:whoami', ALICE)).orphanedMine, 1);
  assert.equal((await call<WhoAmI>('threads:whoami', BOB)).orphanedMine, 0);
});

test('whoami still returns identity and journal when the orphan scan cannot read a directory', async () => {
  fresh();
  await publishThenOrphan(project.file, QUOTE); // the scan would count 1 if it ran
  const locked = safePath(project.root, path.join('docs', 'locked'));
  fs.mkdirSync(safePath(locked, '.'), { recursive: true });
  const real = fs.promises.readdir;
  let hit = false;
  // A stub rather than chmod: the denial must hold when the suite runs as root.
  fs.promises.readdir = (async (dir: fs.PathLike, options: { withFileTypes: true }) => {
    if (String(dir) === locked) {
      hit = true;
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    }
    return real(dir, options);
  }) as unknown as typeof real;
  try {
    const me = await call<WhoAmI>('threads:whoami', ALICE);
    assert.equal(me.identity?.key, 'k-alice');
    assert.equal(me.journal?.version, 1);
    assert.equal(me.orphanedMine, 0);
    assert.ok(hit, 'the scan reached the unreadable directory');
  } finally {
    fs.promises.readdir = real;
  }
});
