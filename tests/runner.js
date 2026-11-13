#!/usr/bin/env node
/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Categorised test runner
 *
 * Replaces the monolithic `scripts/brute-test.js` +
 * `scripts/brute-test-security.js` (now `tests/feature-integration.test.js`
 * and `tests/security.test.js` after the scripts/ → tests/ move)
 * with a set of smaller, focused test files under `tests/`. Each file
 * exports a `test` object (created via `runTestFile()`) and a `results`
 * object with `passed`, `failed`, `failures` getters.
 *
 * The runner:
 *   1. Imports every test file in declared order.
 *   2. For each file, prints a TUI section header (`<emoji>  <name>`).
 *   3. Calls `test.run()` and reads the per-file `results` object to
 *      print pass/fail counts.
 *   4. Aggregates pass/fail across all files into a final summary.
 *   5. Exits 1 if any file failed, 0 otherwise.
 *
 * Wired into `tools/prep.js` (called by `pnpm prep` via the status
 * pipeline) so a single `pnpm prep` runs the entire categorised suite.
 *
 * The legacy feature-integration scenarios (zero-config, i18n,
 * versioning, containers, code blocks, etc.) still run.
 *
 * Run: `node tests/runner.js`
 * Or:  `node tests/runner.js --only=exit-codes,plugin-add-remove` (filter)
 * --------------------------------------------------------------------
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setInterval, clearInterval } from 'node:timers';

process.env.DOCMD_TEST = 'true';
process.env.DOCMD_NO_OPEN = 'true';
process.env.NODE_ENV = 'test';

const monorepoRoot = path.resolve(import.meta.dirname, '..');
const siblingDocmdSearch = path.resolve(monorepoRoot, '..', 'docmd-search');
const testPaths = [
  monorepoRoot,
  path.join(monorepoRoot, 'node_modules')
];
if (fs.existsSync(siblingDocmdSearch)) {
  testPaths.push(siblingDocmdSearch);
  testPaths.push(path.join(siblingDocmdSearch, 'node_modules'));
}
process.env.DOCMD_TEST_SEARCH_PATH = testPaths.join(path.delimiter);

const CYAN = (s) => `\x1b[36m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('--full');
const only = (() => {
  const flag = args.find((a) => a.startsWith('--only='));
  if (!flag) return null;
  return flag.slice('--only='.length).split(',').filter(Boolean);
})();

// `tools/verify.js` forwards `--skip-setup` to the runner in CI
// (the install + build steps run before verify). The runner does
// not need any setup work itself, so this is a no-op — we just
// drop it from the arg list so it does not leak into test files
// or show up as an unrecognised flag. Add other verify-only flags
// here as the verify script grows.
const _SKIP_FLAGS = new Set(['--skip-setup']);
for (const f of _SKIP_FLAGS) {
  const i = args.indexOf(f);
  if (i !== -1) args.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Test file registry — order matters.
//   - For in-process tests, the entry is the imported module.
//   - For external tests, the entry has `{ external: true, command, args }`.
//   - When `id` matches the `--only` filter, only those entries run.
// ---------------------------------------------------------------------------

const testFiles = [];

function addInProcess(id, name, module) {
  if (only && !only.includes(id)) return;
  testFiles.push({ id, name, module });
}

function addExternal(id, name, command, args) {
  if (only && !only.includes(id)) return;
  testFiles.push({ id, name, module: { external: true, command, args } });
}

// --- Section 1: CLI contracts (Phase 3 PR 3.A / 3.B / 3.C) -----------------
addInProcess(
  'exit-codes',
  'Exit-code contract (F6, M-12)',
  await import('./cli-contracts/exit-codes.test.js')
);
addInProcess(
  'plugin-add-remove',
  'Plugin add/remove across config formats (F7, M-3)',
  await import('./cli-contracts/plugin-add-remove.test.js')
);
addInProcess(
  'validate-workspace',
  'Validate rewrite + workspace errors + init example (F8, F9, M-1)',
  await import('./cli-contracts/validate-workspace.test.js')
);
addInProcess(
  'deploy',
  'Deploy --force honours overwrite (N-2)',
  await import('./cli-contracts/deploy.test.js')
);
addInProcess('serve', 'Serve: production command, config, router, graceful shutdown', await import('./cli-contracts/serve.test.js'));
addInProcess('serve-startup', 'Serve startup failures exit 1; SIGINT stops cleanly', await import('./cli-contracts/serve-startup.test.js'));
addInProcess('serve-actions', 'Serve actions: config, origin allowlist, trusted identity for writes', await import('./cli-contracts/serve-actions.test.js'));
addInProcess('serve-mcp', 'Serve MCP: opt-in read-only MCP over HTTP at POST /mcp', await import('./cli-contracts/serve-mcp.test.js'));
addInProcess('docker-serve', 'Docker image: serve by default, /healthz health check', await import('./cli-contracts/docker-serve.test.js'));
addInProcess('static-server', 'Static handler: production serving, path safety, dev wrapper', await import('./cli-contracts/static-server.test.js'));
addInProcess(
  'stop',
  'Stop sends SIGTERM and waits for graceful exit (M-11)',
  await import('./cli-contracts/stop.test.js')
);
addInProcess(
  'migrate',
  'Migrate --dry-run is non-destructive (N-3)',
  await import('./cli-contracts/migrate.test.js')
);
addInProcess(
  'offline-links',
  'Offline-mode internal links work in every hosting shape',
  await import('./cli-contracts/offline-links.test.js')
);
addInProcess(
  'plugin-contract',
  'Plugin contract + public API fixes (Slice C.1 + C.2)',
  await import('./cli-contracts/plugin-contract.test.js')
);
addInProcess(
  'action-dispatcher',
  'Action dispatcher context + onServerReady',
  await import('./cli-contracts/action-dispatcher.test.js')
);
addInProcess(
  'source-tools',
  'Source tools + page shape consistency (Slice C.3)',
  await import('./cli-contracts/source-tools.test.js')
);
addInProcess(
  'i18n',
  'i18n + workspace schema fixes (Slice D — M-6, T-Z6)',
  await import('./cli-contracts/i18n.test.js')
);
addInProcess(
  'llms-and-tui',
  'llms.txt sanitisation + TUI banner options (Slice F — T-Z10, T-Z11, N-13, N-16)',
  await import('./cli-contracts/llms-and-tui.test.js')
);
addInProcess(
  'plugin-assets-pipeline',
  'Plugin asset pipeline (PAA-1–PAA-4 — resolution + capability)',
  await import('./cli-contracts/plugin-assets-pipeline.test.js')
);
addInProcess(
  'asset-base-url',
  'Asset base-URL + engine-key (URL-1, URL-2 — <base> + KNOWN_KEYS)',
  await import('./cli-contracts/asset-base-url.test.js')
);
addInProcess(
  'url-routing',
  'URL Routing architecture stability (Phase 1, 2, 3)',
  await import('./cli-contracts/url-routing.test.js')
);
addInProcess(
  'runtime-deps',
  'Runtime-deps shared auto-install pipeline (RD-1..RD-CWE, CWE-78 fix)',
  await import('./cli-contracts/runtime-deps.test.js')
);
addInProcess(
  'doctor',
  'Doctor pre-flight diagnostics & health check contract',
  await import('./cli-contracts/doctor.test.js')
);
addInProcess(
  'plugin-iconify',
  'Iconify plugin & simplified syntax contract',
  await import('./cli-contracts/plugin-iconify.test.js')
);
addInProcess(
  'plugin-ai',
  'Plugin AI contracts (flags, tools, streaming)',
  await import('./cli-contracts/plugin-ai.test.js')
);
addInProcess(
  'layout-theming',
  'Layout, theming, navigation, and SEO metadata contracts',
  await import('./cli-contracts/layout-theming.test.js')
);
addInProcess(
  'engine-python',
  'Python engine contracts (@docmd/engine-python + @docmd/api)',
  await import('./cli-contracts/engine-python.test.js')
);
addInProcess(
  'variables-engine',
  'Variables and Personalisation Engine (build-time & client-side runtime)',
  await import('./cli-contracts/variables-engine.test.js')
);
addInProcess('mcp-read-doc', 'MCP read_doc confines reads to markdown inside the source directory', await import('./cli-contracts/mcp-read-doc.test.js'));
addInProcess('gitignore-scope', 'Gitignore and exclude patterns match only below their own directory', await import('./cli-contracts/gitignore-scope.test.js'));
addInProcess(
  'plugin-playground',
  'Plugin Playground contracts (core auto-load, rendering, zero-overhead)',
  await import('./cli-contracts/plugin-playground.test.js')
);
addInProcess(
  'plugin-mdx',
  'Plugin MDX contracts (JSX container structures, expressions, zero-overhead)',
  await import('./cli-contracts/plugin-mdx.test.js')
);
addInProcess(
  'host-flag',
  'Dev --host flag binds the requested interface',
  await import('./cli-contracts/host-flag.test.js')
);
addInProcess(
  'public-assets',
  'Public root assets contract (zero-config, configurable paths, nested preservation)',
  await import('./cli-contracts/public-assets.test.js')
);
addInProcess(
  'build-clean-tree',
  'Build leaves the git tree clean (reproducible registry, ignored platform binaries)',
  await import('./cli-contracts/build-clean-tree.test.js')
);
addInProcess(
  'test-root',
  'Test fixture root is unique per run',
  await import('./cli-contracts/test-root.test.js')
);
addInProcess(
  'action-host',
  'Action host: caller, origin allowlist, rebuild, onServerReady, close',
  await import('./cli-contracts/action-host.test.js')
);

// --- Section 2: Container parser (Phase 2 PR 1+2+3) ----------------------
addExternal(
  'container-normaliser',
  'Container normaliser (F1–F5)',
  'node',
  ['--test', 'packages/parser/test/**/*.test.js']
);

// --- Section 3: Utils (Path / HTML escape) -------------------------------
addExternal(
  'utils',
  'Utils (safePath, escHtml, attrEsc, jsonInject, scriptLiteral)',
  'node',
  ['--test', 'packages/utils/test/**/*.test.js']
);

// --- Section 4: Security (Phase 1 CVE suite) ------------------------------
addExternal(
  'security',
  'Security (Phase 1 CVE suite — 88 assertions)',
  'node',
  ['tests/security.test.js']
);

// --- Section 5: Feature integration (legacy feature-integration.test.js) --------------
addExternal(
  'features',
  'Feature integration (29 scenarios — zero-config, i18n, versioning, navigation, search, etc.)',
  'node',
  ['tests/feature-integration.test.js']
);

// --- Section 6: OKF plugin ------------------------------------------------
addExternal(
  'okf-plugin',
  'OKF plugin (Open Knowledge Format bundle generator)',
  'node',
  ['./packages/plugins/okf/node_modules/tsx/dist/cli.mjs', '--test', 'packages/plugins/okf/tests/*.test.ts']
);

// --- Section 7: Mermaid plugin --------------------------------------------
addExternal(
  'mermaid-plugin',
  'Mermaid plugin (diagram rendering and offline bundling)',
  'node',
  ['./packages/plugins/mermaid/node_modules/tsx/dist/cli.mjs', '--test', 'packages/plugins/mermaid/tests/*.test.ts']
);

// --- Section 8: LLMS plugin -----------------------------------------------
// The LLMS plugin doesn't have a `pnpm test` script yet, so the runner
// invokes the test runner directly. Default-locale + i18n opt-in tests
// live at packages/plugins/llms/tests/llms.test.js.
addExternal(
  'llms-plugin',
  'LLMS plugin (llms.txt / llms-full.txt / llms.json — default-locale + i18n opt-in)',
  'node',
  ['--test', 'packages/plugins/llms/tests/llms.test.js']
);

// ---------------------------------------------------------------------------
// Runner — execute each entry, print TUI section, aggregate results.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Runner — execute each entry with dynamic progress reporting.
// ---------------------------------------------------------------------------

const isTTY = Boolean(process.stdout.isTTY);
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startProgress(name, taskNum, total, completed) {
  const startMs = Date.now();
  const pct = Math.floor((completed / total) * 100);
  const prefix = `${DIM(`[${String(taskNum).padStart(2)}/${total}]`)} ${CYAN(`(${String(pct).padStart(2)}%)`)}`;

  if (!isTTY) {
    return { stop: () => {} };
  }

  let frameIdx = 0;
  const render = () => {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const spinner = CYAN(SPINNER_FRAMES[frameIdx++ % SPINNER_FRAMES.length]);
    const termWidth = process.stdout.columns || 80;
    const maxNameLen = Math.max(20, termWidth - 32);
    const displayName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + '…' : name;
    process.stdout.write(`\r\x1b[2K${prefix}  ${spinner}  ${displayName}  ${DIM(`(${elapsedSec}s)`)}`);
  };

  render();
  const interval = setInterval(render, 80);

  return {
    stop: () => {
      clearInterval(interval);
      if (isTTY) {
        process.stdout.write('\r\x1b[2K');
      }
    }
  };
}

function reportTaskResult({ taskNum, total, completed, name, passed, failed, elapsed, failures, output, isError }) {
  const pct = Math.floor((completed / total) * 100);
  const tag = (failed === 0 && !isError) ? GREEN(BOLD('[ PASS ]')) : RED(BOLD('[ FAIL ]'));
  const summary = (failed === 0 && !isError)
    ? `${passed} passed`
    : `${passed} passed, ${failed} failed`;
  const timeStr = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
  const line = `${DIM(`[${String(taskNum).padStart(2)}/${total}]`)} ${CYAN(`(${String(pct).padStart(2)}%)`)}  ${tag}  ${name}  ${DIM('•')}  ${summary}  ${DIM('(' + timeStr + ')')}`;

  if (isTTY) {
    process.stdout.write(`\r\x1b[2K${line}\n`);
  } else {
    console.log(line);
  }

  if (failed > 0 || isError) {
    if (failures && failures.length > 0) {
      for (const f of failures) {
        const text = typeof f === 'string' ? f : (f.output || f.message || String(f));
        const lines = text.split('\n').filter(Boolean).slice(-10);
        for (const l of lines) {
          console.log(DIM(`       ${l}`));
        }
      }
    } else if (output) {
      const lines = output.split('\n').filter(Boolean).slice(-10);
      for (const l of lines) {
        console.log(DIM(`       ${l}`));
      }
    }
  } else if (verbose && output) {
    console.log(DIM(output));
  }
}

let totalPassed = 0;
let totalFailed = 0;
const allFailures = [];
const startTime = Date.now();

console.log('');
console.log(CYAN(BOLD('Categorised test suite')));
console.log(DIM(`  ${testFiles.length} test file${testFiles.length === 1 ? '' : 's'} • ${new Date().toISOString().slice(0, 10)}`));
console.log('');

(async function main() {
  const totalTasks = testFiles.length;
  let completed = 0;

  for (let i = 0; i < totalTasks; i++) {
    const file = testFiles[i];
    const { id, name, module } = file;
    const taskNum = i + 1;
    const sectionStart = Date.now();
    const progress = startProgress(name, taskNum, totalTasks, completed);

    if (!module.external) {
      // In-process test
      let passed = 0;
      let failed = 0;
      let failures = [];
      let isError = false;
      let outputBuf = '';

      const origLog = console.log;
      const origWarn = console.warn;
      const origErr = console.error;

      if (!verbose) {
        console.log = (...a) => { outputBuf += a.join(' ') + '\n'; };
        console.warn = (...a) => { outputBuf += a.join(' ') + '\n'; };
        console.error = (...a) => { outputBuf += a.join(' ') + '\n'; };
      }

      try {
        await module.test.run();
        passed = module.results?.passed ?? 0;
        failed = module.results?.failed ?? 0;
        failures = module.results?.failures || [];
      } catch (e) {
        isError = true;
        failed += 1;
        failures.push(e.stack || e.message);
      } finally {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origErr;
      }

      progress.stop();
      completed++;
      const elapsed = Date.now() - sectionStart;
      totalPassed += passed;
      totalFailed += failed;
      for (const f of failures) allFailures.push({ name, output: f });

      reportTaskResult({
        taskNum,
        total: totalTasks,
        completed,
        name,
        passed,
        failed,
        elapsed,
        failures,
        output: outputBuf,
        isError
      });
    } else {
      // External process test
      let outBuf = '';
      const child = spawn(module.command, module.args, {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {
          ...process.env,
          DOCMD_TEST: 'true',
          DOCMD_NO_OPEN: 'true',
          NODE_ENV: 'test'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });

      child.stdout.on('data', (c) => { outBuf += c.toString(); });
      child.stderr.on('data', (c) => { outBuf += c.toString(); });

      const result = await new Promise((resolve) => {
        child.on('close', (code) => resolve({ status: code ?? 0, output: outBuf }));
        child.on('error', (err) => resolve({ status: 1, output: outBuf + '\n' + (err.stack || err.message) }));
      });

      progress.stop();
      completed++;
      const elapsed = Date.now() - sectionStart;

      let passed = 0;
      let failed = 0;
      if (result.status === 0) {
        const bruteMatch = result.output.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
        if (bruteMatch) {
          passed = parseInt(bruteMatch[1], 10);
          failed = parseInt(bruteMatch[2], 10);
        } else {
          const passLines = result.output.match(/pass\s+(\d+)/g) || [];
          const failLines = result.output.match(/fail\s+(\d+)/g) || [];
          for (const l of passLines) {
            const v = parseInt(l.replace(/[^\d]/g, ''), 10);
            if (!isNaN(v)) passed = Math.max(passed, v);
          }
          for (const l of failLines) {
            const v = parseInt(l.replace(/[^\d]/g, ''), 10);
            if (!isNaN(v)) failed = Math.max(failed, v);
          }
        }
      } else {
        failed = 1;
      }

      totalPassed += passed;
      totalFailed += failed;
      const taskFailures = (failed > 0 || result.status !== 0)
        ? [{ name, output: result.output.slice(-2000) }]
        : [];
      if (taskFailures.length > 0) allFailures.push(...taskFailures);

      reportTaskResult({
        taskNum,
        total: totalTasks,
        completed,
        name,
        passed,
        failed,
        elapsed,
        failures: taskFailures,
        output: result.output,
        isError: result.status !== 0
      });
    }
  }

  const totalMs = Date.now() - startTime;
  console.log(CYAN(BOLD('TEST SUMMARY')));
  console.log('');
  console.log(CYAN(BOLD(`Test summary: ${totalPassed} passed, ${totalFailed} failed across ${testFiles.length} files`)));
  console.log(DIM(`Total time: ${totalMs}ms`));
  if (allFailures.length > 0) {
    console.log('');
    console.log(RED('Failures:'));
    for (const f of allFailures) {
      console.log(RED(`  - ${f.name}`));
      if (f.output) {
        const lines = f.output.split('\n').filter(Boolean);
        const failLines = lines.filter(l => l.includes('❌') || l.includes('FAIL') || l.includes('Error'));
        const snippet = (failLines.length > 0 ? failLines : lines.slice(-15)).join('\n');
        console.log(DIM(snippet));
      }
    }
  }
  console.log('');

  process.exit(totalFailed > 0 ? 1 : 0);
})();