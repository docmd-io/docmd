/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * URL Routing integration tests
 * 
 * Verifies:
 *   1. CSS rule for no-toc in docmd-main.css and summer.css.
 *   2. Page-relative links in workspace subdirectory pages resolve to the correct path.
 *   3. Custom asset paths and links in Markdown under subpath builds (e.g. GitHub Pages).
 * 
 * Run: `node tests/runner.js --only=url-routing`
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  setup,
  writeFile,
  build,
  runTestFile
} from '../shared.js';
import { execSync } from 'node:child_process';
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

function extractHrefsAndSrcs(html) {
  const hrefs = [];
  const srcs = [];
  const hrefRe = /href=["']([^"']*)["']/gi;
  const srcRe = /src=["']([^"']*)["']/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    hrefs.push(m[1]);
  }
  while ((m = srcRe.exec(html)) !== null) {
    srcs.push(m[1]);
  }
  return { hrefs, srcs };
}

export const test = runTestFile({
  name: 'URL routing architecture stability',
  emoji: '🗺️',
  run: () => {
    const rootDir = path.resolve(import.meta.dirname, '..', '..');

    // 1. Dynamic TOC Class CSS support
    {
      const docmdMainCssPath = path.join(rootDir, 'packages/ui/assets/css/docmd-main.css');
      const docmdMainCss = fs.readFileSync(docmdMainCssPath, 'utf8');
      assert(docmdMainCss.includes('.no-toc .toc-sidebar'), 'TOC CSS: docmd-main.css has .no-toc .toc-sidebar rule');

      const docmdMainJsPath = path.join(rootDir, 'packages/ui/assets/js/docmd-main.js');
      const docmdMainJs = fs.readFileSync(docmdMainJsPath, 'utf8');
      assert(docmdMainJs.includes('function updateTocClass()'), 'TOC JS: docmd-main.js has updateTocClass defined');
      assert(docmdMainJs.includes('updateTocClass()'), 'TOC JS: docmd-main.js calls updateTocClass');
    }

    // 2. Page-relative links in workspace project subdirectory resolve correctly
    {
      const dir = setup('url-routing-workspace-nested-links');
      
      // Setup workspace structure
      fs.mkdirSync(path.join(dir, 'docs-main'), { recursive: true });
      writeFile(dir, 'docs-main/index.md', '# Main Home\n');
      writeFile(dir, 'docs-main/docmd.config.json', JSON.stringify({
        title: 'Main',
        src: '.',
        out: '../site'
      }) + '\n');

      fs.mkdirSync(path.join(dir, 'docs-proj1/nested/subdir'), { recursive: true });
      writeFile(dir, 'docs-proj1/nested/subdir/page-a.md', '# Page A\n\n[link to page B](page-b.md)\n');
      writeFile(dir, 'docs-proj1/nested/subdir/page-b.md', '# Page B\n');
      
      writeFile(dir, 'docs-proj1/docmd.config.json', JSON.stringify({
        title: 'Proj1',
        src: '.',
        out: '../site'
      }) + '\n');

      writeFile(dir, 'docmd.config.json', JSON.stringify({
        workspace: {
          projects: [
            { title: 'main', prefix: '/', src: './docs-main' },
            { title: 'proj1', prefix: '/proj1', src: './docs-proj1' }
          ]
        }
      }) + '\n');


      execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe' });

      const pageAHtml = fs.readFileSync(path.join(dir, 'site/proj1/nested/subdir/page-a/index.html'), 'utf8');
      const { hrefs } = extractHrefsAndSrcs(pageAHtml);

      // In workspace build:
      // The base is '/proj1/'
      // From '/proj1/nested/subdir/page-a/', the link 'page-b.md' is a relative link (no leading slash).
      // Under url-utils logic, it should resolve to '/proj1/nested/subdir/page-b/' or relative '../page-b/'.
      // If we use buildRelativeUrl/buildContextualUrl with context.pathname, it rewrites to '/proj1/nested/subdir/page-b/'.
      const targetLink = hrefs.find(h => h.includes('page-b'));
      assert(targetLink === '../../../nested/subdir/page-b/', `Workspace nested link: relative link resolves correctly to absolute subpath (got: ${targetLink})`);
    }

    // 3. Custom assets and links under subpath builds (e.g. GitHub Pages)
    {
      const dir = setup('url-routing-subpath-assets');
      
      writeFile(dir, 'docs/index.md', '# Home\n\n![custom image](/assets/img.png)\n[custom link](/guide/page.md)\n');
      fs.mkdirSync(path.join(dir, 'docs/guide'), { recursive: true });
      writeFile(dir, 'docs/guide/page.md', '# Guide Page\n');

      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Subpath Site',
        src: './docs',
        out: './site',
        url: 'https://mgks.github.io/some-project'
      }) + '\n');

      execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe' });

      const indexHtml = fs.readFileSync(path.join(dir, 'site/index.html'), 'utf8');
      const { hrefs, srcs } = extractHrefsAndSrcs(indexHtml);

      // Verify no base tag is emitted
      assert(!indexHtml.includes('<base href='), 'Subpath build: no base tag emitted');

      // Verify custom image resolves relatively
      const imgsrc = srcs.find(s => s.includes('img.png'));
      assert(imgsrc === './assets/img.png', `Subpath build: custom root-relative image is rewritten with page-relative prefix (got: ${imgsrc})`);

      // Verify custom link resolves relatively
      const targetLink = hrefs.find(h => h.includes('guide'));
      assert(targetLink === './guide/page/', `Subpath build: custom root-relative link is rewritten with page-relative prefix (got: ${targetLink})`);
    }

    // 4. Auto navigation clickable folders and index deduplication
    {
      const dir = setup('url-routing-auto-nav-folders');
      writeFile(dir, 'docs/index.md', '# Home\n');
      
      fs.mkdirSync(path.join(dir, 'docs/de'), { recursive: true });
      writeFile(dir, 'docs/de/index.md', '# De Home\n');
      writeFile(dir, 'docs/de/page-a.md', '# De Page A\n');

      fs.mkdirSync(path.join(dir, 'docs/fr'), { recursive: true });
      writeFile(dir, 'docs/fr/index.md', '# Fr Home\n');

      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Auto Nav Test',
        src: './docs',
        out: './site'
      }) + '\n');

      execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe' });

      const indexHtml = fs.readFileSync(path.join(dir, 'site/index.html'), 'utf8');

      // 1. The folder 'de' has other pages besides index.md.
      // So 'De' is collapsible and has path pointing to './de/'
      assert(indexHtml.includes('href="./de/"') && indexHtml.includes('collapsible'), 
        'Auto Nav: Folder "de" with children is collapsible and has a clickable link to "./de/"');

      // 2. The folder 'de' should not contain a redundant child link to 'De Home' or './de/' under its submenu
      const deSubmenuStart = indexHtml.indexOf('href="./de/"');
      const deSubmenuEnd = indexHtml.indexOf('</ul>', deSubmenuStart);
      const deSubmenu = indexHtml.slice(deSubmenuStart, deSubmenuEnd);
      // It should not have a nested <a> pointing to "./de/" inside the submenu
      const occurrenceCount = (deSubmenu.match(/href="\.\/de\/"/g) || []).length;
      assert(occurrenceCount === 1, 'Auto Nav: Folder "de" does not contain a redundant child link to its own index page');

      // 3. The folder 'fr' only has index.md. So it is rendered as a simple, non-collapsible link pointing to './fr/'
      // Find the list item containing './fr/' and verify it doesn't have collapsible class
      const frIndex = indexHtml.indexOf('href="./fr/"');
      const frLiStart = indexHtml.lastIndexOf('<li', frIndex);
      const frLiEnd = indexHtml.indexOf('>', frLiStart);
      const frLiTag = indexHtml.slice(frLiStart, frLiEnd);
      assert(!frLiTag.includes('collapsible'), 'Auto Nav: Folder "fr" with only an index page is rendered as a simple non-collapsible link');
    }

    // 5. Zero-config root homepage SPA link synchronization
    {
      const docmdMainJsPath = path.join(rootDir, 'packages/ui/assets/js/docmd-main.js');
      const docmdMainJs = fs.readFileSync(docmdMainJsPath, 'utf8');

      // Verify docmd-main.js does not turn empty string newHref into '#'
      assert(
        docmdMainJs.includes("if (newHref !== null && newHref !== undefined && newHref !== '#')") ||
        docmdMainJs.includes("newHref !== null"),
        'SPA Router: docmd-main.js properly checks newHref to preserve and resolve empty homepage hrefs without falling back to #'
      );
      assert(
        !docmdMainJs.includes("oldA.setAttribute('href', newHref || '#')"),
        'SPA Router: docmd-main.js does not perform falsy fallback (newHref || "#") which corrupts <a href=""> into <a href="#">'
      );
    }

    // 6. Banner rendering in Summer and default templates
    {
      const proj = setup('banner-rendering-summer');
      writeFile(proj, 'docs/index.md', '# Banner Test\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Banner Test',
        theme: { template: 'summer' },
        layout: {
          banner: {
            content: '**v0.9.1 is live!** — Read technical docs.',
            type: 'info',
            icon: 'sparkles',
            dismissible: true,
            link: { text: 'Read more', url: '/changelog' }
          }
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Banner Test: build with summer template and object banner succeeds');
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');

      assert(html.includes('summer-banner'), 'Banner Test: summer-banner element rendered');
      assert(html.includes('<strong>v0.9.1 is live!</strong>'), 'Banner Test: Markdown content formatted inside summer-banner');
      assert(html.includes('summer-banner__icon'), 'Banner Test: Icon rendered inside summer-banner');
      assert(html.includes('summer-banner__link'), 'Banner Test: Link rendered inside summer-banner');
      assert(html.includes('data-docmd-banner-dismiss'), 'Banner Test: Dismiss button present inside summer-banner');
      assert(html.includes('summer-banner--info'), 'Banner Test: Type class applied to summer-banner');
    }

    // 7. Multi-position banner in default template (top, sidebar-top, sidebar-bottom, toc-top, toc-bottom)
    {
      const proj = setup('multi-position-banners-default');
      writeFile(proj, 'docs/index.md', '# Multi Banner\n\n## Section One\n\nSome text.\n\n## Section Two\n\nMore text.\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Multi Banner Test',
        layout: {
          banners: [
            {
              position: 'top',
              content: '**Top Announcement**',
              image: 'https://docmd.io/disallowed.png', // Must be ignored on top
              link: 'https://docmd.io'
            },
            {
              position: 'sidebar-top',
              content: 'Sidebar Top Promotion',
              image: '/assets/sidebar-ad.png',
              link: 'https://cloud.docmd.io'
            },
            {
              position: 'sidebar-bottom',
              content: 'Sidebar Bottom Notice',
              type: 'warning'
            },
            {
              position: 'toc-top',
              content: 'TOC Top Sponsor',
              image: 'https://docmd.io/sponsor.png'
            },
            {
              position: 'toc-bottom',
              content: 'TOC Bottom Survey',
              link: 'https://docmd.io/survey'
            }
          ]
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Multi-Banner Test: build with multi-position banners succeeds');
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');

      // Top banner checks
      assert(html.includes('data-docmd-banner="top"'), 'Multi-Banner Test: top banner rendered');
      assert(html.includes('Top Announcement'), 'Multi-Banner Test: top banner content rendered');
      assert(!html.includes('disallowed.png'), 'Multi-Banner Test: top banner disallows/strips image');

      // Sidebar banner checks
      assert(html.includes('data-docmd-banner="sidebar-top"'), 'Multi-Banner Test: sidebar-top banner rendered');
      assert(html.includes('sidebar-ad.png'), 'Multi-Banner Test: sidebar-top image rendered');
      assert(html.includes('Sidebar Top Promotion'), 'Multi-Banner Test: sidebar-top text rendered');
      assert(html.includes('data-docmd-banner="sidebar-bottom"'), 'Multi-Banner Test: sidebar-bottom banner rendered');
      assert(html.includes('Sidebar Bottom Notice'), 'Multi-Banner Test: sidebar-bottom text rendered');

      // TOC banner checks
      assert(html.includes('data-docmd-banner="toc-top"'), 'Multi-Banner Test: toc-top banner rendered');
      assert(html.includes('sponsor.png'), 'Multi-Banner Test: toc-top image rendered');
      assert(html.includes('data-docmd-banner="toc-bottom"'), 'Multi-Banner Test: toc-bottom banner rendered');
      assert(html.includes('TOC Bottom Survey'), 'Multi-Banner Test: toc-bottom text rendered');
    }

    // 8. Multi-position banner in Summer template
    {
      const proj = setup('multi-position-banners-summer');
      writeFile(proj, 'docs/index.md', '# Summer Multi Banner\n\n## Heading A\n\nText A\n\n## Heading B\n\nText B\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Summer Multi Banner Test',
        theme: { template: 'summer' },
        layout: {
          banners: {
            'top': { content: 'Summer Top Bar', link: 'https://docmd.io' },
            'sidebar-top': { content: 'Summer Sidebar Top', image: '/img/summer.png' },
            'toc-bottom': { content: 'Summer TOC Bottom', link: 'https://docmd.io/docs' }
          }
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Summer Multi-Banner Test: build succeeds');
      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');

      assert(html.includes('summer-banner--pos-top') || html.includes('data-docmd-banner="top"'), 'Summer Multi-Banner Test: top banner rendered');
      assert(html.includes('summer-banner--pos-sidebar-top'), 'Summer Multi-Banner Test: sidebar-top banner rendered');
      assert(html.includes('summer-banner--pos-toc-bottom'), 'Summer Multi-Banner Test: toc-bottom banner rendered');
      assert(html.includes('Summer Sidebar Top'), 'Summer Multi-Banner Test: sidebar-top text rendered');
      assert(html.includes('summer.png'), 'Summer Multi-Banner Test: sidebar-top image rendered');
    }

    // 9. Banner Hierarchy Resolution: Version overrides Language / Project
    {
      const proj = setup('banner-hierarchy');
      writeFile(proj, 'docs/index.md', '# Root Docs\n');
      writeFile(proj, 'docs-v2/index.md', '# V2 Docs\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Hierarchy Test',
        layout: {
          banners: {
            'top': { content: 'Project Root Top Banner' },
            'sidebar-top': { content: 'Project Root Sidebar Banner' }
          }
        },
        versions: {
          current: 'v1',
          all: [
            { id: 'v1', dir: 'docs', label: 'v1.0' },
            {
              id: 'v2',
              dir: 'docs-v2',
              label: 'v2.0',
              banners: {
                'top': { content: 'Version 2 Overridden Banner' }
              }
            }
          ]
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Banner Hierarchy: build with version override succeeds');

      const v1Html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      assert(v1Html.includes('Project Root Top Banner'), 'Banner Hierarchy: v1 uses project top banner');
      assert(v1Html.includes('Project Root Sidebar Banner'), 'Banner Hierarchy: v1 uses project sidebar banner');

      const v2Html = fs.readFileSync(path.join(proj, 'site/v2/index.html'), 'utf8');
      assert(v2Html.includes('Version 2 Overridden Banner'), 'Banner Hierarchy: v2 overrides top banner');
      assert(v2Html.includes('Project Root Sidebar Banner'), 'Banner Hierarchy: v2 inherits project sidebar banner');
    }

    // 10. Banner dismissable alias and card persistence defaults
    {
      const proj = setup('banner-dismissable-contracts');
      writeFile(proj, 'docs/index.md', '# Banner Dismissable Contracts\n\nContent.\n');
      writeFile(proj, 'docmd.config.json', JSON.stringify({
        title: 'Banner Dismissable Contracts',
        layout: {
          banners: {
            'top': {
              content: 'Top Non Dismissible',
              dismissable: false // using "dismissable" spelling
            },
            'toc-top': {
              content: 'TOC Card Default Non Dismissible'
              // omitted dismissible -> should default to false
            },
            'sidebar-bottom': {
              content: 'Sidebar Card Explicit Dismissible',
              dismissable: true // explicitly opt-in with alias
            }
          }
        }
      }, null, 2) + '\n');

      const result = build(proj);
      assert(result.ok, 'Banner Dismissable: build succeeds');

      const html = fs.readFileSync(path.join(proj, 'site/index.html'), 'utf8');
      // Top banner with dismissable: false must NOT have is-dismissible or data-docmd-banner-dismiss inside its top banner
      assert(!html.includes('docmd-banner--pos-top is-dismissible'), 'Banner Dismissable: top with dismissable: false is not dismissible');
      // TOC card banner with omitted dismissible must NOT have is-dismissible
      assert(!html.includes('docmd-banner--pos-toc-top is-dismissible'), 'Banner Dismissable: toc-top omitted dismissible defaults to persistent');
      // Sidebar card with dismissable: true MUST have is-dismissible
      assert(html.includes('docmd-banner--pos-sidebar-bottom is-dismissible'), 'Banner Dismissable: sidebar-bottom with dismissable: true is dismissible');
    }

    // 11. Header logo link re-resolution in docmd-main.js during SPA navigation
    {
      const docmdMainJsPath = path.join(rootDir, 'packages/ui/assets/js/docmd-main.js');
      const docmdMainJs = fs.readFileSync(docmdMainJsPath, 'utf8');
      assert(docmdMainJs.includes('.sidebar-header a, a.logo-link, a.summer-logo'), 'SPA Navigation: docmd-main.js queries sidebar header and logo links');
      assert(docmdMainJs.includes('oldHeaderLinks.forEach'), 'SPA Navigation: docmd-main.js syncs oldHeaderLinks to absolute URLs');
    }

    // 12. Search client respects versioned base URLs
    {
      const searchClientPath = path.join(rootDir, 'packages/plugins/search/src/client.ts');
      const searchClient = fs.readFileSync(searchClientPath, 'utf8');
      assert(searchClient.includes('configuredBaseSegments'), 'Search Client: respects configuredBaseSegments');
      assert(searchClient.includes('while (checkIdx >= minBaseLength)'), 'Search Client: stops stripping when reaching base length');

      // Verify bundled output matches
      const searchDistPath = path.join(rootDir, 'packages/plugins/search/dist/docmd-search.js');
      assert(fs.existsSync(searchDistPath), 'Search Client: dist/docmd-search.js exists');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};