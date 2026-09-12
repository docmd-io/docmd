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
 * Plugin loader with validation, isolation, and capability enforcement.
 *
 * - Lightweight contract check at load time.
 * - Every hook invocation wrapped in try/catch.
 * - Plugins can only register for hooks they've declared.
 */

import { TUI } from '@docmd/tui';
import path from 'node:path';
import nativeFs from 'node:fs';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safePath, asUserPath } from '@docmd/utils';
import type { PluginDescriptor, PluginHooks, PluginModule, Capability, TemplateHook, TemplateAssetHook } from './types.js';
import {
  loadRuntimeRegistry,
  installRuntimeDep,
  tryLoadAfterInstall,
  shortKey,
} from './runtime-deps.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Monorepo root - two levels up from packages/api/dist/
const __monorepoRoot = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Capability → Hook mapping (§3)
// ---------------------------------------------------------------------------

const CAPABILITY_HOOKS: Record<Capability, string[]> = {
  markdown:     ['markdownSetup'],
  head:         ['generateMetaTags', 'generateScripts'],
  body:         ['generateScripts'],
  assets:       ['getAssets'],
  'post-build': ['onPostBuild'],
  actions:      ['actions'],
  events:       ['events'],
  translations: ['translations'],
  init:         ['onConfigResolved'],
  build:        ['onBeforeParse', 'onAfterParse', 'onBeforeBuild', 'onBeforeRender', 'onPageReady'],
  dev:          ['onDevServerReady'],
  template:     ['templates', 'templateAssets'],
};

const KNOWN_CAPABILITIES = new Set(Object.keys(CAPABILITY_HOOKS));

// ---------------------------------------------------------------------------
// Hook registry
// ---------------------------------------------------------------------------

export const hooks: PluginHooks = {
  markdownSetup: [],
  injectHead: [],
  injectBody: [],
  onPostBuild: [],
  assets: [],
  translations: [],
  actions: {},
  events: {},
  onConfigResolved: [],
  onDevServerReady: [],
  onBeforeParse: [],
  onAfterParse: [],
  onBeforeBuild: [],
  onBeforeRender: [],
  onPageReady: [],
  templates: [],
  templateAssets: [],
};

// ---------------------------------------------------------------------------
// Validation (§1)
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateDescriptor(descriptor: any): ValidationResult {
  const errors: string[] = [];

  if (!descriptor || typeof descriptor !== 'object') {
    return { valid: false, errors: ['Missing plugin descriptor'] };
  }

  if (!descriptor.name || typeof descriptor.name !== 'string') {
    errors.push('`name` must be a non-empty string');
  }

  if (!descriptor.version || typeof descriptor.version !== 'string') {
    errors.push('`version` must be a valid semver string');
  }

  if (!Array.isArray(descriptor.capabilities)) {
    errors.push('`capabilities` must be an array');
  } else {
    for (const cap of descriptor.capabilities) {
      if (!KNOWN_CAPABILITIES.has(cap)) {
        errors.push(`Unknown capability: "${cap}"`);
      }
    }
  }

  if (descriptor.requiresLiveServer !== undefined && typeof descriptor.requiresLiveServer !== 'boolean') {
    errors.push('`requiresLiveServer` must be a boolean');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a plugin has declared a capability that allows a specific hook.
 */
function hasCapabilityForHook(descriptor: PluginDescriptor | null, hookName: string): boolean {
  if (!descriptor) return true; // Legacy plugins without descriptors get full access
  for (const cap of descriptor.capabilities) {
    if (CAPABILITY_HOOKS[cap]?.includes(hookName)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Isolation wrapper (§2)
// ---------------------------------------------------------------------------

async function safeCall<T>(hookName: string, pluginName: string, fn: (...args: any[]) => T, ...args: any[]): Promise<T | string | undefined> {
  try {
    const result = fn(...args);
    // Plugins are allowed to return Promises (most `async` functions do).
    // We must await them before downstream code inspects the shape,
    // otherwise the dispatcher sees a Promise object (typeof 'object')
    // and silently drops the value through the wrong branch of
    // coerceStringPluginReturn / coerceGenerateScriptsReturn. This is a
    // longstanding bug — string-return hooks used to "work" only when
    // the plugin happened to be synchronous.
    if (result && typeof result === 'object' && typeof (result as any).then === 'function') {
      return await result;
    }
    return result;
  } catch (err: any) {
    TUI.error(`Plugin "${pluginName}" threw in ${hookName}`, err.message);
    return (hookName === 'injectHead' || hookName === 'injectBody') ? '' as any : undefined;
  }
}

// One-shot warning set so we don't spam the TUI on every page build when a
// plugin has a wrong return type. The key is the plugin name + the hook
// name; the message is logged at most once per build per plugin/hook pair.
const _pluginReturnTypeWarnings = new Set<string>();

function warnPluginReturnTypeOnce(pluginName: string, hookName: string, message: string): void {
  const key = `${pluginName}::${hookName}`;
  if (_pluginReturnTypeWarnings.has(key)) return;
  _pluginReturnTypeWarnings.has(key);
  _pluginReturnTypeWarnings.add(key);
  TUI.warn(`  Plugin "${pluginName}" ${message}`);
}

// D-S4: enforce that the returned value from a string-return hook is
// actually a string. Reject objects (previously rendered as
// "[object Object]"), booleans, numbers, etc. Null/undefined/empty-string
// pass through as `''` so the surrounding `|| ''` collapses cleanly.
function coerceStringPluginReturn(value: any, hookName: string, pluginName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  warnPluginReturnTypeOnce(
    pluginName,
    hookName,
    `returned a non-string value (${typeof value}); expected a string. Skipping.`
  );
  return null;
}

// D-S5: accept either a plain string (treated as the `target` slot, body
// stays empty) or the canonical `{ headScriptsHtml, bodyScriptsHtml }`
// object. Strings are silently dropped on the body side per the original
// contract; this just makes the head side honour the same convention.
function coerceGenerateScriptsReturn(value: any, target: 'head' | 'body', pluginName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    // D-S5: a string return is treated as head-only. Body targets get
    // empty. This restores the head path that used to silently drop
    // strings via `result?.bodyScriptsHtml` and never wrote them either.
    return target === 'head' ? value : '';
  }
  if (typeof value === 'object') {
    const key = target === 'head' ? 'headScriptsHtml' : 'bodyScriptsHtml';
    const v = value[key];
    return typeof v === 'string' ? v : null;
  }
  warnPluginReturnTypeOnce(
    pluginName,
    'generateScripts',
    `returned a non-object, non-string value (${typeof value}); expected a string or { headScriptsHtml, bodyScriptsHtml }. Skipping.`
  );
  return null;
}

// D-M1: enforce that translations are a plain string-to-string map.
// The previous behaviour silently spread a string return into the
// translations object (`{ '0': 'c', '1': 'h', ... }`) which produced
// garbage keys at runtime.
function coerceTranslationsReturn(value: any, localeId: string, pluginName: string): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnPluginReturnTypeOnce(
      pluginName,
      'translations',
      `returned a non-object value for locale "${localeId}" (${typeof value}); expected Record<string, string>. Skipping.`
    );
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

const pluginErrors: { plugin: string; hook: string; message: string; filePath?: string }[] = [];

// separate tracker for load-time plugin failures (the
// "unknown plugin" case from test-report §F6). RUNTIME hook errors go in
// `pluginErrors`; LOAD failures (could not resolve / import) go here.
// The build / dev commands check this via `getPluginLoadErrors()` and
// exit 1 if any are present, so a missing plugin is a hard build failure
// rather than a silent warning.
const pluginLoadErrors: { plugin: string; message: string }[] = [];

export function getPluginErrors() {
  return pluginErrors;
}

export function getPluginLoadErrors() {
  return pluginLoadErrors;
}

/**
 * Canonical list of plugins that ship with @docmd/core. These are
 * auto-loaded on every build unless the user opts out via
 * `plugins.<name>: false` (or `enabled: false`) in their config.
 *
 * This is the single source of truth for the "core plugin set" across
 * the monorepo. Other packages (the installer, the docs site, etc.)
 * must import this constant rather than re-declaring the list —
 * re-declaring causes silent drift when a plugin is added/removed here.
 *
 * Adding a plugin: append the key to this array AND make sure the
 * plugin's @docmd/plugin-* package is listed as a workspace dep in
 * packages/core/package.json so it ships with @docmd/core on npm.
 */
export const CORE_PLUGINS: ReadonlyArray<string> = [
  'search', 'seo', 'sitemap', 'analytics', 'llms',
  'mermaid', 'git', 'openapi', 'okf', 'ai'
] as const;

/** True if `name` is one of the plugins that ship with @docmd/core. */
export function isCorePlugin(name: string): boolean {
  return (CORE_PLUGINS as ReadonlyArray<string>).includes(name);
}

// Track which plugin warnings have already been printed to avoid repeating them on
// every dev-server rebuild. Keyed by `pluginName:warningType`.
const _printedWarnings = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (_printedWarnings.has(key)) return;
  _printedWarnings.add(key);
  TUI.warn(message);
}

// ---------------------------------------------------------------------------
// Shorthand resolution
// ---------------------------------------------------------------------------

export function resolvePluginName(key: string): string {
  if (key.includes('/')) return key;

  const registry = loadRuntimeRegistry();
  if (registry[key]) {
    return `@docmd/plugin-${key}`;
  }

  const corePlugins = CORE_PLUGINS;
  if (corePlugins.includes(key)) {
    return `@docmd/plugin-${key}`;
  }

  return key;
}

/**
 * Resolve a template reference (from `config.theme.template` or frontmatter
 * `template:`) to its full npm package name. Mirrors `resolvePluginName`
 * but targets the `@docmd/template-*` scope.
 *
 * Accepts:
 *   - `summer`                  → `@docmd/template-summer`
 *   - `template-summer`         → `@docmd/template-summer`
 *   - `@docmd/template-summer`  → `@docmd/template-summer` (unchanged)
 *   - `@scope/template-summer`  → `@scope/template-summer` (unchanged)
 *   - `./relative/path`        → unchanged
 */
export function resolveTemplateName(key: string): string {
  if (!key) return key;
  if (key.includes('/') || key.startsWith('.')) return key;
  if (key.startsWith('template-')) return `@docmd/${key}`;
  return `@docmd/template-${key}`;
}

// ---------------------------------------------------------------------------
// Auto-Install for Official Plugins
// ---------------------------------------------------------------------------
//
// The registry loader, package-manager detector, version pinner, and
// `spawn`-based installer live in `./runtime-deps.ts`. We import them
// here and wrap `installRuntimeDep` with the project's warn-once
// deduper so a dev-server rebuild can't flood the TUI.

// ---------------------------------------------------------------------------
// Load & Register
// ---------------------------------------------------------------------------

export async function loadPlugins(config: any, opts?: { resolvePaths?: string[]; isDev?: boolean }): Promise<PluginHooks> {
  const isDev = Boolean(opts?.isDev ?? config?._isDev ?? (process.env.DOCMD_DEV === 'true'));

  // The monorepo dev fallback (loading plugins/templates from
  // packages/plugins or packages/templates in the monorepo source)
  // should ONLY fire when the process is running from inside the
  // monorepo itself. When an external project runs the monorepo's
  // dist binary (e.g. docs/ running `node ../docmd/packages/core/
  // dist/bin/docmd.js dev`), the monorepo root is resolvable but the
  // external project's node_modules is the right place to look.
  // Without this gate, a template like @docmd/template-summer is found
  // in the monorepo source, loaded directly, and auto-install never
  // fires — so the package never lands in the user's package.json or
  // node_modules. (Search plugin already scopes itself to
  // process.cwd()/node_modules; this applies the same principle to
  // the generic plugin/template loader.)
  const isMonorepoContext =
    process.env.DOCMD_TEST === 'true' ||
    process.cwd().startsWith(__monorepoRoot + path.sep) ||
    process.cwd() === __monorepoRoot;

  // 1. Resolution paths for plugin imports.
  //
  // When running INSIDE the monorepo (dev/test), we include __dirname
  // and the monorepo package dirs so workspace packages resolve during
  // development.
  //
  // When running OUTSIDE the monorepo (an external consumer project like
  // docs/ running `dev:local`), we deliberately EXCLUDE __dirname. Why:
  // __dirname inside the monorepo binary points to docmd/packages/api/dist/,
  // and Node walks up from there to docmd/node_modules/ where EVERY workspace
  // package is symlinked. That means template-summer, math, pwa — packages
  // the consumer never installed — resolve silently from the monorepo. The
  // consumer never sees the auto-install path fire, the package never lands
  // in their package.json, and CI/production breaks. Restricting to
  // process.cwd() means core plugins (deps of @docmd/core) resolve from the
  // consumer's own node_modules, and optional plugins trigger auto-install.
  const resolvePaths = isMonorepoContext
    ? [
        process.cwd(),
        __dirname,
        __monorepoRoot,
        path.join(__monorepoRoot, 'packages/plugins'),
        path.join(__monorepoRoot, 'packages/templates'),
        ...(opts?.resolvePaths || []),
      ]
    : [
        process.cwd(),
        path.join(process.cwd(), 'node_modules'),
        ...(opts?.resolvePaths || []),
      ];

  // 1. Reset hooks
  hooks.markdownSetup = [];
  hooks.injectHead = [];
  hooks.injectBody = [];
  hooks.onPostBuild = [];
  hooks.assets = [];
  hooks.translations = [];
  hooks.actions = {};
  hooks.events = {};
  hooks.onConfigResolved = [];
  hooks.onDevServerReady = [];
  hooks.onBeforeParse = [];
  hooks.onAfterParse = [];
  hooks.onBeforeBuild = [];
  hooks.onBeforeRender = [];
  hooks.onPageReady = [];
  hooks.templates = [];
  hooks.templateAssets = [];
  pluginErrors.length = 0;
  pluginLoadErrors.length = 0;

  // 2. Initialize Plugin Map (Name -> Options)
  const pluginMap = new Map<string, any>();
  const searchEnabled = config.optionsMenu ? config.optionsMenu.components.search !== false : config.search !== false;

  // A. Core Plugins - always loaded by default.
  // 0.8.8: added `okf` (Open Knowledge Format bundles for AI agents).
  // `okf` follows the same pattern as `llms` — auto-loaded, opt-out via
  // `plugins.okf = false` in the user's config.
  const corePlugins = CORE_PLUGINS;

  for (const name of corePlugins) {
    const resolved = `@docmd/plugin-${name}`;
    const userOpts = config.plugins?.[name];

    if (userOpts === false || (userOpts && userOpts.enabled === false)) {
      pluginMap.set(resolved, false);
      continue;
    }

    if (name === 'search' && !searchEnabled) {
      pluginMap.set(resolved, false);
      continue;
    }

    pluginMap.set(resolved, userOpts || {});
  }

  // B. Add/Override from Config (non-core / optional / third-party plugins)
  if (config.plugins) {
    Object.keys(config.plugins).forEach(key => {
      const resolvedName = resolvePluginName(key);
      if (corePlugins.includes(key)) return;
      pluginMap.set(resolvedName, config.plugins[key]);
    });
  }

  // B'. Auto-include the active template (new in 0.8.7)
  // If `config.theme.template` is set, make sure the corresponding
  // `@docmd/template-*` package is in the plugin map. The user does not
  // need to also list it in `config.plugins`. Explicit user entries win.
  if (config.theme && config.theme.template) {
    const tplName = String(config.theme.template).trim();
    if (tplName) {
      const resolvedTemplate = resolveTemplateName(tplName);
      // Only add if not already present (user might have set explicit options).
      if (!pluginMap.has(resolvedTemplate)) {
        pluginMap.set(resolvedTemplate, {});
      }
    }
  }

  // 3. Load and Register (with auto-install for official plugins)
  for (const [name, options] of pluginMap) {
    if (options === false) continue;

    try {
      let rawModule: any;
      let needsAutoInstall = false;
      const isLocalPath = name.startsWith('./') || name.startsWith('../') || name.startsWith('/');
      
      try {
        let loadedFromMonorepo = false;

        // 1. Monorepo Priority: if it's an official plugin OR template, try local
        // monorepo source first. This prevents older versions installed in project
        // node_modules from taking precedence during monorepo development.
        // Gated on isMonorepoContext so external projects running the monorepo
        // binary (e.g. via `node ../docmd/.../docmd.js`) don't accidentally load
        // from the monorepo source and bypass auto-install.
        const isCoreOrMonorepo = isMonorepoContext || (name.startsWith('@docmd/plugin-') && isCorePlugin(name.replace('@docmd/plugin-', '')));
        if (isCoreOrMonorepo && name.startsWith('@docmd/plugin-')) {
          const id = name.replace('@docmd/plugin-', '');
          const localPath = path.resolve(__monorepoRoot, 'packages/plugins', id, 'dist/index.js');
          if (nativeFs.existsSync(localPath)) {
            rawModule = await import(pathToFileURL(localPath).href);
            loadedFromMonorepo = true;
          }
        } else if (isMonorepoContext && name.startsWith('@docmd/template-')) {
          // Templates live under packages/templates/<name>/ in the monorepo.
          const id = name.replace('@docmd/template-', '');
          const localPath = path.resolve(__monorepoRoot, 'packages/templates', id, 'dist/index.js');
          if (nativeFs.existsSync(localPath)) {
            rawModule = await import(pathToFileURL(localPath).href);
            loadedFromMonorepo = true;
          }
        }

        // 2. Standard NPM Resolution: if not found locally, use Node's resolution
        if (!loadedFromMonorepo) {
          let resolvedPath: string;
          if (isLocalPath) {
            // Phase 1.A: CWE-22/CWE-94 fix (T-S8). Local-path plugins must resolve
            // inside the project root. Without this, require.resolve(name, { paths })
            // can search parent directories and load arbitrary plugins.
            const projectRoot = path.resolve(process.cwd());
            try {
              resolvedPath = safePath(projectRoot, asUserPath(name));
            } catch (_e: any) {
              throw new Error(`Local plugin path "${name}" escapes project root`);
            }
            // Resolve directory imports to the package's main field (or index.js).
            // Node ESM does not support bare directory imports.
            try {
              const stat = nativeFs.statSync(resolvedPath);
              if (stat.isDirectory()) {
                const pkgPath = path.join(resolvedPath, 'package.json');
                if (nativeFs.existsSync(pkgPath)) {
                  const pkg = JSON.parse(nativeFs.readFileSync(pkgPath, 'utf8'));
                  const main = (pkg.main || 'index.js').replace(/^\.\//, '');
                  resolvedPath = path.join(resolvedPath, main);
                } else if (nativeFs.existsSync(path.join(resolvedPath, 'index.js'))) {
                  resolvedPath = path.join(resolvedPath, 'index.js');
                }
              }
            } catch (_e: any) {
              throw new Error(`Local plugin directory "${name}" has no resolvable entry point: ${_e.message}`);
            }
          } else {
            resolvedPath = require.resolve(name, { paths: resolvePaths });
          }
          rawModule = await import(pathToFileURL(resolvedPath).href);
        }
      } catch (_e: any) {
        if (name.startsWith('@docmd/plugin-') || name.startsWith('@docmd/template-')) {
          needsAutoInstall = true;
        } else if (isLocalPath) {
          // Phase 1.A: a local-path plugin that fails safePath or import must
          // be reported with the original safety error, not swallowed into the
          // generic "Failed to resolve" fallback.
          throw _e;
        } else {
          // Fallback for non-package plugins or when resolution fails
          try {
            rawModule = await import(name);
          } catch (innerError: any) {
            throw new Error(`Failed to resolve ${name}. Search paths: ${resolvePaths.join(', ')}. Detail: ${innerError.message}`);
          }
        }
      }

      // Auto-install official plugins AND templates that are missing
      const isOfficial = name.startsWith('@docmd/plugin-') || name.startsWith('@docmd/template-');
      if (needsAutoInstall && isOfficial) {
        const installed = await installRuntimeDep(name);
        if (installed) {
          // Defense in depth: re-verify the package is in the official registry
          // before loading. installRuntimeDep already passed this check, but we
          // re-check here so a future change to that function cannot silently
          // turn the auto-install path into a generic npm-loader.
          const shortNameLocal = shortKey(name);
          const registry = loadRuntimeRegistry();
          if (!shortNameLocal || !registry[shortNameLocal]) {
            warnOnce(`registry:${name}`, TUI.yellow(`Plugin "${shortNameLocal ?? name}" not in official registry`));
            continue;
          }
          // Retry loading after install, scoped to the consumer's
          // node_modules (not the monorepo's, which is what bare
          // `import(name)` would walk into).
          const reloaded = await tryLoadAfterInstall(name, process.cwd());
          if (!reloaded) {
            warnOnce(
              `autoinstall:${name}`,
              TUI.yellow(`Could not load ${name} after auto-install`),
            );
            continue;
          }
          rawModule = reloaded;
        } else {
          // Fallback: if auto-install failed (e.g. pre-release version not yet published on npm),
          // check if the package is available in the local monorepo
          const shortName = name.replace(/^@docmd\/(plugin|template)-/, '');
          const localPluginDir = path.join(__monorepoRoot, 'packages/plugins', shortName);
          const localTemplateDir = path.join(__monorepoRoot, 'packages/templates', shortName);
          const fallbackDir = nativeFs.existsSync(localPluginDir) ? localPluginDir : (nativeFs.existsSync(localTemplateDir) ? localTemplateDir : null);
          if (fallbackDir) {
            const entryPath = path.join(fallbackDir, 'dist/index.js');
            if (nativeFs.existsSync(entryPath)) {
              try {
                rawModule = await import(pathToFileURL(entryPath).href);
              } catch {
                continue;
              }
            } else {
              continue;
            }
          } else {
            continue; // Skip if auto-install failed
          }
        }
      }

      if (!rawModule) continue;

      const pluginModule: PluginModule = rawModule.default || rawModule;

      // Stage 4: pull the manifest's declared capabilities (from the
      // registry) so registerPlugin can cross-check the JS descriptor.
      const shortNameForManifest = shortKey(name) ?? name;
      const manifestCapabilities = (loadRuntimeRegistry()[shortNameForManifest]?.capabilities) as string[] | undefined;

      try {
        registerPlugin(name, pluginModule, options, manifestCapabilities, isDev);
      } catch (regError: any) {
        warnOnce(`register:${name}`, TUI.yellow(`Plugin loaded but failed to register: ${name}`) + TUI.dim(`\n   > ${regError.message}`));
      }
    } catch (e: any) {
      warnOnce(`load:${name}`, TUI.yellow(`Could not load plugin: ${name} (missing or misconfigured)`) + TUI.dim(`\n   > ${e.message}`));
      // track load failures so the build can fail
      // loudly instead of silently completing with a missing plugin.
      pluginLoadErrors.push({ plugin: name, message: e.message });
    }
  }

  // 4. Print error summary if any
  if (pluginErrors.length > 0) {
    TUI.warn(`${pluginErrors.length} plugin error(s) occurred (build completed)`);
  }

  return hooks;
}

/**
 * Cached per-key capability sets, derived from the registry once and
 * reused on every dev-server rebuild. Avoids re-walking the registry
 * (and the re-`Set` construction) on every hot reload.
 */
const _capabilityCache: Map<string, Set<string>> = new Map();

/** Get or build a capability Set for a registry key. */
function getCapabilitySet(shortName: string): Set<string> {
  let set = _capabilityCache.get(shortName);
  if (set) return set;
  const entry = loadRuntimeRegistry()[shortName];
  set = new Set<string>(Array.isArray(entry?.capabilities) ? entry.capabilities : []);
  _capabilityCache.set(shortName, set);
  return set;
}

/**
 * Cross-check the JS descriptor's `capabilities` against the manifest's
 * `docmd.capabilities` (from the generated registry). Catches:
 *   - Descriptor declares a capability the manifest doesn't (drift).
 *   - Manifest declares a capability the descriptor doesn't (drift).
 *   - Implemented hook without declared capability (the silent-drop bug).
 *
 * Not a hard error — capabilities are advisory metadata. But loud
 * warnings surface drift before it causes a build regression.
 */
function checkManifestCapabilityDrift(
  shortName: string,
  descriptor: PluginDescriptor | null,
  plugin: PluginModule,
): string[] {
  const warnings: string[] = [];
  const manifestCaps = Array.from(getCapabilitySet(shortName));
  if (manifestCaps.length === 0) return warnings; // Third-party or unknown package; skip.
  if (!descriptor) return warnings;               // Legacy; skip.

  const descCaps = new Set<string>(Array.isArray(descriptor.capabilities) ? (descriptor.capabilities as string[]) : []);

  // Implemented hooks vs declared capabilities.
  const KNOWN_HOOKS_BY_CAP: Array<[string, keyof PluginModule]> = [
    ['markdown', 'markdownSetup'],
    ['head', 'generateMetaTags'],
    ['body', 'generateScripts'],
    ['post-build', 'onPostBuild'],
    ['assets', 'getAssets'],
    ['actions', 'actions'],
    ['events', 'events'],
    ['translations', 'translations'],
  ];
  for (const [cap, hook] of KNOWN_HOOKS_BY_CAP) {
    if (typeof plugin[hook] === 'function' && !descCaps.has(cap) && !manifestCaps.includes(cap)) {
      warnings.push(
        `exports \`${hook}\` but neither the descriptor nor the manifest ` +
        `declares the "${cap}" capability. The hook will be registered.`
      );
    }
  }
  return warnings;
}

function registerPlugin(
  name: string,
  plugin: PluginModule,
  options: any,
  manifestCapabilities?: string[],   // Stage 4: from registry entry, for cross-check
  isDev = false,
) {
  const shortName = name.replace(/^@docmd\/plugin-/, '').replace(/^@docmd\/template-/, '');
  const isOfficial = name.startsWith('@docmd/plugin-') || name.startsWith('@docmd/template-');

  // --- §1: Validate descriptor ---
  const descriptor = plugin.plugin || null;

  // --- Live Server Requirement Check ---
  const manifestEntry = loadRuntimeRegistry()[shortKey(name) ?? shortName];
  const requiresLive = descriptor?.requiresLiveServer === true || manifestEntry?.requiresLiveServer === true;
  const isDevOnly = requiresLive && options?.devOnly !== false && options?.liveOnly !== false;
  const skipClientAssets = !isDev && isDevOnly;

  if (skipClientAssets) {
    warnOnce(`liveserver:${name}`, TUI.dim(`[${shortName}] requires live dev server — omitting client assets from static build`));
  }

  if (descriptor) {
    const { valid, errors } = validateDescriptor(descriptor);
    if (!valid) {
      const msg = `Plugin "${name}" descriptor failed validation: ${errors.join(', ')}`;
      if (isOfficial) {
        throw new Error(msg); // Hard error for official plugins
      }
      TUI.warn(`${msg} - registering anyway`);
    }
  } else {
    // No descriptor - emit deprecation warning (soft until 0.8.0)
    // Silent for official plugins as they'll be updated together
    if (!isOfficial) {
      TUI.warn(`Plugin "${name}" has no descriptor. This will be required in 0.8.0.`);
    }
  }

  // --- §1.5: Manifest / descriptor capability drift (Stage 4) ---
  if (manifestCapabilities) {
    const drift = checkManifestCapabilityDrift(shortName, descriptor, plugin);
    for (const w of drift) {
      TUI.warn(`Plugin "${shortName}": ${w}`);
    }
  }

  // --- §3: Capability-gated registration ---
  const shouldExecute = (pageContext: any) => {
    if (!pageContext || !pageContext.frontmatter) return true;
    const fmPlugins = pageContext.frontmatter.plugins || {};

    if (fmPlugins[shortName] === false) return false;
    if (fmPlugins[shortName] === true) return true;

    if (pageContext.frontmatter.noStyle) {
      if (options && options.noStyle !== undefined) return options.noStyle;
      if (plugin.noStyle !== undefined) return plugin.noStyle;
      return true;
    }

    return true;
  };

  // markdownSetup
  if (typeof plugin.markdownSetup === 'function') {
    if (hasCapabilityForHook(descriptor, 'markdownSetup')) {
      const fn = plugin.markdownSetup;
      hooks.markdownSetup.push((md: any) => safeCall('markdownSetup', name, fn, md, options));
    } else {
      TUI.warn(`Plugin "${shortName}" exports markdownSetup but didn't declare "markdown" capability - skipped`);
    }
  }

  // generateMetaTags → injectHead
  if (!skipClientAssets && typeof plugin.generateMetaTags === 'function') {
    if (hasCapabilityForHook(descriptor, 'generateMetaTags')) {
      const fn = plugin.generateMetaTags;
      hooks.injectHead.push(async (config: any, pageContext: any, root: any) => {
        if (!shouldExecute(pageContext)) return '';
        const raw = await safeCall('generateMetaTags', name, fn, config, pageContext, root);
        // D-S4: the contract is `string`. Object returns used to be
        // stringified to "[object Object]" and injected into every page's
        // <head>. We now reject the wrong shape, warn, and skip — same
        // behaviour we use for missing/null returns.
        return coerceStringPluginReturn(raw, 'generateMetaTags', name) || '';
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports generateMetaTags but didn't declare "head" capability - skipped`);
    }
  }

  // generateScripts → injectHead + injectBody
  if (!skipClientAssets && typeof plugin.generateScripts === 'function') {
    if (hasCapabilityForHook(descriptor, 'generateScripts')) {
      const fn = plugin.generateScripts;
      // D-H3: pass a `target` arg so plugins can render different content
      // for head vs body without computing both. The arg is optional —
      // existing plugins that only know `(config, options)` still work.
      // D-S5: plain string returns are now treated as the head slot;
      // body gets an empty string. Previously a string return was dropped
      // on the body side (result?.bodyScriptsHtml was undefined), making
      // the body capability effectively dead for the simple shape.
      hooks.injectHead.push(async (config: any, pageContext: any, root: any) => {
        if (!shouldExecute(pageContext)) return '';
        const raw = await safeCall('generateScripts', name, fn, config, options, 'head', root) as any;
        return coerceGenerateScriptsReturn(raw, 'head', name) || '';
      });
      hooks.injectBody.push(async (config: any, pageContext: any, root: any) => {
        if (!shouldExecute(pageContext)) return '';
        const raw = await safeCall('generateScripts', name, fn, config, options, 'body', root) as any;
        return coerceGenerateScriptsReturn(raw, 'body', name) || '';
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports generateScripts but didn't declare "head"/"body" capability - skipped`);
    }
  }

  // onPostBuild
  if (typeof plugin.onPostBuild === 'function') {
    if (hasCapabilityForHook(descriptor, 'onPostBuild')) {
      const fn = plugin.onPostBuild;
      const wrapper = async (ctx: any) => {
        try {
          await fn(ctx);
        } catch (err: any) {
          TUI.error(`Plugin "${name}" threw in onPostBuild`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onPostBuild', message: err.message });
        }
      };
      // Tag with the plugin's own declared name (e.g. 'search', 'sitemap')
      // so build.ts can split hooks into indexing vs publishing phases.
      (wrapper as any)._pluginName = descriptor?.name || shortName;
      hooks.onPostBuild.push(wrapper);
    } else {
      TUI.warn(`Plugin "${shortName}" exports onPostBuild but didn't declare "post-build" capability - skipped`);
    }
  }

  // getAssets
  if (!skipClientAssets && typeof plugin.getAssets === 'function') {
    if (hasCapabilityForHook(descriptor, 'getAssets')) {
      const fn = plugin.getAssets;
      hooks.assets.push(async () => (await safeCall('getAssets', name, fn, options)) as any[] || []);
    } else {
      TUI.warn(`Plugin "${shortName}" exports getAssets but didn't declare "assets" capability - skipped`);
    }
  }

  // templates (new in 0.8.7)
  // A plugin can ship a `templates: TemplateHook[]` array listing the EJS
  // files it overrides. The resolver in @docmd/ui merges these with the
  // default templates, falling back to the default for any slot the plugin
  // does not provide. The plugin descriptor MUST declare the `template`
  // capability for the entries to register.
  if (Array.isArray((plugin as any).templates)) {
    if (hasCapabilityForHook(descriptor, 'templates')) {
      for (const tpl of (plugin as any).templates as TemplateHook[]) {
        if (!tpl || !tpl.type || !tpl.templatePath) {
          TUI.warn(`Plugin "${shortName}" provides a malformed templates[] entry (needs { type, templatePath }) - skipped`);
          continue;
        }
        // Attach plugin name for diagnostics & resolution.
        (tpl as any)._pluginName = descriptor?.name || shortName;
        hooks.templates.push(tpl);
      }
    } else {
      TUI.warn(`Plugin "${shortName}" exports templates but didn't declare "template" capability - skipped`);
    }
  }

  // templateAssets (new in 0.8.7)
  // CSS/JS bundles shipped by a template. Loaded at priority 10 by default
  // so user customCss (priority 15) still wins.
  if (Array.isArray((plugin as any).templateAssets)) {
    if (hasCapabilityForHook(descriptor, 'templateAssets')) {
      for (const asset of (plugin as any).templateAssets as TemplateAssetHook[]) {
        if (!asset || !asset.type || !asset.path) {
          TUI.warn(`Plugin "${shortName}" provides a malformed templateAssets[] entry (needs { type, path }) - skipped`);
          continue;
        }
        // Normalise: never mutate the caller's object.
        hooks.templateAssets.push({
          type: asset.type,
          path: asset.path,
          priority: asset.priority !== undefined ? asset.priority : 10,
          position: asset.position,
          _pluginName: descriptor?.name || shortName,
        } as TemplateAssetHook);
      }
    } else {
      TUI.warn(`Plugin "${shortName}" exports templateAssets but didn't declare "template" capability - skipped`);
    }
  }

  // translations
  if (typeof plugin.translations === 'function') {
    if (hasCapabilityForHook(descriptor, 'translations')) {
      const fn = plugin.translations;
      hooks.translations.push(async (localeId: string) => {
        // D-M1 + async-await fix: the callback is async because plugins
        // are allowed to return Promises. `safeCall` itself awaits
        // before returning, so `raw` is always a settled value here.
        const raw = await safeCall('translations', name, fn, localeId, options);
        return coerceTranslationsReturn(raw, localeId, name);
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports translations but didn't declare "translations" capability - skipped`);
    }
  }

  // actions (WebSocket RPC)
  if (plugin.actions && typeof plugin.actions === 'object') {
    if (hasCapabilityForHook(descriptor, 'actions')) {
      Object.assign(hooks.actions, plugin.actions);
    } else {
      TUI.warn(`Plugin "${shortName}" exports actions but didn't declare "actions" capability - skipped`);
    }
  }

  // events (fire-and-forget)
  if (plugin.events && typeof plugin.events === 'object') {
    if (hasCapabilityForHook(descriptor, 'events')) {
      Object.assign(hooks.events, plugin.events);
    } else {
      TUI.warn(`Plugin "${shortName}" exports events but didn't declare "events" capability - skipped`);
    }
  }

  // --- Expanded Lifecycle Hooks ---

  // onConfigResolved
  if (typeof plugin.onConfigResolved === 'function') {
    if (hasCapabilityForHook(descriptor, 'onConfigResolved')) {
      const fn = plugin.onConfigResolved;
      hooks.onConfigResolved.push(async (config: any) => {
        try {
          await fn(config);
        } catch (err: any) {
          TUI.error(`Plugin "${name}" threw in onConfigResolved`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onConfigResolved', message: err.message });
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onConfigResolved but didn't declare "init" capability - skipped`);
    }
  }

  // onDevServerReady
  if (typeof plugin.onDevServerReady === 'function') {
    if (hasCapabilityForHook(descriptor, 'onDevServerReady')) {
      const fn = plugin.onDevServerReady;
      hooks.onDevServerReady.push(async (server: any, wss: any) => {
        try {
          await fn(server, wss);
        } catch (err: any) {
          TUI.error(`Plugin "${name}" threw in onDevServerReady`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onDevServerReady', message: err.message });
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onDevServerReady but didn't declare "dev" capability - skipped`);
    }
  }

  // onBeforeParse
  if (typeof plugin.onBeforeParse === 'function') {
    if (hasCapabilityForHook(descriptor, 'onBeforeParse')) {
      const fn = plugin.onBeforeParse;
      hooks.onBeforeParse.push(async (src: string, frontmatter: any, filePath?: string) => {
        try {
          return await fn(src, frontmatter, filePath) ?? src;
        } catch (err: any) {
          const loc = filePath ? ` in ${filePath}` : '';
          TUI.error(`Plugin "${name}" threw in onBeforeParse${loc}`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onBeforeParse', message: err.message, filePath });
          return src;
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onBeforeParse but didn't declare "build" capability - skipped`);
    }
  }

  // onAfterParse
  if (typeof plugin.onAfterParse === 'function') {
    if (hasCapabilityForHook(descriptor, 'onAfterParse')) {
      const fn = plugin.onAfterParse;
      hooks.onAfterParse.push(async (html: string, frontmatter: any, filePath?: string) => {
        try {
          return await fn(html, frontmatter, filePath) ?? html;
        } catch (err: any) {
          const loc = filePath ? ` in ${filePath}` : '';
          TUI.error(`Plugin "${name}" threw in onAfterParse${loc}`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onAfterParse', message: err.message, filePath });
          return html;
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onAfterParse but didn't declare "build" capability - skipped`);
    }
  }

  // onBeforeBuild
  if (typeof (plugin as any).onBeforeBuild === 'function') {
    if (hasCapabilityForHook(descriptor, 'onBeforeBuild')) {
      const fn = (plugin as any).onBeforeBuild;
      hooks.onBeforeBuild.push(async (ctx: any) => {
        try {
          await fn(ctx);
        } catch (err: any) {
          TUI.error(`Plugin "${name}" threw in onBeforeBuild`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onBeforeBuild', message: err.message });
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onBeforeBuild but didn't declare "build" capability - skipped`);
    }
  }

  // onBeforeRender
  if (typeof (plugin as any).onBeforeRender === 'function') {
    if (hasCapabilityForHook(descriptor, 'onBeforeRender')) {
      const fn = (plugin as any).onBeforeRender;
      hooks.onBeforeRender.push(async (page: any) => {
        try {
          await fn(page);
        } catch (err: any) {
          TUI.error(`Plugin "${name}" threw in onBeforeRender`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onBeforeRender', message: err.message });
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onBeforeRender but didn't declare "build" capability - skipped`);
    }
  }

  // onPageReady
  if (typeof plugin.onPageReady === 'function') {
    if (hasCapabilityForHook(descriptor, 'onPageReady')) {
      const fn = plugin.onPageReady;
      hooks.onPageReady.push(async (page: any) => {
        try {
          await fn(page);
        } catch (err: any) {
          TUI.error(`Plugin "${name}" threw in onPageReady`, err.message);
          pluginErrors.push({ plugin: name, hook: 'onPageReady', message: err.message });
        }
      });
    } else {
      TUI.warn(`Plugin "${shortName}" exports onPageReady but didn't declare "build" capability - skipped`);
    }
  }
}