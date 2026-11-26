import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Tokens whose dark value deliberately does not repeat the light chain (spec: marked "fixed" or recomputed). */
const DELIBERATE = new Set([
  'accent-strong', 'on-accent', 'danger', 'draft', 'color-scheme',
  'hl-yellow', 'hl-yellow-strong', 'hl-blue', 'hl-blue-strong', 'hl-green', 'hl-green-strong',
  'hl-pink', 'hl-pink-strong', 'hl-purple', 'hl-purple-strong', 'hl-orange', 'hl-orange-strong',
]);
/** Formula tokens: declared once in the light block, they recompute from the dark values. */
const FORMULA = ['fg-muted', 'surface-raised', 'fg-strong', 'border-strong', 'accent-soft', 'danger-soft', 'focus'];

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `block ${selector} exists`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*--threads-([a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m) {
      assert.ok(!(m[1] in out), `--threads-${m[1]} declared twice in ${selector}`);
      out[m[1]] = m[2];
    }
  }
  return out;
}

interface VarCall { name: string; fallback: string | null }

/** Top-level `var(--x, fallback)` calls of a value, found by matching parentheses. */
function findVars(value: string): VarCall[] {
  const calls: VarCall[] = [];
  for (let i = 0; i < value.length; i++) {
    if (!value.startsWith('var(', i)) continue;
    let depth = 0;
    let end = i + 3;
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++;
      if (value[end] === ')' && --depth === 0) break;
    }
    const inner = value.slice(i + 4, end);
    const comma = inner.indexOf(',');
    calls.push(comma === -1
      ? { name: inner.trim(), fallback: null }
      : { name: inner.slice(0, comma).trim(), fallback: inner.slice(comma + 1).trim() });
    i = end;
  }
  return calls;
}

const css = stripComments(read('threads.css'));
const light = block(css, ':root');
const dark = block(css, ':root[data-theme="dark"]');

/** True when a value always resolves to something even if no docmd variable exists. */
function hasLiteralFloor(value: string, seen: string[] = []): boolean {
  return findVars(value).every((v) => {
    if (v.fallback !== null) return v.fallback !== '' && hasLiteralFloor(v.fallback, seen);
    const m = v.name.match(/^--threads-(.+)$/);
    if (!m || !(m[1] in light) || seen.includes(m[1])) return false;
    return hasLiteralFloor(light[m[1]], [...seen, m[1]]);
  });
}

const names = (value: string) => {
  const chain: string[] = [];
  for (let calls = findVars(value); calls.length; calls = calls[0].fallback ? findVars(calls[0].fallback) : []) {
    chain.push(calls[0].name);
  }
  return chain;
};

function clientFiles(dir = ''): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? clientFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [],
  );
}

test('light block: every token resolves to a literal when no docmd variable exists', () => {
  assert.ok(Object.keys(light).length >= 40, 'the full token list is declared');
  for (const [name, value] of Object.entries(light)) {
    assert.ok(hasLiteralFloor(value), `--threads-${name}: ${value} has no literal last fallback`);
  }
});

test('every --threads-* a value refers to is declared in the light block', () => {
  for (const [name, value] of [...Object.entries(light), ...Object.entries(dark)]) {
    for (const v of findVars(value)) {
      if (v.name.startsWith('--threads-')) assert.ok(v.name.slice(10) in light, `${name} refers to undeclared ${v.name}`);
    }
  }
});

test('dark block: every entry is a light token, repeats the full chain and keeps a literal last fallback', () => {
  for (const [name, value] of Object.entries(dark)) {
    assert.ok(name in light, `dark --threads-${name} has no light declaration`);
    assert.ok(hasLiteralFloor(value), `dark --threads-${name}: ${value} has no literal last fallback`);
    if (DELIBERATE.has(name)) continue;
    assert.ok(/^var\(/.test(value), `dark --threads-${name} is a bare value; it would beat the template's dark variable`);
    assert.deepEqual(names(value), names(light[name]), `dark --threads-${name} must repeat the light var() chain`);
  }
});

test('dark block: formula tokens are declared once, in the light block', () => {
  for (const name of FORMULA) {
    assert.ok(name in light, `--threads-${name} is declared in the light block`);
    assert.ok(!(name in dark), `--threads-${name} must not be redeclared in the dark block`);
  }
});

test('dark block: the docmd-driven colours and the whole highlight palette have a dark value', () => {
  for (const name of ['surface', 'surface-muted', 'fg', 'border', 'accent', 'accent-strong', 'on-accent', 'danger', 'draft']) {
    assert.ok(name in dark, `--threads-${name} needs a dark value`);
  }
  for (const hue of ['yellow', 'blue', 'green', 'pink', 'purple', 'orange']) {
    assert.ok(`hl-${hue}` in dark && `hl-${hue}-strong` in dark, `hl-${hue} needs dark values`);
  }
});

test('highlight palette is complete in both modes', () => {
  for (const hue of ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'neutral']) {
    assert.ok(`hl-${hue}` in light && `hl-${hue}-strong` in light, `hl-${hue} declared`);
  }
});

/** Per-use inputs the app sets on one element, not tokens: where the selection button is placed. */
const POSITION_PROPS = new Set(['selection-x', 'selection-y']);

test('code under src/client refers only to declared --threads-* tokens', () => {
  for (const file of clientFiles()) {
    for (const m of read(file).matchAll(/--threads-([a-z0-9-]+)/g)) {
      if (POSITION_PROPS.has(m[1])) continue;
      assert.ok(m[1] in light, `${file} uses undeclared --threads-${m[1]}`);
    }
  }
});

test('tokens.ts aliases every token as --_name with a literal fallback', () => {
  const src = read('components/tokens.ts');
  const aliases = new Map<string, string>();
  for (const m of src.matchAll(/--_([a-z0-9-]+):\s*var\(--threads-([a-z0-9-]+),\s*([^;]+)\);/g)) {
    assert.equal(m[1], m[2], `alias --_${m[1]} maps to --threads-${m[2]}`);
    assert.ok(!m[3].includes('var('), `fallback of --_${m[1]} is a literal`);
    assert.ok(m[3].trim() !== '', `fallback of --_${m[1]} is not empty`);
    aliases.set(m[1], m[3]);
  }
  assert.deepEqual([...aliases.keys()].sort(), Object.keys(light).sort());
});

test('components read only declared --_* aliases', () => {
  const aliases = new Set(Object.keys(light));
  const local = new Set(['avatar-size']);
  for (const file of clientFiles()) {
    if (file.endsWith('tokens.ts')) continue;
    for (const m of read(file).matchAll(/var\(--_([a-z0-9-]+)/g)) {
      assert.ok(aliases.has(m[1]) || local.has(m[1]), `${file} uses unknown --_${m[1]}`);
    }
  }
});

test('no --tc-* reads or dead dark selectors remain', () => {
  for (const file of clientFiles()) {
    const src = read(file);
    assert.ok(!/--tc-/.test(src), `${file} still uses --tc-*`);
    assert.ok(!/summer-text/.test(src), `${file} refers to --summer-text`);
    assert.ok(!/html\.dark|body\.dark/.test(src), `${file} has a dead .dark selector`);
  }
});
