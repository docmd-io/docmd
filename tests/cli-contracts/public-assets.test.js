/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Public Root Assets contract:
 * 1. Zero-config auto-detection: `public/` directory (at root or docs/public)
 *    is copied directly to output root (`site/`), preserving directory structure
 *    (e.g. `public/work/fund.json` -> `site/work/fund.json`, `public/CNAME` -> `site/CNAME`).
 * 2. Explicit configuration: `"public": string | string[]` allows specifying custom
 *    directories or standalone files to keep in output root as-is.
 * 3. Failsafe: nonexistent/misconfigured paths log a warning and continue build.
 * 4. Opt-out: `"public": false` disables static/public copying.
 * 5. Multi-project workspace support: root `public/` is copied to workspace root output.
 *
 * Run: `node tests/runner.js --only=public-assets`
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
  name: 'Public root assets contract (zero-config, configurable paths, nested preservation)',
  emoji: '📁',
  run: async () => {
    // -------------------------------------------------------------------------
    // Scenario 1: Zero-config auto-detection preserves nested directory tree
    // -------------------------------------------------------------------------
    {
      const dir = setup('public-assets-zero-config');
      writeFile(dir, 'docs/index.md', '# Hello World\n');
      writeFile(dir, 'public/work/fund.json', JSON.stringify({ grant: 'floss' }));
      writeFile(dir, 'public/CNAME', 'docmd.io\n');
      writeFile(dir, 'public/funding.json', JSON.stringify({ version: '1.1.0' }));
      writeFile(dir, 'public/.well-known/funding.json', JSON.stringify({ wellKnown: true }));

      const res = build(dir);
      assert(res.ok, 'Zero-config build succeeds with public/ present');

      const siteWorkFund = path.join(dir, 'site', 'work', 'fund.json');
      assert(fs.existsSync(siteWorkFund), 'public/work/fund.json copied to site/work/fund.json');
      if (fs.existsSync(siteWorkFund)) {
        const data = JSON.parse(fs.readFileSync(siteWorkFund, 'utf8'));
        assert(data.grant === 'floss', 'Nested content integrity preserved in site/work/fund.json');
      }

      const siteCname = path.join(dir, 'site', 'CNAME');
      assert(fs.existsSync(siteCname), 'public/CNAME copied to site/CNAME');
      if (fs.existsSync(siteCname)) {
        assert(fs.readFileSync(siteCname, 'utf8').trim() === 'docmd.io', 'site/CNAME content matches');
      }

      const siteFunding = path.join(dir, 'site', 'funding.json');
      assert(fs.existsSync(siteFunding), 'public/funding.json copied to site/funding.json');

      const siteWellKnown = path.join(dir, 'site', '.well-known', 'funding.json');
      assert(fs.existsSync(siteWellKnown), 'public/.well-known/funding.json copied to site/.well-known/funding.json');
    }

    // -------------------------------------------------------------------------
    // Scenario 2: Zero-config auto-detection from docs/public
    // -------------------------------------------------------------------------
    {
      const dir = setup('public-assets-docs-dir');
      writeFile(dir, 'docs/index.md', '# Docs Page\n');
      writeFile(dir, 'docs/public/docs-specific/info.txt', 'docs info\n');

      const res = build(dir);
      assert(res.ok, 'Zero-config build succeeds with docs/public/ present');

      const siteInfo = path.join(dir, 'site', 'docs-specific', 'info.txt');
      assert(fs.existsSync(siteInfo), 'docs/public/docs-specific/info.txt copied to site/docs-specific/info.txt');
      if (fs.existsSync(siteInfo)) {
        assert(fs.readFileSync(siteInfo, 'utf8').trim() === 'docs info', 'docs/public content matches');
      }
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Explicit configuration with custom directories, files, and missing paths
    // -------------------------------------------------------------------------
    {
      const dir = setup('public-assets-custom-config');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Custom Static Test',
        static: ['custom-folder', 'standalone.txt', 'nonexistent-path-skipped']
      }));
      writeFile(dir, 'docs/index.md', '# Index\n');
      writeFile(dir, 'custom-folder/nested/custom.json', JSON.stringify({ custom: true }));
      writeFile(dir, 'standalone.txt', 'standalone content\n');

      const res = build(dir);
      assert(res.ok, 'Build succeeds when configured static path does not exist (failsafe)');

      const siteCustom = path.join(dir, 'site', 'custom-folder', 'nested', 'custom.json');
      assert(fs.existsSync(siteCustom), 'custom-folder/nested/custom.json preserved at site/custom-folder/nested/custom.json');

      const siteStandalone = path.join(dir, 'site', 'standalone.txt');
      assert(fs.existsSync(siteStandalone), 'standalone.txt copied to site/standalone.txt');
      if (fs.existsSync(siteStandalone)) {
        assert(fs.readFileSync(siteStandalone, 'utf8').trim() === 'standalone content', 'standalone.txt content matches');
      }
    }

    // -------------------------------------------------------------------------
    // Scenario 4: Opt-out via `"static": false`
    // -------------------------------------------------------------------------
    {
      const dir = setup('public-assets-disabled');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Disabled Static',
        static: false
      }));
      writeFile(dir, 'docs/index.md', '# Disabled Page\n');
      writeFile(dir, 'public/secret.json', JSON.stringify({ hidden: true }));

      const res = build(dir);
      assert(res.ok, 'Build succeeds with static: false');

      const siteSecret = path.join(dir, 'site', 'secret.json');
      assert(!fs.existsSync(siteSecret), 'public/secret.json is NOT copied when static: false');
    }

    // -------------------------------------------------------------------------
    // Scenario 5: Multi-project workspace root public copying
    // -------------------------------------------------------------------------
    {
      const dir = setup('public-assets-workspace');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        workspace: {
          projects: [
            { prefix: '/', src: 'main-proj' }
          ]
        }
      }));
      writeFile(dir, 'public/domain-root.txt', 'domain root asset\n');
      writeFile(dir, 'main-proj/docmd.config.json', JSON.stringify({ title: 'Main Project' }));
      writeFile(dir, 'main-proj/docs/index.md', '# Workspace Main\n');

      const res = build(dir);
      assert(res.ok, 'Workspace build succeeds');

      const siteDomainRoot = path.join(dir, 'site', 'domain-root.txt');
      assert(fs.existsSync(siteDomainRoot), 'Workspace root public/domain-root.txt copied to site/domain-root.txt');
    }

    // -------------------------------------------------------------------------
    // Scenario 6: SPA static asset bypass and content-type fallback
    // -------------------------------------------------------------------------
    {
      const dir = setup('public-assets-spa-bypass');
      writeFile(dir, 'docs/index.md', '# Static Asset Docs\n\n[Download Specs](/specs.pdf)\n[Asset](/asset.txt)\n');
      writeFile(dir, 'public/asset.txt', 'Custom Static Content\n');
      const res = build(dir);
      assert(res.ok, 'Build succeeds for SPA static asset test');

      const clientJsPath = path.join(dir, 'site', 'assets', 'js', 'docmd-main.js');
      assert(fs.existsSync(clientJsPath), 'Client runtime docmd-main.js emitted in site/');
      if (fs.existsSync(clientJsPath)) {
        const clientJs = fs.readFileSync(clientJsPath, 'utf8');
        assert(clientJs.includes('window.location.assign'), 'Client JS contains window.location.assign fallback');
      }

      const srcMainJsPath = path.resolve('packages/ui/assets/js/docmd-main.js');
      if (fs.existsSync(srcMainJsPath)) {
        const srcMainJs = fs.readFileSync(srcMainJsPath, 'utf8');
        assert(srcMainJs.includes('isSpaNavigable'), 'Source docmd-main.js contains isSpaNavigable check');
        assert(srcMainJs.includes("ext !== 'html' && ext !== 'htm'"), 'Source docmd-main.js bypasses non-HTML file extensions');
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};