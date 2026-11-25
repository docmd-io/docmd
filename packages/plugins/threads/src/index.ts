import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { setup as setupContainers } from './plugin/containers.js';
import { setup as setupHighlightRule } from './plugin/highlight-rule.js';
import { actions } from './plugin/actions.js';
import { checkStartup, startPullLoop, type ExecFile } from './plugin/git-sync.js';
import { assertRuntime, normalizeOptions, type ThreadsOptions } from './plugin/config.js';
import { scriptLiteral } from '@docmd/utils';
import type { PluginDescriptor, ServerHandle } from '@docmd/api';

export const plugin: PluginDescriptor = {
  name: 'threads',
  version: '0.10.2',
  capabilities: ['markdown', 'body', 'assets', 'actions', 'translations', 'server'],
  requiresLiveServer: true
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.resolve(__dirname, '..', 'i18n');

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

export function translations(localeId: string): Record<string, string> {
  return loadPluginStrings(localeId || 'en');
}

export function markdownSetup(md: any, _options?: any): void {
  setupContainers(md);
  setupHighlightRule(md);
}

/**
 * generateScripts runs for every page and slot, so options are normalised once
 * per options value. An invalid value throws its `threads/config` error on the
 * first call only (one log line); later calls with the same value fall back to
 * the defaults so the rest of the pages keep a working client.
 */
const optionsCache = new WeakMap<object, ThreadsOptions>();
let primitiveKey: unknown;
let primitiveValue: ThreadsOptions | undefined;

function remember(options: unknown, value: ThreadsOptions): void {
  if (typeof options === 'object' && options !== null) optionsCache.set(options, value);
  else { primitiveKey = options; primitiveValue = value; }
}

function resolveOptions(options: unknown): ThreadsOptions {
  if (typeof options === 'object' && options !== null) {
    const hit = optionsCache.get(options);
    if (hit) return hit;
  } else if (primitiveValue && primitiveKey === options) {
    return primitiveValue;
  }
  try {
    const result = normalizeOptions(options);
    remember(options, result);
    return result;
  } catch (err) {
    remember(options, normalizeOptions(undefined));
    throw err;
  }
}

export function generateScripts(config: any, options?: any): { headScriptsHtml: string; bodyScriptsHtml: string } {
  // S-7: parse authors.json, never inline the raw file text. scriptLiteral
  // escapes </script, <!--, U+2028, U+2029 so the JSON is safe inside <script>.
  let authors: unknown = {};
  try {
    const srcDir = config.src || 'docs';
    const authorsPath = path.resolve(srcDir, '.threads', 'authors.json');
    if (fs.existsSync(authorsPath)) {
      const parsed = JSON.parse(fs.readFileSync(authorsPath, 'utf8'));
      // Runtime schema is a plain object — coerce arrays/primitives to {}.
      authors = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    }
  } catch (err: any) {
    console.error(`[threads] Failed to parse .threads/authors.json: ${err.message}. Using empty authors.`);
    authors = {};
  }

  const { sidebar, autoPublish, permissions } = resolveOptions(options);
  // Only what the client reads: the resolve rule, never the admin list.
  const clientConfig = { sidebar, autoPublish, permissions: { resolve: permissions.resolve } };
  const i18nStrings = loadPluginStrings(config._activeLocale?.id || 'en');

  return {
    headScriptsHtml: '',
    bodyScriptsHtml: `<script>window.__threads_authors=${scriptLiteral(authors)};window.__threads_config=${scriptLiteral(clientConfig)};window.__threads_i18n=${scriptLiteral(i18nStrings)}</script>`
  };
}

export function getAssets(_options?: any): any[] {
  // Resolve relative to the compiled output location
  const distDir = path.resolve(__dirname, '..', 'dist', 'client');
  return [
    {
      src: path.join(distDir, 'index.js'),
      dest: 'assets/js/threads.js',
      type: 'js',
      location: 'body',
      attributes: { type: 'module' }
    },
    {
      src: path.join(distDir, 'index.css'),
      dest: 'assets/css/threads.css',
      type: 'css',
      location: 'head'
    }
  ];
}

/**
 * Fails the start of `docmd serve` when git sync is on without its push credential or on a checkout
 * holding work the remote branch lacks (see `checkStartup`), then starts the pull loop.
 * Under `docmd dev` the `git` option is ignored: one line says so, nothing else runs.
 */
export async function onServerReady(handle: ServerHandle, deps: { execFile?: ExecFile } = {}): Promise<void> {
  const opts = normalizeOptions(handle.config?.plugins?.threads);
  if (!opts.git) return;
  if (handle.mode === 'dev') {
    console.log('[threads] plugins.threads.git is ignored under docmd dev; git sync runs under docmd serve only');
    return;
  }
  assertRuntime(opts, process.env);
  await checkStartup(handle, deps);
  handle.onShutdown(startPullLoop(handle, undefined, deps));
}

export { actions };