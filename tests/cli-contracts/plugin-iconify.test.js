/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Iconify integration contract tests.
 * Tests parseIconifyName, simplified syntax (icon:iconify:name and icon:iconify-name),
 * SVG resolver, container rendering, and docmd doctor health check.
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  setup,
  writeFile,
  runTestFile
} from '../shared.js';
import { parseIconifyName, resolveIconifyIcon } from '../../packages/plugins/iconify/dist/index.js';
import { renderIcon } from '../../packages/parser/dist/index.js';
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
  name: 'Iconify Plugin & Simplified Syntax Contract',
  emoji: '🎨',
  run: async () => {

    // 1. Syntax parser: iconify:collection:icon, iconify:collection-icon, iconify-collection:icon, iconify-collection-icon
    {
      const p1 = parseIconifyName('iconify:mdi:home');
      assert(p1 && p1.collection === 'mdi' && p1.icon === 'home', 'ICONIFY-1: iconify:mdi:home parses collection and icon');

      const p2 = parseIconifyName('iconify:mdi-home');
      assert(p2 && p2.collection === 'mdi' && p2.icon === 'home', 'ICONIFY-1: iconify:mdi-home parses collection and icon');

      const p3 = parseIconifyName('iconify-mdi:home');
      assert(p3 && p3.collection === 'mdi' && p3.icon === 'home', 'ICONIFY-1: iconify-mdi:home parses collection and icon');

      const p4 = parseIconifyName('iconify-mdi-home');
      assert(p4 && p4.collection === 'mdi' && p4.icon === 'home', 'ICONIFY-1: iconify-mdi-home parses collection and icon');

      const p5 = parseIconifyName('iconify:carbon:logo-github');
      assert(p5 && p5.collection === 'carbon' && p5.icon === 'logo-github', 'ICONIFY-1: iconify:carbon:logo-github parses sub-hyphenated icon');

      const p6 = parseIconifyName('iconify-solar:shield-check-bold');
      assert(p6 && p6.collection === 'solar' && p6.icon === 'shield-check-bold', 'ICONIFY-1: iconify-solar:shield-check-bold parses');

      const nonIconify = parseIconifyName('rocket');
      assert(nonIconify === null, 'ICONIFY-1: bare Lucide icon name returns null');
    }

    // 2. Icon resolver and SVG generation
    {
      const svg = resolveIconifyIcon('iconify:mdi:home', { class: 'custom-test-icon' });
      assert(svg && svg.includes('<svg'), 'ICONIFY-2: resolveIconifyIcon returns an SVG');
      assert(svg.includes('class="') && svg.includes('iconify-icon') && svg.includes('custom-test-icon'), 'ICONIFY-2: SVG includes iconify-icon and custom class');
      assert(svg.includes('icon-mdi-home'), 'ICONIFY-2: SVG includes collection-icon class');
    }

    // 3. Parser integration with renderIcon
    {
      const rendered = renderIcon('iconify:mdi-home', { class: 'container-icon' });
      assert(rendered && rendered.includes('<svg'), 'ICONIFY-3: renderIcon routes iconify icons to custom resolver');
      assert(rendered.includes('iconify-icon') && rendered.includes('icon-mdi-home'), 'ICONIFY-3: renderIcon emits iconify SVG attributes');

      // Verify Lucide icons still render unchanged
      const lucideSvg = renderIcon('rocket');
      assert(lucideSvg && lucideSvg.includes('lucide-icon') && lucideSvg.includes('icon-rocket'), 'ICONIFY-3: standard Lucide icons continue to render via core');
    }

    // 4. End-to-end site build with iconify containers
    {
      const dir = setup('iconify-build-e2e');
      writeFile(dir, 'docs/index.md', [
        '# Home',
        '',
        '::: callout icon:iconify:mdi:home',
        'Welcome home',
        ':::',
        '',
        '::: button title:"GitHub" url:"https://github.com" icon:iconify:carbon:logo-github',
        ':::',
        ''
      ].join('\n'));

      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Iconify Test',
        plugins: {
          iconify: {}
        }
      }));

      execFileSync(process.execPath, [DOCMD, 'build'], { cwd: dir, stdio: 'pipe' });

      const html = fs.readFileSync(path.join(dir, 'site/index.html'), 'utf8');
      assert(html.includes('iconify-icon'), 'ICONIFY-4: build output inlines iconify-icon SVG');
      assert(html.includes('icon-mdi-home'), 'ICONIFY-4: callout container inlines mdi-home icon');
      assert(html.includes('icon-carbon-logo-github'), 'ICONIFY-4: button container inlines carbon-logo-github icon');
    }

    // 5. docmd doctor diagnostic check for iconify
    {
      const dir = setup('iconify-doctor-check');
      writeFile(dir, 'docs/index.md', '# Test\n');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Doctor Iconify Test',
        plugins: {
          iconify: {}
        }
      }));

      const out = execFileSync(process.execPath, [DOCMD, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' });
      const report = JSON.parse(out);

      assert(report.pluginDiagnostics && report.pluginDiagnostics.iconify, 'ICONIFY-5: doctor executes iconify health check');
      const iconifyCheck = report.pluginDiagnostics.iconify[0];
      assert(iconifyCheck && iconifyCheck.status === 'ok', 'ICONIFY-5: iconify check reports status ok');
      assert(iconifyCheck && iconifyCheck.message.includes('200,000+'), 'ICONIFY-5: iconify check describes active integration');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
