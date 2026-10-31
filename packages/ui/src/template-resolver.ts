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

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hooks,
  type TemplateSlot,
  type TemplateResolutionContext,
  type ResolvedTemplate,
} from '@docmd/api';

// Re-export the public types so consumers can `import { ResolvedTemplate } from '@docmd/ui'`.
export type { TemplateSlot, TemplateHook, TemplateResolutionContext, ResolvedTemplate } from '@docmd/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Default template location (this package ships the default theme).
// ---------------------------------------------------------------------------

/** Directory containing the default `.ejs` templates shipped with @docmd/ui. */
const DEFAULT_TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/** Files in the default templates dir, keyed by slot (file name without `.ejs`). */
function readDefaultTemplate(slot: TemplateSlot): string | null {
  // The default templates are stored at <pkg>/templates/<slot>.ejs,
  // except partials which live under <pkg>/templates/partials/<slot>.ejs.
  const candidates = [
    path.join(DEFAULT_TEMPLATES_DIR, `${slot}.ejs`),
    path.join(DEFAULT_TEMPLATES_DIR, 'partials', `${slot}.ejs`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Glob matching (tiny, no external dependency)
// ---------------------------------------------------------------------------

/** Convert a simple glob to a RegExp. Supports `*`, `**`, and `?`. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        // Eat following `/` so `**/` doesn't match an empty segment twice.
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesAny(input: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return true;
  for (const g of globs) {
    if (globToRegExp(g).test(input)) return true;
  }
  return false;
}

function matchesNone(input: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return true;
  for (const g of globs) {
    if (globToRegExp(g).test(input)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Normalisation of the `template` value
// ---------------------------------------------------------------------------

/**
 * A template reference is either:
 *  - a string (the plugin's package name, e.g. "@docmd/template-summer" or "summer")
 *  - an object `{ name, pages?, exclude? }`
 */
type TemplateRef = string | { name: string; pages?: string[]; exclude?: string[] };

function normaliseTemplateRef(ref: any): { name: string; pages?: string[]; exclude?: string[] } | null {
  if (!ref) return null;
  if (typeof ref === 'string') return { name: ref };
  if (typeof ref === 'object' && typeof ref.name === 'string') return ref;
  return null;
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolve which `.ejs` file should be used for a given slot on a given page.
 *
 * Resolution order:
 *   1. `frontmatter.template` (per-page override, wins everything)
 *   2. `config.templates` per-section map (e.g. `{ "blog/*": "template-blog" }`)
 *   3. `config.theme.template` (site-wide default)
 *   4. Built-in default from `@docmd/ui`
 *
 * Any step may be skipped. If a step produces a name that does not match a
 * registered template, the resolver moves on to the next step. If the
 * resolved file does not exist on disk, the resolver falls back to the
 * default and emits a TUI warning once per build.
 *
 * @example
 *   const tpl = resolveTemplate('layout', {
 *     type: 'layout',
 *     pagePath: '/guide/intro.html',
 *     frontmatter: page.frontmatter,
 *     config: normalizedConfig,
 *   });
 *   // → { templatePath: '/abs/path/to/templates/summer/layout.ejs', source: 'plugin', ... }
 */
export function resolveTemplate(ctx: TemplateResolutionContext): ResolvedTemplate {
  const { type, pagePath, frontmatter, config } = ctx;

  // Strip leading "./" for matching.
  const pathKey = (pagePath || '').replace(/^\.\//, '/').replace(/^\/+/, '/');

  // The reference (string or object) that points at a template plugin name.
  const candidates: { ref: ReturnType<typeof normaliseTemplateRef>; source: ResolvedTemplate['source'] }[] = [
    { ref: normaliseTemplateRef(frontmatter?.template),        source: 'frontmatter' },
    { ref: matchSectionTemplate(config?.templates, pathKey),  source: 'config' },
    { ref: normaliseTemplateRef(config?.theme?.template),     source: 'config' },
  ];

  for (const { ref, source } of candidates) {
    if (!ref || !ref.name) continue;

    // 1. Look for a registered template plugin that ships this slot.
    const pluginMatch = findPluginTemplate(type, ref.name, pathKey);
    if (pluginMatch) {
      let resolvedPath = pluginMatch.templatePath;
      if (!fs.existsSync(resolvedPath)) {
        const altDist = resolvedPath.replace('/templates/', '/dist/templates/');
        const altRoot = resolvedPath.replace('/dist/templates/', '/templates/');
        if (fs.existsSync(altDist)) {
          resolvedPath = altDist;
        } else if (fs.existsSync(altRoot)) {
          resolvedPath = altRoot;
        }
      }
      if (!fs.existsSync(resolvedPath)) {
        const slug = String(ref.name || '').replace(/^@docmd\//, '').replace(/^template-/, '');
        const monorepoCandidate = path.resolve(__dirname, '../../templates', slug, 'templates', `${type}.ejs`);
        if (fs.existsSync(monorepoCandidate)) {
          resolvedPath = monorepoCandidate;
        }
      }
      if (fs.existsSync(resolvedPath)) {
        return { ...pluginMatch, templatePath: resolvedPath, source, type };
      }
      warnMissingOnce(pluginMatch.templatePath, ref.name, type);
      // File declared but missing on disk — fall through to default.
      break;
    }

    // 2. No plugin matched. If the ref explicitly named a slot override path
    //    (advanced), allow resolving against the default templates dir.
    if (ref.name.startsWith('./') || ref.name.startsWith('/')) {
      const abs = path.isAbsolute(ref.name) ? ref.name : path.join(process.cwd(), ref.name);
      if (fs.existsSync(abs)) {
        return { templatePath: abs, source, type };
      }
    }
  }

  // 3. Default fallback.
  const defaultPath = readDefaultTemplate(type);
  if (!defaultPath) {
    // Should never happen for known slots, but fail loudly rather than crash.
    throw new Error(
      `[docmd/template] No default template found for slot "${type}". ` +
      `This is an internal error — please report it at https://github.com/docmd-io/docmd/issues.`
    );
  }
  return { templatePath: defaultPath, source: 'default', type };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function matchSectionTemplate(
  templates: Record<string, any> | undefined,
  pagePath: string
): { name: string; pages?: string[]; exclude?: string[] } | null {
  if (!templates || typeof templates !== 'object') return null;
  for (const [pattern, ref] of Object.entries(templates)) {
    if (!globToRegExp(pattern).test(pagePath)) continue;
    const norm = normaliseTemplateRef(ref);
    if (norm) return norm;
  }
  return null;
}

function findPluginTemplate(
  type: TemplateSlot,
  name: string,
  pagePath: string
): ResolvedTemplate | null {
  // `name` can be a full package (`@docmd/template-summer`), a short name
  // (`summer`), or a template-* prefixed name (`template-summer`). Strip the
  // optional `@docmd/` prefix and the `template-` prefix to get the slug.
  const slug = name
    .replace(/^@docmd\//, '')
    .replace(/^template-/, '');

  // Match against registered plugin name. Plugin name is stored on the hook.
  const matches = hooks.templates
    .filter((t) => t.type === type)
    .filter((t) => {
      const pluginSlug = String((t as any)._pluginName || '')
        .replace(/^@docmd\//, '')
        .replace(/^template-/, '');
      return pluginSlug === slug;
    })
    .filter((t) => matchesAny(pagePath, t.pages) && matchesNone(pagePath, t.exclude))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  if (matches.length === 0) return null;
  const top = matches[0];
  return {
    templatePath: top.templatePath,
    source: 'plugin',
    pluginName: (top as any)._pluginName,
    type,
  };
}

// Throttle missing-file warnings to one per build per (plugin, slot) pair.
const _warnedMissing = new Set<string>();
function warnMissingOnce(filePath: string, name: string, type: TemplateSlot) {
  const key = `${name}:${type}:${filePath}`;
  if (_warnedMissing.has(key)) return;
  _warnedMissing.add(key);
  // Lazy import to keep this module side-effect free when unused.
  import('@docmd/tui').then(({ TUI }) => {
    TUI.warn(`Template "${name}" declared slot "${type}" but file not found at ${filePath} — using default.`);
  }).catch(() => {
    // TUI not available in some test contexts — silently fall back.
  });
}

/** Reset the warning cache (useful for dev-server rebuilds). */
export function clearTemplateResolverCache() {
  _warnedMissing.clear();
}