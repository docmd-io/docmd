/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Plugin asset pipeline — async/await + capability regression tests
 *
 * Covers the regression bugs that broke plugin CSS/JS loading
 * after the Slice C.1+C.2 safeCall refactor:
 *
 *   PAA-1  getAssets consumer in core/src/commands/build.ts must
 *          await the async wrapper around getAssetsFn. Without the
 *          await, `assets` is a Promise and `Array.isArray(assets)`
 *          is false, so every plugin's `src`/`dest` copy is silently
 *          skipped — search, git, mermaid, math, openapi CSS/JS never
 *          land in site/assets/.
 *
 *   PAA-2  getAssets consumer in core/src/engine/generator.ts must
 *          await the same wrapper. Without the await, no <script>
 *          or <link> tag is ever added to the page <head>/<body>,
 *          so even if a file exists in the source tree it never
 *          gets loaded by the browser.
 *
 *   PAA-3  Plugin `assets` capability is the right key in the
 *          registerPlugin gate (a previous local edit had `'assets'`
 *          being passed to hasCapabilityForHook which expects a hook
 *          name; the gate then returned false and every plugin's
 *          getAssets was skipped with a "didn't declare" warning).
 *
 *   PAA-4  One immutable, normalized asset snapshot drives copying,
 *          page tags, and post-build integrations. This prevents a
 *          stateful getAssets hook from returning different files to
 *          different stages of the same build.
 *
 *   PAA-5  A live-server build (`buildSite(..., { liveServer: true })`,
 *          what `docmd serve` with actions on runs) keeps the client
 *          assets of plugins that require a live server and ships the
 *          docmd-api.js bridge; a plain `docmd build` does neither.
 *
 * Uses the built-in @docmd/plugin-search, plugin-git, plugin-mermaid,
 * plugin-math, plugin-openapi as the test subjects because their
 * getAssets hooks cover the full matrix (local-copy src/dest, CDN
 * url, conditional pageHtmlMatches).
 *
 * Run: `node tests/runner.js --only=plugin-assets-pipeline`
 * --------------------------------------------------------------------
 */

import {
  setup,
  writeFile,
  build,
  readSite,
  runTestFile
} from '../shared.js';
import fs from 'node:fs';
import path from 'path';

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
  name: 'Plugin asset pipeline (resolution + capability)',
  emoji: '🧩',
  run: async () => {

    // PAA-1: plugin assets with `src`/`dest` get copied to site/.
    // The search plugin ships `assets/js/docmd-search.js` (src/dest).
    {
      const proj = setup('plugin-assets-pipeline-paa1-copy');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'PAA-1',
        src: './docs',
        out: './site',
        plugins: { search: {} }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'PAA-1: build succeeds with the search plugin');
      assert(fs.existsSync(path.join(proj, 'site/assets/js/docmd-search.js')),
        'PAA-1: search plugin getAssets src/dest is copied to site/assets/js/docmd-search.js');
      // PAA-3: the search plugin declares the assets capability in its
      // descriptor. A correct gate must NOT print the "didn't declare"
      // warning; a buggy gate (one that passed the wrong key to
      // hasCapabilityForHook) would.
      assert(!/didn't declare "assets" capability/.test(result.output),
        'PAA-3: no "didn\'t declare assets capability" warning for a plugin that declares it');
    }

    // PAA-2: a plugin's CDN-style `url` asset becomes a real <link> or
    // <script> tag in the rendered HTML, AND a local-copy src/dest
    // asset becomes a real <script src="./assets/..."> tag. This proves
    // the generator's loop awaits the async hook and pushes the tag
    // into the right bucket.
    {
      const proj = setup('plugin-assets-pipeline-paa2-link');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'PAA-2',
        src: './docs',
        out: './site',
        plugins: {
          search: { semantic: false },
          git: { repo: 'https://github.com/docmd-io/docmd' },
          math: {}
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'PAA-2: build succeeds with search + git + math');
      const htmlPath = path.join(proj, 'site/index.html');
      assert(fs.existsSync(htmlPath), 'PAA-2: site/index.html generated');
      const html = fs.readFileSync(htmlPath, 'utf8');

      // search: MiniSearch is now bundled locally (assets/js/vendor/)
      // instead of loaded from a CDN, so keyword search works in
      // air-gapped / CDN-blocked environments.
      assert(/<script[^>]+src="[^"]*assets\/js\/vendor\/minisearch\.js/.test(html),
        'PAA-2: search plugin local MiniSearch <script> tag emitted');
      assert(/<script[^>]+src="\.\/assets\/js\/docmd-search\.js/.test(html),
        'PAA-2: search plugin local-copy <script src="./assets/js/docmd-search.js"> tag emitted');

      // git: local docmd-git.js + docmd-git.css
      assert(/<script[^>]+src="\.\/assets\/js\/docmd-git\.js/.test(html),
        'PAA-2: git plugin local-copy <script src="./assets/js/docmd-git.js"> tag emitted');
      assert(/<link[^>]+href="\.\/assets\/css\/docmd-git\.css/.test(html),
        'PAA-2: git plugin local-copy <link href="./assets/css/docmd-git.css"> tag emitted');
    }

    // PAA-2b: when a page DOES contain math, the math plugin's
    // conditional CDN link is emitted (proves the condition filter
    // and the awaited loop cooperate).
    {
      const proj = setup('plugin-assets-pipeline-paa2b-conditional');
      writeFile(proj, 'docs/index.md', '# Math\n\n$$\\int_0^1 x^2 dx$$\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'PAA-2b',
        src: './docs',
        out: './site',
        plugins: { math: {} }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'PAA-2b: build succeeds with the math plugin');
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(/<link[^>]+href="https:\/\/cdn\.jsdelivr\.net\/npm\/katex/.test(html),
        'PAA-2b: math plugin conditional CDN <link> emitted on a page with math content');
    }

    // PAA-1b: all four plugin asset files actually land on disk in
    // site/ (the copy half of the pipeline).
    {
      const proj = setup('plugin-assets-pipeline-paa1b-all-files');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'PAA-1b',
        src: './docs',
        out: './site',
        plugins: {
          search: { semantic: true },
          git: { repo: 'https://github.com/docmd-io/docmd' },
          mermaid: {},
          openapi: {}
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'PAA-1b: build succeeds with search+git+mermaid+openapi');
      const copied = [
        'assets/js/docmd-search.js',
        'assets/js/docmd-git.js',
        'assets/css/docmd-git.css',
        'assets/css/docmd-openapi.css',
        '_docmd-search/docmd-search-client.js'  // semantic mode drop
      ];
      for (const rel of copied) {
        assert(fs.existsSync(path.join(proj, 'site', rel)),
          `PAA-1b: ${rel} is present in site/ after the build`);
      }
    }

    // PAA-4: one deliberately stateful async hook covers the relationships
    // that matter. Before assets were resolved once, its first call supplied
    // copied files while a later call supplied different page URLs.
    {
      const proj = setup('plugin-assets-pipeline-paa4-resolved-snapshot');
      writeFile(proj, 'docs/index.md', '# Plain page\n');
      writeFile(proj, 'docs/feature.md', [
        '---',
        'feature: true',
        '---',
        '# Feature page',
        ''
      ].join('\n'));
      writeFile(proj, 'docs/nested/index.md', '# Widget page\n\n<div data-widget>widget</div>\n');
      writeFile(proj, 'plugins/asset-observer/canonical.js', 'window.canonicalAsset = true;\n');
      writeFile(proj, 'plugins/asset-observer/legacy.css', '.legacy-asset { color: inherit; }\n');
      writeFile(proj, 'plugins/asset-observer/payload.json', '{"fixture":true}\n');
      writeFile(proj, 'plugins/asset-observer/package.json', JSON.stringify({
        name: 'asset-observer', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/asset-observer/index.js', [
        "import fs from 'node:fs/promises';",
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        '',
        "const here = path.dirname(fileURLToPath(import.meta.url));",
        'let calls = 0;',
        'let coreAssetsReady = false;',
        "export const plugin = { name: 'asset-observer', version: '1.0.0', capabilities: ['assets', 'post-build'] };",
        'export async function getAssets() {',
        '  calls += 1;',
        "  coreAssetsReady = await fs.access(path.join(here, '../../site/assets/css/docmd-main.css')).then(() => true, () => false);",
        '  return [',
        "    { path: path.join(here, 'canonical.js'), url: `assets/js/canonical-${calls}.js`, type: 'js', position: 'body', attributes: { type: 'module' }, condition: { frontmatterHas: 'feature' } },",
        "    { src: path.join(here, 'legacy.css'), dest: 'assets/css/legacy.css', type: 'css' },",
        "    { src: path.join(here, 'payload.json'), dest: 'assets/data/payload.json', type: 'static', location: 'none' },",
        "    { url: 'https://assets.example.invalid/widget.css', type: 'css', position: 'head', condition: { pageHtmlMatches: ['data-widget', 'data-other-widget'] } },",
        "    { url: 'https://assets.example.invalid/suppressed.js', type: 'js', location: 'none' }",
        '  ];',
        '}',
        'export async function onPostBuild(ctx) {',
        '  const deeplyFrozen = Object.isFrozen(ctx.resolvedAssets) && ctx.resolvedAssets.every((asset) =>',
        '    Object.isFrozen(asset) && Object.isFrozen(asset.provider) &&',
        '    (!asset.attributes || Object.isFrozen(asset.attributes)) &&',
        '    (!asset.condition || (Object.isFrozen(asset.condition) &&',
        '      (!Array.isArray(asset.condition.pageHtmlMatches) || Object.isFrozen(asset.condition.pageHtmlMatches))))',
        '  );',
        '  let itemMutationRejected = false;',
        '  let bindingMutationRejected = false;',
        '  try { ctx.resolvedAssets.push(null); } catch { itemMutationRejected = true; }',
        '  try { ctx.resolvedAssets = []; } catch { bindingMutationRejected = true; }',
        "  await fs.writeFile(path.join(ctx.outputDir, 'asset-observer.json'), JSON.stringify({ calls, coreAssetsReady, deeplyFrozen, itemMutationRejected, bindingMutationRejected, resolvedAssets: ctx.resolvedAssets }, null, 2));",
        '}',
        ''
      ].join('\n'));
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'PAA-4',
        src: './docs',
        out: './site',
        theme: { template: 'summer' },
        plugins: { './plugins/asset-observer': {} }
      }, null, 2) + '\n');

      const result = build(proj);
      const reportPath = path.join(proj, 'site/asset-observer.json');
      assert(result.ok && fs.existsSync(reportPath), 'PAA-4: representative build exposes an asset snapshot');

      const report = JSON.parse(readSite(proj, 'asset-observer.json'));
      const observed = report.resolvedAssets.filter((asset) => asset.provider.name === 'asset-observer');
      const outputPaths = observed.filter((asset) => asset.kind === 'file').map((asset) => asset.outputPath);
      assert(report.calls === 1 && report.coreAssetsReady && outputPaths.includes('assets/js/canonical-1.js') && !outputPaths.includes('assets/js/canonical-2.js'),
        'PAA-4: async getAssets runs once at the existing copy-stage boundary');
      assert(outputPaths.every((outputPath) => fs.existsSync(path.join(proj, 'site', outputPath))),
        'PAA-4: every resolved local asset was copied to its declared output path');
      assert(observed.find((asset) => asset.outputPath === 'assets/css/legacy.css')?.position === 'body',
        'PAA-4: legacy assets retain their historical body default');

      const plainHtml = readSite(proj, 'index.html');
      const featureHtml = readSite(proj, 'feature/index.html');
      const widgetHtml = readSite(proj, 'nested/index.html');
      assert(!plainHtml.includes('canonical-1.js') && /<script[^>]+src="\.\.\/assets\/js\/canonical-1\.js[^>]+type="module"/.test(featureHtml) && !widgetHtml.includes('canonical-1.js'),
        'PAA-4: canonical local asset and attributes are injected only on the opted-in page');
      const widgetHead = widgetHtml.slice(0, widgetHtml.indexOf('</head>'));
      assert(!plainHtml.includes('widget.css') && !featureHtml.includes('widget.css') && widgetHead.includes('assets.example.invalid/widget.css'),
        'PAA-4: canonical URL position and condition are applied per page');
      assert(observed.find((asset) => asset.url?.endsWith('/suppressed.js'))?.position === 'none' &&
        [plainHtml, featureHtml, widgetHtml].every((html) => !html.includes('suppressed.js')),
        'PAA-4: legacy location none suppresses a URL-only asset tag');
      assert([plainHtml, featureHtml, widgetHtml].every((html) => !html.includes('payload.json')),
        'PAA-4: copy-only static asset is never injected into a page');

      const summerAssets = report.resolvedAssets.filter((asset) => asset.provider.name === 'template-summer');
      assert(summerAssets.length === 2 && summerAssets.every((asset) => asset.kind === 'file' && fs.existsSync(path.join(proj, 'site', asset.outputPath))),
        'PAA-4: template assets share the same resolved and copied contract');
      assert(report.deeplyFrozen && report.itemMutationRejected && report.bindingMutationRejected && !report.resolvedAssets.some((asset) => asset.outputPath === 'asset-observer.json'),
        'PAA-4: post-build hooks receive an immutable declaration snapshot, not an output manifest');
    }

    // Assets discovery: findFilesRecursive respects .gitignore and config.exclude
    {
      const { findFilesRecursive } = await import('../../packages/core/dist/engine/assets.js');
      const testDir = path.resolve('tests/_tmp_ignore_test_' + Date.now());
      fs.mkdirSync(path.join(testDir, 'docs', 'drafts'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'docs', 'published'), { recursive: true });

      fs.writeFileSync(path.join(testDir, '.gitignore'), 'drafts/\n*.secret.md\n/anchored-root\n# comment\n');
      fs.writeFileSync(path.join(testDir, 'docs', 'drafts', 'wip.md'), '# Draft');
      fs.writeFileSync(path.join(testDir, 'docs', 'published', 'guide.md'), '# Guide');
      fs.writeFileSync(path.join(testDir, 'docs', 'published', 'passwords.secret.md'), '# Secret');
      fs.writeFileSync(path.join(testDir, 'docs', 'published', 'custom-excluded.md'), '# Custom Excluded');
      fs.mkdirSync(path.join(testDir, 'docs', 'anchored-root'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'docs', 'anchored-root', 'skip.md'), '# Should be excluded');

      const foundFiles = await findFilesRecursive(
        path.join(testDir, 'docs'),
        ['.md'],
        ['custom-excluded.md']
      );
      const relativeFound = foundFiles.map(f => path.relative(testDir, f).replace(/\\/g, '/'));

      assert(relativeFound.includes('docs/published/guide.md'), 'findFilesRecursive includes non-ignored markdown file');
      assert(!relativeFound.some(f => f.includes('drafts')), 'findFilesRecursive excludes gitignored folder drafts/');
      assert(!relativeFound.some(f => f.endsWith('.secret.md')), 'findFilesRecursive excludes gitignored pattern *.secret.md');
      assert(!relativeFound.some(f => f.includes('custom-excluded.md')), 'findFilesRecursive excludes custom extraExclude pattern');
      assert(!relativeFound.some(f => f.includes('anchored-root')), 'findFilesRecursive excludes anchored-root folder');

      fs.rmSync(testDir, { recursive: true, force: true });
    }

    // PAA-5: `liveServer: true` keeps the client assets of requiresLiveServer
    // plugins and ships the docmd-api.js bridge; plain `docmd build` does not.
    {
      const proj = setup('paa-live-server');
      writeFile(proj, 'docs/index.md', '# Live\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'PAA-5',
        src: './docs',
        out: './site',
        plugins: { threads: {} }
      }, null, 2) + '\n');
      const assetFiles = ['assets/js/threads.js', 'assets/css/threads.css', 'assets/js/docmd-api.js'];

      const { buildSite } = await import('../../packages/core/dist/commands/build.js');
      await buildSite(path.join(proj, 'docmd.config.json'), { isDev: false, quiet: true, liveServer: true });
      const html = readSite(proj, 'index.html') || '';
      for (const f of assetFiles) {
        assert(fs.existsSync(path.join(proj, 'site', f)), `PAA-5: liveServer build emits site/${f}`);
        assert(html.includes(f), `PAA-5: liveServer index.html references ${f}`);
      }
      const bodyHtml = html.slice(html.indexOf('<body'));
      assert(bodyHtml.includes('assets/js/docmd-api.js'), 'PAA-5: docmd-api.js is referenced inside <body>');

      fs.rmSync(path.join(proj, 'site'), { recursive: true, force: true });
      const plain = build(proj);
      assert(plain.ok, 'PAA-5: plain build succeeds');
      const plainHtml = readSite(proj, 'index.html') || '';
      for (const f of assetFiles) {
        // docmd-api.js is always copied with the UI asset dir; only its page reference is live-server only.
        if (!f.endsWith('docmd-api.js')) assert(!fs.existsSync(path.join(proj, 'site', f)), `PAA-5: plain build omits site/${f}`);
        assert(!plainHtml.includes(f), `PAA-5: plain index.html does not reference ${f}`);
      }
      assert(/requires live dev server/.test(plain.output), 'PAA-5: plain build prints the dev-only warning');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
