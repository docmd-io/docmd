/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/api
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * Runtime dependency bootstrap for plugins, templates, and engines.
 *
 * This module is the single source of truth for the "fetch a missing
 * official dependency on first build" path. Both `hooks.ts` (plugin /
 * template loader) and `engine.ts` (engine loader) call into it.
 *
 * Why it exists:
 *   - Security: replaces the previous `execSync(\`pnpm add ${pkg}\`)`
 *     shell-string command, which was a CWE-78 surface if a name ever
 *     leaked in from an untrusted config (fixed by strict regex +
 *     `spawn` arg-array + defence-in-depth registry lookup).
 *   - Reuse: the install pipeline was duplicated in hooks and engine;
 *     one module, one set of behaviour changes.
 *   - Idempotency: TUI status lines are reported through a per-build
 *     cache so a dev-server rebuild that re-runs the loader doesn't
 *     spam the same "WAIT / DONE" line pair for packages already on
 *     disk.
 *
 * Public surface (re-exported from `index.ts`):
 *   - `loadRuntimeRegistry()`         — read & cache the generated registry
 *   - `detectPackageManager(cwd)`     — pick pnpm / yarn / bun / npm
 *   - `getDocmdVersion()`             — `@docmd/core` version (for pinning)
 *   - `isValidRuntimeDepName(name)`   — strict regex, returns boolean
 *   - `installRuntimeDep(pkg)`        — non-shell `spawn` install, true on ok
 *   - `reportInstallStatus(shortName, status)` — idempotent TUI reporter
 *   - `getBuildStatusReporter()`     — single per-build reporter cache
 */

import path from 'node:path';
import nativeFs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { isMainThread } from 'node:worker_threads';
import { TUI } from '@docmd/tui';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Monorepo root - two levels up from packages/api/dist/
const __monorepoRoot = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Strict package-name regex (CWE-78 defence)
// Accepts:  @docmd/plugin-foo
//           @docmd/template-summer
//           @docmd/engine-rust
//           @docmd/plugin-math-katex  (two-segment short names are fine)
// Rejects: anything with shell metacharacters, scoped third-party names,
//          uppercase letters, or names that don't fit the @docmd/<kind>-*
//          pattern. A second defence lives in `installRuntimeDep`, which
//          cross-checks the lookup against `loadRuntimeRegistry()` so a
//          forbidden name that happens to match the regex still cannot be
//          installed.
// ---------------------------------------------------------------------------
const PACKAGE_NAME_RE = /^@docmd\/(?:plugin|template|engine)-[a-z0-9][a-z0-9.-]*$/;

// ---------------------------------------------------------------------------
// Registry loader
// ---------------------------------------------------------------------------

let _registry: Record<string, any> | null = null;

/**
 * Read the generated runtime registry for plugins / templates / engines.
 *
 * Resolution order:
 *   1. `<package-root>/registry/plugins.generated.json`  (monorepo dev +
 *      published package, both expose this path under `files`).
 *   2. `<monorepo-root>/packages/api/registry/plugins.generated.json`
 *      (fallback for callers that import us from a nested dist path
 *      that the first candidate doesn't satisfy).
 *
 * The result is cached per process so a hot dev-server loop doesn't
 * re-read the file on every hook call.
 */
export function loadRuntimeRegistry(): Record<string, any> {
  if (_registry) return _registry;
  const candidates = [
    path.resolve(__dirname, '..', 'registry', 'plugins.generated.json'),
    path.resolve(__monorepoRoot, 'packages', 'api', 'registry', 'plugins.generated.json'),
  ];
  for (const candidate of candidates) {
    if (nativeFs.existsSync(candidate)) {
      _registry = JSON.parse(nativeFs.readFileSync(candidate, 'utf8'));
      return _registry!;
    }
  }
  _registry = {};
  return _registry;
}

/** Force-reload the registry cache (tests only). */
export function _resetRuntimeRegistryCache(): void {
  _registry = null;
}

// ---------------------------------------------------------------------------
// Project inspection helpers
// ---------------------------------------------------------------------------

/**
 * Detect the package manager used in `cwd` (or any of its ancestors).
 * Walks upward until a known lockfile is found; defaults to `npm`.
 */
export function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  let dir = path.resolve(cwd);
  while (true) {
    if (nativeFs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (nativeFs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (nativeFs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
    if (nativeFs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'npm';
}

/**
 * Resolve the current `@docmd/core` version, used to pin `pkg@<version>`
 * installs to the same release line as the user's docmd. Falls back to
 * `latest` when the core package isn't resolvable (e.g. running inside
 * a CI image without node_modules linked).
 */
export function getDocmdVersion(): string {
  // DOCMD_INSTALL_VERSION overrides everything. Lets users / CI pin auto-installs
  // to a specific version (or 'latest') independent of the installed core.
  if (process.env.DOCMD_INSTALL_VERSION) {
    return process.env.DOCMD_INSTALL_VERSION.trim() || 'latest';
  }
  try {
    const corePkgPath = require.resolve('@docmd/core/package.json', {
      paths: [process.cwd(), __dirname, __monorepoRoot],
    });
    const pkg = JSON.parse(nativeFs.readFileSync(corePkgPath, 'utf8'));
    return pkg.version || 'latest';
  } catch {
    return 'latest';
  }
}

// ---------------------------------------------------------------------------
// Package-name validator (CWE-78 defence)
// ---------------------------------------------------------------------------

/**
 * True only when `name` is an `@docmd/<kind>-<short>` reference. This
 * is the FIRST line of defence; `installRuntimeDep` also cross-checks
 * against `loadRuntimeRegistry()` so a name that matches the regex but
 * isn't in the official catalog still cannot be installed.
 */
export function isValidRuntimeDepName(name: string): boolean {
  return typeof name === 'string' && PACKAGE_NAME_RE.test(name);
}

/**
 * Map an npm package name to its registry short key. Returns null when
 * the name is not an `@docmd/<kind>-*` reference.
 */
function shortNameOf(packageName: string): string | null {
  if (!isValidRuntimeDepName(packageName)) return null;
  if (packageName.startsWith('@docmd/plugin-')) return packageName.replace('@docmd/plugin-', '');
  if (packageName.startsWith('@docmd/template-')) return packageName.replace('@docmd/template-', '');
  if (packageName.startsWith('@docmd/engine-')) return packageName.replace('@docmd/engine-', '');
  return null;
}

// ---------------------------------------------------------------------------
// Idempotent TUI status reporter
// ---------------------------------------------------------------------------

/**
 * Per-build cache of short-name → status pairs. Constructed once per
 * loader run via `getBuildStatusReporter()`. Subsequent attempts to
 * report the same short name in the same build are silently dropped,
 * so a dev-server rebuild can't spam the same line pair.
 */
interface StatusLine {
  status: 'WAIT' | 'DONE' | 'FAIL' | 'SKIP' | string;
  message?: string;
}

type BuildReporter = {
  begin(shortName: string): void;
  finish(shortName: string, status: StatusLine['status']): void;
  setMessage(shortName: string, message: string): void;
  reset(): void;
};

/**
 * Build a fresh reporter. Each `loadPlugins` / `loadEngine` call gets
 * its own reporter so the cache is bound to one loader run.
 */
export function getBuildStatusReporter(): BuildReporter {
  const seen = new Map<string, StatusLine>();
  return {
    begin(shortName) {
      // Skip if we've already emitted a "WAIT" for this name this build —
      // the install is in flight (or finished); re-emitting would make the
      // TUI flicker on dev-server rebuilds.
      if (seen.has(shortName)) return;
      seen.set(shortName, { status: 'WAIT' });
      TUI.step(`Downloading missing runtime dep: ${shortName}`, 'WAIT');
    },
    finish(shortName, status) {
      const prev = seen.get(shortName);
      seen.set(shortName, { status, message: prev?.message });
      TUI.step(`Runtime dep ${status.toLowerCase()}: ${shortName}`, status);
    },
    setMessage(shortName, message) {
      const prev = seen.get(shortName) ?? { status: 'WAIT' };
      seen.set(shortName, { status: prev.status, message });
    },
    reset() {
      seen.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// `spawn`-based installer (CWE-78 fix)
// ---------------------------------------------------------------------------

/**
 * Build the arg array for the user's package manager. Returned as an
 * array, never a string, so `spawn` doesn't go through a shell and the
 * package name can never be reinterpreted as a flag or command.
 */
function buildInstallArgs(packageName: string, pm: 'pnpm' | 'yarn' | 'bun' | 'npm'): string[] {
  switch (pm) {
    case 'pnpm': return ['add', packageName];
    case 'yarn': return ['add', packageName];
    case 'bun':  return ['add', packageName];
    case 'npm':  return ['install', '--no-save', packageName];
  }
}

/**
 * Non-shell install of an official runtime dependency. Replaces the
 * previous `execSync(\`${pm} add ${pkg}\`)` with `spawn` + arg array.
 *
 * Defence in depth (in order):
 *   1. `isValidRuntimeDepName(pkg)` — strict regex.
 *   2. `loadRuntimeRegistry()[shortName]` — official catalog lookup.
 *   3. `spawn(pm, [...args], { shell: false })` — never hits a shell.
 *
 * Returns true on a clean exit code from the package manager, false
 * otherwise. Caller decides whether a fail should be fatal.
 */
// Module-level dedup flag for the missing-package.json hint. Without it,
// every missing plugin re-prints the same one-liner from the main thread.
let _noPackageJsonWarned = false;

// Tracks packages whose install already failed in this process so the
// error block prints exactly once per package, not once per rebuild.
// Dev server rebuilds call loadPlugins again, but a persistent failure
// (e.g. version not on npmjs yet) won't fix itself between rebuilds, so
// re-printing just floods the TUI. Call resetInstallState() to clear.
const _failedInstalls = new Set<string>();

/**
 * Clear the install-attempt dedup state. Intended for explicit user
 * actions (e.g. a `docmd init` re-run) where re-trying is meaningful.
 * Dev server rebuilds do NOT call this — they rely on the dedup.
 */
export function resetInstallState(): void {
  _failedInstalls.clear();
  _noPackageJsonWarned = false;
}

/**
 * Fetch the latest version of a package published on npm. Returns null
 * on any error (offline, private registry, malformed response). Used
 * as a fallback when the locally-pinned version doesn't exist on the
 * registry yet, e.g. during a release where core is bumped before the
 * plugins are published.
 */
export async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: controller.signal,
      headers: { 'accept': 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data: any = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export async function installRuntimeDep(packageName: string): Promise<boolean> {
  // Worker threads never attempt auto-install. Only the main thread has
  // write access to node_modules and the user's terminal. Without this
  // guard, the worker pool (one thread per core) each spawn npm install
  // for the same missing plugin, printing the same failure N times
  // and racing on the same node_modules dir. Workers skip silently and
  // let the main thread's loadPlugins() handle the install once.
  if (!isMainThread) return false;

  if (!isValidRuntimeDepName(packageName)) {
    TUI.warn(`Refusing to install non-runtime dep: ${packageName}`);
    return false;
  }
  const shortName = shortNameOf(packageName);
  if (!shortName) return false;

  // Dedup: if this package already failed to install in this process,
  // skip silently. Dev server rebuilds hit loadPlugins again, and a
  // persistent failure (e.g. version not on npmjs yet) won't fix
  // itself between rebuilds. Re-printing floods the TUI.
  if (_failedInstalls.has(packageName)) return false;

  const registry = loadRuntimeRegistry();
  if (!registry[shortName]) {
    TUI.warn(`Runtime dep "${shortName}" not found in official registry`);
    _failedInstalls.add(packageName);
    return false;
  }

  const cwd = process.cwd();

  // NOTE: we deliberately do NOT pre-check for package.json here. Package
  // managers (npm/pnpm/yarn/bun) walk up the tree to find the nearest
  // project root themselves, so a missing local package.json in a
  // workspace sub-project (e.g. docs/docmd-search/ when docs/package.json
  // exists one level up) is NOT a failure case. The spawn must be
  // attempted. If the install genuinely fails because there's no project
  // anywhere up the tree, the `error` / `close` handlers below detect
  // that and surface the helpful hint exactly once per run.

  const pm = detectPackageManager(cwd);
  const version = getDocmdVersion();
  // Don't pin when running a pre-release local build (e.g. 0.8.16 dev
  // tar installed locally while npmjs only has 0.8.15). Pinning would
  // cause every auto-install to fail with ETARGET. Query the registry
  // for the actually-published latest version and use that instead.
  let resolvedVersion = version;
  if (version !== 'latest') {
    const npmLatest = await fetchLatestNpmVersion(packageName);
    if (npmLatest && npmLatest !== version) {
      resolvedVersion = npmLatest;
    }
  }
  const versionedPackage =
    resolvedVersion === 'latest' ? packageName : `${packageName}@${resolvedVersion}`;

  return new Promise((resolve) => {
    const reporter = getBuildStatusReporter();
    reporter.begin(shortName);

    const executeInstall = (currentPm: 'pnpm' | 'yarn' | 'bun' | 'npm') => {
      const args = buildInstallArgs(versionedPackage, currentPm);
      if (currentPm === 'npm' && !args.includes('--foreground-scripts')) {
        args.splice(1, 0, '--foreground-scripts');
      }
      let stderr = '';
      let stdout = '';
      const useShell = process.platform === 'win32';
      const child = spawn(currentPm, args, { cwd, shell: useShell, timeout: 60_000 });

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (err: any) => {
        if (err?.code === 'ENOENT' && currentPm !== 'npm') {
          return executeInstall('npm');
        }
        reporter.finish(shortName, 'FAIL');
        const surface = (stderr || err.message || 'unknown error')
          .toString()
          .split('\n')
          .filter(Boolean)
          .slice(0, 3)
          .join(' | ');
        const hasProject = (() => {
          let dir = path.resolve(cwd);
          while (true) {
            if (nativeFs.existsSync(path.join(dir, 'package.json'))) return true;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
          return false;
        })();
        if (!hasProject && !_noPackageJsonWarned) {
          _noPackageJsonWarned = true;
          TUI.warn(
            `No package.json found in ${cwd} (or any parent directory). ` +
            `docmd will run with limited functionality (plugins/templates unavailable). ` +
            `For the full setup, run:\n` +
            `  npx @docmd/core init`
          );
          resolve(false);
          return;
        }
        const isTemplate = packageName.startsWith('@docmd/template-');
        const hint = isTemplate
          ? `Add "${packageName}" to your package.json dependencies, then run your normal install step.`
          : `Run "docmd add ${shortName}" to install it, or add "${packageName}" to your package.json.`;
        TUI.warn(
          `Auto-install of ${packageName} failed: ${surface}\n  > ${hint}`,
        );
        _failedInstalls.add(packageName);
        resolve(false);
      });

      child.on('close', (code) => {
        if (code === 0) {
          ensureNativePostinstalls(cwd);
          reporter.finish(shortName, 'DONE');
          return resolve(true);
        }
        if (currentPm !== 'npm') {
          return executeInstall('npm');
        }
        // npm v10+ exits with code 1 when the .npmrc contains unknown env-config
        // keys (e.g. "verify-deps-before-run", "_jsr-registry"). These emit
        // `npm warn Unknown env config ...` lines but do NOT indicate a failed
        // install. Detect this: if stderr contains ONLY `npm warn` lines (no
        // `npm error`) and the package was written to node_modules, treat as ok.
        const stderrStr = stderr.toString();
        const stderrLines = stderrStr.split('\n').filter(Boolean);
        const hasOnlyWarnings = stderrLines.length > 0 &&
          stderrLines.every(l => l.trimStart().startsWith('npm warn'));
        if (hasOnlyWarnings) {
          // Double-check by looking for success markers in stdout
          const stdoutStr = stdout.toString();
          const looksLikeSuccess =
            stdoutStr.includes('added') ||
            stdoutStr.includes('up to date') ||
            stdoutStr.includes('audited') ||
            stdoutStr.includes(packageName);
          if (looksLikeSuccess) {
            ensureNativePostinstalls(cwd);
            reporter.finish(shortName, 'DONE');
            return resolve(true);
          }
        }
        reporter.finish(shortName, 'FAIL');
        const surface = stderrLines
          .filter(l => !l.trimStart().startsWith('npm warn'))
          .slice(0, 3)
          .join(' | ') || stderrLines.slice(0, 3).join(' | ');
        const hasProject = (() => {
          let dir = path.resolve(cwd);
          while (true) {
            if (nativeFs.existsSync(path.join(dir, 'package.json'))) return true;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
          return false;
        })();
        if (!hasProject && !_noPackageJsonWarned) {
          _noPackageJsonWarned = true;
          TUI.warn(
            `No package.json found in ${cwd} (or any parent directory). ` +
            `docmd will run with limited functionality (plugins/templates unavailable). ` +
            `For the full setup, run:\n` +
            `  npx @docmd/core init`
          );
          resolve(false);
          return;
        }
        const isTemplate = packageName.startsWith('@docmd/template-');
        const hint = isTemplate
          ? `Add "${packageName}" to your package.json dependencies, then run your normal install step.`
          : `Run "docmd add ${shortName}" to install it, or add "${packageName}" to your package.json.`;
        TUI.warn(
          `Auto-install of ${packageName} failed (exit ${code}): ${surface || 'unknown error'}\n  > ${hint}`,
        );
        _failedInstalls.add(packageName);
        resolve(false);
      });

    };

    executeInstall(pm);
  });
}

/**
 * Safe non-shell install of any list of packages.
 * Replaces execSync(cmd) shell executions in plugins (e.g. search plugin).
 */
export function installPackages(packages: string[], cwd: string = process.cwd()): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Array.isArray(packages) || packages.length === 0) {
      return resolve(true);
    }
    // Strict defense: ensure each package name only contains characters safe for CLI arguments
    const SAFE_PKG_RE = /^[a-z0-9@/.\-^_*]+$/i;
    for (const pkg of packages) {
      if (!SAFE_PKG_RE.test(pkg)) {
        TUI.warn(`Refusing to install unsafe package: ${pkg}`);
        return resolve(false);
      }
    }

    const pm = detectPackageManager(cwd);

    const executeInstall = (currentPm: 'pnpm' | 'yarn' | 'bun' | 'npm') => {
      const args = buildInstallArgs(packages[0], currentPm);
      for (let i = 1; i < packages.length; i++) {
        args.push(packages[i]);
      }

      // Add --foreground-scripts when using npm to make sure postinstalls run
      if (currentPm === 'npm') {
        args.splice(1, 0, '--foreground-scripts');
      }

      let stderr = '';
      let stdout = '';
      const useShell = process.platform === 'win32';
      const child = spawn(currentPm, args, { cwd, shell: useShell, timeout: 300_000 });

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (err: any) => {
        if (err?.code === 'ENOENT' && currentPm !== 'npm') {
          return executeInstall('npm');
        }
        TUI.warn(`Auto-install command execution failed: ${err.message}`);
        resolve(false);
      });
      child.on('close', (code) => {
        if (code === 0) {
          ensureNativePostinstalls(cwd);
        } else {
          if (currentPm !== 'npm') {
            return executeInstall('npm');
          }
          TUI.warn(`Auto-install failed with exit code ${code} for command: ${currentPm} ${args.join(' ')}`);
          if (stderr.trim()) {
            TUI.warn(`Stderr:\n${stderr}`);
          }
          if (stdout.trim()) {
            TUI.warn(`Stdout:\n${stdout}`);
          }
        }
        resolve(code === 0);
      });
    };

    executeInstall(pm);
  });
}

function ensureNativePostinstalls(cwd: string): void {
  const onnxScript = findPackageDir('onnxruntime-node', [cwd, process.cwd()]);
  if (onnxScript) {
    const scriptPath = path.join(onnxScript, 'script', 'install.js');
    const altScriptPath = path.join(onnxScript, 'script', 'install');
    const target = nativeFs.existsSync(scriptPath) ? scriptPath : (nativeFs.existsSync(altScriptPath) ? altScriptPath : null);
    if (target) {
      try {
        spawnSync(process.execPath, [target], { cwd: onnxScript, stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
  }
}

function findPackageDir(packageName: string, startDirs: string[]): string | null {
  for (const startDir of startDirs) {
    if (!startDir) continue;
    let dir = path.resolve(startDir);
    while (true) {
      const candidate = path.join(dir, 'node_modules', packageName, 'package.json');
      if (nativeFs.existsSync(candidate)) {
        return path.dirname(candidate);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers consumed by hooks.ts and engine.ts
// ---------------------------------------------------------------------------

/**
 * Short key for a package name, used for status lines and registry
 * lookups. Returns null for names that fail validation.
 */
export function shortKey(packageName: string): string | null {
  return shortNameOf(packageName);
}

/**
 * Manually resolve a package entry point by walking up from `startDir`
 * looking for `node_modules/<packageName>/package.json`. This bypasses
 * Node's internal module resolution cache, which can fail to find a
 * package that was just installed during the same process (the cache
 * remembers the "not found" result from the initial failed resolve).
 *
 * Returns the absolute path to the entry JS file, or null if not found.
 */
export function manualResolvePackageEntry(packageName: string, startDir: string): string | null {
  const pkgSubPath = path.join('node_modules', packageName);
  let dir = path.resolve(startDir);
  // Walk up the directory tree looking for node_modules/<pkg>
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, pkgSubPath, 'package.json');
    if (nativeFs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(nativeFs.readFileSync(candidate, 'utf8'));
        // Resolve the entry point: exports['.'] > main > index.js
        let entry: string | undefined;
        if (pkg.exports && typeof pkg.exports === 'object' && pkg.exports['.']) {
          const exp = pkg.exports['.'];
          entry = typeof exp === 'string' ? exp : (exp.import || exp.require || exp.default);
        }
        if (!entry) entry = pkg.main || 'index.js';
        const cleanEntry = (entry || 'index.js').replace(/^\.\//, '');
        const entryPath = path.join(dir, pkgSubPath, cleanEntry);
        if (nativeFs.existsSync(entryPath)) return entryPath;
        // Try dist/index.js as a common fallback
        const distEntry = path.join(dir, pkgSubPath, 'dist', 'index.js');
        if (nativeFs.existsSync(distEntry)) return distEntry;
      } catch {
        // Malformed package.json — keep walking
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Re-load `pkg` after an install attempt. Tries `createRequire` first
 * (honours exports conditions), then falls back to a manual node_modules
 * walk-up that bypasses Node's internal resolution cache. The cache can
 * stale-fail when a package was just `npm install`ed during the same
 * process — the initial `require.resolve` failure is remembered even
 * after the package appears on disk.
 *
 * Returns the module reference or null on failure.
 */
export async function tryLoadAfterInstall(
  packageName: string,
  consumerCwd: string = process.cwd(),
): Promise<any | null> {
  // Strategy 1: createRequire (honours exports field, but may stale-cache)
  try {
    const consumerRequire = createRequire(consumerCwd + '/');
    const entry = consumerRequire.resolve(packageName);
    return await import(pathToFileURL(entry).href);
  } catch {
    // Fall through to manual resolution
  }

  // Strategy 2: manual node_modules walk-up (bypasses cache, always
  // does a fresh filesystem check). This is the reliable path when
  // the package was installed seconds ago in the same process.
  const manualEntry = manualResolvePackageEntry(packageName, consumerCwd);
  if (manualEntry) {
    try {
      return await import(pathToFileURL(manualEntry).href);
    } catch (e: any) {
      const detail = e?.code ? `${e.code}: ${e.message}` : (e?.message || String(e));
      TUI.warn(`Post-install load of ${packageName} (manual resolve to ${manualEntry}) failed: ${detail}`);
      return null;
    }
  }

  TUI.warn(`Post-install load of ${packageName} from ${consumerCwd} failed: package not found in node_modules tree`);
  return null;
}

/**
 * Requirements specification for pre-flight dependency installation.
 */
export interface PreflightRequirements {
  templates?: string[];
  plugins?: string[];
  engines?: string[];
  semanticSearch?: boolean;
}

/**
 * Pre-flight batch installer for all runtime dependencies configured
 * across a project or workspace.
 *
 * Scans for missing official templates, plugins, engines, and semantic
 * search packages, and installs all missing packages together in a
 * single batch command. This prevents package managers (specifically
 * modern npm tree reconciliation) from pruning previously installed
 * packages when multiple runtime installs occur.
 */
export async function preflightEnsureRuntimeDeps(
  requirements: PreflightRequirements,
  cwd: string = process.cwd()
): Promise<boolean> {
  if (!isMainThread) return true;

  const missingOfficial: string[] = [];
  const missingOther: string[] = [];
  const registry = loadRuntimeRegistry();

  const isMonorepoContext =
    process.env.DOCMD_TEST === 'true' ||
    process.env.DOCMD_DEV === 'true' ||
    process.env.DOCMD_LOCAL === 'true' ||
    process.cwd().startsWith(__monorepoRoot + path.sep) ||
    process.cwd() === __monorepoRoot;

  const isResolvable = (pkgName: string): boolean => {
    // 1. Check monorepo source during monorepo dev
    if (isMonorepoContext) {
      if (pkgName.startsWith('@docmd/plugin-')) {
        const id = pkgName.replace('@docmd/plugin-', '');
        const local = path.resolve(__monorepoRoot, 'packages/plugins', id, 'dist/index.js');
        if (nativeFs.existsSync(local)) return true;
      } else if (pkgName.startsWith('@docmd/template-')) {
        const id = pkgName.replace('@docmd/template-', '');
        const local = path.resolve(__monorepoRoot, 'packages/templates', id, 'dist/index.js');
        if (nativeFs.existsSync(local)) return true;
      } else if (pkgName.startsWith('@docmd/engine-')) {
        const id = pkgName.replace('@docmd/engine-', '');
        const local = path.resolve(__monorepoRoot, 'packages/engines', id, 'dist/index.js');
        if (nativeFs.existsSync(local)) return true;
      }
    }
    // 2. Check filesystem walk-up
    return findPackageDir(pkgName, [cwd, process.cwd()]) !== null;
  };

  // Check templates
  if (requirements.templates) {
    for (const tpl of requirements.templates) {
      if (!tpl || tpl === 'default') continue;
      const pkg = tpl.startsWith('@docmd/template-') ? tpl : `@docmd/template-${tpl}`;
      if (!isResolvable(pkg)) {
        const short = shortKey(pkg);
        if (short && registry[short]) {
          if (!missingOfficial.includes(pkg)) missingOfficial.push(pkg);
        } else {
          TUI.warn(`Template "${tpl}" not found in official registry`);
        }
      }
    }
  }

  // Check plugins
  if (requirements.plugins) {
    for (const p of requirements.plugins) {
      if (!p) continue;
      const pkg = p.startsWith('@docmd/plugin-') ? p : `@docmd/plugin-${p}`;
      if (!isResolvable(pkg)) {
        const short = shortKey(pkg);
        if (short && registry[short]) {
          if (!missingOfficial.includes(pkg)) missingOfficial.push(pkg);
        } else if (isValidRuntimeDepName(pkg)) {
          TUI.warn(`Plugin "${p}" not found in official registry`);
        }
      }
    }
  }

  // Check engines
  if (requirements.engines) {
    for (const eng of requirements.engines) {
      if (!eng || eng === 'js') continue;
      const pkg = eng.startsWith('@docmd/engine-') ? eng : `@docmd/engine-${eng}`;
      if (!isResolvable(pkg)) {
        const short = shortKey(pkg);
        if (short && registry[short]) {
          if (!missingOfficial.includes(pkg)) missingOfficial.push(pkg);
        } else {
          TUI.warn(`Engine "${eng}" not found in official registry`);
        }
      }
    }
  }

  // Check semantic search
  if (requirements.semanticSearch) {
    const searchInstalled = isResolvable('docmd-search');
    const peersInstalled = isResolvable('@huggingface/transformers') && isResolvable('onnxruntime-node');
    if (!searchInstalled || !peersInstalled) {
      if (!searchInstalled) {
        missingOther.push('docmd-search');
      }
      if (!isResolvable('@huggingface/transformers')) missingOther.push('@huggingface/transformers@^4.2.0');
      if (!isResolvable('onnxruntime-node')) missingOther.push('onnxruntime-node@^1.27.0');
      if (!isResolvable('sharp')) missingOther.push('sharp@^0.35.4');
    }
  }

  if (missingOfficial.length === 0 && missingOther.length === 0) {
    return true;
  }

  // Resolve version for each missing official package
  const toInstall: string[] = [];
  const version = getDocmdVersion();
  for (const pkg of missingOfficial) {
    let resolved = version;
    if (version !== 'latest') {
      const npmLatest = await fetchLatestNpmVersion(pkg);
      if (npmLatest && npmLatest !== version) {
        resolved = npmLatest;
      }
    }
    toInstall.push(resolved === 'latest' ? pkg : `${pkg}@${resolved}`);
  }

  for (const pkg of missingOther) {
    if (pkg === 'docmd-search') {
      const latest = await fetchLatestNpmVersion('docmd-search');
      toInstall.push(latest ? `docmd-search@${latest}` : 'docmd-search');
    } else {
      toInstall.push(pkg);
    }
  }

  const shortNames = toInstall.map(p => {
    const withoutScope = p.startsWith('@') ? p.slice(1).replace(/^[^\/]+\//, '') : p;
    return withoutScope.split('@')[0];
  });
  TUI.step(`Pre-flight: installing runtime dependencies (${shortNames.join(', ')})`, 'WAIT');
  const ok = await installPackages(toInstall, cwd);
  if (ok) {
    TUI.step('Pre-flight: runtime dependencies ready', 'DONE');
  } else {
    TUI.step('Pre-flight: failed to install runtime dependencies', 'FAIL');
  }
  return ok;
}

