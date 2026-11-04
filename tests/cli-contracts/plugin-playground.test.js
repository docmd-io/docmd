/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Plugin Playground test suite:
 *   - Auto-loaded as core plugin (zero-config)
 *   - Conditional asset emission when markdown contains playground blocks
 *   - Zero asset overhead when page does not contain playground
 *   - Manual disable via plugins.playground: false
 *   - Fence syntax (```js playground, ```html playground, live)
 *   - Container syntax (::: playground title="..." live)
 * --------------------------------------------------------------------
 */

import {
  setup,
  writeFile,
  build,
  runTestFile
} from '../shared.js';
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
  name: 'Plugin Playground contracts (core auto-load, rendering, zero-overhead)',
  emoji: '🎮',
  run: async () => {
    // Case 1: Core auto-load with playground block emits assets and renders interactive widget
    {
      const proj = setup('plugin-playground-autoload');
      writeFile(proj, 'docs/index.md', [
        '# Interactive Guide',
        '',
        '```js playground title="Console Runner" live',
        'const x = 10;',
        'console.log("Val:", x);',
        '```',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Autoload Test',
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds with playground block in markdown');

      const indexHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf-8');
      assert(indexHtml.includes('class="docmd-playground"'), 'Generated HTML includes class="docmd-playground"');
      assert(indexHtml.includes('data-title="Console Runner"'), 'Generated HTML includes title="Console Runner"');
      assert(indexHtml.includes('data-live="true"'), 'Generated HTML includes data-live="true"');
      assert(indexHtml.includes('docmd-playground-editor'), 'Generated HTML includes editor container');
      assert(indexHtml.includes('docmd-playground-console'), 'Generated HTML includes console output panel');
      assert(indexHtml.includes('assets/js/docmd-playground.js'), 'HTML injects docmd-playground.js asset');
      assert(indexHtml.includes('assets/css/docmd-playground.css'), 'HTML injects docmd-playground.css asset');
      assert(fs.existsSync(path.join(proj, 'site/assets/js/docmd-playground.js')), 'docmd-playground.js asset file is written');
      assert(fs.existsSync(path.join(proj, 'site/assets/css/docmd-playground.css')), 'docmd-playground.css asset file is written');
    }

    // Case 2: Zero-overhead when page has NO playground blocks
    {
      const proj = setup('plugin-playground-zero-overhead');
      writeFile(proj, 'docs/index.md', [
        '# Plain Docs',
        '',
        'Just plain text and standard code block:',
        '',
        '```js',
        'const a = 1;',
        '```',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Zero Overhead Test',
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds for standard doc');

      const indexHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf-8');
      assert(!indexHtml.includes('docmd-playground'), 'Plain HTML does NOT include playground elements');
      assert(!indexHtml.includes('assets/js/docmd-playground.js'), 'Plain HTML does NOT inject playground JS');
      assert(!indexHtml.includes('assets/css/docmd-playground.css'), 'Plain HTML does NOT inject playground CSS');
    }

    // Case 3: Manual disable via plugins.playground: false
    {
      const proj = setup('plugin-playground-manual-disable');
      writeFile(proj, 'docs/index.md', [
        '# Disabled Test',
        '',
        '```js playground',
        'console.log("Should remain regular code");',
        '```',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Disabled Test',
        src: './docs',
        out: './site',
        plugins: {
          playground: false
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds when plugins.playground: false');

      const indexHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf-8');
      assert(!indexHtml.includes('class="docmd-playground"'), 'Playground wrapper is not generated when plugin is disabled');
      assert(!indexHtml.includes('assets/js/docmd-playground.js'), 'Playground JS asset is not injected');
    }

    // Case 4: HTML live preview rendering & container syntax
    {
      const proj = setup('plugin-playground-container-html');
      writeFile(proj, 'docs/index.md', [
        '# Containers and HTML',
        '',
        '::: playground title="Button Component" live',
        '```html',
        '<button class="btn">Test</button>',
        '```',
        ':::',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Container Test',
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds with container playground');

      const indexHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf-8');
      assert(indexHtml.includes('class="docmd-playground"'), 'Container syntax renders playground wrapper');
      assert(indexHtml.includes('data-title="Button Component"'), 'Container title is rendered');
      assert(indexHtml.includes('data-lang="html"'), 'Language is detected as html');
      assert(indexHtml.includes('&lt;button class=&quot;btn&quot;&gt;Test&lt;/button&gt;'), 'HTML code content is escaped inside editor');
      assert(indexHtml.includes('icon-play') || indexHtml.includes('<polygon points="6 3 20 12 6 21 6 3"/>'), 'Renders default play icon');
    }

    // Case 5: Self-closing container with active source file inclusion
    {
      const proj = setup('plugin-playground-selfclosing-src');
      writeFile(proj, 'docs/snippets/calc.js', 'const sum = (a, b) => a + b;\nconsole.log("Sum:", sum(3, 4));\n');
      writeFile(proj, 'docs/index.md', [
        '# Active Script Demo',
        '',
        '::: playground src="./snippets/calc.js" title="Live Calculator" icon:cpu live /:::',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Active Script Test',
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds with self-closing playground container');

      const indexHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf-8');
      assert(indexHtml.includes('class="docmd-playground"'), 'Renders playground for self-closing container');
      assert(indexHtml.includes('data-title="Live Calculator"'), 'Renders custom title for self-closing container');
      assert(indexHtml.includes('data-lang="js"'), 'Automatically derives js language from file extension');
      assert(indexHtml.includes('const sum = (a, b) =&gt; a + b;'), 'Includes active script source content from file');
      assert(indexHtml.includes('icon-cpu'), 'Renders custom icon:cpu in header');
    }

    // Case 6: Missing source file without strict mode (soft warning + fallback comment)
    {
      const proj = setup('plugin-playground-missing-src-soft');
      writeFile(proj, 'docs/index.md', [
        '# Missing Script Demo',
        '',
        '::: playground src="./nonexistent/counter.js" title="Missing Counter" /:::',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Missing Src Test',
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Non-strict build succeeds even when playground src is missing');
      const indexHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf-8');
      assert(indexHtml.includes('Playground Notice: Source script &quot;./nonexistent/counter.js&quot; not found'), 'Renders fallback warning alert in HTML');
      assert(indexHtml.includes('File not found: ./nonexistent/counter.js'), 'Displays fallback comment inside editor textarea');
    }

    // Case 7: Missing source file with --strict CLI flag
    {
      const proj = setup('plugin-playground-missing-src-strict-flag');
      writeFile(proj, 'docs/index.md', [
        '# Strict Mode Demo',
        '',
        '::: playground src="./nonexistent/counter.js" title="Missing Counter" /:::',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Strict Flag Test',
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj, true, '--strict');
      assert(result.ok, '--strict build fails when playground source is missing (exit code 1)');
      const output = (result.output || '') + (result.stderr || '');
      assert(output.includes('Strict mode violation') || output.includes('not found'), 'Error output describes strict mode violation or missing file');
    }

    // Case 8: Missing source file with strict: true in config
    {
      const proj = setup('plugin-playground-missing-src-strict-config');
      writeFile(proj, 'docs/index.md', [
        '# Strict Config Demo',
        '',
        '::: playground src="./nonexistent/counter.js" title="Missing Counter" /:::',
        ''
      ].join('\n'));

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Playground Strict Config Test',
        strict: true,
        src: './docs',
        out: './site'
      }, null, 2) + '\n');

      const result = build(proj, true);
      assert(result.ok, 'Build with strict: true in config fails on missing playground source (exit code 1)');
    }

    // Case 9: Web Worker runtime sandbox bundle contracts
    {
      const runtimeBundlePath = path.resolve(import.meta.dirname, '../../packages/plugins/playground/assets/js/playground.js');
      assert(fs.existsSync(runtimeBundlePath), 'playground.js runtime exists');
      const runtimeContent = fs.readFileSync(runtimeBundlePath, 'utf8');

      assert(runtimeContent.includes('new Worker(') || runtimeContent.includes('Worker(workerUrl)'), 'Runtime leverages Web Worker for thread isolation');
      assert(runtimeContent.includes('new Blob(') || runtimeContent.includes('Blob(['), 'Runtime creates worker via Blob URL');
      assert(runtimeContent.includes('5000') && runtimeContent.includes('workerTimeout'), 'Runtime enforces 5000ms safety timeout guard');
      assert(runtimeContent.includes('worker.terminate()'), 'Runtime terminates worker on timeout and cleanup');
      assert(runtimeContent.includes('docmdSnapshot') || runtimeContent.includes('docmdData'), 'Runtime safely snapshots docmd state for worker');
      assert(runtimeContent.includes('AsyncFunction'), 'Runtime preserves AsyncFunction fallback for restrictive CSPs');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};