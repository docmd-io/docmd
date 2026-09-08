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

import path from 'path';
import { fileURLToPath } from 'url';
import type { PluginDescriptor } from '@docmd/api';
import { parseContainerHeader, stripContainerComment, renderIcon } from '@docmd/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const plugin: PluginDescriptor = {
  name: 'mermaid',
  version: '0.9.5',
  capabilities: ['markdown', 'assets']
};

function smartDedent(str: string): string {
  const lines = str.split('\n');

  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */)![0].length;
    minIndent = Math.min(minIndent, indent);
  }

  if (!isFinite(minIndent) || minIndent === 0) return lines.join('\n');

  return lines.map(line =>
    line.startsWith(' '.repeat(minIndent)) ? line.slice(minIndent) : line
  ).join('\n');
}

export function markdownSetup(md: any) {
  // 1. Standard fenced code block (```mermaid ... ```)
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const info = token.info.trim();
    if (info === 'mermaid') {
      return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  // 2. Explicit container block (::: mermaid ... ::: /mermaid)
  md.block.ruler.before('fence', 'custom_mermaid', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineContent = state.src.slice(start, max).trim();
    const cleanContent = stripContainerComment(lineContent);

    const regex = /^:::\s*mermaid(?:\s+(.*))?$/i;
    const match = cleanContent.match(regex);
    if (!match) return false;
    if (silent) return true;

    let nextLine = startLine;
    let found = false;
    let depth = 1;
    let fenceMarker: string | null = null;

    while (nextLine < endLine) {
      nextLine++;
      if (nextLine >= endLine) break;

      const nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const nextMax = state.eMarks[nextLine];
      const nextContent = state.src.slice(nextStart, nextMax).trim();

      if (!fenceMarker) {
        const m = nextContent.match(/^(`{3,}|~{3,})/);
        if (m) fenceMarker = m[1];
      } else if (nextContent.startsWith(fenceMarker)) {
        fenceMarker = null;
      }

      if (!fenceMarker) {
        if (nextContent.match(/^:::\s*mermaid\b/i)) {
          depth++;
        } else if (nextContent.match(/^:::\s*\/mermaid\b/i) || nextContent.match(/^:::\s*$/)) {
          depth--;
          if (depth === 0) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) return false;

    const headerInfo = match[1] || '';
    const parsed = parseContainerHeader(headerInfo, ['title']);

    const title = parsed.title || '';
    const icon = parsed.icon || '';
    const align = parsed.align || 'center';
    const theme = parsed.theme || '';
    const zoom = parsed.zoom || '';
    const download = parsed.download || '';

    let rawDsl = '';
    for (let i = startLine + 1; i < nextLine; i++) {
      const lineStart = state.bMarks[i];
      const lineEnd = state.eMarks[i];
      rawDsl += state.src.slice(lineStart, lineEnd) + '\n';
    }

    const dedentedDsl = smartDedent(rawDsl);
    const escapedDsl = md.utils.escapeHtml(dedentedDsl);

    const renderedTitle = title ? md.renderInline(title) : '';
    const iconHtml = icon ? renderIcon(icon, { class: 'mermaid-icon-heading' }) : '';
    
    const safeAlign = md.utils.escapeHtml(align);
    const dataTitle = title ? ` data-title="${md.utils.escapeHtml(title)}"` : '';
    const dataTheme = theme ? ` data-theme="${md.utils.escapeHtml(theme)}"` : '';
    const dataZoom = zoom ? ` data-zoom="${md.utils.escapeHtml(zoom)}"` : '';
    const dataDownload = download ? ` data-download="${md.utils.escapeHtml(download)}"` : '';

    const titleBar = (renderedTitle || iconHtml)
      ? `<div class="mermaid-title">${iconHtml}${renderedTitle}</div>`
      : '';

    const htmlToken = state.push('html_block', '', 0);
    htmlToken.content = `<div class="docmd-container mermaid-container align-${safeAlign}"${dataTitle}${dataTheme}${dataZoom}${dataDownload}>${titleBar}<div class="mermaid">${escapedDsl}</div></div>\n`;

    state.line = nextLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

export function getAssets() {
  return [
    {
      src: path.join(__dirname, 'init-mermaid.js'),
      dest: 'assets/js/init-mermaid.js',
      type: 'js',
      location: 'body',
      condition: { pageHtmlMatches: 'class="mermaid"' }
    }
  ];
}