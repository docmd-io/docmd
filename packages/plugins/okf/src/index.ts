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
 *
 * `@docmd/plugin-okf` — Open Knowledge Format bundle generator.
 *
 * Plugin entry point. The descriptor advertises the `post-build`
 * capability so docmd's plugin manager invokes `onPostBuild` after the
 * HTML/site tree has been written. That hook then:
 *
 *   1. Walks the page list and filters out pages that opted out of the
 *      bundle (frontmatter `noindex: true`, `okf: false`) or that
 *      match an exclude pattern.
 *   2. Resolves each page's OKF `type` (frontmatter > path > default).
 *   3. Writes one concept file per page under `<output>/okf/concepts/`.
 *   4. Generates the OKF manifest (`okf.yaml`), the human-readable
 *      catalog (`index.md`), and a lint report listing orphans / broken
 *      internal links.
 *   5. If the user opts in to the graph viewer (`plugins.okf.graph`),
 *      writes the self-contained viewer (CSS + JS + `index.html`).
 *
 * Heavy lifting is split across:
 *   - `content.ts`     — type resolver, slug, link extractor
 *   - `yaml.ts`        — manifest serialiser + concept frontmatter
 *   - `graph-assets.ts` — CSS / JS / HTML shell for the graph viewer
 */

import path from 'path';
import fs from 'fs/promises';
import type { PluginDescriptor } from '@docmd/api';
import { outputPathToPathname, sanitizeUrl, TUI } from '@docmd/api';

import { slugify, resolveType, matchesPattern, extractInternalLinks } from './content.js';
import { toYaml, serializeConceptFrontmatter } from './yaml.js';
import { GRAPH_CSS, GRAPH_JS, graphHtml } from './graph-assets.js';

export const plugin: PluginDescriptor = {
  name: 'okf',
  version: '0.9.5',
  capabilities: ['post-build']
};

// ---- onPostBuild ----------------------------------------------------------

export async function onPostBuild({ config, pages, outputDir, log }: any) {
  const _opts = config.plugins?.okf;

  // Opt-out paths. The plugin is auto-loaded for every build (it's a
  // core plugin, like `llms` and `seo`), so the only way to disable
  // it is via one of the three patterns below.
  if (_opts === false) return;                          // `"okf": false`
  if (_opts && _opts.enabled === false) return;         // `"okf": { "enabled": false }`
  if (Array.isArray(_opts?.capabilities)
      && !_opts.capabilities.includes('post-build')) return; // capability filter

  const opts = _opts && typeof _opts === 'object' ? _opts : {};

  const outputRel = opts.outputDir || 'okf';
  const bundleName = opts.bundleName ? slugify(opts.bundleName) : slugify(config.title || 'knowledge-bundle');
  const defaultType = opts.defaultType || 'concept';
  const typeField = opts.typeField || 'type';
  const warnOnMissingType = opts.warnOnMissingType !== false;
  const includeFullMarkdown = opts.includeFullMarkdown !== false;

  // Graph viewer is opt-in (0.8.8+). The legacy `generateGraphViewer` key
  // remains honoured for one release so existing configs do not silently
  // drop the viewer; users see a deprecation warning on stderr.
  const graphEnabled =
    opts.graph === true ||
    (opts.graph === undefined && opts.generateGraphViewer === true);
  if (opts.graph === undefined && opts.generateGraphViewer !== undefined) {
    TUI.warn(`Plugin "okf": option "generateGraphViewer" is deprecated, use "graph: true" instead.`);
  }

  const localeStrategy = opts.localeStrategy || 'default-only';
  const versionStrategy = opts.versionStrategy || 'latest-only';
  const excludePatterns: string[] = Array.isArray(opts.excludePatterns) ? opts.excludePatterns : [];

  const siteUrl = (config.url || '').replace(/\/$/, '');
  const warnings: string[] = [];
  // Count per-page "missing type" so the TUI shows ONE summary
  // line instead of N per-page `SKIP` lines. The lint-report.txt still
  // lists every page so detail isn't lost.
  let missingTypeCount = 0;

  if (!config.url) {
    const msg = `OKF: config.url is missing — generated \`source:\` fields will be relative paths only`;
    warnings.push(`[WARN] missing-site-url  (source: fields will be relative)`);
    if (log) log(msg, 'SKIP');
  }

  const localeIds: string[] = (config.i18n?.locales || []).map((l: any) => l.id);
  const versionIds: string[] = (config.versions?.all || []).map((v: any) => v.id);
  const defaultLocale = config.i18n?.default || localeIds[0] || '';
  const currentVersion = config.versions?.current || versionIds[0] || '';

  const bundleRoot = path.join(outputDir, outputRel);
  await fs.mkdir(path.join(bundleRoot, 'concepts'), { recursive: true });
  await fs.mkdir(path.join(bundleRoot, '_meta'), { recursive: true });

  const filtered = pages.filter((p: any) => {
    const fm = p.frontmatter || {};
    if (fm.noindex || fm.okf === false) return false;
    const pathname = outputPathToPathname(p.outputPath);
    if (matchesPattern(pathname, excludePatterns)) return false;
    if (matchesPattern(p.outputPath || '', excludePatterns)) return false;

    if (localeStrategy === 'default-only' && defaultLocale) {
      const parts = String(p.outputPath || '').split('/').filter(Boolean);
      const pageLoc = (localeIds.length && parts.length && localeIds.includes(parts[0])) ? parts[0] : defaultLocale;
      if (pageLoc !== defaultLocale) return false;
    }
    return true;
  });

  const slugMap = new Map<string, any>();
  for (const p of filtered) {
    const pathname = outputPathToPathname(p.outputPath);
    slugMap.set(slugify(pathname.replace(/^\//, '').replace(/\/$/, '') || 'root'), p);
  }
  const known = new Set(slugMap.keys());

  const pageLocale = (p: any) => {
    const parts = String(p.outputPath || '').split('/').filter(Boolean);
    return (localeIds.length && parts.length && localeIds.includes(parts[0])) ? parts[0] : defaultLocale;
  };
  const pageVersion = (p: any) => {
    const fm = p.frontmatter || {};
    if (fm.version) return String(fm.version);
    const parts = String(p.outputPath || '').split('/').filter(Boolean);
    return (versionIds.length && parts.length && versionIds.includes(parts[0])) ? parts[0] : currentVersion;
  };

  const concepts: any[] = [];
  const nodeList: any[] = [];
  const linkList: Array<{ source: string; target: string }> = [];
  const linkSet = new Set<string>();
  const inbound = new Map<string, number>();

  for (const p of filtered) {
    const fm = p.frontmatter || {};
    const pathname = outputPathToPathname(p.outputPath);
    const { type, fallback } = resolveType(fm, pathname, defaultType, typeField);

    if (fallback && warnOnMissingType) {
      warnings.push(`[WARN] missing-type ${pathname}  (using fallback '${defaultType}')`);
      missingTypeCount++;
    }

    const locale = pageLocale(p);
    const version = pageVersion(p);
    const subParts: string[] = [];
    // 0.8.8: nest non-default locales under `<locale>/` so the default
    // locale's files stay at the bundle root (no breaking change for
    // existing consumers). Only the `folders` strategy is affected;
    // `default-only` (the new default) writes everything at the root.
    if (localeStrategy === 'folders' && locale && locale !== defaultLocale && localeIds.length > 1) subParts.push(locale);
    if (versionStrategy === 'folders' && version && versionIds.length > 1) subParts.push(version);
    const subRel = subParts.join('/');

    const slug = slugify(pathname.replace(/^\//, '').replace(/\/$/, '') || 'root');
    const fileRel = subRel ? path.posix.join(subRel, 'concepts', slug + '.md') : path.posix.join('concepts', slug + '.md');
    const fileAbs = path.join(bundleRoot, fileRel);
    await fs.mkdir(path.dirname(fileAbs), { recursive: true });

    const fullUrl = sanitizeUrl(siteUrl + pathname);
    const updated = fm.lastmod || new Date().toISOString().slice(0, 10);

    const conceptFm: Record<string, any> = { [typeField]: type };
    if (fm.title) conceptFm.title = fm.title;
    if (fm.description) conceptFm.description = fm.description;
    conceptFm.source = fullUrl;
    conceptFm.path = pathname;
    if (locale) conceptFm.locale = locale;
    if (version) conceptFm.version = version;
    if (Array.isArray(fm.tags) && fm.tags.length) conceptFm.tags = fm.tags;
    conceptFm.updated = updated;
    conceptFm.okf = { generated_by: '@docmd/plugin-okf', generated_at: new Date().toISOString() };

    let body = '';
    if (includeFullMarkdown) {
      if (p.sourcePath) { try { body = await fs.readFile(p.sourcePath, 'utf8'); } catch { body = ''; } }
    }
    if (!body && typeof p.rawMarkdown === 'string') body = p.rawMarkdown;

    const fmYaml = serializeConceptFrontmatter(conceptFm);
    const fileContent = `---\n${fmYaml}\n---\n` + body + (body && !body.endsWith('\n') ? '\n' : '');
    await fs.writeFile(fileAbs, fileContent);

    concepts.push({
      id: slug, type, title: fm.title || 'Untitled', path: pathname, file: fileRel,
      locale, version, tags: Array.isArray(fm.tags) ? fm.tags : [], source: fullUrl
    });
    nodeList.push({ id: slug, title: fm.title || 'Untitled', type, path: pathname, source: fullUrl, description: fm.description || '' });

    if (body) {
      for (const t of extractInternalLinks(body, slug, known)) {
        const key = slug + '->' + t;
        if (linkSet.has(key)) continue;
        linkSet.add(key);
        linkList.push({ source: slug, target: t });
        inbound.set(t, (inbound.get(t) || 0) + 1);
      }
    }
  }

  const allSlugs = new Set(concepts.map(c => c.id));
  for (const c of concepts) if (!inbound.has(c.id)) warnings.push(`[WARN] orphan-concept ${c.id}  (no inbound links)`);
  for (const l of linkList) if (!allSlugs.has(l.target)) warnings.push(`[WARN] broken-link ${l.source} -> ${l.target}`);

  const byType: Record<string, number> = {};
  for (const c of concepts) byType[c.type] = (byType[c.type] || 0) + 1;

  const manifest = {
    okf_version: '0.9.5',
    bundle: {
      name: bundleName, title: config.title || bundleName, description: config.description || '',
      url: config.url || '', generated_by: '@docmd/plugin-okf', generated_at: new Date().toISOString(),
      default_type: defaultType
    },
    stats: { concepts: concepts.length, by_type: byType, locales: localeIds, versions: versionIds },
    concepts: concepts.map(c => ({ id: c.id, type: c.type, title: c.title, path: c.path, file: c.file, locale: c.locale, version: c.version, tags: c.tags }))
  };

  await fs.writeFile(path.join(bundleRoot, 'okf.yaml'), toYaml(manifest));
  await fs.writeFile(path.join(bundleRoot, '_meta', 'bundle.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(bundleRoot, '_meta', 'lint-report.txt'), warnings.length === 0 ? 'OK — 0 issues\n' : warnings.join('\n') + '\n');

  // index.md (Karpathy-style catalog)
  const idxLines: string[] = [`# ${manifest.bundle.title} — Knowledge Catalog`, '', `> Generated by ${manifest.bundle.generated_by} on ${manifest.bundle.generated_at}`, ''];
  if (manifest.bundle.description) idxLines.push(manifest.bundle.description, '');
  const catalogLinks: string[] = ['- [Manifest](okf.yaml)', '- [Bundle summary (JSON)](_meta/bundle.json)', '- [Lint report](_meta/lint-report.txt)'];
  if (graphEnabled) catalogLinks.splice(2, 0, '- [Graph viewer](graph/)');
  idxLines.push(`**${manifest.stats.concepts} concepts** across **${Object.keys(manifest.stats.by_type).length} types**.`, '', ...catalogLinks, '');
  const groups = new Map<string, any[]>();
  for (const c of concepts) { if (!groups.has(c.type)) groups.set(c.type, []); groups.get(c.type)!.push(c); }
  for (const type of Array.from(groups.keys()).sort()) {
    const items = groups.get(type)!.sort((a, b) => a.title.localeCompare(b.title));
    idxLines.push(`## ${type}`, '');
    for (const c of items) {
      const tag = c.tags && c.tags.length ? ` _(${c.tags.join(', ')})_` : '';
      idxLines.push(`- [${c.title}](${c.file})${tag}`);
    }
    idxLines.push('');
  }
  const untyped = concepts.filter(c => c.type === defaultType);
  if (untyped.length && Object.keys(byType).length > 1) {
    idxLines.push(`## Untyped (using fallback \`${defaultType}\`)`, '',
      'These pages did not declare an explicit OKF type. Consider adding `type:` to their frontmatter:', '');
    for (const c of untyped) idxLines.push(`- [${c.title}](${c.file})`);
    idxLines.push('');
  }
  await fs.writeFile(path.join(bundleRoot, 'index.md'), idxLines.join('\n'));

  if (graphEnabled) {
    const graphDir = path.join(bundleRoot, 'graph');
    await fs.mkdir(graphDir, { recursive: true });
    await fs.writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: nodeList, links: linkList }, null, 2));
    await fs.writeFile(path.join(graphDir, 'graph.css'), GRAPH_CSS);
    await fs.writeFile(path.join(graphDir, 'graph.js'), GRAPH_JS());
    // index.html (not graph.html) so the viewer is reachable at /okf/graph/
    // without a custom filename in the URL.
    await fs.writeFile(path.join(graphDir, 'index.html'), graphHtml(bundleName, concepts.length));
  }

  if (log) log(`OKF bundle generated at /${outputRel}/ (${concepts.length} concepts)`);
}