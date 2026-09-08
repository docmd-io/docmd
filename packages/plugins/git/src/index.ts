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
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
import { fileURLToPath } from 'url';

import type { PluginDescriptor, PageContext, Engine } from '@docmd/api';

// ---------------------------------------------------------------------------
// Engine Integration
// ---------------------------------------------------------------------------

let _engine: Engine | null = null;
let _engineLoadAttempted = false;
let _configuredEngine: string = 'rust'; // default: prefer Rust, respected from config

/**
 * Try to load an engine based on config.engine key.
 * Falls back to JS engine, then to execFile if neither is available.
 */
async function getEngine(): Promise<Engine | null> {
  if (_engineLoadAttempted) return _engine;
  _engineLoadAttempted = true;

  try {
    const { loadEngine } = await import('@docmd/api');
    if (_configuredEngine === 'js') {
      _engine = await loadEngine('js');
    } else {
      // Default: try Rust, fall back to JS
      _engine = await loadEngine('rust').catch(() => loadEngine('js'));
    }
    return _engine;
  } catch {
    // No engine available — will use execFile fallback
    return null;
  }
}

/**
 * Get git log for multiple files using the engine (batch operation).
 * Returns a Map from file path to commits array.
 */
async function getGitLogViaEngine(
  filePaths: string[],
  maxCommits: number
): Promise<Map<string, any[]> | null> {
  const engine = await getEngine();
  if (!engine) return null;
  
  try {
    const result = await engine.run<Record<string, any[]>>({
      type: 'git:log',
      payload: { filePaths, maxCommits }
    });
    
    if (!result.success) return null;
    return new Map(Object.entries(result.data || {}));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Original Implementation (fallback when engine is not available)
// ---------------------------------------------------------------------------

const gitRootCache = new Map<string, string | null>();
const gitCache = new Map<string, GitFileInfo>();

// Persistent disk cache for git histories
let _diskCache: Record<string, { mtimeMs: number, info: GitFileInfo }> | null = null;
let _diskCachePath: string | null = null;
let _cacheDirty = false;

// Per-build deduplication: git indexing only needs to run once per full build.
// The in-memory gitCache stores results for all subsequent locale/version passes.
let _gitBuildId = '';
let _gitIndexingDone = false;

/**
 * Resolve the cache directory anchored to the git root (not process.cwd()).
 * This fixes multi-project builds where process.chdir() shifts per-project,
 * which caused the cache to land in unpredictable subdirectories.
 */
let _configuredTmpDir: string | null = null;

/**
 * Resolve the cache directory base path.
 * If config.tmp is configured, stores temporary files inside that specified path.
 * Otherwise, moves them to the device's actual OS temporary folder nested by project hash
 * so multiple documentations on the same device remain perfectly isolated.
 */
function resolveCacheDir(): string {
  if (_configuredTmpDir) {
    return path.join(path.resolve(process.cwd(), _configuredTmpDir), 'cache');
  }

  // Walk up from cwd to find the project git root, ensuring stable path resolution
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Derive a consistent project identifier (remote origin URL -> directory inode -> absolute path)
  // Ensures cache directory resolution remains stable across local folder moves/renames.
  let identifier = dir;
  try {
    const gitConfigPath = path.join(dir, '.git', 'config');
    let urlFound = false;
    if (fs.existsSync(gitConfigPath)) {
      const content = fs.readFileSync(gitConfigPath, 'utf8');
      const match = content.match(/url\s*=\s*([^\r\n]+)/);
      if (match && match[1]) {
        identifier = match[1].trim();
        urlFound = true;
      }
    }
    if (!urlFound) {
      const stat = fs.statSync(dir);
      if (stat && stat.ino) {
        identifier = `ino:${stat.ino}`;
      }
    }
  } catch {
    try {
      const stat = fs.statSync(dir);
      if (stat && stat.ino) identifier = `ino:${stat.ino}`;
    } catch { /* keep absolute path fallback */ }
  }

  // Generate a unique hash for this stable project identifier
  const hash = crypto.createHash('md5').update(identifier).digest('hex').slice(0, 12);
  const baseSlug = path.basename(dir).replace(/[^a-zA-Z0-9-_]/g, '');
  return path.join(os.tmpdir(), `docmd-${baseSlug}-${hash}`, 'cache');
}

function initDiskCache() {
  if (_diskCache !== null) return;
  const cacheDir = resolveCacheDir();
  _diskCachePath = path.join(cacheDir, 'git-history.json');
  try {
    if (fs.existsSync(_diskCachePath)) {
      _diskCache = JSON.parse(fs.readFileSync(_diskCachePath, 'utf8'));
    } else {
      _diskCache = {};
    }
  } catch {
    _diskCache = {};
  }
}

function saveDiskCache() {
  if (!_cacheDirty || !_diskCachePath || !_diskCache) return;
  try {
    // Prune entries for files that no longer exist on disk
    const keys = Object.keys(_diskCache);
    for (const key of keys) {
      try {
        if (!fs.existsSync(key)) delete _diskCache[key];
      } catch { /* ignore stat errors */ }
    }

    const cacheDir = path.dirname(_diskCachePath);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(_diskCachePath, JSON.stringify(_diskCache), 'utf8');
    _cacheDirty = false;
  } catch { /* ignore */ }
}


async function resolveGitRoot(dir: string): Promise<string | null> {
  if (gitRootCache.has(dir)) return gitRootCache.get(dir)!;
  try {
    const realDir = fs.realpathSync(dir);
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: realDir
    });
    const result = stdout.trim();
    gitRootCache.set(dir, result);
    return result;
  } catch {
    gitRootCache.set(dir, null);
    return null;
  }
}

async function getGitFileInfo(filePath: string, maxCommits: number = 6): Promise<GitFileInfo | null> {
  if (gitCache.has(filePath)) return gitCache.get(filePath)!;

  initDiskCache();

  let fileStat;
  try {
    fileStat = fs.statSync(filePath);
  } catch {
    return null;
  }

  // Check disk cache
  if (_diskCache && _diskCache[filePath] && _diskCache[filePath].mtimeMs === fileStat.mtimeMs) {
    const cachedInfo = _diskCache[filePath].info;
    gitCache.set(filePath, cachedInfo);
    return cachedInfo;
  }

  const fileDir = path.dirname(filePath);
  const gitRoot = await resolveGitRoot(fileDir);
  if (!gitRoot) return null;

  const normalizedRoot = fs.realpathSync(gitRoot);
  const normalizedFile = fs.realpathSync(filePath);

  const relPath = path.relative(normalizedRoot, normalizedFile).replace(/\\/g, '/');
  
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) return null;

  try {
    const { stdout } = await execFileAsync('git', [
      'log',
      '--follow',
      '-n', maxCommits.toString(),
      '--format=%H|%h|%an|%ae|%at|%s',
      '--',
      relPath
    ], { 
      cwd: normalizedRoot 
    });

    const logOutput = stdout.trim();
    if (!logOutput) return null;

    const commits: GitCommit[] = logOutput.split('\n').filter(Boolean).map((line: string) => {
      const [hash, shortHash, author, email, timestamp, ...messageParts] = line.split('|');
      const ts = parseInt(timestamp, 10) * 1000;
      const hashEmail = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
      return {
        hash,
        shortHash,
        author,
        email,
        date: new Date(ts).toISOString(),
        timestamp: ts,
        message: messageParts.join('|'),
        avatarUrl: `https://www.gravatar.com/avatar/${hashEmail}?d=mp&s=64`
      };
    });

    if (commits.length === 0) return null;

    const info: GitFileInfo = {
      lastUpdated: commits[0]?.date || '',
      lastUpdatedTimestamp: commits[0]?.timestamp || 0,
      commits
    };

    gitCache.set(filePath, info);
    if (_diskCache) {
      _diskCache[filePath] = { mtimeMs: fileStat.mtimeMs, info };
      _cacheDirty = true;
    }
    return info;
  } catch {
    return null;
  }
}

export const plugin: PluginDescriptor = {
  name: 'git',
  version: '0.9.5',
  capabilities: ['build', 'body', 'assets', 'translations', 'init', 'post-build']
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.resolve(__dirname, '..', 'i18n');

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  timestamp: number;
  message: string;
  avatarUrl: string;
}

export interface GitFileInfo {
  lastUpdated: string;
  lastUpdatedTimestamp: number;
  commits: GitCommit[];
}

/**
 * Format a timestamp for display.
 * Uses relative time for recent updates, absolute for older ones.
 */
function formatLastUpdated(timestamp: number, locale: string = 'en'): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // For very recent updates, show relative time
  if (days < 1) {
    if (hours >= 1) {
      return `${hours}h ago`;
    }
    if (minutes >= 1) {
      return `${minutes}m ago`;
    }
    return 'just now';
  }
  
  if (days < 7) {
    return `${days}d ago`;
  }

  // For older updates, show date
  const date = new Date(timestamp);
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Load translation strings for a given locale.
 */
function loadPluginStrings(localeId: string): Record<string, string> {
  try {
    const localePath = path.join(i18nDir, `${localeId}.json`);
    if (fs.existsSync(localePath)) {
      return JSON.parse(fs.readFileSync(localePath, 'utf8'));
    }
  } catch { /* fallback below */ }
  try {
    const enPath = path.join(i18nDir, 'en.json');
    if (fs.existsSync(enPath)) {
      return JSON.parse(fs.readFileSync(enPath, 'utf8'));
    }
  } catch { /* silent */ }
  return {};
}

/**
 * Plugin translations hook.
 */
export function translations(localeId: string): Record<string, string> {
  return loadPluginStrings(localeId || 'en');
}

let pluginOptions: any = {};

export function onConfigResolved(config: any): void {
  gitCache.clear();
  gitRootCache.clear();
  _gitIndexingDone = false;
  _engineLoadAttempted = false;  // Reset engine state for fresh builds
  _engine = null;
  _diskCache = null;             // Reset disk cache so it re-reads from the correct path
  _diskCachePath = null;
  _cacheDirty = false;
  _configuredEngine = config.engine || 'rust'; // Respect the config.engine key
  _configuredTmpDir = config.tmp || null;      // Respect the config.tmp custom path
  pluginOptions = config.plugins?.git || {};
}

/**
 * onBeforeParse: stub for future use (per-page processing).
 */
export function onBeforeParse(_ctx: any): void {
  // Logic removed (moved to onConfigResolved for better performance)
}

export async function onBeforeBuild(ctx: any): Promise<void> {
  const { pages, tui, options } = ctx;
  if (!pages || pages.length === 0) return;

  // Deduplicate per build: only the FIRST locale/version pass runs git log.
  // Subsequent passes pull from the in-memory gitCache, which is already warm.
  const buildId = (options as any)?._buildId || '';
  if (buildId !== _gitBuildId) {
    _gitBuildId       = buildId;
    _gitIndexingDone  = false;
  }

  const commitHistory = pluginOptions?.commitHistory !== false;
  const maxCommits    = commitHistory ? (pluginOptions?.maxCommits || 5) : 1;
  const showTui       = tui && !options?.quiet && !_gitIndexingDone;

  if (_gitIndexingDone) {
    // Still populate frontmatter from in-memory cache for this locale's pages
    for (const page of pages) {
      if (page?.sourcePath && page.frontmatter) {
        const cached = gitCache.get(page.sourcePath);
        if (cached) {
          if (!commitHistory) cached.commits = [];
          page.frontmatter._git = cached;
        }
      }
    }
    return;
  }

  _gitIndexingDone = true;
  const total      = pages.length;

  if (showTui) tui.step(`Syncing git metadata`, 'WAIT');

  // Collect all source paths that need git info.
  // Pre-warm in-memory cache from disk first so the engine is only called
  // for uncached or modified files (warm builds benefit from persistence).
  const pathsToFetch: string[] = [];
  const pagesByPath = new Map<string, any[]>();

  initDiskCache();
  for (const page of pages) {
    const sourcePath = page?.sourcePath;
    if (sourcePath && page.frontmatter && !gitCache.has(sourcePath)) {
      let fileStat: any;
      try { fileStat = fs.statSync(sourcePath); } catch { /* skip */ }
      // Hit disk cache if file hasn't changed since last build
      if (fileStat && _diskCache && _diskCache[sourcePath] && _diskCache[sourcePath].mtimeMs === fileStat.mtimeMs) {
        gitCache.set(sourcePath, _diskCache[sourcePath].info);
        if (page.frontmatter) page.frontmatter._git = _diskCache[sourcePath].info;
      } else {
        pathsToFetch.push(sourcePath);
        if (!pagesByPath.has(sourcePath)) pagesByPath.set(sourcePath, []);
        pagesByPath.get(sourcePath)!.push(page);
      }
    }
  }

  // Try to use engine for batch processing (much faster with Rust)
  const engineResult = await getGitLogViaEngine(pathsToFetch, maxCommits);

  
  if (engineResult && engineResult.size > 0) {
    // Engine succeeded — process and persist results
    for (const [filePath, commits] of engineResult) {

      if (commits && commits.length > 0) {
        let fileStat: any;
        try { fileStat = fs.statSync(filePath); } catch { /* skip */ }

        const info: GitFileInfo = {
          lastUpdated: new Date(commits[0].timestamp).toISOString(),
          lastUpdatedTimestamp: commits[0].timestamp,
          commits: commits.map((c: any) => {
            const hashEmail = crypto.createHash('md5').update((c.email || '').trim().toLowerCase()).digest('hex');
            return {
              hash: c.hash,
              shortHash: c.shortHash,
              author: c.author,
              email: c.email,
              date: new Date(c.timestamp).toISOString(),
              timestamp: c.timestamp,
              message: c.message,
              avatarUrl: `https://www.gravatar.com/avatar/${hashEmail}?d=mp&s=64`
            };
          })
        };

        if (!commitHistory) info.commits = [];
        gitCache.set(filePath, info);

        // Persist to disk cache so subsequent builds are fast (warm start)
        if (_diskCache && fileStat) {
          _diskCache[filePath] = { mtimeMs: fileStat.mtimeMs, info };
          _cacheDirty = true;
        }

        // Update all pages with this source path
        const pagesForPath = pagesByPath.get(filePath) || [];
        for (const page of pagesForPath) {
          if (page.frontmatter) page.frontmatter._git = info;
        }
      }
    }

    if (showTui) tui.step(`Syncing git metadata`, 'DONE');
  } else {
    // Fallback to original execFile-based implementation
    let processed = 0;
    const CONCURRENCY = 10;
    
    for (let i = 0; i < total; i += CONCURRENCY) {
      const batch = pages.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (page: any) => {
        const sourcePath = page?.sourcePath;
        if (sourcePath && page.frontmatter) {
          const gitInfo = await getGitFileInfo(sourcePath, maxCommits);
          if (gitInfo) {
            if (!commitHistory) gitInfo.commits = [];
            page.frontmatter._git = gitInfo;
          }
        }
      }));
      processed += batch.length;
      if (showTui) tui.step(`Syncing git metadata  ${processed}/${total}`, 'WAIT');
    }

    if (showTui) tui.step(`Syncing git metadata`, 'DONE');
  }
  
  // Also populate pages that were already in cache
  for (const page of pages) {
    if (page?.sourcePath && page.frontmatter && !page.frontmatter._git) {
      const cached = gitCache.get(page.sourcePath);
      if (cached) {
        if (!commitHistory) cached.commits = [];
        page.frontmatter._git = cached;
      }
    }
  }
}

export function onPostBuild(): void {
  saveDiskCache();
}

/**
 * Generate scripts to inject git i18n strings for the client widget.
 */
export function generateScripts(config: any, options?: any): { headScriptsHtml: string; bodyScriptsHtml: string } {
  const gitConfig = {
    repo: options?.repo || config.editLink?.baseUrl || null,
    branch: options?.branch || 'main',
    editLink: options?.editLink !== false && !!(options?.repo || config.editLink?.baseUrl),
    lastUpdated: options?.lastUpdated !== false,
    commitHistory: options?.commitHistory !== false,
    maxCommits: options?.maxCommits || 5,
    dateFormat: options?.dateFormat || 'relative'
  };

  const localeId = config._activeLocale?.id || 'en';
  const i18nStrings = JSON.stringify(loadPluginStrings(localeId));

  return {
    headScriptsHtml: '',
    bodyScriptsHtml: `<script>window.__git_config=${JSON.stringify(gitConfig)};window.__git_i18n=${i18nStrings}</script>`
  };
}

/**
 * Provide client-side assets.
 * Always returns assets - client-side JS handles graceful degradation.
 */
export function getAssets(_options?: any): any[] {
  // Always include assets - client-side JS handles visibility based on git status
  const distDir = path.resolve(__dirname, '..', 'dist', 'client');
  return [
    {
      src: path.join(distDir, 'git-widget.js'),
      dest: 'assets/js/docmd-git.js',
      type: 'js',
      location: 'body'
    },
    {
      src: path.join(distDir, 'git-widget.css'),
      dest: 'assets/css/docmd-git.css',
      type: 'css',
      location: 'head'
    }
  ];
}

export { getGitFileInfo, formatLastUpdated };