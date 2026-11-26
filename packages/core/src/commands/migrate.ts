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

import { fsUtils as fs } from '@docmd/utils';
import path from 'path';
import nativeFs from 'fs';
import { TUI } from '@docmd/api';

function serializeConfig(obj: any) {
  const json = JSON.stringify(obj, null, 2);
  const cleanJs = json.replace(/"([^"]+)":/g, '$1:');
  return `export default ${cleanJs};\n`;
}

export async function migrateProject(options: { docusaurus?: boolean; mkdocs?: boolean; vitepress?: boolean; starlight?: boolean; upgrade?: boolean; dryRun?: boolean }) {
  const CWD = process.cwd();
  const dryRun = options.dryRun === true;

  const moveFilesToBackup = async (backupDir: string) => {
    const backupName = path.basename(backupDir);
    const files = await nativeFs.promises.readdir(CWD);
    for (const file of files) {
      // N-10: keep lockfiles and package manifests in place — moving them
      // into the backup dir means `npm install` and `pnpm install`
      // would re-resolve from scratch on a recovery. Lockfiles and
      // package.json are part of the user's repo state, not migration
      // input.
      if (file === 'node_modules' || file === '.git' || file === backupName || file === 'docmd.config.js') continue;
      if (file === 'package.json' || file === 'package-lock.json' || file === 'yarn.lock' || file === 'pnpm-lock.yaml' || file === 'bun.lockb' || file === 'bun.lock') continue;
      const oldPath = path.resolve(CWD, file);
      const newPath = path.resolve(backupDir, file);
      await nativeFs.promises.rename(oldPath, newPath);
    }
  };

  /**
   * Build the list of files that `moveFilesToBackup` would move. Used
   * by `--dry-run` to show the user what would change without writing.
   * Returns filenames (relative to CWD).
   */
  const planBackupMoves = async (backupName: string): Promise<string[]> => {
    const files = await nativeFs.promises.readdir(CWD);
    return files.filter((f) =>
      f !== 'node_modules' &&
      f !== '.git' &&
      f !== backupName &&
      f !== 'docmd.config.js' &&
      f !== 'package.json' &&
      f !== 'package-lock.json' &&
      f !== 'yarn.lock' &&
      f !== 'pnpm-lock.yaml' &&
      f !== 'bun.lockb' &&
      f !== 'bun.lock'
    );
  };

  /**
   * Pretty-print a dry-run plan for a source-migration path and exit 0.
   */
  const printAndExitDryRun = async (sourceName: string, backupName: string, docmdConfig: object): Promise<void> => {
    const moves = await planBackupMoves(backupName);
    TUI.section(`Dry run: ${sourceName} migration`);
    TUI.item('Would move', `${moves.length} file${moves.length === 1 ? '' : 's'} → ${backupName}/`);
    if (moves.length > 0 && moves.length <= 12) {
      for (const f of moves) TUI.item(' ', f);
    } else if (moves.length > 12) {
      for (const f of moves.slice(0, 10)) TUI.item(' ', f);
      TUI.item(' ', `… and ${moves.length - 10} more`);
    }
    TUI.item('Would write', 'docmd.config.js');
    TUI.item('Config', JSON.stringify(docmdConfig));
    TUI.footer();
    TUI.info('No changes made. Re-run without --dry-run to apply.');
  };

  /**
   * N-9: best-effort MkDocs `nav:` parser. MkDocs nav is a YAML
   * nested list; we use a tiny line-by-line YAML-aware scanner
   * (no `yaml` dependency) that handles the common shape:
   *
   *   nav:
   *     - Home: index.md
   *     - Guide:
   *       - Getting Started: start.md
   *       - Reference: ref.md
   *
   * Sections without an explicit file (`- Guide:` with no value) are
   * kept as parents; their children are nested under `children`.
   * Anything fancier (external links, multi-line strings, anchors)
   * is left to the runtime auto-router.
   */
  const parseMkDocsNav = (rawYaml: string): any[] | null => {
    const lines = rawYaml.split('\n');
    const navIdx = lines.findIndex((l) => /^nav\s*:\s*$/.test(l));
    if (navIdx === -1) return null;

    const root: any[] = [];
    const stack: { indent: number; items: any[] }[] = [{ indent: -1, items: root }];
    const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');
    for (let i = navIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      // The next top-level key (`plugins:`, `markdown_extensions:`, ...) ends the nav.
      if (/^[^\s#-]/.test(line)) break;
      // `- Title: file.md` (most common) OR `- Title:` (section header).
      // The colon + value are optional. The title capture is non-greedy
      // so it stops at the colon, and we strip a trailing `:` from the
      // captured title (which happens when the line is `- Title:` with
      // no file).
      const m = line.match(/^(\s*)-\s+(.+?)(?::\s*(.+?))?\s*$/);
      if (!m) continue;
      const indent = m[1].length;
      // Strip a trailing `:` from the title (which happens when the
      // line is `- Title:` with no file value, the section-header
      // shape in MkDocs).
      const title = unquote(m[2].trim().replace(/:\s*$/, ''));
      const file = unquote((m[3] || '').trim());
      // index.md is served at its folder: 'guide/index.md' -> '/guide/', 'index.md' -> '/'.
      // Paths are site-absolute; a relative one breaks on every nested page.
      const item: any = file
        ? { title, path: '/' + file.replace(/(^|\/)index\.(md|markdown)$/i, '$1').replace(/\.(md|markdown)$/i, '/') }
        : { title };
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      const top = stack[stack.length - 1];
      top.items.push(item);
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nm = next.match(/^(\s+)-/);
        if (nm && nm[1].length > indent) {
          item.children = [];
          stack.push({ indent, items: item.children });
        }
      }
    }
    return root.length > 0 ? root : null;
  };

  /**
   * T-Z14 / T-Z17: walk a freshly-copied docs directory and translate
   * Docusaurus-specific frontmatter keys to their docmd equivalents.
   *
   *   `id:`           → removed (docmd derives route ids from filenames)
   *   `sidebar_label:`→ `nav_title:` (the docmd-supported nav override)
   *
   * The translation is best-effort: a file that fails to parse keeps
   * its original content. Returns the count of files touched.
   */
  const translateDocusaurusFrontmatter = async (docsDir: string): Promise<number> => {
    const targets: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await nativeFs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          await walk(full);
        } else if (entry.isFile() && /\.(md|mdx|markdown)$/i.test(entry.name)) {
          targets.push(full);
        }
      }
    };
    await walk(docsDir);

    let count = 0;
    for (const file of targets) {
      const raw = await nativeFs.promises.readFile(file, 'utf8');
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) continue;
      // Line-by-line parse: we only care about top-level `key: value`
      // lines. Docusaurus lets these be unquoted, single-quoted, or
      // double-quoted. Nested objects (e.g. `sidebar:` with sub-keys)
      // are preserved as-is.
      const lines = m[1].split('\n');
      let changed = false;
      const newLines = lines.map((line) => {
        const stripped = line.replace(/\r$/, '');
        const idMatch = stripped.match(/^\s*id\s*:\s*(.*?)\s*$/);
        if (idMatch) { changed = true; return null; }
        const slMatch = stripped.match(/^(\s*)sidebar_label\s*:\s*(.*?)\s*$/);
        if (slMatch) {
          changed = true;
          const indent = slMatch[1];
          let val = slMatch[2];
          // Strip wrapping quotes if present so the rewritten value
          // matches the original document's quote style as closely as
          // possible. docmd accepts both forms.
          const qm = val.match(/^['"](.*)['"]$/);
          if (qm) val = qm[1];
          return `${indent}nav_title: ${val}`;
        }
        return stripped;
      }).filter((l) => l !== null) as string[];

      if (!changed) continue;
      const newFm = newLines.join('\n');
      const newContent = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newFm}\n---`);
      await nativeFs.promises.writeFile(file, newContent);
      count++;
    }
    return count;
  };

  if (options.docusaurus) {
    TUI.section('Docusaurus Migration');
    const configPath = path.resolve(CWD, 'docusaurus.config.js');
    const tsConfigPath = path.resolve(CWD, 'docusaurus.config.ts');

    let activeConfigPath = '';
    if (nativeFs.existsSync(configPath)) activeConfigPath = configPath;
    else if (nativeFs.existsSync(tsConfigPath)) activeConfigPath = tsConfigPath;
    else {
      TUI.error('Missing configuration', 'docusaurus.config.js or docusaurus.config.ts not found.');
      // Phase 3 PR 3.A (F6): exit 1 so CI pipelines can gate on it.
      process.exit(1);
    }

    const backupDir = path.resolve(CWD, 'docusaurus-backup');

    const rawConfig = await nativeFs.promises.readFile(activeConfigPath, 'utf8');
    let title = 'Docmd Site';
    const titleMatch = rawConfig.match(/title:\s*['"]([^'"]+)['"]/);
    if (titleMatch) title = titleMatch[1];

    // N-22: preserve the original Docusaurus staticDir if set (default
    // is `static`). Falling back to `dist` only when the user hasn't
    // overridden it — overwriting a `site/` directory because we
    // hardcoded `dist` is the most common silent-clobber pattern.
    let out = 'dist';
    const staticDirMatch = rawConfig.match(/staticDir\s*:\s*['"]([^'"]+)['"]/);
    if (staticDirMatch) out = staticDirMatch[1].replace(/^\.\//, '').replace(/\/$/, '') || 'static';

    const docmdConfig = { title, src: 'docs', out, theme: { appearance: 'system' } };
    // N-3: dry-run must run BEFORE any side effects (ensureDir, rename).
    if (dryRun) {
      await printAndExitDryRun('Docusaurus', 'docusaurus-backup', docmdConfig);
      return;
    }

    await fs.ensureDir(backupDir);
    await moveFilesToBackup(backupDir);
    TUI.step('Created backup directory', 'DONE');

    const backupDocsDir = path.resolve(backupDir, 'docs');
    const newDocsDir = path.resolve(CWD, 'docs');
    if (nativeFs.existsSync(backupDocsDir)) {
      await fs.copy(backupDocsDir, newDocsDir);
      TUI.step('Migrated documentation content', 'DONE');
    } else {
      await fs.ensureDir(newDocsDir);
      TUI.step('Created new docs directory', 'DONE');
    }

    // T-Z14 / T-Z17: translate Docusaurus-specific frontmatter keys.
    // docmd derives route ids from filenames, so Docusaurus `id:` is
    // dropped. `sidebar_label:` is preserved as `nav_title:` (a
    // docmd-supported override of the auto-generated nav title).
    // The translation is best-effort: files that fail to parse keep
    // their original frontmatter, and a TUI line reports the count.
    let fmTranslated = 0;
    try {
      const translated = await translateDocusaurusFrontmatter(newDocsDir);
      fmTranslated = translated;
    } catch (err: any) {
      TUI.warn(`Frontmatter translation skipped: ${err.message}`);
    }
    if (fmTranslated > 0) {
      TUI.step(`Translated Docusaurus frontmatter in ${fmTranslated} file(s)`, 'DONE');
    }

    await nativeFs.promises.writeFile(path.resolve(CWD, 'docmd.config.js'), serializeConfig(docmdConfig));
    TUI.step('Generated docmd.config.js', 'DONE');

    TUI.footer();
    TUI.success('Docusaurus migration complete.');
    TUI.info(`Original files moved to: ${TUI.cyan('docusaurus-backup/')}`);
    TUI.info(`Run ${TUI.cyan('docmd dev')} to preview your site.`);

  } else if (options.mkdocs) {
    TUI.section('MkDocs Migration');
    const configPath = path.resolve(CWD, 'mkdocs.yml');

    if (!nativeFs.existsSync(configPath)) {
      TUI.error('Missing configuration', 'mkdocs.yml not found.');
      // Phase 3 PR 3.A (F6): exit 1 so CI pipelines can gate on it.
      process.exit(1);
    }

    const backupDir = path.resolve(CWD, 'mkdocs-backup');

    const rawConfig = await nativeFs.promises.readFile(configPath, 'utf8');
    let title = 'Docmd Site';
    const titleMatch = rawConfig.match(/^site_name:\s*['"]?([^'"\n]+)['"]?/m);
    if (titleMatch) title = titleMatch[1].trim();

    // N-22: preserve the original `site_dir` (MkDocs default is `site`).
    // N-9 (partial): also build a basic nav tree from MkDocs `nav:`.
    let out = 'site';
    const siteDirMatch = rawConfig.match(/^site_dir\s*:\s*['"]?([^'"\n]+)['"]?/m);
    if (siteDirMatch) out = siteDirMatch[1].trim();
    // N-9: parse a simple top-level nav. This is a best-effort translation;
    // complex MkDocs nav trees (multi-level, with external links) fall
    // back to auto-generated nav at runtime.
    const nav = parseMkDocsNav(rawConfig);

    const docmdConfig: any = { title, src: 'docs', out, theme: { appearance: 'system' } };
    if (nav && nav.length > 0) docmdConfig.navigation = nav;
    // N-3: dry-run must run BEFORE any side effects (ensureDir, rename).
    if (dryRun) {
      await printAndExitDryRun('MkDocs', 'mkdocs-backup', docmdConfig);
      return;
    }

    await fs.ensureDir(backupDir);
    await moveFilesToBackup(backupDir);
    TUI.step('Created backup directory', 'DONE');

    const backupDocsDir = path.resolve(backupDir, 'docs');
    const newDocsDir = path.resolve(CWD, 'docs');
    if (nativeFs.existsSync(backupDocsDir)) {
      await fs.copy(backupDocsDir, newDocsDir);
      TUI.step('Migrated documentation content', 'DONE');
    } else {
      await fs.ensureDir(newDocsDir);
      TUI.step('Created new docs directory', 'DONE');
    }

    await nativeFs.promises.writeFile(path.resolve(CWD, 'docmd.config.js'), serializeConfig(docmdConfig));
    TUI.step('Generated docmd.config.js', 'DONE');

    TUI.footer();
    TUI.success('MkDocs migration complete.');
    TUI.info(`Original files moved to: ${TUI.cyan('mkdocs-backup/')}`);
    TUI.info(`Run ${TUI.cyan('docmd dev')} to preview your site.`);

  } else if (options.vitepress) {
    TUI.section('VitePress Migration');
    const CWD = process.cwd();

    let configDir = '';
    let activeConfigPath = '';

    // Check if config is in root or docs
    for (const dir of ['.vitepress', 'docs/.vitepress']) {
      for (const ext of ['js', 'ts', 'mjs', 'mts']) {
        const p = path.resolve(CWD, `${dir}/config.${ext}`);
        if (nativeFs.existsSync(p)) {
          configDir = dir;
          activeConfigPath = p;
          break;
        }
      }
      if (activeConfigPath) break;
    }

    if (!activeConfigPath) {
      TUI.error('Missing configuration', '.vitepress/config.[js|ts|mjs|mts] not found.');
      // Phase 3 PR 3.A (F6): exit 1 so CI pipelines can gate on it.
      process.exit(1);
    }

    const backupDir = path.resolve(CWD, 'vitepress-backup');

    const rawConfig = await nativeFs.promises.readFile(activeConfigPath, 'utf8');
    let title = 'Docmd Site';
    const titleMatch = rawConfig.match(/title:\s*['"]([^'"]+)['"]/);
    if (titleMatch) title = titleMatch[1];

    const docmdConfig = { title, src: 'docs', out: 'dist', theme: { appearance: 'system' } };
    // N-3: dry-run must run BEFORE any side effects.
    if (dryRun) {
      await printAndExitDryRun('VitePress', 'vitepress-backup', docmdConfig);
      return;
    }

    await fs.ensureDir(backupDir);
    await moveFilesToBackup(backupDir);
    TUI.step('Created backup directory', 'DONE');

    const isDocsInRoot = configDir === '.vitepress';
    const newDocsDir = path.resolve(CWD, 'docs');
    await fs.ensureDir(newDocsDir);

    if (isDocsInRoot) {
      // The project root is the VitePress source dir: copy its folders too (guide/, public/).
      const files = await nativeFs.promises.readdir(backupDir);
      for (const file of files) {
        if (!file.startsWith('.')) {
          await fs.copy(path.resolve(backupDir, file), path.resolve(newDocsDir, file));
        }
      }
      TUI.step('Migrated root content to docs/', 'DONE');
    } else {
      const backupDocsDir = path.resolve(backupDir, 'docs');
      if (nativeFs.existsSync(backupDocsDir)) {
        await fs.copy(backupDocsDir, newDocsDir);
        await fs.remove(path.resolve(newDocsDir, '.vitepress'));
        TUI.step('Migrated docs content', 'DONE');
      }
    }

    await nativeFs.promises.writeFile(path.resolve(CWD, 'docmd.config.js'), serializeConfig(docmdConfig));
    TUI.step('Generated docmd.config.js', 'DONE');

    TUI.footer();
    TUI.success('VitePress migration complete.');
    TUI.info(`Original files moved to: ${TUI.cyan('vitepress-backup/')}`);
    TUI.info(`Run ${TUI.cyan('docmd dev')} to preview your site.`);

  } else if (options.starlight) {
    TUI.section('Starlight Migration');
    const configPath = path.resolve(CWD, 'astro.config.mjs');
    const tsConfigPath = path.resolve(CWD, 'astro.config.ts');

    let activeConfigPath = '';
    if (nativeFs.existsSync(configPath)) activeConfigPath = configPath;
    else if (nativeFs.existsSync(tsConfigPath)) activeConfigPath = tsConfigPath;
    else {
      TUI.error('Missing configuration', 'astro.config.mjs or astro.config.ts not found.');
      // Phase 3 PR 3.A (F6): exit 1 so CI pipelines can gate on it.
      process.exit(1);
    }

    const backupDir = path.resolve(CWD, 'starlight-backup');

    const rawConfig = await nativeFs.promises.readFile(activeConfigPath, 'utf8');
    let title = 'Docmd Site';
    const titleMatch = rawConfig.match(/title:\s*['"]([^'"]+)['"]/);
    if (titleMatch) title = titleMatch[1];

    const docmdConfig = { title, src: 'docs', out: 'dist', theme: { appearance: 'system' } };
    // N-3: dry-run must run BEFORE any side effects.
    if (dryRun) {
      await printAndExitDryRun('Starlight', 'starlight-backup', docmdConfig);
      return;
    }

    await fs.ensureDir(backupDir);
    await moveFilesToBackup(backupDir);
    TUI.step('Created backup directory', 'DONE');

    const backupDocsDir = path.resolve(backupDir, 'src/content/docs');
    const newDocsDir = path.resolve(CWD, 'docs');

    if (nativeFs.existsSync(backupDocsDir)) {
      await fs.copy(backupDocsDir, newDocsDir);
      TUI.step('Migrated documentation content', 'DONE');
    } else {
      await fs.ensureDir(newDocsDir);
      TUI.step('Created new docs directory', 'DONE');
    }

    await nativeFs.promises.writeFile(path.resolve(CWD, 'docmd.config.js'), serializeConfig(docmdConfig));
    TUI.step('Generated docmd.config.js', 'DONE');

    TUI.footer();
    TUI.success('Astro Starlight migration complete.');
    TUI.info(`Original files moved to: ${TUI.cyan('starlight-backup/')}`);
    TUI.info(`Run ${TUI.cyan('docmd dev')} to preview your site.`);
  } else if (options.upgrade) {
    TUI.section('Upgrading Configuration');
    
    const jsonPath = path.resolve(CWD, 'docmd.config.json');
    const jsPath = path.resolve(CWD, 'docmd.config.js');
    const tsPath = path.resolve(CWD, 'docmd.config.ts');

    let activePath = '';
    let format: 'json' | 'js' | 'ts' = 'json';

    if (nativeFs.existsSync(jsonPath)) {
      activePath = jsonPath;
      format = 'json';
    } else if (nativeFs.existsSync(jsPath)) {
      activePath = jsPath;
      format = 'js';
    } else if (nativeFs.existsSync(tsPath)) {
      activePath = tsPath;
      format = 'ts';
    }

    if (!activePath) {
      TUI.error('Upgrade Failed', 'No docmd configuration file (docmd.config.json/js/ts) found in current directory.');
      // Phase 3 PR 3.A (F6): exit 1 so CI pipelines can gate on it.
      process.exit(1);
    }

    TUI.step(`Found configuration: ${TUI.cyan(path.basename(activePath))}`, 'WAIT');

    try {
      const raw = await nativeFs.promises.readFile(activePath, 'utf8');
      let configObj: any = {};
      let isUpgraded = false;

      if (format === 'json') {
        configObj = JSON.parse(raw);
      } else {
        // Dynamic import to read current exported config values
        const module = await import(`file://${activePath}`);
        configObj = module.default || {};
      }

      // 1. Upgrade legacy top-level 'projects' to 'workspace.projects'
      if (configObj.projects && Array.isArray(configObj.projects) && !configObj.workspace) {
        configObj.workspace = {
          projects: configObj.projects,
          switcher: {
            enabled: true,
            position: 'sidebar-top'
          }
        };
        delete configObj.projects;
        isUpgraded = true;
        TUI.step('Upgraded legacy top-level "projects" to "workspace" schema.', 'DONE');
      }

      // 2. Upgrade legacy 'siteTitle' to 'title'
      if (configObj.siteTitle && !configObj.title) {
        configObj.title = configObj.siteTitle;
        delete configObj.siteTitle;
        isUpgraded = true;
        TUI.step('Upgraded "siteTitle" to "title".', 'DONE');
      }

      // 3. Upgrade legacy 'siteUrl' / 'baseUrl' to 'url'
      if (configObj.siteUrl && !configObj.url) {
        configObj.url = configObj.siteUrl;
        delete configObj.siteUrl;
        isUpgraded = true;
        TUI.step('Upgraded "siteUrl" to "url".', 'DONE');
      }
      if (configObj.baseUrl && !configObj.url) {
        configObj.url = configObj.baseUrl;
        delete configObj.baseUrl;
        isUpgraded = true;
        TUI.step('Upgraded "baseUrl" to "url".', 'DONE');
      }

      // 4. Upgrade legacy 'srcDir' to 'src'
      if (configObj.srcDir && !configObj.src) {
        configObj.src = configObj.srcDir;
        delete configObj.srcDir;
        isUpgraded = true;
        TUI.step('Upgraded "srcDir" to "src".', 'DONE');
      }

      // 5. Upgrade legacy 'outputDir' to 'out'
      if (configObj.outputDir && !configObj.out) {
        configObj.out = configObj.outputDir;
        delete configObj.outputDir;
        isUpgraded = true;
        TUI.step('Upgraded "outputDir" to "out".', 'DONE');
      }

      // 6. Upgrade legacy 'defaultLocale' to 'i18n.default'
      if (configObj.defaultLocale) {
        configObj.i18n = configObj.i18n || {};
        configObj.i18n.default = configObj.defaultLocale;
        delete configObj.defaultLocale;
        isUpgraded = true;
        TUI.step('Upgraded "defaultLocale" to "i18n.default".', 'DONE');
      }

      // N-4: extend the legacy-key map with the remaining common keys.
      // The previous upgrade covered siteTitle/siteUrl/baseUrl/srcDir/
      // outputDir/defaultLocale/projects but left several documented
      // legacy keys untouched. These are the keys the build-time
      // loader used in 0.7.x and earlier.

      // 7. 'source' (older alias for 'src')
      if (configObj.source && !configObj.src) {
        configObj.src = configObj.source;
        delete configObj.source;
        isUpgraded = true;
        TUI.step('Upgraded "source" to "src".', 'DONE');
      }

      // 8. 'outDir' (older alias for 'out')
      if (configObj.outDir && !configObj.out) {
        configObj.out = configObj.outDir;
        delete configObj.outDir;
        isUpgraded = true;
        TUI.step('Upgraded "outDir" to "out".', 'DONE');
      }

      // 9. 'nav' (legacy sidebar structure) → 'navigation'
      if (configObj.nav && !configObj.navigation) {
        configObj.navigation = configObj.nav;
        delete configObj.nav;
        isUpgraded = true;
        TUI.step('Upgraded "nav" to "navigation".', 'DONE');
      }

      // 10. Top-level 'search' boolean → 'plugins.search'
      if (typeof configObj.search === 'boolean' && !configObj.plugins?.search) {
        configObj.plugins = configObj.plugins || {};
        configObj.plugins.search = configObj.search === true ? {} : { enabled: false };
        delete configObj.search;
        isUpgraded = true;
        TUI.step('Upgraded top-level "search" to "plugins.search".', 'DONE');
      }

      // 11. Top-level 'sidebar' → 'layout.sidebar'
      if (configObj.sidebar && !configObj.layout?.sidebar) {
        configObj.layout = configObj.layout || {};
        configObj.layout.sidebar = configObj.sidebar;
        delete configObj.sidebar;
        isUpgraded = true;
        TUI.step('Upgraded top-level "sidebar" to "layout.sidebar".', 'DONE');
      }

      // 12. 'theme.enableModeToggle' → 'optionsMenu.components.themeSwitch'
      if (configObj.theme?.enableModeToggle !== undefined) {
        configObj.optionsMenu = configObj.optionsMenu || {};
        configObj.optionsMenu.components = configObj.optionsMenu.components || {};
        configObj.optionsMenu.components.themeSwitch = configObj.theme.enableModeToggle !== false;
        delete configObj.theme.enableModeToggle;
        isUpgraded = true;
        TUI.step('Upgraded "theme.enableModeToggle" to "optionsMenu.components.themeSwitch".', 'DONE');
      }

      // 13. 'theme.positionMode' → 'optionsMenu.position'
      if (configObj.theme?.positionMode && !configObj.optionsMenu?.position) {
        configObj.optionsMenu = configObj.optionsMenu || {};
        configObj.optionsMenu.position = configObj.theme.positionMode === 'bottom' ? 'sidebar-bottom' : 'sidebar-top';
        delete configObj.theme.positionMode;
        isUpgraded = true;
        TUI.step('Upgraded "theme.positionMode" to "optionsMenu.position".', 'DONE');
      }

      // 14. 'theme.defaultMode' → 'theme.appearance'
      if (configObj.theme?.defaultMode && !configObj.theme?.appearance) {
        configObj.theme.appearance = configObj.theme.defaultMode;
        delete configObj.theme.defaultMode;
        isUpgraded = true;
        TUI.step('Upgraded "theme.defaultMode" to "theme.appearance".', 'DONE');
      }

      if (!isUpgraded) {
        TUI.footer();
        TUI.success('Configuration is already up to date with the latest schema.');
        return;
      }

      // N-3: dry-run prints the upgraded config and exits 0 without writing.
      if (dryRun) {
        TUI.section('Dry run: config upgrade');
        TUI.item('Config path', activePath);
        TUI.item('Upgraded config', JSON.stringify(configObj, null, 2));
        TUI.footer();
        TUI.info('No changes made. Re-run without --dry-run to apply.');
        return;
      }

      // Write upgraded config back
      if (format === 'json') {
        await nativeFs.promises.writeFile(activePath, JSON.stringify(configObj, null, 2) + '\n');
      } else {
        let content = serializeConfig(configObj);
        if (format === 'ts') {
          content = `import { UserConfig } from '@docmd/api';\n\nconst config: UserConfig = ${JSON.stringify(configObj, null, 2).replace(/"([^"]+)":/g, '$1:')};\n\nexport default config;\n`;
        }
        await nativeFs.promises.writeFile(activePath, content);
      }

      TUI.footer();
      TUI.success(`Successfully upgraded config file to modern schema.`);
    } catch (error: any) {
      TUI.error('Upgrade Error', `Failed to parse or write config file: ${error.message}`);
      // Phase 3 PR 3.A (F6): exit 1 so CI pipelines can gate on it.
      process.exit(1);
    }
  }
}
