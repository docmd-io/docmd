/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Slice C.1 + C.2 — Plugin-contract and public-API fixes
 *
 * Covers:
 *   D-H1  buildSite(configPath) honours the configPath (and an
 *         explicit opts.cwd) instead of always using process.cwd().
 *   D-H2  @docmd/core re-exports buildWorkspace, detectWorkspace,
 *         and isWorkspace so the documented API actually imports.
 *   D-H3  generateScripts gets a `target: 'head'|'body'` third arg
 *         so plugins can render different content per slot.
 *   D-S4  generateMetaTags returns must be a string; objects produce
 *         a warning and are skipped instead of being stringified to
 *         "[object Object]" and injected into every page's <head>.
 *   D-S5  generateScripts plain-string returns are treated as the
 *         head slot; previously they were silently dropped on body.
 *   D-M1  translations returns must be a plain string→string map;
 *         strings used to spread into garbage numeric keys.
 *   D-H7  onBeforeParse chain continues when a plugin throws.
 *   D-S2  buildContextualUrl strips the `external:` prefix.
 *   D-M2  PostBuildContext.config + pages are typed.
 *   D-M6  URL utility re-export types are aligned.
 *   T-Z3  Unknown top-level config keys produce a warning.
 *
 * Run: `node tests/runner.js --only=plugin-contract`
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  TEST_ROOT,
  setup,
  writeFile,
  build,
  runTestFile
} from '../shared.js';
import { execSync } from 'node:child_process';
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
  name: 'Plugin contract + public API fixes (Slice C.1 + C.2)',
  emoji: '🔌',
  run: async () => {

    // D-H2 — re-exports. Direct import to confirm the symbols exist
    // on the public package surface. We don't need to run a full
    // build — the import-time check is the test.
    {
      const apiPkg = path.resolve(import.meta.dirname, '..', '..', 'packages', 'core', 'dist', 'index.js');
      const source = fs.readFileSync(apiPkg, 'utf8');
      assert(/export\s*\{\s*[^}]*buildWorkspace[^}]*\}\s*from/.test(source), 'D-H2: buildWorkspace re-exported from @docmd/core');
      assert(/export\s*\{\s*[^}]*detectWorkspace[^}]*\}\s*from/.test(source), 'D-H2: detectWorkspace re-exported from @docmd/core');
      assert(/export\s*\{\s*[^}]*isWorkspace[^}]*\}\s*from/.test(source), 'D-H2: isWorkspace re-exported from @docmd/core');
    }

    // D-H1 — buildSite honours the configPath. We build the site from
    // a directory OTHER than cwd, and verify it actually picks up the
    // docs from that directory (not from cwd/docs).
    {
      const proj = setup('plugin-contract-c1-dh1-configpath');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({ title: 'D-H1', src: './docs', out: './site' }, null, 2) + '\n');
      // Also plant a decoy docs/ in cwd so a wrong cwd would be detected.
      const decoyDir = path.join(TEST_ROOT, '__cwd-decoy');
      fs.mkdirSync(path.join(decoyDir, 'docs'), { recursive: true });
      writeFile(decoyDir, 'docs/index.md', '# DECOY\n');

      const configPath = path.join(proj, 'docmd.config.json');
      const cmd = `node ${DOCMD} build --config "${configPath}"`;
      const result = (() => {
        try {
          return { ok: true, output: execSync(cmd, { cwd: decoyDir, stdio: 'pipe', encoding: 'utf8' }) };
        } catch (e) {
          return { ok: false, output: (e.stderr || '') + (e.stdout || '') };
        }
      })();

      assert(result.ok, 'D-H1: build with --config <abs-path> from a foreign cwd succeeds');
      assert(fs.existsSync(path.join(proj, 'site/index.html')), 'D-H1: build output written next to configPath, not cwd');
      const builtHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(!/DECOY/.test(builtHtml), 'D-H1: built page is from configPath\'s docs/, not cwd\'s docs/');
    }

    // D-S4 — generateMetaTags returning an object produces a warning
    // and does NOT inject "[object Object]" into <head>. The dispatcher
    // also warns (exactly once) per build.
    {
      const proj = setup('plugin-contract-c1-ds4-object-return');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      // Local-path plugins need a directory layout (package.json + index.js)
      // so the loader can resolve via safePath + package.json main field.
      writeFile(proj, 'plugins/evil-meta/package.json', JSON.stringify({
        name: 'evil-meta', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/evil-meta/index.js', [
        "export const plugin = { name: 'evil-meta', version: '1.0.0', capabilities: ['head'] };",
        "export async function generateMetaTags() { return { random: 'object' }; }",
        ""
      ].join('\n'));
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'D-S4',
        src: './docs',
        out: './site',
        plugins: { './plugins/evil-meta': {} }
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }

      assert(fs.existsSync(path.join(proj, 'site/index.html')), 'D-S4: build completes (plugin was loaded)');
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(!/\[object Object\]/.test(html), 'D-S4: object return from generateMetaTags is NOT injected into <head>');
      assert(/non-string/i.test(output), 'D-S4: TUI warns about the non-string return');
    }

    // D-S5 — generateScripts returning a plain string is honoured on
    // the head side (previously dropped because `result?.bodyScriptsHtml`
    // was undefined, AND head was `result?.headScriptsHtml` which was
    // also undefined on a plain-string return).
    {
      const proj = setup('plugin-contract-c1-ds5-string-return');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'plugins/string-scripts/package.json', JSON.stringify({
        name: 'string-scripts', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/string-scripts/index.js', [
        "export const plugin = { name: 'string-scripts', version: '1.0.0', capabilities: ['head', 'body'] };",
        "export async function generateScripts() { return '<script id=\"x\">42</script>'; }",
        ""
      ].join('\n'));
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'D-S5',
        src: './docs',
        out: './site',
        plugins: { './plugins/string-scripts': {} }
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(/<script id="x">42<\/script>/.test(html), 'D-S5: plain-string return from generateScripts appears in <head>');
      // Body slot stays empty — the original contract is "string is head-only".
      assert(!/<script id="x">42<\/script>[^<]*<\/body>/.test(html), 'D-S5: plain-string return does NOT also land in <body>');
    }

    // D-H3 — generateScripts gets a `target` arg. Plugin reads it and
    // emits different content for head vs body. The body path uses the
    // object form because the string form is head-only by contract
    // (D-S5); the `target` arg is what lets the plugin know which slot
    // it's being asked to render.
    {
      const proj = setup('plugin-contract-c1-dh3-target-arg');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'plugins/target-aware/package.json', JSON.stringify({
        name: 'target-aware', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/target-aware/index.js', [
        "export const plugin = { name: 'target-aware', version: '1.0.0', capabilities: ['head', 'body'] };",
        "export async function generateScripts(config, options, target) {",
        "  if (target === 'head') return { headScriptsHtml: '<meta name=\"x-head\" content=\"yes\">', bodyScriptsHtml: '' };",
        "  return { headScriptsHtml: '', bodyScriptsHtml: '<div id=\"x-body\">body-marker</div>' };",
        "}",
        ""
      ].join('\n'));
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'D-H3',
        src: './docs',
        out: './site',
        plugins: { './plugins/target-aware': {} }
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(/<meta name="x-head" content="yes">/.test(html), 'D-H3: target=head emit lands in <head>');
      assert(/<div id="x-body">body-marker<\/div>/.test(html), 'D-H3: target=body emit lands in <body>');
    }

    // D-M1 — translations returning a string produces a warning and
    // does NOT spread the string into the translation map.
    {
      const proj = setup('plugin-contract-c1-dm1-translations-string');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'plugins/bad-translations/package.json', JSON.stringify({
        name: 'bad-translations', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/bad-translations/index.js', [
        "export const plugin = { name: 'bad-translations', version: '1.0.0', capabilities: ['translations'] };",
        "export function translations(localeId) { return 'not an object'; }",
        ""
      ].join('\n'));
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'D-M1',
        src: './docs',
        out: './site',
        plugins: { './plugins/bad-translations': {} }
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }

      assert(fs.existsSync(path.join(proj, 'site/index.html')), 'D-M1: build completes (plugin was loaded)');
      assert(/non-object/i.test(output), 'D-M1: TUI warns about non-object translations return');
    }

    // D-H7 — onBeforeParse chain continues when a plugin throws. Two
    // plugins configured: A throws, B appends a marker. Final HTML
    // should contain the marker (B was called) AND emit a parser-error
    // line for A.
    {
      const proj = setup('plugin-contract-c1-dh7-chain');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'plugins/throws/package.json', JSON.stringify({
        name: 'throws', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/throws/index.js', [
        "export const plugin = { name: 'throws', version: '1.0.0', capabilities: ['build'] };",
        "export async function onBeforeParse(md) { throw new Error('A-explodes'); }",
        ""
      ].join('\n'));
      writeFile(proj, 'plugins/marker/package.json', JSON.stringify({
        name: 'marker', version: '1.0.0', type: 'module', main: 'index.js'
      }) + '\n');
      writeFile(proj, 'plugins/marker/index.js', [
        "export const plugin = { name: 'marker', version: '1.0.0', capabilities: ['build'] };",
        "export async function onBeforeParse(md) { return md + '\\n<!-- chain-marker -->\\n'; }",
        ""
      ].join('\n'));
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'D-H7',
        src: './docs',
        out: './site',
        plugins: {
          './plugins/throws': {},
          './plugins/marker': {}
        }
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }

      assert(fs.existsSync(path.join(proj, 'site/index.html')), 'D-H7: build completes (plugins were loaded)');
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(/chain-marker/.test(html), 'D-H7: marker plugin ran AFTER the throwing plugin (chain continued)');
      assert(/A-explodes/.test(output) || /onBeforeParse/i.test(output), 'D-H7: A\'s throw is surfaced');
    }

    // D-S2 — buildContextualUrl strips `external:` prefix. Unit-test the
    // helper directly so we don't need to spin up a whole build.
    {
      const helperPath = path.resolve(import.meta.dirname, '..', '..', 'packages', 'parser', 'dist', 'utils', 'url-utils.js');
      const helper = await import(helperPath);
      // Provide a minimal context.
      const ctx = {
        relativePathToRoot: './',
        outputPrefix: '',
        offline: false,
        base: '/',
        siteUrl: ''
      };
      // Pre-fix: 'external:https://github.com' would have produced
      // './external:https://github.com'. Post-fix: returns the URL untouched.
      const out = helper.buildContextualUrl('external:https://github.com/foo', ctx);
      assert(out === 'https://github.com/foo', 'D-S2: buildContextualUrl strips external: prefix');
      // Pass-through for normal external URLs.
      assert(helper.buildContextualUrl('https://example.com', ctx) === 'https://example.com', 'D-S2: plain external URL still untouched');
      // Hash-only untouched.
      assert(helper.buildContextualUrl('#section', ctx) === '#section', 'D-S2: hash-only anchor untouched');
    }

    // T-Z3 — unknown top-level config key produces a warning.
    {
      const proj = setup('plugin-contract-c1-tz3-unknown-key');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'T-Z3',
        src: './docs',
        out: './site',
        // `fooBarBaz` is not a known key.
        fooBarBaz: 'whatever'
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }

      assert(/fooBarBaz/.test(output), 'T-Z3: unknown top-level key surfaces in warnings');
      // Build still succeeds.
      assert(fs.existsSync(path.join(proj, 'site/index.html')), 'T-Z3: unknown-key warning is non-fatal');
    }

    // T-Z3 (companion) — typo suggestion still works.
    {
      const proj = setup('plugin-contract-c1-tz3-typo');
      writeFile(proj, 'docs/index.md', '# Hi\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'T-Z3-typo',
        src: './docs',
        out: './site',
        // Common typo: `baseUrl` instead of `url`.
        baseUrl: 'https://example.com'
      }, null, 2) + '\n');

      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: proj, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }

      assert(/baseUrl/.test(output) && /url/.test(output), 'T-Z3: typo key surfaces a "Did you mean" suggestion');
    }

    // OpenAPI download link rendering and root-relative URL
    {
      const openApiPlugin = await import('../../packages/plugins/openapi/dist/index.js');
      const md = { renderer: { rules: {} } };
      openApiPlugin.markdownSetup(md, { download: true });

      const tempSpecDir = path.resolve('temp-openapi-test');
      if (!fs.existsSync(tempSpecDir)) fs.mkdirSync(tempSpecDir, { recursive: true });
      const specPath = path.join(tempSpecDir, 'api.json');
      fs.writeFileSync(specPath, JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test Download API', version: '2.0.0' },
        paths: {}
      }));

      const token = {
        info: 'openapi',
        content: './api.json'
      };

      const html = md.renderer.rules.fence(
        [token],
        0,
        {},
        { filePath: path.join(tempSpecDir, 'docs/endpoints.md') },
        { renderToken: () => '' }
      );

      assert(html.includes('oa-download-link'), 'OpenAPI spec renders download link when download: true');
      assert(html.includes('href="/api.json"'), 'OpenAPI spec download link is root-relative (/api.json)');

      fs.rmSync(tempSpecDir, { recursive: true, force: true });
    }

    // OpenAPI requestBody schema $ref (array) renders item fields
    {
      const openApiPlugin = await import('../../packages/plugins/openapi/dist/index.js');
      const md = { renderer: { rules: {} } };
      openApiPlugin.markdownSetup(md, { download: false });

      const tempSpecDir = path.resolve('temp-openapi-ref-request-test');
      if (!fs.existsSync(tempSpecDir)) fs.mkdirSync(tempSpecDir, { recursive: true });
      const specPath = path.join(tempSpecDir, 'api.yaml');
      fs.writeFileSync(specPath, [
        'openapi: 3.0.0',
        'info:',
        '  title: Example Ref API',
        '  version: 1.0.0',
        'paths:',
        '  /v1/create:',
        '    post:',
        '      requestBody:',
        '        content:',
        '          create:',
        '            schema:',
        "              $ref: '#/components/schemas/ExamplePayload'",
        '      responses:',
        "        '200':",
        '          description: ok',
        'components:',
        '  schemas:',
        '    ExamplePayload:',
        '      type: array',
        '      items:',
        '        type: object',
        '        anyOf:',
        '          - required: [contactEmail]',
        '          - required: [recordId]',
        '        properties:',
        '          contactEmail:',
        '            type: string',
        '            format: email',
        '          recordId:',
        '            type: integer'
      ].join('\n') + '\n');

      const token = {
        info: 'openapi',
        content: './api.yaml'
      };

      const html = md.renderer.rules.fence(
        [token],
        0,
        {},
        { filePath: path.join(tempSpecDir, 'docs/endpoints.md') },
        { renderToken: () => '' }
      );

      assert(html.includes('Request Body'), 'OpenAPI renders request body for $ref schema');
      assert(html.includes('Array items:'), 'OpenAPI renders array item schema details for request body');
      assert(html.includes('<code>contactEmail</code>'), 'OpenAPI renders referenced request body item fields');
      assert(html.includes('<code>recordId</code>'), 'OpenAPI renders referenced request body item fields');
      assert(!html.includes('array[any | any]'), 'OpenAPI avoids ambiguous any|any labels for required-only anyOf branches');
      assert(html.includes('Required: contactEmail') && html.includes('Required: recordId'), 'OpenAPI renders anyOf required-only constraints');

      fs.rmSync(tempSpecDir, { recursive: true, force: true });
    }

    // OpenAPI markdown descriptions render list items as HTML bullets
    {
      const openApiPlugin = await import('../../packages/plugins/openapi/dist/index.js');
      const md = { renderer: { rules: {} } };
      openApiPlugin.markdownSetup(md, { download: false });

      const spec = [
        'openapi: 3.0.0',
        'info:',
        '  title: Example List API',
        '  version: 1.0.0',
        'paths:',
        '  /items:',
        '    get:',
        '      summary: Get items',
        '      description: |-',
        '        Optional list of example entries.',
        '        ',
        '        For create and update requests:',
        '        - If exampleList is not provided, existing values are not changed.',
        '        - If exampleList is an empty array ([]), all existing values are removed.',
        '        - If exampleList is a non-empty array, existing values are replaced by the provided values.',
        '      responses:',
        "        '200':",
        '          description: ok',
        '          content:',
        '            application/json:',
        '              schema:',
        '                type: object',
        '                properties:',
        '                  exampleList:',
        '                    type: array',
        '                    maxItems: 100',
        '                    items:',
        '                      type: string'
      ].join('\n') + '\n';

      const token = {
        info: 'openapi',
        content: spec
      };

      const html = md.renderer.rules.fence(
        [token],
        0,
        {},
        { filePath: path.resolve('temp-openapi-markdown-list-test/docs/example.md') },
        { renderToken: () => '' }
      );

      assert(html.includes('<ul>'), 'OpenAPI markdown description renders an HTML list');
      assert(html.includes('<li>'), 'OpenAPI markdown description renders list items');
      assert(html.includes('maxItems: 100'), 'OpenAPI schema constraints render array maxItems values');
      assert(!html.includes('For create and update requests:\n- If exampleList'), 'OpenAPI markdown description leaves list markers as markdown, not literal text');
    }

    // Dynamic plugin installation and runtime module reload
    {
      const hooksSrc = fs.readFileSync(path.resolve('packages/api/src/hooks.ts'), 'utf8');
      assert(
        hooksSrc.includes('const reloaded = await tryLoadAfterInstall') &&
        hooksSrc.includes('rawModule = reloaded;'),
        'Dynamic plugin install assigns rawModule = reloaded after tryLoadAfterInstall'
      );
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};