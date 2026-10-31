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
import { fsUtils as fs, resolveTitle, resolveTitleSeparator, resolveTitleAppend } from '@docmd/utils';
import { createRequire } from 'module';
import { execSync } from 'child_process';

/**
 * Convert every segment of a relative file path to a URL-safe slug,
 * mirroring the slugifySegment logic in auto-router.ts.
 * This ensures the output path written to disk matches the URL that
 * buildAutoNav generates for the same file.
 *
 * Example:  "SA/folder with space/page with space"
 *        →  "SA/folder-with-space/page-with-space"
 */
function slugifyOutputPath(p: string): string {
  return p
    .split('/')
    .map(seg =>
      seg
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9\-_.~]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        || seg
    )
    .join('/');
}
import { generateAssetTag, findFilesRecursive } from './assets.js';
import { generateHreflangTags } from './i18n.js';
import { buildAutoNav } from '../utils/auto-router.js';
import nativeFs from 'fs';

const _require = createRequire(import.meta.url);
import * as parser from '@docmd/parser';
import { TUI } from '@docmd/tui';
import { findPageNeighbors, findBreadcrumbs, normalizeNavPaths, createUrlContext, buildContextualUrl, buildAbsoluteContextualUrl, computePageUrls, sanitizeUrl, normaliseBaseTag, VariableRegistry, interpolateConfigVariables } from '@docmd/parser';
import * as ui from '@docmd/ui';
import type { ResolvedAsset } from '@docmd/api';



/* ── Core package version (for <meta name="generator">) ──────── */
const _pkgUrl = new URL('../../package.json', import.meta.url);
const _pkg = JSON.parse(nativeFs.readFileSync(_pkgUrl, 'utf8')) as { version: string };
const CORE_VERSION: string = _pkg.version;

/* ── Constants ────────────────────────────────────────────────── */

/** Number of pages to process concurrently in each batch. */
const BATCH_SIZE = 64;

/** Number of pages to write to disk concurrently. */
const WRITE_BATCH_SIZE = 128;

/* ── Git Root Detection (for edit links) ─────────────────────── */

/** Cached git root path (null = not yet detected, '' = not a git repo). */
let _cachedGitRoot: string | null = null;

/**
 * Detect the git repository root for the current working directory.
 * Returns the absolute path to the git root, or null if not in a git repo.
 * Result is cached per build (cache resets when cwd changes).
 */
function getGitRoot(): string | null {
  if (_cachedGitRoot !== null) {
    return _cachedGitRoot || null;
  }
  try {
    _cachedGitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8'
    }).trim();
    return _cachedGitRoot;
  } catch {
    _cachedGitRoot = '';
    return null;
  }
}

/* ── Types ────────────────────────────────────────────────────── */

interface RenderPagesOptions {
  config: any;
  srcDir: string;
  fallbackSrcDir: string | null;
  outputDir: string;
  hooks: any;
  buildHash: string;
  options: any;
  outputPrefix?: string;
  /** docmd core version (e.g. "0.8.7"). Used for the <meta name="generator"> tag. */
  coreVersion?: string;
  /** Progress callback: (current, total) called after each batch completes. */
  onProgress?: (current: number, total: number) => void;
  /** Optional: only render specific files (relative to srcDir). Used for incremental dev rebuilds. */
  targetFiles?: string[];
  /** Plugin/template assets resolved once by the top-level build. */
  resolvedAssets: readonly ResolvedAsset[];
}

export async function renderPages({ config, srcDir, fallbackSrcDir, outputDir, hooks, buildHash, options, outputPrefix = '', coreVersion, onProgress, targetFiles, resolvedAssets }: RenderPagesOptions) {
  // Reset git root cache (cwd may have changed between workspace builds)
  _cachedGitRoot = null;

  // Initialize VariableRegistry for this build phase
  const variableRegistry = new VariableRegistry({
    configVariables: config.variables,
    siteTitle: config.title || config.siteTitle,
    siteBase: config.base,
    cwd: process.cwd(),
    version: coreVersion || CORE_VERSION
  });
  config._variableRegistry = variableRegistry;

  // Interpolate dynamic variables in config strings (footer copyright, banners, titles)
  config = interpolateConfigVariables(config, variableRegistry);

  // Load Translations for the active locale
  const localeId = config._activeLocale?.id || null;
  const pluginTranslations = hooks.translations
    ? await hooks.translations.reduce(async (accP: any, fn: any) => ({ ...(await accP), ...(await fn(localeId)) }), {})
    : {};

  // Merge: system translations → plugin translations → user-provided locale translations
  const userLocaleTranslations = config._activeLocale?.translations || {};
  const strings = ui.loadTranslations(localeId, { ...pluginTranslations, ...userLocaleTranslations });
  const t = ui.createT(strings);

  // Resolve locale-specific navigation.json
  // Each locale dir has its own navigation.json; fall back to default locale's navigation
  if (config.i18n && config._activeLocale) {
    const localeNavPath = path.join(srcDir, 'navigation.json');
    try {
      if (nativeFs.existsSync(localeNavPath)) {
        const rawNav = await nativeFs.promises.readFile(localeNavPath, 'utf8');
        const parsedNav = JSON.parse(rawNav);
        normalizeNavPaths(parsedNav);
        config = { ...config, navigation: parsedNav };
      } else if (fallbackSrcDir) {
        // Fall back to default locale's navigation.json
        const fallbackNavPath = path.join(fallbackSrcDir, 'navigation.json');
        if (nativeFs.existsSync(fallbackNavPath)) {
          const rawNav = await nativeFs.promises.readFile(fallbackNavPath, 'utf8');
          const parsedNav = JSON.parse(rawNav);
          normalizeNavPaths(parsedNav);
          config = { ...config, navigation: parsedNav };
        }
      }
    } catch {
      TUI.warn(`Failed to parse locale navigation: ${localeNavPath}`);
    }
  }

  if (config.autoNav !== false && (!config.navigation || config.navigation.length === 0)) {
    const navDir = fallbackSrcDir || srcDir;
    config = { ...config, navigation: buildAutoNav(navDir) };
  }

  // Pass UI strings to the markdown processor (for locale-aware aria-labels etc.)
  const configWithStrings = { ...config, _uiStrings: strings };
  const mdProcessor = parser.createMarkdownProcessor(configWithStrings, (md: any) => hooks.markdownSetup.forEach((hook: any) => hook(md)));

  // Load Layout Templates
  const templates = {
    layout: await nativeFs.promises.readFile(ui.getTemplatePath('layout'), 'utf8'),
    noStyle: await nativeFs.promises.readFile(ui.getTemplatePath('no-style'), 'utf8'),
    navigation: await nativeFs.promises.readFile(ui.getTemplatePath('navigation'), 'utf8'),
    'docmd-search': await nativeFs.promises.readFile(ui.getTemplatePath('docmd-search'), 'utf8'),
  };

  // Load Partials
  const themeInitPath = path.join(ui.getTemplatesDir(), 'partials', 'theme-init.js');
  const themeInitScript = (await fs.exists(themeInitPath))
    ? `<script>${await nativeFs.promises.readFile(themeInitPath, 'utf8')}</script>`
    : '';

  // Footer Processing
  const footerHtml = config.footer?.content ? mdProcessor.renderInline(config.footer.content) : '';

  // --- 1. Identify Assets (Plugin + Template Injection) ---
  // Each entry is `{ priority, gen }` so we can sort by load order:
  //   0  = base (docmd-main.css)
  //   5  = theme colour overlay (docmd-theme-sky.css etc.)
  //   10 = template structure (NEW in 0.8.7)
  //   15 = user customCss (always wins)
  //   20 = other plugins
  // Within the same priority, the order of registration is preserved.
  //
  // Assets fall into two buckets per position:
  //   - `commonXxx`  — emitted on EVERY page (legacy behaviour)
  //   - `condXxx`    — gated by an AssetCondition; evaluated per page
  type AssetEntry = { priority: number; gen: (rel: string) => string; condition?: any };
  const assetTags: { head: AssetEntry[]; body: AssetEntry[] } = {
    head: [],
    body: [],
  };

  // Theme CSS (priority 5 — overrides base, overridden by template & customCss)
  // Skipped when:
  //   - name is 'default' (no overlay) or 'none' (explicitly disabled)
  //   - name was promoted to a template name (see config-schema §4.0)
  //   - the template opted out of CSS overlay via _noCssOverlay
  const themeName = config.theme.name;
  const themeIsTemplate = config.theme._noCssOverlay === true;
  if (themeName && themeName !== 'default' && themeName !== 'none' && !themeIsTemplate) {
    assetTags.head.push({
      priority: 5,
      gen: (rel: string) => generateAssetTag(`${rel}assets/css/docmd-theme-${themeName}.css?v=${buildHash}`, 'css'),
    });
  }
  // Lightbox (priority 20 — always last, no theme/template should override it)
  assetTags.body.push({
    priority: 20,
    gen: (rel: string) => generateAssetTag(`${rel}assets/js/docmd-image-lightbox.js?v=${buildHash}`, 'js'),
  });

  // Template and plugin declarations were normalized once by buildSite. The
  // same immutable records drive copying, page tags, and post-build hooks.
  for (const asset of resolvedAssets) {
    if (asset.position === 'none') continue;
    const gen = asset.kind === 'file'
      ? (rel: string) => generateAssetTag(`${rel}${asset.outputPath}?v=${buildHash}`, asset.type, asset.attributes)
      : () => generateAssetTag(asset.url, asset.type, asset.attributes);
    const bucket = asset.position === 'head' ? assetTags.head : assetTags.body;
    bucket.push({ priority: asset.priority, gen, condition: asset.condition });
  }

  // Sort each bucket by priority (stable). Conditional assets stay in the same
  // list — the per-page renderer filters them via the `condition` predicate.
  const sortByPriority = (a: { priority: number }, b: { priority: number }) => a.priority - b.priority;
  assetTags.head.sort(sortByPriority);
  assetTags.body.sort(sortByPriority);

  // --- 2. Process Content ---
  // Build a set of file paths that the auto-router designated as folder-level indexes
  // These are files where _sourceFile was stored when the auto-router reassigned them to '/'
  const navDesignatedIndexFiles = new Set<string>();
  const extractNavIndexes = (items: any[]) => {
    for (const item of items) {
      if (item.children) {
        extractNavIndexes(item.children);
      } else if (item._sourceFile) {
        // _sourceFile is the original path like '/highlighting/' - normalize to relative path
        // and strip trailing slash to match relWithoutExt format used during comparison
        navDesignatedIndexFiles.add(item._sourceFile.replace(/^\//, '').replace(/\/$/, ''));
      }
    }
  };
  if (config.navigation) extractNavIndexes(config.navigation);

  // Find both .md/.markdown files AND .ejs content files (EJS files are pre-rendered before markdown)
  // When fallbackSrcDir is set (non-default locale), scan the fallback dir as the canonical
  // file list, then check the locale dir for overrides per file.
  const scanDir = fallbackSrcDir || srcDir;
  const mdFiles = await findFilesRecursive(scanDir, ['.md', '.markdown', '.ejs'], config.exclude);

  // Build set of locale directory names to skip when scanning a non-locale-specific dir
  // This prevents locale subdirs inside old version dirs from being rendered as regular pages
  const localeIds = new Set((config._allLocales || []).map((l: any) => l.id));

  // ── Phase 2A: Parallel file reading + content processing ──────
  //
  // Instead of sequential read→parse→render per file, we batch the work:
  //   1. Read files in parallel (I/O bound — benefits from concurrency)
  //   2. Parse + render markdown (CPU bound — still sequential per-file but batched)
  //   3. Collect all pages, then render HTML templates + write in parallel

  interface PageEntry {
    relativePath: string;
    targetFilePath: string;
    isFallback: boolean;
  }

  // Build the file manifest (fast — just path resolution, no I/O)
  const fileManifest: PageEntry[] = [];

  for (const filePath of mdFiles) {
    const relativePath = path.relative(scanDir, filePath);

    // Skip files inside locale subdirectories when scanning a non-locale dir
    if (localeIds.size > 0 && !fallbackSrcDir) {
      const topDir = relativePath.split(path.sep)[0];
      if (localeIds.has(topDir)) continue;
    }

    let targetFilePath = filePath;
    let isFallback = false;

    // For non-default locales: check if the locale dir has this file
    if (fallbackSrcDir) {
      const localizedPath = path.join(srcDir, relativePath);
      if (nativeFs.existsSync(localizedPath)) {
        targetFilePath = localizedPath;
      } else {
        isFallback = true;
      }
    }

    fileManifest.push({ relativePath, targetFilePath, isFallback });
  }

  // Scan for locale-exclusive pages (exist only in the locale dir, not in fallback)
  if (fallbackSrcDir && nativeFs.existsSync(srcDir)) {
    const localeFiles = await findFilesRecursive(srcDir, ['.md', '.markdown', '.ejs']);
    const fallbackRelPaths = new Set(mdFiles.map(f => path.relative(scanDir, f)));

    for (const filePath of localeFiles) {
      const relativePath = path.relative(srcDir, filePath);
      if (fallbackRelPaths.has(relativePath)) continue;
      fileManifest.push({ relativePath, targetFilePath: filePath, isFallback: false });
    }
  }

  // --- 2. Filter by targetFiles (Incremental Build) ---
  const filteredManifest = targetFiles && targetFiles.length > 0
    ? fileManifest.filter(entry => {
        // targetFiles are usually absolute or relative to CWD.
        // We check if the entry's targetFilePath matches any of the targetFiles.
        return targetFiles.some(t => {
            const absTarget = path.resolve(process.cwd(), t);
            return entry.targetFilePath === absTarget || entry.relativePath === t;
        });
      })
    : fileManifest;

  // Total page count for progress reporting
  const totalFiles = filteredManifest.length;
  let processedCount = 0;

  // ── Process files in batches ──────────────────────────────────
  const pages: any[] = [];

  for (let batchStart = 0; batchStart < filteredManifest.length; batchStart += BATCH_SIZE) {
    const batch = filteredManifest.slice(batchStart, batchStart + BATCH_SIZE);

    // 1. Read all files in this batch concurrently
    const fileContents = await Promise.all(
      batch.map(entry => nativeFs.promises.readFile(entry.targetFilePath, 'utf8'))
    );

    // 2. Process each file in the batch
    for (let j = 0; j < batch.length; j++) {
      const { relativePath, targetFilePath, isFallback } = batch[j];
      let rawContent = fileContents[j];

      // Prepend a warning callout when falling back to default language
      if (isFallback) {
          const defaultLabel = config._allLocales?.find((l: any) => l.id === config._defaultLocale)?.label || config._defaultLocale;
          const activeLabel = config._activeLocale.label;
          const fallbackMsg = t('fallbackMessage', { active: activeLabel, default: defaultLabel });
          const callout = `\n::: callout warning\n${fallbackMsg}\n:::\n\n`;
          // Insert after frontmatter if present, otherwise prepend
          const fmEnd = rawContent.indexOf('\n---', 1);
          if (rawContent.startsWith('---') && fmEnd > 0) {
              const afterFm = fmEnd + 4; // skip \n---
              rawContent = rawContent.slice(0, afterFm) + '\n' + callout + rawContent.slice(afterFm);
          } else {
              rawContent = callout + rawContent;
          }
      }

      const filename = path.basename(relativePath).toLowerCase();
      const ext = path.extname(filename);
      const isIndex = filename.startsWith('index.');
      const isReadme = filename === 'readme.md';

      // Pre-render .ejs content files through lite-template before passing to markdown
      if (ext === '.ejs') {
        try {
          const fmRegex = /^(?:---[\r\n]+)([\s\S]*?)(?:[\r\n]+---(?:[\r\n]+|$))/;
          const fmMatch = rawContent.match(fmRegex);
          let ejsBody = rawContent;
          const fmData: Record<string, any> = {};
          let fmRaw = '';

          if (fmMatch) {
            fmRaw = fmMatch[0];
            ejsBody = rawContent.slice(fmRaw.length);
            const yamlStr = fmMatch[1];
            for (const line of yamlStr.split('\n')) {
              const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
              if (kv) {
                let val: any = kv[2].trim();
                if (/^\d+$/.test(val)) val = parseInt(val, 10);
                else if (val === 'true') val = true;
                else if (val === 'false') val = false;
                else val = val.replace(/^["']|["']$/g, '');
                fmData[kv[1]] = val;
              }
            }
          }

          const renderedBody = await parser.renderTemplateAsync(ejsBody, {
            ...fmData
          }, { filename: targetFilePath });

          if (fmRaw) {
            rawContent = fmRaw + '\n' + renderedBody;
          } else {
            rawContent = renderedBody;
          }
        } catch (e) {
          TUI.warn(`Skipping EJS render error in ${relativePath}: ${(e as any).message}`);
          continue;
        }
      }

      // Treat README.md as index only if no index.md exists in the same folder
      const hasIndexInFolder = fileManifest.some(entry => {
        const b = path.basename(entry.targetFilePath).toLowerCase();
        return b.startsWith('index.') && path.dirname(entry.targetFilePath) === path.dirname(targetFilePath);
      });

      // Check if the auto-router designated this file as a folder-level index
      const relWithoutExt = relativePath.replace(/\.(md|markdown|ejs)$/i, '').replace(/\\/g, '/');
      const isNavDesignatedIndex = navDesignatedIndexFiles.has(relWithoutExt);
      const effectivelyIndex = isIndex || (isReadme && !hasIndexInFolder) || (isNavDesignatedIndex && !hasIndexInFolder);

      // Determine output path — slugify each path segment so that spaces and
      // URL-unsafe characters are replaced with hyphens, matching the URLs
      // generated by buildAutoNav in auto-router.ts. Computed BEFORE
      // processContentAsync so we can pass relativePathToRoot + isOfflineMode
      // through env; the markdown post-processor uses these to rewrite
      // internal hrefs for offline builds.
      const withoutExt = slugifyOutputPath(
        relativePath.replace(/\.(md|markdown|ejs)$/, '').replace(/\\/g, '/')
      );
      const slugifiedDir = slugifyOutputPath(
        path.dirname(relativePath).replace(/\\/g, '/')
      );
      const htmlOutputPath = effectivelyIndex
        ? path.posix.join(outputPrefix, slugifiedDir, 'index.html').replace(/^\/?/, '')
        : path.posix.join(outputPrefix, withoutExt, 'index.html').replace(/^\/?/, '');
      // Compute relativePathToRoot from the *output* path so markdown
      // hrefs that target `/foo/` get rewritten to `./foo/index.html` (or
      // `../foo/index.html` for nested pages) — works in file:// AND on
      // HTTP servers AND on custom domains.
      const fileDir = path.dirname(htmlOutputPath);
      let relativePathToRootForMarkdown = path.relative(fileDir, '.');
      if (relativePathToRootForMarkdown === '') relativePathToRootForMarkdown = './';
      else relativePathToRootForMarkdown += '/';
      relativePathToRootForMarkdown = relativePathToRootForMarkdown.replace(/\\/g, '/');

      const pageUrlsForMarkdown = computePageUrls(htmlOutputPath, config.url || '', config.base || '/');

      const processed = await parser.processContentAsync(
        rawContent,
        mdProcessor,
        config,
        {
          isIndex: effectivelyIndex,
          filePath: targetFilePath,
          // Offline-mode + relative-path context for the markdown post-processor.
          isOfflineMode: options.offline === true,
          relativePathToRoot: relativePathToRootForMarkdown,
          // M-5: tell the post-processor which locale is the default so it
          // can strip the default-locale prefix from absolute hrefs
          // (e.g. `/en/foo` from a `fr/` page → `/foo`, since the default
          // locale lives at root, not under its own prefix).
          defaultLocale: config._defaultLocale || null,
          allLocales: (config._allLocales || []).map((l: any) => l.id),
          outputPrefix: outputPrefix,
          config: { base: config.base || '/' },
          pathname: pageUrlsForMarkdown.pathname,
        },
        hooks
      );
      if (!processed) continue;

      pages.push({ ...processed, sourcePath: targetFilePath, outputPath: htmlOutputPath, rawMarkdown: rawContent });
    }

    // Report progress after each batch
    processedCount += batch.length;
    if (onProgress) onProgress(processedCount, totalFiles);
  }

  // --- 2.5 onBeforeBuild (Data Indexing) ---
  // Run hooks on every pass (each locale has its own page set).
  // Show the section header only ONCE per top-level build to avoid
  // reprinting it for every locale × version combination.
  if (hooks.onBeforeBuild && hooks.onBeforeBuild.length > 0) {
    const showSection = !options.targetFiles;
    const beforeBuildContext = {
      config,
      pages,
      tui: TUI,
      options: showSection ? { ...options, quiet: options.quiet || false } : options,
      runWorkerTask(modulePath: string, functionName: string, args: any[]) {
        if (!config._workerPool) throw new Error('WorkerPool is not initialized');
        return config._workerPool.runTask({ type: 'plugin-task', modulePath, functionName, args });
      }
    };
    for (const hookFn of hooks.onBeforeBuild) {
      await hookFn(beforeBuildContext);
    }
    // Section stays open — build.ts closes it after appending search.
  }

  // --- 3. Render HTML (parallel template rendering + batched writes) ---
  const writeQueue: { finalPath: string; html: string }[] = [];

  // Process pages in batches to allow concurrent hook execution (e.g. Git log calls)
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (page) => {
      const finalPath = path.join(outputDir, page.outputPath);
      const fileDir = path.dirname(page.outputPath);
      let relativePathToRoot = path.relative(fileDir, '.');
      if (relativePathToRoot === '') relativePathToRoot = './';
      else relativePathToRoot += '/';
      relativePathToRoot = relativePathToRoot.replace(/\\/g, '/');

      // Canonical absolute site root (subpath deployment). The generator
      // owns this decision — templates never compute it themselves.
      //   root deploy            → '/'
      //   locale/version subpath → '/de/' or '/v1/'
      //   explicit `config.base` → '/my-repo/' (3rd-party deploys)
      let siteRootAbs = config.base || '/';
      if (siteRootAbs !== '/' && !siteRootAbs.endsWith('/')) siteRootAbs += '/';

      // Keep relativePathToRoot relative (e.g. '../', './') so all page assets and links are loaded relatively.
      // Do not overwrite with siteRootAbs.

      // Navigation Context
      let navPath = '/' + page.outputPath.replace(/\\/g, '/').replace(/\/index\.html$/, '').replace(/^index\.html$/, '');
      if (navPath === '/.') navPath = '/';
      
      // Strip outputPrefix (locale + version) from navPath so it matches navigation.json paths
      if (outputPrefix) {
        const prefixStr = '/' + outputPrefix.replace(/\/$/, '');
        if (navPath.startsWith(prefixStr + '/') || navPath === prefixStr) {
          navPath = navPath.substring(prefixStr.length) || '/';
        }
      }
      
      const { prevPage, nextPage } = findPageNeighbors(config.navigation, navPath);
      const breadcrumbs = config.layout?.breadcrumbs !== false ? findBreadcrumbs(config.navigation, navPath) : [];

      // Pre-compute page URLs for plugin consumption
      const pageUrls = computePageUrls(page.outputPath, config.url || '', config.base || '/');

      const urlContext = createUrlContext({
        relativePathToRoot,
        outputPrefix,
        offline: options.offline,
        base: siteRootAbs,
        siteUrl: config.url || '',
        pathname: pageUrls.pathname,
        projectPrefix: config._activePrefix || '/',
        workspaceProjects: config._workspace?.projects || [],
      });


      // Front the URL context with simple-relative asset + root-prefixed nav
      // helpers for build mode where <base> is emitted. In dev/offline these
      // fall back to page-depth-aware and empty so the same template renders
      // correctly across all three modes.
      const emitBaseTag = urlContext.emitBase;
      const assetBaseUrl = urlContext.assetBaseUrl;
      const navRootPrefix = emitBaseTag ? urlContext.base : '';

      const buildRelativeUrl = (href: string) => buildContextualUrl(href, urlContext);

      // bind buildAbsoluteUrl to the current page context so version /
      // language / project switchers emit file://-safe relative URLs in
      // offline builds. In non-offline builds the bound helper is a no-op
      // pass-through to buildAbsoluteUrl (clean URLs preserved for SEO and
      // HTTP servers). Templates keep calling `buildAbsoluteUrl(...)` and
      // get correct behaviour automatically.
      const buildAbsoluteUrlContextual = (
        base: string,
        localePrefix: string,
        versionPrefix: string,
        pagePath: string
      ) => buildAbsoluteContextualUrl(base, localePrefix, versionPrefix, pagePath, urlContext);

      // Fix Neighbor Links
      const fixNeighbor = (node: any) => {
        if (!node) return null;
        return { ...node, url: buildRelativeUrl(node.path) };
      };

      // ── Phase 3A: Invoke onBeforeRender Hook ──
      // (Run BEFORE asset injection so plugins can mutate page.htmlContent /
      // page.frontmatter and the conditional asset filter sees the final state.)
      // D-M3: urlContext and config are now included in onBeforeRender
      // too, matching the shape onPageReady gets. This lets plugins
      // that need to build URLs or read global config do so from either
      // hook without checking which one they're in. The values are
      // shallow snapshots — mutating them does NOT affect other pages
      // or the global config.
      const pageContext = {
        frontmatter: page.frontmatter,
        outputPath: page.outputPath,
        sourcePath: page.sourcePath,
        urls: pageUrls,
        html: page.htmlContent,
        urlContext,
        config,
        breadcrumbs
      };

      if (hooks.onBeforeRender) {
        for (const fn of hooks.onBeforeRender) {
          await fn(pageContext);
        }
      }

      // Reflect any mutations from plugins
      page.htmlContent = pageContext.html;
      page.frontmatter = pageContext.frontmatter;

      // Evaluate conditional assets against the *final* page state. This is
      // what makes features like conditional mermaid loading work — a page
      // that doesn't render any `class="mermaid"` block never gets the
      // `init-mermaid.js` <script> (and therefore never fetches the ~500 KB
      // mermaid library from the CDN at runtime).
      const matchesCondition = (condition: any): boolean => {
        if (!condition || typeof condition !== 'object') return true;
        const fm = page.frontmatter || {};
        const html = page.htmlContent || '';

        if (condition.pageHtmlMatches != null) {
          const needles = Array.isArray(condition.pageHtmlMatches)
            ? condition.pageHtmlMatches
            : [condition.pageHtmlMatches];
          const anyHit = needles.some((n: string) => typeof n === 'string' && n.length > 0 && html.includes(n));
          if (!anyHit) return false;
        }
        if (condition.frontmatterHas != null) {
          if (typeof condition.frontmatterHas !== 'string') return false;
          if (!Object.prototype.hasOwnProperty.call(fm, condition.frontmatterHas)) return false;
        }
        return true;
      };

      const renderAssetList = (entries: AssetEntry[]) =>
        entries
          .filter(e => matchesCondition(e.condition))
          .map(e => e.gen(assetBaseUrl))
          .join('\n');

      const assetHeadHtml = renderAssetList(assetTags.head);
      const assetBodyHtml = renderAssetList(assetTags.body);

      const headInjections = await Promise.all(hooks.injectHead.map((fn: any) => fn(config, pageContext, relativePathToRoot)));
      const bodyInjections = await Promise.all(hooks.injectBody.map((fn: any) => fn(config, pageContext)));

      // Phase 1.B (T-S7): the framework does NOT auto-sanitize plugin output.
      // Plugins are npm-installed and audited per the trust model
      // (DEVELOPMENT-BENCHMARK.md §S4). The `sanitizeHeadInjection` helper
      // is exported from @docmd/utils and is available for plugins that want
      // to sanitise their own output, but the framework does not impose it.
      // Auto-sanitisation breaks legitimate scripts (e.g. Google Analytics'
      // self-closing <script src=...></script> tag) because no regex can
      // reliably distinguish a trusted analytics script from a malicious one.
      const fullHeadHtml = [
        headInjections.join('\n'),
        assetHeadHtml,
        generateHreflangTags(config, page.outputPath)
      ].join('\n');

      const fullBodyHtml = [
        assetBodyHtml,
        bodyInjections.join('\n')
      ].join('\n');

      // Source file path relative to srcDir
      const sourceRelative = path.relative(process.cwd(), page.sourcePath).replace(/\\/g, '/');

      // Compute edit URL from git plugin config (preferred) or legacy config.editLink
      let editUrl = null;
      const editLinkText = config.plugins?.git?.editLinkText || config.editLink?.text || t('editThisPage');
      const gitPluginConfig = config.plugins?.git;

      if (gitPluginConfig?.repo && gitPluginConfig?.editLink !== false) {
        // Git plugin config (modern approach)
        const gitRoot = getGitRoot();
        const editRelative = gitRoot
          ? path.relative(gitRoot, page.sourcePath).replace(/\\/g, '/')
          : sourceRelative;
        const repo = gitPluginConfig.repo.replace(/\/$/, '');
        const branch = gitPluginConfig.branch || 'main';
        const editPath = gitPluginConfig.editPath || 'edit';
        editUrl = `${repo}/${editPath}/${branch}/${editRelative}`;
      } else if (config.editLink?.enabled && config.editLink?.baseUrl) {
        // Legacy fallback
        const cleanBase = config.editLink.baseUrl.replace(/\/$/, '');
        const gitRoot = getGitRoot();
        const editRelative = gitRoot
          ? path.relative(gitRoot, page.sourcePath).replace(/\\/g, '/')
          : path.relative(path.resolve(process.cwd(), config.src || '.'), page.sourcePath).replace(/\\/g, '/');
        editUrl = `${cleanBase}/${editRelative}`;
      }

      // Navigation HTML
      const navigationHtml = await parser.renderTemplateAsync(templates.navigation, {
        config,
        navItems: config.navigation,
        currentPagePath: navPath,
        relativePathToRoot,
        outputPrefix,
        isOfflineMode: options.offline,
        buildRelativeUrl,
        t
      }, { filename: ui.getTemplatePath('navigation') });

      // Render Full Page
      // Template selection (new in 0.8.7): resolveTemplate() honours
      //   frontmatter.template > config.templates[glob] > config.theme.template > default
      // and falls back to the default layout if the resolved file is missing.
      // noStyle pages (no chrome) continue to use templates.noStyle as before.
      let templateString = templates.layout;
      let resolvedTemplateInfo: any = null;
      if (page.frontmatter.noStyle) {
        templateString = templates.noStyle;
      } else {
        try {
          const resolved = ui.resolveTemplate({
            type: 'layout',
            pagePath: page.outputPath,
            frontmatter: page.frontmatter,
            config,
            localeId: config._activeLocale?.id,
            versionId: config._activeVersion?.id,
          });
          if (resolved && resolved.templatePath) {
            templateString = await nativeFs.promises.readFile(resolved.templatePath, 'utf8');
            resolvedTemplateInfo = resolved;
          }
        } catch (e: any) {
          TUI.warn(`Template resolver failed for "${page.outputPath}" — falling back to default. ${e.message}`);
        }
      }
      const fullTitle = resolveTitle(
        page.frontmatter.title,
        config.title,
        config,
        page.frontmatter
      );
      const titleSeparator = resolveTitleSeparator(config, page.frontmatter);
      const titleAppend = resolveTitleAppend(config, page.frontmatter);

      let fullHtml = await parser.renderTemplateAsync(templateString, {
        content: page.htmlContent,
        rawMarkdown: page.rawMarkdown || '',
        frontmatter: page.frontmatter,
        headings: page.headings,
        config,
        buildHash,
        coreVersion: coreVersion || CORE_VERSION,
        siteTitle: config.title,
        pageTitle: page.frontmatter.title,
        fullTitle,
        titleSeparator,
        titleAppend,
        description: page.frontmatter.description || '',
        appearance: config.theme?.appearance || config.theme?.defaultMode || 'system',
        defaultMode: config.theme?.appearance || config.theme?.defaultMode || 'system',
        relativePathToRoot,
        isOfflineMode: options.offline,
        buildRelativeUrl,
        assetBaseUrl,
        emitBaseTag,
        navRootPrefix,
        navigationHtml,
        prevPage: fixNeighbor(prevPage),
        nextPage: fixNeighbor(nextPage),
        logo: config.logo,
        theme: config.theme,

        headerConfig: config.header,
        sidebarConfig: config.sidebar,
        footerConfig: config.footer,
        menubarConfig: config.menubar,
        optionsMenu: config.optionsMenu,

        customCssFiles: config.theme.customCss || [],
        customJsFiles: config.customJs || [],

        pluginHeadScriptsHtml: fullHeadHtml,
        pluginBodyScriptsHtml: fullBodyHtml,

        faviconLinkHtml: config.favicon 
          ? `<link id="site-favicon" rel="icon" href="${assetBaseUrl}${config.favicon.replace(/^\//, '')}?v=${buildHash}">`
          : `<link id="site-favicon" rel="icon" href="${assetBaseUrl}assets/favicon.ico?v=${buildHash}">`,
        themeInitScript,
        footerHtml,
        isActivePage: page.htmlContent && page.htmlContent.trim().length > 0,
        editUrl,
        editLinkText,
        breadcrumbs,
        sourceFile: sourceRelative,
        activeLocale: config._activeLocale || null,
        allLocales: config._allLocales || null,
        builtLocales: config._builtLocales ? [...config._builtLocales] : null,
        defaultLocale: config._defaultLocale || null,
        i18nInPlace: config.i18n?.inPlace || false,
        i18nStringMode: config.i18n?.stringMode || false,
        localePrefix: config._localeOutputPrefix || '',
        currentPagePath: navPath,
        outputPrefix,
        siteRootAbs,
        t,
        // the bound contextual variant produces file://-safe relative
        // URLs in offline mode (so version/language/project switcher links
        // resolve correctly from disk), and clean absolute URLs otherwise.
        buildAbsoluteUrl: buildAbsoluteUrlContextual,
        sanitizeUrl,
        workspace: config._workspace,
        themeCssLinkHtml: '',
        metaTagsHtml: '',
        pluginStylesHtml: '',
        // New in 0.8.7: resolved template metadata, available to the
        // template if it needs to know which template handled this page.
        _template: resolvedTemplateInfo,
      }, { filename: ui.getTemplatePath('layout') });

      const pageObj = {
        html: fullHtml,
        frontmatter: page.frontmatter,
        outputPath: page.outputPath,
        sourcePath: page.sourcePath,
        urls: pageUrls,
        urlContext,
        config
      };

      for (const fn of hooks.onPageReady) {
        await fn(pageObj);
      }

      fullHtml = pageObj.html;

      // ── Centralised <base href> enforcement (single source of truth) ──
      // The generator is the ONLY authority for the <base> tag. Templates
      // must not emit one themselves — anything they emit will be stripped
      // here and replaced with the canonical one computed from
      // (siteRootAbs, isOfflineMode). This way old templates, third-party
      // templates, and the default template all produce identical <base>
      // behaviour without any per-template logic to drift.
      //
      // Emit rules:
      //   isOfflineMode=true                          → no <base> (file://)
      //   siteRootAbs === '/'   (root deploy)         → no <base>
      //   siteRootAbs !== '/'   (subpath deploy)      → <base href="siteRootAbs">
      fullHtml = normaliseBaseTag(fullHtml, !!options.offline, siteRootAbs);

      // Queue the write
      writeQueue.push({ finalPath, html: fullHtml });
      (page as any).urls = pageUrls;
    }));
  }

  // --- 4. Parallel file writes ───────────────────────────────────
  // Write all rendered HTML files in batches for maximum I/O throughput
  for (let i = 0; i < writeQueue.length; i += WRITE_BATCH_SIZE) {
    const writeBatch = writeQueue.slice(i, i + WRITE_BATCH_SIZE);
    await Promise.all(
      writeBatch.map(async ({ finalPath, html }) => {
        await fs.ensureDir(path.dirname(finalPath));
        await nativeFs.promises.writeFile(finalPath, html);
      })
    );
  }

  return pages;
}