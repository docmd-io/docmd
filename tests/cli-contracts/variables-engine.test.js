/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Variables & Personalisation Engine Contracts
 * Covers build-time variable resolution, environment variables,
 * built-in system variables, config interpolation, and client-side runtime SDK.
 * --------------------------------------------------------------------
 */

import { runTestFile } from '../shared.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VariableRegistry,
  interpolateVariables,
  interpolateConfigVariables,
  parseVariableExpression
} from '../../packages/parser/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

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
  name: 'Variables and Personalisation Engine (build-time & client-side runtime)',
  emoji: '🧩',
  run: () => {
    // 1. Expression parser
    {
      const r1 = parseVariableExpression('foo');
      assert(r1.key === 'foo' && r1.fallback === undefined, 'Expression parser: simple variable');
      const r2 = parseVariableExpression('foo || "default"');
      assert(r2.key === 'foo' && r2.fallback === 'default', 'Expression parser: double-quoted fallback');
      const r3 = parseVariableExpression("user.apiKey || 'pk_live_123'");
      assert(r3.key === 'user.apiKey' && r3.fallback === 'pk_live_123', 'Expression parser: single-quoted fallback');
      const r4 = parseVariableExpression('year || 2026');
      assert(r4.key === 'year' && r4.fallback === '2026', 'Expression parser: numeric fallback');
    }

    // 2. Built-in system variables
    {
      const registry = new VariableRegistry({
        version: '0.9.9',
        siteTitle: 'Docmd Docs',
        siteBase: '/docs/'
      });

      const currentYear = String(new Date().getFullYear());
      assert(registry.get('docmd.version') === '0.9.9', 'Built-in docmd.version matches');
      assert(registry.get('DOCMD_VERSION') === '0.9.9', 'Built-in DOCMD_VERSION alias matches');
      assert(registry.get('docmd.buildYear') === currentYear, 'Built-in docmd.buildYear matches current year');
      assert(registry.get('BUILD_YEAR') === currentYear, 'Built-in BUILD_YEAR alias matches current year');
      assert(registry.get('site.title') === 'Docmd Docs', 'Built-in site.title matches');
      assert(registry.get('site.base') === '/docs/', 'Built-in site.base matches');
    }

    // 3. System environment variables
    {
      process.env.DOCMD_VAR_SERVER_PORT = '8080';
      process.env.CUSTOM_CI_BUILD_ID = 'build-49281';

      const registry = new VariableRegistry();
      assert(registry.get('SERVER_PORT') === '8080', 'DOCMD_VAR_* promoted directly');
      assert(registry.get('DOCMD_VAR_SERVER_PORT') === '8080', 'DOCMD_VAR_* accessible with full name');
      assert(registry.get('env.CUSTOM_CI_BUILD_ID') === 'build-49281', 'env.* resolves environment variables');

      delete process.env.DOCMD_VAR_SERVER_PORT;
      delete process.env.CUSTOM_CI_BUILD_ID;
    }

    // 4. Markdown interpolation with static variables and defaults
    {
      const registry = new VariableRegistry({
        configVariables: {
          HOMEPAGE: 'https://docmd.io',
          service: {
            endpoint: 'https://api.docmd.io'
          }
        }
      });

      const markdown = 'Visit {{ HOMEPAGE }} or API {{ service.endpoint }}. Version: {{ missingVersion || "1.0.0" }}.';
      const result = interpolateVariables(markdown, registry);
      assert(
        result === 'Visit https://docmd.io or API https://api.docmd.io. Version: 1.0.0.',
        'Markdown interpolation resolves variables and default fallbacks'
      );
    }

    // 5. Dynamic variables wrapped in DOM markers
    {
      const registry = new VariableRegistry();
      registry.markDynamic(['customDynamicVar']);

      const markdown = 'Welcome, {{ user.name || "Guest" }}! Your key: `{{ user.apiKey || "pk_test" }}`. Special: {{ customDynamicVar || "active" }}.';
      const result = interpolateVariables(markdown, registry);

      assert(result.includes('<span data-docmd-var="user.name" class="docmd-var">Guest</span>'), 'Dynamic user.name wrapped in data-docmd-var marker');
      assert(result.includes('<span data-docmd-var="user.apiKey" class="docmd-var">pk_test</span>'), 'Dynamic user.apiKey wrapped in data-docmd-var marker');
      assert(result.includes('<span data-docmd-var="customDynamicVar" class="docmd-var">active</span>'), 'Custom dynamic variable wrapped in marker');
    }

    // 5b. Page context, git metadata, and escaped expressions
    {
      const registry = new VariableRegistry({
        gitCommit: 'a1b2c3d',
        gitBranch: 'feat/test'
      });

      assert(registry.get('docmd.gitCommit') === 'a1b2c3d', 'docmd.gitCommit resolves injected commit');
      assert(registry.get('docmd.gitBranch') === 'feat/test', 'docmd.gitBranch resolves injected branch');
      assert(registry.get('git.commit') === 'a1b2c3d', 'git.commit alias resolves');

      const varContext = {
        pageTitle: 'My Guide',
        pageSlug: 'guide/intro',
        pagePath: '/guide/intro'
      };

      assert(registry.get('page.slug', varContext) === 'guide/intro', 'page.slug resolves from context');
      assert(registry.get('page.path', varContext) === '/guide/intro', 'page.path resolves from context');
      assert(registry.get('PAGE_SLUG', varContext) === 'guide/intro', 'PAGE_SLUG uppercase alias resolves');

      const escapedMarkdown = 'Literal: \\{{ docmd.version }} and Live: {{ docmd.version }}';
      const interpolated = interpolateVariables(escapedMarkdown, registry);
      assert(interpolated === 'Literal: {{ docmd.version }} and Live: 0.9.9', 'Escaped \\{{ ... }} preserves literal syntax');
    }

    // 6. Config string interpolation
    {
      const registry = new VariableRegistry({
        version: '0.9.9',
        siteTitle: 'My Project'
      });

      const currentYear = String(new Date().getFullYear());
      const config = {
        title: '{{ siteTitle || "Default Title" }}',
        footer: {
          copyright: '© {{ docmd.buildYear }} Acme Corp. Built with v{{ docmd.version }}.'
        },
        layout: {
          banners: {
            top: {
              content: 'Welcome to {{ siteTitle }} — Running on {{ docmd.version }}'
            }
          }
        }
      };

      const interpolated = interpolateConfigVariables(config, registry);
      assert(
        interpolated.footer.copyright === `© ${currentYear} Acme Corp. Built with v0.9.9.`,
        'Config footer copyright interpolated with year and version'
      );
      assert(
        interpolated.layout.banners.top.content === 'Welcome to My Project — Running on 0.9.9',
        'Config banner content interpolated with site title and version'
      );
    }

    // 7. Client runtime asset exists and is integrated into layouts
    {
      const runtimeJsPath = path.join(rootDir, 'packages/ui/assets/js/docmd-runtime.js');
      assert(fs.existsSync(runtimeJsPath), 'packages/ui/assets/js/docmd-runtime.js exists');

      const defaultLayoutPath = path.join(rootDir, 'packages/ui/templates/layout.ejs');
      const defaultLayout = fs.readFileSync(defaultLayoutPath, 'utf8');
      assert(defaultLayout.includes('assets/js/docmd-runtime.js'), 'default layout.ejs includes docmd-runtime.js');

      const summerLayoutPath = path.join(rootDir, 'packages/templates/summer/templates/layout.ejs');
      const summerLayout = fs.readFileSync(summerLayoutPath, 'utf8');
      assert(summerLayout.includes('assets/js/docmd-runtime.js'), 'summer layout.ejs includes docmd-runtime.js');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};