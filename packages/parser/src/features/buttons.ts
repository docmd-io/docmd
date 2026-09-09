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

function cleanLink(raw: string): string {
  let val = unquote(raw);
  if (/^(?:url|link|href):/i.test(val)) {
    val = val.replace(/^(?:url|link|href):/i, '');
    val = unquote(val);
  }
  return val;
}

function parseButtonArgs(rawInput: string): { text: string; link: string; icon: string; color: string } {
  const parsed = parseContainerHeader(rawInput, ['title', 'url']);
  let text = parsed.title || parsed.text || parsed.label || 'Button';
  // If text came from an unquoted bare positional word with underscores (legacy syntax e.g. "Installation_Guide")
  // and wasn't explicitly provided as a named key-value
  if (!rawInput.match(/\b(?:title|text|label):/i) && !rawInput.match(/^\s*["']/)) {
    text = text.replace(/_/g, ' ');
  }
  const link = cleanLink(parsed.url || parsed.link || parsed.href || '');
  const icon = parsed.icon || '';
  const color = parsed.color || parsed.style || '';

  return { text, link, icon, color };
}

function renderButtonHtml(text: string, link: string, icon: string, color: string, state: any): string {
  const { href, isExternal } = processHref(link, state);

  let styleAttr = '';
  if (color) {
    styleAttr = ` style="background-color: ${color}; border-color: ${color}; color: #fff;"`;
  }

  const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

  let iconHtml = '';
  if (icon) {
    iconHtml = renderIcon(icon, { class: 'button-icon' });
  }

  return `<a href="${href}" class="docmd-button"${styleAttr}${targetAttr}>${iconHtml}${state.md.renderInline(text)}</a>`;
}

function buttonRule(state: any, startLine: number, endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const lineContent = state.src.slice(start, max).trim();

  const match = lineContent.match(/^:::\s*button\s+(.*)$/i);
  if (!match) return false;
  if (/^:::\s*button\s+.*:::\s*(?:\/button|\/|)?\s+\S/i.test(lineContent)) return false;
  if (silent) return true;

  let rest = match[1].trim();
  rest = rest.replace(/\s*:::\s*(?:\/button|\/|)?$/i, '').trim();

  const { text, link, icon, color } = parseButtonArgs(rest);

  ensureLineBreakIfNeeded(state, startLine);

  const token = state.push('html_inline', '', 0);
  token.content = renderButtonHtml(text, link, icon, color, state);

  if (!state.env) state.env = {};
  state.env.__lastContainerEndLine = startLine + 1;

  state.line = startLine + 1;
  return true;
}

function buttonInlineRule(state: any, silent: boolean) {
  const start = state.pos;
  const max = state.posMax;

  if (state.src.charCodeAt(start) !== 0x3A /* : */) return false;
  if (state.src.slice(start, start + 3) !== ':::') return false;

  const match = state.src.slice(start, max).match(
    /^:::\s*button\s+((?:(?!:::).)+)(?:\s*:::\s*(?:\/button|\/)?(?=\s|$))?/i
  );
  if (!match) return false;
  if (silent) return true;

  const { text, link, icon, color } = parseButtonArgs(match[1].trim());

  state.pos += match[0].length;

  const token = state.push('html_inline', '', 0);
  token.content = renderButtonHtml(text, link, icon, color, state);

  return true;
}

export default {
  name: 'buttons',
  setup(md: any) {
    md.block.ruler.before('paragraph', 'docmd_button', buttonRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.inline.ruler.before('text', 'docmd_button_inline', buttonInlineRule);
  }
};