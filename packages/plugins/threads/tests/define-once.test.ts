import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../src/client/components');

test('every element registers through defineOnce, never @customElement, so a second bundle does not throw', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'define.ts');
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/@customElement\(/.test(src) && !/\bcustomElements\.define\(/.test(src), `${f} registers without a guard`);
    if (/extends LitElement/.test(src)) assert.match(src, /defineOnce\('threads-[a-z-]+', \w+\)/, `${f} does not call defineOnce`);
  }
});

test('every profile link in a component carries rel="nofollow noopener ugc"', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/<a\b[^>]*href=\$\{[^}]*\}[^>]*>/g)) {
      if (/class="link"/.test(m[0])) continue; // in-page links to a thread, not people
      assert.match(m[0], /rel="nofollow noopener ugc"/, `${f}: ${m[0]}`);
    }
  }
});
