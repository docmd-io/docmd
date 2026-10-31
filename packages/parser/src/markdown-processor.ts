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

import MarkdownIt from 'markdown-it';
import matter from 'lite-matter';
import { highlight } from 'lite-hl';
import { resolveHref } from './utils/normalize-href.js';
import {
  normaliseContainers,
  type NormaliserWarning
} from './utils/container-normaliser.js';
import { rewriteHtmlLinks, createUrlContext } from './utils/url-utils.js';
import { VariableRegistry, interpolateVariables, type VariableContext } from './variables/index.js';

// URL schemes that can execute code or exfiltrate data when clicked.
// Phase 1.B (T-S4 fix, defense in depth): markdown-it 14 already rejects these
// at the parser layer, but we re-check inside the link_open override so any
// future refactor of the parser pipeline cannot accidentally re-introduce them.
const DANGEROUS_URL_SCHEMES = new Set([
  'javascript:',
  'data:text/html',
  'vbscript:',
  'file:'
]);

function isDangerousHref(href: string): boolean {
  const lower = href.trim().toLowerCase();
  for (const prefix of DANGEROUS_URL_SCHEMES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Phase 2 (F1–F5): accumulated warnings, summarised once at the end of
 * the build via `flushNormaliserWarnings()`. Per-warning logging to
 * stderr is opt-in via `setNormaliserVerbose(true)` so the dev-server
 * console stays clean (one summary line per build instead of one line
 * per warning) while CI / verbose mode still gets the full detail.
 */
const normaliserWarnings: NormaliserWarning[] = [];
let normaliserVerbose = false;

function emitNormaliserWarning(w: NormaliserWarning): void {
  normaliserWarnings.push(w);
  if (normaliserVerbose) {
    console.warn(`[normaliser] ${w.severity.toUpperCase()} ${w.path}:${w.line} — ${w.message}`);
  }
}

export function setNormaliserVerbose(verbose: boolean): void {
  normaliserVerbose = verbose;
}

export function flushNormaliserWarnings(): void {
  if (normaliserWarnings.length === 0) return;
  const errors = normaliserWarnings.filter(w => w.severity === 'error').length;
  const warnings = normaliserWarnings.length - errors;
  const fileCount = new Set(normaliserWarnings.map(w => w.path)).size;
  const severity = errors > 0 ? 'ERROR' : 'WARN';
  const tag = errors > 0 ? '\x1b[31m' : '\x1b[33m';
  const reset = '\x1b[0m';
  console.warn(
    `${tag}[normaliser] ${severity}${reset} ` +
    `${normaliserWarnings.length} issue${normaliserWarnings.length === 1 ? '' : 's'} ` +
    `(${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}) ` +
    `across ${fileCount} file${fileCount === 1 ? '' : 's'}. ` +
    `Run with --verbose to list each one.`
  );
  normaliserWarnings.length = 0;
}

/**
 * Phase 2 (F1–F5): run the container normaliser on the markdown body before
 * it is handed to markdown-it (and before any user plugin's `onBeforeParse`
 * hook so they always see balanced input).
 *
 * The function is allocation-only on the input — no module-level state — so
 * output is deterministic across worker threads.
 */
function applyContainerNormaliser(markdownContent: string, env: { filePath?: string }): string {
  const norm = normaliseContainers(markdownContent, {
    sourcePath: env && env.filePath ? env.filePath : '<source>',
    onWarning: emitNormaliserWarning
  });
  return norm.source;
}

// Standard Plugins
import attrs from 'markdown-it-attrs';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import abbr from 'markdown-it-abbr';
import deflist from 'markdown-it-deflist';
import emoji from 'markdown-it-emoji';

// The Feature Registry
import { registerFeatures } from './features/index.js';

// Custom Heading ID & Anchor Logic
const headingIdPlugin = (md, options: any = {}) => {
  const uiStrings = options.uiStrings || {};
  md.core.ruler.push('heading_anchors', function (state) {
    let containerDepth = 0;
    const lastHeadingIds = new Array(7).fill(null);
    const usedIds = new Map();

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];

      // Track block-level inline containers (like steps)
      if (token.type === 'steps_open' || (token.type.startsWith('custom_') && token.type.endsWith('_open'))) {
        containerDepth++;
      }
      if (token.type === 'steps_close' || (token.type.startsWith('custom_') && token.type.endsWith('_close'))) {
        containerDepth--;
      }

      const inContainer = state.env.isInsideContainer || containerDepth > 0;

      if (token.type === 'heading_open') {
        const level = parseInt(token.tag.slice(1), 10);
        const inlineToken = state.tokens[i + 1];

        // 1. Generate ID if not present and NOT in a container
        let id = token.attrGet('id');
        if (!id && inlineToken && inlineToken.content && !inContainer) {
          const slug = inlineToken.content
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\p{L}\p{N}-]+/gu, '')
            .replace(/--+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');

          if (slug) {
            // Find parent ID from previous levels
            let parentId = null;
            for (let j = level - 1; j >= 1; j--) {
              if (lastHeadingIds[j]) {
                parentId = lastHeadingIds[j];
                break;
              }
            }

            id = parentId ? `${parentId}-${slug}` : slug;

            // Handle hard collisions (same heading sequence twice)
            if (usedIds.has(id)) {
              const count = usedIds.get(id);
              usedIds.set(id, count + 1);
              id = `${id}-${count}`;
            } else {
              usedIds.set(id, 1);
            }

            token.attrSet('id', id);
            lastHeadingIds[level] = id;
            // Clear deeper levels to prevent wrong parent nesting on backtrack
            for (let j = level + 1; j <= 6; j++) lastHeadingIds[j] = null;
          }
        }

        // If we are in a container, strip existing IDs so they don't break the TOC parsing
        if (inContainer) {
          if (token.attrs) {
            token.attrs = token.attrs.filter(a => a[0] !== 'id');
          }
          id = null;
        }

        // 2. Inject Hover Anchor as an HTML Token (for H1, H2, H3, H4)
        if (id && level >= 1 && level <= 4 && !inContainer) {
          const existingClass = token.attrGet('class') || '';
          token.attrSet('class', `${existingClass} docmd-heading`.trim());

          if (inlineToken && inlineToken.children) {
            const anchorToken = new state.Token('html_inline', '', 0);
            const anchorLabel = uiStrings.permalinkToSection || 'Permalink to this section';
            anchorToken.content = `<a href="#${id}" class="heading-anchor" aria-label="${anchorLabel}"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link2-icon lucide-link-2"><path d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 1 1 0 10h-2m-7-5h8"/></svg></a>`;

            // Insert the anchor at the beginning of the heading text
            inlineToken.children.unshift(anchorToken);
          }
        }
      }
    }
  });
};

// Main Factory Function to Create a Markdown Processor
function createMarkdownProcessor(config: any = {}, pluginsCallback: any) {
  // HTML policy from config (default 'allow').
  // 'allow'  -> markdown-it html: true (raw HTML passes through — industry standard)
  // 'escape' -> markdown-it html: false (HTML escaped and shown as text)
  // 'strip'  -> html: false + disable html_block/html_inline rules (HTML removed)
  const htmlPolicy = (config && config.security && config.security.html) || 'allow';
  const mdOptions: any = {
    html: htmlPolicy === 'allow',
    linkify: config.markdown?.linkify ?? true,
    typographer: config.markdown?.typographer ?? true,
    breaks: config.markdown?.breaks ?? true,
  };

  // Syntax Highlighting (title extraction is handled separately in the fence renderer)
  const highlightFn = (str: any, lang: any) => {
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${new MarkdownIt().utils.escapeHtml(str)}</pre>`;
    }
    const highlighted = highlight(str, { language: lang, mimicHljs: true }).value;
    // Tag the code with language-xxx so consumers (e.g. the summer
    // template's codeblock title bar) can pick up the language.
    const langAttr = lang ? ` class="language-${lang}"` : '';
    return `<pre class="hljs"><code${langAttr}>${highlighted}</code></pre>`;
  };

  mdOptions.highlight = config.theme?.codeHighlight !== false ? highlightFn : (str: any, lang: any) => {
    if (lang === 'mermaid') return `<pre class="mermaid">${new MarkdownIt().utils.escapeHtml(str)}</pre>`;
    const langAttr = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langAttr}>${new MarkdownIt().utils.escapeHtml(str)}</code></pre>`;
  };

  const md = new MarkdownIt(mdOptions);

  // Linkify-it's default normalizer prepends http:// when match.schema is empty.
  // Explicit protocols (http://, mailto:, etc.) have a non-empty schema and are left intact.
  // linkifyDefaultScheme controls what we replace http:// with for schemeless matches.
  // Industry default is 'https' — virtually all public sites support HTTPS.
  if (mdOptions.linkify && md.linkify) {
    const linkifyScheme = (config.markdown?.linkifyDefaultScheme === 'http') ? 'http' : 'https';
    const defaultNormalize = md.linkify.normalize.bind(md.linkify);
    md.linkify.normalize = (match: any) => {
      defaultNormalize(match);
      // match.schema is empty string for bare domains (e.g. github.com),
      // non-empty (e.g. 'http:') for explicit-scheme URLs.
      if (!match.schema) {
        match.url = `${linkifyScheme}://${match.url.replace(/^https?:\/\//, '')}`;
      }
    };
  }

  const HTML_SEQUENCES: [RegExp, RegExp][] = [
  [/^<(script|pre|style|textarea)(?=(\s|>|$))/i, /<\/(script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<![A-Z]/, />/],
  [/^<!\[CDATA\[/, /\]\]>/]
];

function getHtmlTagDelta(line: string): number {
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  let delta = 0;
  const tagRegex = /<\/?([a-zA-Z0-9-]+)(?:\s+[^>]*?)?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(line)) !== null) {
    const tagName = m[1].toLowerCase();
    const isSelfClosing = m[2] === '/' || voidTags.has(tagName);
    const isClosing = m[0].startsWith('</');
    if (isSelfClosing) continue;
    if (isClosing) {
      delta -= 1;
    } else {
      delta += 1;
    }
  }
  return delta;
}

function customHtmlBlock(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];

  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (!state.md.options.html) return false;
  if (state.src.charCodeAt(pos) !== 0x3C /* < */) return false;

  const lineText = state.src.slice(pos, max);

  let seqIdx = -1;
  for (let i = 0; i < HTML_SEQUENCES.length; i++) {
    if (HTML_SEQUENCES[i][0].test(lineText.trim())) {
      seqIdx = i;
      break;
    }
  }

  if (seqIdx !== -1) {
    if (silent) return true;
    let nextLine = startLine + 1;
    const closeReg = HTML_SEQUENCES[seqIdx][1];
    if (!closeReg.test(lineText)) {
      for (; nextLine < endLine; nextLine++) {
        const p = state.bMarks[nextLine] + state.tShift[nextLine];
        const m = state.eMarks[nextLine];
        const lText = state.src.slice(p, m);
        if (closeReg.test(lText)) {
          if (lText.length !== 0) nextLine++;
          break;
        }
      }
    }
    state.line = nextLine;
    const token = state.push('html_block', '', 0);
    token.map = [startLine, nextLine];
    token.content = state.getLines(startLine, nextLine, state.blkIndent, true);
    return true;
  }

  if (!/^<\/?([a-zA-Z0-9-]+)/i.test(lineText.trim())) return false;
  if (silent) return true;

  let nextLine = startLine + 1;
  let depth = getHtmlTagDelta(lineText);

  for (; nextLine < endLine; nextLine++) {
    if (depth <= 0 && state.isEmpty(nextLine)) {
      break;
    }
    const p = state.bMarks[nextLine] + state.tShift[nextLine];
    const m = state.eMarks[nextLine];
    const lText = state.src.slice(p, m);
    depth += getHtmlTagDelta(lText);
    if (depth <= 0 && lText.trim().endsWith('>')) {
      nextLine++;
      break;
    }
  }

  state.line = nextLine;

  const token = state.push('html_block', '', 0);
  token.map = [startLine, nextLine];
  token.content = state.getLines(startLine, nextLine, state.blkIndent, true);

  return true;
}

// 'strip' policy: drop html_block and html_inline rules entirely so HTML
  // tokens are never emitted. Distinct from 'escape' which keeps tokens and
  // HTML-escapes their content.
  if (htmlPolicy === 'strip') {
    md.disable(['html_block', 'html_inline']);
  } else if (htmlPolicy === 'allow') {
    md.block.ruler.at('html_block', customHtmlBlock);
  }

  // Core Plugins
  md.use(attrs, { leftDelimiter: '{', rightDelimiter: '}' });
  md.use(footnote);
  md.use(taskLists);
  md.use(abbr);
  md.use(deflist);
  md.use(emoji);
  md.use(headingIdPlugin, { uiStrings: config._uiStrings || {} });

  // Register Built-in Features
  registerFeatures(md);

  // External Plugins Hook
  if (typeof pluginsCallback === 'function') {
    pluginsCallback(md);
  }

  // Custom Fence Renderer: Extracts title from token.info (e.g., ```js "filename.js")
  // markdown-it only passes the first word as `lang` to highlight(), so the title
  // in quotes never reaches the highlight function. We intercept it here instead.
  const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules);
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const info = (token.info || '').trim();

    // Match: language "title" or language 'title'
    const titleMatch = info.match(/^[a-zA-Z0-9+#*-]*\s+["']([^"']+)["']/);

    // Get the default rendered output (which includes the highlighted code)
    const rendered = defaultFence(tokens, idx, options, env, self);

    if (titleMatch) {
      const title = titleMatch[1];
      return `<div class="docmd-code-block-wrapper"><div class="docmd-code-block-header"><span class="docmd-code-block-title">${title}</span></div>${rendered}</div>`;
    }

    return rendered;
  };

  const defaultLinkOpen = md.renderer.rules.link_open || function (tokens: any, idx: any, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.link_open = function (tokens: any, idx: any, options: any, env: any, self: any) {
    const token = tokens[idx];
    const hrefIndex = token.attrIndex('href');

    if (hrefIndex >= 0) {
      const href = token.attrs[hrefIndex][1];

      // Phase 1.B (T-S4 fix): drop dangerous schemes. The link is rendered as
      // a safe hash-anchor instead so the surrounding text still appears as a
      // clickable (but inert) element.
      if (isDangerousHref(href)) {
        token.attrs[hrefIndex][1] = '#';
        return self.renderToken(tokens, idx, options);
      }

      const isHashOnly = href.startsWith('#');
      const isAsset = href.match(/(^|\/)assets\//);

      if (!isHashOnly && !isAsset) {
        const result = resolveHref(href);

        if (!result.isRaw) {
          let pathPart = result.href;
          let hashPart = '';
          const hi = pathPart.indexOf('#');
          if (hi >= 0) {
            hashPart = pathPart.substring(hi);
            pathPart = pathPart.substring(0, hi);
          }

          // Depth adjustment for clean URLs (non-index pages are shifted into subfolders)
          const isProtocol = pathPart.match(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
          if (!isProtocol && !pathPart.startsWith('/') && env && env.isIndex === false) {
            if (pathPart.startsWith('./')) {
              pathPart = '../' + pathPart.substring(2);
            } else if (pathPart !== '') {
              pathPart = '../' + pathPart;
            }
          }

          token.attrs[hrefIndex][1] = pathPart + hashPart;
        } else {
          token.attrs[hrefIndex][1] = result.href;
        }

        // Apply external attributes
        if (result.isExternal) {
          token.attrSet('target', '_blank');
          token.attrSet('rel', 'noopener noreferrer');
        }
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  if (typeof pluginsCallback === 'function') {
    pluginsCallback(md);
  }

  return md;
}

function stripHtml(html: any) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '');
}

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function extractHeadings(html: any) {
  const headings: any[] = [];
  // Require non-empty ID match to exclude stripped container headings: "([^"]+)"
  const regex = /<h([1-6])[^>]*?id="([^"]+)"[^>]*?>([\s\S]*?)<\/h\1>/g;
  let match: any;
  while ((match = regex.exec(html)) !== null) {
    const rawText = match[3].replace(/<\/?[^>]+(>|$)/g, '').trim();
    headings.push({
      level: parseInt(match[1], 10),
      id: match[2],
      text: decodeHtmlEntities(rawText)
    });
  }
  return headings;
}

function processContent(rawString: any, mdInstance: any, config: any, env: any = {}) {
  let frontmatter: any, markdownContent: any;

  try {
    const parsed = matter(rawString);
    frontmatter = parsed.data;
    markdownContent = parsed.content;
  } catch (e: any) {
    console.error('Error parsing frontmatter:', e.message);
    return null;
  }

  if (!frontmatter.title && config.autoTitleFromH1 !== false) {
    const h1Match = markdownContent.match(/^#\s+(.*)/m);
    if (h1Match) frontmatter.title = h1Match[1].trim();
  }

  // Interpolate variables (builtins, env, config, frontmatter)
  const registry: VariableRegistry = env?.variableRegistry || config?._variableRegistry || new VariableRegistry({
    configVariables: config?.variables,
    siteTitle: config?.title || config?.siteTitle,
    siteBase: config?.base
  });

  const varContext: VariableContext = {
    pageTitle: frontmatter.title,
    pagePath: env?.path,
    frontmatter
  };

  if (frontmatter.title && typeof frontmatter.title === 'string' && frontmatter.title.includes('{{')) {
    frontmatter.title = interpolateVariables(frontmatter.title, registry, varContext, { wrapDynamic: false });
  }
  if (frontmatter.description && typeof frontmatter.description === 'string' && frontmatter.description.includes('{{')) {
    frontmatter.description = interpolateVariables(frontmatter.description, registry, varContext, { wrapDynamic: false });
  }

  markdownContent = interpolateVariables(markdownContent, registry, varContext);

  // Phase 2 (F1–F5): rewrite unbalanced `:::` containers so the existing
  // depth-tracking block rule in features/common-containers.ts always sees
  // a matching close.
  markdownContent = applyContainerNormaliser(markdownContent, env);

  const htmlContent = mdInstance.render(markdownContent, env);
  const headings = extractHeadings(htmlContent);

  let searchData = null;
  if (!frontmatter.noindex) {
    searchData = {
      title: frontmatter.title || 'Untitled',
      content: stripHtml(htmlContent).slice(0, 5000),
      headings: headings.map((h: any) => ({ id: h.id, text: h.text }))
    };
  }

  return { frontmatter, htmlContent, headings, searchData };
}

async function processContentAsync(rawString: string, mdInstance: any, config: any, env: any = {}, hooks: any = null) {
  let frontmatter: any, markdownContent: any;

  try {
    const parsed = matter(rawString);
    frontmatter = parsed.data;
    markdownContent = parsed.content;
  } catch (e: any) {
    console.error('Error parsing frontmatter:', e.message);
    return null;
  }

  if (!frontmatter.title && config.autoTitleFromH1 !== false) {
    const h1Match = markdownContent.match(/^#\s+(.*)/m);
    if (h1Match) frontmatter.title = h1Match[1].trim();
  }

  // Interpolate variables (builtins, env, config, frontmatter)
  const registryAsync: VariableRegistry = env?.variableRegistry || config?._variableRegistry || new VariableRegistry({
    configVariables: config?.variables,
    siteTitle: config?.title || config?.siteTitle,
    siteBase: config?.base
  });

  const varContextAsync: VariableContext = {
    pageTitle: frontmatter.title,
    pagePath: env?.path,
    frontmatter
  };

  if (frontmatter.title && typeof frontmatter.title === 'string' && frontmatter.title.includes('{{')) {
    frontmatter.title = interpolateVariables(frontmatter.title, registryAsync, varContextAsync, { wrapDynamic: false });
  }
  if (frontmatter.description && typeof frontmatter.description === 'string' && frontmatter.description.includes('{{')) {
    frontmatter.description = interpolateVariables(frontmatter.description, registryAsync, varContextAsync, { wrapDynamic: false });
  }

  markdownContent = interpolateVariables(markdownContent, registryAsync, varContextAsync);

  // Phase 2 (F1–F5): rewrite unbalanced `:::` containers BEFORE user plugins
  // so they always see balanced input, and BEFORE markdown-it so the
  // depth-tracking block rule can match every container it sees.
  markdownContent = applyContainerNormaliser(markdownContent, env);

  if (hooks && hooks.onBeforeParse) {
    for (const fn of hooks.onBeforeParse) {
      // D-H7: previously a throw from any plugin's onBeforeParse would
      // either propagate up (abort the file) or, after the safeCall
      // wrapper landed, leave `markdownContent` set to `undefined` and
      // crash the next iteration. We now catch each plugin's throw
      // locally, log it via TUI, and keep walking the chain so plugins
      // B, C, ... still see input (even if A's contribution is lost).
      try {
        const next = await fn(markdownContent, frontmatter, env.filePath);
        // Only adopt the plugin's output if it returned a string.
        // Plugins that want to "skip" should return undefined (we keep
        // the previous markdown) rather than returning null.
        if (typeof next === 'string') {
          markdownContent = next;
        }
      } catch (err: any) {
        const msg = err && err.message ? err.message : String(err);
        console.error(`[parser] onBeforeParse plugin threw: ${msg}`);
      }
    }
  }

  if (!frontmatter.title && config.autoTitleFromH1 !== false) {
    const h1Match = markdownContent.match(/^#\s+(.*)/m);
    if (h1Match) frontmatter.title = h1Match[1].trim();
  }

  let htmlContent = mdInstance.render(markdownContent, env);
  if (env) {
    // Single canonical HTML-link rewrite pass. All URL rules — offline
    // index.html suffixing, clean-URL collapsing, external pass-through,
    // hash preservation, base-path stripping, and default-locale prefix
    // stripping — live in exactly one place: url-utils.ts via
    // buildRootRelativeUrl. This replaces the former parallel pipelines
    // (fixHtmlLinks + rewriteInternalHrefsForOffline + stripDefaultLocalePrefix).
    const urlContext = createUrlContext({
      relativePathToRoot: env.relativePathToRoot || './',
      outputPrefix: env.outputPrefix || '',
      offline: env.isOfflineMode === true,
      base: env.config?.base || '/',
      siteUrl: config.url || '',
      pathname: env.pathname,
      projectPrefix: config._activePrefix || '/',
      workspaceProjects: config._workspace?.projects || [],
      allLocales: env.allLocales || (config._allLocales || []).map((l: any) => l.id),
    });
    htmlContent = rewriteHtmlLinks(htmlContent, urlContext, {
      defaultLocale: env.defaultLocale || null,
      allLocales: env.allLocales,
    });
  }

  if (hooks && hooks.onAfterParse) {
    for (const fn of hooks.onAfterParse) {
      htmlContent = await fn(htmlContent, frontmatter, env.filePath);
    }
  }

  const headings = extractHeadings(htmlContent);

  let searchData = null;
  if (!frontmatter.noindex) {
    searchData = {
      title: frontmatter.title || 'Untitled',
      content: stripHtml(htmlContent).slice(0, 5000),
      headings: headings.map((h: any) => ({ id: h.id, text: h.text }))
    };
  }

  return { frontmatter, htmlContent, headings, searchData };
}

export { createMarkdownProcessor, processContent, processContentAsync };