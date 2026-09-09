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

import path from 'path';
import { normalizeNavPaths, normalizeMenubarPaths } from '@docmd/parser';

/**
 * CSS themes shipped with @docmd/themes. Any other value of `theme.name`
 * is treated as a template name (see Section 4.0 of normalizeConfig).
 *
 * The "none" sentinel value suppresses the CSS overlay entirely.
 */
const KNOWN_CSS_THEMES: ReadonlySet<string> = new Set([
    'default',
    'sky',
    'ruby',
    'retro',
    'none',
]);

/**
 * Hardcoded English defaults for the 404 page. These are intentionally
 * NOT injected into `config.notFound` during normalisation — if we did,
 * the build site's `|| t('pageNotFound')` fallback would never fire
 * (the user-supplied English string would shadow it), and a site with
 * default locale = 'zh' would still render "404 : Page Not Found" in
 * English.
 *
 * Instead, the build command resolves the actual title/content at
 * render-time using this priority chain:
 *   1. config.notFound.title / config.notFound.content (user override)
 *   2. t('pageNotFound') / t('pageNotFoundMsg') (translated to default locale)
 *   3. NOT_FOUND_DEFAULTS.title / content (this constant, English)
 *
 * Exported here so the defaults live next to the rest of the config
 * schema rather than buried in the build command.
 */
export const NOT_FOUND_DEFAULTS = {
  title:   'Page Not Found',
  content: 'The page you’re looking for doesn’t exist or has moved.'
};

/**
 * Normalizes user config to ensure all required nested objects exist.
 * Handles legacy backward compatibility transparently.
 */
export function normalizeConfig(userConfig: any, options: any = {}) {
    const config = { ...userConfig };

    // --- 1. Modern Syntax Standard (V3) ---
    // New labels are the source of truth. Fallback to legacy labels if present.
    // Every field MUST have a default here so no consumer needs its own fallback chain.
    config.title = config.title || config.siteTitle || 'Documentation';
    config.url = config.url || config.siteUrl || config.baseUrl || '';
    config.src = config.src || config.srcDir || config.source || 'docs';
    config.out = process.env.DOCMD_PROJECT_OUT || config.out || config.outDir || config.outputDir || 'site';

    // Determine the base workspace URL path (domain root subpath).
    let workspaceBase = '/';
    const isDevContext = !!(process.env.DOCMD_DEV === 'true' || options.isDev);

    if (isDevContext) {
      workspaceBase = '/';
    } else if (userConfig.base !== undefined) {
      workspaceBase = userConfig.base;
    } else if (config.base && config.base !== '/') {
      workspaceBase = config.base;
    } else if (config.url) {
      try {
        const parsedUrl = new URL(config.url);
        const pathname = parsedUrl.pathname.replace(/\/+$/, '');
        if (pathname && pathname !== '/') {
          workspaceBase = pathname + '/';
        }
      } catch {
        // ignore invalid URL
      }
    }

    // Ensure workspaceBase starts and ends with a slash
    if (workspaceBase && workspaceBase !== '/') {
      let w = workspaceBase.trim();
      if (!w.startsWith('/')) w = '/' + w;
      if (!w.endsWith('/')) w = w + '/';
      w = w.replace(/([^:])\/{2,}/g, '$1/');
      workspaceBase = w;
    } else {
      workspaceBase = '/';
    }

    // Combine with the active workspace prefix if present
    const projectPrefix = process.env.DOCMD_PROJECT_PREFIX || '';
    if (projectPrefix && projectPrefix !== '/') {
      if (workspaceBase !== '/') {
        config.base = path.posix.join(workspaceBase, projectPrefix);
      } else {
        config.base = projectPrefix;
      }
    } else {
      config.base = workspaceBase;
    }

    // Normalise final config.base slashes
    if (config.base && config.base !== '/') {
      let b = config.base.trim();
      if (!b.startsWith('/')) b = '/' + b;
      if (!b.endsWith('/')) b = b + '/';
      b = b.replace(/([^:])\/{2,}/g, '$1/');
      if (b !== userConfig.base && b !== process.env.DOCMD_PROJECT_PREFIX) {
        config._baseNormalised = b;
      }
      config.base = b;
    } else {
      config.base = '/';
    }

    const _userSetBaseExplicitly = userConfig.base !== undefined || !!process.env.DOCMD_PROJECT_PREFIX;
    // Top-level QoL defaults — opt out by setting `false`.
    if (config.pageNavigation === undefined) config.pageNavigation = true;
    if (config.copyCode === undefined) config.copyCode = true;
    if (config.autoTitleFromH1 === undefined) config.autoTitleFromH1 = true;
    // autoNav: when true (default), docmd auto-generates navigation from the
    // source tree if the user provides no navigation, an empty navigation
    // array, or no navigation.json. Set false to keep navigation empty.
    if (config.autoNav === undefined) config.autoNav = true;

    // --- 1.5 Security defaults ---
    // Controls how the markdown parser handles raw HTML in user content.
    //   'allow'  - raw HTML passes through to the rendered output (industry standard default)
    //   'escape' - raw HTML is HTML-escaped and shown as text
    //   'strip'  - raw HTML blocks are removed from the rendered output
    const VALID_HTML_POLICIES = new Set(['allow', 'escape', 'strip']);
    const userHtmlPolicy = config.security && config.security.html;
    config.security = {
        html: VALID_HTML_POLICIES.has(userHtmlPolicy) ? userHtmlPolicy : 'allow',
    };

    // Failsafe: Keep legacy keys attached for older plugins (SEO, Sitemap) to prevent breakage during transition.
    config.siteTitle = config.title;
    config.siteUrl = config.url;
    config.srcDir = config.src;
    config.outputDir = config.out;

    // --- Logo Normalization
    if (typeof config.logo === 'string') {
        config.logo = {
            light: config.logo,
            dark: config.logo,
            alt: config.title || 'Logo'
        };
    }

    // --- 2. Layout Structure (V2 Schema) ---
    const userLayout = config.layout || {};

    config.layout = {
        spa: true,
        breadcrumbs: true,
        ...userLayout
    };

    config.header = {
        enabled: true,
        ...(userLayout.header || config.header || {})
    };

    // Legacy Mapping: Sidebar
    const legacySidebar = config.sidebar || {};
    config.sidebar = {
        enabled: true,
        collapsible: true,
        defaultCollapsed: false,
        position: 'left',
        ...(userLayout.sidebar || legacySidebar)
    };

    // Legacy Mapping: Footer
    const legacyFooter = config.footer;
    config.footer = {
        copyright: `© ${new Date().getFullYear()}`,
        style: 'minimal',
        content: typeof legacyFooter === 'string' ? legacyFooter : null,
        branding: true,
        ...(userLayout.footer || (typeof legacyFooter === 'object' ? legacyFooter : {}))
    };

    if (config.footer.columns && Array.isArray(config.footer.columns)) {
        for (const col of config.footer.columns) {
            if (col.links && Array.isArray(col.links)) {
                normalizeMenubarPaths(col.links);
            }
        }
    }

    // --- 3. Options Menu (Search, Theme, Focus Mode, Print, Sponsor) ---
    const defaultOptionsMenuComponents = {
        search: true,
        themeSwitch: true,
        focusMode: true,
        print: true,
        sponsor: null
    };

    const userOptionsMenu = userLayout.optionsMenu || config.optionsMenu || {};
    config.optionsMenu = {
        position: 'header',
        ...userOptionsMenu,
        components: {
            ...defaultOptionsMenuComponents,
            ...(userOptionsMenu.components || {})
        }
    };

    // --- 3.1. Site-wide Banner (new in 0.8.7) ---
    // Sits above the menubar. Opt-in — defaults to null (no banner rendered).
    if (config.layout?.banner) {
        const ub = config.layout.banner;
        config.layout.banner = {
            content: typeof ub === 'string' ? ub : (ub.content || ub.html || ''),
            html: typeof ub === 'object' && ub.html ? ub.html : undefined,
            type: (typeof ub === 'object' && ub.type) ? ub.type : 'info',
            dismissible: typeof ub === 'object' && ub.dismissible === false ? false : true,
            link: typeof ub === 'object' && ub.link && ub.link.url ? ub.link : null,
            icon: typeof ub === 'object' && ub.icon ? ub.icon : null,
        };
        // If only a string was passed, `ub` is a string and `content` is the string.
        // If it's an object, ensure `content` and `html` are mutually consistent.
        if (config.layout.banner.html && !config.layout.banner.content) {
            config.layout.banner.content = config.layout.banner.html;
        }
    } else {
        config.layout.banner = null;
    }

    // --- Menubar (Top Navigation Bar) ---
    const userMenubar = userLayout.menubar || config.menubar;
    if (userMenubar) {
        const isArray = Array.isArray(userMenubar);
        config.menubar = {
            enabled: true,
            position: (!isArray && userMenubar.position) ? userMenubar.position : 'top',
            left: isArray ? userMenubar : (Array.isArray(userMenubar.left) ? userMenubar.left : []),
            right: (!isArray && Array.isArray(userMenubar.right)) ? userMenubar.right : [],
            ...(!isArray ? userMenubar : {})
        };
        normalizeMenubarPaths(config.menubar.left);
        normalizeMenubarPaths(config.menubar.right);
    } else {
        config.menubar = null;
    }

    // --> Legacy Adapter: Sponsor
    if (config.sponsor) {
        if (typeof config.sponsor === 'object' && config.sponsor.enabled && config.sponsor.link) {
            config.optionsMenu.components.sponsor = config.sponsor.link;
        } else if (typeof config.sponsor === 'string') {
            config.optionsMenu.components.sponsor = config.sponsor;
        }
    }

    // --> Legacy Adapter: Search (Boolean)
    if (typeof config.search === 'boolean') {
        config.optionsMenu.components.search = config.search;
    }

    // --> Legacy Adapter: Theme Switch & Position
    if (config.theme) {
        if (config.theme.enableModeToggle === false) {
            config.optionsMenu.components.themeSwitch = false;
        }
        if (config.theme.positionMode === 'bottom') {
            config.optionsMenu.position = 'sidebar-bottom';
        } else if (config.theme.positionMode === 'top') {
            config.optionsMenu.position = 'header';
        }
    }

    // --- 4. Theme & Branding ---
    config.theme = {
        name: 'default',
        appearance: 'system',
        customCss: [],
        codeHighlight: true,
        ...(config.theme || {})
    };

    // Legacy Support: Map defaultMode to appearance if appearance isn't explicitly set
    if (config.theme.defaultMode && !userConfig.theme?.appearance) {
        config.theme.appearance = config.theme.defaultMode;
    }

    // Ensure defaultMode is still available for legacy templates/plugins
    config.theme.defaultMode = config.theme.appearance;

    // --- 4.0. Theme name → Template auto-promotion (new in 0.8.7) ---
    // The CSS themes shipped with @docmd/themes are a known, short list.
    // Any other value in `theme.name` is treated as a template name (so
    // users only need to learn ONE key: `theme.name`).
    // Explicit `theme.template` always wins.
    if (config.theme.name && !config.theme.template && !KNOWN_CSS_THEMES.has(config.theme.name)) {
        config.theme.template = config.theme.name;
        // Keep `theme.name` so the original intent is preserved, but
        // mark the theme as "no CSS overlay" so the generator does not
        // try to load `docmd-theme-${name}.css` (which would 404).
        config.theme._noCssOverlay = true;
    }

    // --- 4.1. Cookie Consent (new in 0.8.7) ---
    // Opt-in. Users add `"cookie": { ... }` to enable the consent dialog.
    // Defaults are kept conservative; templates can ship their own defaults
    // by reading config.cookie and supplying a copy in their template's
    // onboarding step. The user is always in control.
    if (config.cookie) {
        const uc = config.cookie;
        if (uc === true) {
            config.cookie = { enabled: true };
        } else if (typeof uc === 'object') {
            config.cookie = {
                enabled: uc.enabled !== false,
                message: uc.message || null,
                acceptText: uc.acceptText || null,
                declineText: uc.declineText || null,
                policyUrl: uc.policyUrl || null,
                position: ['bottom', 'bottom-left', 'bottom-right', 'center'].includes(uc.position) ? uc.position : 'bottom',
                dismissible: uc.dismissible !== false,
                expiryDays: typeof uc.expiryDays === 'number' && uc.expiryDays > 0 ? uc.expiryDays : 180,
            };
        } else {
            config.cookie = null;
        }
    } else {
        config.cookie = null;
    }

    config.customJs = config.customJs || [];

    // Normalize Navigation
    config.navigation = Array.isArray(config.navigation) ? config.navigation : [];
    normalizeNavPaths(config.navigation);

    // Aliasing for Menubar items (title -> text, path -> url)
    if (config.menubar) {
        const normalizeItems = (items: any[]) => {
            items.forEach(item => {
                if (item.title && !item.text) item.text = item.title;
                if (item.path && !item.url) item.url = item.path;
                if (item.items) normalizeItems(item.items);
            });
        };
        if (config.menubar.left) normalizeItems(config.menubar.left);
        if (config.menubar.right) normalizeItems(config.menubar.right);
    }

    // --- 5. Plugins ---
    config.hasExplicitPlugins = 'plugins' in userConfig;
    config.plugins = config.plugins || {};

    // --- 6. Versioning Engine ---
    // M-6: accept `config.versions.list` as an alias for `config.versions.all`.
    // The original audit reported "i18n + explicit versions: 0 pages (silent)"
    // — turns out the actual cause was a typo: users wrote `list` (a
    // common shape for "list of versions") but the schema only accepted
    // `all`, so the config branch was never entered and zero pages got
    // built. Aliasing `list` to `all` here restores the user's config
    // without changing the canonical key.
    if (config.versions && Array.isArray(config.versions.list) && !Array.isArray(config.versions.all)) {
        config.versions.all = config.versions.list;
    }
    if (config.versions && Array.isArray(config.versions.all)) {
        if (!config.versions.current) {
            config.versions.current = config.versions.all[0]?.id || 'main';
        }
        config.versions.position = config.versions.position || 'sidebar-top';
        config.versions.all = config.versions.all.map((v: any) => {
            return {
                id: v.id,
                dir: v.dir || `docs-${v.id}`,
                label: v.label || v.id,
                navigation: v.navigation || null
            };
        });
    } else {
        config.versions = false;
    }

    // --- 7. SEO Redirects & 404 ---
    // config.notFound is normalised to an empty object here so build
    // commands can read `config.notFound?.title` / `content` without
    // optional-chaining every access. The English defaults live in the
    // exported NOT_FOUND_DEFAULTS constant and are applied at render
    // time (NOT pre-injected into config.notFound — that would shadow
    // the translation fallback chain in the build command).
    config.redirects = config.redirects || {};
    config.notFound = config.notFound || {};

    // --- 8. Internationalisation (i18n) ---
    if (config.i18n && config.i18n.locales && Array.isArray(config.i18n.locales) && config.i18n.locales.length > 0) {
        config.i18n = {
            default: config.i18n.default || config.i18n.locales[0].id || 'en',
            position: config.i18n.position || 'options-menu',
            stringMode: config.i18n.stringMode || false,
            inPlace: config.i18n.inPlace || false,
            locales: config.i18n.locales.map((loc: any) => ({
                id: loc.id,
                label: loc.label || loc.id,
                dir: loc.dir || 'ltr',
                translations: loc.translations || {}
            }))
        };
    } else {
        config.i18n = false;
    }

    // --- 9. OptionsMenu Fallbacks ---
    if (config.optionsMenu.position === 'menubar' && (!config.menubar || config.menubar.enabled === false)) {
        config.optionsMenu.position = 'sidebar-top';
    } else if (config.optionsMenu.position === 'header' && (!config.header || config.header.enabled === false)) {
        config.optionsMenu.position = 'sidebar-top';
    }

    return config;
}

// Re-export for backward compatibility (used by generator.ts, versioning.ts)
export { normalizeNavPaths, normalizeMenubarPaths } from '@docmd/parser';