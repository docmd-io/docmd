/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Pre-release 0.9.5 fixes regression suite:
 *   - Issue #220: AI Assistant MCP tools forwarded to engine (read_documentation_page,
 *                 navigate_to_page, copy_code_snippet, get_site_structure, search_documentation)
 *   - Issue #210 / PR #211: OpenAPI download button respects config and emits root-relative URL
 *   - Issue #223: Summer theme layout renders data-source-file on body for Threads plugin
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
  name: 'Pre-release 0.9.5 fixes (#220, #210/PR #211, #223)',
  emoji: '🛠️',
  run: async () => {
    // 1. Issue #220: AI Assistant Client Bundle includes all MCP tools
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

    // 2. Issue #210 / PR #211: OpenAPI download link rendering and root-relative URL
    {
      const openApiPlugin = await import('../../packages/plugins/openapi/dist/index.js');
      const md = { renderer: { rules: {} } };
      openApiPlugin.markdownSetup(md, { download: true });

      // Create a temporary OpenAPI spec to render
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

      // Cleanup
      fs.rmSync(tempSpecDir, { recursive: true, force: true });
    }

    // 3. Issue #223: Summer theme renders data-source-file on body
    {
      const summerLayoutPath = path.resolve('packages/templates/summer/dist/templates/layout.ejs');
      assert(fs.existsSync(summerLayoutPath), 'Summer template layout exists at dist/templates/layout.ejs');

      const layoutContent = fs.readFileSync(summerLayoutPath, 'utf8');
      assert(
        layoutContent.includes('data-source-file="<%= sourceFile %>"'),
        'Summer template layout includes data-source-file on body element'
      );
    }

    return { passed, failed, failures };
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};

if (process.argv[1] && process.argv[1].endsWith('issue-fixes-0-9-5.test.js')) {
  console.log(`Running ${test.name}...`);
  test.run().then(() => {
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
