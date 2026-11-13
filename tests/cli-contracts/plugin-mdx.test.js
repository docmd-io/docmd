/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Plugin MDX contract:
 * 1. JSX components (<Callout>, <Card>, <Badge>, <Tabs>) compile to native docmd container HTML/CSS.
 * 2. MDX curly-brace expressions (math, string manipulation, multiline) evaluate accurately.
 *
 * Run: `node tests/runner.js --only=plugin-mdx`
 * --------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { setup, writeFile, build, runTestFile } from '../shared.js';

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
  name: 'Plugin MDX contracts (JSX container structures, expressions, zero-overhead)',
  emoji: '⚛️',
  run: async () => {
    // -------------------------------------------------------------------------
    // Scenario 1: JSX Callout and Card compile to native docmd container classes
    // -------------------------------------------------------------------------
    {
      const dir = setup('plugin-mdx-containers');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'MDX Test Site',
        plugins: {
          mdx: true
        }
      }));
      writeFile(dir, 'docs/index.md', `
# MDX Showcase

<Callout type="tip" title="Tip Callout" icon="rocket">
Here is callout body.
</Callout>

<Card title="Showcase Card" icon="sparkles" href="/guide/">
Here is card content.
</Card>

Domain: **{'DOCMD'.toLowerCase() + '.io'}**
Math: **{10 + 20}**
`);

      const res = build(dir);
      assert(res.ok, 'MDX build succeeds with JSX components and expressions');

      const indexPath = path.join(dir, 'site', 'index.html');
      assert(fs.existsSync(indexPath), 'site/index.html generated');

      if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, 'utf8');

        // Check Callout container classes
        assert(html.includes('docmd-container callout callout-tip'), 'Callout has docmd-container callout callout-tip classes');
        assert(html.includes('class="callout-title"'), 'Callout has callout-title element');
        assert(html.includes('Tip Callout'), 'Callout title text rendered');
        assert(html.includes('class="callout-content"'), 'Callout has callout-content element');

        // Check Card container classes
        assert(html.includes('class="docmd-container card"'), 'Card has docmd-container card classes');
        assert(html.includes('href="./guide/"') || html.includes('href="/guide/"'), 'Card href attribute preserved');
        assert(html.includes('class="card-title"'), 'Card has card-title element');
        assert(html.includes('Showcase Card'), 'Card title text rendered');
        assert(html.includes('class="card-content"'), 'Card has card-content element');

        // Check Expression evaluations
        assert(html.includes('Domain: <strong><a href="https://docmd.io">docmd.io</a></strong>'), 'String expression evaluates to docmd.io');
        assert(html.includes('Math: <strong>30</strong>'), 'Math expression evaluates to 30');
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
