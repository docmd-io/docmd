/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation generator.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 *
 * Release preparation pipeline. Runs the full dev suite in five
 * clear category sections:
 *
 *   1. Setup       - stop running servers, wipe global binaries,
 *                    clean the monorepo
 *   2. Lint        - eslint over the entire repo, summarised
 *   3. Build       - pnpm install + pnpm -r run build, so the
 *                    test sections have dist files to run
 *                    against (clean wipes dist, this rebuilds it)
 *   4. Docker      - optional Docker availability check
 *   5. Tests       - categorised test suite (tests/runner.js,
 *                    365+ assertions covering Phase 1 security
 *                    CVEs + Phase 2 container parser + Phase 3
 *                    CLI contracts + OKF/LLMS plugin tests +
 *                    Mega Integration Test for workspaces,
 *                    i18n, versioning, and plugin combinations)
 *                    followed by per-package unit tests
 *                    (parser, utils, mermaid, okf) via
 *                    `pnpm -r run test --if-present` so a local
 *                    regression fails the release pipeline
 *   6. Link        - optional global npm link
 *
 * Each step inside a section shows [WAIT] (dim) when it starts
 * and [DONE] (green) when it finishes. No emojis.
 *
 * Default output is intentionally minimal: every step collapses to
 * one line, and every count (passed tests, lint errors, package
 * totals, Docker version, ...) accumulates into a single trailing
 * Summary block at the end of the pipeline. A fully-green run prints
 * a green `┌─ Summary` listing each section with its stat; a run
 * with any failure replaces that block with a red `┌─ Issues` listing
 * every failure with file:line detail.
 *
 * Pass --verbose (or --full) to stream the full test output as the
 * suite runs — useful when actively iterating on a test that just
 * started failing and you want to see the assertion text inline.
 *
 * Run:  pnpm prep
 *       pnpm prep --link            (skip tests, install globally)
 *       pnpm prep --skip-tests      (skip both test suites)
 *       pnpm prep --only=exit-codes (run a single test section)
 *       pnpm prep --verbose         (stream full test output inline)
 *       pnpm prep --full            (alias for --verbose)
 * --------------------------------------------------------------------
 */

const { execSync } = require('child_process');
const fs = require('fs');

process.env.DOCMD_TEST = 'true';
process.env.DOCMD_NO_OPEN = 'true';
process.env.NODE_ENV = 'test';
const pipelineStartMs = Date.now();

const path = require('path');
const monorepoRoot = path.resolve(__dirname, '..');
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

const args = process.argv.slice(2);

// --verbose / --full streams every step's raw output as it runs.
// Default mode keeps the pipeline minimal: each step collapses to
// one line and a final Issues section appears only if something failed.
const verbose = args.includes('--verbose') || args.includes('--full');

// --expand prints the per-section detail lines (test runner's own
// progress, lint per-file output, build per-package, etc.). Default
// shows only one summary line per step.
const expand = args.includes('--expand');

// --skip-tests short-circuits the slow test runner + per-package unit
// tests. Useful when you just need lint + build + docker check before
// opening a PR (the test pipeline takes 60+ seconds on a warm cache).
const skipTests = args.includes('--skip-tests') || args.includes('--fast');

// --skip-audit skips dependency vulnerability scanning.
const skipAudit = args.includes('--skip-audit');

// Issue accumulator — populated by every section so a single trailing
// "Issues" block can show the operator everything that needs fixing.
const issues = [];
function addIssue(severity, section, message, details = []) {
    issues.push({ severity, section, message, details });
}

// Stat accumulator — every section contributes a one-line entry that
// prints in the trailing Summary block. Lets the per-step line stay
// minimal ("[ DONE ] 28s") while still surfacing the actual numbers
// (passed counts, lint counts, etc.) at the end.
const stats = [];
function addStat(label, value, severity = 'ok') {
    stats.push({ label, value, severity });
}

// ── TUI design tokens (no emojis, only [WAIT] / [DONE] / [ FAIL ]) ──
const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    blue:   '\x1b[34m',
    cyan:   '\x1b[36m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    red:    '\x1b[31m'
};

// ── TUI primitives ────────────────────────────────────────────────────
// section() and footer() pair up to produce exactly one blank line
// between groups: footer ends with \n, section starts without \n.
function section(label, color = C.cyan) {
    console.log(`\n${color}${C.bold}${label.toUpperCase()}${C.reset}\n`);
}

function footer() {
    console.log('');
}

function startStep(label) {
    const text = `${C.dim}${label}${C.reset}`;
    const tag = `${C.blue}[ WAIT ]${C.reset}`;
    process.stdout.write(`${tag} ${text}\n`);
    return { label, startMs: Date.now(), text };
}

function finishStep(s, status, summary) {
    const effectiveStatus = status || 'done';
    const ms = Date.now() - s.startMs;
    const t = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
    const tag = effectiveStatus === 'done'
        ? `${C.green}[ DONE ]${C.reset}`
        : effectiveStatus === 'warn'
            ? `${C.yellow}[ WARN ]${C.reset}`
            : `${C.red}[ FAIL ]${C.reset}`;
    const sumTxt = summary ? `  ${C.dim}${summary}${C.reset}` : '';
    process.stdout.write('\x1b[1A\x1b[2K');
    process.stdout.write(
        `${tag} ${s.text.padEnd(52)} ${C.dim}${t}${C.reset}${sumTxt}\n`
    );
}



function run(cmd, opts = {}) {
    // opts.silent   — when true (default), suppress output unless cmd failed.
    // opts.capture  — return stdout/stderr as strings; never stream to the TUI.
    //                 Used by collapsed-mode test steps so we can parse a
    //                 summary line instead of dumping hundreds of test logs.
    // The function never calls process.exit; callers inspect `result.ok`.
    const silent  = opts.silent  !== false;
    const capture = opts.capture === true;
    try {
        const out = execSync(cmd, {
            stdio: capture
                ? ['ignore', 'pipe', 'pipe']
                : (silent ? 'ignore' : 'inherit'),
            maxBuffer: 64 * 1024 * 1024,
        });
        return {
            ok: true,
            stdout: capture ? out.toString() : '',
            stderr: '',
            status: 0,
        };
    } catch (e) {
        return {
            ok: false,
            stdout: capture ? (e.stdout ? e.stdout.toString() : '') : '',
            stderr: capture ? (e.stderr ? e.stderr.toString() : '') : '',
            status: e.status,
        };
    }
}

// ── Step helpers ──────────────────────────────────────────────────────
function deepWipe() {
    const bins = ['docmd', 'docmd-live'];
    for (const bin of bins) {
        try {
            const paths = execSync(`which -a ${bin}`, { stdio: 'pipe' })
                .toString().split('\n').filter(Boolean);
            for (const p of paths) {
                try { if (fs.existsSync(p)) fs.unlinkSync(p); }
                catch {
                    try { execSync(`rm -f "${p}"`, { stdio: 'ignore' }); } catch { /* ignore */ }
                }
            }
        } catch { /* ignore which failure */ }
    }
}

function runLint() {
    const s = startStep('Running eslint over monorepo');
    // eslint exits non-zero on errors — JSON is still on stdout. run()
    // never exits the process, so we can collect the lint output cleanly.
    const result = run('pnpm -s exec eslint . --format json', { capture: true });

    let errors = 0, warnings = 0;
    const details = [];
    let parseFailed = false;
    try {
        const results = JSON.parse(result.stdout || '[]');
        for (const file of results) {
            for (const msg of file.messages || []) {
                if (msg.severity === 2) errors++;
                else if (msg.severity === 1) warnings++;
                if (msg.severity >= 1) {
                    const relPath = (file.filePath || '')
                        .replace(process.cwd() + '/', '')
                        .replace(/^.*\/docmd\//, '');
                    details.push(`${relPath}:${msg.line} — ${msg.message}`);
                }
            }
        }
    } catch (_) {
        parseFailed = true;
    }

    if (!result.ok && (errors === 0 || parseFailed)) {
        errors = Math.max(errors, 1);
        const errMsg = (result.stderr || result.stdout || 'ESLint process failed to execute').trim();
        details.unshift(errMsg);
    }

    const status = errors > 0 ? 'fail' : (warnings > 0 ? 'warn' : 'done');
    finishStep(s, status);

    const summary = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
    addStat('Lint', summary, errors > 0 ? 'fail' : (warnings > 0 ? 'warn' : 'ok'));

    if (errors > 0) addIssue('error', 'Lint', `${errors} lint error(s)`, details);
    else if (warnings > 0) addIssue('warning', 'Lint', `${warnings} lint warning(s)`, details);
}

function runSecurityAudit() {
    const s = startStep('Auditing dependencies for high/critical CVEs');
    const result = run('pnpm audit --audit-level=high', { capture: true });

    if (result.ok) {
        finishStep(s);
        addStat('Security Audit', '0 high/critical vulnerabilities', 'ok');
    } else {
        finishStep(s, 'fail', 'vulnerabilities detected');
        addStat('Security Audit', 'high/critical CVEs found', 'fail');
        const lines = (result.stdout || result.stderr || '').split('\n').filter(l => l.trim());
        addIssue('error', 'Security Audit', 'High or critical dependency vulnerabilities detected', [
            'run `pnpm audit` for full vulnerability advisory details',
            ...lines.slice(0, 15)
        ]);
    }
}

function runTestStep(label, cmd, statLabel = label) {
    const s = startStep(label);

    // --expand / --verbose / --full: stream the raw output as before.
    // The finish line rewrites with [DONE] / [FAIL] depending on the
    // exit code. This is the only mode where the operator sees the
    // runner's own per-section TUI.
    if (verbose || expand) {
        const result = run(cmd, { silent: false });
        if (result.ok) finishStep(s);
        else {
            finishStep(s, 'fail');
            addIssue('error', label, 'test step failed', []);
        }
        addStat(statLabel, result.ok ? 'passed (see --verbose output for details)' : 'failed', result.ok ? 'ok' : 'fail');
        return;
    }

    const { spawn } = require('child_process');
    const child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBuf = '';
    let stderrBuf = '';
    let lineBuf = '';
    let numProgressLines = 0;
    // Print progress markers line-by-line as the runner emits them.
    // We listen on stdout for `┌─ <name>` headers and surface those as
    // small markers under the step's WAIT line, without scrolling or
    // hiding the eventual verdict. The whole line buffer is preserved
    // for the failure-tail replay below.
    const onChunk = (chunk, isErr) => {
        const buf = (isErr ? stderrBuf : stdoutBuf);
        const target = isErr ? 'stderr' : 'stdout';
        // Append to both the chunk stream and the line buffer.
        const text = chunk.toString();
        if (isErr) stderrBuf += text; else stdoutBuf += text;
        lineBuf += text;
        // Drain complete lines and surface only the section headers.
        let nl;
        while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            // Strip ANSI color codes before matching — the runner wraps every
            // section header in CYAN(...) so the literal output begins with
            // an escape sequence, not whitespace or the box-drawing char.
            // eslint-disable-next-line no-control-regex
            const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
            const m = stripped.match(/^\s*┌─\s+(.+?)\s*$/) ||
                      stripped.match(/^\s*\[\s*\d+\/\d+\]\s*\(\s*(\d+%)\)\s*\[\s*PASS\s*\]\s+(.+?)\s*•/);
            if (m) {
                const label = m[2] ? `${m[2].trim()} (${m[1]})` : m[1].trim();
                // Print as a small progress marker under the WAIT line.
                // Use a subtle "next" arrow so the operator knows it's
                // progress, not a new step.
                process.stdout.write(
                    `${C.dim}│   ${C.cyan}→${C.reset} ${C.dim}${label}${C.reset}\n`
                );
                numProgressLines++;
            }
        }
    };
    child.stdout.on('data', (c) => onChunk(c, false));
    child.stderr.on('data', (c) => onChunk(c, true));

    return new Promise((resolve) => {
        child.on('close', (exitCode) => {
            exitCode = exitCode ?? 0;
            const ms = Date.now() - s.startMs;
            const t = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
            const tag = exitCode === 0
                ? `${C.green}[ DONE ]${C.reset}`
                : `${C.red}[ FAIL ]${C.reset}`;

            let summary = '';
            if (exitCode === 0) {
                const m = stdoutBuf.match(/Test summary:\s*([^\n]+)/);
                summary = m ? m[1].trim() : 'passed';
                addStat(statLabel, summary, 'ok');
            } else {
                summary = `failed (exit ${exitCode})`;
                addStat(statLabel, summary, 'fail');
                addIssue('error', label, 'test command failed', [
                    `runner exited with status ${exitCode}`,
                    're-run with --expand to see the full failure output inline',
                    '--- last 30 lines of captured stdout ---',
                    ...stdoutBuf.split('\n').slice(-30),
                    '--- last 30 lines of captured stderr ---',
                    ...stderrBuf.split('\n').slice(-30),
                ]);
            }

            const sumTxt = summary ? `  ${C.dim}${summary}${C.reset}` : '';
            const linesUp = numProgressLines + 1;
            process.stdout.write(`\x1b[${linesUp}A\r`);
            process.stdout.write('\x1b[2K');
            process.stdout.write(`${tag} ${s.text.padEnd(52)} ${C.dim}${t}${C.reset}${sumTxt}\n`);
            if (numProgressLines > 0) {
                process.stdout.write(`\x1b[${numProgressLines}B`);
            }
            resolve();
        });
    });
}

// ── Final Summary / Issues section ───────────────────────────────────
// Single trailing block. When nothing failed, it renders as a green
// Summary listing every stat (one line per section). When issues were
// collected, it flips to a red Issues block with the same group /
// bullet layout used elsewhere in the TUI. Either way it lives in the
// same slot at the end of the pipeline, so the operator always knows
// where to look for the verdict.
function printSummary() {
    const elapsedMs = Date.now() - pipelineStartMs;
    const elapsedTxt = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

    if (issues.length === 0) {
        // Green Summary — every stat in one tidy list.
        section('Summary', C.green);
        const pad = Math.max(...stats.map(s => s.label.length)) + 2;
        for (const s of stats) {
            const tag = s.severity === 'warn'
                ? `${C.yellow}[ WARN ]${C.reset}`
                : `${C.green}[ DONE ]${C.reset}`;
            const label = `${s.label}`.padEnd(pad);
            console.log(`${tag} ${C.bold}${label}${C.reset}${s.value}`);
        }
        footer(C.green);
        console.log(`\n${C.green}${C.bold}✓ Maintenance Pipeline passed in ${elapsedTxt}.${C.reset}\n`);
        return;
    }

    // Failure case: render the Issues block.
    const errors   = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const color    = errors > 0 ? C.red : C.yellow;
    const head     = `Issues — ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
    section(head, color);

    const bySection = new Map();
    for (const i of issues) {
        if (!bySection.has(i.section)) bySection.set(i.section, []);
        bySection.get(i.section).push(i);
    }
    for (const [name, items] of bySection) {
        const tag = items.some(i => i.severity === 'error')
            ? `${C.red}[ FAIL ]${C.reset}`
            : `${C.yellow}[ WARN ]${C.reset}`;
        console.log(`${tag} ${C.bold}${name}${C.reset}`);
        for (const item of items) {
            console.log(`  ${item.message}`);
            const detailCap = 8;
            for (const detail of item.details.slice(0, detailCap)) {
                console.log(`    ${C.dim}${detail}${C.reset}`);
            }
            if (item.details.length > detailCap) {
                console.log(`    ${C.dim}… ${item.details.length - detailCap} more (re-run with --verbose for full output)${C.reset}`);
            }
        }
        console.log('');
    }

    if (errors > 0) {
        console.log(`${C.red}${C.bold}✗ Maintenance Pipeline failed in ${elapsedTxt}.${C.reset}`);
        console.log(`${C.bold}Failed sections:${C.reset}`);
        const failSections = Array.from(bySection.entries())
            .filter(([_, items]) => items.some(item => item.severity === 'error'))
            .map(([name]) => name);
        for (const sec of failSections) {
            console.log(`  - ${sec}`);
        }
        console.log('');
    } else {
        console.log(`${C.yellow}${C.bold}⚠ Maintenance Pipeline passed with warnings in ${elapsedTxt}.${C.reset}\n`);
    }
}

function runDockerCheck() {
    const s = startStep('Checking Docker availability');
    let hasDocker = '';
    try {
        hasDocker = execSync('which docker 2>/dev/null', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
    } catch { /* not installed */ }

    if (!hasDocker && !process.env.DOCKER_HOST) {
        finishStep(s, 'warn');
        addStat('Docker', 'not installed — skipped', 'warn');
        return;
    }
    try {
        const version = execSync('docker --version', { encoding: 'utf8', stdio: ['pipe', 'pipe'] }).trim();
        finishStep(s, 'done');
        addStat('Docker', version.replace('Docker version ', 'Docker '), 'ok');
    } catch {
        finishStep(s, 'warn');
        addStat('Docker', 'binary not functional', 'warn');
    }
}

// ── Main pipeline ────────────────────────────────────────────────────

// Header — banner + "Maintenance Pipeline" subtitle. Inlined here
// (rather than calling `node tools/status.js start:reset`) because
// that helper opens a section frame which we don't want prep.js
// to inherit. prep.js owns its own section boundaries.
const LOGO = '\n'
    + '    _                 _ \n'
    + '  _| |___ ___ _____ _| |\n'
    + ' | . | . |  _|     | . |\n'
    + ' |___|___|___|_|_|_|___|\n';
console.log(`${C.blue}${LOGO}${C.reset}`);
console.log(`${C.dim} Monorepo Maintenance Pipeline ${C.reset}\n`);

// Section 1: Setup
section('Setup', C.blue);
{
    const s = startStep('Stopping active servers');
    const r = run('pnpm -s stop');
    if (r.ok) finishStep(s);
    else { finishStep(s, 'fail', `exit ${r.status}`); addIssue('error', 'Setup', `pnpm stop failed (exit ${r.status})`, []); }
}
{
    const s = startStep('Wiping global docmd binaries');
    const pkgs = ['@docmd/core', '@docmd/monorepo', 'docmd', 'docmd-live'];
    for (const pkg of pkgs) {
        try { execSync('npm uninstall -g ' + pkg + ' -s', { stdio: 'ignore' }); } catch { /* ignore */ }
        try { execSync('pnpm uninstall -g ' + pkg + ' -s', { stdio: 'ignore' }); } catch { /* ignore */ }
    }
    deepWipe();
    finishStep(s);
}
{
    const isHard = args.includes('--hard') || args.includes('--clean-all');
    const s = startStep(isHard ? 'Cleaning monorepo (hard reset)' : 'Cleaning monorepo build artifacts');
    const cleanCmd = isHard
        ? 'pnpm -s clean'
        : 'rm -rf packages/*/dist packages/plugins/*/dist packages/engines/*/dist packages/*/public packages/plugins/*/public packages/*/site packages/plugins/*/site packages/engines/rust/native/bin/*.node *.tsbuildinfo temp-* _playground/local-tars >/dev/null 2>&1 || true';
    const r = run(cleanCmd);
    if (r.ok) finishStep(s);
    else { finishStep(s, 'fail', `exit ${r.status}`); addIssue('error', 'Setup', `clean failed (exit ${r.status})`, []); }
}
{
    const s = startStep('Verifying monorepo dependencies');
    const r = run('pnpm install --frozen-lockfile --prefer-offline');
    if (r.ok) finishStep(s);
    else { finishStep(s, 'fail', `exit ${r.status}`); addIssue('error', 'Setup', `pnpm install failed (exit ${r.status})`, []); }
}
addStat('Setup', 'cleaned + verified dependencies', 'ok');
footer(C.blue);

// Section 2: Lint — runs after Setup reinstalls deps so eslint is available.
section('Lint', C.cyan);
runLint();
footer(C.cyan);

// Section 3: Security Audit — scans monorepo dependencies for High/Critical CVEs
section('Security Audit', C.blue);
if (skipAudit) {
    const s = startStep('Auditing dependencies for high/critical CVEs');
    finishStep(s, 'done', 'skipped (--skip-audit)');
    addStat('Security Audit', 'skipped (--skip-audit)', 'ok');
} else {
    runSecurityAudit();
}
footer(C.blue);

// Section 4: Build — required so tests have dist files to run against.
// `pnpm clean` (called in Setup) wipes every package's dist directory;
// deps are already restored by Setup's install step.
section('Build', C.cyan);
{
    const s = startStep('Building all packages (pnpm -r run build)');
    const r = run('pnpm -r run build');
    if (r.ok) finishStep(s);
    else { finishStep(s, 'fail', `exit ${r.status}`); addIssue('error', 'Build', `pnpm -r run build failed (exit ${r.status})`, []); }
}
addStat('Build', 'built all packages', 'ok');
footer(C.cyan);

// Section 4 was an unconditional Docker availability check. Moved into
// runPostTestsSections() so it only runs when --docker is passed.

// Section 5: Tests
// runTestStep is now async (it streams stdout and surfaces progress
// markers as the runner emits section headers). We can't use top-level
// await in CommonJS, so the whole main pipeline is wrapped in an async
// IIFE that awaits each test step.
(async () => {
    section('Tests', C.blue);
    if (skipTests) {
        const s = startStep('Categorised test suite (tests/runner.js)');
        finishStep(s, 'done', 'skipped (--skip-tests)');
        addStat('Tests · runner.js', 'skipped (--skip-tests)', 'ok');
    } else {
        const only = args.find((a) => a.startsWith('--only='));
        const runnerArgs = only ? ' ' + only : '';
        // The categorised runner covers all monorepo unit, contract,
        // security, plugin, and feature integration suites in a single pass.
        await runTestStep('Categorised test suite (tests/runner.js)',
            'node tests/runner.js' + runnerArgs, 'Tests · runner.js');
    }
    footer(C.blue);
    // Continue the rest of the pipeline now that the async test step
    // has resolved. Sections 6+ still run inside this async IIFE.
    runPostTestsSections();
})();

// Async continuation of the pipeline. Section 6+ run inside the
// async IIFE started above so they execute after the test step.
async function runPostTestsSections() {

// Section 6: Consumer Simulation — regenerate the playground tarballs.
// Skipped when --skip-tests is set so we never publish tars from a
// state we haven't validated. Tests already passed at this point.
// sim.mjs --skip-monorepo-build reuses the dist/ this prep run produced.
section('Consumer Simulation', C.cyan);
if (skipTests) {
    const s = startStep('Regenerating tarballs (sim.mjs --regen-tars)');
    finishStep(s, 'done', 'skipped (--skip-tests)');
    addStat('Consumer Sim', 'skipped (--skip-tests)', 'ok');
} else {
    const s = startStep('Regenerating tarballs (sim.mjs --regen-tars)');
    const r = run('node tools/sim.mjs --source _playground --regen-tars --skip-monorepo-build');
    if (r.ok) {
        finishStep(s, 'done', 'tars written to _playground/local-tars/');
        addStat('Consumer Sim', 'tarballs regenerated', 'ok');
    } else {
        finishStep(s, 'fail', `exit ${r.status}`);
        addIssue('error', 'Consumer Sim', `sim.mjs --regen-tars failed (exit ${r.status})`, []);
    }
}
footer(C.cyan);

// Section 7: Docker (opt-in via --docker). Default skips it because
// most developers do not have a running Docker daemon and the check
// adds startup latency without test value. Pass --docker to include it.
if (args.includes('--docker')) {
    section('Docker', C.blue);
    runDockerCheck();
    footer(C.blue);
}

// Section 8: Link (optional)
if (args.includes('--link')) {
    section('Link', C.blue);
    const s = startStep('Linking @docmd/core globally');
    try {
        execSync('npm link --silent', {
            cwd: require('path').join(process.cwd(), 'packages/core'),
            stdio: 'ignore'
        });
        finishStep(s, 'done', 'docmd command available globally');
    } catch {
        finishStep(s, 'fail', 'npm link failed');
        addIssue('error', 'Link', 'npm link failed', []);
    }
    footer(C.blue);
}

// Section 7: Summary / Issues — single trailing block. Renders a
// green Summary on a clean run, or a red Issues block on failure.
// Either way it lives in the same slot at the end of the pipeline
// so the operator always knows where to look for the verdict.
printSummary();

// Exit code: any error-level issue is fatal. Warnings alone keep the
// pipeline green so the operator can decide whether to act on them.
const hasErrors = issues.some(i => i.severity === 'error');
if (hasErrors) process.exit(1);
}