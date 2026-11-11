/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Layout, theming, navigation, and SEO metadata test suite:
 *   - Summer theme layout body source file attributes
 *   - External navigation link attributes & normalization
 *   - OKF concept description & keywords/tags merging
 *   - Title separator, titleAppend hierarchy, and SEO plugin enhancements
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
  name: 'Layout, theming, navigation, and SEO metadata contracts',
  emoji: '🎨',
  run: async () => {
    // 1. Summer theme renders data-source-file on body
    {
      const summerLayoutPath = path.resolve('packages/templates/summer/dist/templates/layout.ejs');
      assert(fs.existsSync(summerLayoutPath), 'Summer template layout exists at dist/templates/layout.ejs');

      const layoutContent = fs.readFileSync(summerLayoutPath, 'utf8');
      assert(
        layoutContent.includes('data-source-file="<%= sourceFile %>"'),
        'Summer template layout includes data-source-file on body element'
      );
    }

    // 2. Navigation EJS renders unescaped target/rel (<%-), and docmd-main.js normalizes target
    {
      const navEjs = fs.readFileSync(path.resolve('packages/ui/templates/navigation.ejs'), 'utf8');
      assert(
        navEjs.includes('<%- isExternal ? \'target="_blank" rel="noopener"\' : \'\' %>'),
        'navigation.ejs uses <%- to render unescaped target/rel attributes'
      );

      const bannerEjs = fs.readFileSync(path.resolve('packages/ui/templates/partials/banner.ejs'), 'utf8');
      assert(
        !bannerEjs.includes("<%= _isExternal ? 'target="),
        'banner.ejs uses <%- rather than <%= for external link target/rel attributes'
      );

      const mainJs = fs.readFileSync(path.resolve('packages/ui/assets/js/docmd-main.js'), 'utf8');
      assert(
        mainJs.includes("rawTarget = (link.getAttribute('target') || link.target || '').replace(/^[\"']|[\"']$/g, '')"),
        'docmd-main.js normalizes target attribute by stripping surrounding quotes'
      );
      assert(
        mainJs.includes("rel.includes('noopener')"),
        'docmd-main.js respects rel="noopener" on external links'
      );
      assert(
        mainJs.includes("rel.includes('external')"),
        'docmd-main.js respects rel="external" on external links'
      );
      assert(
        mainJs.includes("link.hasAttribute('data-spa-ignore')"),
        'docmd-main.js respects data-spa-ignore on links'
      );
    }

    // 3. OKF concept description and keywords/tags resolution
    {
      const proj = setup('okf-metadata-resolution');
      writeFile(proj, 'docs/index.md', [
        '---',
        'title: "Home Concept"',
        'description: "Overview description for OKF"',
        'keywords: ["knowledge", "manifest"]',
        'tags: ["core"]',
        '---',
        '# Home Concept\n\nContent here.'
      ].join('\n') + '\n');
      writeFile(proj, 'docs/guides/quickstart.md', [
        '---',
        'title: "Quickstart Guide"',
        'description: "Getting started with docmd"',
        'keywords: "quickstart, guides"',
        '---',
        '# Quickstart\n\nGuide content.'
      ].join('\n') + '\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'OKF Test',
        src: './docs',
        out: './site',
        plugins: {
          okf: {}
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'OKF build succeeds with OKF plugin');

      const okfYaml = fs.readFileSync(path.join(proj, 'site/okf/okf.yaml'), 'utf8');
      assert(okfYaml.includes('description: "Overview description for OKF"'), 'okf.yaml concepts contain page description');
      assert(okfYaml.includes('description: "Getting started with docmd"'), 'okf.yaml guides contain page description');

      const bundleJson = JSON.parse(fs.readFileSync(path.join(proj, 'site/okf/_meta/bundle.json'), 'utf8'));
      const homeConcept = bundleJson.concepts.find(c => c.id === 'root');
      const quickConcept = bundleJson.concepts.find(c => c.id === 'guides-quickstart');

      assert(homeConcept && homeConcept.description === 'Overview description for OKF', 'bundle.json has concept description');
      assert(homeConcept && homeConcept.tags.includes('core') && homeConcept.tags.includes('knowledge'), 'tags merged from both tags and keywords');
      assert(quickConcept && quickConcept.tags.includes('quickstart') && quickConcept.tags.includes('guides'), 'tags parsed from comma-separated keywords string');
    }

    // 4. Title separator, title append hierarchy, and SEO plugin enhancements
    {
      const proj = setup('title-and-seo-test');
      writeFile(proj, 'docs/index.md', [
        '---',
        'title: "docmd - Home Page"',
        'titleAppend: false',
        'ldJson:',
        '  "@type": "SoftwareApplication"',
        '  "name": "docmd"',
        '---',
        '# Home\n\nWelcome home.'
      ].join('\n') + '\n');

      writeFile(proj, 'docs/guide.md', [
        '---',
        'title: "User Guide"',
        '---',
        '# Guide\n\nGuide content.'
      ].join('\n') + '\n');

      writeFile(proj, 'docs/custom-sep.md', [
        '---',
        'title: "Custom Sep Page"',
        'titleSeparator: "/"',
        '---',
        '# Custom Sep\n\nContent.'
      ].join('\n') + '\n');

      writeFile(proj, 'docs/no-meta.md', [
        '---',
        'title: "No Meta Page"',
        'components:',
        '  meta: false',
        '---',
        '# No Meta\n\nContent.'
      ].join('\n') + '\n');

      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Title Docs',
        url: 'https://example.com/docs',
        src: './docs',
        out: './site',
        layout: {
          titleSeparator: '|'
        },
        organization: {
          name: 'docmd Organization',
          url: 'https://docmd.io',
          logo: 'assets/logo.png',
          sameAs: ['https://github.com/docmd-io/docmd']
        },
        plugins: {
          seo: {}
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Title & SEO: build succeeds');

      const homeHtml = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      const guideHtml = fs.readFileSync(path.join(proj, 'site/guide/index.html'), 'utf8');
      const customSepHtml = fs.readFileSync(path.join(proj, 'site/custom-sep/index.html'), 'utf8');
      const noMetaHtml = fs.readFileSync(path.join(proj, 'site/no-meta/index.html'), 'utf8');

      // Home: titleAppend: false suppresses siteTitle
      assert(homeHtml.includes('<title>docmd - Home Page</title>'), 'Title & SEO: frontmatter titleAppend: false suppresses site title in <title>');
      assert(homeHtml.includes('<meta property="og:title" content="docmd - Home Page">'), 'Title & SEO: og:title matches <title> without site title');
      assert(homeHtml.includes('<meta name="twitter:title" content="docmd - Home Page">'), 'Title & SEO: twitter:title matches <title>');
      assert(homeHtml.includes('"@type":"Organization"'), 'Title & SEO: Organization schema injected on home page');
      assert(homeHtml.includes('"@type":"WebSite"'), 'Title & SEO: WebSite schema injected on home page');
      assert(homeHtml.includes('"@type":"SoftwareApplication"'), 'Title & SEO: custom frontmatter ldJson injected');

      // Guide: uses layout.titleSeparator: '|'
      assert(guideHtml.includes('<title>User Guide | Title Docs</title>'), 'Title & SEO: layout.titleSeparator: "|" formatted as " | " in <title>');
      assert(guideHtml.includes('<meta property="og:title" content="User Guide | Title Docs">'), 'Title & SEO: og:title uses layout separator');
      assert(guideHtml.includes('<meta property="og:site_name" content="Title Docs">'), 'Title & SEO: og:site_name matches site title');
      assert(guideHtml.includes('"@type":"BreadcrumbList"'), 'Title & SEO: BreadcrumbList schema generated for guide page');
      const breadcrumbMatch = guideHtml.match(/<script type="application\/ld\+json">\s*({[\s\S]*?"@type":"BreadcrumbList"[\s\S]*?})\s*<\/script>/);
      assert(breadcrumbMatch, 'Title & SEO: breadcrumbs JSON-LD script block found');
      const breadcrumbData = JSON.parse(breadcrumbMatch[1]);
      assert(Array.isArray(breadcrumbData.itemListElement), 'Title & SEO: itemListElement is an array');
      assert(breadcrumbData.itemListElement.length >= 2, 'Title & SEO: BreadcrumbList contains at least 2 items');
      breadcrumbData.itemListElement.forEach((item, i) => {
        assert(item['@type'] === 'ListItem', `Title & SEO: item ${i + 1} has @type ListItem`);
        assert(item.position === i + 1, `Title & SEO: item ${i + 1} has contiguous position`);
        assert(typeof item.item === 'string' && item.item.length > 0, `Title & SEO: item ${i + 1} has required 'item' URL`);
      });

      // Custom Sep: frontmatter titleSeparator: "/"
      assert(customSepHtml.includes('<title>Custom Sep Page / Title Docs</title>'), 'Title & SEO: page frontmatter titleSeparator: "/" overrides layout');

      // No Meta: components.meta: false suppresses SEO meta tags
      assert(!noMetaHtml.includes('<meta property="og:title"'), 'Title & SEO: components.meta: false suppresses SEO meta tags');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};

if (process.argv[1] && process.argv[1].endsWith('layout-theming.test.js')) {
  console.log(`Running ${test.name}...`);
  test.run().then(() => {
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
