import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempProject, makeCtx, type TempProject } from './helpers.ts';
import { checkBody, createRateLimiter } from '../src/plugin/limits.ts';
import { actions } from '../src/plugin/actions.ts';
import { createDraftStore } from '../src/plugin/drafts.ts';
import type { Comment, Thread } from '../src/types.ts';

const code = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof Error && 'code' in e ? String(e.code) : undefined;
  }
  return undefined;
};

test('checkBody: the cap is inclusive, counted in code points', () => {
  const opts = { maxCommentChars: 5 };
  const table: Array<[string, string | undefined]> = [
    ['12345', undefined],
    ['123456', 'limit-chars'],
    ['', undefined],
    ['   ', undefined],
    ['😀😀😀😀😀', undefined],
    ['😀😀😀😀😀😀', 'limit-chars'],
  ];
  for (const [body, want] of table) assert.equal(code(() => checkBody(body, opts)), want, JSON.stringify(body));
});

test('rate limiter: per key, sliding window, rejected calls are not recorded', () => {
  let t = 0;
  const limiter = createRateLimiter({ now: () => t * 1000, windowMs: 60_000, max: 2 });
  const steps: Array<[string, number, string | undefined]> = [
    ['a', 0, undefined],
    ['a', 30, undefined],
    ['a', 59, 'rate-limited'],
    ['b', 59, undefined],
    ['a', 59.5, 'rate-limited'],
    ['a', 61, undefined], // the t=0 hit slid out
    ['a', 62, 'rate-limited'], // t=30 and t=61 still inside
    ['a', 91, undefined], // t=30 slid out
  ];
  for (const [key, at, want] of steps) {
    t = at;
    assert.equal(code(() => limiter.take(key)), want, `${key}@${at}`);
  }
});

test('rate limiter: a call exactly one window old no longer counts', () => {
  let t = 0;
  const limiter = createRateLimiter({ now: () => t, windowMs: 60_000, max: 1 });
  limiter.take('a');
  t = 59_999;
  assert.equal(code(() => limiter.take('a')), 'rate-limited');
  t = 60_000;
  assert.equal(code(() => limiter.take('a')), undefined);
});

type Handler = (payload: Record<string, unknown>, ctx: unknown) => Promise<Thread & Comment>;
const handler = (name: string): Handler => (actions as unknown as Record<string, Handler>)[`threads:${name}`];

let project: TempProject;
before(() => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  project = tempProject();
});
after(() => {
  mock.timers.reset();
  project.cleanup();
});
beforeEach(() => {
  project.reset();
  fs.rmSync(path.join(project.root, 'docs', '.threads'), { recursive: true, force: true });
});

const config = (limits: Record<string, number>) => ({ src: 'docs', plugins: { threads: { limits } } });
const call = (name: string, payload: Record<string, unknown>, limits: Record<string, number> = {}) =>
  handler(name)({ file: project.file, ...payload }, makeCtx(project.root, { config: config(limits) }));
const callServe = (name: string, payload: Record<string, unknown>, identity: string | null, limits: Record<string, number>) =>
  handler(name)(
    { file: project.file, ...payload },
    makeCtx(project.root, { mode: 'serve', config: config(limits), caller: { identity } }),
  );
// Each wiring case owns its keys: the limiter is shared per project root, so cases must not share a window.
const A1 = { author: 'A1', authorKey: 'a1' };
const A2 = { author: 'A2', authorKey: 'a2' };
const B2 = { author: 'B2', authorKey: 'b2' };
const A3 = { author: 'A3', authorKey: 'a3' };
const ops = async (key: string) => (await createDraftStore(path.join(project.root, 'docs')).load(key)).ops;

test('over-long bodies reject on add-thread, add-comment and edit-comment without touching the journal', async () => {
  const limits = { maxCommentChars: 10, commentsPerMinute: 100 };
  const made = await call('add-thread', { ...A1, body: '0123456789' }, limits); // exactly the cap
  assert.equal(made.comments[0].body, '0123456789');
  const reject = async (name: string, extra: Record<string, unknown>) =>
    assert.rejects(call(name, { ...A1, body: '0123456789X', ...extra }, limits), { message: /^threads\/limit-chars/ });
  await reject('add-thread', {});
  await reject('add-comment', { threadId: made.id });
  await reject('edit-comment', { threadId: made.id, commentId: made.comments[0].id });
  const stored = await ops('a1');
  assert.equal(stored.length, 1);
  assert.equal((stored[0] as { body?: string }).body, '0123456789'); // the rejected edit did not fold into the drafted add
});

test('the third add by one key in a minute rejects, another key passes, edits, reactions and resolves are exempt', async () => {
  const limits = { commentsPerMinute: 2 };
  const first = await call('add-thread', { ...A2, body: 'one' }, limits);
  mock.timers.tick(59_000);
  await call('add-comment', { ...A2, threadId: first.id, body: 'two' }, limits);
  await assert.rejects(call('add-comment', { ...A2, threadId: first.id, body: 'three' }, limits), { message: /^threads\/rate-limited/ });
  await assert.rejects(call('add-thread', { ...A2, body: 'three' }, limits), { message: /^threads\/rate-limited/ });
  await call('add-thread', { ...B2, body: 'other key' }, limits);
  await call('edit-comment', { ...A2, threadId: first.id, commentId: first.comments[0].id, body: 'edited' }, limits);
  await call('toggle-reaction', { ...A2, threadId: first.id, commentId: first.comments[0].id, emoji: '👍' }, limits);
  await call('resolve-thread', { ...A2, threadId: first.id }, limits);
  assert.equal((await ops('a2')).length, 4); // two adds, a reaction and a resolve; the edit folded into the drafted add
});

test('a body rejected for length does not use up the rate', async () => {
  const limits = { maxCommentChars: 3, commentsPerMinute: 1 };
  await assert.rejects(call('add-thread', { ...A3, body: 'too long' }, limits), { message: /^threads\/limit-chars/ });
  await call('add-thread', { ...A3, body: 'ok' }, limits);
});

test('under serve: no identity is refused first; the rate is keyed by the trusted identity', async () => {
  const limits = { maxCommentChars: 3, commentsPerMinute: 1 };
  await assert.rejects(callServe('add-thread', { body: 'too long' }, null, limits), { message: /^threads\/no-identity/ });
  await callServe('add-thread', { body: 'one', authorKey: 'x1' }, 'id-serve-1', limits);
  // the payload key is ignored: the same identity is still the same window
  await assert.rejects(callServe('add-thread', { body: 'two', authorKey: 'x2' }, 'id-serve-1', limits), { message: /^threads\/rate-limited/ });
  await callServe('add-thread', { body: 'one', authorKey: 'x1' }, 'id-serve-2', limits);
});
