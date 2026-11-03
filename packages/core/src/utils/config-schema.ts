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
 * Valid layout banner positions.
 * - 'top': Site-wide banner (text only, image disallowed)
 * - 'sidebar-top': Top of the sidebar (image + text allowed)
 * - 'sidebar-bottom': Bottom of the sidebar (image + text allowed)
 * - 'toc-top': Top of table of contents rail (image + text allowed)
 * - 'toc-bottom': Bottom of table of contents rail (image + text allowed)
 */
export const VALID_BANNER_POSITIONS: ReadonlySet<string> = new Set([
    'top',
    'sidebar-top',
    'sidebar-bottom',
    'toc-top',
    'toc-bottom'
]);

export function normalizeBannerItem(ub: any, defaultPos: string = 'top'): any {
    if (!ub) return null;
    if (typeof ub === 'string') {
        const text = ub.trim();
        if (!text) return null;
        return {
            content: text,
            html: undefined,
            type: 'info',
            dismissible: defaultPos === 'top',
            link: null,
            icon: null,
            image: null,
            alt: '',
            position: defaultPos
        };
    }
    if (typeof ub === 'object') {
        const pos = (ub.position && VALID_BANNER_POSITIONS.has(ub.position)) ? ub.position : defaultPos;
        let link: any = null;
        if (typeof ub.link === 'string' && ub.link.trim()) {
            link = { url: ub.link.trim(), text: '' };
        } else if (typeof ub.link === 'object' && ub.link && ub.link.url) {
            link = { url: String(ub.link.url).trim(), text: String(ub.link.text || '') };
        }
        const rawDismiss = ub.dismissible !== undefined
            ? ub.dismissible
            : (ub.dismissable !== undefined ? ub.dismissable : ub.closable);
        const dismissible = rawDismiss !== undefined
            ? (rawDismiss !== false && rawDismiss !== 'false')
            : (pos === 'top');

        const bannerObj: any = {
            content: typeof ub.content === 'string' ? ub.content : (ub.html || ''),
            html: typeof ub.html === 'string' ? ub.html : undefined,
            type: ub.type || 'info',
            dismissible,
            link,
            icon: ub.icon || null,
            image: (pos !== 'top' && typeof ub.image === 'string' && ub.image.trim()) ? ub.image.trim() : null,
            alt: typeof ub.alt === 'string' ? ub.alt : '',
            position: pos
        };
        if (bannerObj.html && !bannerObj.content) {
            bannerObj.content = bannerObj.html;
        }
        return bannerObj;
    }
    return null;
}

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
        const cleanBase = workspaceBase.replace(/\/+$/, '');
        const cleanPrefix = projectPrefix.replace(/^\/+/, '').replace(/\/+$/, '');
        if (cleanBase.endsWith('/' + cleanPrefix) || cleanBase === '/' + cleanPrefix) {
          config.base = workspaceBase;
        } else {
          config.base = path.posix.join(workspaceBase, projectPrefix);
        }
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

    // --- 1.5 Security defaults ---
    // Controls how the markdown parser handles raw HTML in user content.
    //   'allow'  - raw HTML passes through to the rendered output (industry standard default)
    //   'escape' - raw HTML is HTML-escaped and shown as text
    //   'strip'  - raw HTML blocks are removed from the rendered output
    const VALID_HTML_POLICIES = new Set(['allow', 'escape', 'strip']);
    const userHtmlPolicy = (config.security && (config.security.html || config.security.htmlPolicy)) || config.htmlPolicy || config.htmlSecurity;
    config.security = {
        html: VALID_HTML_POLICIES.has(userHtmlPolicy) ? userHtmlPolicy : 'allow',
        ...(typeof config.security === 'object' ? config.security : {})
    };
    config.security.html = VALID_HTML_POLICIES.has(userHtmlPolicy) ? userHtmlPolicy : 'allow';
    config.htmlPolicy = config.security.html;

    // Failsafe: Keep legacy keys attached for older plugins (SEO, Sitemap) to prevent breakage during transition.
    config.siteTitle = config.title;
    config.siteUrl = config.url;
    config.srcDir = config.src;
    config.outputDir = config.out;

    // --- Markdown Options ---
    // linkifyDefaultScheme: scheme prepended to bare-domain autolinks (e.g. `github.com`).
    // 'https' is the industry default — virtually all public sites support HTTPS and
    // linking to http:// is a security footprint concern. Use 'http' only for
    // internal/legacy environments where HTTPS is unavailable.
    const VALID_LINKIFY_SCHEMES = new Set(['https', 'http']);
    const rawLinkifyScheme = config.markdown?.linkifyDefaultScheme;
    const resolvedLinkifyScheme = VALID_LINKIFY_SCHEMES.has(rawLinkifyScheme) ? rawLinkifyScheme : 'https';
    config.markdown = {
        breaks: typeof config.markdown?.breaks === 'boolean' ? config.markdown.breaks : true,
        linkify: typeof config.markdown?.linkify === 'boolean' ? config.markdown.linkify : true,
        typographer: typeof config.markdown?.typographer === 'boolean' ? config.markdown.typographer : true,
        ...(typeof config.markdown === 'object' && config.markdown !== null ? config.markdown : {}),
        // Always apply the validated scheme last so a user cannot supply an
        // invalid value (anything other than 'https' | 'http') via the spread.
        linkifyDefaultScheme: resolvedLinkifyScheme
    };

    // --- Exclude / Ignore Patterns ---
    config.exclude = Array.isArray(config.exclude)
      ? config.exclude.filter((x: any) => typeof x === 'string' && x.trim().length > 0)
      : (typeof config.exclude === 'string' && config.exclude.trim() ? [config.exclude.trim()] : []);

    // --- Logo Normalization
    if (typeof config.logo === 'string') {
        config.logo = {
            light: config.logo,
            dark: config.logo,
            alt: config.title || 'Logo'
        };
    }

    // --- 2. Layout Structure (V2/V3 Schema) ---
    const userLayout = config.layout || {};

    // Top-level QoL defaults — opt out by setting `false`.
    const resolvedPageNav = userLayout.pageNavigation !== undefined ? userLayout.pageNavigation : config.pageNavigation;
    config.pageNavigation = resolvedPageNav === undefined ? true : !!resolvedPageNav;

    const resolvedCopyCode = userLayout.copyCode !== undefined ? userLayout.copyCode : config.copyCode;
    config.copyCode = resolvedCopyCode === undefined ? true : !!resolvedCopyCode;

    if (config.autoTitleFromH1 === undefined) config.autoTitleFromH1 = true;
    if (config.autoNav === undefined) config.autoNav = true;

    // Resolve focusMode (DISABLED by default)
    // Fallback order:
    // 1. userLayout.focusMode
    // 2. userConfig.focusMode
    // 3. optionsMenu.components.focusMode (layout or root)
    // 4. default false
    let isFocusModeEnabled = false;
    if (typeof userLayout.focusMode === 'boolean') {
        isFocusModeEnabled = userLayout.focusMode;
    } else if (typeof userLayout.focusMode === 'object' && userLayout.focusMode !== null) {
        isFocusModeEnabled = userLayout.focusMode.enabled !== false;
    } else if (typeof userConfig.focusMode === 'boolean') {
        isFocusModeEnabled = userConfig.focusMode;
    } else if (typeof userConfig.focusMode === 'object' && userConfig.focusMode !== null) {
        isFocusModeEnabled = userConfig.focusMode.enabled !== false;
    } else if (userLayout.optionsMenu?.components?.focusMode !== undefined) {
        isFocusModeEnabled = !!userLayout.optionsMenu.components.focusMode;
    } else if (userConfig.optionsMenu?.components?.focusMode !== undefined) {
        isFocusModeEnabled = !!userConfig.optionsMenu.components.focusMode;
    }

    // Resolve print (DISABLED by default)
    // Fallback order:
    // 1. userLayout.print
    // 2. userConfig.print
    // 3. userLayout.copyWidgets?.print or userConfig.theme?.copyWidgets?.print
    // 4. userLayout.optionsMenu?.components?.print or userConfig.optionsMenu?.components?.print
    // 5. default false
    let isPrintEnabled = false;
    if (typeof userLayout.print === 'boolean') {
        isPrintEnabled = userLayout.print;
    } else if (typeof userLayout.print === 'object' && userLayout.print !== null) {
        isPrintEnabled = userLayout.print.enabled !== false;
    } else if (typeof userConfig.print === 'boolean') {
        isPrintEnabled = userConfig.print;
    } else if (typeof userConfig.print === 'object' && userConfig.print !== null) {
        isPrintEnabled = userConfig.print.enabled !== false;
    } else if (userLayout.copyWidgets?.print !== undefined) {
        isPrintEnabled = !!userLayout.copyWidgets.print;
    } else if (userConfig.theme?.copyWidgets?.print !== undefined) {
        isPrintEnabled = !!userConfig.theme.copyWidgets.print;
    } else if (userLayout.optionsMenu?.components?.print !== undefined) {
        isPrintEnabled = !!userLayout.optionsMenu.components.print;
    } else if (userConfig.optionsMenu?.components?.print !== undefined) {
        isPrintEnabled = !!userConfig.optionsMenu.components.print;
    }

    // Resolve copyWidgets (layout.copyWidgets or theme.copyWidgets)
    const userCopyWidgets = userLayout.copyWidgets || userConfig.theme?.copyWidgets || {};
    const normalizedCopyWidgets = {
        enabled: userCopyWidgets.enabled !== false,
        raw: userCopyWidgets.raw !== false,
        context: userCopyWidgets.context !== false,
        ...userCopyWidgets
    };

    const rawTitleSeparator = userLayout.titleSeparator !== undefined
        ? userLayout.titleSeparator
        : (config.titleSeparator !== undefined ? config.titleSeparator : '-');

    const rawTitleAppend = userLayout.titleAppend !== undefined
        ? userLayout.titleAppend
        : (config.titleAppend !== undefined ? config.titleAppend : true);

    config.layout = {
        spa: true,
        breadcrumbs: true,
        ...userLayout,
        titleSeparator: rawTitleSeparator,
        titleAppend: rawTitleAppend,
        focusMode: isFocusModeEnabled,
        print: isPrintEnabled,
        pageNavigation: config.pageNavigation,
        copyCode: config.copyCode,
        copyWidgets: normalizedCopyWidgets
    };

    // Attach root aliases for backward compatibility
    config.focusMode = isFocusModeEnabled;
    config.print = isPrintEnabled;
    if (config.titleSeparator === undefined) config.titleSeparator = rawTitleSeparator;
    if (config.titleAppend === undefined) config.titleAppend = rawTitleAppend;

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

    // --- 3. Options Menu (Search, Theme, Focus Mode, Sponsor) ---
    // Note: Print is strictly NOT part of the header/menubar options menu.
    const defaultOptionsMenuComponents = {
        search: true,
        themeSwitch: true,
        focusMode: isFocusModeEnabled,
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
    // Ensure print is never rendered in header/menubar options menu
    if (config.optionsMenu.components) {
        delete (config.optionsMenu.components as any).print;
    }
    config.layout.optionsMenu = config.optionsMenu;

    // --- 3.1. Banners (multi-position support) ---
    // Positions: 'top' | 'sidebar-top' | 'sidebar-bottom' | 'toc-top' | 'toc-bottom'
    // 'top' allows text only (image disallowed); 'sidebar-*' and 'toc-*' allow both text and images.
    const rawBanners = config.layout?.banners || userLayout.banners;
    const rawBanner = config.layout?.banner || userLayout.banner;
    const bannersMap: Record<string, any> = {};

    if (rawBanners) {
        if (Array.isArray(rawBanners)) {
            for (const item of rawBanners) {
                const norm = normalizeBannerItem(item, 'top');
                if (norm && VALID_BANNER_POSITIONS.has(norm.position)) {
                    bannersMap[norm.position] = norm;
                }
            }
        } else if (typeof rawBanners === 'object') {
            for (const [posKey, item] of Object.entries(rawBanners)) {
                if (VALID_BANNER_POSITIONS.has(posKey)) {
                    const norm = normalizeBannerItem(item, posKey);
                    if (norm) {
                        norm.position = posKey;
                        bannersMap[posKey] = norm;
                    }
                }
            }
        }
    }

    if (rawBanner) {
        const norm = normalizeBannerItem(rawBanner, 'top');
        if (norm && VALID_BANNER_POSITIONS.has(norm.position)) {
            bannersMap[norm.position] = norm;
        }
    }

    config.layout.banners = bannersMap;
    config.layout.banner = bannersMap['top'] || null;

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
    const rawCustomCss = userConfig.theme?.customCss || userConfig.customCss || [];
    const normalizedCustomCss = Array.isArray(rawCustomCss) ? rawCustomCss : (rawCustomCss ? [rawCustomCss] : []);

    const rawCustomJs = userConfig.theme?.customJs || userConfig.customJs || [];
    const normalizedCustomJs = Array.isArray(rawCustomJs) ? rawCustomJs : (rawCustomJs ? [rawCustomJs] : []);

    config.theme = {
        name: 'default',
        appearance: 'system',
        codeHighlight: true,
        ...(config.theme || {}),
        customCss: normalizedCustomCss,
        customJs: normalizedCustomJs,
        copyWidgets: normalizedCopyWidgets
    };

    config.customCss = normalizedCustomCss;
    config.customJs = normalizedCustomJs;

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
                dismissible: (uc.dismissible !== undefined ? uc.dismissible : (uc.dismissable !== undefined ? uc.dismissable : uc.closable)) !== false,
                expiryDays: typeof uc.expiryDays === 'number' && uc.expiryDays > 0 ? uc.expiryDays : 180,
            };
        } else {
            config.cookie = null;
        }
    } else {
        config.cookie = null;
    }

    // Edit Link (layout.editLink or root editLink)
    const userEditLink = userLayout.editLink || config.editLink;
    if (userEditLink) {
        config.editLink = typeof userEditLink === 'object' ? {
            enabled: userEditLink.enabled !== false,
            baseUrl: userEditLink.baseUrl || userEditLink.url || '',
            text: userEditLink.text || null
        } : null;
        config.layout.editLink = config.editLink;
    } else {
        config.editLink = null;
        config.layout.editLink = null;
    }

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
                navigation: v.navigation || null,
                banner: v.banner !== undefined ? v.banner : undefined,
                banners: v.banners !== undefined ? v.banners : undefined,
                layout: v.layout !== undefined ? v.layout : undefined
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
                translations: loc.translations || {},
                banner: loc.banner !== undefined ? loc.banner : undefined,
                banners: loc.banners !== undefined ? loc.banners : undefined,
                layout: loc.layout !== undefined ? loc.layout : undefined
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