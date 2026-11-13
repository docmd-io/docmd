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
import fs from 'fs/promises';
import nativeFs from 'fs';
import type { PluginDescriptor, DoctorCheckResult, DoctorContext } from '@docmd/api';
import { outputPathToPathname, sanitizeUrl } from '@docmd/api';
import { attrEsc, jsonInject, resolveTitle } from '@docmd/utils';

export const plugin: PluginDescriptor = {
  name: 'seo',
  version: '0.10.0',
  capabilities: ['head', 'post-build', 'doctor']
};

/**
 * Strips HTML tags, script blocks, and style blocks to produce clean plain text.
 * Uses a linear character scanner instead of regular expressions to guarantee
 * linear O(N) performance and eliminate any ReDoS or tag-filtering vulnerabilities.
 */
function stripHtmlToText(html: string): string {
  if (!html || typeof html !== 'string') return '';
  let inTag = false;
  let inScript = false;
  let inStyle = false;
  let tagBuffer = '';
  let text = '';

  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') {
      inTag = true;
      tagBuffer = '<';
      continue;
    }
    if (inTag) {
      tagBuffer += ch;
      if (ch === '>') {
        inTag = false;
        const lower = tagBuffer.toLowerCase();
        if (lower.startsWith('<script')) {
          inScript = true;
        } else if (lower.startsWith('</script')) {
          inScript = false;
        } else if (lower.startsWith('<style')) {
          inStyle = true;
        } else if (lower.startsWith('</style')) {
          inStyle = false;
        } else if (!inScript && !inStyle && text.length > 0 && !text.endsWith(' ')) {
          text += ' ';
        }
        tagBuffer = '';
      }
      continue;
    }
    if (!inScript && !inStyle) {
      text += ch;
    }
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Generates HTML meta tags for a specific page.
 * @param {Object} config - Project config
 * @param {Object} pageData - { frontmatter, outputPath, breadcrumbs, searchData, urlContext }
 * @param {string} relativePathToRoot - Path relative to root (for assets)
 * @returns {string} HTML string of meta tags
 */
export function generateMetaTags(config: any, pageData: any, _relativePathToRoot: string) {
  const { frontmatter = {}, outputPath } = pageData;

  // Suppress meta tags if frontmatter explicitly disables meta components (e.g. no-style pages)
  if (frontmatter.components?.meta === false) {
    return '';
  }

  let html = '';
  const seo = frontmatter.seo || {}; // Page-specific SEO overrides
  const globalSeo = config.plugins?.seo || config.seo || {};

  // 1. Robots
  if (frontmatter.noindex || seo.noindex) {
    return '<meta name="robots" content="noindex">\n';
  }

  // 1.5 AI Bots Control
  // By default (aiBots: true), AI bots are allowed to index content
  // Set aiBots: false to block AI training bots
  const aiBots = seo.aiBots ?? globalSeo.aiBots ?? true; // Default: true (allow)
  if (aiBots === false) {
    const bots = ['GPTBot', 'ChatGPT-User', 'Google-Extended', 'CCBot', 'anthropic-ai', 'Omgilibot', 'Omgili', 'FacebookBot', 'Diffbot', 'Bytespider', 'ImagesiftBot', 'cohere-ai'];
    bots.forEach(bot => {
      html += `<meta name="${bot}" content="noindex">\n`;
    });
  }

  // 2. Basic Meta
  const siteTitle = config.title || config.siteTitle;
  const pageTitle = frontmatter.title || 'Untitled';
  let description = seo.description
    || frontmatter.description
    || globalSeo.description
    || globalSeo.defaultDescription
    || config.description
    || '';

  // Smart Fallback Description:
  // 1. From searchData content if available
  if (!description && pageData.searchData && pageData.searchData.content) {
    const contentPrefix = pageData.searchData.content.replace(/\s+/g, ' ').trim();
    description = contentPrefix.length > 155 ? contentPrefix.substring(0, 152) + '...' : contentPrefix;
  }

  // 2. From page HTML if available (strip tags and clean up whitespace)
  if (!description && pageData.html) {
    const text = stripHtmlToText(pageData.html);
    if (text) {
      description = text.length > 155 ? text.substring(0, 152) + '...' : text;
    }
  }

  // 3. Fallback to page title and site title context
  if (!description) {
    if (pageTitle && siteTitle && pageTitle !== siteTitle && pageTitle !== 'Untitled') {
      description = `${pageTitle} - ${siteTitle} documentation`;
    } else if (siteTitle) {
      description = `${siteTitle} documentation`;
    } else if (pageTitle && pageTitle !== 'Untitled') {
      description = pageTitle;
    }
  }

  // Self-healing: avoid emitting empty <meta name="description" content="">
  // Empty description tags trigger warnings on Google Webmasters / Search Console.
  if (description && description.trim()) {
    html += `<meta name="description" content="${attrEsc(description.trim())}">\n`;
  }

  // 3. Canonical URL
  const rawSiteUrl = config.url || config.siteUrl;
  const siteUrl = rawSiteUrl ? rawSiteUrl.replace(/\/$/, '') : '';
  const pathname = outputPathToPathname(outputPath);
  const pageUrl = siteUrl ? sanitizeUrl(siteUrl + pathname) : '';

  const isOffline = !!pageData.urlContext?.offline;
  const canonicalDisabled = seo.canonical === false || frontmatter.canonical === false || frontmatter.canonicalUrl === false;
  const canonical = canonicalDisabled ? null : (seo.canonicalUrl || frontmatter.canonicalUrl || pageUrl);
  if (canonical && (!isOffline || canonical.startsWith('http'))) {
    html += `<link rel="canonical" href="${attrEsc(canonical)}">\n`;
  }

  // 4. Open Graph (Facebook/LinkedIn)
  // Unified title resolution respecting frontmatter > layout > seo > root hierarchy & formatTitleSeparator
  const fullTitle = resolveTitle(pageTitle, siteTitle, config, frontmatter);

  html += `<meta property="og:title" content="${attrEsc(fullTitle)}">\n`;
  if (siteTitle) {
    html += `<meta property="og:site_name" content="${attrEsc(siteTitle)}">\n`;
  }
  if (description && description.trim()) {
    html += `<meta property="og:description" content="${attrEsc(description.trim())}">\n`;
  }
  if (pageUrl && (!isOffline || pageUrl.startsWith('http'))) {
    html += `<meta property="og:url" content="${attrEsc(pageUrl)}">\n`;
  }
  html += `<meta property="og:type" content="${attrEsc(seo.ogType || frontmatter.ogType || 'website')}">\n`;

  // Locale Support
  const pageLocale = frontmatter.locale || frontmatter.lang || pageData.locale || config.i18n?.default;
  if (pageLocale && typeof pageLocale === 'string') {
    const formattedLocale = pageLocale.replace('-', '_');
    html += `<meta property="og:locale" content="${attrEsc(formattedLocale)}">\n`;
  }

  // Image Logic with smart branded fallback
  let image = seo.image
    || frontmatter.image
    || globalSeo.image
    || globalSeo.openGraph?.defaultImage
    || globalSeo.defaultImage
    || (config.logo && typeof config.logo === 'object' ? (config.logo.dark || config.logo.light) : (typeof config.logo === 'string' ? config.logo : null));
  if (image) {
    if (!image.startsWith('http')) {
      image = siteUrl ? `${siteUrl}/${image.replace(/^\.?\//, '')}` : '';
    }
    if (image && (!isOffline || image.startsWith('http'))) {
      html += `<meta property="og:image" content="${attrEsc(image)}">\n`;
    }
  }

  // 5. Twitter Card with smart fallback
  const cardType = seo.twitterCard || globalSeo.twitter?.cardType || (image ? 'summary_large_image' : 'summary');
  html += `<meta name="twitter:card" content="${attrEsc(cardType)}">\n`;

  if (globalSeo.twitter?.siteUsername) {
    html += `<meta name="twitter:site" content="${attrEsc(globalSeo.twitter.siteUsername)}">\n`;
  }

  html += `<meta name="twitter:title" content="${attrEsc(fullTitle)}">\n`;
  if (description && description.trim()) {
    html += `<meta name="twitter:description" content="${attrEsc(description.trim())}">\n`;
  }
  if (image && (!isOffline || image.startsWith('http'))) {
    html += `<meta name="twitter:image" content="${attrEsc(image)}">\n`;
  }

  // 6. Keywords
  const keywords = seo.keywords || frontmatter.keywords;
  if (keywords) {
    const kwStr = Array.isArray(keywords) ? keywords.join(', ') : keywords;
    html += `<meta name="keywords" content="${attrEsc(kwStr)}">\n`;
  }

  // 7. Structured Data (JSON-LD)
  if (!isOffline && siteUrl) {
    const isRoot = pathname === '/' || pathname === '/index.html' || pathname === '' || frontmatter.isHome === true;

    // 7.1 Organization Schema
    const orgConfig = seo.organization || frontmatter.organization || (isRoot ? (globalSeo.organization || config.organization) : null);
    if (orgConfig && typeof orgConfig === 'object') {
      const orgSchema: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': orgConfig['@type'] || 'Organization',
        'name': orgConfig.name || siteTitle || 'Organization',
        'url': orgConfig.url || `${siteUrl}/`
      };
      const rawLogo = orgConfig.logo || (config.logo && typeof config.logo === 'object' ? (config.logo.light || config.logo.dark) : config.logo);
      if (rawLogo && typeof rawLogo === 'string') {
        orgSchema.logo = rawLogo.startsWith('http')
          ? rawLogo
          : `${siteUrl}/${rawLogo.replace(/^\.?\//, '')}`;
      }
      if (Array.isArray(orgConfig.sameAs) && orgConfig.sameAs.length > 0) {
        orgSchema.sameAs = orgConfig.sameAs;
      }
      html += `<script type="application/ld+json">\n${jsonInject(orgSchema)}\n</script>\n`;
    }

    // 7.2 WebSite Schema with SearchAction (Homepage only)
    const webSiteConfig = seo.webSite ?? globalSeo.webSite;
    if (isRoot && webSiteConfig !== false) {
      const searchActionEnabled = (seo.searchAction ?? globalSeo.searchAction) !== false && config.search !== false;
      let searchTarget = globalSeo.searchUrl || `${siteUrl}/?q={search_term_string}`;
      if (!searchTarget.includes('{search_term_string}')) {
        searchTarget = searchTarget.includes('?')
          ? `${searchTarget}&q={search_term_string}`
          : `${searchTarget}?q={search_term_string}`;
      }
      const webSiteSchema: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        'name': (typeof webSiteConfig === 'object' && webSiteConfig.name) || siteTitle || 'Documentation',
        'url': `${siteUrl}/`
      };
      if (searchActionEnabled) {
        webSiteSchema.potentialAction = {
          '@type': 'SearchAction',
          'target': searchTarget,
          'query-input': 'required name=search_term_string'
        };
      }
      html += `<script type="application/ld+json">\n${jsonInject(webSiteSchema)}\n</script>\n`;
    }

    // 7.3 Breadcrumbs Schema (schema.org/BreadcrumbList)
    // Active for all non-root pages unless explicitly disabled
    const breadcrumbsEnabled = (seo.breadcrumbs ?? globalSeo.breadcrumbs ?? frontmatter.breadcrumbs) !== false;
    if (!isRoot && breadcrumbsEnabled) {
      const homeName = stripHtmlToText(siteTitle || 'Home') || 'Home';
      const itemList: any[] = [
        {
          '@type': 'ListItem',
          'position': 1,
          'name': homeName,
          'item': siteUrl ? `${siteUrl}/` : '/'
        }
      ];

      if (Array.isArray(pageData.breadcrumbs) && pageData.breadcrumbs.length > 0) {
        pageData.breadcrumbs.forEach((bc: any, idx: number) => {
          const isLast = idx === pageData.breadcrumbs.length - 1;
          let itemUrl: string | undefined;

          if (isLast && pageUrl) {
            itemUrl = pageUrl;
          } else if (bc.path) {
            let cleanPath = bc.path.replace(/^\.?\//, '');
            // Append trailing slash for directory/slug paths to match canonical URLs and avoid 301 redirects
            if (!cleanPath.endsWith('/') && !/\.[a-z0-9]+$/i.test(cleanPath)) {
              cleanPath += '/';
            }
            itemUrl = siteUrl ? sanitizeUrl(`${siteUrl}/${cleanPath}`) : `/${cleanPath}`;
          }

          // In Schema.org & Google Search Console, every ListItem in a BreadcrumbList
          // MUST have an 'item' URL. Omitting 'item' on unlinked intermediate categories
          // causes "Missing field 'item' (in 'itemListElement')" validation errors.
          if (itemUrl) {
            const cleanTitle = stripHtmlToText(bc.title || 'Page');
            itemList.push({
              '@type': 'ListItem',
              'position': itemList.length + 1,
              'name': cleanTitle || 'Page',
              'item': itemUrl
            });
          }
        });
      } else {
        // Fallback: derive breadcrumb hierarchy from path segments
        const segments = pathname.replace(/^\/|\/index\.html$|\.html$/g, '').split('/').filter(Boolean);
        let accumulated = siteUrl;
        segments.forEach((seg, idx) => {
          accumulated += `/${seg}`;
          const isLast = idx === segments.length - 1;
          const segName = isLast ? pageTitle : seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          const segUrl = isLast && pageUrl ? pageUrl : (accumulated.endsWith('/') ? accumulated : `${accumulated}/`);
          itemList.push({
            '@type': 'ListItem',
            'position': itemList.length + 1,
            'name': segName,
            'item': segUrl
          });
        });
      }

      if (itemList.length >= 2) {
        const breadcrumbsSchema = {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          'itemListElement': itemList
        };
        html += `<script type="application/ld+json">\n${jsonInject(breadcrumbsSchema)}\n</script>\n`;
      }
    }
  }

  // 7.4 Custom frontmatter ldJson support (direct object or array)
  const customLdJson = seo.ldJson || frontmatter.ldJson;
  if (customLdJson) {
    const items = Array.isArray(customLdJson) ? customLdJson : [customLdJson];
    for (const item of items) {
      if (item && typeof item === 'object') {
        const schemaObj = {
          '@context': 'https://schema.org',
          ...item
        };
        html += `<script type="application/ld+json">\n${jsonInject(schemaObj)}\n</script>\n`;
      }
    }
  }

  return html;
}

/**
 * Post-build hook to auto-generate robots.txt if missing.
 * This ensures SEO best practices without overwriting existing customizations.
 * 
 * @param {Object} context
 * @param {Object} context.config - The parsed project config
 * @param {string} context.outputDir - Absolute path to output directory
 * @param {Function} context.log - Logger function
 */
export async function onPostBuild({ config, outputDir, log }: any) {
  const robotsPath = path.join(outputDir, 'robots.txt');
  const seoConfig = config.plugins?.seo || {};

  // Check all possible locations for existing robots.txt
  // Priority: site root > assets folder > src folder > project root
  const srcDir = config.src || 'docs';
  const possibleLocations = [
    path.join(outputDir, 'robots.txt'),              // site/robots.txt (already in output)
    path.join(outputDir, 'assets', 'robots.txt'),     // site/assets/robots.txt (copied from assets)
    path.join(process.cwd(), srcDir, 'robots.txt'),   // docs/robots.txt (in source)
    path.join(process.cwd(), 'robots.txt'),           // ./robots.txt (in project root)
  ];
  
  // Find existing robots.txt
  let existingRobotsPath: string | null = null;
  for (const loc of possibleLocations) {
    if (nativeFs.existsSync(loc)) {
      existingRobotsPath = loc;
      break;
    }
  }
  
  // If found, copy to site root if not already there
  if (existingRobotsPath) {
    if (existingRobotsPath !== robotsPath) {
      // Copy to site root (recommended location)
      await fs.copyFile(existingRobotsPath, robotsPath);
      if (log) log(`Copied custom robots.txt from ${path.relative(process.cwd(), existingRobotsPath)} to site root`);
    } else {
      if (log) log('robots.txt already exists in site root, preserving');
    }
    return;
  }

  // No robots.txt found anywhere - generate one
  const rawSiteUrl = config.url || config.siteUrl;
  const siteUrl = rawSiteUrl ? rawSiteUrl.replace(/\/$/, '') : '';
  const sitemapUrl = siteUrl ? `${siteUrl}/sitemap.xml` : '';
  
  let robotsContent = 'User-agent: *\nAllow: /\n';
  
  // Add sitemap reference if site URL is configured
  if (sitemapUrl) {
    robotsContent += `\n# Sitemap\nSitemap: ${sitemapUrl}\n`;
  }
  
  // Add AI bot restrictions if configured (default: true = allow, false = block)
  if (seoConfig.aiBots === false) {
    robotsContent += '\n# Block AI training bots\n';
    const aiBots = ['GPTBot', 'ChatGPT-User', 'Google-Extended', 'CCBot', 'anthropic-ai', 'Omgilibot', 'Omgili', 'FacebookBot', 'Diffbot', 'Bytespider', 'ImagesiftBot', 'cohere-ai'];
    aiBots.forEach(bot => {
      robotsContent += `User-agent: ${bot}\nDisallow: /\n`;
    });
  }
  
  await fs.writeFile(robotsPath, robotsContent);
  if (log) log('Generated robots.txt');

  // Auto-generate .nojekyll at the site root.
  const nojekyllPath = path.join(outputDir, '.nojekyll');
  if (!nativeFs.existsSync(nojekyllPath)) {
    await fs.writeFile(nojekyllPath, '');
    if (log) log('Generated .nojekyll (disables Jekyll on GitHub Pages)');
  }
}

/**
 * Diagnostic health checks for `docmd doctor`.
 */
export function onDoctorCheck(ctx: DoctorContext): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];
  const siteUrl = ctx.config?.url || ctx.config?.siteUrl;
  if (!siteUrl) {
    results.push({
      name: 'SEO Site URL',
      status: 'warn',
      message: 'No "url" configured in docmd.config. Absolute canonical URLs and OpenGraph tags will be omitted.',
      hint: 'Add `"url": "https://example.com/docs"` to your docmd.config.json'
    });
  } else {
    results.push({
      name: 'SEO Site URL',
      status: 'ok',
      message: `Canonical site URL configured (${siteUrl})`
    });
  }

  const title = ctx.config?.title || ctx.config?.siteTitle;
  if (!title) {
    results.push({
      name: 'Site Title',
      status: 'warn',
      message: 'No "title" declared in docmd.config. Pages will use filename fallbacks for HTML titles.',
      hint: 'Add `"title": "My Documentation"` to your docmd.config.json'
    });
  } else {
    results.push({
      name: 'Site Title',
      status: 'ok',
      message: `Site title configured: "${title}"`
    });
  }

  return results;
}