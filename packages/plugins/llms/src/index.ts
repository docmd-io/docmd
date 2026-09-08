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
  name: 'llms',
  version: '0.9.5',
  capabilities: ['post-build']
};

export async function onPostBuild({ config, pages, outputDir, log }: any) {
  const siteUrl = (config.url || '').replace(/\/$/, '');
  const _options = config.plugins?.llms || {};

  // 0.8.8: opt-in multi-locale mode.
  //   - Default (`i18n: false`): write `llms.txt` / `llms-full.txt` /
  //     `llms.json` for the DEFAULT locale only. File names are
  //     unchanged from prior versions — this is the break-free
  //     default.
  //   - Opt-in (`plugins.llms.i18n: true`): also write a
  //     `llms.<locale>.txt` / `llms-full.<locale>.txt` /
  //     `llms.<locale>.json` for every non-default locale in
  //     `config.i18n.locales`. The default-locale files keep the
  //     unsuffixed names so existing consumers don't break.
  //   - Single-locale projects (no `config.i18n` block, or only
  //     one locale) emit a single unsuffixed set regardless of
  //     the i18n flag.
  const i18n = _options.i18n === true;
  const localeIds: string[] = (config.i18n?.locales || []).map((l: any) => l.id);
  const defaultLocale = config.i18n?.default || localeIds[0] || '';

  if (log) log('Generating LLMs context files' + (i18n && localeIds.length > 1 ? ' (multi-locale)' : ''));

  // Make sure outputDir exists — guards the case where the plugin
  // is invoked directly from a test (the docmd build pipeline
  // already creates the dir, but direct callers may not).
  await fs.mkdir(outputDir, { recursive: true });

  /**
   * Group pages by their detected locale. Pages without a locale
   * prefix in `outputPath` are bucketed under the default locale.
   * The `noindex` and `llms: false` opt-outs are honoured here.
   */
  function pageLocale(p: any): string {
    const parts = String(p.outputPath || '').split('/').filter(Boolean);
    if (localeIds.length && parts.length && localeIds.includes(parts[0])) return parts[0];
    return defaultLocale;
  }
  const grouped: Map<string, any[]> = new Map();
  for (const p of pages) {
    if (p.frontmatter.noindex) continue;
    if (p.frontmatter.llms === false) continue;
    const loc = pageLocale(p);
    if (!grouped.has(loc)) grouped.set(loc, []);
    grouped.get(loc)!.push(p);
  }
  // Sort each bucket by URL for stable output.
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.outputPath.localeCompare(b.outputPath));
  }

  // Determine which locales to write. Default: only the default
  // locale. i18n: all configured locales (or just the default
  // if no i18n block is configured).
  const localesToWrite: string[] = [];
  if (i18n && localeIds.length > 1) {
    localesToWrite.push(...localeIds);
  } else {
    localesToWrite.push(defaultLocale);
  }

  for (const loc of localesToWrite) {
    const bucket = grouped.get(loc) || [];

    // T-Z10 / T-Z11: sanitise any user-controlled string before it lands
    // in the markdown list / CSV cell. Two threats:
    //   - Markdown injection: a title containing `]`, `[`, `\n`, or
    //     backticks breaks out of the `[title](url)` form, or renders
    //     as raw HTML in some markdown processors.
    //   - CSV formula injection: a title starting with `=`, `+`, `-`,
    //     or `@` is interpreted as a formula when the file is opened
    //     in a spreadsheet (T-Z11).
    // The escape below:
    //   - Prefixes a single-quote when the string starts with a
    //     spreadsheet-formula sigil (neutralises CSV formula execution
    //     in Excel / LibreOffice / Sheets).
    //   - Escapes backslashes, backticks, and square brackets so the
    //     string cannot break out of `[title](url)` or render as code.
    //   - Replaces newlines and carriage returns with spaces so a multi-
    //     line title doesn't break the markdown list.
    //   - Truncates the result to a sane length.
    const safeForMarkdownAndCsv = (raw: string): string => {
      if (typeof raw !== 'string') return '';
      let s = raw.replace(/[\r\n]+/g, ' ').slice(0, 200);
      s = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
      s = s.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      if (/^\s*[=+\-@]/.test(s)) s = `'${s}`;
      return s;
    };

    // ── llms.txt — title + description + link list ─────────────
    let content = `# ${safeForMarkdownAndCsv(config.title || 'Documentation')}\n\n`;
    content += `> Generated by docmd\n\n`;
    if (config.description) content += `${safeForMarkdownAndCsv(config.description)}\n\n`;
    content += `## Documentation Files\n\n`;
    for (const page of bucket) {
      const pathname = outputPathToPathname(page.outputPath);
      const fullUrl = sanitizeUrl(siteUrl + pathname);
      const title = safeForMarkdownAndCsv(page.frontmatter.title || 'Untitled');
      content += `- [${title}](${fullUrl})\n`;
      if (page.frontmatter.description) {
        content += `  ${safeForMarkdownAndCsv(page.frontmatter.description)}\n`;
      }
    }

    // ── llms-full.txt — full markdown for each page ─────────────
    let fullContent = `# ${safeForMarkdownAndCsv(config.title || 'Documentation')} - Full Context\n\n`;
    fullContent += `> Generated by docmd\n\n`;
    if (config.description) fullContent += `${safeForMarkdownAndCsv(config.description)}\n\n`;
    fullContent += `---\n\n`;
    for (const page of bucket) {
      const pathname = outputPathToPathname(page.outputPath);
      const fullUrl = sanitizeUrl(siteUrl + pathname);
      const title = safeForMarkdownAndCsv(page.frontmatter.title || 'Untitled');
      fullContent += `## [${title}](${fullUrl})\n\n`;
      try {
        if (page.sourcePath) {
          // T-Z10: the body of a user markdown file is treated as
          // trusted source content (the user wrote it themselves), so
          // we don't escape it. Consumers should treat llms-full.txt as
          // a "first-party" channel and not render it in an HTML
          // context without sanitising the body on the consumer side.
          const rawMd = await fs.readFile(page.sourcePath, 'utf8');
          fullContent += `${rawMd}\n\n---\n\n`;
        } else {
          fullContent += `*(Raw content unavailable)*\n\n---\n\n`;
        }
      } catch {
        if (log) log(`Skipping raw markdown: ${page.sourcePath}`, 'SKIP');
      }
    }

    // ── llms.json — machine-readable manifest ─────────────────
    // T-Z10/T-Z11: same sanitisation for JSON output. The JSON parser
    // handles strings safely but we still apply the same neutralisation
    // so a title that starts with `=cmd|"/c calc"!A1` doesn't execute
    // when the file is opened in a spreadsheet, and the JSON stays
    // self-consistent.
    const llmsJson = {
      title: safeForMarkdownAndCsv(config.title || 'Documentation'),
      description: safeForMarkdownAndCsv(config.description || ''),
      pages: bucket.map((page) => {
        const pathname = outputPathToPathname(page.outputPath);
        const fullUrl = sanitizeUrl(siteUrl + pathname);
        return {
          title: safeForMarkdownAndCsv(page.frontmatter.title || 'Untitled'),
          url: fullUrl,
          description: safeForMarkdownAndCsv(page.frontmatter.description || ''),
          priority: page.frontmatter.priority || (pathname === '/' ? 'high' : 'medium')
        };
      })
    };

    // File name strategy:
    //   - Default locale (or only locale in a single-locale
    //     project) keeps the unsuffixed names so existing
    //     consumers don't break.
    //   - Non-default locales get a `.${locale}` suffix:
    //     `llms.ja.txt`, `llms-full.ja.txt`, `llms.ja.json`,
    //     `llms.fr.txt`, etc.
    const isDefault = loc === defaultLocale;
    const baseTxt  = isDefault ? 'llms'       : `llms.${loc}`;
    const fullBase = isDefault ? 'llms-full'  : `llms-full.${loc}`;
    const jsonBase = isDefault ? 'llms'       : `llms.${loc}`;

    await fs.writeFile(path.join(outputDir, `${baseTxt}.txt`),  content);
    await fs.writeFile(path.join(outputDir, `${fullBase}.txt`), fullContent);
    await fs.writeFile(
      path.join(outputDir, `${jsonBase}.json`),
      JSON.stringify(llmsJson, null, 2)
    );
  }
}