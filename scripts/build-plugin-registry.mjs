#!/usr/bin/env node
/**
 * --------------------------------------------------------------------
 * build-plugin-registry : single source of truth for the official plugin
 * and template catalog.
 *
 * Scans packages/{plugins,templates,engines}/*, reads each package's
 * `package.json#docmd` namespace, and emits a generated JSON registry
 * that the runtime loader (`packages/api/src/hooks.ts`) consumes.
 *
 * Why generated:
 *  - Eliminates drift between packages/ and the hand-maintained
 *    plugins/installer/registry/plugins.json (which used to be a
 *    third place to remember to update when adding a new plugin).
 *  - The `docmd` namespace in each package's package.json is the
 *    canonical source. This script is a thin reader.
 *
 * Why not read package.json's directly at runtime:
 *  - The published `@docmd/api` package doesn't carry the source
 *    `package.json` files of every plugin. Bundling a generated
 *    registry keeps the loader dependency-free and fast.
 *  - A build-time check can fail loudly if a package forgot a
 *    required field; a runtime check just warns.
 *
 * Run via: `node scripts/build-plugin-registry.mjs` (from the monorepo
 * root), or automatically as a `prebuild` step of `@docmd/api`.
 * --------------------------------------------------------------------
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const SCAN_DIRS = [
  { dir: join(ROOT, 'packages', 'plugins'),   kind: 'plugin',   scope: 'plugin'   },
  { dir: join(ROOT, 'packages', 'templates'), kind: 'template', scope: 'template' },
  { dir: join(ROOT, 'packages', 'engines'),   kind: 'engine',   scope: 'engine'   },
];

// Packages explicitly excluded from the registry.
const EXCLUDE = new Set(['@docmd/plugin-installer', '@docmd/engine-rust-binaries']);

const errors = [];
const registry = {
  $meta: {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-plugin-registry.mjs',
    packageCount: 0,
  },
};

/**
 * Derive the user-facing key (what goes in `docmd.config.json#plugins.<key>`)
 * from a package's npm name. `@docmd/plugin-search` → `search`,
 * `@docmd/template-summer` → `summer`, `@docmd/engine-js` → `js`.
 *
 * If the package author declared a custom `docmd.key` we honour that instead.
 */
function deriveKey(pkgName, docmd) {
  if (docmd && typeof docmd.key === 'string' && docmd.key.length > 0) {
    return docmd.key;
  }
  const match = pkgName.match(/^@docmd\/(?:plugin|template|engine)-(.+)$/);
  if (!match) {
    errors.push(`Cannot derive key for "${pkgName}" — name must match @docmd/{plugin|template|engine}-<key>.`);
    return '';
  }
  return match[1];
}

/**
 * Derive capabilities from the package's JS descriptor as a fallback if the
 * author didn't declare them in package.json#docmd.capabilities. We do a
 * lightweight regex scan — the loader does the real validation.
 */
function readCapabilitiesFromJs(pkgDir) {
  const candidates = [
    join(pkgDir, 'src', 'index.ts'),
    join(pkgDir, 'src', 'index.js'),
    join(pkgDir, 'dist', 'index.js'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const m = src.match(/capabilities\s*:\s*\[([^\]]*)\]/);
    if (m) {
      return m[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }
  return [];
}

let count = 0;

for (const { dir, kind } of SCAN_DIRS) {
  if (!existsSync(dir)) continue;
  if (!statSync(dir).isDirectory()) continue;
  for (const name of readdirSync(dir)) {
    const pkgPath = join(dir, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (EXCLUDE.has(pkg.name)) continue;
    // Skip non-loadable subpackages (data-only, build helpers, etc.)
    if (!pkg.main && !pkg.exports) continue;

    const docmd = pkg.docmd;
    const key = deriveKey(pkg.name, docmd);
    if (!key) continue;

    // Determine capabilities. Plugins + templates must declare them.
    // Engines don't participate in the hook system, so no capabilities.
    let capabilities = [];
    if (kind !== 'engine') {
      if (docmd && Array.isArray(docmd.capabilities) && docmd.capabilities.length > 0) {
        capabilities = docmd.capabilities.slice();
      } else {
        // Fallback: try to read from the JS descriptor. If we can't find
        // any, the build fails loudly — the author must declare them.
        capabilities = readCapabilitiesFromJs(join(dir, name));
        if (capabilities.length === 0) {
          errors.push(
            `${pkg.name}: missing "docmd.capabilities" in package.json. ` +
            `Add a "docmd" namespace with the hook capabilities this package implements.`
          );
          continue;
        }
        if (kind === 'template' && !capabilities.includes('template')) {
          capabilities = ['template', ...capabilities];
        }
      }
    }

    const entry = {
      package: pkg.name,
      description: pkg.description || '',
      configKey: key,
      defaultConfig: '{}',
      kind: (docmd && docmd.kind) || kind,
      displayName: (docmd && docmd.displayName) || name,
      tagline: (docmd && docmd.tagline) || pkg.description || '',
      capabilities,
    };
    if (docmd && docmd.preview) entry.preview = docmd.preview;
    if (docmd && docmd.requiresLiveServer !== undefined) entry.requiresLiveServer = docmd.requiresLiveServer;

    registry[key] = entry;
    count++;
  }
}

registry.$meta.packageCount = count;

if (errors.length) {
  console.error('✗ build-plugin-registry failed:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

const outDir = resolve(ROOT, 'packages', 'api', 'registry');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'plugins.generated.json');
writeFileSync(outFile, JSON.stringify(registry, null, 2) + '\n');
console.log(`✓ Wrote ${count} entries to ${outFile}`);