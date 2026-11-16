import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Call = { action: string; payload: Record<string, unknown> };
const calls: Call[] = [];
const storage = new Map<string, string>();
let prompts = 0;
let promptAnswer = 'Prompted';
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const STUBS: Record<string, unknown> = {
  docmd: { call: async (action: string, payload: Record<string, unknown>) => { calls.push({ action, payload }); return {}; } },
  document: { body: { dataset: { sourceFile: 'docs/index.md' } } },
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  },
  prompt: () => { prompts++; return promptAnswer; },
};

type Api = typeof import('../src/client/lib/api.ts');
let api: Api;

before(async () => {
  for (const [k, v] of Object.entries(STUBS)) {
    saved[k] = Object.getOwnPropertyDescriptor(g, k);
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  }
  api = await import('../src/client/lib/api.ts');
});
after(() => {
  for (const k of Object.keys(STUBS)) {
    const d = saved[k] as PropertyDescriptor | undefined;
    if (d) Object.defineProperty(g, k, d);
    else delete g[k];
  }
});
beforeEach(() => {
  calls.length = 0;
  storage.clear();
  prompts = 0;
});

const stored = { author: 'Alice', authorKey: 'alice', avatarUrl: 'http://a/x.png' };
const identify = () => {
  storage.set('threads_author', stored.author);
  storage.set('threads_author_key', stored.authorKey);
  storage.set('threads_avatar_url', stored.avatarUrl);
};

const rows: Array<[string, string, (a: Api) => Promise<unknown>]> = [
  ['fetchThreads', 'threads:get-threads', (a) => a.fetchThreads()],
  ['createThread', 'threads:add-thread', (a) => a.createThread({ anchor: null, author: 'Alice', body: 'b' })],
  ['addComment', 'threads:add-comment', (a) => a.addComment('t-1', { author: 'Alice', body: 'b' })],
  ['editComment', 'threads:edit-comment', (a) => a.editComment('t-1', 'c-1', { body: 'b' })],
  ['deleteComment', 'threads:delete-comment', (a) => a.deleteComment('t-1', 'c-1')],
  ['deleteThread', 'threads:delete-thread', (a) => a.deleteThread('t-1')],
  ['resolveThread', 'threads:resolve-thread', (a) => a.resolveThread('t-1', { resolved_by: 'Alice' })],
  ['toggleReaction', 'threads:toggle-reaction', (a) => a.toggleReaction('t-1', 'c-1', { emoji: '👍', author: 'Alice' })],
];

for (const [name, action, run] of rows) {
  test(`${name} sends the stored identity`, async () => {
    identify();
    await run(api);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, action);
    assert.equal(calls[0].payload.file, 'docs/index.md');
    assert.equal(calls[0].payload.author, stored.author);
    assert.equal(calls[0].payload.authorKey, stored.authorKey);
  });
}

test('fetchThreads without a stored identity sends only the file and never prompts', async () => {
  await api.fetchThreads();
  assert.deepEqual(calls[0].payload, { file: 'docs/index.md' });
  assert.equal(prompts, 0);
});

test('a mutation without a stored identity prompts once and sends the prompted identity', async () => {
  await api.deleteThread('t-1');
  assert.equal(prompts, 1);
  assert.equal(calls[0].payload.author, 'Prompted');
  assert.equal(calls[0].payload.authorKey, 'prompted');
  await api.deleteComment('t-1', 'c-1');
  assert.equal(prompts, 1, 'the prompted name is stored');
  assert.equal(calls[1].payload.authorKey, 'prompted');
});
