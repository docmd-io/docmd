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
import type { PluginDescriptor } from '@docmd/api';
import { outputPathToPathname, sanitizeUrl } from '@docmd/api';
import { attrEsc } from '@docmd/utils';

export const plugin: PluginDescriptor = {
  name: 'seo',
  version: '0.9.5',
  capabilities: ['head', 'post-build']
};

/**
 * Generates HTML meta tags for a specific page.
 * @param {Object} config - Project config
 * @param {Object} pageData - { frontmatter, outputPath }
 * @param {string} relativePathToRoot - Path relative to root (for assets)
 * @returns {string} HTML string of meta tags
 */

export function generateMetaTags(config: any, pageData: any, _relativePathToRoot: string) {
  let html = '';
  const { frontmatter, outputPath } = pageData;
  const seo = frontmatter.seo || {}; // Page-specific SEO overrides
  const globalSeo = config.plugins?.seo || {};

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
  const siteTitle = config.title;
  const pageTitle = frontmatter.title || 'Untitled';
  let description = seo.description || frontmatter.description || globalSeo.defaultDescription || '';

  // Smart Fallback Description
  if (!description && pageData.searchData && pageData.searchData.content) {
    const contentPrefix = pageData.searchData.content.substring(0, 150).trim();
    description = pageData.searchData.content.length > 150 ? contentPrefix + '...' : contentPrefix;
  }

  // Phase 1.B (T-S3 fix): all content="..." values are user-controllable
  // (frontmatter.title, frontmatter.description, config.url, config.title, etc.).
  // Apply attrEsc() to prevent stored XSS in social-media previews.
  html += `<meta name="description" content="${attrEsc(description)}">\n`;

  // 3. Canonical URL
  // Use centralised URL utility for consistent URL generation.
  const siteUrl = config.url ? config.url.replace(/\/$/, '') : '';
  const pathname = outputPathToPathname(outputPath);
  const pageUrl = siteUrl ? sanitizeUrl(siteUrl + pathname) : '';

  const isOffline = !!pageData.urlContext?.offline;

  const canonical = seo.canonicalUrl || frontmatter.canonicalUrl || pageUrl;
  if (canonical && (!isOffline || canonical.startsWith('http'))) {
    html += `<link rel="canonical" href="${attrEsc(canonical)}">\n`;
  }

  // 4. Open Graph (Facebook/LinkedIn)
  const appendTitle = frontmatter.titleAppend !== false;
  const fullTitle = (appendTitle && siteTitle && pageTitle !== siteTitle) ? `${pageTitle} - ${siteTitle}` : pageTitle;

  html += `<meta property="og:title" content="${attrEsc(fullTitle)}">\n`;
  html += `<meta property="og:description" content="${attrEsc(description)}">\n`;
  if (pageUrl && (!isOffline || pageUrl.startsWith('http'))) {
    html += `<meta property="og:url" content="${attrEsc(pageUrl)}">\n`;
  }
  html += `<meta property="og:type" content="${attrEsc(seo.ogType || frontmatter.ogType || 'website')}">\n`;

  // Image Logic
  let image = seo.image || frontmatter.image || globalSeo.openGraph?.defaultImage;
  if (image) {
    if (!image.startsWith('http')) {
      // Resolve relative image path to absolute URL
      image = siteUrl ? `${siteUrl}/${image.replace(/^\.?\//, '')}` : '';
    }
    if (image && (!isOffline || image.startsWith('http'))) {
      html += `<meta property="og:image" content="${attrEsc(image)}">\n`;
    }
  }

  // 5. Twitter
  const cardType = seo.twitterCard || globalSeo.twitter?.cardType || 'summary_large_image';
  html += `<meta name="twitter:card" content="${attrEsc(cardType)}">\n`;

  if (globalSeo.twitter?.siteUsername) {
    html += `<meta name="twitter:site" content="${attrEsc(globalSeo.twitter.siteUsername)}">\n`;
  }

  html += `<meta name="twitter:title" content="${attrEsc(fullTitle)}">\n`;
  html += `<meta name="twitter:description" content="${attrEsc(description)}">\n`;
  if (image && (!isOffline || image.startsWith('http'))) {
    html += `<meta name="twitter:image" content="${attrEsc(image)}">\n`;
  }

  // 6. Keywords
  const keywords = seo.keywords || frontmatter.keywords;
  if (keywords) {
    const kwStr = Array.isArray(keywords) ? keywords.join(', ') : keywords;
    html += `<meta name="keywords" content="${attrEsc(kwStr)}">\n`;
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
  // Priority: site root > assets folder
  const possibleLocations = [
    path.join(outputDir, 'robots.txt'),              // site/robots.txt (already in output)
    path.join(outputDir, 'assets', 'robots.txt'),     // site/assets/robots.txt (copied from assets)
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
      // Copy from assets to site root (recommended location)
      await fs.copyFile(existingRobotsPath, robotsPath);
      if (log) log('Copied robots.txt from assets to site root');
    } else {
      if (log) log('robots.txt already exists in site root, preserving');
    }
    return;
  }

  // No robots.txt found anywhere - generate one
  const siteUrl = config.url ? config.url.replace(/\/$/, '') : '';
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
  // GitHub Pages runs Jekyll by default, which silently drops every file or
  // directory whose name starts with a dot — including _docmd-search/ (the
  // semantic index) and docmd-search-client.js (the browser bundle).
  // An empty .nojekyll file disables Jekyll so those assets are served as-is.
  // This is a zero-config fix: users deploying to GitHub Pages never need to
  // think about it.
  const nojekyllPath = path.join(outputDir, '.nojekyll');
  if (!nativeFs.existsSync(nojekyllPath)) {
    await fs.writeFile(nojekyllPath, '');
    if (log) log('Generated .nojekyll (disables Jekyll on GitHub Pages)');
  }
}