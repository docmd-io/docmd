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

import * as lucideStatic from 'lucide-static';

// Convert kebab-case to PascalCase (e.g., arrow-right -> ArrowRight)
function kebabToPascal(str: string): string {
  return str.split('-').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

const exceptions: any = {
  'arrow-up-right-square': 'ExternalLink',
  'file-cog': 'Settings',
  'cloud-upload': 'UploadCloud'
};

function escapeHtml(str: any): string {
  const s = typeof str === 'string' ? str : String(str || '');
  return s.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m] as string);
}

export type IconResolver = (name: string, options: any) => string | null;

const customResolvers: IconResolver[] = [];

export function registerIconResolver(resolver: IconResolver): void {
  customResolvers.push(resolver);
  if (typeof globalThis !== 'undefined') {
    (globalThis as any).__DOCMD_ICON_RESOLVERS__ = (globalThis as any).__DOCMD_ICON_RESOLVERS__ || [];
    if (!(globalThis as any).__DOCMD_ICON_RESOLVERS__.includes(resolver)) {
      (globalThis as any).__DOCMD_ICON_RESOLVERS__.push(resolver);
    }
  }
}

export function clearIconResolvers(): void {
  customResolvers.length = 0;
  if (typeof globalThis !== 'undefined') {
    (globalThis as any).__DOCMD_ICON_RESOLVERS__ = [];
  }
}

function renderIcon(name: string, options: any = {}) {
  if (!name) return '';

  // 1. Local custom resolvers (e.g., @docmd/plugin-iconify)
  for (const resolver of customResolvers) {
    try {
      const res = resolver(name, options);
      if (res) return res;
    } catch { /* ignore */ }
  }

  // 2. Global resolvers (cross-bundle / worker pool)
  const globals = typeof globalThis !== 'undefined' ? (globalThis as any).__DOCMD_ICON_RESOLVERS__ : null;
  if (Array.isArray(globals)) {
    for (const resolver of globals) {
      if (typeof resolver === 'function') {
        try {
          const res = resolver(name, options);
          if (res) return res;
        } catch { /* ignore */ }
      }
    }
  }

  // 3. Built-in Lucide icons (default zero-dependency)
  const key = exceptions[name] || kebabToPascal(name);
  const svgData = (lucideStatic as any)[key];

  if (!svgData) return ''; // Fail silently or warn via callback

  const escape = escapeHtml;

  // Inject attributes into the raw SVG string
  const attrs = [
    `class="lucide-icon icon-${escape(name)} ${escape(options.class || '')}"`,
    `width="${escape(options.width || '1em')}"`,
    `height="${escape(options.height || '1em')}"`,
    `stroke="${escape(options.stroke || 'currentColor')}"`,
    `stroke-width="${escape(options.strokeWidth || 2)}"`,
    'fill="none"',
    'stroke-linecap="round"',
    'stroke-linejoin="round"'
  ].join(' ');

  return svgData.replace('<svg', `<svg ${attrs}`);
}

export { renderIcon };