/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Dev watcher quiet window: a save inside the window after a content
 * rebuild is rebuilt once the window passes; the rebuild's own events
 * (signature unchanged) do not loop. Injected clock and timers, no sleeps.
 *
 * Run: `node tests/runner.js --only=dev-quiet-window`
 * --------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup, runTestFile } from '../shared.js';
import { safePath } from '../../packages/utils/dist/path.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const { createQuietWindow } = await import(pathToFileURL(path.join(ROOT, 'packages/core/dist/commands/dev-quiet-window.js')).href);
const { FileSignatureTracker } = await import(pathToFileURL(path.join(ROOT, 'packages/utils/dist/index.js')).href);

let passed = 0;
let failed = 0;
const failures = [];
function assert(condition, message) {
  if (!condition) { failed++; failures.push(message); console.log(`    ❌ ${message}`); }
  else { passed++; console.log(`    ✅ ${message}`); }
}

const QUIET = 1000;

// The dev watcher's pipeline: quiet window -> signature gate -> rebuild.
// A rebuild "finishes" instantly at the fake clock's current time.
function harness(dir, name) {
  const file = safePath(dir, name);
  let clock = 10_000;
  const timers = [];
  const tracker = new FileSignatureTracker();
  const rebuilds = [];
  const win = createQuietWindow({
    quietMs: QUIET,
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ at: clock + ms, fn })
  });
  const rebuild = () => { rebuilds.push(fs.readFileSync(safePath(dir, name), 'utf8')); win.markRebuilt(); };
  const onEvent = () => win.event(file, () => { if (tracker.hasChanged(file)) rebuild(); });
  const advance = (ms) => {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > target) break;
      const t = timers.shift();
      clock = Math.max(clock, t.at);
      t.fn();
    }
    clock = target;
  };
  return { onEvent, advance, rebuilds, rebuild, tracker };
}

// Writes with a distinct size so the mtime+size signature always differs.
const save = (dir, name, text) => fs.writeFileSync(safePath(dir, name), text);

export const test = runTestFile({
  name: 'Dev watcher quiet window',
  emoji: '⏱️',
  run: () => {
    const dir = setup('dev-quiet-window');
    const name = 'page.md';

    {
      save(dir, name, '# one\n');
      const h = harness(dir, name);
      h.onEvent(); // first edit, outside the window
      assert(h.rebuilds.length === 1, 'first edit rebuilds');

      h.advance(300);
      save(dir, name, '# one\n\nsecond save, inside the quiet window\n');
      h.onEvent();
      assert(h.rebuilds.length === 1, 'an edit inside the window waits for the window to end');
      h.advance(QUIET);
      assert(h.rebuilds.length === 2 && h.rebuilds[1].includes('second save'), 'an edit saved inside the window is rebuilt once it passes');
    }

    {
      save(dir, name, '# one\n');
      const h = harness(dir, name);
      h.onEvent();
      assert(h.rebuilds.length === 1, 'setup: initial rebuild');
      // The rebuild's own events: the file is unchanged, so no rebuild, no loop.
      h.advance(100); h.onEvent(); h.advance(200); h.onEvent(); h.onEvent();
      h.advance(5 * QUIET);
      assert(h.rebuilds.length === 1, 'events from the rebuild itself (unchanged file) do not rebuild');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
