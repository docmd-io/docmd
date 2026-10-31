/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/plugin-playground
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginDescriptor, Asset } from '@docmd/api';
import { stripContainerComment, renderIcon } from '@docmd/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const plugin: PluginDescriptor = {
  name: 'playground',
  version: '0.9.9',
  capabilities: ['markdown', 'assets']
};

interface SourceFileInfo {
  code: string;
  ext: string;
  filename: string;
}

/**
 * Resolves a source file path from document relative directory or workspace root.
 */
function resolveSourceFile(srcPath: string, envFilePath?: string): SourceFileInfo | null {
  if (!srcPath) return null;
  const cleanPath = srcPath.replace(/^[<'"]+|[>'"]+$/g, '').trim();
  if (!cleanPath) return null;

  const docDir = envFilePath ? path.dirname(envFilePath) : '';
  const candidates = [
    docDir ? path.resolve(docDir, cleanPath) : null,
    path.resolve(process.cwd(), cleanPath),
    docDir ? path.resolve(docDir, '..', cleanPath) : null,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          const code = fs.readFileSync(candidate, 'utf8');
          const ext = path.extname(candidate).toLowerCase().replace(/^\./, '');
          const filename = path.basename(candidate);
          return { code, ext, filename };
        }
      } catch {
        // continue search
      }
    }
  }
  return null;
}

function renderPlaygroundHtml(
  md: any,
  code: string,
  lang: string,
  title?: string,
  isLive?: boolean,
  icon?: string,
  layout?: string,
  isReadonly?: boolean,
  hasTabs?: boolean,
  warning?: string,
  initialView?: 'live' | 'code'
): string {
  const safeLang = (lang || 'js').toLowerCase();
  const displayTitle = title || (safeLang === 'html' ? 'Live HTML Preview' : `${safeLang.toUpperCase()} Playground`);
  const escapedCode = md.utils.escapeHtml(code);
  const liveAttr = isLive ? ' data-live="true"' : '';
  const readonlyAttr = isReadonly ? ' data-readonly="true"' : '';
  const activeView = initialView === 'code' ? 'code' : 'live';
  const modeAttr = hasTabs ? ` data-mode="tabs" data-active-view="${activeView}"` : '';
  const layoutClass = layout ? ` docmd-playground-layout-${layout}` : '';

  const iconName = (icon || 'play').trim();
  let iconHtml = '';
  if (iconName) {
    iconHtml = renderIcon(iconName, { class: 'docmd-playground-icon', width: '14', height: '14' });
  }
  if (!iconHtml) {
    iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="docmd-playground-icon"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
  }

  const warningHtml = warning ? `
  <div class="docmd-playground-alert">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span>${md.utils.escapeHtml(warning)}</span>
  </div>` : '';

  const viewTabsHtml = hasTabs ? `
    <div class="docmd-playground-view-tabs">
      <button type="button" class="docmd-playground-view-tab ${activeView === 'live' ? 'active' : ''}" data-view="live" title="View Live Output">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        <span>Live</span>
      </button>
      <button type="button" class="docmd-playground-view-tab ${activeView === 'code' ? 'active' : ''}" data-view="code" title="View Source Code">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <span>Code</span>
      </button>
    </div>` : '';

  return `
<div class="docmd-playground${layoutClass}" data-lang="${safeLang}" data-title="${md.utils.escapeHtml(displayTitle)}"${liveAttr}${readonlyAttr}${modeAttr}>
  <div class="docmd-playground-header">
    <div class="docmd-playground-info">
      ${iconHtml}
      <span class="docmd-playground-badge">${md.utils.escapeHtml(safeLang)}</span>
      <span class="docmd-playground-title">${md.utils.escapeHtml(displayTitle)}</span>
    </div>
    ${viewTabsHtml}
    <div class="docmd-playground-actions">
      <button type="button" class="docmd-playground-btn docmd-playground-run-btn" title="Run Code (Cmd+Enter / Ctrl+Enter)">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        <span>Run</span>
      </button>
      <button type="button" class="docmd-playground-btn docmd-playground-reset-btn" title="Reset Code">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
      <button type="button" class="docmd-playground-btn docmd-playground-copy-btn" title="Copy Code">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </button>
      <button type="button" class="docmd-playground-btn docmd-playground-clear-btn" title="Clear Console">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
      </button>
    </div>
  </div>
  ${warningHtml}
  <div class="docmd-playground-body">
    <div class="docmd-playground-editor-wrap">
      <textarea class="docmd-playground-editor" spellcheck="false" autocomplete="off" autocapitalize="off"${isReadonly ? ' readonly' : ''}>${escapedCode.trim()}</textarea>
    </div>
    <div class="docmd-playground-output-wrap">
      <div class="docmd-playground-tabs">
        <button type="button" class="docmd-playground-tab ${safeLang !== 'html' ? 'active' : ''}" data-tab="console">Console</button>
        <button type="button" class="docmd-playground-tab ${safeLang === 'html' ? 'active' : ''}" data-tab="preview">Preview</button>
      </div>
      <div class="docmd-playground-tab-panel ${safeLang !== 'html' ? 'active' : ''}" data-panel="console">
        <div class="docmd-playground-console"></div>
      </div>
      <div class="docmd-playground-tab-panel ${safeLang === 'html' ? 'active' : ''}" data-panel="preview">
        <div class="docmd-playground-preview"></div>
      </div>
    </div>
  </div>
  <template class="docmd-playground-initial-code">${escapedCode.trim()}</template>
</div>
`.trim() + '\n';
}

export function markdownSetup(md: any) {
  // 1. Fenced Code Blocks (```js playground, ```html playground, ```js live)
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();

    const isPlayground = /(?:^|\s)(?:playground|live)(?:\s|$)/i.test(info);
    if (isPlayground) {
      // Extract language
      const rawLang = info
        .replace(/(?:playground|live|readonly|tabs(?::\w+)?)/gi, '')
        .replace(/title=(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/title:(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/icon=(?:"[^"]*"|'[^']*'|\w+)/gi, '')
        .replace(/icon:(?:"[^"]*"|'[^']*'|\w+)/gi, '')
        .replace(/layout=(?:"[^"]*"|'[^']*'|\w+)/gi, '')
        .replace(/layout:(?:"[^"]*"|'[^']*'|\w+)/gi, '')
        .replace(/mode=(?:"[^"]*"|'[^']*'|\w+)/gi, '')
        .replace(/view=(?:"[^"]*"|'[^']*'|\w+)/gi, '')
        .trim()
        .split(/\s+/)[0] || 'js';

      // Extract title if present
      const titleMatch = info.match(/title(?:=|:)\s*(?:"([^"]*)"|'([^']*)')/i);
      const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : undefined;
      const isLive = /(?:^|\s)live(?:\s|$)/i.test(info);
      const isReadonly = /(?:^|\s)readonly(?:\s|$)/i.test(info);
      const hasTabs = /(?:^|\s)(?:tabs(?::\w+)?|mode(?:=|:)\s*(?:"tabs"|'tabs'|tabs)|view(?:=|:)\s*(?:"tabs"|'tabs'|tabs))(?:\s|$)/i.test(info);
      const initialView = /(?:^|\s)(?:tabs:code|view(?:=|:)\s*(?:"code"|'code'|code)|show-code|show:code)(?:\s|$)/i.test(info) ? 'code' : 'live';

      const iconMatch = info.match(/icon(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|(\w+))/i);
      const icon = iconMatch ? (iconMatch[1] || iconMatch[2] || iconMatch[3]) : 'play';

      const layoutMatch = info.match(/layout(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|(\w+))/i);
      const layout = layoutMatch ? (layoutMatch[1] || layoutMatch[2] || layoutMatch[3]) : undefined;

      return renderPlaygroundHtml(md, token.content, rawLang, title, isLive, icon, layout, isReadonly, hasTabs, undefined, initialView);
    }

    return defaultFence(tokens, idx, options, env, self);
  };

  // 2. Explicit Container Blocks (::: playground ... ::: or self-closing ::: playground src="..." /:::)
  md.block.ruler.before('fence', 'custom_playground', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineContent = state.src.slice(start, max).trim();
    const cleanContent = stripContainerComment(lineContent);

    const regex = /^:::\s*playground(?:\s+(.*))?$/i;
    const match = cleanContent.match(regex);
    if (!match) return false;
    if (silent) return true;

    const rawHeaderInfo = match[1] || '';

    // Check if this container is self-closing on a single line:
    // e.g. ::: playground src="./counter.js" title="..." /:::
    // or   ::: playground src="./counter.js" title="..." :::
    const isSelfClosing = /(?:\/:::|(?:\s|^):::|\/playground|\/)\s*$/i.test(rawHeaderInfo);
    const headerInfo = rawHeaderInfo.replace(/(?:\/:::|(?:\s|^):::|\/playground|\/)\s*$/i, '').trim();

    // Extract attributes
    const srcMatch = headerInfo.match(/(?:src|file)(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    const srcPath = srcMatch ? (srcMatch[1] || srcMatch[2] || srcMatch[3]) : '';

    const titleMatch = headerInfo.match(/title(?:=|:)\s*(?:"([^"]*)"|'([^']*)')/i);
    const positionalQuote = headerInfo.match(/(?:^|\s)(?:"([^"]+)"|'([^']+)')/);
    let title = titleMatch 
      ? (titleMatch[1] || titleMatch[2]) 
      : (positionalQuote ? (positionalQuote[1] || positionalQuote[2]) : '');

    const iconMatch = headerInfo.match(/icon(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z0-9_-]+))/i);
    const icon = iconMatch ? (iconMatch[1] || iconMatch[2] || iconMatch[3]) : 'play';

    const layoutMatch = headerInfo.match(/layout(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|(\w+))/i);
    const layout = layoutMatch ? (layoutMatch[1] || layoutMatch[2] || layoutMatch[3]) : undefined;

    const langMatch = headerInfo.match(/(?:^|\s)(?:lang(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|(\w+))|(javascript|html|css|json|ts|typescript|js))\b/i);
    let lang = langMatch ? (langMatch[1] || langMatch[2] || langMatch[3] || langMatch[4] || '') : '';
    const isLive = /(?:^|\s)live(?:\s|$)/i.test(headerInfo);
    const isReadonly = /(?:^|\s)readonly(?:\s|$)/i.test(headerInfo);
    const hasTabs = /(?:^|\s)(?:tabs(?::\w+)?|mode(?:=|:)\s*(?:"tabs"|'tabs'|tabs)|view(?:=|:)\s*(?:"tabs"|'tabs'|tabs))(?:\s|$)/i.test(headerInfo);
    const initialView = /(?:^|\s)(?:tabs:code|view(?:=|:)\s*(?:"code"|'code'|code)|show-code|show:code)(?:\s|$)/i.test(headerInfo) ? 'code' : 'live';

    // Resolve code from src file if specified
    let fileInfo: SourceFileInfo | null = null;
    let warning: string | undefined = undefined;

    if (srcPath) {
      fileInfo = resolveSourceFile(srcPath, state.env && state.env.filePath);
      if (fileInfo) {
        if (!lang) {
          const ext = fileInfo.ext;
          if (ext === 'ts' || ext === 'mjs' || ext === 'cjs') lang = 'js';
          else if (ext) lang = ext;
        }
        if (!title) {
          title = fileInfo.filename;
        }
      } else {
        warning = `Playground Notice: Source script "${srcPath}" not found. Displaying fallback code.`;
      }
    }

    if (isSelfClosing) {
      const code = fileInfo ? fileInfo.code : (warning ? `// File not found: ${srcPath}\n// Check path relative to documentation root.` : '');
      const finalLang = lang || 'js';
      const htmlToken = state.push('html_block', '', 0);
      htmlToken.content = renderPlaygroundHtml(md, code, finalLang, title, isLive, icon, layout, isReadonly, hasTabs, warning, initialView);
      state.line = startLine + 1;
      return true;
    }

    // Otherwise, scan for closing tag `::: /playground` or `:::`
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
        if (nextContent.match(/^:::\s*playground\b/i)) {
          depth++;
        } else if (nextContent.match(/^:::\s*\/playground\b/i) || nextContent.match(/^:::\s*$/)) {
          depth--;
          if (depth === 0) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) return false;

    let rawCode = '';
    for (let i = startLine + 1; i < nextLine; i++) {
      const lineStart = state.bMarks[i];
      const lineEnd = state.eMarks[i];
      rawCode += state.src.slice(lineStart, lineEnd) + '\n';
    }

    // Strip wrapping fences if user wrote ```js ... ``` inside ::: playground
    const codeMatch = rawCode.trim().match(/^```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```$/);
    let finalCode = codeMatch ? codeMatch[2] : rawCode;
    if (!lang && codeMatch && codeMatch[1]) {
      lang = codeMatch[1];
    }

    // If source file was specified and inner block was empty or fallback, use source file code
    if (fileInfo && (!finalCode.trim() || srcPath)) {
      finalCode = fileInfo.code;
    }

    if (!lang) {
      lang = 'js';
    }

    const htmlToken = state.push('html_block', '', 0);
    htmlToken.content = renderPlaygroundHtml(md, finalCode, lang, title, isLive, icon, layout, isReadonly, hasTabs, warning, initialView);

    state.line = nextLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

function resolveAssetPath(subpath: string): string {
  const inDist = path.join(__dirname, 'assets', subpath);
  if (fs.existsSync(inDist)) return inDist;
  const inRoot = path.join(__dirname, '..', 'assets', subpath);
  if (fs.existsSync(inRoot)) return inRoot;
  return inDist;
}

export function getAssets(): Asset[] {
  return [
    {
      src: resolveAssetPath(path.join('js', 'playground.js')),
      dest: 'assets/js/docmd-playground.js',
      type: 'js',
      location: 'body',
      condition: { pageHtmlMatches: 'class="docmd-playground"' }
    },
    {
      src: resolveAssetPath(path.join('css', 'playground.css')),
      dest: 'assets/css/docmd-playground.css',
      type: 'css',
      location: 'head',
      condition: { pageHtmlMatches: 'class="docmd-playground"' }
    }
  ];
}
