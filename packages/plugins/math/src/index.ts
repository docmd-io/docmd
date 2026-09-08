/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/plugin-math
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import texmath from 'markdown-it-texmath';
import katex from 'katex';
import type { PluginDescriptor } from '@docmd/api';

export const plugin: PluginDescriptor = {
  name: 'math',
  version: '0.9.5',
  capabilities: ['markdown', 'assets']
};

export function markdownSetup(md: any) {
  // Suppress KaTeX's "quirks mode" warning - irrelevant in Node.js
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('quirks mode')) return;
    origWarn.apply(console, args);
  };
  md.use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { macros: { "\\RR": "\\mathbb{R}" } } });
  console.warn = origWarn;
}

export function getAssets() {
  return [
    {
      url: 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css',
      type: 'css',
      location: 'head',
      // Conditional loading (new in 0.8.7): only inject KaTeX's stylesheet
      // on pages that actually have rendered math (KaTeX emits `class="katex"`
      // on every formula and `class="katex-display"` on display math). On
      // pages with no math the CSS request is skipped entirely, saving the
      // ~30 KB katex.min.css fetch plus the render cost on mobile.
      condition: { pageHtmlMatches: ['class="katex"', 'class="katex-display"'] }
    }
  ];
}