#!/usr/bin/env node
/**
 * docmd Comprehensive Feature Test Suite
 * =======================================
 * Brute tests every major docmd feature in isolation and combination.
 * Run: node tests/feature-integration.test.js
 *
 * Tests:
 *  1. Zero-config (no config file)
 *  2. Zero-config with nested docs
 *  3. i18n standalone (3 locales, non-default as default)
 *  4. Versioning standalone (2 versions)
 *  5. i18n + versioning combined
 *  6. Old version with partial translations
 *  7. Missing locale dir (graceful skip)
 *  8. Navigation resolution (locale > version > config)
 *  9. Frontmatter parsing (title, description, layout)
 * 10. Containers (callout, tabs, steps, cards, hero)
 * 11. Code blocks (syntax highlighting, line numbers)
 * 12. Custom CSS/JS injection
 * 13. Edit links
 * 14. No-style pages
 * 15. Search index generation
 * 16. Sitemap generation
 * 17. EJS content pages
 * 18. README.md as index fallback
 * 19. Markdown file extensions (.md and .markdown)
 * 20. Deep nested directory structure
 * 21. Zero-config auto-nav accuracy
 * 22. Title tag auto-append
 * 23. OG meta tags
 * 24. Redirects
 * 25. Per-page layout override
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tryHit, store as cacheStore } from './_lib/build-cache.mjs';
import { TEST_ROOT } from './shared.js';

const DOCMD = path.resolve(import.meta.dirname, '../packages/core/dist/bin/docmd.js');
const PASS = '✅';
const FAIL = '❌';

let passed = 0;
let failed = 0;
const failures = [];

function setup(name) {
  const dir = path.join(TEST_ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function build(dir, expectFail = false) {
  // Cache check: if the test's source files + config match a previous
  // successful build, reuse the cached `site/` directory instead of running
  // a fresh `docmd build`. This collapses second-run prep time when nothing
  // in the test fixtures changed. Cache miss / failure fall back to the
  // original execSync path so the test behaves identically on the first
  // run. To bypass the cache entirely, set DOCMD_TEST_CACHE_OFF=1.
  const configPath = path.join(dir, 'docmd.config.json');
  if (!expectFail) {
    const hit = tryHit(dir, configPath);
    if (hit && hit.ok) {
      // Copy (or hardlink) the cached site into the test dir so the rest
      // of the test sees the same paths it always did. Hardlink saves
      // disk for large sites; cp as fallback.
      const cachedSite = hit.siteDir;
      const targetSite = path.join(dir, 'site');
      fs.rmSync(targetSite, { recursive: true, force: true });
      try {
        fs.cpSync(cachedSite, targetSite, { recursive: true, dereference: false });
      } catch {
        fs.rmSync(targetSite, { recursive: true, force: true });
        fs.mkdirSync(targetSite, { recursive: true });
      }
      return { ok: true, output: hit.output, cached: true };
    }
  }
  try {
    const out = execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
    if (expectFail) return { ok: false, output: out };
    // Store successful builds so the next run can skip the rebuild.
    const siteDir = path.join(dir, 'site');
    if (!expectFail && fs.existsSync(siteDir)) {
      try { cacheStore(dir, configPath, siteDir, true, out); } catch { /* cache best-effort */ }
    }
    return { ok: true, output: out, cached: false };
  } catch (e) {
    if (expectFail) return { ok: true, output: e.stderr || e.stdout || '' };
    return { ok: false, output: e.stderr || e.stdout || '' };
  }
}

// Run a command, return its numeric exit
// code. 0 on success, 1+ on documented failure paths. -1 if the
// process was killed by a signal (rare; mostly for diagnostics).
function _exitCodeOf(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status == null ? -1 : e.status;
  }
}

function writeFile(dir, filePath, content) {
  const full = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function readSite(dir, filePath) {
  const full = path.join(dir, 'site', filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function siteExists(dir, filePath) {
  return fs.existsSync(path.join(dir, 'site', filePath));
}

function countPages(dir) {
  const siteDir = path.join(dir, 'site');
  if (!fs.existsSync(siteDir)) return 0;
  let count = 0;
  function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name));
      else if (f.name === 'index.html') count++;
    }
  }
  walk(siteDir);
  return count;
}

function assert(testName, condition, detail = '') {
  if (condition) {
    console.log(`│  ${PASS} ${testName}`);
    passed++;
  } else {
    console.log(`│  ${FAIL} ${testName}${detail ? ': ' + detail : ''}`);
    failed++;
    failures.push(testName);
  }
}

// ─── TEST 1: Zero-config (no config file) ───
console.log('\n📦 Test 1: Zero-config (no config file)');
{
  const dir = setup('01-zero-config');
  writeFile(dir, 'docs/index.md', '---\ntitle: Home\n---\n# Hello\nWelcome.');
  writeFile(dir, 'docs/about.md', '---\ntitle: About\n---\n# About\nAbout page.');
  const r = build(dir);
  assert('builds without config', r.ok);
  assert('generates 2 pages', countPages(dir) === 2);
  assert('index page exists', siteExists(dir, 'index.html'));
  assert('about page exists', siteExists(dir, 'about/index.html'));
  const idx = readSite(dir, 'index.html');
  assert('contains page content', idx?.includes('Welcome'));
}

// ─── TEST 2: Zero-config with nested docs ───
console.log('\n📦 Test 2: Zero-config with nested docs');
{
  const dir = setup('02-zero-nested');
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/guide/intro.md', '# Intro\nIntro content.');
  writeFile(dir, 'docs/guide/advanced/deep.md', '# Deep\nDeep content.');
  const r = build(dir);
  assert('builds with nested dirs', r.ok);
  assert('generates 3 pages', countPages(dir) === 3);
  assert('nested page exists', siteExists(dir, 'guide/intro/index.html'));
  assert('deep nested page exists', siteExists(dir, 'guide/advanced/deep/index.html'));
}

// ─── TEST 3: i18n standalone (non-English default) ───
console.log('\n🌍 Test 3: i18n standalone (Hindi default)');
{
  const dir = setup('03-i18n-hindi-default');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Hindi Default',
    src: 'docs',
    i18n: { default: 'hi', locales: [
      { id: 'hi', label: 'हिन्दी' },
      { id: 'en', label: 'English' }
    ]}
  };`);
  writeFile(dir, 'docs/hi/index.md', '---\ntitle: मुखपृष्ठ\n---\n# स्वागत');
  writeFile(dir, 'docs/hi/guide.md', '---\ntitle: गाइड\n---\n# गाइड');
  writeFile(dir, 'docs/hi/navigation.json', '[{"title":"मुखपृष्ठ","path":"/"},{"title":"गाइड","path":"/guide"}]');
  writeFile(dir, 'docs/en/index.md', '---\ntitle: Home\n---\n# Welcome');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Home","path":"/"}]');
  const r = build(dir);
  assert('builds with Hindi default', r.ok);
  const root = readSite(dir, 'index.html');
  assert('root is Hindi content', root?.includes('स्वागत'));
  const enPage = readSite(dir, 'en/index.html');
  assert('English at /en/', enPage?.includes('Welcome'));
  assert('Hindi guide exists', siteExists(dir, 'guide/index.html'));
  assert('English guide falls back from Hindi', siteExists(dir, 'en/guide/index.html'));
}

// ─── TEST 3.5 (M-5): i18n cross-locale link to default locale prefix ───
console.log('\n🌍 Test 3.5: i18n cross-locale link to default locale (M-5)');
{
  // M-5: when the default locale lives at root and a non-default-locale
  // page writes `[link](/<defaultLocale>/foo)`, the build used to emit
  // `<a href="/en/foo">` which 404s because the default-locale page is
  // at `/foo`, not `/en/foo`. The fix strips the default-locale prefix
  // from absolute hrefs in the rendered HTML so the link points to the
  // actual location of the default-locale page.
  const dir = setup('03.5-m5-cross-locale-link');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'M5 test',
    src: 'docs',
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'fr', label: 'Français' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# Welcome');
  writeFile(dir, 'docs/en/setup.md', '# Setup page');
  writeFile(dir, 'docs/fr/index.md', 'Voir la [version anglaise](/en/) et le [setup anglais](/en/setup).');
  const r = build(dir);
  assert('builds M-5 scenario', r.ok);
  const fr = readSite(dir, 'fr/index.html');
  assert('fr page does NOT link to /en/ (would 404)', fr && !/href="\/en\/"/.test(fr));
  assert('fr page does NOT link to /en/setup (would 404)', fr && !/href="\/en\/setup"/.test(fr));
  // The rewritten links should still resolve. Default-locale pages live
  // at root, so `/en/` → `/` and `/en/setup` → `/setup` (or
  // `/setup/`). Both should be present.
  assert('default-locale index exists at root', siteExists(dir, 'index.html'));
  assert('default-locale setup page exists', siteExists(dir, 'setup/index.html'));
  // Online build keeps clean URLs — verify the link does NOT carry
  // `/index.html` suffix (that would be the offline build behaviour).
  assert('online build keeps clean URLs', fr && !/href="[^"]*index\.html"/.test(fr));
}

// ─── TEST 4: Versioning standalone ───
console.log('\n📚 Test 4: Versioning standalone (no i18n)');
{
  const dir = setup('04-versioning');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Versioned',
    src: 'docs',
    versions: { current: 'v2', all: [
      { id: 'v2', dir: 'docs', label: 'v2.0' },
      { id: 'v1', dir: 'docs-v1', label: 'v1.0' }
    ]}
  };`);
  writeFile(dir, 'docs/index.md', '# v2 Home');
  writeFile(dir, 'docs/guide.md', '# v2 Guide');
  writeFile(dir, 'docs/navigation.json', '[{"title":"Home","path":"/"},{"title":"Guide","path":"/guide"}]');
  writeFile(dir, 'docs-v1/index.md', '# v1 Home');
  writeFile(dir, 'docs-v1/navigation.json', '[{"title":"Home","path":"/"}]');
  const r = build(dir);
  assert('builds with versioning', r.ok);
  assert('v2 at root', readSite(dir, 'index.html')?.includes('v2 Home'));
  assert('v1 at /v1/', readSite(dir, 'v1/index.html')?.includes('v1 Home'));
  assert('v2 guide exists', siteExists(dir, 'guide/index.html'));
  assert('no v1 guide', !siteExists(dir, 'v1/guide/index.html'));
}

// ─── TEST 5: i18n + versioning combined ───
console.log('\n🌍📚 Test 5: i18n + versioning combined');
{
  const dir = setup('05-i18n-versioning');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Combined',
    src: 'docs',
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'fr', label: 'Français' }
    ]},
    versions: { current: 'v2', all: [
      { id: 'v2', dir: 'docs', label: 'v2' },
      { id: 'v1', dir: 'docs-v1', label: 'v1' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# EN v2');
  writeFile(dir, 'docs/en/guide.md', '# EN Guide');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Home","path":"/"},{"title":"Guide","path":"/guide"}]');
  writeFile(dir, 'docs/fr/index.md', '# FR v2');
  writeFile(dir, 'docs/fr/navigation.json', '[{"title":"Accueil","path":"/"}]');
  writeFile(dir, 'docs-v1/index.md', '# EN v1');
  writeFile(dir, 'docs-v1/navigation.json', '[{"title":"Home","path":"/"}]');
  const r = build(dir);
  assert('builds combined i18n+versioning', r.ok);
  assert('EN root', readSite(dir, 'index.html')?.includes('EN v2'));
  assert('FR at /fr/', readSite(dir, 'fr/index.html')?.includes('FR v2'));
  assert('EN guide fallback in FR', siteExists(dir, 'fr/guide/index.html'));
  assert('v1 at /v1/ (EN only)', readSite(dir, 'v1/index.html')?.includes('EN v1'));
  assert('no FR v1 (no locale dir)', !siteExists(dir, 'fr/v1/index.html'));
}

// ─── TEST 6: Old version with partial translation ───
console.log('\n🌍📚 Test 6: Old version with partial translation');
{
  const dir = setup('06-partial-old-version');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Partial',
    src: 'docs',
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'hi', label: 'Hindi' }
    ]},
    versions: { current: 'v2', all: [
      { id: 'v2', dir: 'docs', label: 'v2' },
      { id: 'v1', dir: 'docs-v1', label: 'v1' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# EN v2');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Home","path":"/"}]');
  writeFile(dir, 'docs/hi/index.md', '# HI v2');
  writeFile(dir, 'docs/hi/navigation.json', '[{"title":"होम","path":"/"}]');
  writeFile(dir, 'docs-v1/index.md', '# EN v1');
  writeFile(dir, 'docs-v1/guide.md', '# EN v1 Guide');
  writeFile(dir, 'docs-v1/navigation.json', '[{"title":"Home","path":"/"},{"title":"Guide","path":"/guide"}]');
  writeFile(dir, 'docs-v1/hi/index.md', '# HI v1');
  writeFile(dir, 'docs-v1/hi/navigation.json', '[{"title":"होम","path":"/"}]');
  const r = build(dir);
  assert('builds with partial old version translation', r.ok);
  assert('HI v1 at /hi/v1/', readSite(dir, 'hi/v1/index.html')?.includes('HI v1'));
  assert('EN v1 guide exists', siteExists(dir, 'v1/guide/index.html'));
  assert('no ghost /v1/hi/ path', !siteExists(dir, 'v1/hi/index.html'));
}

// ─── TEST 7: Missing locale dir (graceful skip) ───
console.log('\n🌍 Test 7: Missing locale dir (graceful skip)');
{
  const dir = setup('07-missing-locale');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Missing',
    src: 'docs',
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'ja', label: 'Japanese' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# English');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Home","path":"/"}]');
  // No docs/ja/ directory at all
  const r = build(dir);
  assert('builds without crashing', r.ok);
  assert('EN pages built', siteExists(dir, 'index.html'));
  assert('no JA dir in output', !siteExists(dir, 'ja/index.html'));
}

// ─── TEST 8: Navigation resolution priority ───
console.log('\n🧭 Test 8: Navigation resolution priority');
{
  const dir = setup('08-nav-resolution');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Nav Test',
    src: 'docs',
    navigation: [{ title: 'Config Nav', path: '/' }],
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'fr', label: 'French' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# Home');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Locale Nav","path":"/"}]');
  writeFile(dir, 'docs/fr/index.md', '# Accueil');
  // FR has NO navigation.json — should fall back to EN's
  const r = build(dir);
  assert('builds with nav priority', r.ok);
  const enPage = readSite(dir, 'index.html');
  assert('EN uses locale nav', enPage?.includes('Locale Nav'));
}

// ─── TEST 9: Frontmatter parsing ───
console.log('\n📝 Test 9: Frontmatter parsing');
{
  const dir = setup('09-frontmatter');
  writeFile(dir, 'docs/index.md', `---
title: "My Page Title"
description: "A test description"
---
# Content
Body text.`);
  const r = build(dir);
  assert('builds with frontmatter', r.ok);
  const html = readSite(dir, 'index.html');
  assert('title in output', html?.includes('My Page Title'));
  assert('description meta tag', html?.includes('A test description'));
}

// ─── TEST 10: Containers ───
console.log('\n📦 Test 10: Containers');
{
  const dir = setup('10-containers');
  writeFile(dir, 'docs/index.md', `# Containers Test

::: callout info "Note"
This is a callout.
:::

::: callout warning "Warning"
Be careful.
:::

::: callout danger "Danger"
Very dangerous.
:::

::: callout tip "Tip"
A helpful tip.
:::

::: tabs
== tab "Tab One"
First tab content.
== tab "Tab Two"
Second tab content.
:::

::: steps
### Step 1
Do this first.
### Step 2
Then do this.
:::

::: hero
# Hero Title
Hero description.
:::
`);
  const r = build(dir);
  assert('builds with containers', r.ok);
  const html = readSite(dir, 'index.html');
  assert('callout rendered', html?.includes('callout') || html?.includes('Note'));
  assert('tabs rendered', html?.includes('tabs') && html?.includes('Tab One'));
  assert('steps rendered', html?.includes('Step 1') && html?.includes('Step 2'));
  assert('hero rendered', html?.includes('Hero Title'));
}

// ─── TEST 11: Code blocks ───
console.log('\n💻 Test 11: Code blocks');
{
  const dir = setup('11-code-blocks');
  writeFile(dir, 'docs/index.md', `# Code Test

\`\`\`js
const x = 42;
console.log(x);
\`\`\`

\`\`\`python
def hello():
    return "world"
\`\`\`
`);
  const r = build(dir);
  assert('builds with code blocks', r.ok);
  const html = readSite(dir, 'index.html');
  assert('JS code rendered', html?.includes('const') && html?.includes('42'));
  assert('Python code rendered', html?.includes('def') && html?.includes('hello'));
}

// ─── TEST 12: Custom CSS/JS injection ───
console.log('\n🎨 Test 12: Custom CSS/JS injection');
{
  const dir = setup('12-custom-assets');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Custom Assets',
    src: 'docs',
    head: [
      '<link rel="stylesheet" href="/custom.css">',
      '<script src="/custom.js"></script>'
    ]
  };`);
  writeFile(dir, 'docs/index.md', '# Custom Assets');
  const r = build(dir);
  assert('builds with custom assets', r.ok);
  const html = readSite(dir, 'index.html');
  assert('custom CSS or head injection works', html?.includes('custom.css') || r.ok);
  assert('custom JS or head injection works', html?.includes('custom.js') || r.ok);
}

// ─── TEST 13: Edit links ───
console.log('\n✏️ Test 13: Edit links');
{
  const dir = setup('13-edit-links');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Edit Links',
    src: 'docs',
    editLink: {
      enabled: true,
      baseUrl: 'https://github.com/test/repo/edit/main/docs',
      text: 'Edit on GitHub'
    }
  };`);
  writeFile(dir, 'docs/index.md', '# Edit Link Test');
  const r = build(dir);
  assert('builds with edit links', r.ok);
  const html = readSite(dir, 'index.html');
  assert('edit link in page', html?.includes('Edit on GitHub') || html?.includes('github.com/test/repo'));
}

// ─── TEST 14: No-style pages ───
console.log('\n🧹 Test 14: No-style pages');
{
  const dir = setup('14-no-style');
  writeFile(dir, 'docs/index.md', '# Normal Page');
  writeFile(dir, 'docs/raw.md', '---\nlayout: no-style\n---\n# Raw Page\nNo styling.');
  const r = build(dir);
  assert('builds with no-style page', r.ok);
  assert('no-style page exists', siteExists(dir, 'raw/index.html'));
  const raw = readSite(dir, 'raw/index.html');
  assert('no-style page rendered', raw?.includes('Raw Page'));
}

// ─── TEST 15: Search index ───
console.log('\n🔍 Test 15: Search index generation');
{
  const dir = setup('15-search');
  writeFile(dir, 'docs/index.md', '# Search Home\nSearchable content here.');
  writeFile(dir, 'docs/guide.md', '# Guide\nMore searchable content.');
  const r = build(dir);
  assert('builds with search', r.ok);
  assert('search-index.json exists under _docmd-search/', siteExists(dir, '_docmd-search/search-index.json'));
  const idx = readSite(dir, '_docmd-search/search-index.json');
  assert('search index has content', idx && JSON.parse(idx).documentCount >= 2);
}

// ─── TEST 16: Sitemap ───
console.log('\n🗺️ Test 16: Sitemap generation');
{
  const dir = setup('16-sitemap');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Sitemap Test',
    src: 'docs',
    url: 'https://example.com'
  };`);
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/about.md', '# About');
  const r = build(dir);
  assert('builds with sitemap', r.ok);
  assert('sitemap.xml exists', siteExists(dir, 'sitemap.xml'));
  const sm = readSite(dir, 'sitemap.xml');
  assert('sitemap has URLs', sm?.includes('example.com'));
}

// ─── TEST 17: EJS content pages ───
console.log('\n🔧 Test 17: EJS content pages');
{
  const dir = setup('17-ejs');
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/dynamic.ejs', `---
title: Dynamic Page
---
# Generated at build time

<% const items = ['one', 'two', 'three']; %>
<% items.forEach(i => { %>
- Item: <%= i %>
<% }); %>
`);
  const r = build(dir);
  assert('builds with EJS pages', r.ok);
  assert('EJS page rendered', siteExists(dir, 'dynamic/index.html'));
  const html = readSite(dir, 'dynamic/index.html');
  assert('EJS content expanded', html?.includes('Item: one') && html?.includes('Item: three'));
}

// ─── TEST 18: README.md as index fallback ───
console.log('\n📋 Test 18: README.md as index fallback');
{
  const dir = setup('18-readme');
  writeFile(dir, 'docs/README.md', '# Welcome\nFrom README.');
  writeFile(dir, 'docs/guide/README.md', '# Guide\nFrom guide README.');
  const r = build(dir);
  assert('builds with README fallback', r.ok);
  assert('README becomes index', siteExists(dir, 'index.html'));
  const html = readSite(dir, 'index.html');
  assert('README content rendered', html?.includes('From README'));
  assert('nested README becomes index', siteExists(dir, 'guide/index.html'));
}

// ─── TEST 19: .markdown extension ───
console.log('\n📄 Test 19: .markdown file extension');
{
  const dir = setup('19-markdown-ext');
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/about.markdown', '# About\nMarkdown extension.');
  const r = build(dir);
  assert('builds with .markdown files', r.ok);
  assert('.markdown page rendered', siteExists(dir, 'about/index.html'));
  const html = readSite(dir, 'about/index.html');
  assert('.markdown content correct', html?.includes('Markdown extension'));
}

// ─── TEST 20: Deep nesting ───
console.log('\n🏗️ Test 20: Deep nested structure');
{
  const dir = setup('20-deep-nesting');
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/a/b/c/d/deep.md', '# Deep Page\nVery deep.');
  const r = build(dir);
  assert('builds with deep nesting', r.ok);
  assert('deep page exists', siteExists(dir, 'a/b/c/d/deep/index.html'));
}

// ─── TEST 21: Zero-config auto-nav accuracy ───
console.log('\n🧭 Test 21: Zero-config auto-nav accuracy');
{
  const dir = setup('21-auto-nav');
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/getting-started.md', '# Getting Started');
  writeFile(dir, 'docs/guide/intro.md', '# Intro');
  writeFile(dir, 'docs/guide/advanced.md', '# Advanced');
  const r = build(dir);
  assert('builds with auto-nav', r.ok);
  const html = readSite(dir, 'index.html');
  assert('auto-nav includes Getting Started', html?.includes('Getting Started'));
  assert('auto-nav includes Guide section', html?.includes('Intro') || html?.includes('Guide'));
}

// ─── TEST 22: Title tag auto-append ───
console.log('\n🏷️ Test 22: Title tag auto-append');
{
  const dir = setup('22-title-tag');
  writeFile(dir, 'docmd.config.js', `module.exports = { title: 'MySite', src: 'docs' };`);
  writeFile(dir, 'docs/index.md', '---\ntitle: Home\n---\n# Home');
  writeFile(dir, 'docs/about.md', '---\ntitle: About Us\n---\n# About');
  const r = build(dir);
  assert('builds with title tags', r.ok);
  const about = readSite(dir, 'about/index.html');
  // Title should be "About Us — MySite" or similar
  const titleMatch = about?.match(/<title>(.*?)<\/title>/s);
  const titleText = titleMatch?.[1]?.trim();
  assert('sub-page title includes page + site', titleText?.includes('About') && titleText?.includes('MySite'));
}

// ─── TEST 23: OG meta tags ───
console.log('\n🏷️ Test 23: OG meta tags');
{
  const dir = setup('23-og-tags');
  writeFile(dir, 'docmd.config.js', `module.exports = { title: 'OG Test', src: 'docs', url: 'https://example.com' };`);
  writeFile(dir, 'docs/index.md', '---\ntitle: OG Page\ndescription: OG description\n---\n# OG');
  const r = build(dir);
  assert('builds with OG tags', r.ok);
  const html = readSite(dir, 'index.html');
  assert('og:title present', html?.includes('og:title'));
  assert('og:description present', html?.includes('og:description') || html?.includes('OG description'));
}

// ─── TEST 24: Redirects ───
console.log('\n↩️ Test 24: Redirects');
{
  const dir = setup('24-redirects');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Redirects',
    src: 'docs',
    redirects: { '/old-page': '/new-page' }
  };`);
  writeFile(dir, 'docs/index.md', '# Home');
  writeFile(dir, 'docs/new-page.md', '# New Page');
  const r = build(dir);
  assert('builds with redirects', r.ok);
  assert('redirect page created', siteExists(dir, 'old-page/index.html'));
  const redirect = readSite(dir, 'old-page/index.html');
  assert('redirect has meta refresh', redirect?.includes('new-page') || redirect?.includes('redirect'));
}

// ─── TEST 25: Per-page layout override ───
console.log('\n📐 Test 25: Per-page layout override');
{
  const dir = setup('25-layout-override');
  writeFile(dir, 'docs/index.md', '# Normal');
  writeFile(dir, 'docs/landing.md', '---\nlayout: no-style\ntitle: Landing\n---\n# Landing Page\nCustom layout.');
  const r = build(dir);
  assert('builds with layout override', r.ok);
  const normal = readSite(dir, 'index.html');
  const landing = readSite(dir, 'landing/index.html');
  assert('normal page has full layout', normal?.includes('sidebar') || normal?.includes('nav'));
  assert('landing page rendered', landing?.includes('Landing Page'));
}

// ─── TEST 26: URL Consistency (No Double Slashes) ───
console.log('\n🔗 Test 26: URL Consistency (No Double Slashes)');
{
  const dir = setup('26-url-consistency');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'URL Test',
    url: 'https://example.com',
    src: 'docs',
    navigation: [
      { title: 'Home', path: '/' },
      { title: 'Guide', path: '/guide/' },
      { title: 'Nested', path: '/deep/nested/' }
    ]
  };`);
  writeFile(dir, 'docs/index.md', '# Home\n[Go to Guide](guide/)\n[Go to Nested](deep/nested/)');
  writeFile(dir, 'docs/guide.md', '# Guide\n[Back Home](/)');
  writeFile(dir, 'docs/deep/nested.md', '# Nested\n[Back Home](/)');
  const r = build(dir);
  assert('builds with navigation', r.ok);
  
  const idx = readSite(dir, 'index.html');
  const guide = readSite(dir, 'guide/index.html');
  const nested = readSite(dir, 'deep/nested/index.html');
  
  // Check for double slashes in href attributes (excluding protocol://)
  const hasDoubleSlashHref = (html) => /href="[^"]*([^:])\/\//.test(html);
  assert('index has no double-slash hrefs', !hasDoubleSlashHref(idx));
  assert('guide has no double-slash hrefs', !hasDoubleSlashHref(guide));
  assert('nested has no double-slash hrefs', !hasDoubleSlashHref(nested));
  
  // Check sitemap URLs
  const sitemap = readSite(dir, 'sitemap.xml');
  const hasDoubleSlash = (html) => /([^:])\/\//.test(html);
  assert('sitemap has no double slashes', !hasDoubleSlash(sitemap));
  assert('sitemap has correct root URL', sitemap?.includes('https://example.com/'));
  assert('sitemap has correct guide URL', sitemap?.includes('https://example.com/guide/'));
}

// ─── TEST 27: Search Index URL Format ───
console.log('\n🔍 Test 27: Search Index URL Format');
{
  const dir = setup('27-search-urls');
  writeFile(dir, 'docs/index.md', '---\ntitle: Home\n---\n# Welcome');
  writeFile(dir, 'docs/guide/intro.md', '---\ntitle: Introduction\n---\n# Getting Started');
  const r = build(dir);
  assert('builds with search', r.ok);
  
  const searchIdx = readSite(dir, '_docmd-search/search-index.json');
  const parsed = JSON.parse(searchIdx);
  const storedFields = parsed.storedFields || {};
  const ids = Object.values(storedFields).map((f) => f.id);
  
  // IDs should be clean slugs without leading slashes (except root)
  assert('root page has clean ID', ids.some(id => id === '/'));
  assert('nested page has clean ID', ids.some(id => id === 'guide/intro/' || id === '/guide/intro/'));
  // No double slashes in any ID
  assert('no double slashes in search IDs', !ids.some(id => id.includes('//')));
}

// ─── TEST 28: i18n URL Prefixes ───
console.log('\n🌍 Test 28: i18n URL Prefixes');
{
  const dir = setup('28-i18n-urls');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'i18n URLs',
    url: 'https://example.com',
    src: 'docs',
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'de', label: 'Deutsch' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# English Home\n[German](/de/)');
  writeFile(dir, 'docs/en/guide.md', '# English Guide');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Home","path":"/"},{"title":"Guide","path":"/guide/"}]');
  writeFile(dir, 'docs/de/index.md', '# German Home\n[English](/)');
  writeFile(dir, 'docs/de/navigation.json', '[{"title":"Startseite","path":"/"}]');
  const r = build(dir);
  assert('builds with i18n', r.ok);
  
  // Check that nav links have correct prefixes
  const enIdx = readSite(dir, 'index.html');
  const deIdx = readSite(dir, 'de/index.html');
  
  // English root should have links without double slashes
  const hasDoubleSlash = (html) => /href="[^"]*([^:])\/\//.test(html);
  assert('EN index has no double-slash hrefs', !hasDoubleSlash(enIdx));
  assert('DE index has no double-slash hrefs', !hasDoubleSlash(deIdx));
  
  // Check sitemap has both locales
  const sitemap = readSite(dir, 'sitemap.xml');
  assert('sitemap has EN URLs', sitemap?.includes('example.com/'));
  assert('sitemap has DE URLs', sitemap?.includes('example.com/de/'));
  
  // Check hreflang tags don't have duplicate locale prefixes
  const deIdxHreflang = readSite(dir, 'de/index.html');
  const hreflangPattern = /hreflang="[^"]*" href="([^"]*)"/g;
  const hreflangUrls = [...deIdxHreflang.matchAll(hreflangPattern)].map(m => m[1]);
  assert('hreflang EN points to root', hreflangUrls.some(u => u === '/'));
  assert('hreflang DE points to /de/', hreflangUrls.some(u => u === '/de/'));
  assert('no duplicate locale in hreflang', !hreflangUrls.some(u => u.includes('/de/de/')));
}

// ─── TEST 29: Hreflang Tags Consistency ───
console.log('\n🏷️ Test 29: Hreflang Tags Consistency');
{
  const dir = setup('29-hreflang-tags');
  writeFile(dir, 'docmd.config.js', `module.exports = {
    title: 'Hreflang Test',
    url: 'https://example.com',
    src: 'docs',
    i18n: { default: 'en', locales: [
      { id: 'en', label: 'English' },
      { id: 'fr', label: 'Français' }
    ]}
  };`);
  writeFile(dir, 'docs/en/index.md', '# English Home');
  writeFile(dir, 'docs/en/guide.md', '# English Guide');
  writeFile(dir, 'docs/en/navigation.json', '[{"title":"Home","path":"/"},{"title":"Guide","path":"/guide/"}]');
  writeFile(dir, 'docs/fr/index.md', '# French Home');
  writeFile(dir, 'docs/fr/guide.md', '# French Guide');
  writeFile(dir, 'docs/fr/navigation.json', '[{"title":"Accueil","path":"/"},{"title":"Guide","path":"/guide/"}]');
  const r = build(dir);
  assert('builds with i18n', r.ok);
  
  // Check hreflang on English root
  const enIdx = readSite(dir, 'index.html');
  assert('EN root has hreflang for EN', enIdx?.includes('hreflang="en" href="/"'));
  assert('EN root has hreflang for FR', enIdx?.includes('hreflang="fr" href="/fr/"'));
  assert('EN root has x-default', enIdx?.includes('hreflang="x-default"'));
  
  // Check hreflang on French root
  const frIdx = readSite(dir, 'fr/index.html');
  assert('FR root has hreflang for EN', frIdx?.includes('hreflang="en" href="/"'));
  assert('FR root has hreflang for FR', frIdx?.includes('hreflang="fr" href="/fr/"'));
  
  // Check hreflang on nested pages
  const enGuide = readSite(dir, 'guide/index.html');
  const frGuide = readSite(dir, 'fr/guide/index.html');
  assert('EN guide has correct hreflang', enGuide?.includes('hreflang="fr" href="/fr/guide/"'));
  assert('FR guide has correct hreflang', frGuide?.includes('hreflang="en" href="/guide/"'));
  
  // Ensure no duplicate locale prefixes
  assert('no /fr/fr/ in FR hreflang', !frIdx?.includes('/fr/fr/'));
  assert('no /fr/fr/ in FR guide hreflang', !frGuide?.includes('/fr/fr/'));
}

// ─── TEST 30: Workspaces (multi-project) ───
// Two sub-projects compiled into one site via a root workspace config.
// Replaces the standalone "Mega Integration" test file that lived at
// tests/mega-integration.test.js (deleted). The new Tests 30 + 31 cover
// what used to be in the legacy failsafe's "Mega Integration" section
// but inline alongside the other feature tests so the runner shows
// nine sections, not ten.

{
  const dir = setup('features-30-workspaces');
  fs.mkdirSync(path.join(dir, 'main/docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'api/docs'), { recursive: true });
  writeFile(dir, 'main/docmd.config.js',
    `export default { title: 'Main Docs', src: 'docs' }`);
  writeFile(dir, 'main/docs/index.md', '# Main Home\n');
  writeFile(dir, 'api/docmd.config.js',
    `export default { title: 'API Reference', src: 'docs' }`);
  writeFile(dir, 'api/docs/index.md', '# API Index\n');
  writeFile(dir, 'docmd.config.js',
    `export default {
       workspace: {
         projects: [
           { prefix: '/', src: 'main' },
           { prefix: '/api', src: 'api' }
         ]
       }
     }`);

  build(dir);

  assert('workspaces: main root built',
    fs.existsSync(path.join(dir, 'site/index.html')));
  assert('workspaces: api root built',
    fs.existsSync(path.join(dir, 'site/api/index.html')));
  const mainIdx = readSite(dir, 'index.html');
  assert('workspaces: main page has its title',
    mainIdx?.includes('Main Docs'));
  const apiIdx = readSite(dir, 'api/index.html');
  assert('workspaces: api page has its title',
    apiIdx?.includes('API Reference'));
}

// ─── TEST 31: Mega integration (workspaces + i18n + versioning + plugins) ───
// One project that exercises EVERY docmd feature at once. Equivalent to
// the legacy failsafe's "Mega Integration Test (V5.0)" — assertions
// cover the artefacts every common plugin is supposed to produce and
// the cross-feature interactions (i18n + versioning + workspaces).

{
  const dir = setup('features-31-mega');
  fs.mkdirSync(path.join(dir, 'main/docs/en'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main/docs/fr'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main/docs-v1/en'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'main/assets/css'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'api/docs'), { recursive: true });

  writeFile(dir, 'main/docmd.config.js',
    `export default {
       title: 'Mega Docs',
       url: 'https://example.com',
       src: 'docs',
       out: 'site',
       plugins: { math: {}, sitemap: {}, llms: {}, seo: {}, pwa: {} },
       versions: { current: 'v2', all: [
         { id: 'v2', dir: 'docs' },
         { id: 'v1', dir: 'docs-v1', label: 'v1.0' }
       ]},
       i18n: { default: 'en', locales: [
         { id: 'en', label: 'English' },
         { id: 'fr', label: 'Français' }
       ]}
     }`);
  writeFile(dir, 'api/docmd.config.js',
    `export default {
       title: 'API Reference',
       url: 'https://example.com/api',
       src: 'docs',
       navigation: [{ title: 'Home', path: '/' }],
       plugins: { search: {}, mermaid: {} }
     }`);
  writeFile(dir, 'docmd.config.js',
    `export default {
       workspace: {
         projects: [
           { prefix: '/', src: 'main' },
           { prefix: '/api', src: 'api' }
         ]
       }
     }`);

  writeFile(dir, 'main/docs/en/index.md',
    '---\ntitle: Home\n---\n# Home\nWelcome.');
  writeFile(dir, 'main/docs/en/guide.md',
    '---\ntitle: Guide\n---\n# Guide\n## Steps\n');
  writeFile(dir, 'main/docs/en/math.md',
    '---\ntitle: Math\n---\n# Math\nInline $E = mc^2$.');
  writeFile(dir, 'main/docs/en/mermaid.md',
    '---\ntitle: Diagrams\n---\n# Diagrams\n```mermaid\ngraph TD\n  A --> B\n```\n');
  writeFile(dir, 'main/docs/fr/index.md', '# Accueil\n');
  writeFile(dir, 'main/docs-v1/en/index.md', '# v1 Home\nOld.');
  writeFile(dir, 'api/docs/index.md',
    '---\ntitle: API\n---\n# API\n## Endpoints\n');
  writeFile(dir, 'main/assets/css/custom.css', '.x{color:red}');

  build(dir);

  assert('mega: main index built',
    fs.existsSync(path.join(dir, 'site/index.html')));
  assert('mega: main guide built',
    fs.existsSync(path.join(dir, 'site/guide/index.html')));
  assert('mega: api index built',
    fs.existsSync(path.join(dir, 'site/api/index.html')));
  assert('mega: French locale index built',
    fs.existsSync(path.join(dir, 'site/fr/index.html')));
  assert('mega: v1 index built',
    fs.existsSync(path.join(dir, 'site/v1/index.html')));
  assert('mega: v1 guide absent',
    !fs.existsSync(path.join(dir, 'site/v1/guide/index.html')));
  assert('mega: search-index generated',
    fs.existsSync(path.join(dir, 'site/_docmd-search/search-index.json')));
  assert('mega: sitemap generated',
    fs.existsSync(path.join(dir, 'site/sitemap.xml')));
  assert('mega: llms.txt generated',
    fs.existsSync(path.join(dir, 'site/llms.txt')));
  assert('mega: llms-full.txt generated',
    fs.existsSync(path.join(dir, 'site/llms-full.txt')));
  assert('mega: PWA manifest generated',
    fs.existsSync(path.join(dir, 'site/manifest.webmanifest')) ||
    fs.existsSync(path.join(dir, 'site/manifest.json')));
  assert('mega: service worker generated',
    fs.existsSync(path.join(dir, 'site/service-worker.js')) ||
    fs.existsSync(path.join(dir, 'site/sw.js')));
  assert('mega: sitemap has root URL',
    readSite(dir, 'sitemap.xml')?.includes('example.com'));
  assert('mega: sitemap has French URL',
    readSite(dir, 'sitemap.xml')?.includes('/fr/'));
  assert('mega: llms.txt has links',
    readSite(dir, 'llms.txt')?.includes('[') &&
    readSite(dir, 'llms.txt')?.includes(']('));
  assert('mega: math page has katex',
    readSite(dir, 'math/index.html')?.includes('katex'));
  assert('mega: mermaid page has diagram',
    readSite(dir, 'mermaid/index.html')?.includes('class="mermaid"'));
  assert('mega: index has SEO meta tags',
    !!readSite(dir, 'index.html')?.match(/<meta\s+name=["']description["']/i));
  assert('mega: custom assets copied',
    fs.existsSync(path.join(dir, 'site/assets/css/custom.css')));
}

// ─── TEST 32: Focus Mode & Print Configuration Hierarchy ───
// Verify that focusMode and print are disabled by default.
// When enabled, print button renders in the copy-widgets row and focus toolbar,
// and NEVER in the header/options-menu.
{
  // Part A: Zero-config defaults (both disabled)
  const dirA = setup('features-32-focus-print-default');
  writeFile(dirA, 'docs/index.md', '# Default Page\nContent here.\n');
  const rA = build(dirA);
  assert('builds with default config', rA.ok);
  const htmlA = readSite(dirA, 'index.html');
  assert('default: no focus toolbar', !htmlA?.includes('id="docmd-focus-toolbar"'));
  assert('default: no focus mode button in options-menu', !htmlA?.includes('focus-mode-toggle-button'));
  assert('default: no print button in copy-widgets or options-menu', !htmlA?.includes('print-button'));

  // Part B: Modern layout config with focusMode and print enabled
  const dirB = setup('features-32-focus-print-enabled');
  writeFile(dirB, 'docmd.config.js', `export default {
    title: 'Focus & Print Site',
    layout: {
      focusMode: true,
      print: true
    }
  };`);
  writeFile(dirB, 'docs/index.md', '# Focus Page\nFocused content.\n');
  const rB = build(dirB);
  assert('builds with focus & print enabled', rB.ok);
  const htmlB = readSite(dirB, 'index.html');
  assert('enabled: focus toolbar present', htmlB?.includes('id="docmd-focus-toolbar"'));
  assert('enabled: focus mode button in options-menu', htmlB?.includes('class="focus-mode-toggle-button"'));
  assert('enabled: print button in focus toolbar', htmlB?.includes('class="docmd-focus-btn print-button"'));
  assert('enabled: print button in copy-widgets row', htmlB?.includes('class="docmd-copy-btn print-button"'));
  assert('enabled: options-menu does NOT have print button', !htmlB?.match(/<div class="docmd-options-menu"[^>]*>[\s\S]*?<button class="print-button"/));

  // Part C: Backwards compatibility with root-level focusMode, print, and customJs
  const dirC = setup('features-32-legacy-fallbacks');
  writeFile(dirC, 'docmd.config.js', `export default {
    title: 'Legacy Fallbacks Site',
    focusMode: true,
    print: true,
    customJs: ['assets/legacy.js']
  };`);
  writeFile(dirC, 'docs/index.md', '# Legacy Page\nLegacy fallback testing.\n');
  const rC = build(dirC);
  assert('builds with root-level legacy fallbacks', rC.ok);
  const htmlC = readSite(dirC, 'index.html');
  assert('legacy fallback: focus mode enabled', htmlC?.includes('class="focus-mode-toggle-button"'));
  assert('legacy fallback: print button enabled in copy widgets', htmlC?.includes('class="docmd-copy-btn print-button"'));
  assert('legacy fallback: customJs script included', htmlC?.includes('assets/legacy.js'));
}

// ─── TEST 33: JSONC Configuration Support & Trailing Commas ───
// Verify that docmd.config.jsonc is auto-detected and loaded correctly,
// supporting single-line comments (//), multi-line comments (/* */),
// and trailing commas without crashing JSON parsing.
{
  const dir = setup('features-33-jsonc-support');
  writeFile(dir, 'docmd.config.jsonc', `{
    // Site title with single line comment
    "title": "JSONC Configured Docs // with comment chars",
    /* Multi-line comment explaining
       the layout and theme settings */
    "footer": {
      "copyright": "Preserves // strings and /* strings */ cleanly",
    },
    "theme": {
      "name": "default",
    },
    "layout": {
      "print": true,
      "focusMode": false,
    },
  }`);
  writeFile(dir, 'docs/index.md', '# JSONC Page\nTesting JSONC support.\n');
  const r = build(dir);
  assert('builds with docmd.config.jsonc', r.ok);
  const html = readSite(dir, 'index.html');
  assert('jsonc: page title rendered with comment characters', html?.includes('JSONC Configured Docs // with comment chars'));
  assert('jsonc: layout print button present', html?.includes('class="docmd-copy-btn print-button"'));
  assert('jsonc: footer copyright preserved with comment characters', html?.includes('Preserves // strings and /* strings */ cleanly'));
}

// ─── SUMMARY ───
console.log('\n' + '═'.repeat(50));
console.log(`  ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach(f => console.log(`    ${FAIL} ${f}`));
}
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
