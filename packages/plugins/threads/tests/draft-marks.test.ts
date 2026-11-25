import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDraftMarks } from '../src/client/lib/draft-marks.ts';
import type { Thread } from '../src/types.ts';

const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({ id, resolved: false, resolved_by: null, resolved_at: null, comments: [], ...extra });
const drafted = (id: string): Thread => thread(id, { draft: true, anchor: { quote: 'some text' } });

const CASES: Array<{ name: string; threads: Thread[]; marks: Array<{ id: string; client: boolean }>; add: string[]; remove: string[] }> = [
  { name: 'drafted with a quote and no mark: highlight', threads: [drafted('d1')], marks: [], add: ['d1'], remove: [] },
  { name: 'drafted already marked by the client: nothing', threads: [drafted('d1')], marks: [{ id: 'd1', client: true }], add: [], remove: [] },
  { name: 'drafted already marked by the markup: nothing', threads: [drafted('d1')], marks: [{ id: 'd1', client: false }], add: [], remove: [] },
  { name: 'published without a mark: nothing is invented', threads: [thread('p1', { anchor: { quote: 'x' } })], marks: [], add: [], remove: [] },
  { name: 'drafted without an anchor: nothing', threads: [thread('d2', { draft: true })], marks: [], add: [], remove: [] },
  { name: 'drafted with an empty quote: nothing', threads: [thread('d3', { draft: true, anchor: { quote: '' } })], marks: [], add: [], remove: [] },
  { name: 'client mark of a draft no longer loaded: remove', threads: [], marks: [{ id: 'gone', client: true }], add: [], remove: ['gone'] },
  { name: 'markup mark of a thread no longer loaded: kept', threads: [], marks: [{ id: 'gone', client: false }], add: [], remove: [] },
  { name: 'published now in the markup, client mark left over: remove the client one', threads: [thread('p2')], marks: [{ id: 'p2', client: true }, { id: 'p2', client: false }], add: [], remove: ['p2'] },
  { name: 'published but the markup is not refreshed yet: keep the client mark', threads: [thread('p3')], marks: [{ id: 'p3', client: true }], add: [], remove: [] },
  { name: 'drafted with both a client and a markup mark: nothing removed', threads: [drafted('d4')], marks: [{ id: 'd4', client: true }, { id: 'd4', client: false }], add: [], remove: [] },
];

for (const c of CASES) {
  test(`planDraftMarks: ${c.name}`, () => {
    const plan = planDraftMarks(c.threads, c.marks);
    assert.deepEqual(plan.add.map((t) => t.id), c.add);
    assert.deepEqual(plan.remove, c.remove);
  });
}
