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
import { fileURLToPath } from 'url';
import nativeFs from 'fs';
import { fsUtils as fs, WorkerPool } from '@docmd/utils';
import { loadConfig } from '../utils/config-loader.js';
import { TUI, loadPlugins, getPluginLoadErrors } from '@docmd/api';
import { flushNormaliserWarnings, setNormaliserVerbose } from '@docmd/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { prepareAssets, prepareTemplateAssets } from '../engine/assets.js';
import { buildLocales, generateLocaleRedirect, preCountPages } from '../engine/i18n.js';
import { NOT_FOUND_DEFAULTS } from '../utils/config-schema.js';

// Core package version — threaded through to renderPages for the
// <meta name="generator"> tag so it stays in sync with @docmd/core.
const _pkgUrl = new URL('../../package.json', import.meta.url);
const pkg = JSON.parse(nativeFs.readFileSync(_pkgUrl, 'utf8')) as { version: string };

export async function buildSite(configPath: string, opts: any = {}) {

  // Defaults to prevent ReferenceErrors
  const options = {
    isDev: opts.isDev || false,
    offline: opts.offline || false,
    quiet: opts.quiet || false,
    showStats: opts.showStats || false,   // Show version/locale stats even when quiet
    onProgress: opts.onProgress || null,  // External progress callback
    targetFiles: opts.targetFiles || null, // Optional: only rebuild specific files
    verbose: opts.verbose === true || process.env.DOCMD_VERBOSE === 'true',
    // D-H1: honour an explicit `cwd` override. Previously the build always
    // used `process.cwd()`, so calling `buildSite('/abs/path/config.json')`
    // from a different cwd would still look for `docs/` and `site/` next
    // to the caller's cwd. The fix honours `opts.cwd` when supplied, and
    // otherwise defaults to `path.dirname(configPath)` so the build
    // naturally follows the config file's location.
    cwd: opts.cwd || path.dirname(configPath) || process.cwd()
  };

  // Per-warning normaliser logging is opt-in via --verbose / DOCMD_VERBOSE
  // so dev-server output stays quiet while CI / verbose builds get the
  // full breakdown of every container-normaliser issue.
  if (options.verbose) setNormaliserVerbose(true);

  const CWD = options.cwd;

  // ── Multi-Project (Workspace) Detection ──────────────────────────
  // If we're NOT already inside a workspace build (no env var set),
  // check if the root config has workspace settings.
  //
  // Phase 3 PR 3.C (F8): this block is wrapped in a try/catch so that
  // workspace validation errors (duplicate prefix, missing source
  // directory, no root project) are surfaced via `TUI.error` and exit
  // 1, rather than bubbling up as a raw JS stack trace with exit 0
  // (the `buildWorkspace` call itself throws plain `Error` objects
  // that nothing else catches).
  if (!process.env.DOCMD_PROJECT_OUT) {
    try {
      const { detectWorkspace, buildWorkspace } = await import('../engine/workspace.js');
      const workspaceConfig = await detectWorkspace(configPath);
      if (workspaceConfig) {
        await buildWorkspace(workspaceConfig, options);
        return;
      }
    } catch (wsErr: any) {
      if (!options.isDev && !options.quiet) {
        TUI.error('Workspace validation failed', wsErr.message || String(wsErr));
        if (process.env.npm_lifecycle_event === 'test' || process.env.CI) {
          console.error(wsErr.stack);
        }
        process.exit(1);
      }
      throw wsErr;
    }
  }

  // Start build timer
  const elapsed = TUI.timer();

  // 1. Load Config (Zero-Config aware)
  try {
    const config = await loadConfig(configPath, { isDev: options.isDev, _globalDefaults: opts._globalDefaults, cwd: options.cwd });
    config._workspace = opts._workspace || null;
    config._activePrefix = opts._activePrefix || '/';
    config._globalDefaults = opts._globalDefaults || null;
    config.offline = options.offline || false;
    
    // Initialize global WorkerPool (or use provided one)
    const workerScript = path.resolve(__dirname, '../engine/worker-parser.js');
    const workerConfig = { ...config };
    delete workerConfig._workerPool;
    const workerPool = opts.workerPool || new WorkerPool(workerScript, { config: workerConfig, cwd: process.cwd() });
    config._workerPool = workerPool;

    const hooks = await loadPlugins(config, { resolvePaths: [__dirname], isDev: options.isDev });

    // Phase 3 PR 3.A (F6): a plugin the user listed in `config.plugins` but
    // which failed to load is a build failure, not a warning. Without this
    // check, `docmd build` exits 0 even when a plugin is missing — the
    // site still builds but the user has no way to know a plugin was
    // dropped unless they read the warning text.
    // N-12: list each failed plugin by name and reason in the TUI, so
    // the operator doesn't have to dig through the error message string.
    const loadErrors = getPluginLoadErrors();
    if (loadErrors.length > 0) {
      if (!options.isDev && !options.quiet) {
        TUI.error(`${loadErrors.length} plugin(s) could not be loaded`, '');
        for (const e of loadErrors) {
          console.error(`  ${TUI.red('•')} ${e.plugin} — ${e.message}`);
        }
      }
      const lines = loadErrors.map((e) => `${e.plugin}: ${e.message}`);
      throw new Error(
        `Build failed: ${loadErrors.length} plugin(s) could not be loaded:\n` +
        lines.map((l) => `  - ${l}`).join('\n')
      );
    }

    // Execute onConfigResolved hooks
    for (const fn of hooks.onConfigResolved) {
      await fn(config);
    }

    const buildHash = Date.now().toString(36);
    const _buildId   = `${buildHash}-${Math.random().toString(36).slice(2,7)}`;

    // Use V3 labels (config.out / config.src) which are normalized by config-schema
    const rootOutputDir = path.resolve(CWD, config.out);
    await fs.ensureDir(rootOutputDir);

    // ── TUI: Build section header ──────────────────────────
    if (!options.quiet) {
      TUI.section('Build');
      const details = TUI.extractProjectDetails(config, rootOutputDir, CWD);
      TUI.projectDetails(details);
      TUI.footer(); // close Build — Data Indexing and progress appear in clean air
    }

    // Helper: Build Assets for a specific output directory
    const buildAssetsForDir = async (targetOutDir: string) => {
      await prepareAssets(config, targetOutDir, options);
      // New in 0.8.7: copy template assets (CSS/JS bundles shipped by
      // template plugins) into `assets/template/`.
      await prepareTemplateAssets(config, targetOutDir);
      if (hooks.assets) {
        for (const getAssetsFn of hooks.assets) {
          // hooks.assets entries are async wrappers; missing the await here
          // would make `assets` a Promise and silently skip the whole copy
          // loop (Array.isArray(Promise) === false). The user-visible symptom
          // is "plugin assets never land in site/" — search, git, mermaid,
          // math, openapi CSS/JS all missing, search modal does not open.
          const assets = await getAssetsFn();
          if (Array.isArray(assets)) {
            for (const asset of assets) {
              // Backwards-compat: legacy assets used `src`/`dest` and
              // `location`. The new typed `Asset` interface uses `path` and
              // `position`. Accept both spellings here.
              const src = (asset as any).src ?? (asset as any).path;
              const dest = (asset as any).dest ?? (asset as any).url;
              if (src && dest) {
                const destPath = path.join(targetOutDir, dest);
                await fs.ensureDir(path.dirname(destPath));
                // Strip sourceMappingURL comments from copied JS so the
                // browser doesn't 404 looking for .map files we don't ship.
                // vendored libs (minisearch etc.) leave these behind.
                if (dest.endsWith('.js')) {
                  try {
                    const content = await fs.readFile(src, 'utf8');
                    const stripped = content.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '');
                    await fs.writeFile(destPath, stripped);
                  } catch {
                    await fs.copy(src, destPath);
                  }
                } else {
                  await fs.copy(src, destPath);
                }
              }
            }
          }
        }
      }
    };

    // Build assets ONCE for the root site (skip on targeted incremental rebuilds)
    if (!options.targetFiles) {
      await buildAssetsForDir(rootOutputDir);
    }

    // Open Data Indexing before buildLocales so git (onBeforeBuild) runs inside it.
    // Search (indexing phase below) is appended to the same open section.
    const INDEXING_PLUGINS = new Set(['search']);
    const indexingHooks   = hooks.onPostBuild.filter((fn: any) => INDEXING_PLUGINS.has(fn._pluginName));
    const publishingHooks = hooks.onPostBuild.filter((fn: any) => !INDEXING_PLUGINS.has(fn._pluginName));
    const hasIndexingWork = !options.targetFiles && (
      (hooks.onBeforeBuild?.length ?? 0) > 0 || indexingHooks.length > 0
    );
    if (hasIndexingWork && !options.quiet) TUI.section('Data Indexing', TUI.blue);

    const allGeneratedPages = await buildLocales({
      config,
      rootOutputDir,
      hooks,
      buildHash,
      options: { ...options, _buildId } as any,
      CWD,
      onProgress: options.onProgress,
      targetFiles: options.targetFiles,
      coreVersion: pkg.version
    });

    // --- i18n ROOT REDIRECT ---
    await generateLocaleRedirect(config, rootOutputDir);

    // --- i18n PAGE MANIFEST ---
    // Emit a tiny JS file mapping locale IDs to their available page paths.
    // The client-side language switcher uses this for instant page-existence
    // checks - zero HEAD fetches, works offline, CDN-agnostic.
    if (config.i18n && config.i18n.locales) {
      const defaultLocale = config.i18n.default || '';
      const localeIds = new Set(config.i18n.locales.map((l: any) => l.id));
      const manifest: Record<string, string[]> = {};

      for (const page of allGeneratedPages) {
        const segments = page.outputPath.split('/');
        const firstSeg = segments[0];
        let localeId = defaultLocale;
        let pagePath: string;

        if (localeIds.has(firstSeg) && firstSeg !== defaultLocale) {
          localeId = firstSeg;
          pagePath = '/' + segments.slice(1).join('/');
        } else {
          pagePath = '/' + page.outputPath;
        }

        // Normalize: /index.html → /, /foo/index.html → /foo
        pagePath = pagePath.replace(/\/index\.html$/, '') || '/';

        if (!manifest[localeId]) manifest[localeId] = [];
        manifest[localeId].push(pagePath);
      }

      const manifestJs = `window.DOCMD_LOCALE_PAGES=${JSON.stringify(manifest)};`;
      const manifestPath = path.join(rootOutputDir, 'assets', 'js', 'docmd-i18n-manifest.js');
      await fs.ensureDir(path.dirname(manifestPath));
      await fs.writeFile(manifestPath, manifestJs);
    }

    // --- 3. GENERATE CUSTOM 404 PAGE ---
    // The 404 page always lives at <rootOutputDir>/404.html — a single
    // file at the site root, regardless of how many locales the site has.
    // Static hosts (Vercel, Netlify, GitHub Pages, Cloudflare Pages,
    // S3+CloudFront) all auto-serve /404.html on any unmatched route, so
    // emitting one per locale under subdirectories would either be ignored
    // or require a manual try_files rule per deployment.
    //
    // The page is translated to the site's DEFAULT locale. Visitors on a
    // non-default locale will still see the default-locale 404 — that's
    // a deliberate trade-off (one file at root > per-locale subdirs that
    // most hosts won't pick up). Users who want per-locale 404s can:
    //   1. Mount a custom 404 via config.notFound (full control), or
    //   2. Configure their reverse proxy with try_files fallbacks.
    const { renderTemplateAsync } = await import('@docmd/parser/dist/html-renderer.js');
    const ui = await import('@docmd/ui');

    // Resolve default locale (falls back to 'en' when no i18n configured).
    const defaultLocaleId =
      (config.i18n?.default as string)
      || (Array.isArray(config.i18n?.locales) && config.i18n.locales[0]?.id)
      || 'en';
    const activeLocale = (Array.isArray(config.i18n?.locales)
      ? config.i18n.locales.find((l: any) => l.id === defaultLocaleId)
      : null) || { id: defaultLocaleId };

    const notFoundStrings = ui.loadTranslations(defaultLocaleId);
    const t = ui.createT(notFoundStrings);

    // Resolution order for the 404 title and body:
    //   1. User-supplied config.notFound.title / config.notFound.content
    //      (always wins when present — full customisation escape hatch).
    //   2. Translated via t('pageNotFound') / t('pageNotFoundMsg') against
    //      the default locale's strings (zh, de, fr, ja, etc).
    //   3. NOT_FOUND_DEFAULTS.title / content (defined in config-schema)
    //      as the final English fallback if a translation key is missing.
    const resolvedTitle = config.notFound?.title
      || t('pageNotFound')
      || NOT_FOUND_DEFAULTS.title;
    const resolvedContent = config.notFound?.content
      || t('pageNotFoundMsg')
      || NOT_FOUND_DEFAULTS.content;

    const notFoundTemplatePath = path.join(ui.getTemplatesDir(), '404.ejs');
    let notFoundTemplateStr = '';
    if (await fs.exists(notFoundTemplatePath)) {
      notFoundTemplateStr = await fs.readFile(notFoundTemplatePath, 'utf8');
    } else {
      notFoundTemplateStr = `<h1>404</h1><p>Page Not Found</p>`;
    }

    const themeInitPath = path.join(ui.getTemplatesDir(), 'partials', 'theme-init.js');
    const themeInitScript = (await fs.exists(themeInitPath)) ? `<script>${await fs.readFile(themeInitPath, 'utf8')}</script>` : '';

    // Determine Absolute Base (usually '/' unless 'base' config is set)
    const absoluteRoot = config.base && config.base !== '/' ? config.base.replace(/\/$/, '') + '/' : '/';

    const full404Html = await renderTemplateAsync(notFoundTemplateStr, {
      pageTitle: resolvedTitle,
      title: resolvedTitle,
      content: resolvedContent,
      logo: config.logo,
      t,
      activeLocale,

      // Context for Assets
      relativePathToRoot: absoluteRoot,
      buildHash,
      appearance: config.theme?.appearance || config.theme?.defaultMode || 'system',
      defaultMode: config.theme?.appearance || config.theme?.defaultMode || 'system',
      theme: config.theme,
      customCssFiles: config.theme.customCss || [],

      faviconLinkHtml: config.favicon 
        ? `<link rel="icon" href="${absoluteRoot}${config.favicon.replace(/^\//, '')}">`
        : `<link rel="icon" href="${absoluteRoot}assets/favicon.ico">`,
      themeInitScript
    });

    await fs.writeFile(path.join(rootOutputDir, '404.html'), full404Html);

    // Auto-generate .nojekyll at the root output directory to disable Jekyll globally on GitHub Pages
    const rootNoJekyllPath = path.join(rootOutputDir, '.nojekyll');
    if (!nativeFs.existsSync(rootNoJekyllPath)) {
      await fs.writeFile(rootNoJekyllPath, '');
    }

    // --- 4. GENERATE STATIC REDIRECTS ---
    if (config.redirects && Object.keys(config.redirects).length > 0) {
      for (const [from, to] of Object.entries(config.redirects)) {
        let cleanFrom = from.replace(/^\//, '');
        if (!cleanFrom.endsWith('.html')) cleanFrom = path.join(cleanFrom, 'index.html');

        const redirectPath = path.join(rootOutputDir, cleanFrom);
        const redirectHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting...</title><meta http-equiv="refresh" content="0; url=${to}"><link rel="canonical" href="${to}"><script>window.location.replace("${to}");</script></head><body><p>Redirecting to <a href="${to}">${to}</a>...</p></body></html>`;

        await fs.ensureDir(path.dirname(redirectPath));
        await fs.writeFile(redirectPath, redirectHtml);
      }
    }

    // --- 5. Post Build Hooks ---
    // Only run on full builds. Split into:
    //   Data Indexing → search (appended to already-open section from git above)
    //   Publishing    → sitemap, llms, pwa, etc.
    if (!options.targetFiles) {
      const postBuildCtx = {
        config,
        pages:     allGeneratedPages,
        outputDir: rootOutputDir,
        log: (msg: string, status: 'DONE'|'SKIP'|'FAIL'|'WAIT' = 'DONE') => {
          if (!options.quiet) TUI.step(msg, status, TUI.blue);
        },
        tui:     TUI,
        options: { ...options, quiet: options.quiet },
        runWorkerTask(modulePath: string, functionName: string, args: any[]) {
          if (!config._workerPool) throw new Error('WorkerPool is not initialized');
          return config._workerPool.runTask({ type: 'plugin-task', modulePath, functionName, args });
        }
      };

      // Indexing — search runs in the already-open Data Indexing section
      for (const fn of indexingHooks) await fn(postBuildCtx);
      if (hasIndexingWork && !options.quiet) TUI.footer(TUI.blue);

      // Publishing — each plugin renders as a parent line + indented children
      if (publishingHooks.length > 0) {
        if (!options.quiet) TUI.section('Publishing', TUI.blue);
        for (const fn of publishingHooks) {
          const pluginName = String((fn as any)._pluginName || 'plugin');
          const entries: Array<{ msg: string; status: 'DONE'|'SKIP'|'FAIL'|'WAIT' }> = [];
          const pluginCtx = {
            ...postBuildCtx,
            log: (msg: string, status: 'DONE'|'SKIP'|'FAIL'|'WAIT' = 'DONE') => {
              entries.push({ msg, status });
            },
          };
          await fn(pluginCtx);
          if (!options.quiet) TUI.pluginTree(pluginName, entries, TUI.blue);
        }
        if (!options.quiet) TUI.footer(TUI.blue);
      }
    }

    if (!options.isDev && !options.quiet) {
      flushNormaliserWarnings();
      TUI.success(`Build complete. Generated ${allGeneratedPages.length} pages in ${elapsed()}.`);
    }

    if (!opts.workerPool) {
      await workerPool.terminateAll();
    }

    const { getPluginErrors } = await import('@docmd/api');
    const errors = getPluginErrors();
    if (errors.length > 0) {
      // N-12: surface every plugin error in one place. Previously the
      // user saw "Build complete" and only later discovered failures when
      // a generated page was missing or a downstream tool choked on a
      // bad artifact. The summary lists every error with its plugin +
      // hook, so the operator can grep for any of them.
      if (!options.isDev && !options.quiet) {
        TUI.error('Plugin errors during build', '');
        for (const err of errors) {
          const filePart = err.filePath ? ` (${err.filePath})` : '';
          console.error(`  ${TUI.red('•')} ${err.plugin} :: ${err.hook}${filePart} — ${err.message}`);
        }
      }
      throw new Error(`Build failed: ${errors.length} plugin error(s) occurred during execution.`);
    }

  } catch (e: any) {
    if (!options.isDev && !options.quiet) {
      TUI.error('Build failed', e.message);
      // Show full stack trace if we are in a testing/CI environment
      if (process.env.npm_lifecycle_event === 'test' || process.env.CI) {
        console.error(e.stack);
      }
      process.exit(1);
    }
    throw e;
  }
}