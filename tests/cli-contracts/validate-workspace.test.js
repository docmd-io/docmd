/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Phase 3 PR 3.C — Validate rewrite + workspace errors + init example
 *
 * Tests:
 *   - M-1: `docmd validate` trailing-slash false-positives
 *   - F8: workspace validation throws raw stack traces
 *   - F9: default init `index.md` has a broken `::: button` example
 *
 * Run: `node tests/runner.js`
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  setup,
  writeFile,
  exitCodeOf,
  runTestFile
} from '../shared.js';
import { execSync } from 'node:child_process';
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
  name: 'Validate rewrite + workspace errors + init example (Phase 3 PR 3.C — F8, F9, M-1)',
  emoji: '📐',
  run: () => {

    // M-1 — `validate` must not false-positive on a valid link with a
    // trailing slash. Pre-fix: `[page 2](/page-2/)` was reported as
    // broken because the code did `fs.existsSync('docs/page-2/.md')`
    // (always false). Post-fix: the trailing slash is stripped before
    // the existence checks, and the link resolves to `docs/page-2.md`.
    {
      const dir = setup('validate-workspace-28-m1-trailing-slash-ok');
      writeFile(dir, 'docs/index.md', '# P1\n\n[page 2](/page-2/).\n');
      writeFile(dir, 'docs/page-2.md', '# P2\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 0, 'M-1: trailing-slash link to existing .md is valid (exit 0)');
    }

    // M-1 — genuine broken link is still caught.
    {
      const dir = setup('validate-workspace-28-m1-broken-still-caught');
      writeFile(dir, 'docs/index.md', '# P1\n\n[bad](/nope/)\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 1, 'M-1: genuinely broken link still exits 1');
    }

    // #251 — a link with empty text (`[](./missing.jpg)`) must still be
    // validated. Pre-fix the link regex required at least one character
    // between the brackets, so these links were silently skipped.
    {
      const dir = setup('validate-workspace-251-empty-text-broken');
      writeFile(dir, 'docs/index.md', '# P1\n\n[](./missing.jpg)\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 1, '#251: broken link with empty text exits 1');
    }

    {
      const dir = setup('validate-workspace-251-empty-text-ok');
      writeFile(dir, 'docs/index.md', '# P1\n\n[](./page-2.md)\n');
      writeFile(dir, 'docs/page-2.md', '# P2\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 0, '#251: valid link with empty text exits 0');
    }

    // #250 — the build copies the project-root `assets/` directory to
    // `/assets/` in the site, so `/assets/...` links resolve there and
    // must not be reported as broken just because `docs/assets/` is empty.
    {
      const dir = setup('validate-workspace-250-root-assets-ok');
      writeFile(dir, 'docs/index.md', '# P1\n\n[Screenshot](/assets/images/screenshot.jpg)\n');
      writeFile(dir, 'assets/images/screenshot.jpg', 'jpg');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 0, '#250: /assets/ link to project-root assets/ file exits 0');
    }

    {
      const dir = setup('validate-workspace-250-root-assets-missing');
      writeFile(dir, 'docs/index.md', '# P1\n\n[Screenshot](/assets/images/missing.jpg)\n');
      writeFile(dir, 'assets/images/screenshot.jpg', 'jpg');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 1, '#250: /assets/ link to a missing file still exits 1');
    }

    // #259 — links with titles (e.g. `[text](url "title")` or `[text](<url> "title")`)
    // must strip the title instead of treating `"title"` as part of the filename.
    {
      const dir = setup('validate-workspace-259-link-title-ok');
      writeFile(dir, 'docs/index.md', '# P1\n\nSee [install](guides/install.md "Install docmd") and [guide](<guides/install.md> \'Guide\').\n');
      writeFile(dir, 'docs/guides/install.md', '# Install\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 0, '#259: links with titles to existing target exit 0');
    }

    {
      const dir = setup('validate-workspace-259-link-title-broken');
      writeFile(dir, 'docs/index.md', '# P1\n\n[bad](guides/missing.md "Missing guide")\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 1, '#259: links with titles to missing target still exit 1');
    }

    // #259 — links inside fenced code blocks (``` or ~~~) must be ignored.
    {
      const dir = setup('validate-workspace-259-code-fences-ok');
      const content = [
        '# Home',
        '',
        '```md',
        'Example link in code sample: [sample](./not-a-real-page.md)',
        '```',
        '',
        '~~~js',
        '// [fake link](./fake.md)',
        '~~~',
        '',
        '[real link](./page-2.md)',
        ''
      ].join('\n');
      writeFile(dir, 'docs/index.md', content);
      writeFile(dir, 'docs/page-2.md', '# Page 2\n');
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 0, '#259: links inside fenced code blocks are skipped (exit 0)');
    }

    {
      const dir = setup('validate-workspace-259-code-fences-broken-outside');
      const content = [
        '# Home',
        '',
        '```md',
        'Sample: [sample](./not-a-real-page.md)',
        '```',
        '',
        '[broken link outside fence](./broken.md)',
        ''
      ].join('\n');
      writeFile(dir, 'docs/index.md', content);
      const code = exitCodeOf(`node ${DOCMD} validate`, dir);
      assert(code === 1, '#259: broken link outside fence still caught (exit 1)');
    }

    // F8 — workspace validation errors exit 1 with a clean TUI message,
    // not a raw stack trace.
    {
      const dir = setup('validate-workspace-28-f8-workspace-error');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'F8',
        src: './docs',
        out: './site',
        workspace: {
          projects: [{ src: './totally-missing-f8', prefix: '/' }]
        }
      }));
      const code = exitCodeOf(`node ${DOCMD} build`, dir);
      assert(code === 1, 'F8: workspace with missing source dir exits 1');
    }

    // F8 — duplicate-prefix error also exits 1.
    {
      const dir = setup('validate-workspace-28-f8-workspace-duplicate');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'F8 dup',
        src: './docs',
        out: './site',
        workspace: {
          projects: [
            { src: './docs', prefix: '/api' },
            { src: './docs', prefix: '/api' }
          ]
        }
      }));
      const code = exitCodeOf(`node ${DOCMD} build`, dir);
      assert(code === 1, 'F8: duplicate workspace prefix exits 1');
    }

    // F9 — default init `index.md` must NOT contain the F2 trap pattern
    // (`::: card ... ::: button ... :::` with the orphan `:::`).
    // We check the bundled `initProject` source rather than running
    // `init` (which would write to disk) — we just confirm the
    // template string no longer teaches the F2 pattern.
    {
      const initSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'packages/core/dist/commands/init.js'),
        'utf8'
      );
      // The broken pattern was: `::: button "View Documentation" https://...`
      // followed by a `:::` close. The replacement uses
      // `[View the docs →](https://docmd.io){.docmd-button}` instead.
      assert(!/button "View Documentation"/.test(initSrc), 'F9: bundled init no longer contains broken `::: button ... :::` trap');
      assert(/\{\.docmd-button\}/.test(initSrc), 'F9: bundled init uses `{.docmd-button}` styled link');
    }

    // M-2 — workspace config without a root project must show an
    // actionable error message: explains the requirement, shows a
    // valid example, and points at the docs. The old message was
    // a single bare sentence with no example.
    {
      const dir = setup('validate-workspace-28-m2-workspace-no-root-message');
      // The source dirs must exist so the per-project existence check
      // does not fire first and mask the "no root project" failure.
      writeFile(dir, 'docs/index.md', '# Root\n');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'M2',
        src: './docs',
        out: './site',
        workspace: {
          projects: [
            { src: './docs', prefix: '/api/' },
            { src: './docs', prefix: '/blog/' }
          ]
        }
      }));
      let captured = '';
      let code = -1;
      try {
        execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        code = e.status == null ? -1 : e.status;
        const stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr ? e.stderr.toString() : '');
        const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout ? e.stdout.toString() : '');
        captured = stderr + stdout;
      }
      assert(code === 1, 'M-2: workspace with no root project exits 1');
      assert(/root project with prefix "\/"/.test(captured), 'M-2: error message states the root prefix requirement');
      assert(/Example:/.test(captured), 'M-2: error message includes an Example block');
      assert(/"prefix": "\/"/.test(captured), 'M-2: error message example shows prefix "/"');
      assert(/docs\.docmd\.io/.test(captured), 'M-2: error message links to the workspace guide');
    }

    // In a multi-project workspace setup, page-relative links to files
    // in the same subdirectory (or nested subdirectories) must resolve correctly relative
    // to the output HTML file path rather than escaping the project prefix.
    {
      const dir = setup('validate-workspace-29-subdir-linking');
      // Root project source
      writeFile(dir, 'docs/index.md', '# Root Home\n');
      
      // Project 1 source
      writeFile(dir, 'proj1/index.md', '# Proj1 Home\n');
      writeFile(dir, 'proj1/sub1/file1.md', '# File 1\n\n[link to file 2](file2.md)\n');
      writeFile(dir, 'proj1/sub1/file2.md', '# File 2\n');
      
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Workspace Test',
        src: './docs',
        out: './site',
        workspace: {
          projects: [
            { src: './docs', prefix: '/' },
            { src: './proj1', prefix: '/project1' }
          ]
        }
      }));
      
      execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe' });
      
      // Check the output html file1
      const htmlPath = path.join(dir, 'site/project1/sub1/file1/index.html');
      assert(fs.existsSync(htmlPath), 'Subdirectory page built at correct output path');
      
      const html = fs.readFileSync(htmlPath, 'utf8');
      
      // The link in proj1/sub1/file1.md to file2.md should be resolved page-relatively to "../file2/"
      assert(html.includes('href="../file2/"'), 'Subdirectory page-relative link resolved relative to the page');
      assert(!html.includes('href="/file2/"'), 'Subdirectory link does not resolve to the site root');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};