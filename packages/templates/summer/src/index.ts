/**
 * --------------------------------------------------------------------
 * @docmd/template-summer
 * A bright, hopeful, summer-feel layout for docmd 0.8.7+.
 *
 *   • Top:    logo + (new) centred search bar + menubar at the BOTTOM of the logo bar
 *   • Side:   clean section list with icons
 *   • Main:   airy content with right-rail TOC
 *   • Below:  centred "last updated + edit" footer
 *
 * Implements the `template` plugin capability. Partial override set
 * intentionally small — the resolver will fall back to the default
 * for any slot not listed here.
 *
 * File-system layout: this package ships `.ejs`, `.css`, and `.js` files
 * alongside the compiled JS. Path resolution uses `import.meta.url`
 * (URL-relative) so the same code works in dev (`src/index.ts`) and
 * after `tsc` (`dist/index.js`). The build step copies `templates/` and
 * `assets/` into `dist/` so the URL math is identical in both places.
 * --------------------------------------------------------------------
 */

import { fileURLToPath } from 'node:url';
import type { PluginDescriptor, PluginModule, TemplateHook, TemplateAssetHook } from '@docmd/api';

// ── Resolve asset paths relative to this source file ─────────────────────
//
// `import.meta.url` points at:
//   - src/index.ts      (during development / pnpm exec)
//   - dist/index.js     (after `tsc`)
//
// Using `new URL('../templates/...', import.meta.url)` keeps both paths
// correct as long as the `templates/` and `assets/` directories sit
// next to the entry point file (one level up from `src/` or `dist/`).
//
const here = import.meta.url;

const urlOf = (relPath: string): string => new URL(relPath, here).href;
const pathOf = (relPath: string): string => fileURLToPath(urlOf(relPath));

// ── Plugin descriptor ────────────────────────────────────────────────────

export const plugin: PluginDescriptor = {
  name: 'template-summer',
  version: '0.9.5',
  capabilities: ['template'],
};

// ── Template file overrides ──────────────────────────────────────────────

const templates: TemplateHook[] = [
  // Full layout override — biggest change vs default.
  { type: 'layout',  templatePath: pathOf('../templates/layout.ejs') },
  // Standalone Summer-styled 404 page (uses summer.css, halo gradient, glass card).
  { type: '404',     templatePath: pathOf('../templates/404.ejs') },
  // Re-style the menubar so it sits below the logo (not above).
  { type: 'menubar', templatePath: pathOf('../templates/partials/menubar.ejs') },
  // Tighter, more modern footer.
  { type: 'footer',  templatePath: pathOf('../templates/partials/footer.ejs') },
  // Right-rail TOC styled for summer + scroll-spy hooks.
  { type: 'toc',     templatePath: pathOf('../templates/toc.ejs') },
  // Custom options-menu (omits search — we render that in the topbar).
  { type: 'options-menu', templatePath: pathOf('../templates/partials/options-menu.ejs') },
];

// ── Asset bundles ───────────────────────────────────────────────────────

const templateAssets: TemplateAssetHook[] = [
  {
    type: 'css',
    path: pathOf('../assets/css/summer.css'),
    // Priority 25 so it loads AFTER plugin CSS (20), giving the template full style precedence.
    priority: 25,
    position: 'head',
  },
  {
    type: 'js',
    path: pathOf('../assets/js/summer.js'),
    priority: 25,
    position: 'body',
  },
];

// ── Default export (PluginModule) ────────────────────────────────────────

const summerTemplate: PluginModule & { templates: TemplateHook[]; templateAssets: TemplateAssetHook[] } = {
  plugin,
  templates,
  templateAssets,
};

export default summerTemplate;