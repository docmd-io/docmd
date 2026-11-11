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
import { fsUtils as fs } from '@docmd/utils';
import esbuild from 'esbuild';
import { createRequire } from 'module';
import nativeFs from 'fs';
import type { Asset, AssetKind, ResolvedAsset, TemplateAssetHook } from '@docmd/api';

const _require = createRequire(import.meta.url);
import * as themes from '@docmd/themes';
import * as ui from '@docmd/ui';

const pkgUrl = new URL('../../package.json', import.meta.url);
const pkg = JSON.parse(nativeFs.readFileSync(pkgUrl, 'utf8'));

const COPYRIGHT_BANNER = `/*!
 * docmd (v${pkg.version})
 * Copyright (c) 2025-present docmd.io
 * License: MIT
 */`;

/**
 * An exclude pattern and the directory it is relative to: the directory of
 * the .gitignore it came from, or the project directory for `config.exclude`.
 * Unanchored patterns are matched against the path below `base` only, never
 * against the directories above it.
 */
interface ExcludePattern {
  pattern: string;
  base: string;
}

/**
 * Cache for parsed .gitignore patterns per root directory.
 */
const _gitignoreCache = new Map<string, ExcludePattern[]>();

/**
 * Read and parse .gitignore files up the directory tree from startDir.
 */
function getGitignorePatterns(startDir: string): ExcludePattern[] {
  const root = path.resolve(startDir);
  if (_gitignoreCache.has(root)) {
    return _gitignoreCache.get(root)!;
  }

  const patterns: ExcludePattern[] = [];
  const seenFiles = new Set<string>();
  let current: string | null = root;
  while (current) {
    const gitignorePath = path.join(current, '.gitignore');
    if (!seenFiles.has(gitignorePath)) {
      seenFiles.add(gitignorePath);
      try {
        if (nativeFs.existsSync(gitignorePath)) {
          const content = nativeFs.readFileSync(gitignorePath, 'utf8');
          for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            patterns.push({ pattern: trimmed, base: current });
          }
        }
      } catch {
        // Ignore read errors
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Also check process.cwd() if not reached
  const cwdGitignore = path.join(process.cwd(), '.gitignore');
  if (!seenFiles.has(cwdGitignore) && nativeFs.existsSync(cwdGitignore)) {
    try {
      const content = nativeFs.readFileSync(cwdGitignore, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        patterns.push({ pattern: trimmed, base: process.cwd() });
      }
    } catch {
      // Ignore read errors
    }
  }

  _gitignoreCache.set(root, patterns);
  return patterns;
}

/**
 * Check if a file or directory matches gitignore / exclude patterns.
 */
function isExcludedPath(fullPath: string, name: string, patterns: ExcludePattern[], projectRoot?: string): boolean {
  if (patterns.length === 0) return false;
  const normalizedPath = fullPath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot ? path.resolve(projectRoot).replace(/\\/g, '/') : null;

  for (const { pattern: pat, base } of patterns) {
    // Detect anchored patterns (leading '/') — in gitignore, '/' means relative to the
    // directory containing the .gitignore, not the absolute filesystem path.
    const isAnchored = pat.startsWith('/');
    let start = 0;
    let end = pat.length;
    while (start < end && pat.charCodeAt(start) === 47 /* '/' */) start++;
    while (end > start && pat.charCodeAt(end - 1) === 47 /* '/' */) end--;
    const cleanPat = pat.slice(start, end);
    if (!cleanPat) continue;

    if (isAnchored && normalizedRoot) {
      // For anchored patterns, match only against the path relative to the project root.
      // This prevents '/airo' from matching '/Users/someone/github/airo/docs/page.md'.
      const relPath = normalizedPath.startsWith(normalizedRoot + '/')
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : null;
      if (!relPath) continue;

      if (relPath === cleanPat || relPath.startsWith(cleanPat + '/')) return true;

      // Anchored wildcard match
      if (cleanPat.includes('*')) {
        try {
          const regexStr = cleanPat
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*');
          const re = new RegExp(`^${regexStr}(/|$)`);
          if (re.test(relPath)) return true;
        } catch {
          // Ignore regex failure
        }
      }
      // Anchored patterns must not fall through to unanchored checks
      continue;
    }

    // Non-anchored pattern checks (match anywhere below the pattern's base).
    // The directories above the base are not part of the match: with the
    // project at /srv/site, the pattern `site/` must not hide every page.
    const normalizedBase = path.resolve(base).replace(/\\/g, '/');
    const scopedPath = normalizedPath.startsWith(normalizedBase + '/')
      ? normalizedPath.slice(normalizedBase.length)
      : null;

    // Exact name match (e.g. 'drafts' or 'secret.md')
    if (name === cleanPat) return true;

    // Suffix wildcard (e.g. '*.tmp.md' or '*.draft')
    if (cleanPat.startsWith('*.')) {
      const ext = cleanPat.slice(1);
      if (name.endsWith(ext)) return true;
    }

    // Prefix wildcard (e.g. 'draft-*')
    if (cleanPat.endsWith('*') && !cleanPat.includes('/')) {
      const prefix = cleanPat.slice(0, -1);
      if (name.startsWith(prefix)) return true;
    }

    // Directory segment match (e.g. 'drafts' anywhere below the base)
    if (scopedPath !== null && (scopedPath.includes(`/${cleanPat}/`) || scopedPath.endsWith(`/${cleanPat}`))) {
      return true;
    }

    // General glob wildcard match
    if (cleanPat.includes('*')) {
      try {
        const regexStr = cleanPat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*');
        const re = new RegExp(`(^|/)${regexStr}(/|$)`);
        if ((scopedPath !== null && re.test(scopedPath)) || re.test(name)) return true;
      } catch {
        // Ignore regex failure
      }
    }
  }
  return false;
}

/**
 * The single "is this entry hidden from doc discovery" predicate shared by
 * findFilesRecursive (list_docs/search_docs/build) and MCP read_doc.
 * `dir` is the directory that contains the entry `name`.
 */
export function isDocEntryHidden(dir: string, name: string, extraExclude: string[], projectRoot: string): boolean {
  // Explicitly ignore system files, git, node_modules, and standard build/temp dirs
  if (
    name === 'node_modules' ||
    name.startsWith('.') ||
    name === 'site' ||
    name === 'dist' ||
    name === '_docmd-search'
  ) {
    return true;
  }
  // Filter out items matching .gitignore or user-configured exclude patterns
  // config.exclude is relative to the project directory; a source dir
  // outside it falls back to the scan root.
  const cwd = path.resolve(process.cwd());
  const inCwd = path.resolve(dir) === cwd || path.resolve(dir).startsWith(cwd + path.sep);
  const excludeBase = inCwd ? cwd : path.resolve(projectRoot);
  const allExcludes: ExcludePattern[] = [
    ...extraExclude.map((pattern) => ({ pattern, base: excludeBase })),
    ...getGitignorePatterns(dir),
  ];
  return isExcludedPath(path.join(dir, name), name, allExcludes, projectRoot);
}

export async function findFilesRecursive(
  dir: string,
  extensions: string[],
  extraExclude: string[] = [],
  _projectRoot?: string
): Promise<string[]> {
  // Track the top-level source root so anchored gitignore patterns are resolved
  // relative to it rather than the absolute filesystem path.
  const projectRoot = _projectRoot ?? dir;
  let files: string[] = [];
  if (!await fs.exists(dir)) return [];

  const items = await nativeFs.promises.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (isDocEntryHidden(dir, item.name, extraExclude, projectRoot)) {
      continue;
    }

    if (item.isDirectory()) {
      files = files.concat(await findFilesRecursive(fullPath, extensions, extraExclude, projectRoot));
    } else if (item.isFile()) {
      if (!extensions || extensions.includes(path.extname(item.name))) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

export async function prepareAssets(config: any, outputDir: string, options: any = {}) {
  const CWD = process.cwd();

  // 1. Core UI Assets
  const uiAssets = ui.getAssetsDir();
  if (await fs.exists(uiAssets)) await fs.copy(uiAssets, path.join(outputDir, 'assets'));

  // When stringMode is enabled, translations are baked into HTML at
  // build time. The client-side i18n runtime (docmd-i18n-strings.js) is
  // redundant and harmful — it reads/writes localStorage for locale
  // preferences which can cause client-side re-translation of already-
  // baked HTML. Remove it from the output so it's never fetched.
  if (config.i18n?.stringMode === true) {
    const i18nRuntimePath = path.join(outputDir, 'assets', 'js', 'docmd-i18n-strings.js');
    if (nativeFs.existsSync(i18nRuntimePath)) {
      nativeFs.unlinkSync(i18nRuntimePath);
    }
  }

  // 2. Theme Assets
  const themesDir = themes.getThemesDir();
  if (await fs.exists(themesDir)) await fs.copy(themesDir, path.join(outputDir, 'assets/css'));

  // 3. User Assets (Root)
  const userAssets = path.resolve(CWD, 'assets');
  if (await fs.exists(userAssets)) await fs.copy(userAssets, path.join(outputDir, 'assets'));

  // 3.5. User Assets (Docs Dir)
  if (config.src) {
    const srcAssets = path.resolve(CWD, config.src, 'assets');
    if (await fs.exists(srcAssets)) await fs.copy(srcAssets, path.join(outputDir, 'assets'));
  }

  // 4. Minification (Production only)
  if (config.minify !== false && !options.isDev) {
    await minifyDir(path.join(outputDir, 'assets'));
  }
}

type AssetHook = (() => Asset[] | Promise<Asset[]>) & { _pluginName?: string };

interface BuildAssetHooks {
  assets?: AssetHook[];
  templateAssets?: Array<TemplateAssetHook & { _pluginName?: string }>;
}

function effectivePosition(asset: Asset, type: AssetKind): 'head' | 'body' | 'none' {
  if (type === 'static') return 'none';
  // Prefer the legacy alias when both are present so existing plugins retain
  // the placement that generator.ts historically used.
  const declared = asset.location ?? asset.position;
  if (declared === 'none') return 'none';
  if (declared === 'head') return 'head';
  // `footer` has historically shared the body injection bucket.
  if (declared === 'body' || declared === 'footer') return 'body';
  // Plugin assets historically default to the body, including CSS.
  return 'body';
}

function isExternalUrl(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function freezeResolvedAsset(asset: ResolvedAsset): ResolvedAsset {
  const condition = asset.condition
    ? Object.freeze({
        ...asset.condition,
        ...(Array.isArray(asset.condition.pageHtmlMatches)
          ? { pageHtmlMatches: Object.freeze([...asset.condition.pageHtmlMatches]) }
          : {})
      })
    : undefined;
  const attributes = asset.attributes ? Object.freeze({ ...asset.attributes }) : undefined;

  return Object.freeze({
    ...asset,
    provider: Object.freeze({ ...asset.provider }),
    ...(attributes ? { attributes } : {}),
    ...(condition ? { condition } : {})
  });
}

/**
 * Resolve template and plugin asset declarations once for a build.
 *
 * The returned snapshot is deeply frozen because every post-build hook sees
 * the same value. It intentionally excludes core/theme/user directories and
 * files created later by post-build hooks; it is an asset declaration catalog,
 * not an output-directory manifest.
 */
export async function resolveBuildAssets(hooks: BuildAssetHooks): Promise<readonly ResolvedAsset[]> {
  const resolved: ResolvedAsset[] = [];

  for (const asset of hooks.templateAssets || []) {
    if (!asset?.path || (asset.type !== 'css' && asset.type !== 'js')) continue;
    resolved.push(freezeResolvedAsset({
      kind: 'file',
      type: asset.type,
      sourcePath: path.resolve(asset.path),
      outputPath: path.join('assets', 'template', path.basename(asset.path)).replace(/\\/g, '/'),
      priority: typeof asset.priority === 'number' ? asset.priority : 10,
      position: asset.position === 'head' || (!asset.position && asset.type === 'css') ? 'head' : 'body',
      provider: { kind: 'template', name: asset._pluginName || 'template' }
    }));
  }

  for (const getAssets of hooks.assets || []) {
    const assets = await getAssets();
    if (!Array.isArray(assets)) continue;

    for (const asset of assets) {
      if (!asset || (asset.type !== 'css' && asset.type !== 'js' && asset.type !== 'static')) continue;
      // Legacy aliases keep precedence because the two pre-resolver consumers
      // did the same when copying local files.
      const sourcePath = asset.src ?? asset.path;
      const outputPath = asset.dest ?? (asset.url && !isExternalUrl(asset.url) ? asset.url : undefined);
      const common = {
        type: asset.type,
        priority: typeof asset.priority === 'number' ? asset.priority : 20,
        position: effectivePosition(asset, asset.type),
        provider: { kind: 'plugin' as const, name: getAssets._pluginName || 'plugin' },
        ...(asset.attributes ? { attributes: asset.attributes } : {}),
        ...(asset.condition ? { condition: asset.condition } : {})
      };

      if (typeof sourcePath === 'string' && sourcePath && typeof outputPath === 'string' && outputPath) {
        resolved.push(freezeResolvedAsset({
          ...common,
          kind: 'file',
          sourcePath: path.resolve(sourcePath),
          outputPath
        }));
      } else if ((asset.type === 'css' || asset.type === 'js') && typeof asset.url === 'string' && asset.url) {
        resolved.push(freezeResolvedAsset({
          ...common,
          kind: 'url',
          type: asset.type,
          url: asset.url
        }));
      }
    }
  }

  return Object.freeze(resolved);
}

/** Copy every local entry from a previously resolved asset snapshot. */
export async function copyResolvedAssets(assets: readonly ResolvedAsset[], outputDir: string) {
  for (const asset of assets) {
    if (asset.kind !== 'file') continue;
    let sourcePath = asset.sourcePath;
    if (asset.provider.kind === 'template' && !await fs.exists(sourcePath)) {
      const slug = String(asset.provider.name || '').replace(/^@docmd\//, '').replace(/^template-/, '');
      const monorepoDist = path.resolve(__dirname, '../../..', 'templates', slug, 'dist/assets', asset.type, path.basename(sourcePath));
      const monorepoSrc = path.resolve(__dirname, '../../..', 'templates', slug, 'assets', asset.type, path.basename(sourcePath));
      if (await fs.exists(monorepoDist)) {
        sourcePath = monorepoDist;
      } else if (await fs.exists(monorepoSrc)) {
        sourcePath = monorepoSrc;
      } else {
        continue;
      }
    }
    const destPath = path.join(outputDir, asset.outputPath);
    await fs.ensureDir(path.dirname(destPath));

    // Preserve the existing plugin-copy behaviour: vendored JavaScript often
    // points at source maps that packages do not ship. Template JS was copied
    // verbatim before the shared resolver and remains so.
    if (asset.provider.kind === 'plugin' && asset.outputPath.endsWith('.js')) {
      try {
        const content = await fs.readFile(sourcePath, 'utf8');
        const stripped = content.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '');
        await fs.writeFile(destPath, stripped);
      } catch {
        await fs.copy(sourcePath, destPath);
      }
    } else {
      await fs.copy(sourcePath, destPath);
    }
  }
}

async function minifyDir(dir: string) {
  const assets = await findFilesRecursive(dir, ['.css', '.js']);
  for (const file of assets) {
    if (file.endsWith('.min.js') || file.endsWith('.min.css')) continue;
    try {
      const ext = path.extname(file);
      const content = await nativeFs.promises.readFile(file, 'utf8');
      const result = await esbuild.transform(content, {
        loader: ext.slice(1) as any,
        minify: true,
        legalComments: 'none'
      });
      await nativeFs.promises.writeFile(file, COPYRIGHT_BANNER + '\n' + result.code);
    } catch {
      // Ignore errors for non-standard files or mixed content
    }
  }
}

// Generate HTML Tag Helper
export function generateAssetTag(pathOrUrl: string, type: string, attributes: any = {}) {
  const attrs = Object.entries(attributes).map(([k, v]) => v === true ? k : `${k}="${v}"`).join(' ');
  if (type === 'css') return `<link rel="stylesheet" href="${pathOrUrl}" ${attrs}>`;
  if (type === 'js') return `<script src="${pathOrUrl}" ${attrs}></script>`;
  return '';
}
