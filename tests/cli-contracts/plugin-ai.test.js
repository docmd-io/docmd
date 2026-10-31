/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Plugin AI test suite:
 *   - Disable/enable flags & assets emission
 *   - AI Assistant MCP tools registered in client bundle
 *   - AI Assistant streaming replacement protocol & metadata
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
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
  name: 'Plugin AI contracts (flags, tools, streaming)',
  emoji: '🤖',
  run: async () => {
    // Case 1: plugins.ai.assistant: false -> No AI assets emitted or injected
    {
      const proj = setup('plugin-ai-disable-assistant-false');
      writeFile(proj, 'docs/index.md', '# Hello World\nWelcome to docs.\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'AI Disabled Test',
        src: './docs',
        out: './site',
        plugins: {
          ai: {
            assistant: false
          }
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds when plugins.ai.assistant is false');
      assert(!fs.existsSync(path.join(proj, 'site/assets/js/docmd-ai.js')),
        'site/assets/js/docmd-ai.js is NOT emitted when assistant is false');
      assert(!fs.existsSync(path.join(proj, 'site/assets/css/docmd-ai.css')),
        'site/assets/css/docmd-ai.css is NOT emitted when assistant is false');

      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(!html.includes('docmd-ai.js'), 'HTML contains no docmd-ai.js script tag');
      assert(!html.includes('docmd-ai.css'), 'HTML contains no docmd-ai.css link tag');
      assert(!html.includes('window.__docmd_ai_config'), 'HTML contains no window.__docmd_ai_config');
      assert(!result.output.includes('AI Assistant plugin ready for site.'),
        'Build output does not log "AI Assistant plugin ready for site." when disabled');
    }

    // Case 2: plugins.ai.enabled: false -> No AI assets emitted or injected
    {
      const proj = setup('plugin-ai-disable-enabled-false');
      writeFile(proj, 'docs/index.md', '# Hello World\nWelcome to docs.\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'AI Enabled False Test',
        src: './docs',
        out: './site',
        plugins: {
          ai: {
            enabled: false
          }
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds when plugins.ai.enabled is false');
      assert(!fs.existsSync(path.join(proj, 'site/assets/js/docmd-ai.js')),
        'site/assets/js/docmd-ai.js is NOT emitted when enabled is false');
      assert(!fs.existsSync(path.join(proj, 'site/assets/css/docmd-ai.css')),
        'site/assets/css/docmd-ai.css is NOT emitted when enabled is false');

      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(!html.includes('docmd-ai.js'), 'HTML contains no docmd-ai.js script tag');
      assert(!html.includes('docmd-ai.css'), 'HTML contains no docmd-ai.css link tag');
    }

    // Case 3: plugins.ai: {} (enabled by default when configured)
    {
      const proj = setup('plugin-ai-enabled-default');
      writeFile(proj, 'docs/index.md', '# Hello World\nWelcome to docs.\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'AI Enabled Test',
        src: './docs',
        out: './site',
        plugins: {
          ai: {
            projectId: 'test-project'
          }
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Build succeeds when AI plugin is enabled');
      assert(fs.existsSync(path.join(proj, 'site/assets/js/docmd-ai.js')),
        'site/assets/js/docmd-ai.js IS emitted when AI plugin is enabled');
      assert(fs.existsSync(path.join(proj, 'site/assets/css/docmd-ai.css')),
        'site/assets/css/docmd-ai.css IS emitted when AI plugin is enabled');

      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(html.includes('docmd-ai.js'), 'HTML contains docmd-ai.js script tag when enabled');
      assert(html.includes('docmd-ai.css'), 'HTML contains docmd-ai.css link tag when enabled');
      assert(html.includes('window.__docmd_ai_config'), 'HTML contains window.__docmd_ai_config when enabled');
    }

    // Case 4: AI Assistant Client Bundle includes all MCP tools
    {
      const aiClientJsPath = path.resolve('packages/plugins/ai/dist/client/index.js');
      assert(fs.existsSync(aiClientJsPath), 'AI plugin client bundle exists at dist/client/index.js');

      const clientJs = fs.readFileSync(aiClientJsPath, 'utf8');
      assert(clientJs.includes('navigate_to_page'), 'AI client bundle registers navigate_to_page tool');
      assert(clientJs.includes('copy_code_snippet'), 'AI client bundle registers copy_code_snippet tool');
      assert(clientJs.includes('read_documentation_page'), 'AI client bundle registers read_documentation_page tool');
      assert(clientJs.includes('get_site_structure'), 'AI client bundle registers get_site_structure tool');
      assert(clientJs.includes('search_documentation'), 'AI client bundle registers search_documentation tool');
    }

    // Case 5: AI Assistant stream replacement protocol and synthesis fallback
    // This test requires the sibling `docmd-assistant` repo to be present
    // at `../docmd-assistant`. On CI (GitHub Actions), only `docmd` is
    // checked out, so we skip gracefully when the module is absent.
    {
      const assistantDistPath = path.resolve('../docmd-assistant/dist/index.js');
      const assistantTypesPath = path.resolve('../docmd-assistant/src/types.ts');
      if (fs.existsSync(assistantDistPath) && fs.existsSync(assistantTypesPath)) {
        const { DocmdAssistantEngine } = await import(assistantDistPath);
        const engine = new DocmdAssistantEngine();
        assert(typeof engine.sendMessageStream === 'function', 'DocmdAssistantEngine exposes sendMessageStream method');

        const assistantTypes = fs.readFileSync(assistantTypesPath, 'utf8');
        assert(
          assistantTypes.includes('meta?: { replace?: boolean; turn?: number; isFinal?: boolean }'),
          'StreamCallbacks.onChunk accepts replace and turn metadata'
        );
      }
      // If docmd-assistant is not present, silently skip — it is a separate
      // closed-source repo and is not part of the docmd monorepo CI.
    }

    // Case 6: External URL Data Fetching & Cloud Relay Proxy support
    {
      const aiClientJsPath = path.resolve('packages/plugins/ai/dist/client/index.js');
      const clientJs = fs.readFileSync(aiClientJsPath, 'utf8');
      assert(clientJs.includes('fetchExternalUrls'), 'AI client bundle implements fetchExternalUrls');
      assert(clientJs.includes('api.docmd.io/v1/ai/fetch') || clientJs.includes('/v1/ai/fetch'), 'AI client bundle includes Cloud Relay fetch proxy fallback');

      const assistantDistPath = path.resolve('../docmd-assistant/dist/index.js');
      if (fs.existsSync(assistantDistPath)) {
        const { DocmdAssistantEngine } = await import(assistantDistPath);
        const engine = new DocmdAssistantEngine({ fetchExternalUrls: true });
        assert(engine.isFetchExternalUrlsEnabled() === true, 'DocmdAssistantEngine recognizes fetchExternalUrls option');
      }
    }

    return { passed, failed, failures };
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};

if (process.argv[1] && process.argv[1].endsWith('plugin-ai.test.js')) {
  console.log(`Running ${test.name}...`);
  test.run().then(() => {
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
