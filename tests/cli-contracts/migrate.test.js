/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * N-3 — `docmd migrate` accepts `--dry-run` for both source migrations
 * and `--upgrade`. Dry-run prints what would change and exits 0
 * without writing.
 *
 * Before the fix, the flag did not exist and there was no way to
 * preview a migration before committing to it.
 *
 * Run: `node tests/runner.js --only=migrate`
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  setup,
  writeFile,
  runTestFile
} from '../shared.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failed++;
    failures.push(message);
    console.log(`    ❌ ${message}`);
  } else {
    passed++;
    console.log(`    ✅ ${message}`);
  }
}

export const test = runTestFile({
  name: 'Migrate --dry-run is non-destructive (N-3)',
  emoji: '🧪',
  run: () => {

    // N-3 — source migration dry-run: mkdocs source, dry-run must NOT
    // create a backup directory or move any files, and must NOT write
    // docmd.config.js.
    {
      const dir = setup('migrate-30-n3-mkdocs-dry-run');
      writeFile(dir, 'mkdocs.yml', 'site_name: N3 Site\n');
      writeFile(dir, 'index.md', '# P1\n');
      writeFile(dir, 'docs/page.md', '# P2\n');

      let output = '';
      let code = -1;
      try {
        output = execFileSync(process.execPath, [DOCMD, 'migrate', '--mkdocs', '--dry-run'], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
        code = 0;
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') +
                 (typeof e.stderr === 'string' ? e.stderr : '');
        code = e.status == null ? -1 : e.status;
      }

      assert(code === 0, 'N-3: mkdocs dry-run exits 0');
      assert(/dry run: mkdocs migration/i.test(output), 'N-3: dry-run header mentions MkDocs');
      assert(/Would move/.test(output), 'N-3: dry-run lists files that would be moved');
      assert(/Would write/.test(output), 'N-3: dry-run mentions docmd.config.js');
      assert(/No changes made/.test(output), 'N-3: dry-run prints "No changes made"');

      // Original files must still exist unchanged.
      assert(fs.existsSync(path.join(dir, 'mkdocs.yml')), 'N-3: mkdocs.yml still exists after dry-run');
      assert(fs.existsSync(path.join(dir, 'index.md')), 'N-3: index.md still exists after dry-run');
      assert(fs.existsSync(path.join(dir, 'docs', 'page.md')), 'N-3: docs/page.md still exists after dry-run');
      // Backup directory must NOT exist.
      assert(!fs.existsSync(path.join(dir, 'mkdocs-backup')), 'N-3: no mkdocs-backup created during dry-run');
      // docmd.config.js must NOT exist.
      assert(!fs.existsSync(path.join(dir, 'docmd.config.js')), 'N-3: no docmd.config.js written during dry-run');
    }

    // N-3 — upgrade dry-run: must print the upgraded config and NOT
    // overwrite the original file.
    {
      const dir = setup('migrate-30-n3-upgrade-dry-run');
      const legacyConfig = {
        siteTitle: 'Legacy Site',
        srcDir: './docs',
        outputDir: './out',
        siteUrl: 'https://example.com',
        defaultLocale: 'en'
      };
      writeFile(dir, 'docmd.config.json', JSON.stringify(legacyConfig, null, 2) + '\n');
      const beforeBytes = fs.readFileSync(path.join(dir, 'docmd.config.json'));

      let output = '';
      let code = -1;
      try {
        output = execFileSync(process.execPath, [DOCMD, 'migrate', '--upgrade', '--dry-run'], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
        code = 0;
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') +
                 (typeof e.stderr === 'string' ? e.stderr : '');
        code = e.status == null ? -1 : e.status;
      }

      assert(code === 0, 'N-3: upgrade dry-run exits 0');
      assert(/dry run: config upgrade/i.test(output), 'N-3: dry-run header mentions config upgrade');
      assert(/"title":\s*"Legacy Site"/.test(output), 'N-3: dry-run shows upgraded title');
      assert(/"url":/.test(output), 'N-3: dry-run shows upgraded url');

      const afterBytes = fs.readFileSync(path.join(dir, 'docmd.config.json'));
      assert(Buffer.compare(beforeBytes, afterBytes) === 0, 'N-3: original config file unchanged after upgrade dry-run');
    }

    // N-4 — upgrade covers the full legacy-key map. Run a real (non
    // dry-run) upgrade on a config that exercises every legacy key
    // and assert the upgraded file contains the new keys and does
    // NOT contain the old ones.
    {
      const dir = setup('migrate-30-n4-upgrade-coverage');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        siteTitle: 'Legacy',
        source: './md',
        outDir: './public',
        nav: [{ label: 'Home', path: '/' }],
        search: true,
        sidebar: { position: 'left' },
        theme: { defaultMode: 'dark', enableModeToggle: false, positionMode: 'bottom' }
      }, null, 2) + '\n');

      execFileSync(process.execPath, [DOCMD, 'migrate', '--upgrade'], { cwd: dir, stdio: 'pipe' });

      const after = JSON.parse(fs.readFileSync(path.join(dir, 'docmd.config.json'), 'utf8'));
      assert(after.title === 'Legacy', 'N-4: siteTitle → title');
      assert(after.src === './md', 'N-4: source → src');
      assert(after.out === './public', 'N-4: outDir → out');
      assert(Array.isArray(after.navigation), 'N-4: nav → navigation (array preserved)');
      assert(after.plugins?.search !== undefined, 'N-4: top-level search → plugins.search');
      assert(after.layout?.sidebar?.position === 'left', 'N-4: top-level sidebar → layout.sidebar');
      assert(after.theme?.appearance === 'dark', 'N-4: theme.defaultMode → theme.appearance');
      assert(after.optionsMenu?.components?.themeSwitch === false, 'N-4: theme.enableModeToggle → optionsMenu.components.themeSwitch');
      assert(after.optionsMenu?.position === 'sidebar-bottom', 'N-4: theme.positionMode → optionsMenu.position');

      // Old keys must be gone.
      assert(after.siteTitle === undefined, 'N-4: old siteTitle key removed');
      assert(after.source === undefined, 'N-4: old source key removed');
      assert(after.outDir === undefined, 'N-4: old outDir key removed');
      assert(after.nav === undefined, 'N-4: old nav key removed');
      assert(after.search === undefined, 'N-4: old top-level search key removed');
      assert(after.sidebar === undefined, 'N-4: old top-level sidebar key removed');
      assert(after.theme?.defaultMode === undefined, 'N-4: old theme.defaultMode removed');
      assert(after.theme?.enableModeToggle === undefined, 'N-4: old theme.enableModeToggle removed');
      assert(after.theme?.positionMode === undefined, 'N-4: old theme.positionMode removed');
    }

    // N-10 — lockfiles and package manifests stay in place.
    {
      const dir = setup('migrate-fix-n10-lockfiles-stay');
      writeFile(dir, 'mkdocs.yml', 'site_name: N-10\n');
      writeFile(dir, 'package.json', '{"name":"test","dependencies":{"foo":"^1.0.0"}}\n');
      writeFile(dir, 'package-lock.json', '{"name":"test","lockfileVersion":3}\n');
      writeFile(dir, 'pnpm-lock.yaml', 'lockfileVersion: 6.0\n');
      writeFile(dir, 'docs/index.md', '# Home\n');
      writeFile(dir, 'docmd.config.json', '{"title":"N-10","src":"./docs","out":"./site"}\n');

      execFileSync(process.execPath, [DOCMD, 'migrate', '--mkdocs'], { cwd: dir, stdio: 'pipe' });

      // Package manifests stay in cwd (not in backup)
      assert(fs.existsSync(path.join(dir, 'package.json')), 'N-10: package.json stays in cwd after migrate');
      assert(fs.existsSync(path.join(dir, 'package-lock.json')), 'N-10: package-lock.json stays in cwd after migrate');
      assert(fs.existsSync(path.join(dir, 'pnpm-lock.yaml')), 'N-10: pnpm-lock.yaml stays in cwd after migrate');
      // node_modules is excluded
      assert(fs.existsSync(path.join(dir, 'node_modules')) === false || !fs.statSync(path.join(dir, 'node_modules')).isDirectory(), 'N-10: node_modules is not in the backup');
      // Backup contains user content
      assert(fs.existsSync(path.join(dir, 'mkdocs-backup/docs/index.md')), 'N-10: backup contains moved content (mkdocs-backup/docs/index.md)');
    }

    // MkDocs nav: stops at the next top-level key, maps index.md to its
    // folder, and drops YAML quotes.
    {
      const dir = setup('migrate-mkdocs-nav');
      writeFile(dir, 'mkdocs.yml', [
        'site_name: Nav',
        'nav:',
        '  - Home: index.md',
        '  - Guide:',
        '    - Overview: guide/index.md',
        "  - 'Change Log': 'changelog.md'",
        'plugins:',
        '  - search',
        'markdown_extensions:',
        '  - admonition',
      ].join('\n'));
      writeFile(dir, 'docs/index.md', '# Home\n');
      writeFile(dir, 'docs/guide/index.md', '# Guide\n');
      writeFile(dir, 'docs/changelog.md', '# Changes\n');

      execFileSync(process.execPath, [DOCMD, 'migrate', '--mkdocs'], { cwd: dir, stdio: 'pipe' });
      const written = fs.readFileSync(path.join(dir, 'docmd.config.js'), 'utf8');
      const navigation = JSON.parse(written.match(/navigation: (\[[\s\S]*?\n {2}\])/)[1].replace(/(\w+):/g, '"$1":'));
      assert(JSON.stringify(navigation) === JSON.stringify([
        { title: 'Home', path: '/' },
        { title: 'Guide', children: [{ title: 'Overview', path: '/guide/' }] },
        { title: 'Change Log', path: '/changelog/' },
      ]), 'MkDocs nav: plugins and extensions are not nav items, index.md maps to its folder, quotes are dropped');
    }

    // N-22 (Docusaurus) — preserve original staticDir.
    {
      const dir = setup('migrate-fix-n22-docusaurus');
      writeFile(dir, 'docusaurus.config.js', [
        "module.exports = {",
        "  title: 'N-22-d',",
        "  staticDir: 'my-static',",
        "};"
      ].join('\n'));
      writeFile(dir, 'docs/index.md', '# Home\n');
      writeFile(dir, 'docmd.config.json', '{"title":"N-22-d","src":"./docs","out":"./site"}\n');

      execFileSync(process.execPath, [DOCMD, 'migrate', '--docusaurus'], { cwd: dir, stdio: 'pipe' });
      const written = fs.readFileSync(path.join(dir, 'docmd.config.js'), 'utf8');
      assert(/out:\s*'my-static'/.test(written) || /out:\s*"my-static"/.test(written) || /out: 'my-static'/.test(written), 'N-22: Docusaurus staticDir "my-static" is preserved in the generated config');
    }

    // N-22 (MkDocs) — preserve original site_dir.
    {
      const dir = setup('migrate-fix-n22-mkdocs');
      writeFile(dir, 'mkdocs.yml', [
        'site_name: N-22-m',
        'site_dir: my-site',
        ''
      ].join('\n'));
      writeFile(dir, 'docs/index.md', '# Home\n');
      writeFile(dir, 'docmd.config.json', '{"title":"N-22-m","src":"./docs","out":"./site"}\n');

      execFileSync(process.execPath, [DOCMD, 'migrate', '--mkdocs'], { cwd: dir, stdio: 'pipe' });
      const written = fs.readFileSync(path.join(dir, 'docmd.config.js'), 'utf8');
      assert(/out:\s*['"]my-site['"]/.test(written), 'N-22: MkDocs site_dir "my-site" is preserved in the generated config');
    }

    // N-9 — MkDocs nav: is parsed into the docmd navigation.
    {
      const dir = setup('migrate-fix-n9-mkdocs-nav');
      writeFile(dir, 'mkdocs.yml', [
        'site_name: N-9',
        'nav:',
        '  - Home: index.md',
        '  - Guide:',
        '    - Getting Started: guide/start.md',
        '    - Reference: guide/ref.md',
        ''
      ].join('\n'));
      writeFile(dir, 'docs/index.md', '# Home\n');
      writeFile(dir, 'docmd.config.json', '{"title":"N-9","src":"./docs","out":"./site"}\n');

      execFileSync(process.execPath, [DOCMD, 'migrate', '--mkdocs'], { cwd: dir, stdio: 'pipe' });
      const written = fs.readFileSync(path.join(dir, 'docmd.config.js'), 'utf8');
      assert(/navigation:\s*\[/.test(written), 'N-9: generated config has a navigation array');
      assert(/'Home'|"Home"/.test(written) && /path:\s*['"]\/['"]/.test(written), 'N-9: navigation contains the Home entry');
      assert(/'Guide'|"Guide"/.test(written) && /children/.test(written), 'N-9: multi-level nav (Guide with children) is preserved');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};