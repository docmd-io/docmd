/**
 * Client-side entry for @docmd/plugin-ai
 * docmd AI Assistant — Floating bottom prompt bar & floating sidebar drawer.
 * Features clean modern styling, adaptive light/dark theme, documentation RAG grounding, and Cmd+I shortcut.
 */

import { DocmdAssistantEngine, createStandardTools } from 'docmd-assistant';

export class DocmdAIAssistantUI {
  private engine: any = null;
  private container: HTMLElement | null = null;
  private isDrawerOpened = false;
  private isPending = false;
  private projectId = '';
  private isUnconfigured = false;

  constructor() {
    const rawCfg = (window as any).__docmd_ai_config || (window as any).__DOCMD_AI_CONFIG__;
    if (!rawCfg || rawCfg.enabled === false || rawCfg.assistant === false || rawCfg.chat === false) {
      return;
    }
    const cfg = rawCfg;
    this.projectId = cfg.projectId || cfg.siteId || cfg.cloud?.projectId || cfg.cloud?.siteId || 'default';
    this.isUnconfigured = (!cfg.projectId || cfg.projectId === 'default') && !cfg.apiKey && !cfg.baseURL;

    const initialSystemPrompt = this.buildSystemPrompt();

    this.engine = new DocmdAssistantEngine({
      projectId: this.projectId,
      endpoint: cfg.endpoint || (this.projectId ? 'https://api.docmd.io/v1/ai/chat' : undefined),
      provider: cfg.provider,
      model: cfg.model,
      systemPrompt: initialSystemPrompt,
      reasoning: cfg.reasoning ?? false,
      contextWindow: cfg.contextWindow
    });

    const isSemanticUsable = cfg.searchCapabilities?.semantic === true;

    // Register standard tools from docmd-assistant (navigate_to_page, copy_code_snippet, read_documentation_page)
    const standardTools = createStandardTools(
      async (query: string) => {
        return await this.searchAllWorkspaceIndexes(query);
      }
    );
    for (const tool of standardTools) {
      this.engine.registerTool(tool);
    }

    this.engine.registerTool({
      name: 'get_site_structure',
      description: 'Get the complete documentation site structure, including available versions (current and historical), supported languages/locales, workspace projects, search capabilities, and page navigation hierarchy with titles and URLs.',
      parameters: {
        type: 'object',
        properties: {}
      },
      execute: async () => {
        return this.getSiteStructure();
      }
    });

    this.engine.registerTool({
      name: 'search_documentation',
      description: `Search documentation pages across all projects in this workspace using full-text keyword matching ${isSemanticUsable ? 'and semantic vector search' : '(keyword search active; semantic search disabled)'}. Always supply concise, targeted search terms for highest accuracy. You can optionally filter by version (e.g. "0.9.0", "0.8.0", "latest") or workspace project (e.g. "/", "assistant", "search").`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Targeted search query keywords or phrases (e.g. "comparison", "docmd.config.json", "zero-config", "docusaurus", "release notes").'
          },
          version: {
            type: 'string',
            description: 'Optional documentation version filter (e.g. "0.9.0", "0.8.0", "latest", "09", "08") to search exclusively in that version branch.'
          },
          project: {
            type: 'string',
            description: 'Optional workspace project name or prefix filter (e.g. "/", "assistant", "search") to search within a specific project.'
          }
        },
        required: ['query']
      },
      execute: async (rawArgs: any) => {
        const query = typeof rawArgs === 'string'
          ? rawArgs
          : (rawArgs?.query || rawArgs?.q || rawArgs?.search_query || rawArgs?.text || rawArgs?.input || '');
        const project = typeof rawArgs === 'object' ? (rawArgs?.project || rawArgs?.projectFilter) : undefined;
        const version = typeof rawArgs === 'object' ? (rawArgs?.version || rawArgs?.versionFilter) : undefined;
        return await this.searchAllWorkspaceIndexes(query, project, version);
      }
    });

    if (typeof document !== 'undefined') {
      this.mount();
    }
  }



  private renderSuggestionsHtml(): string {
    const cfg = (window as any).__docmd_ai_config || {};
    const rawSuggestions = cfg.suggestions;

    const genericOptions = [
      { label: 'How do I get started?', prompt: 'How do I get started with this project?' },
      { label: 'Key Features', prompt: 'What are the main features documented here?' },
      { label: 'Installation & Setup', prompt: 'How do I install and set up this project?' },
      { label: 'Configuration Options', prompt: 'What configuration options are available?' },
      { label: 'Quick Example', prompt: 'Can you show me a quick usage example from the docs?' }
    ];

    let items: Array<{ label: string; prompt: string }> = [];

    if (Array.isArray(rawSuggestions) && rawSuggestions.length > 0) {
      items = rawSuggestions.map((item: any) => {
        if (typeof item === 'string') {
          return { label: item, prompt: item };
        }
        return {
          label: item.label || item.prompt || item.title || 'Question',
          prompt: item.prompt || item.label || item.title || item
        };
      });
    } else {
      const shuffled = [...genericOptions].sort(() => Math.random() - 0.5);
      items = shuffled.slice(0, 2);
    }

    const buttons = items
      .map(item => `<button class="docmd-ai-pill-btn" data-prompt="${this.escapeHtml(item.prompt)}">${this.escapeHtml(item.label)}</button>`)
      .join('');

    return `<div class="docmd-ai-suggestions-row">${buttons}</div>`;
  }

  private mount(): void {
    if (document.getElementById('docmd-ai-plugin-root')) return;

    const rawCfg = (window as any).__docmd_ai_config || (window as any).__DOCMD_AI_CONFIG__;
    if (!rawCfg || rawCfg.enabled === false || rawCfg.assistant === false || rawCfg.chat === false) return;
    const cfg = rawCfg;
    const i18n = (window as any).__DOCMD_AI_I18N__ || {};

    const pos = cfg.position || 'bottom-center';
    const placeholder = cfg.placeholder || i18n['ai.inputPlaceholder'] || 'Ask AI Assistant...';
    const greeting = cfg.greeting || i18n['ai.greeting'] || 'Hello! Ask me anything about this documentation.';
    const chatTitle = i18n['ai.chatTitle'] || 'AI Assistant';
    const clearTitle = i18n['ai.clearChat'] || 'Clear History';
    const closeTitle = i18n['ai.close'] || 'Close AI Assistant';

    this.container = document.createElement('div');
    this.container.id = 'docmd-ai-plugin-root';
    this.container.className = `pos-${pos}`;
    this.container.innerHTML = `
      <!-- Floating Bottom Prompt Bar -->
      <div class="docmd-ai-bar-wrap" id="docmd-ai-bar-wrap">
        <form class="docmd-ai-prompt-bar" id="docmd-ai-bar-form">
          <span class="docmd-ai-sparkle-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          </span>
          <input type="text" class="docmd-ai-bar-input" id="docmd-ai-bar-input" placeholder="${placeholder}" autocomplete="off" />
          <span class="docmd-ai-shortcut-badge">⌘I</span>
          <button type="submit" class="docmd-ai-submit-btn" title="Send (Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
          </button>
        </form>
      </div>

      <!-- Floating Sidebar Drawer -->
      <div class="docmd-ai-drawer" id="docmd-ai-drawer">
        <div class="docmd-ai-drawer-header">
          <div class="docmd-ai-header-left">
            <span class="docmd-ai-status-dot"></span>
            <span class="docmd-ai-title-text">${chatTitle}</span>
            <!--<span class="docmd-ai-badge-tag">docmd</span>-->
          </div>
          <div class="docmd-ai-header-right">
            <button class="docmd-ai-icon-action" id="docmd-ai-clear-btn" title="${clearTitle}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button class="docmd-ai-icon-action" id="docmd-ai-close-btn" title="${closeTitle}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="docmd-ai-messages-list" id="docmd-ai-messages">
          <div class="docmd-ai-chat-bubble assistant">
            ${greeting}
            ${this.renderSuggestionsHtml()}
          </div>
        </div>

        <div class="docmd-ai-drawer-footer">
          <form class="docmd-ai-drawer-form" id="docmd-ai-drawer-form">
            <input type="text" class="docmd-ai-drawer-input" id="docmd-ai-drawer-input" placeholder="${placeholder}" autocomplete="off" />
            <button type="submit" class="docmd-ai-drawer-send-btn" title="Send (Enter)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
            </button>
          </form>
          <div class="docmd-ai-footer-branding">
            <a href="https://docmd.io/assistant/" target="_blank" rel="noopener" class="docmd-ai-footer-link">${i18n['ai.poweredBy'] || 'Powered by docmd assistant'}</a>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    this.bindEvents();
  }



  private bindEvents(): void {
    const barWrap = document.getElementById('docmd-ai-bar-wrap');
    const barForm = document.getElementById('docmd-ai-bar-form');
    const barInput = document.getElementById('docmd-ai-bar-input') as HTMLInputElement;

    const drawer = document.getElementById('docmd-ai-drawer');
    const closeBtn = document.getElementById('docmd-ai-close-btn');
    const clearBtn = document.getElementById('docmd-ai-clear-btn');
    const drawerForm = document.getElementById('docmd-ai-drawer-form');
    const drawerInput = document.getElementById('docmd-ai-drawer-input') as HTMLInputElement;

    barForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.isPending) return;
      const query = barInput.value.trim();
      if (!query) return;
      barInput.value = '';
      this.openDrawer();
      this.submitQuery(query);
    });

    closeBtn?.addEventListener('click', () => this.closeDrawer());
    clearBtn?.addEventListener('click', () => this.clearChat());

    drawerForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.isPending) return;
      const query = drawerInput.value.trim();
      if (!query) return;
      drawerInput.value = '';
      this.submitQuery(query);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        if (this.isDrawerOpened) {
          this.closeDrawer();
        } else {
          this.openDrawer();
          drawerInput?.focus();
        }
      } else if (e.key === 'Escape' && this.isDrawerOpened) {
        this.closeDrawer();
      }
    });

    const msgsContainer = document.getElementById('docmd-ai-messages');
    msgsContainer?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      const copyBtn = target.closest('.docmd-ai-code-copy-btn') as HTMLButtonElement | null;
      if (copyBtn) {
        const wrap = copyBtn.closest('.docmd-ai-code-wrap');
        const codeEl = wrap?.querySelector('code');
        if (codeEl) {
          const textToCopy = codeEl.textContent || '';
          const copySvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
          const checkSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          navigator.clipboard.writeText(textToCopy).then(() => {
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = `${checkSvg}<span>Copied</span>`;
            setTimeout(() => {
              copyBtn.classList.remove('copied');
              copyBtn.innerHTML = `${copySvg}<span>Copy</span>`;
            }, 2000);
          }).catch((err) => {
            console.error('[docmd-ai] Failed to copy code snippet:', err);
          });
        }
        return;
      }

      if (target && target.classList.contains('docmd-ai-pill-btn')) {
        if (this.isPending) return;
        const prompt = target.getAttribute('data-prompt');
        if (prompt) {
          this.openDrawer();
          this.submitQuery(prompt);
        }
      }
    });
  }

  private setPendingState(pending: boolean): void {
    this.isPending = pending;

    const barInput = document.getElementById('docmd-ai-bar-input') as HTMLInputElement;
    const barSubmitBtn = document.querySelector('#docmd-ai-bar-form button[type="submit"]') as HTMLButtonElement;
    const drawerInput = document.getElementById('docmd-ai-drawer-input') as HTMLInputElement;
    const drawerSubmitBtn = document.querySelector('#docmd-ai-drawer-form button[type="submit"]') as HTMLButtonElement;
    const pillBtns = document.querySelectorAll('.docmd-ai-pill-btn') as NodeListOf<HTMLButtonElement>;

    if (barInput) barInput.disabled = pending;
    if (barSubmitBtn) barSubmitBtn.disabled = pending;
    if (drawerInput) drawerInput.disabled = pending;
    if (drawerSubmitBtn) drawerSubmitBtn.disabled = pending;

    pillBtns.forEach(btn => {
      btn.disabled = pending;
      if (pending) btn.classList.add('disabled');
      else btn.classList.remove('disabled');
    });

    const barForm = document.getElementById('docmd-ai-bar-form');
    const drawerForm = document.getElementById('docmd-ai-drawer-form');
    if (pending) {
      barForm?.classList.add('pending');
      drawerForm?.classList.add('pending');
    } else {
      barForm?.classList.remove('pending');
      drawerForm?.classList.remove('pending');
    }
  }

  private openDrawer(): void {
    this.isDrawerOpened = true;
    const barWrap = document.getElementById('docmd-ai-bar-wrap');
    const drawer = document.getElementById('docmd-ai-drawer');
    barWrap?.classList.add('hidden');
    drawer?.classList.add('open');
    if (typeof document !== 'undefined' && document.body.classList.contains('tc-panel-open')) {
      document.body.classList.remove('tc-panel-open');
    }
  }

  private closeDrawer(): void {
    this.isDrawerOpened = false;
    const barWrap = document.getElementById('docmd-ai-bar-wrap');
    const drawer = document.getElementById('docmd-ai-drawer');
    drawer?.classList.remove('open');
    barWrap?.classList.remove('hidden');
  }

  private buildSystemPrompt(): string {
    const cfg = (window as any).__docmd_ai_config || {};
    const currentUrl = typeof location !== 'undefined' ? location.href : '';
    const siteTitle = cfg.siteTitle || (typeof document !== 'undefined' ? document.title : 'Documentation');
    const isWorkspace = !!(cfg.isWorkspace && Array.isArray(cfg.workspaceProjects) && cfg.workspaceProjects.length > 0);
    const getSiteBaseUrl = (): string => {
      const cfg = (window as any).__docmd_ai_config || {};
      let base = cfg.siteBase || '/';
      if (typeof location !== 'undefined') {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocal && base !== '/' && !location.pathname.startsWith(base)) {
          base = '/';
        }
        return new URL(base.startsWith('/') ? base : '/' + base, location.origin).href;
      }
      return base;
    };
    const siteBaseUrl = getSiteBaseUrl();

    // 1. Versioning Context (Dynamically extracted from site config)
    const versionsObj = cfg.versions || {};
    const hasVersions = !!(versionsObj && (Array.isArray(versionsObj.all) || versionsObj.current));
    const allVersions: Array<{ id: string; label: string; dir: string }> = Array.isArray(versionsObj.all)
      ? versionsObj.all
      : (versionsObj.current ? [{ id: versionsObj.current, label: versionsObj.current, dir: `v${versionsObj.current}` }] : []);

    const defaultVer = allVersions.find(v => v.id === versionsObj.current) || allVersions[0] || null;
    let activeVersion = defaultVer;
    if (typeof location !== 'undefined' && allVersions.length > 0) {
      for (const v of allVersions) {
        const vDir = v.dir || v.id;
        if (location.pathname.includes(`/${vDir}/`)) {
          activeVersion = v;
          break;
        }
      }
    }

    // 2. Locale / i18n Context (Dynamically extracted from site config)
    const i18nObj = cfg.i18n || {};
    const hasLocales = !!(i18nObj && (Array.isArray(i18nObj.locales) || i18nObj.default));
    const defaultLocaleId = i18nObj.default || 'en';
    const allLocales: Array<{ id: string; label: string }> = Array.isArray(i18nObj.locales)
      ? i18nObj.locales
      : [{ id: defaultLocaleId, label: 'Default' }];

    const defaultLocale = allLocales.find(l => l.id === defaultLocaleId) || allLocales[0];
    let activeLocale = defaultLocale;
    if (typeof location !== 'undefined' && allLocales.length > 0) {
      const pathParts = location.pathname.split('/');
      const foundLoc = allLocales.find(l => pathParts.includes(l.id));
      if (foundLoc) activeLocale = foundLoc;
    }

    // 3. Active Workspace Project Context (Dynamically extracted from site config)
    let currentProjectName = 'Main Documentation';
    let currentProjectPrefix = '/';
    if (isWorkspace && Array.isArray(cfg.workspaceProjects)) {
      const matchProj = cfg.workspaceProjects.find((p: any) => {
        const pPrefix = (p.prefix || '/').replace(/^\/|\/$/g, '');
        return pPrefix && typeof location !== 'undefined' && location.pathname.includes(`/${pPrefix}`);
      });
      if (matchProj) {
        currentProjectName = matchProj.name || matchProj.prefix;
        currentProjectPrefix = matchProj.prefix || '/';
      } else {
        const rootProj = cfg.workspaceProjects.find((p: any) => p.prefix === '/');
        if (rootProj) currentProjectName = rootProj.name || 'Main Documentation';
      }
    }

    let workspaceContext = `
SITE & ENVIRONMENT CONTEXT:
- Site Title: "${siteTitle}"
- Site Base URL: ${siteBaseUrl}
- Current Page URL: ${currentUrl}
- Current Active Project: "${currentProjectName}" (Prefix: "${currentProjectPrefix}")`;

    if (hasVersions && defaultVer && activeVersion) {
      const versionsListStr = allVersions.map(v => `${v.label}${v.id === defaultVer.id ? ' (latest/default)' : ''}`).join(', ');
      workspaceContext += `
- Active Version: ${activeVersion.label} (Directory: "${activeVersion.dir || activeVersion.id}")
- Default / Latest Version: ${defaultVer.label}
- Available Versions: ${versionsListStr}`;
    }

    if (hasLocales && activeLocale) {
      const localesListStr = allLocales.map(l => `${l.label} ("${l.id}")${l.id === defaultLocaleId ? ' (default)' : ''}`).join(', ');
      workspaceContext += `
- Active Locale: ${activeLocale.label} ("${activeLocale.id}")
- Available Locales: ${localesListStr}`;
    }

    if (isWorkspace && Array.isArray(cfg.workspaceProjects)) {
      const projectsList = cfg.workspaceProjects.map((p: any, idx: number) => {
        const pName = p.name || p.prefix;
        const pPrefix = p.prefix || '/';
        const pAbsUrl = typeof location !== 'undefined' ? new URL(pPrefix.replace(/^\//, ''), siteBaseUrl).href : pPrefix;
        const isCurrent = pName === currentProjectName ? ' [CURRENT PAGE PROJECT]' : '';
        return `  ${idx + 1}. Project "${pName}" (Prefix: "${pPrefix}", URL: ${pAbsUrl})${isCurrent}`;
      }).join('\n');

      workspaceContext += `
- Multi-Project Workspace Setup: Active (${cfg.workspaceProjects.length} Projects)
- Available Workspace Projects:
${projectsList}`;
    }

    workspaceContext += `

CRITICAL SCOPE & NAVIGATION RULES:
1. SCOPE PRIORITIZATION: Prioritize answers using content from the Current Active Project ("${currentProjectName}")${hasVersions && activeVersion ? `, active version branch (${activeVersion.label})` : ''}${hasLocales && activeLocale ? `, and active language (${activeLocale.label})` : ''}.
2. STRICT ACTIVE / LATEST VERSION ONLY: ONLY cite, explain, recommend, and link to pages from the active version (${activeVersion?.label || defaultVer?.label}) or latest branch (${defaultVer?.label}). Never suggest, cite, or list deprecated historical versions unless the user explicitly asks for an older version.
3. AUTONOMOUS & PROACTIVE TOOL EXECUTION:
   - Always use your tools proactively. NEVER ask the user "Would you like me to search?" or "Should I check?". Directly invoke \`search_documentation\` or \`get_site_structure\` to retrieve facts before answering.
   - For any question about version numbers, latest releases, recent updates, or changelogs, you MUST search the release notes with \`search_documentation\` (query: "release notes" or specific version like "0.9.1") to find the newest release note before giving the final answer. Never state that a release does not exist without searching.
4. ACCURATE HYPERLINKS: ALWAYS ground page hyperlinks strictly in real search results or valid project URLs (${siteBaseUrl}). Never invent or hallucinate invalid subpaths.
5. TOKEN EFFICIENCY & TARGETED RETRIEVAL:
   - Do not read entire documentation sets or fetch excessive pages unless necessary.
   - Use \`search_documentation\` first to identify the exact single page or section needed.
   - Only call \`read_documentation_page\` on that specific page when required to fetch precise code snippets or steps.
   - Keep answers clean, structured, and focused directly on what the user asked.
6. CONFIGURATION ACCURACY (ZERO FABRICATION):
   - When asked for configuration, starter templates, or config files: NEVER guess or fabricate non-existent keys (such as \`socialLinks\`, \`nav\`, \`sidebar\` path maps, or \`search.provider\`).
   - The official configuration manifest is \`docmd.config.json\` (top-level keys: \`title\`, \`url\`, \`src\`, \`theme\`, \`layout\`, \`plugins\`, \`i18n\`, \`versions\`).
   - ALWAYS search with \`search_documentation(query: "configuration overview")\` or \`"zero-config"\` before answering configuration questions.
7. COMPARISONS & COMPETITORS:
   - When asked why docmd is better than others, its advantages, or how it compares to Docusaurus, VitePress, MkDocs, or Starlight:
   - Search for "comparison" with \`search_documentation\` to retrieve and cite the official comparison benchmarks and payload matrices from \`/comparison/\`.
8. VERSION FILTERING:
   - The \`search_documentation\` tool supports a \`version\` parameter. When the user asks about a specific version (e.g. v0.8.0), specify \`version: "0.8.0"\` to filter results strictly to that version branch.`;

    const defaultBasePrompt = `You are docmd assistant — a professional, precise, and concise technical AI assistant for this documentation site.

CRITICAL CONSTRAINTS & BEHAVIORAL RULES:
1. IDENTITY: Your name is "docmd assistant". You are an expert AI guide specifically for this documentation site. Never identify yourself simply as "docmd" or "I am docmd".
2. STRICT SCOPE & BOUNDARIES: Answer ONLY questions related to the software, APIs, tools, installation, configuration, and documentation provided on this site. Politely decline off-topic queries.
3. PROFESSIONAL & CONCISE: Provide direct, succinct, and professional answers. Do NOT use excessive emojis (keep emojis to a minimum or none). Avoid conversational fluff, boilerplate apologies, or asking for permission. Get straight to the answer.
4. TARGETED RETRIEVAL & MINIMAL TOKEN USAGE:
   - Only retrieve what is strictly necessary. Never attempt to read the entire documentation or fetch excessive pages.
   - Use \`search_documentation\` first with targeted keywords (e.g. "comparison", "docmd.config.json", "0.9.5 release notes") to locate the exact page.
   - Only invoke \`read_documentation_page\` when you need specific code blocks or configuration details from that single page.
5. TOOL SELECTION & EXECUTION:
   - Use \`get_site_structure\` whenever you need extended structural inspection of available documentation versions, supported locales, or navigation trees.
   - Use \`search_documentation\` to search documentation content for specific technical terms, API parameters, error messages, or release notes. Keyword search is always active; pass clean, focused search terms (e.g. "comparison", "configuration overview", "cards container") for highest accuracy.
   - For comparisons, search for "comparison" to retrieve comparison tables against competitors.
   - For configuration, search for "configuration overview" or "zero-config" to get authentic \`docmd.config.json\` properties.
6. CLEAN WRITING & LIST FORMATTING:
   - Write cleanly and directly without artificial gaps, repeated quotes, or messy text breaks.
   - For lists, use standard numbered lists (1., 2., 3.) or bullet points (-). Do not leave blank lines between list items unless separating distinct multi-paragraph steps.
7. HYPERLINKS & CITATIONS: Always include clickable Markdown hyperlinks \`[Page Title](path)\` in your response for referenced pages.`;

    const basePrompt = cfg.systemPrompt || defaultBasePrompt;
    return `${basePrompt}\n\n${workspaceContext}`;
  }

  private getSiteStructure(): Record<string, any> {
    const cfg = (window as any).__docmd_ai_config || {};
    return {
      siteTitle: cfg.siteTitle || 'Documentation',
      siteBaseUrl: cfg.siteUrl || cfg.siteBase || '/',
      currentUrl: typeof location !== 'undefined' ? location.href : '',
      versions: cfg.versions || null,
      locales: cfg.i18n || null,
      searchCapabilities: cfg.searchCapabilities || { keyword: true, semantic: false },
      isWorkspace: !!cfg.isWorkspace,
      workspaceProjects: cfg.workspaceProjects || [],
      navigation: cfg.navigation || []
    };
  }

  private async searchAllWorkspaceIndexes(rawQuery: any, projectFilter?: string, versionFilter?: string): Promise<any[]> {
    const hits: Array<{ project: string; title: string; url: string; snippet: string; searchType: 'keyword' | 'semantic' }> = [];
    const query = typeof rawQuery === 'string'
      ? rawQuery
      : (rawQuery?.query || rawQuery?.q || rawQuery?.search_query || rawQuery?.text || rawQuery?.input || '');
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) return [];

    const cleanQueryLower = cleanQuery.toLowerCase();
    const cfg = (window as any).__docmd_ai_config || {};
    const getSiteBaseUrl = (): string => {
      const cfg = (window as any).__docmd_ai_config || {};
      let base = cfg.siteBase || '/';
      if (typeof location !== 'undefined') {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocal && base !== '/' && !location.pathname.startsWith(base)) {
          base = '/';
        }
        return new URL(base.startsWith('/') ? base : '/' + base, location.origin).href;
      }
      return base;
    };
    const siteBaseUrl = getSiteBaseUrl();

    // Compute version & locale scoping
    const versionsObj = cfg.versions || {};
    const allVerList: Array<{ id: string; dir?: string; label?: string }> = Array.isArray(versionsObj.all) ? versionsObj.all : [];
    const currentVerId = String(versionsObj.current || '');
    const currentVerDir = versionsObj.current ? (allVerList.find(v => v.id === versionsObj.current)?.dir || `v${versionsObj.current}`) : '';

    // Resolve explicit version filter if provided
    let explicitVersionId: string | null = null;
    let explicitVersionDir: string | null = null;
    let explicitVersionLabel: string | null = null;
    if (versionFilter) {
      const vClean = String(versionFilter).toLowerCase().trim().replace(/^v/, '');
      if (vClean === 'latest' || vClean === 'current' || vClean === currentVerId.replace(/^v/, '')) {
        explicitVersionId = currentVerId;
        explicitVersionDir = currentVerDir;
      } else {
        const found = allVerList.find(v => {
          const vid = String(v.id || '').toLowerCase().replace(/^v/, '');
          const vdir = String(v.dir || '').toLowerCase().replace(/^v/, '');
          const vlbl = String(v.label || '').toLowerCase().replace(/^v/, '');
          return vid === vClean || vdir === vClean || vlbl === vClean || vlbl.startsWith(vClean);
        });
        if (found) {
          explicitVersionId = String(found.id);
          explicitVersionDir = String(found.dir || `v${found.id}`);
          explicitVersionLabel = String(found.label || found.id);
        } else {
          explicitVersionId = vClean;
        }
      }
    }
    
    // Collect older version tokens
    const olderVerTokens: string[] = [];
    for (const v of allVerList) {
      if (String(v.id) !== currentVerId) {
        if (v.id) olderVerTokens.push(String(v.id).toLowerCase());
        if (v.dir) olderVerTokens.push(String(v.dir).toLowerCase());
        if (v.label) {
          olderVerTokens.push(String(v.label).toLowerCase());
          olderVerTokens.push(String(v.label).replace(/^v/i, '').toLowerCase());
        }
      }
    }
    const isExplicitOlderVerRequest = explicitVersionId
      ? explicitVersionId !== currentVerId
      : olderVerTokens.some(tok => cleanQueryLower.includes(tok));

    const i18nObj = cfg.i18n || {};
    const allLocales: Array<{ id: string }> = Array.isArray(i18nObj.locales) ? i18nObj.locales : [];
    let activeLocaleId = i18nObj.default || 'en';
    if (typeof location !== 'undefined') {
      const pathParts = location.pathname.split('/');
      const foundLoc = allLocales.find(l => pathParts.includes(l.id));
      if (foundLoc) activeLocaleId = foundLoc.id;
    }
    const nonActiveLocaleIds = allLocales.filter(l => l.id !== activeLocaleId).map(l => l.id.toLowerCase());
    const isExplicitLocaleRequest = nonActiveLocaleIds.some(locId => cleanQueryLower.includes(locId));

    const isPathExcluded = (rawId: string, itemVersion?: string): boolean => {
      const norm = String(rawId || '').replace(/^\//, '').toLowerCase();
      const itemVerLower = String(itemVersion || '').toLowerCase().replace(/^v/, '');

      if (explicitVersionId) {
        if (explicitVersionId === currentVerId) {
          for (const tok of olderVerTokens) {
            if (norm === tok || norm.startsWith(`${tok}/`) || norm.includes(`/${tok}/`)) return true;
          }
        } else {
          const tokens = [explicitVersionId.toLowerCase(), `v${explicitVersionId.toLowerCase()}`];
          if (explicitVersionDir) tokens.push(explicitVersionDir.toLowerCase());
          if (explicitVersionLabel) tokens.push(explicitVersionLabel.toLowerCase().replace(/^v/, ''));
          const matchesExplicit = tokens.some(tok => norm === tok || norm.startsWith(`${tok}/`) || norm.includes(`/${tok}/`) || itemVerLower === tok);
          if (!matchesExplicit) return true;
        }
      } else if (!isExplicitOlderVerRequest) {
        for (const tok of olderVerTokens) {
          if (norm === tok || norm.startsWith(`${tok}/`) || norm.includes(`/${tok}/`)) {
            return true;
          }
        }
      }
      if (!isExplicitLocaleRequest) {
        for (const loc of nonActiveLocaleIds) {
          if (norm === loc || norm.startsWith(`${loc}/`) || norm.includes(`/${loc}/`)) {
            return true;
          }
        }
      }
      return false;
    };

    const queryTokens = cleanQueryLower.replace(/[\-_.]/g, ' ').split(/\s+/).filter((t: string) => t.length > 0);
    const versionMatches = cleanQuery.match(/\d+[\.\-_]\d+[\.\-_]\d+/g);

    // 1. Local Active Search Index (via window.docmdSearch)
    try {
      if ((window as any).docmdSearch && typeof (window as any).docmdSearch.search === 'function') {
        const searchOpts: any = {};
        if (explicitVersionId) {
          searchOpts.version = explicitVersionId;
        }
        let localHits = await (window as any).docmdSearch.search(query, searchOpts);

        // Conversational query expansion: if looking for comparison / advantages / competitor comparisons
        const isComparisonQuery = /\b(better|advantages?|versus|vs|compare|comparison|competitors?|alternatives?|docusaurus|vitepress|mkdocs|starlight)\b/i.test(cleanQueryLower);
        if (isComparisonQuery && !cleanQueryLower.includes('comparison')) {
          try {
            const compHits = await (window as any).docmdSearch.search('comparison', searchOpts);
            if (Array.isArray(compHits)) {
              if (!Array.isArray(localHits)) localHits = [];
              for (const ch of compHits) {
                if (!localHits.some((lh: any) => lh.id === ch.id)) {
                  localHits.unshift({ ...ch, score: 999 });
                }
              }
            }
          } catch { /* silent */ }
        }

        if (Array.isArray(localHits)) {
          const filteredAndScored = localHits
            .filter((item: any) => !isPathExcluded(item.id || item.url || '', item.version))
            .map((item: any) => {
              const rawId = String(item.id || item.url || '');
              const cleanId = rawId.startsWith('/') ? rawId.slice(1) : rawId;
              const titleLower = String(item.title || cleanId).toLowerCase();
              const textLower = String(item.text || item.snippet || '').toLowerCase();
              const idLower = cleanId.toLowerCase();

              let score = typeof item.score === 'number' ? item.score : 1;
              for (const tok of queryTokens) {
                if (titleLower.includes(tok)) score += 15;
                if (idLower.includes(tok)) score += 10;
                if (textLower.includes(tok)) score += 2;
              }
              if (versionMatches) {
                for (const vm of versionMatches) {
                  const normV = vm.replace(/[\-_]/g, '.');
                  const dashV = vm.replace(/[\.]/g, '-');
                  if (titleLower.includes(normV) || titleLower.includes(dashV) || idLower.includes(dashV) || idLower.includes(normV)) {
                    score += 60;
                  }
                }
              }
              return { item, score, cleanId };
            })
            .sort((a, b) => b.score - a.score);

          for (const entry of filteredAndScored) {
            const { item, cleanId } = entry;
            const fullUrl = cleanId.startsWith('http') ? cleanId : new URL(cleanId, siteBaseUrl).href;
            if (!hits.some(existing => existing.url === fullUrl)) {
              hits.push({
                project: 'Current Project',
                title: item.title || cleanId,
                url: fullUrl,
                snippet: item.snippet || item.text || '',
                searchType: 'keyword'
              });
            }
            if (hits.length >= 6) break;
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Fetch sibling workspace project search indexes
    if (cfg.isWorkspace && Array.isArray(cfg.workspaceProjects)) {
      for (const p of cfg.workspaceProjects) {
        if (projectFilter && p.prefix !== projectFilter && p.name !== projectFilter) continue;
        
        try {
          const pPrefix = p.prefix || '/';
          const pBaseUrl = new URL(pPrefix.replace(/^\//, ''), siteBaseUrl).href.replace(/\/?$/, '/');
          const searchIndexPath = `${pBaseUrl}_docmd-search/search-index.json`;
          
          const res = await fetch(searchIndexPath);
          if (res.ok) {
            const indexData = await res.json();
            const docs = indexData.storedFields ? Object.values(indexData.storedFields) : (Array.isArray(indexData) ? indexData : []);

            const filteredDocs = docs.filter((doc: any) => {
              const rawId = String(doc.id || doc.url || '');
              return !isPathExcluded(rawId, doc.version);
            });

            const scored = filteredDocs.map((doc: any) => {
              const titleStr = String(doc.title || doc.id || '').toLowerCase();
              const textStr = String(doc.text || '').toLowerCase();
              const rawId = String(doc.id || '');
              let score = 0;
              for (const term of queryTokens) {
                if (titleStr.includes(term)) score += 15;
                if (rawId.toLowerCase().includes(term)) score += 10;
                if (textStr.includes(term)) score += 2;
              }

              if (versionMatches) {
                for (const vm of versionMatches) {
                  const normV = vm.replace(/[\-_]/g, '.');
                  const dashV = vm.replace(/[\.]/g, '-');
                  if (titleStr.includes(normV) || titleStr.includes(dashV) || rawId.toLowerCase().includes(dashV)) {
                    score += 60;
                  }
                }
              }

              if (currentVerDir && rawId.includes(`/${currentVerDir}/`)) score += 10;
              if (activeLocaleId && rawId.includes(`/${activeLocaleId}/`)) score += 5;

              return { doc, score };
            }).filter((h: any) => h.score > 0).sort((a: any, b: any) => b.score - a.score);

            for (const hit of scored.slice(0, 3)) {
              const doc = hit.doc;
              const rawId = doc.id || '';
              const cleanId = rawId.startsWith('/') ? rawId.slice(1) : rawId;
              const fullUrl = rawId.startsWith('http') ? rawId : new URL(cleanId, pBaseUrl).href;
              
              if (!hits.some(existing => existing.url === fullUrl)) {
                hits.push({
                  project: p.name || p.prefix,
                  title: doc.title || rawId,
                  url: fullUrl,
                  snippet: (doc.text || '').slice(0, 150) + '...',
                  searchType: 'keyword'
                });
              }
            }
          }
        } catch { /* ignore fetch errors for sibling indexes */ }
      }
    }

    return hits;
  }

  private async fetchLocalSearchContext(query: string): Promise<string> {
    const trimmed = query.trim().toLowerCase();
    const isGreetingOrCasual = /^(hi|hello|hey|howdy|greetings|good\s+(morning|afternoon|evening|day)|who\s+are\s+you|what\s+can\s+you\s+do|help|thanks|thank\s+you|bye|goodbye)[!?. ]*$/i.test(trimmed) || trimmed.length <= 2;
    if (isGreetingOrCasual) {
      return '';
    }

    try {
      const hits = await this.searchAllWorkspaceIndexes(query);
      if (Array.isArray(hits) && hits.length > 0) {
        const formattedHits = hits.slice(0, 5).map((hit: any) => {
          return `- [${hit.project}] ${hit.title} (${hit.searchType}): ${hit.url}\n  Snippet: ${hit.snippet}`;
        }).join('\n');
        return `\n\n[Documentation Search Context (Multi-Project Workspace)]:\n${formattedHits}`;
      }
    } catch { /* silent */ }
    return '';
  }

  private renderUnconfiguredNotice(data?: any): void {
    const title = data?.title || 'Connect Your AI Assistant';
    const message = data?.message || 'Add your free AI relay or BYOK API key on docmd Cloud to enable the assistant for your visitors.';
    const configUrl = data?.configUrl || 'https://cloud.docmd.io';
    const features = Array.isArray(data?.features) ? data.features : [
      '**Free AI relay** — bring your own API key for OpenAI, Anthropic, Gemini, DeepSeek, or Ollama.',
      '**Query analytics** — see what your visitors are asking in real time.',
      '**Setup takes under a minute** — just add your `projectId` to `docmd.config.json`.'
    ];

    const featureItemsHtml = features
      .map((f: string) => `<li>${this.formatMarkdown(f)}</li>`)
      .join('');

    const msgs = document.getElementById('docmd-ai-messages');
    const div = document.createElement('div');
    div.className = 'docmd-ai-chat-bubble assistant';
    div.innerHTML = `
      <div class="docmd-ai-unconfigured-card">
        <div class="docmd-ai-unconfigured-title">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
          ${this.escapeHtml(title)}
        </div>
        <p>${this.escapeHtml(message)}</p>
        <ul class="docmd-ai-unconfigured-list">
          ${featureItemsHtml}
        </ul>
        <a href="${this.escapeHtml(configUrl)}" target="_blank" rel="noopener" class="docmd-ai-unconfigured-btn">
          Connect on docmd Cloud →
        </a>
      </div>
    `;
    if (msgs) {
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  private getStatusSvgIcon(iconName?: string): string {
    switch (iconName) {
      case 'search':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
      case 'folder-tree':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>`;
      case 'book-open':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`;
      case 'navigation':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>`;
      case 'copy':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
      case 'cog':
        return `<svg class="docmd-ai-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
      case 'brain':
      case 'sparkles':
      default:
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>`;
    }
  }

  private async submitQuery(text: string): Promise<void> {
    if (this.isPending) return;
    this.setPendingState(true);

    this.appendMsg('user', text, true);

    const msgs = document.getElementById('docmd-ai-messages');
    const bubble = document.createElement('div');
    bubble.className = 'docmd-ai-chat-bubble assistant';

    const statusWrap = document.createElement('div');
    statusWrap.className = 'docmd-ai-status-badge';
    statusWrap.innerHTML = `${this.getStatusSvgIcon('brain')} <span>Thinking...</span>`;
    bubble.appendChild(statusWrap);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'docmd-ai-content';
    bubble.appendChild(contentDiv);

    if (msgs) {
      msgs.appendChild(bubble);
      msgs.scrollTop = msgs.scrollHeight;
    }

    let accumulatedText = '';

    try {
      const docContext = await this.fetchLocalSearchContext(text);
      const queryWithContext = docContext ? `${text}${docContext}` : text;

      let res: any;
      if (typeof (this.engine as any).sendMessageStream === 'function') {
        res = await this.engine.sendMessageStream(queryWithContext, {
          onStatus: (status: any) => {
            if (statusWrap && status) {
              const statusObj = typeof status === 'string' ? { text: status } : { ...status };
              let statusText = statusObj.text || 'Thinking...';
              let statusIcon = statusObj.icon;
              if (/^Running\s+([a-z0-9_]+)\.\.\./i.test(statusText)) {
                const tool = statusText.match(/^Running\s+([a-z0-9_]+)\.\.\./i)?.[1] || '';
                if (tool === 'read_documentation_page') { statusText = 'Reading documentation...'; statusIcon = statusIcon || 'book-open'; }
                else if (tool === 'search_documentation') { statusText = 'Searching documentation...'; statusIcon = statusIcon || 'search'; }
                else if (tool === 'navigate_to_page') { statusText = 'Navigating to page...'; statusIcon = statusIcon || 'navigation'; }
                else if (tool === 'get_site_structure') { statusText = 'Inspecting site navigation & structure...'; statusIcon = statusIcon || 'folder-tree'; }
                else if (tool === 'copy_code_snippet') { statusText = 'Copying code snippet...'; statusIcon = statusIcon || 'copy'; }
                else {
                  const readable = tool.replace(/^([a-z])/, (m: string) => m.toUpperCase()).replace(/_/g, ' ');
                  statusText = `${readable}...`;
                }
              } else if (/^[a-z]+(_[a-z0-9]+)+$/.test(statusText)) {
                if (statusText === 'read_documentation_page') { statusText = 'Reading documentation...'; statusIcon = statusIcon || 'book-open'; }
                else if (statusText === 'search_documentation') { statusText = 'Searching documentation...'; statusIcon = statusIcon || 'search'; }
                else if (statusText === 'navigate_to_page') { statusText = 'Navigating to page...'; statusIcon = statusIcon || 'navigation'; }
                else if (statusText === 'get_site_structure') { statusText = 'Inspecting site navigation & structure...'; statusIcon = statusIcon || 'folder-tree'; }
                else if (statusText === 'copy_code_snippet') { statusText = 'Copying code snippet...'; statusIcon = statusIcon || 'copy'; }
                else {
                  const readable = statusText.replace(/^([a-z])/, (m: string) => m.toUpperCase()).replace(/_/g, ' ');
                  statusText = `${readable}...`;
                }
              }
              statusWrap.style.display = 'inline-flex';
              statusWrap.innerHTML = `${this.getStatusSvgIcon(statusIcon)} <span>${this.escapeHtml(statusText)}</span>`;
              if (msgs) msgs.scrollTop = msgs.scrollHeight;
            }
          },
          onChunk: (chunk: string) => {
            if (chunk) {
              if (!accumulatedText) {
                accumulatedText = chunk;
              } else if (chunk.startsWith(accumulatedText)) {
                accumulatedText = chunk;
              } else {
                accumulatedText += chunk;
              }
            }
            if (statusWrap) {
              statusWrap.style.display = 'none';
            }
            contentDiv.innerHTML = this.formatMarkdown(accumulatedText);
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
          }
        });
      } else {
        res = await this.engine.sendMessage(queryWithContext);
      }

      if (res && res.unconfigured) {
        bubble.remove();
        this.renderUnconfiguredNotice(res.unconfiguredData || res);
        return;
      }

      if (statusWrap) {
        statusWrap.style.display = 'none';
      }
      contentDiv.innerHTML = this.formatMarkdown(res.message || accumulatedText || 'No response generated.');
    } catch (err: any) {
      const errMsg = err?.message || String(err || '');
      const isAuthOrConfigError = errMsg.includes('Domain Not Authorized') ||
        errMsg.includes('Origin is not authorized') ||
        errMsg.includes('403') ||
        errMsg.includes('401') ||
        err?.unconfigured;

      if (isAuthOrConfigError) {
        bubble.remove();
        this.renderUnconfiguredNotice({
          title: 'Domain Not Authorized',
          message: errMsg || 'Origin is not authorized for the selected docmd Cloud project.',
          features: [
            '**Free AI relay** — bring your own API key for OpenAI, Anthropic, Gemini, DeepSeek, or Ollama.',
            '**Query analytics** — see what your visitors are asking in real time.',
            '**Setup takes under a minute** — just add your `projectId` to `docmd.config.json`.'
          ]
        });
      } else {
        if (statusWrap) statusWrap.style.display = 'none';
        contentDiv.innerHTML = `<span style="color: var(--ai-text-muted);">Sorry, I encountered an issue processing your request: ${this.escapeHtml(errMsg)}</span>`;
      }
    } finally {
      this.setPendingState(false);
    }
  }

  private clearChat(): void {
    this.engine.clearHistory();
    const msgs = document.getElementById('docmd-ai-messages');
    if (msgs) {
      msgs.innerHTML = `
        <div class="docmd-ai-chat-bubble assistant">
          Conversation cleared. How else can I help you?
          ${this.renderSuggestionsHtml()}
        </div>
      `;
    }
  }

  private appendMsg(sender: 'user' | 'assistant', text: string, save = true): HTMLElement {
    const msgs = document.getElementById('docmd-ai-messages');
    const div = document.createElement('div');
    div.className = `docmd-ai-chat-bubble ${sender}`;
    div.innerHTML = sender === 'assistant' ? this.formatMarkdown(text) : this.escapeHtml(text);
    if (msgs) {
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    return div;
  }

  private escapeHtml(raw: string): string {
    return (raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private formatMarkdown(raw: string): string {
    if (!raw) return '';
    // Universal LLM tag and internal marker stripping
    let cleaned = raw
      .replace(/<(?:[a-zA-Z0-9_\-]+:)?(think|thought|reasoning|reflection|plan)\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_\-]+:)?\1>/gi, '')
      .replace(/```(?:thought|thinking|reasoning|reflection)\s*\n[\s\S]*?```/gi, '')
      .replace(/\[(?:thought|thinking|reasoning):\s*[\s\S]*?\]/gi, '')
      .replace(/\]<\][a-zA-Z0-9_\-]+\[>\[[\s\S]*?(?:<\/(?:request|tool_call|action)>|\]<\][a-zA-Z0-9_\-]+\[>\[|$)/gi, '')
      .replace(/\]<\][a-zA-Z0-9_\-]+\[>\[/gi, '')
      .replace(/<\/?(?:[a-zA-Z0-9_\-]+:)?(?:think|thought|reasoning|reflection|plan)\b[^>]*>/gi, '')
      .replace(/<(?:[a-zA-Z0-9_\-]+:)?(tool_call|function_call|tool|action|request)\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_\-]+:)?\1>/gi, '')
      .replace(/```(?:tool_call|function_call|tool|action|json:tool)\s*\n[\s\S]*?```/gi, '')
      .replace(/\{\s*"(?:name|tool|action|function)"\s*:\s*"[^"]+"\s*,\s*"(?:parameters|arguments|args|input)"\s*:\s*\{[\s\S]*?\}\s*\}/g, '')
      .replace(/<\/?(?:[a-zA-Z0-9_\-]+:)?(?:tool_call|function_call|tool|action|request)\b[^>]*>/gi, '')
      .trim();

    if (!cleaned) cleaned = raw;

    const cfg = (window as any).__docmd_ai_config || {};
    const getSiteBaseUrl = (): string => {
      const cfg = (window as any).__docmd_ai_config || {};
      let base = cfg.siteBase || '/';
      if (typeof location !== 'undefined') {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocal && base !== '/' && !location.pathname.startsWith(base)) {
          base = '/';
        }
        return new URL(base.startsWith('/') ? base : '/' + base, location.origin).href;
      }
      return base;
    };
    const siteBaseUrl = getSiteBaseUrl();

    const resolveCanonicalUrl = (href: string): string => {
      if (!href) return '#';
      let targetUrl = href.trim();
      const subpathBase = (cfg.siteBase || '').replace(/^\/|\/$/g, '');
      const isLocal = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

      if (isLocal && subpathBase && !location.pathname.startsWith('/' + subpathBase)) {
        targetUrl = targetUrl.replace(new RegExp(`/${subpathBase}(/|$)`, 'g'), '/');
      }

      if (/^(?:https?:|mailto:|tel:)/i.test(targetUrl)) return targetUrl;
      if (targetUrl.startsWith('#')) return `${siteBaseUrl}${targetUrl}`;
      try {
        const cleanHref = targetUrl.startsWith('/') ? targetUrl.slice(1) : targetUrl;
        return new URL(cleanHref, siteBaseUrl).href;
      } catch {
        return targetUrl;
      }
    };

    // Extract code blocks from RAW cleaned markdown BEFORE escapeHtml to prevent double-escaping
    const codeBlocks: string[] = [];
    const copySvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
    const renderCodeBlock = (lang: string, code: string) => {
      const cleanLang = (lang || '').trim().toLowerCase();
      const langSpan = cleanLang
        ? `<span class="docmd-ai-code-lang">${cleanLang}</span>`
        : `<span class="docmd-ai-code-lang">code</span>`;
      const copyBtn = `<button class="docmd-ai-code-copy-btn" type="button" title="Copy code" aria-label="Copy code">${copySvg}<span>Copy</span></button>`;
      const headerStr = `<div class="docmd-ai-code-header">${langSpan}${copyBtn}</div>`;
      const escapedCode = code.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<div class="docmd-ai-code-wrap">${headerStr}<pre><code>${escapedCode}</code></pre></div>`;
    };

    // Extract code blocks from raw cleaned text (not yet HTML-escaped)
    cleaned = cleaned.replace(/```(\w+)?[ \t]*\r?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(renderCodeBlock(lang || '', code));
      return placeholder;
    });
    cleaned = cleaned.replace(/```(\w+)([ \t]+[^\n][\s\S]*?)```/g, (_match, lang, code) => {
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(renderCodeBlock(lang || '', code));
      return placeholder;
    });
    cleaned = cleaned.replace(/```\r?\n?([\s\S]*?)```/g, (_match, code) => {
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(renderCodeBlock('', code));
      return placeholder;
    });

    // NOW escape HTML on the remaining non-code markdown text
    let text = this.escapeHtml(cleaned);

    // Headings (# h1, ## h2, ### h3, #### h4)
    text = text.replace(/^#### (.*$)/gim, '<h5>$1</h5>');
    text = text.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    text = text.replace(/^## (.*$)/gim, '<h3>$1</h3>');
    text = text.replace(/^# (.*$)/gim, '<h3>$1</h3>');

    const parseListItems = (rawListText: string, isOrdered: boolean): string => {
      const lines = rawListText.split(/\r?\n/);
      const items: string[] = [];
      let currentItemText = '';
      const itemRegex = isOrdered ? /^\s*(\d+)[\.\)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;

      for (const line of lines) {
        const mainMatch = line.match(itemRegex);
        if (mainMatch) {
          if (currentItemText) {
            items.push(`<li>${currentItemText.trim()}</li>`);
          }
          currentItemText = isOrdered ? mainMatch[2] : mainMatch[1];
        } else if (line.trim().length === 0) {
          // blank line inside a loose list, skip
          continue;
        } else if (currentItemText) {
          const subBullet = line.match(/^\s+[-*+]\s+(.*)$/);
          if (subBullet) {
            currentItemText += `<br/><span class="docmd-ai-sub-item">• ${subBullet[1].trim()}</span>`;
          } else {
            currentItemText += ' ' + line.trim();
          }
        }
      }
      if (currentItemText) {
        items.push(`<li>${currentItemText.trim()}</li>`);
      }
      if (items.length === 0) return rawListText;
      const tag = isOrdered ? 'ol' : 'ul';
      return `\n\n<${tag}>${items.join('')}</${tag}>\n\n`;
    };

    // Ordered lists (supports loose lists with single blank lines between items, and indented continuation lines)
    const orderedListRegex = /(?:^[ \t]*\d+[\.\)][ \t]+.*(?:\r?\n|$))(?:[ \t]*(?:\r?\n)|[ \t]+\S.*(?:\r?\n|$)|^[ \t]*\d+[\.\)][ \t]+.*(?:\r?\n|$))*/gm;
    text = text.replace(orderedListRegex, (match) => parseListItems(match, true));

    // Unordered lists (supports loose lists and indented continuation lines)
    const unorderedListRegex = /(?:^[ \t]*[-*+][ \t]+.*(?:\r?\n|$))(?:[ \t]*(?:\r?\n)|[ \t]+\S.*(?:\r?\n|$)|^[ \t]*[-*+][ \t]+.*(?:\r?\n|$))*/gm;
    text = text.replace(unorderedListRegex, (match) => parseListItems(match, false));

    // Blockquotes
    text = text.replace(/(?:^\s*&gt;\s+.*(?:\r?\n|$))+/gm, (match) => {
      const content = match.replace(/^\s*&gt;\s+/gm, '').trim();
      return `<blockquote>${content}</blockquote>`;
    });

    // Markdown Tables (| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |)
    text = text.replace(/(?:^\s*\|.*\|\s*(?:\r?\n|$))+/gm, (match) => {
      const lines = match.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return match;

      let html = '<div class="docmd-ai-table-wrap"><table>';
      let inBody = false;

      lines.forEach((line, idx) => {
        if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) return;
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.length === 0) return;

        if (idx === 0) {
          html += '<thead><tr>';
          cells.forEach(c => { html += `<th>${c}</th>`; });
          html += '</tr></thead>';
        } else {
          if (!inBody) {
            html += '<tbody>';
            inBody = true;
          }
          html += '<tr>';
          cells.forEach(c => { html += `<td>${c}</td>`; });
          html += '</tr>';
        }
      });

      if (inBody) html += '</tbody>';
      html += '</table></div>';
      return html;
    });

    // Horizontal Rules (---, ***, ___)
    text = text.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '<hr />');

    // Inline formatting
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, link) => {
      const finalUrl = resolveCanonicalUrl(link.trim());
      return `<a href="${finalUrl}" target="_blank" rel="noopener">${label}</a>`;
    });

    // Split into blocks by double linebreaks for clean paragraph flow
    const blocks = text.split(/\n{2,}/);
    const html = blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(?:h3|h4|h5|ul|ol|pre|blockquote|div|table|hr)|__CODE_BLOCK_/i.test(trimmed)) {
        return trimmed.replace(/\n/g, ' ');
      }
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    }).join('');

    // Restore code blocks
    let finalHtml = html;
    codeBlocks.forEach((cb, i) => {
      finalHtml = finalHtml.replace(`__CODE_BLOCK_${i}__`, cb);
    });

    // Sanitize local dev server subpath URLs (e.g. convert /beta-test/rust to /rust on localhost)
    const isLocal = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    const subpathBase = (cfg.siteBase || '').replace(/^\/|\/$/g, '');
    if (isLocal && subpathBase && !location.pathname.startsWith('/' + subpathBase)) {
      finalHtml = finalHtml.replace(new RegExp(`(https?://[^/\\s]+)?/${subpathBase}(/|\\b)`, 'g'), (_m, origin) => {
        return (origin || '') + '/';
      });
    }

    return finalHtml;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new DocmdAIAssistantUI());
  } else {
    new DocmdAIAssistantUI();
  }
}