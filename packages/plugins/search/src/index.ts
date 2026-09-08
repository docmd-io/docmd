/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import path from 'path';
import fs from 'fs/promises';
import nativeFs from 'fs';
import MiniSearch from 'minisearch';
import MarkdownIt from 'markdown-it';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { PluginDescriptor } from '@docmd/api';
import {
  outputPathToSlug,
  sanitizeUrl,
  installPackages,
  manualResolvePackageEntry
} from '@docmd/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export const plugin: PluginDescriptor = {
  name: 'search',
  version: '0.9.5',
  // `init` lets onConfigResolved run at config-parse time — that's where we
  // compute the single `searchConfig` object. The build pipeline reads
  // it from `config._searchConfig` everywhere else, so there's exactly
  // one source of truth for "is semantic available at build time".
  capabilities: ['post-build', 'init', 'head', 'body', 'assets', 'translations']
};

// Resolve i18n directory (sibling to dist/ in the package)
const i18nDir = path.resolve(__dirname, '..', 'i18n');

/* ── Search config (computed once at onConfigResolved) ─────────────────── */

/**
 * Resolved search configuration. Computed once per build, in
 * `onConfigResolved`, and stamped on `config._searchConfig`. Every
 * subsequent hook (`onPostBuild`, `getAssets`, `generateScripts`,
 * EJS templates via the page context) reads from this same object —
 * no second source of truth, no chance of the `getAssets` and the
 * `generateScripts` paths disagreeing about whether semantic is
 * available. The shape is the contract for the search-modal EJS
 * partial too: every key on this object is exposed to the template
 * via `locals.searchConfig`.
 */
type SearchConfig = {
  /** User has not opted out of search entirely (optionsMenu / config.search). */
  enabled: boolean;
  /** User has explicitly requested semantic search in their config. */
  semanticRequested: boolean;
  /** docmd-search is resolvable in the user's project. */
  docmdSearchInstalled: boolean;
  /** All peer deps (transformers + onnxruntime-node) are resolvable. */
  peersInstalled: boolean;
  /** True only when all three of the above are true — that's when the modal
   *  emits `data-semantic="true"`, the docmd-search-client.js asset ships,
   *  and the page points users at the semantic index. */
  semanticUsable: boolean;
  /** The exact names of any peer deps that are missing. Empty when
   *  `peersInstalled` is true. Useful for the TUI: "Missing: transformers, onnxruntime-node". */
  missingPeers: string[];
  /** Stable list of peer-dep package names. Exposed so the TUI can emit
   *  per-dep `[ DONE ] @huggingface/transformers` lines without
   *  hard-coding the names in two places. */
  peerDeps: readonly string[];
};

/**
 * Module-level state. Reset on every `onConfigResolved` call so a
 * dev-server rebuild starts fresh. Currently tracks:
 *
 *   - `lastPeersHash` — when the set of "missing peer deps" is
 *     identical to the previous build, we DON'T re-emit the
 *     "[ DONE ] Peer X ready" lines. The user only sees them on the
 *     first build (or the first build after a new dep becomes missing).
 *     This is the difference between "informative on first install" and
 *     "spammy on every rebuild".
 */
const _searchState: {
  lastPeersHash: string | null;
  lastConfig: SearchConfig | null;
} = { lastPeersHash: null, lastConfig: null };

/**
 * Compute the full SearchConfig from the resolved config + filesystem.
 * Idempotent — called once at `onConfigResolved` and again inside
 * `onPostBuild` if a fresh install was performed. Pure: no I/O
 * outside of `require.resolve` and `resolveDocmdSearch`.
 */
function buildSearchConfig(config: any): SearchConfig {
  const isEnabled = config.optionsMenu
    ? config.optionsMenu.components.search !== false
    : config.search !== false;
  const pluginOptions = (config.plugins && config.plugins.search) || {};
  const semanticRequested = pluginOptions.semantic === true;
  const docmdSearchInstalled = resolveDocmdSearch() !== null;
  const resolvePaths = [process.cwd(), path.join(process.cwd(), 'node_modules')];

  // List every peer dep and which are missing, in stable order.
  const missingPeers: string[] = [];
  for (const pkg of PEER_DEPS) {
    const atIdx = pkg.lastIndexOf('@');
    const cleanPkgName = atIdx > 0 ? pkg.slice(0, atIdx) : pkg;
    try { require.resolve(cleanPkgName, { paths: resolvePaths }); }
    catch { missingPeers.push(pkg); }
  }
  const peersInstalled = missingPeers.length === 0;
  const semanticUsable = !config.offline && semanticRequested && docmdSearchInstalled && peersInstalled;

  return {
    enabled: isEnabled,
    semanticRequested,
    docmdSearchInstalled,
    peersInstalled,
    semanticUsable,
    missingPeers,
    peerDeps: PEER_DEPS,
  };
}

/** Hash used to decide whether to re-emit the peer-deps TUI block. */
function peersHash(sc: SearchConfig): string {
  return sc.peersInstalled ? 'ok' : 'missing:' + sc.missingPeers.join(',');
}

/* ── Semantic search peer-dep detection ─────────────────────────────────── */

/**
 * Robust package directory resolver that walks up the directory tree
 * recursively (completely bypassing Node's module resolution failure cache).
 */
function manualResolvePackageDir(packageName: string, startDirs: string[]): string | null {
  const dirsToSearch = [...startDirs];
  if (process.env.DOCMD_TEST === 'true' && process.env.DOCMD_TEST_SEARCH_PATH) {
    dirsToSearch.push(...process.env.DOCMD_TEST_SEARCH_PATH.split(path.delimiter));
  }
  for (const startDir of dirsToSearch) {
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

/**
 * Check if docmd-search is available (installed as a peer/optional dep).
 * Returns the importable path (file:// URL) or null if not found.
 */
function resolveDocmdSearch(): string | null {
  // #163 (deeper fix): previously this walked `__dirname` and two parent
  // directories, which let `docmd-search` resolve into the monorepo's
  // own node_modules when the user runs the binary through a pnpm/npm
  // symlink. The plugin then thought the user's project had it installed,
  // silently skipped the peer-dep install, and fell back to keyword
  // search with a misleading message. We now scope resolution to the
  // user's project only — `process.cwd()/node_modules`. The monorepo's
  // own dev workflow goes through the workspace test runner, which has
  // its own module-resolution context.
  const searchPaths = [
    process.cwd(),
    path.join(process.cwd(), 'node_modules')
  ];

  if (process.env.DOCMD_TEST === 'true' && process.env.DOCMD_TEST_SEARCH_PATH) {
    const extraPaths = process.env.DOCMD_TEST_SEARCH_PATH.split(path.delimiter);
    searchPaths.push(...extraPaths);
  }

  // First, locate the package using the cache-bypassing recursive directory walk.
  let pkgDir: string | null = manualResolvePackageDir('docmd-search', [process.cwd(), __dirname]);
  
  if (!pkgDir) {
    try {
      const pkgPath = require.resolve('docmd-search/package.json', { paths: searchPaths });
      pkgDir = path.dirname(pkgPath);
    } catch {
      // Fallback: walk the search paths manually. This is a defensive
      // backstop in case the `./package.json` subpath export is ever
      // removed or the package is installed in a layout require.resolve
      // does not understand (e.g. pnpm's isolated node_modules).
      for (const root of searchPaths) {
        const candidate = path.join(root, 'node_modules', 'docmd-search', 'package.json');
        if (nativeFs.existsSync(candidate)) {
          pkgDir = path.dirname(candidate);
          break;
        }
      }
    }
  }

  if (!pkgDir) return null;

  try {
    // Read package.json to find the main entry point. We accept the
    // first present condition of `exports["."]` in this order: `import`,
    // `default`, `require`, then fall back to `main`. This keeps us
    // working even if the package declares only `import` (ESM-only).
    const pkg = JSON.parse(nativeFs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const exp = pkg.exports?.['.'];
    const mainEntry =
      (exp && (exp.import || exp.default || exp.require)) ||
      pkg.main ||
      'dist/index.js';
    const entryPath = path.join(pkgDir, mainEntry);
    // Return as file:// URL for ESM dynamic import
    return `file://${entryPath}`;
  } catch {
    return null;
  }
}

/**
 * Get the latest non-deprecated version of docmd-search from npm.
 * Falls back to 'latest' tag if fetch fails.
 */
async function getLatestDocmdSearchVersion(): Promise<string> {
  try {
    const { execSync } = await import('node:child_process');
    const result = execSync('npm view docmd-search version --json', { 
      encoding: 'utf-8', 
      timeout: 10000 
    });
    const version = JSON.parse(result.trim());
    return version || 'latest';
  } catch {
    return 'latest';
  }
}

/**
 * docmd-search requires peer dependencies for embedding:
 * - @huggingface/transformers: the ML model runtime
 * - onnxruntime-node: ONNX backend for Node.js
 */
const PEER_DEPS = ['@huggingface/transformers@^4.0.0', 'onnxruntime-node@^1.20.0'];

/**
 * Auto-install docmd-search package along with its peer dependencies.
 * Installs the latest stable version from npm.
 */
async function autoInstallDocmdSearch(tui: any, quiet: boolean): Promise<boolean> {
  const cwd = process.cwd();

  if (!quiet && tui) {
    tui.step('Fetching latest docmd-search version', 'WAIT');
  }

  const version = await getLatestDocmdSearchVersion();
  const versionedPackage = version === 'latest' ? 'docmd-search' : `docmd-search@${version}`;

  if (!quiet && tui) {
    tui.step(`Installing ${versionedPackage} with peer dependencies`, 'WAIT');
  }

  const packages = [versionedPackage, ...PEER_DEPS];
  const success = await installPackages(packages, cwd);

  if (success) {
    if (!quiet && tui) tui.step('docmd-search installed successfully', 'DONE');
    return true;
  } else {
    const manualHint = 'Could not auto-install docmd-search. Please install manually:\n' +
      '  npm install docmd-search @huggingface/transformers onnxruntime-node\n' +
      'Or disable semantic search: plugins: { search: { semantic: false } }';
    if (!quiet && tui) {
      tui.step('Failed to install docmd-search', 'FAIL');
      tui.warn(`  ${manualHint}`);
    } else {
      console.warn(`[plugin-search] ${manualHint}`);
    }
    return false;
  }
}

/**
 * Auto-install just the peer dependencies. Used when docmd-search is
 * already present but `@huggingface/transformers` or `onnxruntime-node`
 * is missing — previously the plugin only warned and fell back to
 * keyword search (#163, partial fix).
 */
async function installPeerDeps(tui: any, quiet: boolean): Promise<boolean> {
  const cwd = process.cwd();

  if (!quiet && tui) {
    tui.step('Installing missing peer dependencies', 'WAIT');
  }

  const success = await installPackages(PEER_DEPS, cwd);

  if (success) {
    if (!quiet && tui) tui.step('Peer dependencies installed', 'DONE');
    return true;
  } else {
    const manualHint = 'Could not auto-install peer dependencies. Please install manually:\n' +
      '  npm install @huggingface/transformers onnxruntime-node\n' +
      'Or disable semantic search: plugins: { search: { semantic: false } }';
    if (!quiet && tui) {
      tui.step('Failed to install peer dependencies', 'FAIL');
      tui.warn(`  ${manualHint}`);
    } else {
      console.warn(`[plugin-search] ${manualHint}`);
    }
    return false;
  }
}

/**
 * Check whether the peer dependencies required for embedding are resolvable.
 * Returns the first missing package name, or null if all present.
 */
function findMissingPeerDep(resolvePaths: string[]): string | null {
  const paths = (process.env.DOCMD_TEST === 'true' && process.env.DOCMD_TEST_SEARCH_PATH)
    ? [
        ...resolvePaths,
        ...process.env.DOCMD_TEST_SEARCH_PATH.split(path.delimiter)
      ]
    : resolvePaths;

  for (const pkg of ['@huggingface/transformers', 'onnxruntime-node']) {
    try {
      require.resolve(pkg, { paths });
      continue;
    } catch {
      // Check next path or fallback resolution
    }

    let found = false;
    for (const startDir of paths) {
      if (manualResolvePackageEntry(pkg, startDir)) {
        found = true;
        break;
      }
    }
    if (!found) return pkg;
  }
  return null;
}

/**
 * Ensure docmd-search is installed when semantic: true is requested.
 * If missing, attempts to auto-install the latest version. If peers are
 * missing but docmd-search itself is present, auto-installs just the
 * peers (#163 partial fix: previously it warned and fell back to keyword
 * search, leaving the project in a broken state).
 *
 * Returns:
 *   { ready: true,  freshInstall: false, reason: 'present' }
 *     — already installed (docmd-search + peers), proceed normally.
 *   { ready: true,  freshInstall: true,  reason: 'docmd-search' | 'peers' }
 *     — just installed; caller must re-exec indexing in a child process
 *       because Node's module cache won't see the new packages.
 *   { ready: false, freshInstall: false, reason: '<reason>' }
 *     — install failed; caller falls back to keyword search and shows the
 *       actual reason (e.g. 'docmd-search' or 'peers') in the message.
 */
async function ensureDocmdSearch(tui: any, quiet: boolean): Promise<{ ready: boolean; freshInstall: boolean; reason: string }> {
  const resolvePaths = [process.cwd(), path.join(process.cwd(), 'node_modules')];

  // Already installed — verify peers too.
  if (resolveDocmdSearch()) {
    const missingPeer = findMissingPeerDep(resolvePaths);
    if (missingPeer) {
      // Auto-install just the peers (was: just warn and give up).
      const installed = await installPeerDeps(tui, quiet);
      if (!installed) return { ready: false, freshInstall: false, reason: 'peers' };
      // Verify peers resolved after install.
      if (findMissingPeerDep(resolvePaths)) {
        if (!quiet && tui) {
          tui.warn('  Peer dependencies were installed but could not be resolved. Please restart the build.');
        }
        return { ready: false, freshInstall: false, reason: 'peers' };
      }
      // docmd-search itself was already installed; the new peers triggered
      // a Node module-cache miss for them too. Re-exec in a child process.
      return { ready: true, freshInstall: true, reason: 'peers' };
    }
    return { ready: true, freshInstall: false, reason: 'present' };
  }

  // Attempt auto-install (installs docmd-search + peers together).
  const installed = await autoInstallDocmdSearch(tui, quiet);
  if (!installed) return { ready: false, freshInstall: false, reason: 'docmd-search' };

  // Verify docmd-search resolved after install.
  const resolved = resolveDocmdSearch();
  if (!resolved) {
    if (!quiet && tui) {
      tui.warn('  docmd-search was installed but could not be resolved. Please restart the build.');
    }
    return { ready: false, freshInstall: false, reason: 'docmd-search' };
  }

  // Signal to the caller that a fresh install just happened. The current Node
  // process has a stale module resolution cache and cannot import the newly
  // installed packages — the caller must spawn a child process for indexing.
  return { ready: true, freshInstall: true, reason: 'docmd-search' };
}

/**
 * Load translation strings for a given locale.
 * Falls back to English if the locale file doesn't exist.
 */
function loadPluginStrings(localeId: string): Record<string, string> {
  try {
    // Try locale-specific file
    const localePath = path.join(i18nDir, `${localeId}.json`);
    if (nativeFs.existsSync(localePath)) {
      return JSON.parse(nativeFs.readFileSync(localePath, 'utf8'));
    }
  } catch { /* fallback below */ }
  // Fallback to English
  try {
    const enPath = path.join(i18nDir, 'en.json');
    if (nativeFs.existsSync(enPath)) {
      return JSON.parse(nativeFs.readFileSync(enPath, 'utf8'));
    }
  } catch { /* silent */ }
  return {};
}

/**
 * Print a per-peer-dep TUI block when `semantic: true` is requested.
 * Idempotent: suppresses the block on subsequent builds when the set
 * of missing peer deps is unchanged, so the user only sees it on the
 * first build (or when a new peer dep goes missing).
 *
 * Called by `onConfigResolved` AND by `onPostBuild` after a fresh
 * install. Each call is a no-op when the peer status is unchanged.
 */
function maybeReportPeerStatus(tui: any, sc: SearchConfig, quiet: boolean): void {
  if (quiet || !tui) return;
  if (!sc.semanticRequested) return;   // user never asked for semantic — stay silent
  const h = peersHash(sc);
  if (h === _searchState.lastPeersHash) return;   // already reported this state
  _searchState.lastPeersHash = h;

  if (sc.peersInstalled) {
    tui.step('All semantic search dependencies ready', 'DONE');
    return;
  }
  // List each missing dep as its own TUI line so the user sees exactly
  // which package is the blocker. We keep the order stable (the same
  // order as `PEER_DEPS`) so logs read consistently across builds.
  for (const dep of sc.peerDeps) {
    const present = !sc.missingPeers.includes(dep);
    tui.step(`${dep}`, present ? 'DONE' : 'SKIP');
  }
  tui.warn(
    '  Semantic search requires: ' + sc.missingPeers.join(', ') +
    '\n  Falling back to keyword search. To enable semantic: install the missing packages,'
  );
}

/**
 * `init` capability. Runs at config-parse time, before any page is
 * rendered. Computes the single `searchConfig` object and stamps it
 * on `config._searchConfig` for the rest of the build pipeline. Also
 * emits the first-install peer-status TUI block if appropriate.
 */
const fallbackTui = {
  step: (msg: string, status?: string) => {
    if (status === 'WAIT') console.log(`[docmd-search]   ${msg}...`);
    else if (status === 'DONE') console.log(`[docmd-search]   ${msg}`);
    else if (status === 'FAIL') console.log(`[docmd-search]   ${msg}`);
    else console.log(`[docmd-search]   ${msg}`);
  },
  warn: (msg: string) => {
    console.warn(`[docmd-search]   ${msg}`);
  }
};

export async function onConfigResolved(config: any): Promise<void> {
  const pluginOptions = (config.plugins && config.plugins.search) || {};
  if (pluginOptions.semantic === true && !config.offline) {
    try {
      await ensureDocmdSearch(fallbackTui, false);
    } catch { /* ignore */ }
  }

  const sc = buildSearchConfig(config);
  config._searchConfig = sc;
  _searchState.lastConfig = sc;
}

/**
 * Plugin translations hook - called by the engine for each locale.
 * Returns search-specific UI strings keyed by locale.
 */
export function translations(localeId: string): Record<string, string> {
  return loadPluginStrings(localeId || 'en');
}

/**
 * Post-build hook - generates per-locale search indexes.
 *
 * When options.semantic is true:
 *   - If options.indexDir is provided and contains a valid manifest.json,
 *     skip indexing entirely — the index was pre-built (e.g. by docmd-search CLI).
 *   - Otherwise, runs the docmd-search indexer over the docs source directory
 *     and outputs the vector index to <outputDir>/_docmd-search/.
 *   - Falls back to keyword-only search if docmd-search is not installed.
 *
 * When options.semantic is false (default):
 *   - Generates per-locale MiniSearch indexes (existing behaviour).
 */

/**
 * Stamp data-semantic="true" on the search modal in every built HTML page.
 *
 * The modal attribute is computed at render time from `searchConfig.semanticUsable`,
 * which checks whether docmd-search is resolvable. On a fresh project where deps
 * install in onPostBuild (after pages are rendered), the flag is stale. This
 * pass corrects it after the semantic index is actually built.
 */
async function stampSemanticFlag(outputDir: string) {
  const htmlFiles = await findHtmlFiles(outputDir);
  const FLAG = 'data-semantic="true"';
  const MODAL_MARKER = 'id="docmd-search-modal"';
  await Promise.all(htmlFiles.map(async (file) => {
    try {
      const src = await fs.readFile(file, 'utf8');
      if (!src.includes(MODAL_MARKER) || src.includes(FLAG)) return;
      // Insert the flag right after the modal id attribute.
      const updated = src.replace(
        /(id="docmd-search-modal"[^>]*?)(\s)/,
        `$1 ${FLAG}$2`
      );
      if (updated !== src) await fs.writeFile(file, updated, 'utf8');
    } catch { /* non-critical: best-effort flag stamping */ }
  }));
}

// Recursively collect all .html files under a directory.
async function findHtmlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_docmd-search' || entry.name === 'node_modules') continue;
      results.push(...await findHtmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

export async function onPostBuild({ config, pages, outputDir, tui, options, runWorkerTask }: any) {
  // Plugin-specific config is in config.plugins.search
  const pluginOptions = (config.plugins && config.plugins.search) || {};
  const isEnabled = config.optionsMenu ? config.optionsMenu.components.search !== false : config.search !== false;
  if (!isEnabled) return;

  if (config.offline) {
    if (tui && !options?.quiet) {
      tui.step('Search index generation disabled (offline build)', 'SKIP');
    }
    return;
  }

  const showTui = tui && !options?.quiet;

  // Tracks whether semantic indexing succeeded so the keyword path below
  // knows to suppress its own TUI messages (it still runs as a fallback).
  let semanticBuilt = false;

  if (pluginOptions.semantic === true) {
    const clientDestPath = path.join(outputDir, '_docmd-search/docmd-search-client.js');
    if (!nativeFs.existsSync(clientDestPath)) {
      try {
        const pkgDir = manualResolvePackageDir('docmd-search', [process.cwd(), __dirname]);
        if (pkgDir) {
          const clientEntry = path.join(pkgDir, 'dist', 'client', 'index.js');
          if (nativeFs.existsSync(clientEntry)) {
            await fs.mkdir(path.dirname(clientDestPath), { recursive: true });
            await fs.copyFile(clientEntry, clientDestPath);
          }
        }
      } catch { /* non-critical */ }
    }

    // Strip sourcemap comment from the copied _docmd-search/docmd-search-client.js to avoid
    // a 404 for the non-existent .js.map file in the browser.
    if (nativeFs.existsSync(clientDestPath)) {
      try {
        const src = await fs.readFile(clientDestPath, 'utf8');
        const stripped = src.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '');
        if (stripped !== src) await fs.writeFile(clientDestPath, stripped, 'utf8');
      } catch { /* non-critical */ }
    }
    // If indexDir is provided and has a valid manifest, skip indexing entirely.
    if (pluginOptions.indexDir) {
      const manifestPath = path.join(pluginOptions.indexDir, 'manifest.json');
      if (nativeFs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(nativeFs.readFileSync(manifestPath, 'utf8'));
          if (manifest.status === 'complete' && manifest.batchCount > 0) {
            if (showTui) tui.step('Using pre-built semantic index', 'DONE');
            // Copy the index to outputDir if it's not already there
            const targetDir = path.join(outputDir, '_docmd-search');
            if (pluginOptions.indexDir !== targetDir) {
              await fs.mkdir(targetDir, { recursive: true });
              // Copy manifest and batches
              await fs.copyFile(manifestPath, path.join(targetDir, 'manifest.json'));
              const batchesDir = path.join(pluginOptions.indexDir, 'batches');
              if (nativeFs.existsSync(batchesDir)) {
                const targetBatchesDir = path.join(targetDir, 'batches');
                await fs.mkdir(targetBatchesDir, { recursive: true });
                for (const file of nativeFs.readdirSync(batchesDir)) {
                  await fs.copyFile(path.join(batchesDir, file), path.join(targetBatchesDir, file));
                }
              }
            }
            return; // Index already exists — no need to build
          }
        } catch {
          // Invalid manifest — fall through to build
        }
      }
    }

    const { ready, freshInstall, reason } = await ensureDocmdSearch(tui, !showTui);
    if (!ready) {
      // Graceful fallback: build keyword index instead. The `reason` field
      // tells the caller whether docmd-search itself or just its peers were
      // missing so the message is accurate (#163 deeper fix: previously it
      // always said "docmd-search not installed" even when only a peer
      // was missing).
      const why =
        reason === 'peers'     ? 'semantic peer dependencies missing' :
        reason === 'docmd-search' ? 'docmd-search not installed' :
                                    'docmd-search not installed';
      // Only now — after the install ACTUALLY failed — report which deps
      // were missing. This avoids the false-alarm where the warning showed
      // "missing" and then the install succeeded below it.
      maybeReportPeerStatus(tui, buildSearchConfig(config), !showTui);
      if (showTui) tui.warn(`  Falling back to keyword search (${why})`);
    } else if (freshInstall) {
      // docmd-search was just installed in this process. Node's module cache
      // won't see it, so spawn a child docmd build to do the indexing instead
      // of trying to import() it here. The child inherits the updated
      // node_modules and starts with a clean require cache.
      if (showTui) tui.step('Re-running semantic indexing in subprocess (first install)...', 'WAIT');
      try {
        const { execSync } = await import('node:child_process');
        const cwd = process.cwd();
        // Detect the docmd binary from the same node_modules that just got updated
        const docmdBin = path.join(cwd, 'node_modules', '.bin', 'docmd');
        // Pass dev context through so the child build applies the same
        // base override (base=/) as the parent dev server. Without this,
        // the subprocess runs a plain `build` which auto-derives the
        // production subpath and the TUI shows the wrong base message.
        const childEnv = { ...process.env };
        if (options?.isDev) childEnv.DOCMD_DEV = 'true';
        const cmd = nativeFs.existsSync(docmdBin)
          ? `"${docmdBin}" build`
          : `node -e "import('docmd-search').then(m => m.indexDirectory({ rootDir: '${cwd}', outDir: '${path.join(outputDir, '_docmd-search')}' }))"`;
        execSync(cmd, { stdio: 'inherit', cwd, timeout: 300000, env: childEnv });
        const manifestPath = path.join(outputDir, '_docmd-search/manifest.json');
        if (nativeFs.existsSync(manifestPath)) {
          if (showTui) tui.step('Semantic search index built', 'DONE');
          await stampSemanticFlag(outputDir);
          semanticBuilt = true;
        } else {
          if (showTui) tui.warn('  Subprocess completed but semantic manifest is missing — falling back to keyword search.');
        }
      } catch (err: any) {
        if (showTui) tui.warn('  Subprocess indexing failed — semantic search unavailable this build.');
      }
    } else {
      if (showTui) tui.step('Building semantic search index', 'WAIT');

      try {
        // Dynamic import of optional peer dep.
        // We first resolve the package path, then import it dynamically.
        // This approach is safe and works with bundlers.
        const docmdSearchPath = resolveDocmdSearch();
        if (!docmdSearchPath) {
          throw new Error(
            'docmd-search not found. Install it with: npm install docmd-search'
          );
        }

        // Import using the resolved path - this is safe and works with bundlers
        const docmdSearch: any = await import(docmdSearchPath);

        if (!docmdSearch?.indexDirectory) {
          throw new Error(
            'docmd-search found but indexDirectory not exported. ' +
            'Please update to the latest version: npm install docmd-search@latest'
          );
        }

        // Determine the docs source directory from config
        const docsDir = path.resolve(config.root || process.cwd(), config.srcDir || config.src || 'docs');
        const semanticOutDir = path.join(outputDir, '_docmd-search');
        const hasVersioning = config.versions?.all?.length > 0;

        if (hasVersioning) {
          // ── Multi-version semantic indexing ──────────────────────────────
          // Index each version's source dir separately into a temp subdir,
          // then merge all batches into one unified index with file paths
          // prefixed by the version's output URL prefix.
          const versions: Array<{ id: string; label: string; dir: string; outputPrefix: string }> = [];
          const currentVersionId = config.versions.current;
          const CWD = config.root || process.cwd();

          for (const v of config.versions.all) {
            const outputPrefix = v.id === currentVersionId ? '' : v.id + '/';
            versions.push({
              id: v.id,
              label: v.label || v.id,
              dir: path.resolve(CWD, v.dir),
              outputPrefix,
            });
          }

          if (showTui) tui.step('Building semantic search index (multi-version)', 'WAIT');

          // Clean output directory before copying to remove stale files from prior builds
          await fs.rm(path.join(semanticOutDir, 'manifest.json'), { force: true }).catch(() => {});
          await fs.rm(path.join(semanticOutDir, 'batches'), { recursive: true, force: true }).catch(() => {});

          const tmpBase = path.join(semanticOutDir, '_tmp_versions');
          await fs.mkdir(tmpBase, { recursive: true });

          let mergedDimensions = 384; // default, overwritten from first batch
          let mergedBatchId = 0;
          const mergedBatchesDir = path.join(semanticOutDir, 'batches');
          await fs.mkdir(mergedBatchesDir, { recursive: true });

          // Track version-to-pathPrefix mapping for the client filter
          const versionMap: Array<{ label: string; pathPrefix: string }> = [];

          // Always exclude semantic index output dir and --ui artifacts from indexing
          const builtinExcludes = ['**/_docmd-search/**', '**/_site/**', '**/_ui/**'];
          const mergedExclude = [...builtinExcludes, ...(pluginOptions.exclude || [])];

          for (const ver of versions) {
            const versionIndexDir = path.join(ver.dir, '_docmd-search');
            try {
              await docmdSearch.indexDirectory(
                {
                  rootDir: ver.dir,
                  outDir: versionIndexDir,
                  model: pluginOptions.model,
                  include: pluginOptions.include,
                  exclude: mergedExclude,
                  chunkSize: pluginOptions.chunkSize,
                  chunkOverlap: pluginOptions.chunkOverlap,
                  keepModelLoaded: true,
                },
                (progress: any) => {
                  if (showTui && progress.message) {
                    tui.step(`Semantic index [${ver.label}]: ${progress.message}`, 'WAIT');
                  }
                }
              );
            } catch (verErr: any) {
              if (showTui) tui.warn(`  Skipping version ${ver.label}: ${verErr.message}`);
              continue;
            }

            // Read all batches from this version's index and re-save with prefixed file paths
            const tmpBatchesDir = path.join(versionIndexDir, 'batches');
            if (nativeFs.existsSync(tmpBatchesDir)) {
              const batchFiles = nativeFs.readdirSync(tmpBatchesDir)
                .filter(f => f.endsWith('.json'))
                .sort();

              for (const batchFile of batchFiles) {
                const batchJson = JSON.parse(await fs.readFile(path.join(tmpBatchesDir, batchFile), 'utf8'));
                const binPath = path.join(tmpBatchesDir, batchFile.replace('.json', '.bin'));

                // Prefix each chunk's file path with the version output prefix
                if (ver.outputPrefix) {
                  batchJson.chunks = batchJson.chunks.map((chunk: any) => ({
                    ...chunk,
                    file: ver.outputPrefix + chunk.file,
                  }));
                }

                mergedDimensions = batchJson.dimensions || mergedDimensions;
                const paddedId = String(mergedBatchId).padStart(3, '0');
                batchJson.batchId = mergedBatchId;

                await fs.writeFile(
                  path.join(mergedBatchesDir, `${paddedId}.json`),
                  JSON.stringify(batchJson)
                );
                if (nativeFs.existsSync(binPath)) {
                  await fs.copyFile(binPath, path.join(mergedBatchesDir, `${paddedId}.bin`));
                }
                mergedBatchId++;
              }
            }

            // Always add this version to the filter map (even if it has no chunks)
            versionMap.push({ label: ver.label, pathPrefix: ver.outputPrefix });
          }

          // Write unified manifest
          const manifest = {
            version: 1,
            model: pluginOptions.model || 'Xenova/all-MiniLM-L6-v2',
            dimensions: mergedDimensions,
            status: 'complete',
            batchCount: mergedBatchId,
          };
          await fs.writeFile(path.join(semanticOutDir, 'manifest.json'), JSON.stringify(manifest));

          // Write versions.json for the client filter UI
          await fs.writeFile(
            path.join(semanticOutDir, 'versions.json'),
            JSON.stringify(versionMap)
          );

          // Clean up temp dirs
          try { await fs.rm(tmpBase, { recursive: true, force: true }); } catch { /* ok */ }

          if (showTui) tui.step('Building semantic search index (multi-version)', 'DONE');
          // Pages were rendered before deps installed; stamp the flag now.
          await stampSemanticFlag(outputDir);
          return;
        }

        // ── Single-version semantic indexing ─────────────────────────────
        // Always exclude the semantic index output directory itself and any
        // docmd-search --ui artifacts (_site/, _ui/) so the indexer never
        // crawls its own output. Merge with any user-supplied excludes.
        const builtinExcludes = ['**/_docmd-search/**', '**/_site/**', '**/_ui/**'];
        const mergedExclude = [
          ...builtinExcludes,
          ...(pluginOptions.exclude || []),
        ];
        const sourceIndexDir = path.join(docsDir, '_docmd-search');
        await docmdSearch.indexDirectory(
          {
            rootDir: docsDir,
            outDir: sourceIndexDir,
            model: pluginOptions.model,           // undefined → uses global/default
            include: pluginOptions.include,
            exclude: mergedExclude,
            chunkSize: pluginOptions.chunkSize,
            chunkOverlap: pluginOptions.chunkOverlap,
            keepModelLoaded: true,
          },
          (progress: any) => {
            if (showTui && progress.message) {
              // Update TUI step message on each phase change
              tui.step(`Semantic index: ${progress.message}`, 'WAIT');
            }
          }
        );

        // Clean output directory before copying to remove stale files from prior builds
        // Only delete manifest.json and batches directory to preserve docmd-search-client.js
        await fs.rm(path.join(semanticOutDir, 'manifest.json'), { force: true }).catch(() => {});
        await fs.rm(path.join(semanticOutDir, 'batches'), { recursive: true, force: true }).catch(() => {});
        // Copy built index from source directory to output directory
        await fs.mkdir(semanticOutDir, { recursive: true });
        await fs.cp(sourceIndexDir, semanticOutDir, { recursive: true, force: true });

        // No versioning — write an empty versions.json so the client knows
        await fs.writeFile(path.join(semanticOutDir, 'versions.json'), '[]');

        if (showTui) tui.step('Building semantic search index', 'DONE');
        // Pages were rendered before deps installed; stamp the flag now.
        await stampSemanticFlag(outputDir);
        // Semantic index built — fall through to also generate the keyword
        // index as a fallback. The client may need it if the build-time
        // data-semantic flag wasn't set on the modal (e.g. deps installed
        // in onPostBuild after pages were already rendered without the flag).
        // The keyword index is tiny and doubles as a runtime safety net.
        semanticBuilt = true;
      } catch (err: any) {
        if (showTui) {
          tui.step('Building semantic search index', 'FAIL');
          tui.warn(`Semantic indexing failed: ${err.message} — falling back to keyword search`);
        } else {
          console.warn(`[plugin-search] Semantic indexing failed: ${err.message}`);
        }
        // Fall through to keyword search
      }
    } // close else (not freshInstall)
  }

  // ── Keyword search path (default / fallback) ────────────────────────────
  // Always runs, even after a successful semantic build, so the client has
  // a keyword index to fall back on if data-semantic wasn't set at render time.
  if (showTui && !semanticBuilt) tui.step('Generating search index', 'WAIT');

  // Try to offload to worker thread for better main-thread responsiveness
  if (runWorkerTask) {
    try {
      // Only send serializable page data the worker needs
      const serializablePages = pages
        .filter((p: any) => p.searchData)
        .map((p: any) => ({ outputPath: p.outputPath, searchData: p.searchData }));

      // Build a minimal serializable config for the worker
      const workerConfig = {
        i18n: config.i18n ? { locales: config.i18n.locales, default: config.i18n.default } : undefined,
        versions: config.versions ? { all: config.versions.all, current: config.versions.current } : undefined,
      };

      const workerModulePath = path.resolve(__dirname, 'worker.js');
      await runWorkerTask(workerModulePath, 'buildSearchIndex', [workerConfig, serializablePages, outputDir]);

      if (showTui && !semanticBuilt) tui.step('Generating search index', 'DONE');
      return;
    } catch {
      // Worker failed — fall through to main-thread processing
    }
  }

  // Main-thread fallback (or when WorkerPool isn't available)
  await buildSearchIndexInline(config, pages, outputDir);

  if (showTui && !semanticBuilt) tui.step('Generating search index', 'DONE');
}

/**
 * Inline (main-thread) search index builder — used as fallback when
 * worker offloading is not available or fails.
 */
async function buildSearchIndexInline(config: any, pages: any[], outputDir: string) {
  const locales = config.i18n?.locales || [];
  const defaultLocale = config.i18n?.default || null;
  const hasVersioning = config.versions?.all?.length > 0;
  const currentVersionId = config.versions?.current;

  // Group pages by locale
  const localePages: Record<string, any[]> = { '_default': [] };
  for (const loc of locales) {
    if (loc.id !== defaultLocale) {
      localePages[loc.id] = [];
    }
  }

  for (const page of pages) {
    if (!page.searchData) continue;
    const outputPath = page.outputPath.replace(/\\/g, '/');

    let localeId = '_default';
    for (const loc of locales) {
      if (loc.id !== defaultLocale && outputPath.startsWith(loc.id + '/')) {
        localeId = loc.id;
        break;
      }
    }
    localePages[localeId] = localePages[localeId] || [];
    localePages[localeId].push(page);
  }

  for (const [localeId, locPages] of Object.entries(localePages)) {
    if (locPages.length === 0) continue;

    const searchData: any[] = [];
    const seenIds = new Set();

    for (const page of locPages) {
      let pageId = outputPathToSlug(page.outputPath);
      if (pageId.startsWith('/') && pageId !== '/') {
        pageId = pageId.slice(1);
      }

      let version: string | null = null;
      if (hasVersioning && config.versions?.all) {
        for (const v of config.versions.all) {
          const stripped = localeId !== '_default' ? pageId.replace(new RegExp(`^${localeId}/`), '') : pageId;
          if (stripped.startsWith(v.id + '/') || stripped === v.id) {
            version = v.label || v.id;
            break;
          }
        }
        if (!version) {
          const currentVersion = config.versions.all.find((v: any) => v.id === currentVersionId);
          if (currentVersion) version = currentVersion.label || currentVersion.id;
        }
      }

      if (!seenIds.has(pageId)) {
        seenIds.add(pageId);
        const entry: any = {
          id: pageId,
          title: page.searchData.title,
          text: page.searchData.content,
          headings: (page.searchData.headings || []).map((h: any) => h.text).join(' ')
        };
        if (hasVersioning && version) entry.version = version;
        searchData.push(entry);
      }

      if (page.searchData.headings && Array.isArray(page.searchData.headings)) {
        for (const heading of page.searchData.headings) {
          if (heading.id && heading.text) {
            const hId = `${pageId}#${heading.id}`;
            if (!seenIds.has(hId)) {
              seenIds.add(hId);
              const entry: any = {
                id: hId,
                title: `${page.searchData.title} > ${heading.text}`,
                text: '',
                headings: heading.text
              };
              if (hasVersioning && version) entry.version = version;
              searchData.push(entry);
            }
          }
        }
      }
    }

    const storeFields = ['title', 'id', 'text'];
    if (hasVersioning) storeFields.push('version');

    const CJK_AND_SPACELESS_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff\u1000-\u109f\u0f00-\u0fff]/g;
    const miniSearch = new MiniSearch({
      fields: ['title', 'headings', 'text'],
      storeFields,
      tokenize: (text: string) => {
        const spaced = text.replace(CJK_AND_SPACELESS_REGEX, ' $& ');
        const defaultTokenize = MiniSearch.getDefault('tokenize');
        return defaultTokenize ? defaultTokenize(spaced) : spaced.toLowerCase().split(/[^a-zA-Z0-9_'\u00C0-\u017F\u00d0\u00f0\u00df\u00f8\u00e6\u0153\u03ac-\u03ce\u0400-\u04ff]+/u).filter(Boolean);
      },
      searchOptions: { boost: { title: 2, headings: 1.5 }, fuzzy: 0.2 }
    });

    miniSearch.addAll(searchData);
    const json = JSON.stringify(miniSearch.toJSON());

    // Keyword index lives under _docmd-search/ alongside any semantic index,
    // keeping all search data in one place and the output root clean.
    // Default locale: _docmd-search/search-index.json
    // Non-default:    _docmd-search/<locale>/search-index.json
    const searchDir = path.join(outputDir, '_docmd-search');
    const indexPath = localeId === '_default'
      ? path.join(searchDir, 'search-index.json')
      : path.join(searchDir, localeId, 'search-index.json');

    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(indexPath, json);
  }
}

/**
 * Inject the search modal HTML.
 *
 * When options.semantic is true:
 *   - Adds a data-semantic="true" attribute to the modal so the semantic
 *     client JS knows to use the vector index instead of MiniSearch.
 *   - The modal HTML is identical — only the client JS bundle changes.
 *
 * Strings are passed as data attributes so the client JS can read them
 * regardless of locale - the engine merges plugin translations before render.
 */
export function generateScripts(config: any, options: any) {
  const isEnabled = config.optionsMenu ? config.optionsMenu.components.search !== false : config.search !== false;
  if (!isEnabled) return {};

  // Use the resolved searchConfig as the single source of truth.
  // The client also auto-detects at runtime (HEAD probe to manifest.json)
  // so even if this build-time hint is wrong (e.g. first-build dep install),
  // the browser still picks the right mode.
  const sc: SearchConfig = config._searchConfig || buildSearchConfig(config);
  const isSemantic = sc.semanticUsable;
  const showConfidence = (options || {}).showConfidence === true;
  const showFilters = (options || {}).showFilters !== false;

  // Load strings for the active locale (available at render time)
  const localeId = config._activeLocale?.id || 'en';
  const strings = loadPluginStrings(localeId);

  const searchIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide-icon icon-search"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>`;
  const closeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide-icon icon-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;

  const escape = new MarkdownIt().utils.escapeHtml;

  const semanticAttr = isSemantic ? ' data-semantic="true"' : '';
  const confidenceAttr = ` data-show-confidence="${showConfidence}"`;
  const filtersAttr = ` data-show-filters="${showFilters}"`;
  const offlineBuildAttr = config.offline ? ' data-offline-build="true"' : '';

  const modalHtml = `
  <!-- Search Modal (Injected by @docmd/plugin-search) -->
  <div id="docmd-search-modal" class="docmd-search-modal" style="display: none;"${semanticAttr}${confidenceAttr}${filtersAttr}${offlineBuildAttr}
       data-search-placeholder="${escape(strings.searchPlaceholder || 'Search documentation...')}"
       data-search-no-results="${escape(strings.searchNoResults || 'No results found.')}"
       data-search-error="${escape(strings.searchError || 'Failed to load search index.')}"
       data-search-offline="${escape(strings.searchOffline || 'Search requires a web server. Open this site via http://localhost instead of file:// to enable search.')}"
       data-search-offline-build="${escape(strings.searchOfflineBuild || 'Search is disabled because these docs were built with the --offline flag. Rebuild the site without the flag to enable search.')}"
       data-search-initial="${escape(strings.searchInitial || 'Type to start searching...')}"
       data-search-navigate="${escape(strings.searchNavigate || 'to navigate')}"
       data-search-escape="${escape(strings.searchEscape || 'to close')}">
      <div class="docmd-search-box">
          <div class="docmd-search-header">
              ${searchIcon}
              <input type="text" id="docmd-search-input" placeholder="${escape(strings.searchPlaceholder || 'Search documentation...')}" autocomplete="off" spellcheck="false">
              <button onclick="window.closeDocmdSearch()" class="docmd-search-close" aria-label="${escape(strings.searchClose || 'Close search')}">
                  ${closeIcon}
              </button>
          </div>
          <div id="docmd-search-results" class="docmd-search-results"></div>
          <div class="docmd-search-footer">
              <span><kbd class="docmd-kbd">↑</kbd> <kbd class="docmd-kbd">↓</kbd> ${strings.searchNavigate || 'to navigate'}</span>
              <span><kbd class="docmd-kbd">ESC</kbd> ${strings.searchEscape || 'to close'}</span>
          </div>
      </div>
  </div>`;

  return { bodyScriptsHtml: modalHtml };
}

export function getAssets(options: any) {
  // Use searchConfig for semanticRequested, but keep the broader
  // resolution paths for finding the client bundle (which lives in
  // the plugin's own node_modules, not just the user's project).
  const sc = _searchState.lastConfig;
  const semanticRequested = sc?.semanticRequested ?? (options || {}).semantic === true;
  const isSemantic = semanticRequested;

  // Resolve the MiniSearch UMD bundle at build time instead of loading it
  // from a CDN at runtime. Copying it locally (assets/js/vendor/) makes
  // keyword search work in air-gapped, offline, and CDN-blocked
  // environments, and removes an external runtime dependency.
  //
  // The installed version is read dynamically from the resolved package
  // directory, so the CDN fallback URL (used only if local resolution
  // fails) stays in sync with whatever `minisearch` version the user has
  // installed — no hardcoded version to maintain.
  //
  // minisearch's `exports` map exposes only `.` and `./SearchableMap`, so
  // `require.resolve('minisearch/package.json')` is blocked. We resolve the
  // package's main entry instead (`dist/umd/index.js` — the browser UMD
  // build the client expects as a global `MiniSearch`) and derive the
  // package dir from it.
  let miniSearchAsset: any;
  try {
    const msEntry = require.resolve('minisearch');
    const msPkgDir = path.resolve(path.dirname(msEntry), '..', '..'); // dist/umd/index.js → package root
    const msUmd = path.join(msPkgDir, 'dist', 'umd', 'index.js');
    if (nativeFs.existsSync(msUmd)) {
      miniSearchAsset = { src: msUmd, dest: 'assets/js/vendor/minisearch.js', type: 'js', location: 'body' };
    }
  } catch { /* minisearch not resolvable */ }
  if (!miniSearchAsset) {
    // CDN fallback — version read at build time from the installed copy so
    // it never goes stale. If minisearch itself is unresolvable (truly
    // broken install) the user has bigger problems than a stale version.
    let msVer = '7.2.0';
    try {
      const msEntry = require.resolve('minisearch');
      const msPkgDir = path.resolve(path.dirname(msEntry), '..', '..');
      msVer = JSON.parse(nativeFs.readFileSync(path.join(msPkgDir, 'package.json'), 'utf8')).version || msVer;
    } catch { /* keep default */ }
    miniSearchAsset = { url: `https://cdn.jsdelivr.net/npm/minisearch@${msVer}/dist/umd/index.min.js`, type: 'js', location: 'body' };
  }

  if (isSemantic) {
    // Semantic mode: serve the docmd-search client bundle at a known path
    // so the search client can dynamically import it at runtime.
    // Resolve the actual file path (not a file:// URL) from docmd-search package.
    let semanticClientSrc: string | null = null;
    try {
      const pkgDir = manualResolvePackageDir('docmd-search', [process.cwd(), __dirname]);
      if (pkgDir) {
        const clientEntry = path.join(pkgDir, 'dist', 'client', 'index.js');
        if (nativeFs.existsSync(clientEntry)) semanticClientSrc = clientEntry;
      }
    } catch { /* not installed */ }

    const assets: any[] = [
      // Always include MiniSearch + keyword client as fallback
      miniSearchAsset,
      { src: path.join(__dirname, 'docmd-search.js'), dest: 'assets/js/docmd-search.js', type: 'js', location: 'body' },
    ];

    if (semanticClientSrc) {
      // Serve the docmd-search client at a well-known path
      // The search client.ts fetches it via import('_docmd-search/docmd-search-client.js')
      assets.push({
        src: semanticClientSrc,
        dest: '_docmd-search/docmd-search-client.js',
        type: 'js',
        location: 'none', // not injected into <head>/<body> — loaded on demand
      });
    }

    return assets;
  }

  // Default: keyword search via MiniSearch
  return [
    miniSearchAsset,
    { src: path.join(__dirname, 'docmd-search.js'), dest: 'assets/js/docmd-search.js', type: 'js', location: 'body' }
  ];
}