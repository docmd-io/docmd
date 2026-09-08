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
import type { PluginDescriptor } from '@docmd/api';
import { outputPathToPathname, sanitizeUrl } from '@docmd/api';

export const plugin: PluginDescriptor = {
  name: 'sitemap',
  version: '0.9.5',
  capabilities: ['post-build']
};

/**
 * Hook to run after the build is complete.
 * @param {Object} context
 * @param {Object} context.config - The parsed project config
 * @param {Array} context.pages - Array of page objects { outputPath, frontmatter }
 * @param {string} context.outputDir - Absolute path to output directory
 * @param {Function} context.log - Logger function
 */

export async function onPostBuild({ config, pages, outputDir, log }: any) {
  // 1. Check if enabled
  if (config.plugins?.sitemap === false || !config.url) {
    if (!config.url && log) log('Skipping sitemap: "url" is missing in config', 'SKIP');
    return;
  }

  const siteUrl = config.url.replace(/\/$/, '');

  // 2. Build XML Header
  let sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemapXml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // 3. Defaults
  const defaultChangefreq = config.plugins?.sitemap?.defaultChangefreq || 'weekly';
  const defaultPriority = config.plugins?.sitemap?.defaultPriority || 0.8;
  const rootPriority = config.plugins?.sitemap?.rootPriority || 1.0;

  // 4. Loop Pages
  for (const page of pages) {
    const fm = page.frontmatter || {};

    // Skip hidden pages
    if (fm.sitemap === false || fm.noindex === true) continue;

    // Use centralised URL utility for consistent URL generation.
    // This is the single source of truth - no manual outputPath parsing.
    const pathname = outputPathToPathname(page.outputPath);
    const url = sanitizeUrl(siteUrl + pathname);

    // Metadata Logic
    const isRoot = pathname === '/';
    const priority = fm.priority || (isRoot ? rootPriority : defaultPriority);
    const changefreq = fm.changefreq || defaultChangefreq;

    sitemapXml += '  <url>\n';
    sitemapXml += `    <loc>${url}</loc>\n`;
    if (fm.lastmod) sitemapXml += `    <lastmod>${fm.lastmod}</lastmod>\n`;
    sitemapXml += `    <changefreq>${changefreq}</changefreq>\n`;
    sitemapXml += `    <priority>${priority}</priority>\n`;
    sitemapXml += '  </url>\n';
  }

  sitemapXml += '</urlset>';

  // 5. Write File
  await fs.writeFile(path.join(outputDir, 'sitemap.xml'), sitemapXml);
  if (log) log('Sitemap generated');
}