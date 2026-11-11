/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Unanchored .gitignore and `exclude` patterns match only below the
 * directory they belong to. A project checked out at `/srv/site` with
 * `site/` in its .gitignore (the usual output dir) must still find its
 * pages; a pattern in a parent repo's .gitignore still applies.
 *
 * Run: `node tests/runner.js --only=gitignore-scope`
 * --------------------------------------------------------------------
 */

import { setup, writeFile, runTestFile, DOCMD } from '../shared.js';
import { execFileSync } from 'node:child_process';
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

/** Run `docmd build` in `dir` and return the page count it reports, or -1. */
function buildPages(dir) {
  let out;
  try {
    out = execFileSync(process.execPath, [DOCMD, 'build'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const m = /Generated (\d+) pages?/.exec(out);
  return m ? Number(m[1]) : -1;
}

function project(dir, gitignore, config = {}) {
  writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'T', src: 'docs', out: 'site', ...config }));
  writeFile(dir, 'docs/index.md', '# Home\n');
  writeFile(dir, 'docs/guide.md', '# Guide\n');
  writeFile(dir, 'docs/drafts/wip.md', '# WIP\n');
  if (gitignore !== null) writeFile(dir, '.gitignore', gitignore);
}

export const test = runTestFile({
  name: 'Gitignore and exclude patterns match only below their own directory',
  emoji: '🙈',
  run: async () => {
    const { findFilesRecursive } = await import('../../packages/core/dist/engine/assets.js');
    const rel = (root, files) => files.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();

    // The reported case, end to end: project folder named like the output dir.
    {
      const root = setup('gitignore-scope-build');
      const dir = path.join(root, 'site');
      project(dir, 'node_modules/\nsite/\ndrafts/\n');
      assert(buildPages(dir) === 2, '`docmd build` in a folder named `site` with `site/` gitignored builds both pages (drafts/ still ignored)');

      const control = path.join(root, 'docs-site');
      project(control, 'node_modules/\nsite/\ndrafts/\n');
      assert(buildPages(control) === 2, 'the same project in a folder with another name builds the same 2 pages');
    }

    // Discovery: an ancestor folder whose name matches a pattern from the project's own .gitignore.
    {
      const root = setup('gitignore-scope-ancestor');
      const dir = path.join(root, 'drafts', 'proj');
      project(dir, 'drafts/\n*.secret.md\n');
      writeFile(dir, 'docs/keys.secret.md', '# Secret\n');
      const found = rel(dir, await findFilesRecursive(path.join(dir, 'docs'), ['.md']));
      assert(JSON.stringify(found) === JSON.stringify(['docs/guide.md', 'docs/index.md']),
        `an ancestor named \`drafts\` does not hide the project; docs/drafts/ and *.secret.md still do (got ${found.join(', ')})`);
    }

    // A parent repo's .gitignore still applies to what is below it.
    {
      const root = setup('gitignore-scope-parent');
      writeFile(root, '.gitignore', 'vendor/\n');
      const dir = path.join(root, 'vendor', 'proj');
      project(dir, null);
      const found = await findFilesRecursive(path.join(dir, 'docs'), ['.md']);
      assert(found.length === 0, 'a pattern in a parent .gitignore still ignores the directories below it');
    }

    // Wildcard patterns are scoped the same way.
    {
      const root = setup('gitignore-scope-glob');
      const dir = path.join(root, 'build-output', 'proj');
      project(dir, 'build-*/\n');
      const found = rel(dir, await findFilesRecursive(path.join(dir, 'docs'), ['.md']));
      assert(found.includes('docs/index.md') && found.includes('docs/guide.md'),
        'a wildcard pattern (`build-*/`) does not match an ancestor folder (`build-output`)');
    }

    // config.exclude: relative to the project directory, not the filesystem root.
    {
      const root = setup('gitignore-scope-exclude');
      const dir = path.join(root, 'drafts', 'proj');
      project(dir, null, { exclude: ['drafts'] });
      assert(buildPages(dir) === 2, '`exclude: ["drafts"]` hides docs/drafts/ but not the ancestor folder named `drafts`');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
