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

import { createMarkdownProcessor, processContent } from '@docmd/parser/dist/markdown-processor.js';
import { markdownSetup as mathMarkdownSetup } from '@docmd/plugin-math';
import { markdownSetup as mermaidMarkdownSetup } from '@docmd/plugin-mermaid';
// @ts-expect-error virtual module
import templates from 'virtual:docmd-templates';

// Expose the compile function to the window.docmd global
async function compile(markdown: string, config: any = {}) {
    const defaults: any = {
        siteTitle: 'Live Preview',
        theme: { appearance: 'light', name: 'default', codeHighlight: true },
        layout: { spa: false },
        ...config
    };

    // 1. Process Markdown with Plugin Support
    const md = createMarkdownProcessor(defaults, (parser) => {
        // Math (KaTeX)
        mathMarkdownSetup(parser);

        // Mermaid (container ::: mermaid and fence ```mermaid)
        mermaidMarkdownSetup(parser);
    });
    const result = processContent(markdown, md, defaults);

    if (!result) return '<p>Error parsing markdown</p>';

    // Since we are in the browser, we assume assets are served at ./assets/
    const assetsRoot = './assets';
    const appearance = defaults.theme.appearance || 'light';

    // Theme init script for live preview — defaults to light, honors explicit 'docmd-live-theme' toggle
    const themeInitScript = `
    (function () {
      try {
        var localValue = localStorage.getItem('docmd-live-theme');
        var theme = (localValue === 'dark') ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        var lightLink = document.getElementById('hljs-light');
        var darkLink = document.getElementById('hljs-dark');
        if (lightLink && darkLink) {
          lightLink.disabled = theme === 'dark';
          darkLink.disabled = theme === 'light';
        }
      } catch (e) {}
    })();
    `;

    // KaTeX stylesheet (theme tokens come from docmd-main.css)
    const katexCss = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css">`;

    // Mermaid init — runs in the preview iframe, picks up the current theme
    const mermaidScript = `
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
        async function initMermaid() {
            try {
                const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                mermaid.initialize({
                    startOnLoad: false,
                    theme: isDark ? 'dark' : 'default',
                    securityLevel: 'loose',
                });
                const nodes = document.querySelectorAll('.mermaid');
                if (nodes.length > 0) {
                    await mermaid.run({ nodes });
                }
            } catch (e) { console.error('Mermaid error:', e); }
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initMermaid();
        } else {
            document.addEventListener('DOMContentLoaded', initMermaid);
        }
    </script>
    `;

    // Minimal interactivity for the preview iframe. docmd-main.js is not
    // loaded here (we stripped the chrome), so tab switching has to be
    // wired here. Collapsibles use native <details>, so they need no JS.
    const interactivityScript = `
    <script>
    (function () {
        document.addEventListener('click', function (e) {
            var tabItem = e.target.closest('.docmd-tabs-nav-item');
            if (!tabItem) return;
            var container = tabItem.closest('.docmd-tabs');
            if (!container) return;
            var navItems = container.querySelectorAll('.docmd-tabs-nav-item');
            var panes = container.querySelectorAll('.docmd-tab-pane');
            var index = Array.prototype.indexOf.call(navItems, tabItem);
            for (var i = 0; i < navItems.length; i++) navItems[i].classList.remove('active');
            for (var j = 0; j < panes.length; j++) panes[j].classList.remove('active');
            tabItem.classList.add('active');
            if (panes[index]) panes[index].classList.add('active');
        });
    })();
    <\/script>
    `;

    return `<!DOCTYPE html>
<html lang="en" data-theme="${appearance}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${result.frontmatter.title || 'Live Preview'}</title>
    <script>window.DOCMD_APPEARANCE = "${appearance}";</script>
    <script>${themeInitScript}</script>
    <link rel="stylesheet" href="${assetsRoot}/css/docmd-main.css?v=live">
    <link rel="stylesheet" href="${assetsRoot}/css/docmd-live-preview.css">
    ${katexCss}
    <style>
        body { max-width: 880px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
        body > :first-child { margin-top: 0; }
    </style>
</head>
<body>
${result.htmlContent}
${interactivityScript}
${mermaidScript}
</body>
</html>`;
}

import { highlightDocmd } from './docmd-highlighter.js';

export { compile, highlightDocmd as highlight };