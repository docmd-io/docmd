/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/parser
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * Centralised URL Utilities — single source of truth for all URL
 * transformations in the docmd ecosystem.
 *
 *   resolveHref()          ← normalize-href.ts (user href → clean path)
 *       ↓
 *   Build Engine           ← generator.ts (produces outputPath per page)
 *       ↓
 *   URL Utilities          ← THIS FILE
 *       ├── outputPathToSlug()        → "guide/"
 *       ├── outputPathToCanonical()   → "https://site.com/guide/"
 *       ├── buildContextualUrl()      → "../de/guide/" (relative, context-aware)
 *       ├── buildRootRelativeUrl()    → "../../guide/" (root-relative, no locale prefix)
 *       ├── rewriteHtmlLinks()        → post-process all <a>/<img> in rendered HTML
 *       ├── sanitizeUrl()             → collapse //, enforce trailing /
 *       └── createUrlContext()        → factory for page-level context
 */

import { sanitizeUrl } from './normalize-href.js';

export { sanitizeUrl };

// ─── Types ──────────────────────────────────────────────────────────

/** Immutable context for resolving URLs within a specific page render. */
export interface UrlContext {
  readonly relativePathToRoot: string;
  /** Locale + version prefix for the current build pass, e.g. `de/v1/` or `` */
  readonly outputPrefix: string;
  readonly offline: boolean;
  /** Site base path from config, e.g. `/docs/` or `/` */
  readonly base: string;
  /** Full site URL, e.g. `https://docmd.io` (no trailing slash) */
  readonly siteUrl: string;
  /** Relative path used for emitting asset URLs (equals relativePathToRoot). */
  readonly assetBaseUrl: string;
  /** Whether the renderer emits a `<base href>` tag. */
  readonly emitBase: boolean;
  /** Root-relative pathname of the current page, e.g. `/guide/` */
  readonly pathname?: string;
  /** Active project prefix in workspace, e.g. `/semantic` or `/` */
  readonly projectPrefix?: string;
  /** All workspace projects */
  readonly workspaceProjects?: readonly any[];
  /** Configured locale IDs for current build */
  readonly allLocales?: readonly string[];
}

/** Pre-computed URL data attached to every page object. */
export interface PageUrls {
  readonly slug: string;
  readonly canonical: string;
  readonly pathname: string;
}

// ─── Core Utilities ─────────────────────────────────────────────────

/**
 * Convert a build-engine outputPath to a clean directory-style slug.
 *
 * @example
 *   outputPathToSlug('guide/index.html')     → 'guide/'
 *   outputPathToSlug('index.html')            → '/'
 */
export function outputPathToSlug(outputPath: string): string {
  if (!outputPath) return '/';

  let slug = outputPath.replace(/\\/g, '/');

  if (slug === 'index.html') return '/';
  if (slug.endsWith('/index.html')) {
    slug = slug.slice(0, -10);
  } else if (slug.endsWith('.html')) {
    slug = slug.slice(0, -5) + '/';
  }

  if (slug !== '/' && !slug.endsWith('/')) {
    slug += '/';
  }

  return slug;
}

/** Convert outputPath to a root-relative pathname (always starts with `/`). */
export function outputPathToPathname(outputPath: string, base?: string): string {
  const slug = outputPathToSlug(outputPath);
  let pathname = slug.startsWith('/') ? slug : '/' + slug;
  if (base && base !== '/') {
    let b = base.trim();
    if (!b.startsWith('/')) b = '/' + b;
    if (!b.endsWith('/')) b = b + '/';
    b = b.replace(/([^:])\/{2,}/g, '$1/');
    pathname = (b + pathname).replace(/\/+/g, '/');
  }
  return pathname;
}

/** Convert outputPath to a full canonical URL. */
export function outputPathToCanonical(outputPath: string, siteUrl: string, base?: string): string {
  if (!siteUrl) return '';
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '');
  const pathname = outputPathToPathname(outputPath, base);
  return sanitizeUrl(cleanSiteUrl + pathname);
}

/**
 * Build a context-aware relative URL from a clean href.
 *
 * Handles: relativePathToRoot, outputPrefix, offline mode, base path,
 * workspace project routing, hash-only anchors, external pass-through.
 */
export function buildContextualUrl(href: string, context: UrlContext): string {
  if (href === '#' || href === undefined || href === null) return '#';

  // Strip `external:` prefix that plugins may pass through
  if (href.startsWith('external:')) {
    href = href.slice('external:'.length);
  }

  // External / protocol URLs pass through unchanged
  if (href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:')) {
    return href;
  }

  // Hash-only anchors pass through unchanged
  if (href.startsWith('#')) return href;

  // Separate hash fragment
  let hash = '';
  const hashIdx = href.indexOf('#');
  if (hashIdx >= 0) {
    hash = href.substring(hashIdx);
    href = href.substring(0, hashIdx);
  }

  const isAsset = href.match(/(^|\/)assets\//);
  const isPageRelative = !href.startsWith('/') && !isAsset;

  // Workspace project routing: intercept root-relative links that match
  // a known project prefix and resolve them cross-project.
  const isBareRootInSubproject = (href === '/' || href === '/index.html')
    && context.projectPrefix && context.projectPrefix !== '/';
  if (href.startsWith('/') && !isAsset && !isBareRootInSubproject && context.workspaceProjects && context.workspaceProjects.length > 0) {
    const matchingProject = [...context.workspaceProjects]
      .sort((a, b) => b.prefix.length - a.prefix.length)
      .find(p => {
        if (p.prefix === '/') {
          return href === '/' || href === '/index.html';
        }
        const normPrefix = p.prefix.replace(/\/$/, '') + '/';
        const normHref = href.endsWith('/') ? href : href + '/';
        return normHref.startsWith(normPrefix) || href === p.prefix;
      });

    if (matchingProject) {
      const targetSubPath = href.substring(matchingProject.prefix === '/' ? 0 : matchingProject.prefix.length).replace(/^\//, '');
      const isCurrentProject = matchingProject.prefix === context.projectPrefix;

      let relPath = context.relativePathToRoot;
      if (!isCurrentProject) {
        const currentPfx = context.projectPrefix === '/' ? '' : context.projectPrefix.replace(/^\//, '').replace(/\/$/, '');
        if (currentPfx) {
          relPath += '../'.repeat(currentPfx.split('/').length);
        }
        const targetPfx = matchingProject.prefix === '/' ? '' : matchingProject.prefix.replace(/^\//, '').replace(/\/$/, '') + '/';
        relPath += targetPfx;
      }

      let combinedSubPath = targetSubPath;
      if (context.outputPrefix) {
        const prefixStr = context.outputPrefix.replace(/\/$/, '');
        let alreadyHasPrefix = false;
        if (prefixStr) {
          if (targetSubPath === prefixStr || targetSubPath.startsWith(prefixStr + '/')) {
            alreadyHasPrefix = true;
          } else if (context.allLocales && context.allLocales.length > 0) {
            const firstSegment = targetSubPath.split('/')[0];
            if (context.allLocales.includes(firstSegment)) {
              alreadyHasPrefix = true;
            }
          }
        }
        combinedSubPath = (prefixStr && !alreadyHasPrefix)
          ? (targetSubPath ? prefixStr + '/' + targetSubPath : prefixStr + '/')
          : targetSubPath;
      }

      let combined = relPath + combinedSubPath;
      if (context.offline) {
        combined = appendIndexHtml(combined);
      }
      return sanitizeUrl(combined + hash);
    }
  }

  // Strip leading ./ and / to get a clean path
  const cleanPath = href.replace(/^(\.\/|\/)+/, '');

  // Prepend outputPrefix for root-relative paths (locale/version scoping)
  let combinedPath = cleanPath;
  if (!isPageRelative && !isAsset) {
    const prefixStr = context.outputPrefix ? context.outputPrefix.replace(/\/$/, '') : '';
    let alreadyHasPrefix = false;
    if (prefixStr) {
      if (cleanPath === prefixStr || cleanPath.startsWith(prefixStr + '/')) {
        alreadyHasPrefix = true;
      } else if (context.allLocales && context.allLocales.length > 0) {
        const firstSegment = cleanPath.split('/')[0];
        if (context.allLocales.includes(firstSegment)) {
          alreadyHasPrefix = true;
        }
      }
    }
    combinedPath = (prefixStr && !alreadyHasPrefix)
      ? (cleanPath ? prefixStr + '/' + cleanPath : prefixStr + '/')
      : cleanPath;
  }

  // Offline: append /index.html for file:// browsing
  if (context.offline) {
    combinedPath = appendIndexHtml(combinedPath);
  }

  // Build final relative URL
  let result = combinedPath + hash;
  if (!isPageRelative) {
    result = context.relativePathToRoot + combinedPath + hash;
  } else if (context.relativePathToRoot === './') {
    result = './' + combinedPath + hash;
  }

  return sanitizeUrl(result);
}

/**
 * Build a root-relative URL preserving active locale/version context.
 */
export function buildRootRelativeUrl(href: string, context: UrlContext): string {
  return buildContextualUrl(href, context);
}

/**
 * Strip the default-locale prefix from absolute `<a href>` URLs.
 * e.g. `/en/foo` → `/foo` when `en` is the default locale (served at root).
 */
export function stripDefaultLocalePrefixFromHtml(html: string, defaultLocale: string): string {
  if (!defaultLocale) return html;
  const escaped = defaultLocale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(<a\\s+[^>]*?\\bhref\\s*=\\s*)(["'])(\\/${escaped}\\/)([^"'#]*)\\2`, 'gi');
  return html.replace(re, (_full, prefix, quote, _stripped, rest) => {
    return `${prefix}${quote}/${rest}${quote}`;
  });
}

/**
 * Post-process all `<a href>` and `<img src>` in rendered HTML through
 * `buildRootRelativeUrl`. Single HTML rewrite pass for user-authored content.
 */
export function rewriteHtmlLinks(
  html: string,
  context: UrlContext,
  opts?: { defaultLocale?: string | null; allLocales?: readonly string[] }
): string {
  // Strip default-locale prefix when multi-locale
  if (opts?.defaultLocale && opts?.allLocales && opts.allLocales.length >= 2) {
    html = stripDefaultLocalePrefixFromHtml(html, opts.defaultLocale);
  }

  // Walk every <a href> and <img src>, route through root-relative URL builder
  html = html.replace(
    /<(a|img)\s+([^>]*?)\b(href|src)\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>/gi,
    (full, _tag, _pre, _attr, quoted, dq, sq) => {
      const url = dq !== undefined ? dq : sq;
      const fixed = buildRootRelativeUrl(url, context);
      if (fixed === url) return full;
      const q = quoted.charAt(0);
      return full.replace(quoted, q + fixed + q);
    }
  );

  return html;
}

/** Create a UrlContext for a specific page render. */
export function createUrlContext(options: {
  relativePathToRoot: string;
  outputPrefix?: string;
  offline?: boolean;
  base?: string;
  siteUrl?: string;
  pathname?: string;
  projectPrefix?: string;
  workspaceProjects?: readonly any[];
  allLocales?: readonly string[];
}): UrlContext {
  const relativePathToRoot = options.relativePathToRoot || './';
  const base = options.base || '/';
  return Object.freeze({
    relativePathToRoot,
    outputPrefix: options.outputPrefix || '',
    offline: options.offline || false,
    base,
    siteUrl: (options.siteUrl || '').replace(/\/+$/, ''),
    assetBaseUrl: relativePathToRoot,
    emitBase: false,
    pathname: options.pathname,
    projectPrefix: options.projectPrefix || '',
    workspaceProjects: (options.workspaceProjects && options.workspaceProjects.length > 0) ? options.workspaceProjects : [{ prefix: '/', title: 'Root' }],
    allLocales: options.allLocales || [],
  });
}

/** Compute pre-built URL data for a page. */
export function computePageUrls(outputPath: string, siteUrl: string, base?: string): PageUrls {
  return Object.freeze({
    slug: outputPathToSlug(outputPath),
    canonical: outputPathToCanonical(outputPath, siteUrl, base),
    pathname: outputPathToPathname(outputPath, base),
  });
}

/**
 * Build an absolute URL from base + locale + version + page path.
 * Used by version-dropdown and language-switcher templates.
 */
export function buildAbsoluteUrl(
  base: string,
  localePrefix: string = '',
  versionPrefix: string = '',
  pagePath: string = ''
): string {
  const normalizedBase = base.endsWith('/') ? base : base + '/';
  const result = normalizedBase + localePrefix + versionPrefix + pagePath;
  return sanitizeUrl(result);
}

/**
 * Context-aware `buildAbsoluteUrl` for cross-locale/version navigation.
 *
 * Non-offline: returns a clean absolute path (`/de/v1/guide/`).
 * Offline: returns a relative file://-safe path with index.html suffix.
 */
export function buildAbsoluteContextualUrl(
  base: string,
  localePrefix: string = '',
  versionPrefix: string = '',
  pagePath: string = '',
  context?: UrlContext
): string {
  if (!context) {
    return buildAbsoluteUrl(base, localePrefix, versionPrefix, pagePath);
  }

  // Calculate workspace base by stripping projectPrefix
  let workspaceBase = context.base;
  if (context.projectPrefix && context.projectPrefix !== '/') {
    const normalizedBaseContext = context.base.replace(/\/?$/, '');
    const normalizedProjPfx = context.projectPrefix.replace(/^\//, '').replace(/\/?$/, '');
    if (normalizedProjPfx && normalizedBaseContext.endsWith(normalizedProjPfx)) {
      workspaceBase = normalizedBaseContext.substring(0, normalizedBaseContext.length - normalizedProjPfx.length).replace(/\/?$/, '/');
    }
  }

  // Build absolute target and strip workspace base prefix
  const normalizedBase = base.endsWith('/') ? base : base + '/';
  const absoluteTarget = normalizedBase + localePrefix + versionPrefix + pagePath;
  let cleanPath = absoluteTarget;
  if (workspaceBase && workspaceBase !== '/' && cleanPath.startsWith(workspaceBase)) {
    cleanPath = cleanPath.substring(workspaceBase.length);
    if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
  }

  // Compute depth from current page to workspace root
  const projectPfxSegments = (context.projectPrefix && context.projectPrefix !== '/')
    ? context.projectPrefix.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean).length
    : 0;
  const relRootSegments = context.relativePathToRoot
    ? context.relativePathToRoot.split('/').filter(s => s === '..').length
    : 0;
  const totalDepth = relRootSegments + projectPfxSegments;
  const toWorkspaceRoot = totalDepth > 0 ? '../'.repeat(totalDepth) : './';

  let targetPath = cleanPath.replace(/^\//, '');

  if (context.offline) {
    targetPath = appendIndexHtml(targetPath);
  }

  return sanitizeUrl(toWorkspaceRoot + targetPath);
}

/**
 * Normalise the `<base href>` tag in a fully-rendered HTML document.
 * Strips all existing <base> tags (the generator is the single authority).
 */
export function normaliseBaseTag(html: string, isOffline: boolean, siteRootAbs: string): string {
  const BASE_TAG_RE = /<base\b[^>]*\/?>\s*/gi;
  return html.replace(BASE_TAG_RE, '');
}

// ─── Internal Helpers ───────────────────────────────────────────────

/** Append /index.html for offline file:// browsing. */
function appendIndexHtml(path: string): string {
  if (path === '' || path.endsWith('/')) {
    return path + 'index.html';
  }
  if (!path.endsWith('.html') && !path.endsWith('.htm')) {
    const lastSlash = path.lastIndexOf('/');
    const filename = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    const lastDot = filename.lastIndexOf('.');
    const hasExt = lastDot > 0 && lastDot < filename.length - 1;
    if (!hasExt) {
      return path + '/index.html';
    }
  }
  return path;
}

/** Minimal attribute-value escaper for HTML attributes. */
function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}