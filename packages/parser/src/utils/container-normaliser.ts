/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/parser
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * Container normaliser
 * ====================
 *
 * Single-pass linear scan that rewrites `:::` container markdown so that
 * the existing depth-tracking block rules in `features/common-containers.ts`
 * always see balanced open/close pairs.
 *
 * The classic bugs this addresses:
 *
 *   F1 — depth tracker is indentation-blind.
 *        `::: grids` + N×`    ::: grid` + N×`:::` (one per card)
 *        leaves depth > 0 and the block rule fails to match, so the
 *        whole grids block is dumped as raw `<p>::: grids<br>...</p>`.
 *   F2 — `::: tag` is self-closing but the next orphan `:::` still
 *        decrements depth of the wrong container.
 *   F3 — `::: callout ... ::: card ... :::` silently re-roots.
 *   F4 — bare `:::` lines leak into the page as `<p>:::</p>` paragraphs.
 *   F5 — 5+ levels of nesting survive when opens and closes are balanced,
 *        but unbalanced user input collapses inner levels.
 *
 * The algorithm is the same one documented in
 * `battle-test-reports/robust-parser-shim/index.js` (146 lines,
 * dependency-free). This file is the in-tree port — no plugins, no
 * configuration, always-on.
 *
 * Output is deterministic: the function is a pure function of its input.
 * Two worker threads given the same source produce byte-identical output.
 *
 * ─── DETERMINISM AUDIT ─────────────────────────────────────────────────
 * Phase 2 (worker-shared-state fix). This module deliberately does NOT
 * use any of the following non-deterministic primitives. Adding any of
 * them is a regression and must be flagged in code review.
 *
 *   ✗ `Date.now()` / `new Date()`           — wall-clock time
 *   ✗ `Math.random()` / `crypto.randomUUID` — entropy source
 *   ✗ module-level `let` / `var`            — mutable shared state
 *   ✗ `console.log` from inside `normaliseContainers` (use the
 *     `onWarning` callback instead — `console.log` does not affect
 *     output but `DOCMD_ROBUST_DEBUG=1` enables it for ad-hoc tracing)
 *   ✗ reading from `process.env`            — env may differ per worker
 *                                             (use `options` instead)
 *
 * The only module-level binding is `SELF_CLOSING_CONTAINER_NAMES`, a
 * frozen `ReadonlySet<string>` that is constructed once at module load
 * and never mutated. Safe to share across workers.
 *
 * The empirical guarantee lives in three places:
 *   1. `packages/parser/test/container-normaliser.test.js` — replay
 *      determinism, 100-way concurrency, and cross-worker
 *      `node:worker_threads` determinism.
 *   2. `packages/core/src/engine/worker-parser.ts` boot-time self-test
 *      (`verifyDeterminismAtBoot`).
 *   3. The manual end-to-end check at the bottom of this file's docstring.
 * ──────────────────────────────────────────────────────────────────────
 */

/**
 * Container names that produce a single line (no body, no close).
 * These are matched by name in the open line and the line is passed
 * through unchanged; any stray `:::` that follows them is a user mistake
 * (F2) and is removed.
 */
export const SELF_CLOSING_CONTAINER_NAMES: ReadonlySet<string> = new Set([
  'button',
  'tag',
  'embed'
]);

/**
 * Severity levels for normaliser warnings. Mirrors the three messages the
 * shim emits so downstream consumers can route by severity if they want.
 */
export type NormaliserWarningSeverity = 'warning' | 'info' | 'error';

export interface NormaliserWarning {
  /** 1-indexed line number in the original source. */
  line: number;
  severity: NormaliserWarningSeverity;
  /** Path of the source file (or `<source>` when synthetic). */
  path: string;
  message: string;
}

export interface NormaliserResult {
  /** Rewritten source with implicit closes added and stray closes removed. */
  source: string;
  warnings: NormaliserWarning[];
}

export interface NormaliserOptions {
  /** Path used in warning messages. Defaults to `<source>`. */
  sourcePath?: string;
  /** When true, print debug lines to stdout. Defaults to false. */
  debug?: boolean;
  /** Optional sink for warnings — useful for tests and structured logging. */
  onWarning?: (warning: NormaliserWarning) => void;
}

interface ClassifiedLine {
  kind: 'open' | 'close' | 'other';
  name?: string;
}

interface OpenFrame {
  name: string;
  /** 1-indexed line number where this container was opened. */
  line: number;
  /** Indent (in spaces) of the line that opened the container. */
  indent: number;
}

/**
 * Count the leading spaces of a line. Tabs are not interpreted — markdown
 * container indentation is conventionally spaces.
 */
export function indentOf(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

/**
 * Classify a single source line as `open`, `close`, or `other`.
 *
 *   open   — `::: <name>...` where `<name>` starts with a letter.
 *            Self-closing names (`button`, `tag`, `embed`) are still
 *            classified as `open` — the algorithm distinguishes them via
 *            the SELF_CLOSING_CONTAINER_NAMES set, not here.
 *   close  — bare `:::` with optional surrounding whitespace.
 *   other  — anything else, passed through verbatim.
 */
/**
 * Classify a single source line as `open`, `close`, or `other`.
 *
 *   open   — `::: <name>...` where `<name>` starts with a letter.
 *            Self-closing names (`button`, `tag`, `embed`) are still
 *            classified as `open` — the algorithm distinguishes them via
 *            the SELF_CLOSING_CONTAINER_NAMES set, not here.
 *   close  — bare `:::`, `::: /<name>`, `::: end<name>`, or `::: end`.
 *   other  — anything else, passed through verbatim.
 */
export function classifyLine(line: string): ClassifiedLine {
  const trimmed = line.trim();

  if (!trimmed.startsWith(':::')) return { kind: 'other' };

  if (trimmed.startsWith('::::') && !/^:{3,}\s*(?:\/|end)/i.test(trimmed)) {
    return { kind: 'other' };
  }

  // Count leading colons without regex backtracking
  let colonCount = 0;
  while (colonCount < trimmed.length && trimmed.charCodeAt(colonCount) === 58 /* ':' */) {
    colonCount++;
  }
  let rest = trimmed.slice(colonCount).trim();

  // Strip inline comments (# ...) if preceded by space or tab
  const commentIdx = rest.search(/(^|\s+)#.*/);
  if (commentIdx !== -1) {
    rest = rest.slice(0, commentIdx).trim();
  }

  // Strip extra colons left at start of rest (e.g. from 4+ colon closes like ::::/tag)
  while (rest.charCodeAt(0) === 58 /* ':' */) {
    rest = rest.slice(1).trimStart();
  }

  // Bare ::: (or ::::) or ::: /<name> or ::: end<name> or ::: end
  if (rest === '' || rest.startsWith('/') || /^end\b/i.test(rest) || /^end[_-]?\w+$/i.test(rest)) {
    const name = rest.replace(/^(\/|end[_-]?)/i, '').trim().split(/\s+/)[0];
    return name ? { kind: 'close', name } : { kind: 'close' };
  }

  // Open tag candidate: ::: <name> [args] or :::name [args]
  // Extract name and args via whitespace split rather than regex backtracking
  const firstSpaceIdx = rest.search(/\s/);
  const name = firstSpaceIdx === -1 ? rest : rest.slice(0, firstSpaceIdx);
  const args = firstSpaceIdx === -1 ? '' : rest.slice(firstSpaceIdx).trim();

  if (/^[a-zA-Z][\w-]*$/.test(name)) {
    // Check if line self-closes on the same line:
    // e.g. ::: playground src="..." /::: or ::: playground src="..." ::: or ::: button "..." url:... :::
    if (args && (args.endsWith('/:::') || args.endsWith(':::') || /(?:\s|^)\/[a-zA-Z0-9_-]+$/i.test(args))) {
      return { kind: 'other' };
    }

    return { kind: 'open', name };
  }

  return { kind: 'other' };
}

/**
 * Look ahead in source lines to check if an open container frame has a matching
 * closing tag (`:::`, `::: /<name>`, etc.) further down in the document.
 */
function hasMatchingCloseAhead(lines: string[], startIdx: number, frame: OpenFrame): boolean {
  let depth = 0;
  let inFence = false;
  let fenceMarker: string | null = null;

  for (let j = startIdx; j < lines.length; j++) {
    const line = lines[j];
    if (inFence) {
      if (/^\s*(```+|~~~+)/.test(line) && line.trimStart().startsWith(fenceMarker!)) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[1][0];
      continue;
    }

    const cls = classifyLine(line);

    if (cls.kind === 'open') {
      if (cls.name && SELF_CLOSING_CONTAINER_NAMES.has(cls.name.toLowerCase())) {
        continue;
      }
      if (cls.name && cls.name.toLowerCase() === frame.name.toLowerCase()) {
        depth++;
      }
      continue;
    }

    if (cls.kind === 'close') {
      if (cls.name && SELF_CLOSING_CONTAINER_NAMES.has(cls.name.toLowerCase())) {
        continue;
      }

      const isNameMatch = Boolean(cls.name && cls.name.toLowerCase() === frame.name.toLowerCase());
      const isIndentMatch = !cls.name && indentOf(line) <= frame.indent;

      if (isNameMatch || isIndentMatch) {
        if (depth > 0) {
          depth--;
        } else {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Rewrite a markdown source so that every `:::` block has a matching close.
 *
 * The function never throws; instead it returns the rewritten source plus
 * an array of warnings. Callers may surface warnings through `console.warn`,
 * a structured logger, or both via `options.onWarning`.
 *
 * The algorithm is allocation-conscious (single array of output lines, single
 * stack of open frames) but readability is prioritised over micro-optimisation.
 */
export function normaliseContainers(
  source: string,
  options: NormaliserOptions | string = {}
): NormaliserResult {
  // Allow the legacy 2-arg call signature `normaliseContainers(src, path)` so
  // any in-flight plugin code keeps working.
  const opts: NormaliserOptions = typeof options === 'string'
    ? { sourcePath: options }
    : options;

  const sourcePath = opts.sourcePath || '<source>';
  const debug = opts.debug === true;
  const onWarning = typeof opts.onWarning === 'function' ? opts.onWarning : null;

  const lines = source.split('\n');
  const out: string[] = [];
  const stack: OpenFrame[] = [];
  const warnings: NormaliserWarning[] = [];

  // Fenced code block & frontmatter tracking — see the in-loop comment below.
  let inFence = false;
  let fenceMarker: string | null = null;
  let inFrontmatter = false;
  let hasSeenContent = false;

  const recordWarning = (w: NormaliserWarning): void => {
    warnings.push(w);
    if (onWarning) onWarning(w);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentOf(line);
    const trimmed = line.trim();

    // 0. Skip frontmatter at the top of the document (--- or +++)
    if (inFrontmatter) {
      if (trimmed === '---' || trimmed === '+++') {
        inFrontmatter = false;
        hasSeenContent = true;
      }
      out.push(line);
      continue;
    }

    if (!hasSeenContent) {
      if (trimmed === '---' || trimmed === '+++') {
        inFrontmatter = true;
        out.push(line);
        continue;
      }
      if (trimmed !== '') {
        hasSeenContent = true;
      }
    }

    if (inFence) {
      if (/^\s*(```+|~~~+)/.test(line) && line.trimStart().startsWith(fenceMarker!)) {
        inFence = false;
        fenceMarker = null;
      }
      out.push(line);
      continue;
    }
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[1][0]; // '`' or '~'
      out.push(line);
      continue;
    }

    // Auto-close open containers before major section headings (e.g. #, ##, ###)
    // ONLY if the container does not have a matching close tag later in the document.
    if (/^\s*#{1,6}\s+/.test(line) && stack.length > 0) {
      while (stack.length > 0) {
        const topFrame = stack[stack.length - 1];
        if (hasMatchingCloseAhead(lines, i + 1, topFrame)) {
          break;
        }
        const frame = stack.pop()!;
        recordWarning({
          line: i + 1,
          severity: 'info',
          path: sourcePath,
          message: `Unclosed <${frame.name}> from line ${frame.line} — auto-closed before heading at line ${i + 1}.`
        });
        out.push(' '.repeat(frame.indent) + ':::');
      }
    }

    const cls = classifyLine(line);

    if (cls.kind === 'open') {
      if (cls.name && SELF_CLOSING_CONTAINER_NAMES.has(cls.name.toLowerCase())) {
        out.push(line);
        if (debug) {
          console.log(`[normaliser] ${sourcePath}:${i + 1} self-close <${cls.name}>`);
        }
        continue;
      }

      stack.push({ name: cls.name || '', line: i + 1, indent });
      out.push(line);
      continue;
    }

    if (cls.kind === 'close') {
      // Smart check: if closing tag targets a self-closing container name, strip it gracefully
      if (cls.name && SELF_CLOSING_CONTAINER_NAMES.has(cls.name.toLowerCase())) {
        recordWarning({
          line: i + 1,
          severity: 'info',
          path: sourcePath,
          message: `Self-closing container <${cls.name}> does not require a closing tag. Stripped unnecessary ::: /${cls.name}.`
        });
        continue;
      }
      let matchIdx = -1;

      // 1. Try matching by name if close specified a name
      if (cls.name) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].name.toLowerCase() === cls.name.toLowerCase()) {
            matchIdx = j;
            break;
          }
        }
      }

      // 2. Fallback to indent matching if no name match
      if (matchIdx === -1) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].indent <= indent) {
            matchIdx = j;
            break;
          }
        }
      }

      if (matchIdx === -1) {
        recordWarning({
          line: i + 1,
          severity: 'warning',
          path: sourcePath,
          message: 'Stray `:::` removed. Common cause: `::: tag ... :::` (tag is self-closing).'
        });
        continue;
      }

      const closed = stack.splice(matchIdx);
      const outerIndent = closed[0].indent;

      for (let k = 0; k < closed.length; k++) {
        out.push(' '.repeat(outerIndent) + ':::');
      }

      if (closed.length > 1) {
        recordWarning({
          line: i + 1,
          severity: 'info',
          path: sourcePath,
          message:
            `Closed ${closed.length} containers implicitly (` +
            closed.map((c) => `<${c.name}>`).join(' > ') +
            `). Added ${closed.length - 1} explicit \`:::\` closes.`
        });
      }
      continue;
    }

    out.push(line);
  }

  // Auto-close anything still on the stack at EOF. Without this the upstream
  // block rule would loop to endLine without finding a close and the whole
  // container would be dropped (F1, F3).
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    recordWarning({
      line: frame.line,
      severity: 'error',
      path: sourcePath,
      message: `Unclosed \`<${frame.name}>\` from line ${frame.line} — auto-closed at EOF.`
    });
    out.push(' '.repeat(frame.indent) + ':::');
  }

  return { source: out.join('\n'), warnings };
}

export default normaliseContainers;