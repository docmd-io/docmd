/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/plugin-iconify
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import fs from 'fs';
import path from 'path';
import process from 'process';
import { execFileSync } from 'child_process';
import type { PluginDescriptor, DoctorCheckResult, DoctorContext } from '@docmd/api';
import { registerIconResolver } from '@docmd/parser';
import { createLogger } from '@docmd/tui';

const log = createLogger('iconify');

export const plugin: PluginDescriptor = {
  name: 'iconify',
  version: '0.10.0',
  capabilities: ['markdown', 'init', 'doctor']
};

/** In-memory cache for fast hot-reloading */
const memoryCache = new Map<string, string>();

/**
 * Normalizes input name into collection and icon name.
 * Accepts:
 *   - iconify:mdi:home
 *   - iconify:mdi-home
 *   - iconify-mdi:home
 *   - iconify-mdi-home
 *   - iconify:carbon:logo-github
 */
export function parseIconifyName(rawName: string): { collection: string; icon: string } | null {
  if (!rawName) return null;
  let s = rawName.trim();
  if (s.startsWith('iconify:')) {
    s = s.slice('iconify:'.length);
  } else if (s.startsWith('iconify-')) {
    s = s.slice('iconify-'.length);
  } else {
    return null;
  }

  // Format 1: <collection>:<icon> (e.g. mdi:home, carbon:logo-github)
  if (s.includes(':')) {
    const parts = s.split(':');
    return { collection: parts[0], icon: parts.slice(1).join(':') };
  }

  // Format 2: <collection>-<icon> (e.g. mdi-home, solar-shield-check-bold)
  const dashIdx = s.indexOf('-');
  if (dashIdx > 0) {
    return { collection: s.slice(0, dashIdx), icon: s.slice(dashIdx + 1) };
  }

  return null;
}

function getCacheDir(): string {
  const cwd = process.cwd();
  const dir = path.join(cwd, '.docmd', 'cache', 'icons');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  return dir;
}

function escapeHtml(str: any): string {
  const s = typeof str === 'string' ? str : String(str || '');
  return s.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m] as string);
}

/**
 * Fetch SVG content synchronously from disk cache, local package, or Iconify API.
 */
function fetchIconSvg(collection: string, icon: string): string | null {
  const key = `${collection}:${icon}`;
  if (memoryCache.has(key)) return memoryCache.get(key)!;

  const cacheDir = getCacheDir();
  const cacheFile = path.join(cacheDir, `${collection}_${icon.replace(/[^a-z0-9_-]/gi, '_')}.svg`);

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = fs.readFileSync(cacheFile, 'utf8');
      if (cached && cached.includes('<svg')) {
        memoryCache.set(key, cached);
        return cached;
      }
    } catch { /* ignore read failure */ }
  }

  // Attempt fetch via Node curl / child process for synchronous build pipeline
  try {
    const url = `https://api.iconify.design/${encodeURIComponent(collection)}/${encodeURIComponent(icon)}.svg`;
    let svg = '';
    
    // Use curl or python or fetch fallback
    if (process.platform !== 'win32') {
      try {
        svg = execFileSync('curl', ['-s', '-L', '--max-time', '4', url], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      } catch { /* curl failed */ }
    }

    if (!svg || !svg.includes('<svg')) {
      // Inline node fetch via child process if curl unavailable
      const script = `
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        fetch("${url}", { signal: controller.signal })
          .then(r => r.ok ? r.text() : "")
          .then(t => { clearTimeout(t); process.stdout.write(t); })
          .catch(() => process.exit(0));
      `;
      try {
        svg = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      } catch { /* fallback failed */ }
    }

    if (svg && svg.includes('<svg')) {
      memoryCache.set(key, svg);
      try {
        fs.writeFileSync(cacheFile, svg, 'utf8');
      } catch { /* cache write failure ignored */ }
      return svg;
    }
  } catch { /* network fetch failed */ }

  return null;
}

/**
 * Iconify Icon Resolver function registered with @docmd/parser.
 */
export function resolveIconifyIcon(rawName: string, options: any = {}): string | null {
  const parsed = parseIconifyName(rawName);
  if (!parsed) return null;

  const { collection, icon } = parsed;
  const rawSvg = fetchIconSvg(collection, icon);

  if (!rawSvg) {
    // Return minimal fallback SVG so layout is preserved even if offline
    const escClass = escapeHtml(options.class || '');
    return `<svg class="iconify-icon icon-${escapeHtml(collection)}-${escapeHtml(icon)} ${escClass}" width="${escapeHtml(options.width || '1em')}" height="${escapeHtml(options.height || '1em')}" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
  }

  const escape = escapeHtml;
  const iconClass = `iconify-icon icon-${escape(collection)}-${escape(icon)} ${escape(options.class || '')}`;
  const width = escape(options.width || '1em');
  const height = escape(options.height || '1em');

  // Inject class, width, height into the root SVG tag
  let modified = rawSvg;
  if (/width="[^"]*"/.test(modified)) {
    modified = modified.replace(/width="[^"]*"/, `width="${width}"`);
  } else {
    modified = modified.replace('<svg', `<svg width="${width}"`);
  }

  if (/height="[^"]*"/.test(modified)) {
    modified = modified.replace(/height="[^"]*"/, `height="${height}"`);
  } else {
    modified = modified.replace('<svg', `<svg height="${height}"`);
  }

  if (/class="[^"]*"/.test(modified)) {
    modified = modified.replace(/class="([^"]*)"/, `class="$1 ${iconClass}"`);
  } else {
    modified = modified.replace('<svg', `<svg class="${iconClass}"`);
  }

  return modified;
}

// Register resolver into docmd parser system
registerIconResolver(resolveIconifyIcon);

export function onConfigResolved(_config: any) {
  registerIconResolver(resolveIconifyIcon);
}

export function markdownSetup(_md: any) {
  registerIconResolver(resolveIconifyIcon);
}

export function onDoctorCheck(_ctx: DoctorContext): DoctorCheckResult[] {
  const cacheDir = getCacheDir();
  let cachedCount = 0;
  try {
    if (fs.existsSync(cacheDir)) {
      cachedCount = fs.readdirSync(cacheDir).filter(f => f.endsWith('.svg')).length;
    }
  } catch { /* ignore */ }

  return [
    {
      name: 'Iconify Integration',
      status: 'ok',
      message: `Active with support for 200,000+ open-source icons (cached: ${cachedCount})`
    }
  ];
}