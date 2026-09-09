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

import { renderIcon } from '../utils/icon-renderer.js';
import { parseTitleAndIcon, stripContainerComment } from '../utils/container-helper.js';
import { normaliseContainers } from '../utils/container-normaliser.js';

function smartDedent(str) {
  const lines = str.split('\n');

  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    minIndent = Math.min(minIndent, indent);
  }

  if (!isFinite(minIndent) || minIndent === 0) return lines.join('\n');

  return lines.map(line =>
    line.startsWith(' '.repeat(minIndent)) ? line.slice(minIndent) : line
  ).join('\n');
}

/**
 * Creates a depth-tracking container block rule for markdown-it.
 * Handles arbitrary nesting of `:::` containers by tracking open/close depth.
 *
 * @example
 * ```ts
 * import { createDepthTrackingContainer } from '@docmd/parser';
 *
 * createDepthTrackingContainer(md, 'note',
 *   (tokens, idx) => `<div class="note">\n`,
 *   () => '</div>\n'
 * );
 * ```
 *
 * @param md - The markdown-it instance
 * @param name - Container name (matched after `:::`)
 * @param renderOpen - Renderer for the opening token
 * @param renderClose - Renderer for the closing token
 */
export function createDepthTrackingContainer(md: any, name: string, renderOpen: any, renderClose: any) {
  md.block.ruler.before('fence', `custom_${name}`, (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineContent = state.src.slice(start, max).trim();
    const cleanContent = stripContainerComment(lineContent);

    // Match opening tag e.g., `::: callout info Title` or `:::callout info Title` (spaceless)
    const regex = new RegExp(`^:::\\s*${name}(?:\\s+(.*))?$`);
    const match = cleanContent.match(regex);
    if (!match) return false;
    if (silent) return true;

    let nextLine = startLine;
    let found = false;
    let depth = 1;
    let fenceMarker = null;

    while (nextLine < endLine) {
      nextLine++;
      if (nextLine >= endLine) break;

      const nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const nextMax = state.eMarks[nextLine];
      const nextContent = state.src.slice(nextStart, nextMax).trim();

      if (!fenceMarker) {
        const match = nextContent.match(/^(`{3,}|~{3,})/);
        if (match) fenceMarker = match[1];
      } else if (nextContent.startsWith(fenceMarker)) {
        fenceMarker = null;
      }

      if (!fenceMarker) {
        if (nextContent.match(/^:::\s*[a-zA-Z]/) && !nextContent.match(/^:::\s*(button|embed|tag)\b/)) {
          depth++;
        } else if (nextContent.match(/^:::\s*(?:\/.*|end.*)?$/)) {
          depth--;
          if (depth === 0) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) return false;

    const info = match[1] || '';

    // Extract raw content lines and dedent to reset indentation,
    // then re-render recursively so nested containers parse correctly.
    let rawContent = '';
    for (let i = startLine + 1; i < nextLine; i++) {
      const lineStart = state.bMarks[i];
      const lineEnd = state.eMarks[i];
      rawContent += state.src.slice(lineStart, lineEnd) + '\n';
    }

    // Phase 2 (F1): re-run the container normaliser on the extracted body
    // BEFORE smartDedent. The top-level normaliser balances the OUTER
    // container's open/close depth, but inside a recursive render of the
    // extracted body the depth-tracker is ambiguous again (e.g. nested
    // grids with one close per inner card). Normalising here inserts the
    // missing closes inside the body so the recursive grid/card rule sees
    // balanced input.
    const normalisedBody = normaliseContainers(rawContent, {
      sourcePath: `<${name}-body@L${startLine + 1}>`
    });
    const innerContent = smartDedent(normalisedBody.source);

    const openToken = state.push(`custom_${name}_open`, 'div', 1);
    openToken.info = info;

    if (innerContent) {
      // Flag the environment so the inner heading plugin skips generating permalinks & IDs
      const oldIsInsideContainer = state.env.isInsideContainer;
      state.env.isInsideContainer = true;

      const renderedContent = state.md.render(innerContent, state.env);

      state.env.isInsideContainer = oldIsInsideContainer;

      const htmlToken = state.push('html_block', '', 0);
      htmlToken.content = renderedContent;
    }

    state.push(`custom_${name}_close`, 'div', -1);

    state.line = nextLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  // Register Renderers
  md.renderer.rules[`custom_${name}_open`] = renderOpen;
  md.renderer.rules[`custom_${name}_close`] = renderClose;
}

export default {
  name: 'common-containers',
  setup(md: any) {

    // 1. Callout
    createDepthTrackingContainer(md, 'callout', (tokens, idx) => {
      const info = tokens[idx].info.trim();
      const parts = info.split(' ');
      const type = parts[0] || 'info';

      // Support ::: callout type "Title" or ::: callout type Title
      let title = '';
      let icon = '';
      const remaining = parts.slice(1).join(' ').trim();
      if (remaining) {
        const parsed = parseTitleAndIcon(remaining);
        title = parsed.title;
        icon = parsed.icon;
      }
      
      const renderedTitle = title ? md.renderInline(title) : '';
      const iconHtml = icon ? renderIcon(icon, { class: 'callout-icon-heading' }) : '';
      const safeType = md.utils.escapeHtml(type);

      return `<div class="docmd-container callout callout-${safeType}">${renderedTitle || iconHtml ? `<div class="callout-title">${iconHtml}${renderedTitle}</div>` : ''}<div class="callout-content">\n`;
    }, () => '</div></div>\n');

    // 2. Card
    createDepthTrackingContainer(md, 'card', (tokens, idx) => {
      const { title, icon } = parseTitleAndIcon(tokens[idx].info);
      const renderedTitle = title ? md.renderInline(title) : '';
      const iconHtml = icon ? renderIcon(icon, { class: 'card-icon-heading' }) : '';
      // No trailing newline after <div class="card-content">: any inline
      // markdown immediately after the ::: card opener (e.g. a callout
      // block or a heading) would otherwise get a literal newline inserted
      // before its first tag, which broke card layouts where the inner
      // block was meant to sit flush against the card edge.
      return `<div class="docmd-container card">${renderedTitle || iconHtml ? `<div class="card-title">${iconHtml}${renderedTitle}</div>` : ''}<div class="card-content">`;
    }, () => '</div></div>');

    // 3. Collapsible
    createDepthTrackingContainer(md, 'collapsible', (tokens, idx) => {
      const info = tokens[idx].info.trim();
      const isOpen = info.startsWith('open ') || info === 'open';
      const rawInfo = isOpen ? info.replace('open', '').trim() : info;
      const { title, icon } = parseTitleAndIcon(rawInfo);
      const displayTitle = title || 'Click to expand';
      const renderedTitle = md.renderInline(displayTitle);
      const iconHtml = icon ? renderIcon(icon, { class: 'collapsible-icon-heading' }) : '';
      const safeOpen = isOpen ? ' open' : '';

      return `<details class="docmd-container collapsible"${safeOpen}>
        <summary class="collapsible-summary">
            <span class="collapsible-title">${iconHtml}${renderedTitle}</span>
            <span class="collapsible-arrow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
        </summary>
        <div class="collapsible-content">\n`;
    }, () => '</div></details>\n');

    // 4. Grids
    createDepthTrackingContainer(md, 'grids', () => {
      return `<div class="docmd-container grids">\n`;
    }, () => '</div>\n');

    // 5. Grid Item
    createDepthTrackingContainer(md, 'grid', () => {
      return `<div class="docmd-container grid-item">\n`;
    }, () => '</div>\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Container Aliases (VitePress/Docusaurus compatibility)
    // These allow users migrating from other documentation engines to use
    // familiar syntax without modification.
    // ─────────────────────────────────────────────────────────────────────────

    // Callout type aliases - map directly to callout variants
    const calloutAliases = [
      // VitePress aliases
      { name: 'warning', type: 'warning' },
      { name: 'danger', type: 'danger' },
      { name: 'info', type: 'info' },
      // Docusaurus aliases
      { name: 'note', type: 'info' },
      { name: 'caution', type: 'warning' },
    ];

    for (const alias of calloutAliases) {
      createDepthTrackingContainer(md, alias.name, (tokens, idx) => {
        const info = tokens[idx].info.trim();
        const { title, icon } = parseTitleAndIcon(info);
        const renderedTitle = title ? md.renderInline(title) : '';
        const iconHtml = icon ? renderIcon(icon, { class: 'callout-icon-heading' }) : '';
        const safeType = md.utils.escapeHtml(alias.type);
        return `<div class="docmd-container callout callout-${safeType}">${renderedTitle || iconHtml ? `<div class="callout-title">${iconHtml}${renderedTitle}</div>` : ''}<div class="callout-content">\n`;
      }, () => '</div></div>\n');
    }

    // VitePress details alias -> collapsible
    createDepthTrackingContainer(md, 'details', (tokens, idx) => {
      const info = tokens[idx].info.trim();
      const isOpen = info.startsWith('open ') || info === 'open';
      const rawInfo = isOpen ? info.replace('open', '').trim() : info;
      const { title, icon } = parseTitleAndIcon(rawInfo);
      const displayTitle = title || 'Details';
      const renderedTitle = md.renderInline(displayTitle);
      const iconHtml = icon ? renderIcon(icon, { class: 'collapsible-icon-heading' }) : '';
      const safeOpen = isOpen ? ' open' : '';

      return `<details class="docmd-container collapsible"${safeOpen}>
        <summary class="collapsible-summary">
            <span class="collapsible-title">${iconHtml}${renderedTitle}</span>
            <span class="collapsible-arrow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
        </summary>
        <div class="collapsible-content">\n`;
    }, () => '</div></details>\n');

  }
};