import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAuthorsFile } from '../src/plugin/authors.ts';
import * as plugin from '../src/index.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-authors-loader-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const site = (authors?: string): string => {
  const src = fs.mkdtempSync(path.join(root, 'site-'));
  if (authors !== undefined) {
    fs.mkdirSync(path.join(src, '.threads'));
    fs.writeFileSync(path.join(src, '.threads', 'authors.json'), authors);
  }
  return src;
};
const file = (src: string) => path.join(src, '.threads', 'authors.json');
/** Count the reads of authors.json while `fn` runs. */
function reads(src: string, fn: () => void): number {
  const real = fs.readFileSync;
  const spy = mock.method(fs, 'readFileSync', ((p: unknown, ...rest: unknown[]) => (real as (...a: unknown[]) => unknown)(p, ...rest)) as typeof fs.readFileSync);
  try {
    fn();
    return spy.mock.calls.filter((c) => String(c.arguments[0]) === file(src)).length;
  } finally {
    spy.mock.restore();
  }
}

test('loadAuthorsFile: a missing file or folder is {}', () => {
  assert.deepEqual(loadAuthorsFile(site()), {});
  assert.deepEqual(loadAuthorsFile(path.join(root, 'nope')), {});
});

test('loadAuthorsFile: parses once per process while the file is unchanged, again when it changes', () => {
  const src = site(JSON.stringify({ a: { name: 'A', avatarUrl: '' } }));
  assert.equal(reads(src, () => assert.deepEqual(loadAuthorsFile(src), { a: { name: 'A', avatarUrl: '' } })), 1);
  assert.equal(reads(src, () => { loadAuthorsFile(src); loadAuthorsFile(src); }), 0, 'served from the cache');
  assert.equal(loadAuthorsFile(src), loadAuthorsFile(src), 'the same object each time');

  fs.writeFileSync(file(src), JSON.stringify({ b: { name: 'B', avatarUrl: '' } }));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file(src), later, later);
  assert.deepEqual(loadAuthorsFile(src), { b: { name: 'B', avatarUrl: '' } }, 'a changed file is read again');

  fs.rmSync(file(src));
  assert.deepEqual(loadAuthorsFile(src), {}, 'a deleted file is gone from the result');
});

test('loadAuthorsFile: arrays, primitives and bad JSON are {}; the bad JSON is logged once per version of the file', () => {
  for (const text of ['[]', '7', 'null', '"x"']) assert.deepEqual(loadAuthorsFile(site(text)), {}, text);
  const src = site('{ not json');
  const err = mock.method(console, 'error', () => {});
  try {
    assert.deepEqual(loadAuthorsFile(src), {});
    assert.deepEqual(loadAuthorsFile(src), {});
    assert.equal(err.mock.callCount(), 1, 'one log line, not one per page');
    assert.match(String(err.mock.calls[0].arguments[0]), /Failed to parse \.threads\/authors\.json/);
  } finally {
    err.mock.restore();
  }
});

test('generateScripts reads authors through the shared loader and passes profileUrl to the client', () => {
  const src = site(JSON.stringify({ a: { name: 'A', avatarUrl: '', link: 'https://a.example' } }));
  const out = plugin.generateScripts({ src }, { profileUrl: 'https://github.com/{id}' });
  assert.ok(out.bodyScriptsHtml.includes('window.__threads_authors={"a":{"name":"A","avatarUrl":"","link":"https://a.example"}};'), out.bodyScriptsHtml);
  assert.ok(out.bodyScriptsHtml.includes('"profileUrl":"https://github.com/{id}"'), out.bodyScriptsHtml);
  assert.equal(reads(src, () => { plugin.generateScripts({ src }, {}); plugin.generateScripts({ src }, {}); }), 0, 'later pages reuse the parse');
});
