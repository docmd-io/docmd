import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadPickerModule, resetPickerLoads } from '../src/client/lib/picker-loader.ts';

beforeEach(() => resetPickerLoads());

test('the module is imported once per URL, however many clicks ask', async () => {
  let calls = 0;
  const importer = async (src: string) => { calls++; return { src }; };
  const [a, b] = await Promise.all([loadPickerModule('/p.js', importer), loadPickerModule('/p.js', importer)]);
  assert.equal(a, b);
  await loadPickerModule('/p.js', importer);
  assert.equal(calls, 1);
});

test('a different URL is a different load', async () => {
  let calls = 0;
  const importer = async () => { calls++; return {}; };
  await loadPickerModule('/a.js', importer);
  await loadPickerModule('/b.js', importer);
  assert.equal(calls, 2);
});

test('a failed load is not kept: the next click tries again', async () => {
  let calls = 0;
  const importer = async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { ok: true };
  };
  await assert.rejects(loadPickerModule('/p.js', importer), /offline/);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await loadPickerModule('/p.js', importer), { ok: true });
  assert.equal(calls, 2);
});
