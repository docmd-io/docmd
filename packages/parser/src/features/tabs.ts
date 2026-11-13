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

function smartDedent(str) {
  const lines = str.split('\n');

  // Ignore first and last blank lines (common in container blocks)
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  let minIndent = Infinity;

  // Find minimum indentation of non-empty lines
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    minIndent = Math.min(minIndent, indent);
  }

  // If no indentation to strip, return joined lines
  if (!isFinite(minIndent) || minIndent === 0) return lines.join('\n');

  // Strip exactly minIndent from each line
  return lines.map(line =>
    line.startsWith(' '.repeat(minIndent))
      ? line.slice(minIndent)
      : line
  ).join('\n');
}

// The Parsing Rule
function tabsRule(state: any, startLine: number, endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const lineContent = state.src.slice(start, max).trim();
  const cleanContent = stripContainerComment(lineContent);

  // Support both '::: tabs' and ':::tabs' (spaceless)
  if (cleanContent !== '::: tabs' && cleanContent !== ':::tabs') return false;
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
      // Increment depth for block-level container openers only.
      // Inline self-closing containers (tag, button, embed) must NOT affect depth
      // because they have no matching closing `:::` - treating them as openers
      // would make the tabs parser wait for an extra closing `:::` that never comes.
      const INLINE_CONTAINERS = /^:::\s*(tag|button|embed)\b/;
      const isSelfClosing = /(?:\s|^)(?:\/:::|:::|\/[a-zA-Z0-9_-]+)\s*$/i.test(nextContent);
      if (nextContent.match(/^:::\s*[a-zA-Z]/) && !INLINE_CONTAINERS.test(nextContent) && !isSelfClosing) {
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

  // Extract content
  let content = '';
  for (let i = startLine + 1; i < nextLine; i++) {
    const lineStart = state.bMarks[i];
    const lineEnd = state.eMarks[i];
    content += state.src.slice(lineStart, lineEnd) + '\n';
  }

  // Parse tab items (supports both ::: tab and legacy == tab)
  const lines = content.split('\n');
  const tabs = [];
  let currentTab = null;
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
      if (currentTab) {
        currentContentLines.push(rawLine);
      }
      continue;
    }

    const matchFence = trimmedLine.match(/^(`{3,}|~{3,})/);
    if (matchFence) {
      inFence = true;
      innerFenceMarker = matchFence[1];
      if (currentTab) {
        currentContentLines.push(rawLine);
      }
      continue;
    }

    const tabMatch = trimmedLine.match(/^(?::::\s*tab|={2,3}\s*(?:tab\b)?)(?:\s+(.*))?$/i);

    if (nestedDepth === 0 && (trimmedLine === ':::' || /^:::\s*(\/tab|endtab|\/tabs|endtabs)\b/i.test(trimmedLine))) {
      if (currentTab) {
        currentTab.content = smartDedent(currentContentLines.join('\n'));
        tabs.push(currentTab);
        currentTab = null;
        currentContentLines = [];
      }
      continue;
    }

    if (nestedDepth === 0 && tabMatch) {
      if (currentTab) {
        currentTab.content = smartDedent(currentContentLines.join('\n'));
        tabs.push(currentTab);
      }
      const rawInfo = (tabMatch[1] || '').trim();
      const parsed = parseTitleAndIcon(rawInfo);
      let title = parsed.title;
      const icon = parsed.icon;
      if (rawInfo && !rawInfo.includes('"') && !rawInfo.includes("'") && !rawInfo.includes(':') && !rawInfo.includes('=')) {
        title = stripContainerComment(rawInfo);
      }
      currentTab = { title: title || 'Tab', icon, content: '' };
      currentContentLines = [];
    } else if (currentTab) {
      if (trimmedLine.match(/^:::\s*[a-zA-Z]/) && !INLINE_CONTAINERS.test(trimmedLine)) {
        nestedDepth++;
      } else if (nestedDepth > 0 && (trimmedLine === ':::' || /^:::\s*\/[a-zA-Z]/i.test(trimmedLine))) {
        nestedDepth--;
      }
      currentContentLines.push(rawLine);
    }
  }
  if (currentTab) {
    currentTab.content = smartDedent(currentContentLines.join('\n'));
    tabs.push(currentTab);
  }

  // Generate Tokens
  const openToken = state.push('tabs_open', 'div', 1);
  openToken.attrs = [['class', 'docmd-tabs']];

  state.push('tabs_nav_open', 'div', 1);
  tabs.forEach((tab, index) => {
    const navItemToken = state.push('tabs_nav_item', 'div', 0);
    navItemToken.attrs = [['class', `docmd-tabs-nav-item ${index === 0 ? 'active' : ''}`]];
    if (tab.icon) {
      navItemToken.attrs.push(['data-icon', state.md.utils.escapeHtml(tab.icon)]);
    }
    navItemToken.content = tab.title;
  });
  state.push('tabs_nav_close', 'div', -1);

  state.push('tabs_content_open', 'div', 1);
  tabs.forEach((tab, index) => {
    const paneToken = state.push('tab_pane_open', 'div', 1);
    paneToken.attrs = [['class', `docmd-tab-pane ${index === 0 ? 'active' : ''}`]];

    if (tab.content) {
      // Recurse parsing inside tabs and flag as inside container
      const oldIsInsideContainer = state.env.isInsideContainer;
      state.env.isInsideContainer = true;

      const renderedContent = state.md.render(tab.content, state.env);

      state.env.isInsideContainer = oldIsInsideContainer;

      const htmlToken = state.push('html_block', '', 0);
      htmlToken.content = renderedContent;
    }
    state.push('tab_pane_close', 'div', -1);
  });
  state.push('tabs_content_close', 'div', -1);
  state.push('tabs_close', 'div', -1);

  state.line = nextLine + 1;
  return true;
}

export default {
  name: 'tabs',
  setup(md: any) {
    md.block.ruler.before('fence', 'enhanced_tabs', tabsRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

    // Register Renderers
    md.renderer.rules.tabs_nav_open = () => '<div class="docmd-tabs-nav">';
    md.renderer.rules.tabs_nav_close = () => '</div>';
    md.renderer.rules.tabs_nav_item = (tokens, idx) => {
      const iconAttr = tokens[idx].attrs.find(a => a[0] === 'data-icon');
      const icon = iconAttr ? iconAttr[1] : null;
      const iconHtml = icon ? renderIcon(icon, { class: 'tab-icon' }) : '';
      const className = tokens[idx].attrs.find(a => a[0] === 'class')[1];
      return `<div class="${className}">${iconHtml}<span>${md.renderInline(tokens[idx].content)}</span></div>`;
    };
    md.renderer.rules.tabs_content_open = () => '<div class="docmd-tabs-content">';
    md.renderer.rules.tabs_content_close = () => '</div>';
    md.renderer.rules.tab_pane_open = (tokens, idx) => `<div class="${tokens[idx].attrs[0][1]}">`;
    md.renderer.rules.tab_pane_close = () => '</div>';
    md.renderer.rules.tabs_close = () => '</div>';
  }
};