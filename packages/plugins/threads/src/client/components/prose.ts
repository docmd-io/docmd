import { css } from 'lit';

/**
 * Styles for rendered Markdown inside a component (a comment body). Page prose CSS does not enter
 * shadow DOM, so this carries what a comment needs: paragraphs, links, code, lists, quotes, and a
 * small token-based palette for the highlight.js classes the server emits for fenced code. It is
 * not the site's code theme; it keeps code coloured and readable in light and dark.
 * Use after `tokens` (components/tokens.ts) and scope it with a wrapper class.
 */
export const proseStyles = css`
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  .prose p { margin: 0 0 6px; }
  .prose a { color: var(--_accent-strong); text-decoration: underline; text-underline-offset: 2px; }
  .prose strong { font-weight: 600; color: var(--_fg-strong); }
  .prose em { font-style: italic; }
  .prose code {
    font-family: var(--_font-mono);
    font-size: 0.9em;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--_surface-muted);
  }
  .prose pre {
    margin: 6px 0;
    padding: 8px 12px;
    overflow-x: auto;
    border-radius: var(--_radius);
    background: var(--_surface-muted);
    font-size: var(--_font-size-xs);
    line-height: 1.5;
  }
  .prose pre code { padding: 0; background: none; font-size: inherit; }
  .prose ul, .prose ol { margin: 0 0 6px; padding-left: 20px; }
  .prose li + li { margin-top: 2px; }
  .prose blockquote {
    margin: 6px 0;
    padding: 0 0 0 10px;
    border-left: 2px solid var(--_border-strong);
    color: var(--_fg-muted);
  }

  /* highlight.js palette */
  .prose .hljs-comment, .prose .hljs-quote { color: var(--_fg-muted); font-style: italic; }
  .prose .hljs-keyword, .prose .hljs-selector-tag, .prose .hljs-literal { color: var(--_accent-strong); }
  .prose .hljs-string, .prose .hljs-regexp, .prose .hljs-addition { color: var(--_danger); }
  .prose .hljs-number, .prose .hljs-symbol, .prose .hljs-bullet { color: var(--_draft); }
  .prose .hljs-title, .prose .hljs-section { color: var(--_fg-strong); font-weight: 600; }
  .prose .hljs-attr, .prose .hljs-attribute, .prose .hljs-variable, .prose .hljs-template-variable { color: var(--_accent-strong); }
  .prose .hljs-built_in, .prose .hljs-type, .prose .hljs-class { color: var(--_draft); }
  .prose .hljs-deletion { color: var(--_danger); background: var(--_danger-soft); }
  .prose .hljs-emphasis { font-style: italic; }
  .prose .hljs-strong { font-weight: 700; }
`;
