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
import { processHref } from '../utils/normalize-href.js';
import { ensureLineBreakIfNeeded, parseContainerHeader } from '../utils/container-helper.js';

function unquote(value: string): string {
  if (!value) return '';
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function resolveTagColor(val: string): string {
  const v = unquote(val).toLowerCase();
  switch (v) {
    case 'success': return '#10b981';
    case 'warning': return '#f59e0b';
    case 'danger':
    case 'error': return '#ef4444';
    case 'info': return '#3b82f6';
    case 'primary': return '#fe551b';
    default: return unquote(val);
  }
}

function parseTagArgs(rawInput: string): { text: string; icon: string; color: string; link: string } {
  const parsed = parseContainerHeader(rawInput, ['title', 'url']);
  const text = parsed.title || parsed.text || parsed.label || 'Tag';
  const icon = parsed.icon || '';
  const color = parsed.color || parsed.style || '';
  const link = parsed.url || parsed.link || parsed.href || '';

  return { text, icon, color, link };
}

function renderTagHtml(text: string, icon: string, color: string, link: string, state: any): string {
  let styleAttr = '';
  if (color) {
    const resolvedColor = resolveTagColor(color);
    styleAttr = ` style="--tag-color: ${resolvedColor}; background-color: color-mix(in srgb, ${resolvedColor} 15%, transparent); color: ${resolvedColor}; border-color: color-mix(in srgb, ${resolvedColor} 30%, transparent);"`;
  }

  let iconHtml = '';
  if (icon) {
    iconHtml = renderIcon(icon, { class: 'tag-icon', style: 'width:12px;height:12px;margin-right:4px;' });
  }

  let tagHtml = `<span class="docmd-tag"${styleAttr}>${iconHtml}${state.md.renderInline(text)}</span>`;

  if (link) {
    const { href, isExternal } = processHref(link, state);
    const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    tagHtml = `<a href="${href}" class="docmd-tag-link"${targetAttr}>${tagHtml}</a>`;
  }

  return tagHtml;
}

function tagBlockRule(state: any, startLine: number, endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const lineContent = state.src.slice(start, max).trim();

  const match = lineContent.match(/^:::\s*tag\s+(.*)$/i);
  if (!match) return false;
  if (/^:::\s*tag\s+.*:::\s*(?:\/tag|\/|)?\s+\S/i.test(lineContent)) return false;
  if (silent) return true;

  let rest = match[1].trim();
  rest = rest.replace(/\s*:::\s*(?:\/tag|\/|)?$/i, '').trim();

  const { text, icon, color, link } = parseTagArgs(rest);

  ensureLineBreakIfNeeded(state, startLine);

  const token = state.push('html_inline', '', 0);
  token.content = renderTagHtml(text, icon, color, link, state);

  if (!state.env) state.env = {};
  state.env.__lastContainerEndLine = startLine + 1;

  state.line = startLine + 1;
  return true;
}

function tagInlineRule(state: any, silent: boolean) {
  const start = state.pos;
  const max = state.posMax;

  if (state.src.charCodeAt(start) !== 0x3A /* : */) return false;
  if (state.src.slice(start, start + 3) !== ':::') return false;

  const match = state.src.slice(start, max).match(
    /^:::\s*tag\s+((?:(?!:::).)+)(?:\s*:::\s*(?:\/tag|\/)?(?=\s|$))?/i
  );
  if (!match) return false;
  if (silent) return true;

  const { text, icon, color, link } = parseTagArgs(match[1].trim());

  state.pos += match[0].length;

  const token = state.push('html_inline', '', 0);
  token.content = renderTagHtml(text, icon, color, link, state);

  return true;
}

export default {
  name: 'tags',
  setup(md: any) {
    md.block.ruler.before('paragraph', 'docmd_tag', tagBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.inline.ruler.before('text', 'docmd_tag_inline', tagInlineRule);
  }
};