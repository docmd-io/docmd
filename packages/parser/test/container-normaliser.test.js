/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Phase 2 container normaliser — edge-case test fixture
 *
 * These tests cover the five reported F1–F5 failure modes plus the
 * 50+ edge cases that derive from the shim's own warning surface
 * (battle-test-reports/robust-parser-shim/index.js) and the
 * `normaliseContainers` algorithm.
 *
 * Test categories (in order):
 *   1.  classifyLine — open / close / other classification
 *   2.  indentOf     — leading-space counting
 *   3.  normaliseContainers — core algorithm (no warnings)
 *   4.  normaliseContainers — warning surface
 *   5.  F1–F5 reported failure modes
 *   6.  processContentAsync integration — end-to-end HTML
 *   7.  Determinism — identical output across threads / replays
 *
 * Run: `pnpm --filter @docmd/parser test`
 * --------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseContainers,
  classifyLine,
  indentOf,
  SELF_CLOSING_CONTAINER_NAMES,
  createMarkdownProcessor,
  processContentAsync
} from '../dist/index.js';

// ─────────────────────────────────────────────────────────────────────
// 1. classifyLine
// ─────────────────────────────────────────────────────────────────────

test('classifyLine: `::: callout` is open with name `callout`', () => {
  assert.deepEqual(classifyLine('::: callout'), { kind: 'open', name: 'callout' });
});

test('classifyLine: `::: callout info "Title"` is open, name is the first word', () => {
  assert.deepEqual(
    classifyLine('::: callout info "Title"'),
    { kind: 'open', name: 'callout' }
  );
});

test('classifyLine: `:::card` (no space) is still open (zero-or-more whitespace)', () => {
  assert.deepEqual(classifyLine(':::card'), { kind: 'open', name: 'card' });
});

test('classifyLine: `:::` is close', () => {
  assert.deepEqual(classifyLine(':::'), { kind: 'close' });
});

test('classifyLine: `::: ` (trailing whitespace) is close', () => {
  assert.deepEqual(classifyLine('::: '), { kind: 'close' });
});

test('classifyLine: `  ::: callout` (leading indent) is still open', () => {
  assert.deepEqual(
    classifyLine('  ::: callout'),
    { kind: 'open', name: 'callout' }
  );
});

test('classifyLine: `:::: callout` (four colons) is NOT matched as open or close', () => {
  // Three colons then a fourth colon is not whitespace, so `[a-zA-Z]` fails.
  // The line passes through to the parser unchanged.
  assert.equal(classifyLine(':::: callout').kind, 'other');
});

test('classifyLine: `::: 123abc` (leading digit) is NOT open', () => {
  // Name must start with a letter.
  assert.equal(classifyLine('::: 123abc').kind, 'other');
});

test('classifyLine: `:::-foo` (hyphen, not letter) is NOT open', () => {
  assert.equal(classifyLine(':::-foo').kind, 'other');
});

test('classifyLine: `plain text` is other', () => {
  assert.equal(classifyLine('plain text').kind, 'other');
});

test('classifyLine: empty string is other', () => {
  assert.equal(classifyLine('').kind, 'other');
});

// ─────────────────────────────────────────────────────────────────────
// 2. indentOf
// ─────────────────────────────────────────────────────────────────────

test('indentOf: empty line is 0', () => {
  assert.equal(indentOf(''), 0);
});

test('indentOf: line with no leading spaces is 0', () => {
  assert.equal(indentOf('::: callout'), 0);
});

test('indentOf: 4 leading spaces is 4', () => {
  assert.equal(indentOf('    ::: callout'), 4);
});

test('indentOf: 8 leading spaces is 8', () => {
  assert.equal(indentOf('        ::: card'), 8);
});

// ─────────────────────────────────────────────────────────────────────
// 3. normaliseContainers — core algorithm (no warnings expected)
// ─────────────────────────────────────────────────────────────────────

test('normaliseContainers: empty input is unchanged', () => {
  const r = normaliseContainers('');
  assert.equal(r.source, '');
  assert.deepEqual(r.warnings, []);
});

test('normaliseContainers: input with no `:::` is unchanged', () => {
  const src = '# Title\n\nSome **bold** text.\n\n- list item\n';
  const r = normaliseContainers(src);
  assert.equal(r.source, src);
  assert.deepEqual(r.warnings, []);
});

test('normaliseContainers: balanced single callout is unchanged', () => {
  const src = '::: callout info "Title"\nbody\n:::\n';
  const r = normaliseContainers(src);
  assert.equal(r.source, src);
  assert.deepEqual(r.warnings, []);
});

test('normaliseContainers: self-closing `::: button` passes through with no stack push', () => {
  const src = '::: button "Click me"\n';
  const r = normaliseContainers(src);
  assert.equal(r.source, src);
  assert.deepEqual(r.warnings, []);
});

test('normaliseContainers: SELF_CLOSING_CONTAINER_NAMES has exactly button/tag/embed', () => {
  // The whitelist is the source of truth for the depth counter's behaviour.
  // Adding or removing names here is a parser-semantics change.
  assert.deepEqual(
    [...SELF_CLOSING_CONTAINER_NAMES].sort(),
    ['button', 'embed', 'tag']
  );
});

test('normaliseContainers: three self-closing tags then a stray `:::` removes the stray', () => {
  // F2 — orphan `:::` after self-closing tags must be dropped.
  const src = '::: tag "a"\n::: tag "b"\n::: tag "c"\n:::\n';
  const r = normaliseContainers(src);
  assert.equal(r.source, '::: tag "a"\n::: tag "b"\n::: tag "c"\n');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].severity, 'warning');
  assert.match(r.warnings[0].message, /Stray `:::`/);
});

test('normaliseContainers: nested callout/card with one implicit close emits 2 closes', () => {
  // Inner `::: card` is at indent 4; user's `:::` is at indent 0 → the
  // close at indent 0 matches the OUTER callout, and the inner card is
  // closed implicitly. Algorithm emits 2 closes at indent 0 (one replaces
  // the user's `:::`, one is added for the card).
  const src = '::: callout\n    ::: card "x"\n    body\n:::\n';
  const r = normaliseContainers(src);
  const lines = r.source.split('\n');
  const closeCount = lines.filter((l) => /^:::\s*$/.test(l)).length;
  assert.equal(closeCount, 2, `expected 2 closes at indent 0, got ${closeCount}`);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].severity, 'info');
});

test('normaliseContainers: indented open matched by greater-indent close', () => {
  // Open at indent 4, close at indent 8 (deeper indent). The shim's
  // matching rule is `open.indent <= close.indent` so 4 <= 8 matches.
  // The original `:::` is replaced with one at the open's indent.
  const src = '    ::: card "x"\nbody\n        :::\n';
  const r = normaliseContainers(src);
  // The original close is rewritten at the open's indent (4 spaces).
  assert.match(r.source, / {4}::: card "x"\n/);
  assert.match(r.source, /\n {4}:::/);
  // No warnings — this is a balanced container.
  assert.deepEqual(r.warnings, []);
});

test('normaliseContainers: close LESS indented than open is stray, container auto-closes at EOF', () => {
  // Open at indent 4, close at indent 0. The shim's matching rule is
  // `open.indent <= close.indent` so 4 <= 0 fails → stray close. The
  // card then auto-closes at EOF with an ERROR (at the card's indent).
  const src = '    ::: card "x"\nbody\n:::\n';
  const r = normaliseContainers(src);
  // The stray close at indent 0 is removed; the card is auto-closed at
  // EOF at the card's original indent (4 spaces).
  assert.doesNotMatch(r.source, /\n:::\s*$/);
  assert.match(r.source, /\n {4}:::\s*$/);
  // Warnings: 1 stray (warning) + 1 unclosed (error).
  const stray = r.warnings.find((w) => w.severity === 'warning');
  const unclosed = r.warnings.find((w) => w.severity === 'error');
  assert.ok(stray, 'expected a stray-close warning');
  assert.ok(unclosed, 'expected an unclosed-at-EOF error');
  assert.match(unclosed.message, /Unclosed `<card>`/);
});

test('normaliseContainers: over-indented close is normalised, not stray', () => {
  // Open at indent 0, close at indent 4 → close's indent (4) >= open's
  // indent (0), so they match. The over-indented close is rewritten to
  // the open's indent. This is the normaliser's signature behaviour:
  // it lets users get the indent wrong without breaking the page.
  const src = '::: callout\nbody\n    :::\n';
  const r = normaliseContainers(src);
  // The callout is closed cleanly with no warnings.
  assert.equal(r.source, '::: callout\nbody\n:::\n');
  assert.deepEqual(r.warnings, []);
});

test('normaliseContainers: unclosed at EOF is auto-closed with an error', () => {
  // F4 / F3 class — file ends with an open container still on the stack.
  const src = '::: callout\nbody\n';
  const r = normaliseContainers(src);
  // Source ends with the auto-close at indent 0 (callout's indent). The
  // original body line ended with `\n`, so there are two newlines
  // between `body` and the inserted `:::`.
  assert.match(r.source, /\n:::\s*$/);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].severity, 'error');
  assert.match(r.warnings[0].message, /Unclosed `<callout>`/);
});

test('normaliseContainers: multiple unclosed at EOF each emit an error', () => {
  const src = '::: callout\n::: card "x"\n';
  const r = normaliseContainers(src);
  // Two auto-closes are appended, one per open frame.
  assert.match(r.source, /\n:::\n:::\s*$/);
  const errors = r.warnings.filter((w) => w.severity === 'error');
  assert.equal(errors.length, 2);
  // Inner card is reported first (LIFO from the stack).
  assert.match(errors[0].message, /<card>/);
  assert.match(errors[1].message, /<callout>/);
});

// ─────────────────────────────────────────────────────────────────────
// 4. normaliseContainers — warning surface
// ─────────────────────────────────────────────────────────────────────

test('normaliseContainers: stray `:::` at top level produces a warning with the line number', () => {
  const r = normaliseContainers(':::\n');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].line, 1);
  assert.equal(r.warnings[0].severity, 'warning');
});

test('normaliseContainers: sourcePath is reflected in warnings', () => {
  const r = normaliseContainers(':::\n', { sourcePath: 'docs/page.md' });
  assert.equal(r.warnings[0].path, 'docs/page.md');
});

test('normaliseContainers: sourcePath defaults to `<source>`', () => {
  const r = normaliseContainers(':::\n');
  assert.equal(r.warnings[0].path, '<source>');
});

test('normaliseContainers: onWarning callback fires alongside the returned array', () => {
  const collected = [];
  const r = normaliseContainers(':::\n', { onWarning: (w) => collected.push(w) });
  assert.equal(collected.length, 1);
  assert.equal(collected[0].line, 1);
  assert.equal(r.warnings.length, 1);
  assert.equal(collected[0], r.warnings[0]);
});

test('normaliseContainers: legacy 2-arg signature `normaliseContainers(src, path)` works', () => {
  // Used by the legacy shim-style plugin descriptor.
  const r = normaliseContainers(':::\n', 'legacy/path.md');
  assert.equal(r.warnings[0].path, 'legacy/path.md');
});

test('normaliseContainers: implicit multi-close info warning lists all closed containers', () => {
  // Inner `::: card` at indent 4 is closed by the user's `:::` at indent 0.
  // The outer `::: callout` is ALSO closed by the same `:::` because its
  // indent (0) matches the close's indent (0). One user gesture closes two
  // containers — the algorithm emits an INFO warning naming both.
  const src = '::: callout\n    ::: card "x"\n    body\n:::\n';
  const r = normaliseContainers(src);
  const info = r.warnings.find((w) => w.severity === 'info');
  assert.ok(info, 'expected an info warning for implicit multi-close');
  assert.match(info.message, /<callout>/);
  assert.match(info.message, /<card>/);
});

// ─────────────────────────────────────────────────────────────────────
// 5. F1–F5 reported failure modes
// ─────────────────────────────────────────────────────────────────────

test('F1: nested grids with one close per card → 3 outer closes at indent 0', () => {
  // The user-reported "grids don't work" pattern. Cards are closed
  // individually (one `:::` per card body) at indent 8; only the outer
  // grids has its own `:::` at indent 0. The user's final `:::` closes
  // the OUTER grids, and the inner grids (×2) are closed implicitly.
  const src = [
    '::: grids',
    '    ::: grid',
    '        ::: card "Fast" icon:zap',
    '        body',
    '        :::',
    '    ::: grid',
    '        ::: card "Slow"',
    '        body',
    '        :::',
    ':::'
  ].join('\n');

  const r = normaliseContainers(src);

  // Algorithm emits 3 closes at indent 0: 1 replaces the user's final
  // `:::`, 2 are added to close the 2 inner grids.
  const lines = r.source.split('\n');
  const outerCloses = lines.filter((l) => /^:::\s*$/.test(l));
  assert.equal(outerCloses.length, 3, `expected 3 outer closes, got ${outerCloses.length}`);

  // Top-level normaliser produces an info warning naming all 3 containers
  // that the user's one `:::` closed implicitly.
  const info = r.warnings.find((w) => w.severity === 'info');
  assert.ok(info, 'expected an info warning for implicit multi-close');
  assert.match(info.message, /<grids>/);
  assert.match(info.message, /<grid>/);
});

test('F2: three `::: tag` lines plus an orphan `:::` → orphan removed, no stack pushes', () => {
  const src = '::: tag "v0.8" color:blue\n::: tag "Experimental"\n::: tag "Live"\n:::\n';
  const r = normaliseContainers(src);
  // All three tag lines preserved, orphan `:::` removed with a warning.
  assert.match(r.source, /::: tag "v0.8"/);
  assert.match(r.source, /::: tag "Experimental"/);
  assert.match(r.source, /::: tag "Live"/);
  assert.equal(r.source.split('\n').filter((l) => l === ':::').length, 0);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].severity, 'warning');
});

test('F3: `::: callout ... ::: card ... :::` mismatched close → auto-close callout', () => {
  const src = '::: callout info "x"\nbody\n::: card "wrong close"\noops\n:::\n';
  const r = normaliseContainers(src);
  // The callout opener stays; the card opener stays; the user's `:::` closes
  // the card; the callout is then auto-closed at EOF with an error.
  assert.match(r.source, /::: callout info "x"/);
  assert.match(r.source, /::: card "wrong close"/);
  const errors = r.warnings.filter((w) => w.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Unclosed `<callout>`/);
});

test('F4: triple `:::` after a balanced callout → two are removed, one closes callout', () => {
  const src = '::: callout info "x"\nbody\n:::\n:::\n:::\n';
  const r = normaliseContainers(src);
  // First `:::` closes callout (matching); second and third are stray.
  const warnings = r.warnings.filter((w) => w.severity === 'warning');
  assert.equal(warnings.length, 2);
  // Source retains exactly one `:::` (the callout close).
  const closes = r.source.split('\n').filter((l) => /^:::\s*$/.test(l));
  assert.equal(closes.length, 1);
});

test('F5: 5-level nested callouts → already balanced, normalisation is a no-op', () => {
  const src = [
    '::: callout info "l1"',
    '::: callout tip "l2"',
    '::: callout warning "l3"',
    '::: callout danger "l4"',
    '::: callout success "l5"',
    'deep',
    ':::',
    ':::',
    ':::',
    ':::',
    ':::'
  ].join('\n');
  const r = normaliseContainers(src);
  assert.equal(r.source, src);
  assert.deepEqual(r.warnings, []);
});

// ─────────────────────────────────────────────────────────────────────
// 6. processContentAsync integration — end-to-end HTML
// ─────────────────────────────────────────────────────────────────────

// Build a fresh processor per test so module-level caches don't leak.
function freshProcessor() {
  return createMarkdownProcessor({}, () => { });
}

test('integration: plain markdown renders unchanged', async () => {
  const md = freshProcessor();
  const r = await processContentAsync('# Hello\n\nBody text.\n', md, {}, {});
  // headingIdPlugin adds id + class + permalink anchor; just check the
  // h1 exists and contains the heading text.
  assert.match(r.htmlContent, /<h1[^>]*>[\s\S]*?Hello[\s\S]*?<\/h1>/);
  assert.match(r.htmlContent, /<p>Body text\.<\/p>/);
});

test('integration: balanced single callout renders as `.callout` div', async () => {
  const md = freshProcessor();
  const r = await processContentAsync(
    '::: callout info "Title"\nbody\n:::\n',
    md,
    {},
    { filePath: 'test.md' }
  );
  assert.match(r.htmlContent, /docmd-container callout callout-info/);
  assert.match(r.htmlContent, /callout-title/);
  assert.match(r.htmlContent, /<p>body<\/p>/);
});

test('integration: F1 grids render correctly (no raw `<p>::: grids<br>` text)', async () => {
  const md = freshProcessor();
  const src = [
    '::: grids',
    '    ::: grid',
    '        ::: card "Fast"',
    '        body1',
    '        :::',
    '    ::: grid',
    '        ::: card "Slow"',
    '        body2',
    '        :::',
    ':::'
  ].join('\n');
  const r = await processContentAsync(src, md, {}, { filePath: 'f1.md' });
  assert.match(r.htmlContent, /docmd-container grids/);
  assert.match(r.htmlContent, /grid-item/);
  assert.match(r.htmlContent, /card-title/);
  // No leaked raw container text.
  assert.doesNotMatch(r.htmlContent, /<p>::: grids<br/);
});

test('integration: F2 self-closing tag renders inline, orphan `:::` is removed', async () => {
  const md = freshProcessor();
  const r = await processContentAsync(
    '::: tag "v0.8" color:blue\n::: tag "Experimental"\n::: tag "Live"\n:::\n',
    md,
    {},
    { filePath: 'f2.md' }
  );
  assert.match(r.htmlContent, /docmd-tag/);
  // No leaked `<p>:::</p>` orphan.
  assert.doesNotMatch(r.htmlContent, /<p>:::<\/p>/);
});

test('integration: F3 mismatched close renders callout + card correctly', async () => {
  const md = freshProcessor();
  const r = await processContentAsync(
    '::: callout info "x"\nbody\n::: card "wrong close"\noops\n:::\n',
    md,
    {},
    { filePath: 'f3.md' }
  );
  assert.match(r.htmlContent, /callout-info/);
  assert.match(r.htmlContent, /card-title/);
  assert.match(r.htmlContent, /<p>oops<\/p>/);
});

test('integration: F4 triple close renders callout only, no leaked `<p>:::</p>`', async () => {
  const md = freshProcessor();
  const r = await processContentAsync(
    '::: callout info "x"\nbody\n:::\n:::\n:::\n',
    md,
    {},
    { filePath: 'f4.md' }
  );
  assert.match(r.htmlContent, /callout-info/);
  assert.match(r.htmlContent, /<p>body<\/p>/);
  // No leaked `<p>:::</p>` orphan paragraphs.
  assert.doesNotMatch(r.htmlContent, /<p>:::<\/p>/);
});

test('integration: F5 5-level nested callouts render five `<div class="callout callout-*">` levels', async () => {
  const md = freshProcessor();
  const src = [
    '::: callout info "l1"',
    '::: callout tip "l2"',
    '::: callout warning "l3"',
    '::: callout danger "l4"',
    '::: callout success "l5"',
    'deep',
    ':::',
    ':::',
    ':::',
    ':::',
    ':::'
  ].join('\n');
  const r = await processContentAsync(src, md, {}, { filePath: 'f5.md' });
  for (const cls of ['callout-info', 'callout-tip', 'callout-warning', 'callout-danger', 'callout-success']) {
    assert.match(r.htmlContent, new RegExp(cls), `expected ${cls} in HTML`);
  }
  assert.match(r.htmlContent, /<p>deep<\/p>/);
});

// ─────────────────────────────────────────────────────────────────────
// 7. Determinism — identical output across replays / concurrent calls
// ─────────────────────────────────────────────────────────────────────

test('determinism: normaliseContainers returns byte-identical output on replay', () => {
  const src = [
    '::: grids',
    '    ::: grid',
    '        ::: card "x"',
    '        body',
    '        :::',
    ':::'
  ].join('\n');
  const a = normaliseContainers(src);
  const b = normaliseContainers(src);
  assert.equal(a.source, b.source);
  assert.deepEqual(a.warnings, b.warnings);
});

test('determinism: 100 concurrent parses of the same source produce identical HTML', async () => {
  const md = freshProcessor();
  const src = [
    '::: grids',
    '    ::: grid',
    '        ::: card "Fast"',
    '        body1',
    '        :::',
    '    ::: grid',
    '        ::: card "Slow"',
    '        body2',
    '        :::',
    ':::'
  ].join('\n');
  const N = 100;
  const results = await Promise.all(
    Array.from({ length: N }, () => processContentAsync(src, md, {}, { filePath: 'det.md' }))
  );
  const first = results[0].htmlContent;
  for (let i = 1; i < N; i++) {
    assert.equal(results[i].htmlContent, first, `divergence at index ${i}`);
  }
});

test('determinism: parser output is independent of `Date.now` / randomness', async () => {
  // No Date.now / Math.random in the parser pipeline. Two parses made at
  // very different times must produce identical HTML.
  const md = freshProcessor();
  const src = '# Heading\n\n::: callout\nbody\n:::\n';
  const a = await processContentAsync(src, md, {}, { filePath: 'a.md' });
  await new Promise((r) => setTimeout(r, 10));
  const b = await processContentAsync(src, md, {}, { filePath: 'a.md' });
  assert.equal(a.htmlContent, b.htmlContent);
});

// Cross-thread determinism (Phase 2 commit 3). Run the same parse in a
// real worker_threads worker — a different module instance, a different
// microtask queue — and assert the HTML is byte-identical to the main
// thread's result.
test('determinism: parse in a worker_threads worker produces identical HTML', async () => {
  const { Worker } = await import('node:worker_threads');
  const md = freshProcessor();
  const src = [
    '::: grids',
    '    ::: grid',
    '        ::: card "Fast"',
    '        body1',
    '        :::',
    '    ::: grid',
    '        ::: card "Slow"',
    '        body2',
    '        :::',
    ':::'
  ].join('\n') + '\n:::\n'; // trailing stray exercises the warning path

  // Main-thread parse.
  const mainResult = await processContentAsync(src, md, {}, { filePath: 'det.md' });

  // Worker-thread parse. Inline worker that imports the same dist build.
  const workerCode = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { createMarkdownProcessor, processContentAsync } from '${import.meta.dirname}/../dist/index.js';
    (async () => {
      const md = createMarkdownProcessor({}, () => {});
      const r = await processContentAsync(workerData.src, md, {}, { filePath: workerData.filePath });
      parentPort.postMessage(r.htmlContent);
    })().catch((e) => { parentPort.postMessage({ __err: e.message }); });
  `;
  const workerResult = await new Promise((resolve, reject) => {
    const w = new Worker(workerCode, { eval: true, workerData: { src, filePath: 'det.md' } });
    w.once('message', (msg) => {
      if (msg && typeof msg === 'object' && msg.__err) reject(new Error(msg.__err));
      else resolve(msg);
    });
    w.once('error', reject);
  });
  assert.equal(workerResult, mainResult.htmlContent);
});

// ─────────────────────────────────────────────────────────────────────
// 8. Edge cases that round out the fixture to 50+ assertions
// ─────────────────────────────────────────────────────────────────────

test('edge case: empty `info` after `::: callout` is preserved through normalisation', () => {
  // `::: callout` with no extra info → passes through, no warnings.
  const src = '::: callout\nbody\n:::\n';
  const r = normaliseContainers(src);
  assert.equal(r.source, src);
  assert.deepEqual(r.warnings, []);
});

test('edge case: `::: callout` followed immediately by another container (no body)', () => {
  // Two opens in a row — the inner one is "body" of the outer. Both
  // push to the stack; one close closes the outer.
  const src = '::: callout\n::: card "x"\nbody\n:::\n';
  const r = normaliseContainers(src);
  // The card is closed by the user's `:::`, the callout is auto-closed
  // at EOF with an ERROR.
  assert.equal(r.warnings.filter((w) => w.severity === 'error').length, 1);
});

test('edge case: CRLF line endings preserve `\r` on pass-through lines (documented behaviour)', () => {
  // The algorithm splits on `\n` so `\r` ends up at the end of each
  // pass-through line and is kept verbatim. The close regex `\s*$`
  // still matches because `\r` is `\s`. The output replaces close lines
  // with a freshly-emitted `:::` (no `\r`), so the trailing `\r` on the
  // user's close line is dropped — but everything else keeps its `\r`.
  // This matches the legacy shim's behaviour.
  const src = '::: callout\r\nbody\r\n:::\r\n';
  const r = normaliseContainers(src);
  // Pass-through lines retain `\r\n`; only the emitted `:::` is clean.
  assert.equal(r.source, '::: callout\r\nbody\r\n:::\n');
  assert.deepEqual(r.warnings, []);
});

test('edge case: multiple spaces between `:::` and the container name', () => {
  const src = ':::   callout info "Title"\nbody\n:::\n';
  const r = normaliseContainers(src);
  assert.equal(r.source, src);
  assert.deepEqual(r.warnings, []);
});

test('edge case: deeply nested self-closing tags do not corrupt the stack', () => {
  // Many self-closing tag lines; no closes, no opens, no pushes.
  const lines = Array.from({ length: 50 }, (_, i) => `::: tag "v${i}"`).join('\n');
  const r = normaliseContainers(lines + '\n');
  assert.equal(r.source, lines + '\n');
  assert.deepEqual(r.warnings, []);
});

test('edge case: pre-existing normaliser output is idempotent', () => {
  // Running the normaliser twice must produce the same result as once
  // (for already-balanced input).
  const src = [
    '::: grids',
    '    ::: grid',
    '        ::: card "Fast"',
    '        body1',
    '        :::',
    '    ::: grid',
    '        ::: card "Slow"',
    '        body2',
    '        :::',
    ':::'
  ].join('\n');
  const once = normaliseContainers(src);
  const twice = normaliseContainers(once.source);
  assert.equal(twice.source, once.source);
});

test('edge case: warning `line` numbers are 1-indexed and stable across edits', () => {
  // Insert a line at the top; the warning for the stray `:::` should
  // shift from line 1 to line 2.
  const r1 = normaliseContainers(':::\n');
  assert.equal(r1.warnings[0].line, 1);
  const r2 = normaliseContainers('# heading\n:::\n');
  assert.equal(r2.warnings[0].line, 2);
});

test('edge case: `NormaliserWarning` shape is exactly { line, severity, path, message }', () => {
  const r = normaliseContainers(':::\n', { sourcePath: 'p.md' });
  const w = r.warnings[0];
  assert.deepEqual(Object.keys(w).sort(), ['line', 'message', 'path', 'severity']);
  assert.equal(typeof w.line, 'number');
  assert.equal(typeof w.severity, 'string');
  assert.equal(typeof w.path, 'string');
  assert.equal(typeof w.message, 'string');
});

test('edge case: container aliases (`tip`, `warning`, `info`, `note`, `danger`, `caution`) are NOT self-closing', () => {
  // The parser maps `tip`, `warning`, `danger`, `info`, `note`, `caution`
  // to callout types. The normaliser must NOT treat them as self-closing
  // even though the names match a generic pattern. Only the literal set
  // { button, tag, embed } is self-closing.
  for (const name of ['tip', 'warning', 'danger', 'info', 'note', 'caution']) {
    assert.ok(
      !SELF_CLOSING_CONTAINER_NAMES.has(name),
      `${name} must NOT be self-closing (it's a callout alias)`
    );
  }
});

test('edge case: debug mode logs self-close lines to stdout', () => {
  // Capture console.log to verify the debug path fires.
  const originalLog = console.log;
  const captured = [];
  console.log = (...args) => captured.push(args.join(' '));
  try {
    normaliseContainers('::: tag "x"\n', { debug: true });
  } finally {
    console.log = originalLog;
  }
  assert.equal(captured.length, 1);
  assert.match(captured[0], /self-close <tag>/);
});

test('edge case: warnings preserve insertion order across severity', () => {
  // Three different issues in one source, each in source order:
  //   L1 — stray top-level `:::` (warning)
  //   L2–L6 — callout + card with one close at indent 0 → implicit multi-close (info)
  //   L8 — `::: unclosed` never closed (error)
  const src = [
    ':::',                              // 1: stray (warning)
    '::: callout',                      // 2
    '    ::: card "x"',                 // 3
    '    body',                         // 4
    ':::',                              // 5: closes callout + card (info)
    '',                                  // 6
    '::: unclosed'                      // 7: unclosed at EOF (error)
  ].join('\n') + '\n';
  const r = normaliseContainers(src);
  const sevs = r.warnings.map((w) => w.severity);
  // All three severities should appear, in source order.
  assert.deepEqual(sevs, ['warning', 'info', 'error']);
  assert.equal(r.warnings[0].line, 1);
  assert.equal(r.warnings[1].line, 5);
  assert.equal(r.warnings[2].line, 7);
});

// ─────────────────────────────────────────────────────────────────────
// 8. Fenced code block tracking (F6 — normaliser must not interpret
//    `:::` lines that appear inside a ``` or ~~~ fence)
// ─────────────────────────────────────────────────────────────────────

test('F6: ::: lines inside a ``` fence are not classified as opens/closes', () => {
  // The docs site has pages that show `::: card ... :::` examples inside
  // markdown code fences. Without fence tracking the normaliser treats the
  // fenced `::: card` as a real open, pushes it on the stack, and reports
  // a spurious "Unclosed <card>" error when EOF arrives.
  const src = [
    '# Buttons',                        // 1
    '',                                  // 2
    '```markdown',                       // 3: fence open
    '::: card "Setup"',                 // 4: literal text in fence
    '    ::: button "Begin" ../../x',   // 5: literal text in fence
    ':::',                              // 6: literal text in fence
    '```',                              // 7: fence close
    '',                                  // 8
    '::: callout',                      // 9: real open
    'body',                             // 10
    ':::'                               // 11: real close
  ].join('\n') + '\n';
  const r = normaliseContainers(src);
  // No warnings: the fenced ::: lines are not counted, the real callout
  // at L9–L11 is balanced.
  assert.equal(r.warnings.length, 0);
  // Output is unchanged — the fence contents pass through verbatim.
  assert.equal(r.source, src);
});

test('F6: ~~~ fences are also tracked', () => {
  // CommonMark allows ~~~ as an alternative fence marker.
  const src = [
    '~~~markdown',                      // 1: fence open
    '::: card "x"',                     // 2: literal
    ':::',                              // 3: literal
    '~~~',                              // 4: fence close
    '::: callout',                      // 5: real open
    ':::'                               // 6: real close
  ].join('\n') + '\n';
  const r = normaliseContainers(src);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.source, src);
});

test('F6: a real ::: card outside a fence still reports the unclosed error', () => {
  // Regression guard: fence tracking must not swallow real container errors
  // that occur outside any fence.
  const src = [
    '```markdown',                      // 1: fence open
    '::: card "fenced"',                // 2: literal
    '```',                              // 3: fence close
    '::: card "real"',                  // 4: real open, never closed
    'body'                              // 5
  ].join('\n') + '\n';
  const r = normaliseContainers(src);
  const errors = r.warnings.filter((w) => w.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Unclosed.*card/);
  assert.equal(errors[0].line, 4);
});

test('F6: mismatched fence markers (``` open vs ~~~ close) do not close the fence', () => {
  // CommonMark says a fence closes only on the same marker that opened it.
  const src = [
    '```markdown',                      // 1: ``` fence open
    '::: card "x"',                     // 2: literal
    '~~~',                              // 3: NOT a close (different marker)
    '::: card "y"',                     // 4: literal (still inside fence)
    '```'                               // 5: real close
  ].join('\n') + '\n';
  const r = normaliseContainers(src);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.source, src);
});

// ─────────────────────────────────────────────────────────────────────
// 9. Slash and End closing container tags & HTML block rendering
// ─────────────────────────────────────────────────────────────────────

test('slash and end closing tags match corresponding open container by name', () => {
  const src = [
    '::: callout info "Callout Title"',
    'body text',
    '::: /callout',
    '',
    '::: card "Card Title"',
    'card body',
    '::: endcard'
  ].join('\n');
  const r = normaliseContainers(src);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.source, [
    '::: callout info "Callout Title"',
    'body text',
    ':::',
    '',
    '::: card "Card Title"',
    'card body',
    ':::'
  ].join('\n'));
});

test('HTML blocks with blank lines render as HTML without breaking into code/plain text', async () => {
  const md = freshProcessor();
  const htmlInput = [
    '<div class="hero">',
    '    <h1>Hero Heading</h1>',
    '',
    '    <p>Hero paragraph text</p>',
    '',
    '    <div class="actions">',
    '        <a href="#">Button</a>',
    '    </div>',
    '</div>'
  ].join('\n');

  const r = await processContentAsync(htmlInput, md, {}, { filePath: 'no-style.md' });
  assert.match(r.htmlContent, /<div class="hero">/);
  assert.match(r.htmlContent, /<h1>Hero Heading<\/h1>/);
  assert.match(r.htmlContent, /<p>Hero paragraph text<\/p>/);
  assert.match(r.htmlContent, /<div class="actions">/);
  assert.match(r.htmlContent, /<\/div>/);
  // Ensure it did NOT get converted to indented code block or escaped plain text
  assert.doesNotMatch(r.htmlContent, /<pre><code>&lt;div class="actions"&gt;/);
});

test('sub-containers ::: tab, ::: step, ::: log render correctly and ignore inline comments', async () => {
  const md = freshProcessor();
  const input = [
    '::: tabs # main navigation tabs',
    '::: tab "JavaScript" icon:code-2 # first tab',
    'console.log("Hello JS");',
    '::: /tab # end first tab',
    '::: tab "TypeScript" icon:file-code # second tab',
    'console.log("Hello TS");',
    '::: /tab',
    '::: /tabs',
    '',
    '::: steps # installation guide',
    '::: step "Clone Repo" # step 1',
    'git clone https://github.com/docmd-io/docmd',
    '::: /step',
    '::: step "Build Project"',
    'pnpm build',
    '::: /step',
    '::: /steps',
    '',
    '::: changelog # release history',
    '::: log "v1.0.0 (2026-01-01)" # initial release',
    'Initial launch.',
    '::: /log',
    '::: /changelog'
  ].join('\n');

  const r = await processContentAsync(input, md, {}, { filePath: 'test-containers.md' });

  assert.match(r.htmlContent, /docmd-tabs/);
  assert.match(r.htmlContent, /JavaScript/);
  assert.match(r.htmlContent, /TypeScript/);
  assert.match(r.htmlContent, /steps-list/);
  assert.match(r.htmlContent, /Clone Repo/);
  assert.match(r.htmlContent, /Build Project/);
  assert.match(r.htmlContent, /changelog-timeline/);
  assert.match(r.htmlContent, /v1\.0\.0/);
});

test('smart self-closing container stripping logs info warning and removes stray ::: /tag', () => {
  const src = [
    '::: tag "v1.0" color:#3b82f6',
    '::: /tag'
  ].join('\n');

  const r = normaliseContainers(src);
  assert.equal(r.source, '::: tag "v1.0" color:#3b82f6');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /Self-closing container <tag> does not require a closing tag/);
});

test('heading inside container is preserved when explicit closing tag exists ahead', () => {
  const src = [
    '::: card "Feature Highlight" icon:sparkles',
    'Cards give content a distinct frame.',
    '',
    '# Heading inside card',
    '::: button "GitHub" url:"https://github.com"',
    '::: tag "v0.9.1" style:success',
    '::: /card'
  ].join('\n');

  const r = normaliseContainers(src);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.source, [
    '::: card "Feature Highlight" icon:sparkles',
    'Cards give content a distinct frame.',
    '',
    '# Heading inside card',
    '::: button "GitHub" url:"https://github.com"',
    '::: tag "v0.9.1" style:success',
    ':::'
  ].join('\n'));
});

test('self-closing containers: dedicated lines emit <br> while same line stays inline', async () => {
  const md = createMarkdownProcessor();

  // 1. Dedicated adjacent lines -> separated by <br>
  const srcDedicated = [
    '::: button "GitHub" url:"https://github.com"',
    '::: tag "v0.9.1" style:success'
  ].join('\n');
  const resDedicated = await processContentAsync(srcDedicated, md, {}, { filePath: 'test.md' });
  assert.match(resDedicated.htmlContent, /class="docmd-button"[^>]*>GitHub<\/a><br>\s*<span class="docmd-tag"/);

  // 2. Same line -> no <br> inserted between inline elements
  const srcSameLine = '::: button "GitHub" url:"https://github.com" :::/button ::: tag "v0.9.1" style:success :::/tag';
  const resSameLine = await processContentAsync(srcSameLine, md, {}, { filePath: 'test.md' });
  assert.match(resSameLine.htmlContent, /class="docmd-button"[^>]*>GitHub<\/a>\s*<span class="docmd-tag"/);
  assert.equal(resSameLine.htmlContent.includes('<br>'), false);
});

test('normaliseContainers: skips containers inside frontmatter at top of document', () => {
  const src = [
    '---',
    'title: "Frontmatter Title"',
    'description: "Usage of ::: tip in docmd"',
    'note: "::: card is not parsed here"',
    '---',
    '',
    '::: card "Real Card"',
    'body',
    '::: /card'
  ].join('\n');

  const r = normaliseContainers(src);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.source, [
    '---',
    'title: "Frontmatter Title"',
    'description: "Usage of ::: tip in docmd"',
    'note: "::: card is not parsed here"',
    '---',
    '',
    '::: card "Real Card"',
    'body',
    ':::'
  ].join('\n'));
});

test('normaliseContainers: horizontal rule --- in body is NOT treated as frontmatter', () => {
  const src = [
    '# Heading',
    '',
    '---',
    '',
    '::: card "Card After HR"',
    'body'
  ].join('\n');

  const r = normaliseContainers(src);
  // Card after HR is unclosed at EOF so normaliser auto-closes it
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].severity, 'error');
  assert.match(r.warnings[0].message, /Unclosed `<card>`/);
});

test('hero slider layout: explicit ::: /slide and ::: /hero tags render slides cleanly without ::: leak', async () => {
  const md = freshProcessor();
  const src = [
    '::: hero layout:slider # Interactive slider container',
    '::: slide # Panel 1',
    '# Isomorphic Core Engine',
    'Renders statically and executes client-side seamlessly.',
    '::: /slide',
    '',
    '::: slide # Panel 2',
    '# AI Context Optimisation',
    'Structure-aware parsing for LLM agents.',
    '::: /slide',
    '::: /hero'
  ].join('\n');

  const result = await processContentAsync(src, md, {}, { filePath: 'hero.md' });
  assert.ok(result.htmlContent.includes('<div class="hero-slide">'));
  assert.ok(result.htmlContent.includes('Isomorphic Core Engine'));
  assert.ok(result.htmlContent.includes('AI Context Optimisation'));
  // Ensure closing tag ':::' is not leaked into paragraph text
  assert.ok(!result.htmlContent.includes('<p>:::</p>'));
  assert.ok(!result.htmlContent.includes(':::'));
});