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

import { stripContainerComment, parseContainerHeader } from '../utils/container-helper.js';

function smartDedent(str) {
  const lines = str.split('\n');
  let minIndent = Infinity;
  lines.forEach(line => {
    if (line.trim().length === 0) return;
    const match = line.match(/^ */);
    if (match[0].length < minIndent) minIndent = match[0].length;
  });
  if (minIndent === Infinity) return str;
  return lines.map(line => line.trim().length ? line.substring(minIndent) : '').join('\n');
}

function parseQuotedTitle(info: string): string {
  if (!info) return '';
  const parsed = parseContainerHeader(info, ['title']);
  return parsed.title || parsed.version || parsed.label || parsed.text || parseLegacyQuotedTitle(info);
}

function parseLegacyQuotedTitle(info: string): string {
  const cleaned = stripContainerComment(info);
  const match = cleaned.match(/"([^"]*)"/);
  return match ? match[1] : cleaned.trim();
}

function changelogRule(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const lineContent = state.src.slice(start, max).trim();
  const cleanContent = stripContainerComment(lineContent);

  // Support both '::: changelog' and ':::changelog' (spaceless)
  if (cleanContent !== '::: changelog' && cleanContent !== ':::changelog') return false;
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
      if (nextContent.match(/^:::\s*[a-zA-Z]/) && !nextContent.match(/^:::\s*(button|tag|embed)\b/i)) {
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

  // Extract content block
  let content = '';
  for (let i = startLine + 1; i < nextLine; i++) {
    const lineStart = state.bMarks[i];
    const lineEnd = state.eMarks[i];
    content += state.src.slice(lineStart, lineEnd) + '\n';
  }

  // Parse changelog entry items (supports both ::: log and legacy ==)
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;
  let currentContentLines = [];
  let nestedDepth = 0;
  let inFence = false;
  let innerFenceMarker = null;
  const INLINE_CONTAINERS = /^:::\s*(tag|button|embed)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    if (inFence) {
      if (innerFenceMarker && trimmedLine.startsWith(innerFenceMarker)) {
        inFence = false;
        innerFenceMarker = null;
      }
      if (currentEntry) {
        currentContentLines.push(rawLine);
      }
      continue;
    }

    const matchFence = trimmedLine.match(/^(`{3,}|~{3,})/);
    if (matchFence) {
      inFence = true;
      innerFenceMarker = matchFence[1];
      if (currentEntry) {
        currentContentLines.push(rawLine);
      }
      continue;
    }

    const logMatch = trimmedLine.match(/^(?::::\s*log\s+(.*)|==\s+(.*))$/i);

    if (nestedDepth === 0 && (trimmedLine === ':::' || /^:::\s*(\/log|endlog|\/changelog|endchangelog)\b/i.test(trimmedLine))) {
      if (currentEntry) {
        currentEntry.content = smartDedent(currentContentLines.join('\n'));
        entries.push(currentEntry);
        currentEntry = null;
        currentContentLines = [];
      }
      continue;
    }

    if (nestedDepth === 0 && logMatch) {
      if (currentEntry) {
        currentEntry.content = smartDedent(currentContentLines.join('\n'));
        entries.push(currentEntry);
      }
      const rawMeta = logMatch[1] !== undefined ? logMatch[1] : logMatch[2];
      currentEntry = { meta: parseQuotedTitle(rawMeta), content: '' };
      currentContentLines = [];
    } else if (currentEntry) {
      if (trimmedLine.match(/^:::\s*[a-zA-Z]/) && !INLINE_CONTAINERS.test(trimmedLine)) {
        nestedDepth++;
      } else if (nestedDepth > 0 && (trimmedLine === ':::' || /^:::\s*\/[a-zA-Z]/i.test(trimmedLine))) {
        nestedDepth--;
      }
      currentContentLines.push(rawLine);
    }
  }
  if (currentEntry) {
    currentEntry.content = smartDedent(currentContentLines.join('\n'));
    entries.push(currentEntry);
  }

  state.push('changelog_open', 'div', 1);

  // Slugify a changelog entry's meta string into a URL-safe id. Mirrors
  // the Unicode-aware rules used by the parser-side heading slug
  // generator (see markdown-processor.ts) so anchors for non-ASCII
  // dates work the same as anchors for non-ASCII headings.
  const slugifyMeta = (text: string): string =>
    text.toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}-]+/gu, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '') || 'entry';

  // Lucide `link-2` icon — same SVG used by .heading-anchor and
  // .step-permalink so all three permalink affordances are visually
  // identical.
  const PERMALINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 1 1 0 10h-2m-7-5h8"/></svg>';

  entries.forEach((entry, idx) => {
    // We render HTML blocks directly for the timeline structure
    const slug = `changelog-${slugifyMeta(entry.meta || String(idx))}`;
    const permalink = `<a href="#${slug}" class="changelog-permalink" aria-label="Permalink to this entry">${PERMALINK_SVG}</a>`;
    const entryOpen = state.push('html_block', '', 0);
    entryOpen.content = `<div class="changelog-entry">
      <div class="changelog-meta"><span class="changelog-date" id="${slug}">${state.md.renderInline(entry.meta)}</span>${permalink}</div>
      <div class="changelog-body">`;

    // Recurse render the markdown inside the entry
    entryOpen.content += state.md.render(entry.content, state.env);

    const entryClose = state.push('html_block', '', 0);
    entryClose.content = `</div></div>`;
  });

  state.push('changelog_close', 'div', -1);
  state.line = nextLine + 1;
  return true;
}

export default {
  name: 'changelog',
  setup(md) {
    // Register Rule
    md.block.ruler.before('fence', 'changelog_timeline', changelogRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

    // Register Container Renderer
    md.renderer.rules.changelog_open = () => '<div class="docmd-container changelog-timeline">';
    md.renderer.rules.changelog_close = () => '</div>';
  }
};