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

import { createDepthTrackingContainer } from './common-containers.js';
import { processHref } from '../utils/normalize-href.js';
import { parseContainerHeader } from '../utils/container-helper.js';

function parseTooltipArgs(rawInput: string): { tooltipText: string; displayTerm: string; url: string } {
  const parsed = parseContainerHeader(rawInput, ['text']);
  const tooltipText = parsed.text || parsed.title || parsed.label || 'Tooltip';
  const displayTerm = parsed.term || tooltipText;
  const url = parsed.url || parsed.link || parsed.href || '';

  return { tooltipText, displayTerm, url };
}

function tooltipInlineRule(state: any, silent: boolean) {
  const start = state.pos;
  const max = state.posMax;

  if (state.src.charCodeAt(start) !== 0x3A /* : */) return false;
  if (state.src.slice(start, start + 3) !== ':::') return false;

  const match = state.src.slice(start, max).match(
    /^:::\s*(?:tip|tooltip)\s+(.*?)(?:\s*:::\s*(?:\/(?:tip|tooltip)|\/|)?(?=\s|$))/i
  );

  if (!match) return false;
  if (silent) return true;

  const { tooltipText, displayTerm, url } = parseTooltipArgs(match[1].trim());

  state.pos += match[0].length;

  const token = state.push('html_inline', '', 0);
  const escapedText = state.md.utils.escapeHtml(tooltipText);

  if (url) {
    const { href, isExternal } = processHref(url, state);
    const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    token.content = `<a href="${href}" class="docmd-tooltip docmd-tooltip-link"${targetAttr} data-tooltip="${escapedText}">${state.md.renderInline(displayTerm)}</a>`;
  } else {
    token.content = `<span class="docmd-tooltip" data-tooltip="${escapedText}">${state.md.renderInline(displayTerm)}</span>`;
  }

  return true;
}

export default {
  name: 'tooltip',
  setup(md: any) {
    md.inline.ruler.before('text', 'docmd_tooltip_inline', tooltipInlineRule);

    // Block container support ::: tip "Tooltip Text" [url:"..."] ... ::: /tip
    createDepthTrackingContainer(
      md,
      'tip',
      (tokens: any[], idx: number) => {
        const info = tokens[idx].info ? tokens[idx].info.trim() : '';
        const { tooltipText, url } = parseTooltipArgs(info);
        const escapedText = md.utils.escapeHtml(tooltipText);
        if (url) {
          const { href, isExternal } = processHref(url, {});
          const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
          return `<a href="${href}" class="docmd-tooltip docmd-tooltip-link"${targetAttr} data-tooltip="${escapedText}">`;
        }
        return `<span class="docmd-tooltip" data-tooltip="${escapedText}">`;
      },
      (tokens: any[], idx: number) => {
        const info = tokens[idx].info ? tokens[idx].info.trim() : '';
        const { url } = parseTooltipArgs(info);
        return url ? '</a>' : '</span>';
      }
    );

    // Alias for block container ::: tooltip
    createDepthTrackingContainer(
      md,
      'tooltip',
      (tokens: any[], idx: number) => {
        const info = tokens[idx].info ? tokens[idx].info.trim() : '';
        const { tooltipText, url } = parseTooltipArgs(info);
        const escapedText = md.utils.escapeHtml(tooltipText);
        if (url) {
          const { href, isExternal } = processHref(url, {});
          const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
          return `<a href="${href}" class="docmd-tooltip docmd-tooltip-link"${targetAttr} data-tooltip="${escapedText}">`;
        }
        return `<span class="docmd-tooltip" data-tooltip="${escapedText}">`;
      },
      (tokens: any[], idx: number) => {
        const info = tokens[idx].info ? tokens[idx].info.trim() : '';
        const { url } = parseTooltipArgs(info);
        return url ? '</a>' : '</span>';
      }
    );
  }
};