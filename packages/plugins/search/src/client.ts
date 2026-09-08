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

import * as SemanticSearch from './semantic-client.js';

export {};

declare global {
    interface Window {
        DOCMD_SITE_ROOT?: string;
        DOCMD_ROOT?: string;
        lastFocusedElement?: HTMLElement | null;
        closeDocmdSearch?: () => void;
    }
}
declare const MiniSearch: any;

(function () {
    let miniSearch: any = null;
    let isSemanticMode = false;  // Track if semantic search is active
    let isIndexLoaded = false;
    let loadedIndexUrl = '';
    let selectedIndex = -1;
    const activeVersionFilters = new Set<string>();
    let globalAllVersions: string[] = [];
    const globalVersionColors: Record<string, {bg: string, fg: string}> = {};

    function initSearch() {
        const searchModal = document.getElementById('docmd-search-modal') as HTMLElement;
        const searchInput = document.getElementById('docmd-search-input') as HTMLInputElement;
        const searchResults = document.getElementById('docmd-search-results') as HTMLElement;

        if (!searchModal || !searchInput || !searchResults) return;

        // showFilters: hide version filter bar when explicitly set to false
        const showFilters = searchModal.dataset.showFilters !== 'false';

        // Read translated strings from data attributes (injected server-side per locale)
        const strings = {
            initial: searchModal.dataset.searchInitial || 'Type to start searching...',
            noResults: searchModal.dataset.searchNoResults || 'No results found.',
            error: searchModal.dataset.searchError || 'Failed to load search index.',
            offline: searchModal.dataset.searchOffline || 'Search requires a web server. Open this site via http://localhost instead of file:// to enable search.',
            offlineBuild: searchModal.dataset.searchOfflineBuild || 'Search is disabled because these docs were built with the --offline flag. Rebuild the site without the flag to enable search.'
        };

        // Extract known locales from link hreflang tags
        const hreflangLinks = document.querySelectorAll('link[hreflang]');
        const knownLocales = new Set<string>();
        hreflangLinks.forEach(link => {
            const lang = link.getAttribute('hreflang');
            if (lang && lang !== 'x-default') knownLocales.add(lang);
        });

        // Determine the canonical siteBase (including any subpath/repository prefix).
        // If window.DOCMD_SITE_ROOT is set and is not the default '/', use it directly.
        // Otherwise, resolve the relative window.DOCMD_ROOT to deduce the absolute URL pathname.
        let siteBase = '/';
        let baseUrl = '';
        let ROOT_PATH = '';
        let searchIndexUrl = '';

        function updateSearchPaths() {
            // Always resolve the relative window.DOCMD_ROOT to deduce the absolute URL pathname dynamically.
            // This ensures that when the site is running on a different domain or server, search indexes resolve correctly.
            const projectRootUrl = new URL(window.DOCMD_ROOT || './', window.location.href);
            let projectRootPath = projectRootUrl.pathname;
            if (!projectRootPath.endsWith('/')) projectRootPath += '/';

            const segments = projectRootPath.split('/').filter(Boolean);
            let checkIdx = segments.length - 1;
            while (checkIdx >= 0) {
                const seg = segments[checkIdx];
                const isLocale = knownLocales.has(seg);
                const isVersion = /^v\d+/.test(seg) || seg === 'latest' || seg === 'stable';
                
                if (isLocale || isVersion) {
                    checkIdx--;
                } else {
                    break;
                }
            }

            const baseSegments = segments.slice(0, checkIdx + 1);
            siteBase = '/' + baseSegments.join('/') + '/';
            if (siteBase === '//') siteBase = '/';
            if (!siteBase.endsWith('/')) siteBase += '/';

            baseUrl = new URL(siteBase, window.location.href).href;
            ROOT_PATH = baseUrl;

            // Determine the locale-specific search index path.
            // Extract the locale prefix of the current URL based on our computed siteBase
            const currentPath = window.location.pathname;
            const pathAfterBase = currentPath.startsWith(siteBase) 
                ? currentPath.slice(siteBase.length) 
                : currentPath.replace(/^\//, '');
            const firstSegment = pathAfterBase.split('/')[0];
            
            const localePrefix = knownLocales.has(firstSegment) ? firstSegment + '/' : '';
            searchIndexUrl = baseUrl + '_docmd-search/' + localePrefix + 'search-index.json';
        }

        // Initialize paths once at startup
        updateSearchPaths();

        function escapeHtml(str: any): string {
            const s = typeof str === 'string' ? str : String(str || '');
            return s.replace(/[&<>"']/g, m => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[m] as string);
        }

        function getSnippet(text: string | undefined, query: string): string {
            if (!text) return '';
            const terms = query.split(/\s+/).filter(t => t.length > 2);
            let bestIndex = -1;
            for (const term of terms) {
                const idx = text.toLowerCase().indexOf(term.toLowerCase());
                if (idx >= 0) { bestIndex = idx; break; }
            }
            const start = Math.max(0, bestIndex - 60);
            const end = Math.min(text.length, bestIndex + 60);
            let snippet = text.substring(start, end);
            if (start > 0) snippet = '...' + snippet;
            if (end < text.length) snippet += '...';

            snippet = escapeHtml(snippet);

            // Then apply highlighting marks (escape terms to match escaped snippet)
            const safeTerms = terms.map(t => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            if (safeTerms) {
                snippet = snippet.replace(new RegExp(`(${safeTerms})`, 'gi'), '<mark>$1</mark>');
            }
            return snippet;
        }

        // 1. Open/Close Logic
        function openSearch() {
            updateSearchPaths();

            if (loadedIndexUrl !== searchIndexUrl) {
                isIndexLoaded = false;
                isSemanticMode = false;
                miniSearch = null;
                activeVersionFilters.clear();
                const filterContainer = document.getElementById('docmd-global-search-filters');
                if (filterContainer) filterContainer.remove();
            }

            searchModal.style.display = 'flex';
            window.lastFocusedElement = document.activeElement as HTMLElement | null;
            const isInert = searchInput.hasAttribute('inert') || searchInput.closest('[inert]') !== null;
            if (!isInert) {
                setTimeout(() => searchInput.focus(), 50);
            }

            if (!searchInput.value.trim()) {
                const sanitized = `<div class="search-initial">${escapeHtml(strings.initial)}</div>`;
                searchResults.innerHTML = sanitized;
                selectedIndex = -1;
            }
            if (!isIndexLoaded) loadIndex();
        }

        function closeSearch() {
            searchModal.style.display = 'none';
            if (window.lastFocusedElement) window.lastFocusedElement.focus();
            selectedIndex = -1;
        }

        // --- Event Delegation for Triggers (Survives SPA) ---
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('.docmd-search-trigger')) {
                e.preventDefault();
                openSearch();
            }
            if (target === searchModal || target?.closest('.docmd-search-close')) {
                closeSearch();
            }
        });

        // 2. Keyboard Navigation
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchModal.style.display === 'flex' ? closeSearch() : openSearch();
            }

            if (searchModal.style.display === 'flex') {
                const items = searchResults.querySelectorAll('.search-result-item') as NodeListOf<HTMLElement>;
                if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { selectedIndex = (selectedIndex + 1) % items.length; updateSelection(items); } }
                else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { selectedIndex = (selectedIndex - 1 + items.length) % items.length; updateSelection(items); } }
                else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (selectedIndex >= 0 && items[selectedIndex]) items[selectedIndex].click();
                    else if (items.length > 0) items[0].click();
                }
            }
        });

        function updateSelection(items: NodeListOf<HTMLElement>) {
            items.forEach((item, idx) => {
                item.classList.toggle('selected', idx === selectedIndex);
                if (idx === selectedIndex) item.scrollIntoView({ block: 'nearest' });
            });
        }

        // 3. Index Loading - fetches locale-specific index
        async function loadIndex() {
            // file:// detection: browsers block fetch() from file:// URLs for
            // security (CORS). Show a helpful message instead of the generic
            // "Failed to load" error. The user needs to serve the site via a
            // local HTTP server (e.g. `npx serve site`) for search to work.
            if (searchModal.dataset.offlineBuild === 'true') {
                const sanitized = `<div class="search-error">${escapeHtml(strings.offlineBuild)}</div>`;
                searchResults.innerHTML = sanitized;
                return;
            }

            if (window.location.protocol === 'file:') {
                const sanitized = `<div class="search-error">${escapeHtml(strings.offline)}</div>`;
                searchResults.innerHTML = sanitized;
                return;
            }

            // Semantic search is active when the build-time flag is set.
            // The build pipeline computes semanticUsable at config time and
            // stamps data-semantic="true" on the modal. We no longer run a
            // runtime HEAD probe: it caused a 404 on every keyword-only page
            // load, and the only case it covered (semantic deps installed
            // mid-build after pages were rendered) resolves on the next rebuild,
            // which dev mode triggers automatically.
            const useSemantic = searchModal.dataset.semantic === 'true';

            try {
                if (useSemantic) {
                    // ── Semantic search path ──────────────────────────────────
                    const ctx: SemanticSearch.SemanticSearchContext = {
                        siteBase,
                        ROOT_PATH,
                        searchResults,
                        strings,
                        activeVersionFilters,
                        globalAllVersions,
                        globalVersionColors,
                        selectedIndex,
                        updateSelection,
                        showConfidence: searchModal.dataset.showConfidence === 'true'
                    };

                    await SemanticSearch.loadSemanticIndex(ctx);
                    
                    // Render version filters if versions were loaded and filters are enabled
                    if (globalAllVersions.length > 0 && showFilters) {
                        renderGlobalFilters();
                    }

                    isSemanticMode = true;
                    isIndexLoaded = true;
                    loadedIndexUrl = searchIndexUrl;
                    if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
                    return;
                }

                // ── Keyword search path (default) ─────────────────────────────
                const response = await fetch(searchIndexUrl);
                if (response.headers.get("content-type")?.includes("text/html")) throw new Error("Invalid content type");
                if (!response.ok) throw new Error(String(response.status));

                const jsonString = await response.text();
                const indexData = JSON.parse(jsonString);
                
                // Extract all versions globally from the raw MiniSearch index data
                const docs = indexData.storedFields || {};
                globalAllVersions = [...new Set(Object.values(docs).map((d: any) => d.version).filter(Boolean))] as string[];
                globalAllVersions.sort();

                const huePresets = [210, 150, 30, 330, 270, 60, 180, 0];
                globalAllVersions.forEach((v, i) => {
                    const hue = huePresets[i % huePresets.length];
                    globalVersionColors[v] = { bg: `hsl(${hue}, 55%, 92%)`, fg: `hsl(${hue}, 60%, 35%)` };
                });

                const CJK_AND_SPACELESS_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff\u1000-\u109f\u0f00-\u0fff]/g;
                miniSearch = MiniSearch.loadJSON(jsonString, {
                    fields: ['title', 'headings', 'text'],
                    storeFields: ['title', 'id', 'text', 'version'],
                    tokenize: (text: string) => {
                        const spaced = text.replace(CJK_AND_SPACELESS_REGEX, ' $& ');
                        const defaultTokenize = MiniSearch.getDefault ? MiniSearch.getDefault('tokenize') : null;
                        return defaultTokenize ? defaultTokenize(spaced) : spaced.toLowerCase().split(/[^a-zA-Z0-9_'\u00C0-\u017F\u00d0\u00f0\u00df\u00f8\u00e6\u0153\u03ac-\u03ce\u0400-\u04ff]+/u).filter(Boolean);
                    },
                    searchOptions: { fuzzy: 0.2, prefix: true, boost: { title: 2, headings: 1.5 } }
                });
                
                console.log('[docmd-search] Index loaded. Versions found:', globalAllVersions.length);
                if (globalAllVersions.length > 0 && showFilters) {
                    renderGlobalFilters();
                }
                isIndexLoaded = true;
                loadedIndexUrl = searchIndexUrl;
                if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
            } catch {
                const sanitized = `<div class="search-error">${escapeHtml(strings.error)}</div>`;
                searchResults.innerHTML = sanitized;
            }
        }

        function renderGlobalFilters() {
            if (globalAllVersions.length === 0 || !showFilters) return;
            let filterContainer = document.getElementById('docmd-global-search-filters');
            if (!filterContainer) {
                filterContainer = document.createElement('div');
                filterContainer.id = 'docmd-global-search-filters';
                filterContainer.style.cssText = 'padding: 12px 20px 8px 20px; border-bottom: 1px solid var(--docmd-border); display: flex; flex-wrap: wrap; gap: 8px;';
                searchResults.parentNode?.insertBefore(filterContainer, searchResults);
            }

            const sanitized = globalAllVersions.map(v => {
                const vc = globalVersionColors[v];
                const isActive = activeVersionFilters.has(v);
                const icon = isActive 
                    ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>` 
                    : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;
                return `<span class="search-filter-tag ${isActive ? 'active' : ''}" data-version="${escapeHtml(v)}" style="background:${vc.bg};color:${vc.fg};cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;font-size:11px;border: 1px solid ${isActive ? vc.fg : 'transparent'}; opacity: ${activeVersionFilters.size > 0 && !isActive ? '0.6' : '1'}; transition: all 0.2s;">
                    ${icon} ${escapeHtml(v)}
                </span>`;
            }).join('');
            filterContainer.innerHTML = sanitized;

            filterContainer.querySelectorAll('.search-filter-tag').forEach(tag => {
                tag.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const v = (tag as HTMLElement).dataset.version!;
                    if (activeVersionFilters.has(v)) activeVersionFilters.delete(v);
                    else activeVersionFilters.add(v);
                    renderGlobalFilters();
                    if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
                });
            });
        }

        searchInput.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value.trim();
            selectedIndex = -1;
            if (!query) { 
                const sanitized = `<div class="search-initial">${escapeHtml(strings.initial)}</div>`;
                searchResults.innerHTML = sanitized; 
                return; 
            }
            if (!isIndexLoaded) return;

            // ── Semantic mode ────────────────────────────────────────────────
            if (isSemanticMode) {
                const ctx: SemanticSearch.SemanticSearchContext = {
                    siteBase,
                    ROOT_PATH,
                    searchResults,
                    strings,
                    activeVersionFilters,
                    globalAllVersions,
                    globalVersionColors,
                    selectedIndex,
                    updateSelection,
                    showConfidence: searchModal.dataset.showConfidence === 'true'
                };
                SemanticSearch.performSemanticSearch(query, ctx);
                return;
            }

            // ── Keyword mode (MiniSearch) ────────────────────────────────────
            let results = miniSearch.search(query);
            
            if (activeVersionFilters.size > 0) {
                results = results.filter((r: any) => activeVersionFilters.has(r.version));
            }

            if (results.length === 0) {
                const sanitized = `<div class="search-no-results">${activeVersionFilters.size > 0 ? 'No results match the selected filters.' : escapeHtml(strings.noResults)}</div>`;
                searchResults.innerHTML = sanitized;
                return;
            }

            const sanitized = results.slice(0, 10).map((result: any, index: number) => {
                const snippet = getSnippet(result.text, query);
                // Strip leading slash to avoid double-slash when concatenating with ROOT_PATH
                const cleanId = result.id.startsWith('/') ? result.id.slice(1) : result.id;
                // Sanitize: collapse any accidental double slashes (except after protocol)
                const linkHref = `${ROOT_PATH}${cleanId}`.replace(/([^:])\/\/+/g, '$1/');
                const vc = result.version ? globalVersionColors[result.version] : null;
                const versionBadge = result.version
                    ? `<div class="search-result-meta"><span class="search-result-version" style="background:${vc!.bg};color:${vc!.fg}">${escapeHtml(result.version)}</span></div>`
                    : '';
                return `
                    <a href="${linkHref}" class="search-result-item" data-index="${index}">
                        <div class="search-result-title">${escapeHtml(result.title)}${versionBadge}</div>
                        <div class="search-result-preview">${snippet}</div>
                    </a>`;
            }).join('');
            searchResults.innerHTML = sanitized;

            searchResults.querySelectorAll('.search-result-item').forEach((item, idx) => {
                item.addEventListener('mouseenter', () => { selectedIndex = idx; updateSelection(searchResults.querySelectorAll('.search-result-item') as NodeListOf<HTMLElement>); });
            });
        });

        // Close search when clicking a link (Important for SPA!)
        searchResults.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.search-result-item')) closeSearch();
        });

        window.closeDocmdSearch = closeSearch;
        (window as any).docmdSearch = {
            search: async (query: string, options?: { version?: string; versions?: string[]; filter?: (doc: any) => boolean }) => {
                if (!isIndexLoaded) await loadIndex();
                if (miniSearch) {
                    const searchOpts: any = {};
                    if (options?.filter) {
                        searchOpts.filter = options.filter;
                    } else if (options?.version) {
                        const targetV = options.version.toLowerCase().trim().replace(/^v/, '');
                        searchOpts.filter = (doc: any) => {
                            const docV = String(doc.version || '').toLowerCase().trim().replace(/^v/, '');
                            const docId = String(doc.id || '').toLowerCase().trim();
                            if (docV === targetV || docV.startsWith(targetV)) return true;
                            if (targetV.length === 2 && docV.replace(/\./g, '').startsWith(targetV)) return true;
                            return docId.startsWith(`${targetV}/`) || docId.includes(`/${targetV}/`) || docId.startsWith(`v${targetV}/`) || docId.includes(`/v${targetV}/`);
                        };
                    } else if (Array.isArray(options?.versions) && options.versions.length > 0) {
                        const targets = new Set(options.versions.map(v => v.toLowerCase().trim().replace(/^v/, '')));
                        searchOpts.filter = (doc: any) => {
                            const docV = String(doc.version || '').toLowerCase().trim().replace(/^v/, '');
                            const docId = String(doc.id || '').toLowerCase().trim();
                            for (const targetV of targets) {
                                if (docV === targetV || docV.startsWith(targetV)) return true;
                                if (targetV.length === 2 && docV.replace(/\./g, '').startsWith(targetV)) return true;
                                if (docId.startsWith(`${targetV}/`) || docId.includes(`/${targetV}/`) || docId.startsWith(`v${targetV}/`) || docId.includes(`/v${targetV}/`)) return true;
                            }
                            return false;
                        };
                    }
                    return miniSearch.search(query, searchOpts).map((r: any) => ({
                        title: r.title,
                        id: r.id,
                        version: r.version,
                        snippet: getSnippet(r.text, query),
                        text: r.text
                    }));
                }
                return [];
            }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSearch);
    } else {
        initSearch();
    }
})();