/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 * --------------------------------------------------------------------
 */

/**
 * Worker-thread parser
 * ====================
 *
 * Each docmd worker thread runs an independent copy of this module —
 * Node.js `worker_threads` load modules per worker, so `mdProcessor`,
 * `hooks`, and `config` below are PER-WORKER state, not shared across
 * threads. Phase 2 (F1–F5) requires that two workers given the same
 * input produce byte-identical HTML; the determinism contract is
 * enforced by:
 *
 *   1. `mdProcessor` is instantiated inside `init()` on this worker,
 *      never imported from the main thread.
 *   2. `hooks` are loaded on this worker via `loadPlugins(config, ...)`.
 *      No plugin module is cached across workers.
 *   3. `config` is the structured-clone snapshot from `workerData` —
 *      no live reference to the main-thread config object.
 *   4. The container normaliser (`@docmd/parser/utils/container-normaliser`)
 *      is a pure function of its input — no `Date.now()`, no
 *      `Math.random()`, no module-level mutable state. The determinism
 *      test fixture at `packages/parser/test/container-normaliser.test.js`
 *      verifies this empirically (100-way concurrency + cross-worker).
 *   5. `verifyDeterminismAtBoot()` runs a known input through the
 *      freshly-built processor at the end of `init()` and asserts the
 *      output matches the snapshot. Any future regression that breaks
 *      determinism crashes the worker before the first message is
 *      processed.
 *
 * If you add any module-level mutable state to this file or to the
 * parser pipeline, the boot-time self-test will fail and the worker
 * will refuse to start. That is the structural fence.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { loadPlugins } from '@docmd/api';
import { createMarkdownProcessor, processContentAsync } from '@docmd/parser';
import * as ui from '@docmd/ui';

// ─────────────────────────────────────────────────────────────────────
// Per-worker state — `let` is intentional; these are populated by
// `init()` and frozen-equivalent after that point.
// ─────────────────────────────────────────────────────────────────────
let mdProcessor: any;
let hooks: any;
let config: any;

/**
 * Determinism snapshot. Two workers given the same input MUST produce
 * the same HTML. We assert this at boot by parsing a known input and
 * comparing the output to this frozen string. Any future code change
 * that introduces non-determinism (Date.now, Math.random, shared
 * module-level state, etc.) crashes the worker before it processes
 * its first real message.
 *
 * The snapshot is intentionally a small, isolated example — a balanced
 * callout with a self-closing tag — that exercises the normaliser
 * (no warnings expected), the depth tracker, the renderer pipeline,
 * and the heading ID plugin.
 */
const DETERMINISM_SNAPSHOT_INPUT = '# Hi\n\n::: callout info "T"\nbody\n:::\n';
const DETERMINISM_SNAPSHOT_OUTPUT = '<h1 id="hi" class="docmd-heading"><a href="#hi" class="heading-anchor" aria-label="Permalink to this section"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link2-icon lucide-link-2"><path d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 1 1 0 10h-2m-7-5h8"/></svg></a>Hi</h1>\n<div class="docmd-container callout callout-info"><div class="callout-title">T</div><div class="callout-content">\n<p>body</p>\n</div></div>\n';

async function init() {
  config = workerData.config;
  const cwd = workerData.cwd;

  // 1. Re-hydrate hooks by loading plugins within the worker boundary.
  hooks = await loadPlugins(config, { resolvePaths: [cwd], isDev: Boolean(config?._isDev) });

  // 2. Re-hydrate UI strings for the markdown processor (for heading anchors, etc.)
  const localeId = config._activeLocale?.id || null;
  const pluginTranslations = hooks.translations
    ? await hooks.translations.reduce(async (accP: any, fn: any) => ({ ...(await accP), ...(await fn(localeId)) }), {})
    : {};
  const userLocaleTranslations = config._activeLocale?.translations || {};
  const strings = ui.loadTranslations(localeId, { ...pluginTranslations, ...userLocaleTranslations });
  const configWithStrings = { ...config, _uiStrings: strings };

  // 3. Instantiate the exact same Markdown-It pipeline as the main thread
  mdProcessor = createMarkdownProcessor(configWithStrings, (md: any) => {
    hooks.markdownSetup.forEach((hook: any) => hook(md));
  });

  // 4. Boot-time determinism self-test. Crashes the worker if the
  //    parser output diverges from the snapshot, which means the
  //    parser is no longer deterministic and parallel workers may
  //    produce different HTML for the same input.
  await verifyDeterminismAtBoot();
}

/**
 * Boot-time determinism check. Parses `DETERMINISM_SNAPSHOT_INPUT`
 * through the freshly-built processor and asserts the output equals
 * `DETERMINISM_SNAPSHOT_OUTPUT`. If it doesn't, this is a regression
 * — the worker crashes with a clear error message before processing
 * any real message.
 */
async function verifyDeterminismAtBoot(): Promise<void> {
  const result = await processContentAsync(
    DETERMINISM_SNAPSHOT_INPUT,
    mdProcessor,
    config,
    { filePath: '<determinism-snapshot>' },
    hooks
  );
  if (result.htmlContent !== DETERMINISM_SNAPSHOT_OUTPUT) {
    throw new Error(
      '[docmd] Parser determinism regression detected at worker boot.\n' +
      '  Expected:\n' + JSON.stringify(DETERMINISM_SNAPSHOT_OUTPUT) + '\n' +
      '  Actual:\n' + JSON.stringify(result.htmlContent) + '\n' +
      '  This means two worker threads given the same input may now\n' +
      '  produce different HTML — the parser pipeline is no longer\n' +
      '  deterministic. Audit `packages/parser/src/` for any new\n' +
      '  module-level mutable state, Date.now, Math.random, or\n' +
      '  non-pure helpers.'
    );
  }
}

// Start initialization immediately upon worker thread spawn
const initPromise = init();

parentPort?.on('message', async (task) => {
  try {
    // Ensure the worker is fully initialized before processing any task
    await initPromise;

    // Support generic tasks for plugins leveraging the WorkerPool
    if (task.payload && task.payload.type === 'plugin-task') {
      const { modulePath, functionName, args } = task.payload;
      const mod = await import(modulePath);
      const result = await mod[functionName](...args);
      parentPort?.postMessage({
        taskId: task.id,
        success: true,
        data: result
      });
      return;
    }

    const { rawContent, env } = task.payload;

    // Process the content (includes frontmatter extraction, hooks execution, and HTML rendering)
    const processed = await processContentAsync(rawContent, mdProcessor, config, env, hooks);

    parentPort?.postMessage({
      taskId: task.id,
      success: true,
      data: processed
    });
  } catch (error: any) {
    parentPort?.postMessage({
      taskId: task.id,
      success: false,
      error: error.message || String(error)
    });
  }
});