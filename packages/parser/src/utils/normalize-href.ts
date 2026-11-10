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

/**
 * Result of processing a href through the normaliser.
 */
export interface NormalizedHref {
  /** The cleaned, SEO-safe href */
  href: string;
  /** Whether the link should open in a new tab */
  isExternal: boolean;
  /** Whether the link should skip normalisation (raw file reference) */
  isRaw: boolean;
}

/**
 * Centralised internal href normaliser.
 *
 * Converts any user-written link format into a clean, SEO-optimised URL
 * that ends with a trailing slash (for directory-style pages) or is left
 * untouched (for external, hash-only, or asset links).
 *
 * Supports special prefixes:
 *   - `external:` - forces the link to open in a new tab (strips prefix)
 *   - `raw:` - bypasses normalisation (strips prefix, keeps extension)
 *
 * Supported input formats (all produce the same output):
 *   - overview.md          → overview/
 *   - overview             → overview/
 *   - overview/            → overview/
 *   - ./overview.md        → ./overview/
 *   - ../api/commands.md   → ../api/commands/
 *   - localisation/index.md  → localisation/
 *   - ./content/index.md     → ./content/
 *   - ../index.md            → ../
 *   - index.md               → (empty string - root of current dir)
 *   - /absolute/path.md      → /absolute/path/
 *   - #section               → #section (unchanged)
 *   - https://example.com    → https://example.com (unchanged, auto-external)
 *   - mailto:hi@docmd.io     → mailto:hi@docmd.io (unchanged)
 *   - external:overview.md   → overview/ (opens in new tab)
 *   - raw:docs/readme.md     → docs/readme.md (no normalisation)
 *
 * @param href  The raw href string from a markdown link, button, or nav config.
 * @returns     The normalised result with external/raw flags.
 */
export function resolveHref(href: string): NormalizedHref {
  if (!href) return { href, isExternal: false, isRaw: false };

  // 1. Handle `raw:` prefix - bypass all normalisation, keep extension
  if (href.startsWith('raw:')) {
    return { href: href.slice(4), isExternal: false, isRaw: true };
  }

  // 2. Handle `external:` prefix - normalise but flag as external
  // Users must explicitly use external: prefix to open in new tab
  let isExternal = false;
  if (href.startsWith('external:')) {
    href = href.slice(9);
    isExternal = true;
  }

  // 3. Auto-detect external protocols (only for detection, not for new-tab behavior)
  // This info can be used separately if needed, but we don't set isExternal here
  // to give users control over their own docs links

  // 4. Pass through: all protocols (mailto:, tel:, ftp:, etc.), hash-only, asset paths
  if (
    href.match(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i) ||  // http:, https:, mailto:, tel:, ftp:, //
    href.startsWith('#') ||
    href.match(/(^|\/)assets\//)
  ) {
    return { href, isExternal, isRaw: false };
  }

  // 5. Separate hash fragment
  let hash = '';
  const hashIndex = href.indexOf('#');
  if (hashIndex >= 0) {
    hash = href.substring(hashIndex);
    href = href.substring(0, hashIndex);
  }

  // 6. Strip .md, .html, .htm, and .ejs extensions
  if (href.endsWith('.md')) {
    href = href.slice(0, -3);
  } else if (href.endsWith('.html')) {
    href = href.slice(0, -5);
  } else if (href.endsWith('.htm')) {
    href = href.slice(0, -4);
  } else if (href.endsWith('.ejs')) {
    href = href.slice(0, -4);
  }

  // 6.5 Check for other file extensions. If present, treat as raw and do not normalise.
  const lastSlash = href.lastIndexOf('/');
  const filename = lastSlash >= 0 ? href.substring(lastSlash + 1) : href;
  const lastDot = filename.lastIndexOf('.');
  const hasUnmodifiedExtension = lastDot > 0 && lastDot < filename.length - 1;
  if (hasUnmodifiedExtension) {
    return { href: href + hash, isExternal, isRaw: true };
  }

  // 7. Strip trailing /index or /README (the page is the folder root)
  //    Handles: dir/index, ./dir/index, ../dir/index, /dir/index
  //    And:     dir/README, ./dir/README, ../dir/README, /dir/README
  //    Also handles bare "index" or "README" (root index)
  const lowerHref = href.toLowerCase();
  if (lowerHref === 'index' || lowerHref === './index' || lowerHref === 'readme' || lowerHref === './readme') {
    href = (lowerHref === 'index' || lowerHref === 'readme') ? '' : './';
  } else if (lowerHref.endsWith('/index')) {
    href = href.slice(0, -5); // "dir/index" → "dir/"
  } else if (lowerHref.endsWith('/readme')) {
    href = href.slice(0, -6); // "dir/readme" → "dir/"
  }

  // 8. Ensure trailing slash for non-empty paths
  //    But NOT for empty string (which represents current directory root)
  if (href !== '' && !href.endsWith('/')) {
    href += '/';
  }

  // 9. Collapse any accidental double slashes (preserve leading // caught above)
  href = href.replace(/([^:])\/{2,}/g, '$1/');

  return { href: href + hash, isExternal, isRaw: false };
}

/**
 * Process a link with context-aware relative path adjustments for subpages.
 */
export function processHref(rawLink: string, state: any): { href: string; isExternal: boolean } {
  const result = resolveHref(rawLink);
  let href = result.href;

  // `index.md#setup` resolves to `#setup`. That is a section of the folder
  // index, not an anchor on the current page, so a non-index page still needs
  // the depth shift. Only a link that was written as a hash skips it.
  const rawIsHashOnly = typeof rawLink === 'string' && rawLink.startsWith('#');
  if (!result.isRaw && !result.isExternal && !rawIsHashOnly) {
    let hashPart = '';
    let pathPart = href;
    const hashIdx = href.indexOf('#');
    if (hashIdx >= 0) {
      hashPart = href.substring(hashIdx);
      pathPart = href.substring(0, hashIdx);
    }

    const isProtocol = pathPart.match(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
    if (!isProtocol && !pathPart.startsWith('/') && state && state.env && state.env.isIndex === false) {
      if (pathPart.startsWith('./')) {
        pathPart = '../' + pathPart.substring(2);
      } else {
        // `index.md` / `README.md` normalise to '' (the current directory).
        // A non-index page is emitted one folder deeper, so that directory
        // is `../`, the same shift every other relative link gets.
        pathPart = '../' + pathPart;
      }
    }

    href = pathPart + hashPart;
  }

  return { href, isExternal: result.isExternal };
}

/**
 * Simplified normaliser for backward compatibility.
 * Returns only the normalised href string (no external/raw flags).
 * Used by navigation normalisation where external detection is handled separately.
 */
export function normalizeInternalHref(href: string): string {
  return resolveHref(href).href;
}

/**
 * Recursively normalises all `path` values in a navigation tree.
 * Used for nav config from `navigation.json`, `docmd.config.js`, and the auto-router.
 * 
 * Supports the `external:` prefix as a shorthand for `external: true`:
 *   { "path": "external:https://github.com" } → { "path": "https://github.com", "external": true }
 * 
 * The explicit `external: true` attribute is also supported and takes precedence.
 */
export function normalizeNavPaths(items: any[]): void {
  if (!items) return;
  for (const item of items) {
    if (item.path && typeof item.path === 'string') {
      const result = resolveHref(item.path);
      item.path = result.href;
      // If external: prefix was used, set the external flag (unless already explicitly set)
      if (result.isExternal && item.external !== false) {
        item.external = true;
      }
    }
    if (item.children) {
      normalizeNavPaths(item.children);
    }
  }
}

/**
 * Recursively normalises all `url` values in a menubar tree.
 * Applies the same trailing-slash enforcement and external detection as Markdown links.
 */
export function normalizeMenubarPaths(items: any[]): void {
  if (!items) return;
  for (const item of items) {
    if (item.url && typeof item.url === 'string') {
      const result = resolveHref(item.url);
      item.url = result.href;
      if (result.isExternal) item.external = true;
    }
    if (item.items) {
      normalizeMenubarPaths(item.items);
    }
  }
}

/**
 * Sanitize a URL by collapsing consecutive slashes (except after protocol).
 * This is the last-resort safety net - if upstream logic is correct, this
 * should be a no-op.
 *
 * @example
 *   sanitizeUrl('//docs//guide/')  → '/docs/guide/'
 *   sanitizeUrl('https://a.com//b') → 'https://a.com/b'
 */
export function sanitizeUrl(url: string): string {
  if (!url) return url;
  // Preserve a leading `scheme://` (e.g. `https://`) but collapse every other
  // run of consecutive slashes. A leading `//` must collapse too: browsers
  // treat `//host/path` as a protocol-relative URL pointing at a *different
  // host*, so an accidental `//search/` (from base + `/search`) would resolve
  // to `https://search/` instead of the intended same-site `/search/`.
  const scheme = url.match(/^[a-z][a-z0-9+.-]*:\/\//i);
  if (scheme) {
    return scheme[0] + url.slice(scheme[0].length).replace(/\/{2,}/g, '/');
  }
  return url.replace(/\/{2,}/g, '/');
}