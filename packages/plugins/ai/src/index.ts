/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/plugin-ai
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import path from 'path';
import fs from 'fs/promises';
import nativeFs from 'fs';
import { fileURLToPath } from 'url';
import type { PluginDescriptor, ActionContext, Asset } from '@docmd/api';
import { scriptLiteral } from '@docmd/utils';
import { DocmdAssistantEngine, createStandardTools } from 'docmd-assistant';

export const plugin: PluginDescriptor = {
  name: 'ai',
  version: '0.9.5',
  capabilities: ['init', 'body', 'assets', 'actions', 'translations', 'post-build']
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const i18nDir = path.resolve(__dirname, '..', 'i18n');

/** AI Plugin Configuration Interface */
export interface AIPluginOptions {
  enabled?: boolean;
  assistant?: boolean;
  chat?: boolean;
  captcha?: boolean;
  endpoint?: string;
  projectId?: string;
  siteId?: string;
  cloud?: {
    projectId?: string;
    siteId?: string;
  };
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  greeting?: string;
  placeholder?: string;
  suggestions?: string[];
  position?: 'bottom-center' | 'bottom-right' | 'bottom-left';
  reasoning?: boolean | 'none' | 'low' | 'medium' | 'high';
  contextLimit?: number;
  contextWindow?: number;
  rateLimit?: {
    maxRequests?: number;
    windowMs?: number;
  };
}

/** Default system prompt for documentation assistant */
const DEFAULT_SYSTEM_PROMPT = `You are docmd assistant — an expert, precise documentation assistant strictly dedicated to answering technical questions about this documentation site.

CRITICAL CONSTRAINTS & BEHAVIORAL RULES:
1. STRICT SCOPE & BOUNDARIES: Answer ONLY questions related to the software, APIs, tools, installation, configuration, and documentation provided on this site. If a user asks off-topic, general knowledge, or unrelated questions, politely refuse and explain that you are strictly trained to assist with this documentation.
2. STRICT FACTUALITY & ZERO FABRICATION: Ground all responses, configuration snippets, and code examples STRICTLY in facts and evidence explicitly retrieved from tool data or documentation results. NEVER invent, guess, or fabricate non-existent configuration keys (e.g. guessing \`socialLinks\`, \`nav\`, \`sidebar\` path maps, or \`search.provider\`), non-existent API parameters, or unverified settings. The actual configuration manifest is \`docmd.config.json\` (with core keys: \`title\`, \`url\`, \`logo\`, \`layout\`, \`theme\`, \`plugins\`, \`i18n\`, \`versions\`).
3. PROACTIVE TOOL USAGE:
   - Use the \`get_site_structure\` tool whenever you need extended structural inspection of available documentation versions, supported locales, or navigation trees.
   - Use the \`search_documentation\` tool to query documentation page content. Pass concise, targeted keywords (e.g. "comparison", "zero-config", "docmd.config.json", "docusaurus").
   - When asked why docmd is better than others, its advantages, or comparisons with other tools (Docusaurus, VitePress, MkDocs, Starlight), search for "comparison" to retrieve and cite the dedicated comparison benchmarks and payload matrices.
   - When asked about a specific documentation version (e.g. v0.8.0), specify the \`version\` parameter on \`search_documentation\` to filter results to that version.
4. ACCURACY & SOURCE CITATIONS: Ground all responses directly in retrieved tool data or documentation results. Reference relevant page titles or section headers with markdown links.
5. VERSION & LOCALIZATION AWARENESS: Be aware of the active documentation version and locale. Utilize localized and versioned results matching the user's request.
6. TECHNICAL & CONCISE: Provide clear, structured Markdown responses with code blocks where appropriate. Do not engage in casual off-topic banter.`;

/** Resolved configuration cache per build */
let _resolvedOptions: AIPluginOptions = {};

/** Simple in-memory rate limiting store (IP/Session -> timestamps) */
const rateLimitStore = new Map<string, number[]>();

export async function onConfigResolved(config: any): Promise<void> {
  const pluginOptions: AIPluginOptions = (config.plugins && config.plugins.ai) || config.ai || {};
  
  // Support both `assistant` and legacy `chat` config flags
  const isAssistantEnabled = pluginOptions.assistant !== false && pluginOptions.chat !== false && pluginOptions.enabled !== false;
  const targetProjectId = pluginOptions.projectId || pluginOptions.siteId || pluginOptions.cloud?.projectId || pluginOptions.cloud?.siteId;

  // Resolve cloud endpoint if targetProjectId is configured
  let endpoint = pluginOptions.endpoint;
  if (!endpoint && targetProjectId) {
    endpoint = 'https://api.docmd.io/v1/ai/chat';
  }

  // Pass provider and model through directly if configured; docmd-assistant / aiplug handles defaults
  const provider = pluginOptions.provider || process.env.AI_PROVIDER;
  const model = pluginOptions.model || process.env.AI_MODEL;

  _resolvedOptions = {
    enabled: isAssistantEnabled,
    assistant: isAssistantEnabled,
    chat: isAssistantEnabled,
    captcha: pluginOptions.captcha !== false,
    endpoint,
    projectId: targetProjectId,
    siteId: targetProjectId,
    cloud: { siteId: targetProjectId, projectId: targetProjectId, ...(pluginOptions.cloud || {}) },
    provider,
    model,
    apiKey: pluginOptions.apiKey || process.env.AI_API_KEY || (provider ? process.env[`${provider.toUpperCase()}_API_KEY`] : undefined) || process.env.OPENAI_API_KEY,
    systemPrompt: pluginOptions.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    greeting: pluginOptions.greeting,
    placeholder: pluginOptions.placeholder,
    suggestions: pluginOptions.suggestions,
    position: pluginOptions.position || 'bottom-center',
    contextLimit: pluginOptions.contextLimit || 5,
    rateLimit: {
      maxRequests: pluginOptions.rateLimit?.maxRequests || 10,
      windowMs: pluginOptions.rateLimit?.windowMs || 60000
    }
  };

  config._aiConfig = _resolvedOptions;
}

/** Load translation strings */
function loadPluginStrings(localeId: string): Record<string, string> {
  try {
    const localePath = path.join(i18nDir, `${localeId}.json`);
    if (nativeFs.existsSync(localePath)) {
      return JSON.parse(nativeFs.readFileSync(localePath, 'utf8'));
    }
  } catch { /* fallback */ }
  try {
    const enPath = path.join(i18nDir, 'en.json');
    if (nativeFs.existsSync(enPath)) {
      return JSON.parse(nativeFs.readFileSync(enPath, 'utf8'));
    }
  } catch { /* silent */ }
  return {};
}

export function translations(localeId: string): Record<string, string> {
  return loadPluginStrings(localeId || 'en');
}

/** RAG: Retrieve targeted documentation snippets via @docmd/plugin-search index */
async function searchDocumentationRAG(
  projectRoot: string,
  query: string,
  maxResults: number = 5
): Promise<Array<{ title: string; url: string; content: string }>> {
  const results: Array<{ title: string; url: string; content: string }> = [];

  const searchIndexCandidates = [
    path.join(projectRoot, '_site', '_docmd-search', 'search-index.json'),
    path.join(projectRoot, 'site', '_docmd-search', 'search-index.json'),
    path.join(projectRoot, '_docmd-search', 'search-index.json'),
  ];

  let searchIndexFile: string | null = null;
  for (const candidate of searchIndexCandidates) {
    if (nativeFs.existsSync(candidate)) {
      searchIndexFile = candidate;
      break;
    }
  }

  if (searchIndexFile) {
    try {
      const indexRaw = await fs.readFile(searchIndexFile, 'utf8');
      const parsedIndex = JSON.parse(indexRaw);
      const queryTerms = query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 1);

      let docEntries: Array<{ id: string; title?: string; text?: string; headings?: string }> = [];
      if (Array.isArray(parsedIndex)) {
        docEntries = parsedIndex;
      } else if (parsedIndex.documentIds && parsedIndex.documentMap) {
        docEntries = Object.values(parsedIndex.documentMap);
      } else if (parsedIndex.index && parsedIndex.index.documentMap) {
        docEntries = Object.values(parsedIndex.index.documentMap);
      }

      const scoredHits = docEntries.map(doc => {
        const titleStr = String(doc.title || doc.id || '').toLowerCase();
        const textStr = String(doc.text || '').toLowerCase();
        const headingsStr = String(doc.headings || '').toLowerCase();

        let score = 0;
        for (const term of queryTerms) {
          if (titleStr.includes(term)) score += 5;
          if (headingsStr.includes(term)) score += 3;
          if (textStr.includes(term)) score += 1;
        }
        return { doc, score };
      }).filter(h => h.score > 0).sort((a, b) => b.score - a.score);

      const topHits = scoredHits.slice(0, maxResults);
      for (const hit of topHits) {
        const doc = hit.doc;
        const title = doc.title || doc.id;
        const url = doc.id.startsWith('/') ? doc.id : `/${doc.id}`;
        const text = doc.text || '';
        results.push({
          title,
          url,
          content: text.length > 1200 ? text.slice(0, 1200) + '...' : text
        });
      }

      if (results.length > 0) {
        return results;
      }
    } catch {
      /* Fall back to scanning files directly */
    }
  }

  // Fallback: file scanner
  const srcDir = path.join(projectRoot, 'docs');
  if (!nativeFs.existsSync(srcDir)) return results;

  const queryTerms = query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const contentLower = content.toLowerCase();
          const matches = queryTerms.some(term => contentLower.includes(term));

          if (matches || queryTerms.length === 0) {
            const relPath = path.relative(srcDir, fullPath).replace(/\\/g, '/');
            const urlPath = '/' + relPath.replace(/\.md$/, '.html');
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title = titleMatch ? titleMatch[1].trim() : relPath;

            results.push({
              title,
              url: urlPath,
              content: content.slice(0, 1200)
            });
          }
        } catch { /* ignore */ }
      }
    }
  }

  await walk(srcDir);
  return results;
}

/** Check rate limiting per client */
function checkRateLimit(clientId: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
  const now = Date.now();
  let timestamps = rateLimitStore.get(clientId) || [];
  timestamps = timestamps.filter((t: number) => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    return false;
  }

  timestamps.push(now);
  rateLimitStore.set(clientId, timestamps);
  return true;
}

/** Named RPC Action Handlers */
export const actions = {
  /**
   * Action `ai:chat`
   * Called by client widget to complete an AI prompt using aiplug.
   */
  async 'ai:chat'(payload: any, ctx: ActionContext) {
    const { message, history = [] } = payload || {};
    if (!message || typeof message !== 'string') {
      throw new Error('Message payload is required');
    }

    const opts = ctx.config._aiConfig || _resolvedOptions;
    if (opts.enabled === false) {
      throw new Error('AI Assistant plugin is disabled in config.');
    }

    // Rate Limiting Protection
    const clientId = (ctx as any).clientIp || 'default_client';
    const maxReq = opts.rateLimit?.maxRequests || 10;
    const windowMs = opts.rateLimit?.windowMs || 60000;
    if (!checkRateLimit(clientId, maxReq, windowMs)) {
      throw new Error(`Rate limit exceeded (${maxReq} requests/min). Please wait a moment before sending another query.`);
    }

    const docsContext = await searchDocumentationRAG(ctx.projectRoot, message, opts.contextLimit || 5);
    const citations: Array<{ title: string; url: string }> = docsContext.map(d => ({ title: d.title, url: d.url }));

    const engine = new DocmdAssistantEngine({
      endpoint: opts.endpoint || 'https://api.docmd.io/v1/ai/chat',
      projectId: opts.projectId || opts.siteId,
      provider: opts.provider,
      model: opts.model,
      systemPrompt: opts.systemPrompt
    });

    const isSemanticUsable = ctx.config._searchConfig?.semanticUsable === true;

    engine.registerTool({
      name: 'get_site_structure',
      description: 'Get the complete documentation site structure, including available versions (current and historical), supported languages/locales, workspace projects, and page navigation hierarchy with titles and URLs.',
      execute: async () => {
        return {
          siteTitle: ctx.config.title || 'Documentation',
          versions: ctx.config.versions || null,
          i18n: ctx.config.i18n || null,
          navigation: ctx.config.navigation || null,
          searchCapabilities: {
            keyword: true,
            semantic: isSemanticUsable
          },
          workspaceProjects: (ctx.config._workspace?.projects || []).map((p: any) => ({
            name: p.name || p.title || p.prefix,
            prefix: p.prefix || '/',
            src: p.src || ''
          }))
        };
      }
    });

    // Register standard tools from docmd-assistant (navigate_to_page, copy_code_snippet, read_documentation_page, search_documentation)
    const standardTools = createStandardTools(
      async (query: string) => {
        const results = await searchDocumentationRAG(ctx.projectRoot, query, opts.contextLimit || 5);
        return results.map(r => ({ title: r.title, path: r.url, snippet: r.content }));
      },
      async (pagePath: string) => {
        const results = await searchDocumentationRAG(ctx.projectRoot, pagePath, 1);
        return results[0] ? { title: results[0].title, content: results[0].content } : { content: `Page not found: ${pagePath}` };
      }
    );
    for (const tool of standardTools) {
      engine.registerTool(tool);
    }

    // Override search_documentation with workspace-aware RAG search that includes semantic capability info
    engine.registerTool({
      name: 'search_documentation',
      description: `Search documentation pages across all projects in this workspace using keyword full-text matching ${isSemanticUsable ? 'and semantic vector search' : '(keyword search active; semantic search disabled)'}. Always supply concise, targeted keywords for best results.`,
      execute: async ({ query, project }: { query: string; project?: string }) => {
        return await searchDocumentationRAG(ctx.projectRoot, query, opts.contextLimit || 5);
      }
    });

    const res = await engine.sendMessage(message);
    return {
      text: res.message,
      citations,
      provider: opts.provider,
      model: opts.model
    };
  }
};

/** Script and container generator for page injection */
export function generateScripts(config: any, _options?: any): { headScriptsHtml: string; bodyScriptsHtml: string } {
  const pluginOptions: AIPluginOptions = config._aiConfig || (config.plugins && config.plugins.ai) || config.ai || {};
  if (pluginOptions.enabled === false || pluginOptions.assistant === false || pluginOptions.chat === false) {
    return { headScriptsHtml: '', bodyScriptsHtml: '' };
  }

  const targetProjectId = pluginOptions.projectId || pluginOptions.siteId || pluginOptions.cloud?.projectId || pluginOptions.cloud?.siteId;
  const endpoint = pluginOptions.endpoint || (targetProjectId ? 'https://api.docmd.io/v1/ai/chat' : '');

  const workspaceProjects = (config._workspace?.projects || []).map((p: any) => ({
    name: p.name || p.title || p.prefix,
    prefix: p.prefix || '/',
    src: p.src || ''
  }));

  const isSemanticUsable = config._searchConfig?.semanticUsable === true;

  const clientConfig: Record<string, any> = {
    endpoint,
    projectId: targetProjectId,
    cloud: { siteId: targetProjectId, projectId: targetProjectId, ...(pluginOptions.cloud || {}) },
    captcha: pluginOptions.captcha !== false,
    position: pluginOptions.position || 'bottom-center',
    greeting: pluginOptions.greeting,
    placeholder: pluginOptions.placeholder,
    suggestions: pluginOptions.suggestions,
    siteTitle: config.title || 'Documentation',
    siteBase: config.base || '/',
    siteUrl: config.url || '',
    versions: config.versions || null,
    i18n: config.i18n || null,
    navigation: config.navigation || null,
    searchCapabilities: {
      keyword: true,
      semantic: isSemanticUsable
    },
    isWorkspace: workspaceProjects.length > 0,
    workspaceProjects
  };
  if (pluginOptions.provider) clientConfig.provider = pluginOptions.provider;
  if (pluginOptions.model) clientConfig.model = pluginOptions.model;
  if (pluginOptions.contextWindow !== undefined) clientConfig.contextWindow = pluginOptions.contextWindow;
  if (pluginOptions.contextLimit !== undefined) clientConfig.contextLimit = pluginOptions.contextLimit;

  return {
    headScriptsHtml: '',
    bodyScriptsHtml: `<div id="docmd-ai-root"></div><script>window.__docmd_ai_config=${scriptLiteral(clientConfig)};</script>`
  };
}

/** External assets to inject into HTML pages */
export function getAssets(options?: any): Asset[] {
  const pluginOptions: AIPluginOptions = options || _resolvedOptions || {};
  if (pluginOptions.enabled === false || pluginOptions.assistant === false || pluginOptions.chat === false || _resolvedOptions.enabled === false) {
    return [];
  }

  const distDir = path.resolve(__dirname, '..', 'dist', 'client');
  const jsPath = path.join(distDir, 'index.js');
  const cssPath = path.join(distDir, 'ai.css');

  const assets: Asset[] = [];
  if (nativeFs.existsSync(jsPath)) {
    assets.push({
      src: jsPath,
      dest: 'assets/js/docmd-ai.js',
      type: 'js',
      location: 'body'
    });
  }
  if (nativeFs.existsSync(cssPath)) {
    assets.push({
      src: cssPath,
      dest: 'assets/css/docmd-ai.css',
      type: 'css',
      location: 'head'
    });
  }

  return assets;
}

/** Post Build Hook */
export async function onPostBuild({ log }: any): Promise<void> {
  if (_resolvedOptions.enabled !== false && log) {
    log('AI Assistant plugin ready for site.');
  }
}