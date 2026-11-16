import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safePath } from '@docmd/utils';
import { tempProject, makeCtx, MarkdownIt, type TempProject, type TestCtx } from './helpers.ts';
import { actions } from '../src/plugin/actions.ts';
import * as plugin from '../src/index.ts';
import { ThreadsError } from '../src/plugin/errors.ts';
import type { Thread, Comment } from '../src/types.ts';

let project: TempProject;
before(() => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-10T12:00:00Z') });
  project = tempProject();
});
after(() => {
  mock.timers.reset();
  project.cleanup();
});
beforeEach(() => {
  project.reset();
  stripThreads();
});

/** The fixture ships with a threads block; most flows start from the page without it. */
function stripThreads() {
  const file = safePath(project.root, project.file);
  const content = fs.readFileSync(file, 'utf8');
  const idx = content.indexOf('::: threads');
  assert.ok(idx >= 0, 'fixture has a threads block');
  fs.writeFileSync(file, content.slice(0, idx));
}

/** Actions return threads, a thread, a comment or a small status object; tests read the shape they expect. */
type ActionResult = Thread & Thread[] & Comment & Record<string, unknown>;

/** Call an action like the dispatcher does and report whether it asked for a reload. */
async function call(name: string, payload: Record<string, unknown>) {
  const handler = (actions as Record<string, (payload: unknown, ctx: TestCtx) => Promise<unknown>>)[name];
  assert.ok(handler, `Unknown action: ${name}`);
  const ctx = makeCtx(project.root);
  const result = (await handler(payload, ctx)) as ActionResult;
  return { result, reload: ctx.source._modified === true };
}

const read = (rel: string = project.file) => fs.readFileSync(safePath(project.root, rel), 'utf8');

async function addThread(extra: Record<string, unknown> = {}) {
  const { result } = await call('threads:add-thread', {
    file: project.file, author: 'alice', body: 'This needs to be reworded.', anchor: '#section-1', ...extra,
  });
  return result;
}

// Depends on e2e/fixtures/playground-index.md: update together if that fixture's threads change.
test('get-threads reads the threads of the fixture page without reloading', async () => {
  project.reset();
  const { result, reload } = await call('threads:get-threads', { file: project.file });
  assert.equal(reload, false);
  assert.deepEqual(result.map((t: Thread) => t.id), ['t-thread1', 't-thread2', 't-thread3']);
  assert.deepEqual(result.map((t: Thread) => t.resolved), [false, false, true]);
  assert.deepEqual(result[0].comments.map((c: Comment) => c.author), ['Alice', 'Bob']);
  assert.equal(result[2].resolved_by, 'Alice');
});

test('get-threads on a file without threads returns [] and does not reload', async () => {
  const { result, reload } = await call('threads:get-threads', { file: project.file });
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
  assert.equal(reload, false);
});

test('add-thread creates a thread with ids and reloads', async () => {
  const { result: thread, reload } = await call('threads:add-thread', {
    file: project.file, author: 'alice', body: 'This needs to be reworded.', anchor: '#section-1',
  });
  assert.equal(reload, true);
  assert.ok(thread.id.startsWith('t-'));
  assert.equal(thread.id.length, 10);
  assert.equal(thread.resolved, false);
  assert.equal(thread.comments.length, 1);
  assert.equal(thread.comments[0].author, 'alice');
  assert.equal(thread.comments[0].body, 'This needs to be reworded.');
  assert.equal(thread.comments[0].date, '2026-03-10');
  assert.ok(thread.comments[0].id.startsWith('c-'));
  assert.equal(thread.comments[0].id.length, 10);
});

test('add-comment appends to the thread and get-threads returns both', async () => {
  const thread = await addThread();
  const { result: comment, reload } = await call('threads:add-comment', {
    file: project.file, threadId: thread.id, author: 'bob', body: 'I agree, let me fix it.',
  });
  assert.equal(reload, true);
  assert.ok(comment.id.startsWith('c-'));
  assert.equal(comment.author, 'bob');
  assert.equal(comment.body, 'I agree, let me fix it.');
  assert.equal(comment.date, '2026-03-10');
  assert.equal(comment.thread_id, thread.id);

  const { result: threads } = await call('threads:get-threads', { file: project.file });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].comments.length, 2);
  assert.equal(threads[0].comments[0].author, 'alice');
  assert.equal(threads[0].comments[1].author, 'bob');
});

test('edit-comment updates body and edited_at', async () => {
  const thread = await addThread();
  await call('threads:add-comment', { file: project.file, threadId: thread.id, author: 'bob', body: 'first try' });
  const { result: before } = await call('threads:get-threads', { file: project.file });
  const commentId = before[0].comments[1].id;

  const { result, reload } = await call('threads:edit-comment', {
    file: project.file, threadId: thread.id, commentId, body: 'Updated: I will fix it tomorrow.',
  });
  assert.equal(reload, true);
  assert.equal(result.body, 'Updated: I will fix it tomorrow.');
  assert.equal(result.edited_at, '2026-03-10');

  const { result: after } = await call('threads:get-threads', { file: project.file });
  assert.equal(after[0].comments[1].body, 'Updated: I will fix it tomorrow.');
  assert.equal(after[0].comments[1].edited_at, '2026-03-10');
});

test('toggle-reaction adds authors and removes the reaction when the last leaves', async () => {
  const thread = await addThread();
  const { result: threads } = await call('threads:get-threads', { file: project.file });
  const commentId = threads[0].comments[0].id;
  const react = (author: string) => call('threads:toggle-reaction', {
    file: project.file, threadId: thread.id, commentId, emoji: '👍', author,
  });

  const first = await react('bob');
  assert.equal(first.reload, true);
  assert.equal(first.result.length, 1);
  assert.equal(first.result[0].emoji, '👍');
  assert.deepEqual(first.result[0].authors, ['bob']);

  const second = await react('charlie');
  assert.equal(second.result.length, 1);
  assert.deepEqual(second.result[0].authors, ['bob', 'charlie']);

  const third = await react('bob');
  assert.equal(third.result.length, 1);
  assert.deepEqual(third.result[0].authors, ['charlie']);

  const fourth = await react('charlie');
  assert.equal(fourth.result.length, 0);
});

test('resolve-thread toggles resolved state', async () => {
  const thread = await addThread();
  const resolve = () => call('threads:resolve-thread', { file: project.file, threadId: thread.id, resolved_by: 'alice' });

  const resolved = await resolve();
  assert.equal(resolved.reload, true);
  assert.equal(resolved.result.resolved, true);
  assert.equal(resolved.result.resolved_by, 'alice');
  assert.equal(resolved.result.resolved_at, '2026-03-10');

  const unresolved = await resolve();
  assert.equal(unresolved.result.resolved, false);
  assert.equal(unresolved.result.resolved_by, null);
  assert.equal(unresolved.result.resolved_at, null);
});

test('delete-comment removes the comment', async () => {
  const thread = await addThread();
  await call('threads:add-comment', { file: project.file, threadId: thread.id, author: 'bob', body: 'reply' });
  const { result: before } = await call('threads:get-threads', { file: project.file });

  const { result, reload } = await call('threads:delete-comment', {
    file: project.file, threadId: thread.id, commentId: before[0].comments[1].id,
  });
  assert.equal(reload, true);
  assert.deepEqual(result, { deleted: true });

  const { result: after } = await call('threads:get-threads', { file: project.file });
  assert.equal(after[0].comments.length, 1);
  assert.equal(after[0].comments[0].author, 'alice');
});

test('delete-thread removes the thread and the threads block', async () => {
  const thread = await addThread();
  const { result, reload } = await call('threads:delete-thread', { file: project.file, threadId: thread.id });
  assert.equal(reload, true);
  assert.deepEqual(result, { deleted: true });

  const { result: after } = await call('threads:get-threads', { file: project.file });
  assert.equal(after.length, 0);
  const content = read();
  assert.ok(content.includes('Threads Plugin Test'));
  assert.ok(!content.includes('::: threads'));
});

test('add-thread with an anchor wraps the quote in highlight markup before the block', async () => {
  const { result: thread, reload } = await call('threads:add-thread', {
    file: project.file,
    author: 'alice',
    body: 'This is important',
    anchor: {
      quote: 'verify core engine changes',
      prefix: 'used to ',
      suffix: ' in real-time',
      selector: 'p',
      offset: 0,
      blockText: 'This playground is used to verify core engine changes in real-time.',
    },
  });
  assert.equal(reload, true);
  const content = read();
  const mark = `==verify core engine changes=={${thread.id}}`;
  assert.ok(content.includes(mark), content);
  assert.ok(content.includes('::: threads'));
  assert.ok(content.indexOf(mark) < content.indexOf('::: threads'));
});

test('add-thread anchor does not match text inside an existing threads block', async () => {
  fs.writeFileSync(safePath(project.root, project.file), [
    '# Test', '', 'Some unique phrase here.', '',
    '::: threads', '### t-existing', '- resolved: false', '',
    '#### c-existing', '- author: bob', '- date: 2026-01-01', '',
    'Some unique phrase here.', '', ':::', '',
  ].join('\n'));

  const thread = await addThread({ body: 'Noting this phrase', anchor: { quote: 'unique phrase' } });
  const content = read();
  const mark = `==unique phrase=={${thread.id}}`;
  assert.ok(content.indexOf(mark) >= 0, content);
  assert.ok(content.indexOf(mark) < content.indexOf('::: threads'));
});

test('delete-thread removes the highlight markup but keeps the text', async () => {
  const thread = await addThread({ anchor: { quote: 'verify core engine changes' } });
  assert.ok(read().includes(`==verify core engine changes=={${thread.id}}`));

  await call('threads:delete-thread', { file: project.file, threadId: thread.id });
  const content = read();
  assert.ok(!content.includes('==verify core engine changes=={'));
  assert.ok(content.includes('verify core engine changes'));
});

test('input validation rejects missing fields', async () => {
  const rejects = (name: string, payload: Record<string, unknown>, msg: string) =>
    assert.rejects(call(name, payload), (e: Error) => e.message.includes(msg));

  await rejects('threads:get-threads', {}, 'threads/invalid: threads:get-threads: file is required');
  await rejects('threads:add-thread', { file: '', author: 'alice', body: 'hi' }, 'file is required');
  await rejects('threads:add-thread', { file: project.file, author: '', body: 'hi' }, 'author is required');
  await rejects('threads:add-thread', { file: project.file, author: 'alice', body: '   ' }, 'body is required');
});

test('lookup and validation failures carry the threads/<code> prefix', async () => {
  const rejects = (name: string, payload: Record<string, unknown>, msg: string) =>
    assert.rejects(call(name, payload), (e: Error) => e.message === msg);
  await rejects('threads:edit-comment', { file: project.file, threadId: 't-nope', commentId: 'c-1', body: 'x' },
    'threads/not-found: Thread not found: t-nope');
  const thread = await addThread(); // beforeEach strips the fixture's threads
  await rejects('threads:edit-comment', { file: project.file, threadId: thread.id, commentId: 'c-nope', body: 'x' },
    'threads/not-found: Comment not found: c-nope');
  await rejects('threads:delete-thread', { file: project.file, threadId: 't-nope' },
    'threads/not-found: Thread not found: t-nope');
});

test('plugin surface: descriptor, hooks and action names', () => {
  assert.equal(plugin.plugin.name, 'threads');
  assert.ok(plugin.plugin.capabilities?.includes('actions'));
  assert.equal(plugin.plugin.requiresLiveServer, true);
  assert.equal(typeof plugin.markdownSetup, 'function');
  assert.equal(typeof plugin.generateScripts, 'function');
  assert.equal(typeof plugin.getAssets, 'function');
  assert.equal(typeof plugin.actions, 'object');
  for (const name of ['add-thread', 'add-comment', 'toggle-reaction', 'get-threads']) {
    assert.equal(typeof plugin.actions[`threads:${name}`], 'function', name);
  }
  const assets = plugin.getAssets();
  const scripts = plugin.generateScripts({ src: path.join(project.root, 'docs') }, { sidebar: true });
  assert.ok(scripts.bodyScriptsHtml.includes('window.__threads_config={"sidebar":true};'));
  for (const opts of [{}, undefined]) {
    const out = plugin.generateScripts({ src: path.join(project.root, 'docs') }, opts);
    assert.ok(out.bodyScriptsHtml.includes('window.__threads_config={"sidebar":false};'));
  }
  // An invalid value surfaces as a config error, once; later pages fall back to defaults.
  const bad = { sidebar: 'yes' };
  assert.throws(
    () => plugin.generateScripts({ src: path.join(project.root, 'docs') }, bad),
    (e: unknown) => e instanceof ThreadsError && e.code === 'config',
  );
  assert.ok(plugin.generateScripts({ src: path.join(project.root, 'docs') }, bad)
    .bodyScriptsHtml.includes('window.__threads_config={"sidebar":false};'));
  // markdownSetup wires containers and the highlight rule together.
  const md = MarkdownIt();
  plugin.markdownSetup(md);
  const html = md.render('==x=={t-1}\n\n::: threads\n  ::: thread t-1\n    ::: comment c-1 "a" "2026-01-01"\n      hi\n    :::\n  :::\n:::\n');
  assert.ok(html.includes('threads-thread'));
  assert.ok(html.includes('<mark'));
  assert.deepEqual(assets.map((a: { dest: string }) => a.dest), ['assets/js/threads.js', 'assets/css/threads.css']);
});
