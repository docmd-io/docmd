/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import path from 'path';
import fs from 'fs/promises';
import esbuild from 'esbuild';
import * as ui from '@docmd/ui';
import * as themes from '@docmd/themes';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { TUI } from '@docmd/tui';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path Constants
const PKG_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PKG_ROOT, 'public');

// Asset Discovery
const SOURCE_ASSETS_DIR = (async () => {
    const srcPath = path.join(PKG_ROOT, 'src');
    try {
        await fs.access(srcPath);
        return srcPath;
    } catch {
        return __dirname;
    }
})();

async function build(outputPath?: string) {
    const elapsed = TUI.timer();
    const sp = TUI.spinner('Building Live Editor');

    const finalOutputDir = outputPath ? path.join(outputPath, 'dist') : PUBLIC_DIR;

    try {
        // 1. Prepare Dist
        await fs.rm(finalOutputDir, { recursive: true, force: true });
        await fs.mkdir(finalOutputDir, { recursive: true });

        // 2. Generate Shims
        const assetsDir = await SOURCE_ASSETS_DIR;
        const shimPath = path.join(__dirname, 'shims.js');
        await fs.writeFile(shimPath, `import { Buffer } from 'buffer'; globalThis.Buffer = Buffer;`);

        // 3. Template Plugin
        const templatePlugin = {
            name: 'docmd-templates',
            setup(build) {
                build.onResolve({ filter: /^virtual:docmd-templates$/ }, args => ({
                    path: args.path, namespace: 'docmd-templates-ns',
                }));
                build.onLoad({ filter: /.*/, namespace: 'docmd-templates-ns' }, async () => {
                    const templatesDir = ui.getTemplatesDir();
                    const templates = {};
                    const tryRead = async (f) => {
                        const p = path.join(templatesDir, f);
                        try { return await fs.readFile(p, 'utf8'); } catch { return null; }
                    };
                    const files = await fs.readdir(templatesDir);
                    for (const file of files) {
                        if (file.endsWith('.ejs')) templates[file] = await tryRead(file);
                    }
                    try {
                        const partialsDir = path.join(templatesDir, 'partials');
                        const partials = await fs.readdir(partialsDir);
                        for (const file of partials) {
                            if (file.endsWith('.ejs') || file.endsWith('.js')) {
                                templates[`partials/${file}`] = await tryRead(`partials/${file}`);
                            }
                        }
                    } catch { /* Ignore missing partials */ }
                    return { contents: `export default ${JSON.stringify(templates)};`, loader: 'js' };
                });
            },
        };

        // 4. Node Shim Plugin
        const nodeShimPlugin = {
            name: 'node-deps-shim',
            setup(build) {
                build.onResolve({ filter: /^(node:)?path$/ }, args => ({ path: args.path, namespace: 'path-shim' }));
                build.onLoad({ filter: /.*/, namespace: 'path-shim' }, () => ({
                    contents: `
                        export const join = (...a) => a.filter(Boolean).join('/');
                        export const resolve = (...a) => '/' + a.filter(Boolean).join('/');
                        export const basename = (p) => p ? p.split(/[\\\\/]/).pop() : '';
                        export const dirname = (p) => p ? p.split(/[\\\\/]/).slice(0, -1).join('/') || '.' : '.';
                        export const extname = (p) => p ? '.' + p.split('.').pop() : '';
                        export const sep = '/';
                        export default { join, resolve, basename, dirname, extname, sep };
                    `, loader: 'js'
                }));
                build.onResolve({ filter: /^(node:)?url$/ }, args => ({ path: args.path, namespace: 'url-shim' }));
                build.onLoad({ filter: /.*/, namespace: 'url-shim' }, () => ({
                    contents: `
                        export const fileURLToPath = (u) => typeof u === 'string' ? u : (u ? u.pathname || '' : '');
                        export const URL = globalThis.URL;
                        export default { fileURLToPath, URL };
                    `, loader: 'js'
                }));
                build.onResolve({ filter: /^(node:)?fs(\/promises)?|fs-extra$/ }, args => ({ path: args.path, namespace: 'fs-shim' }));
                build.onLoad({ filter: /.*/, namespace: 'fs-shim' }, () => ({
                    contents: `
                        export const promises = {};
                        export const existsSync = () => false;
                        export const readFileSync = () => '{}';
                        export default { promises, existsSync, readFileSync };
                    `, loader: 'js'
                }));
            }
        };

        // 5. Bundle JS
        await esbuild.build({
            entryPoints: [path.join(assetsDir, 'browser-entry.ts')],
            bundle: true,
            outfile: path.join(finalOutputDir, 'docmd-live.js'),
            platform: 'browser',
            format: 'iife',
            globalName: 'docmd',
            minify: true,
            define: {
                'process.env.NODE_ENV': '"production"',
                'import.meta.url': 'window.location.href'
            },
            inject: [shimPath],
            plugins: [templatePlugin, nodeShimPlugin]
        });

        // 6. Copy Static Assets, Auto-Load Presets & Inject Version
        const livePkg = JSON.parse(await fs.readFile(path.join(PKG_ROOT, 'package.json'), 'utf8'));
        let indexHtml = await fs.readFile(path.join(assetsDir, 'index.html'), 'utf8');
        indexHtml = indexHtml.replace(/content="docmd v[^"]*"/, `content="docmd v${livePkg.version}"`);

        const presetsDir = path.join(assetsDir, 'presets');
        const snippets: Record<string, string> = {};
        try {
            const presetFiles = await fs.readdir(presetsDir);
            for (const file of presetFiles) {
                if (file.endsWith('.md')) {
                    const key = path.basename(file, '.md');
                    snippets[key] = await fs.readFile(path.join(presetsDir, file), 'utf8');
                }
            }
        } catch { /* Ignore if missing presets */ }

        if (Object.keys(snippets).length > 0) {
            indexHtml = indexHtml.replace(
                /const SNIPPETS = \{[\s\S]*?\};/,
                () => `const SNIPPETS = ${JSON.stringify(snippets, null, 4)};`
            );
        }

        await fs.writeFile(path.join(finalOutputDir, 'index.html'), indexHtml);
        await fs.copyFile(path.join(assetsDir, 'docmd-live.css'), path.join(finalOutputDir, 'docmd-live.css'));

        const cssDest = path.join(finalOutputDir, 'assets/css');
        const jsDest = path.join(finalOutputDir, 'assets/js');
        await fs.mkdir(cssDest, { recursive: true });
        await fs.mkdir(jsDest, { recursive: true });
        await fs.copyFile(path.join(assetsDir, 'docmd-live-preview.css'), path.join(cssDest, 'docmd-live-preview.css'));

        const copy = async (src, destName) => {
            try {
                await fs.copyFile(src, path.join(path.extname(destName) === '.js' ? jsDest : cssDest, destName));
            } catch { 
                TUI.warn(`Missing asset: ${path.basename(src)}`);
            }
        };

        await copy(path.join(ui.getAssetsDir(), 'css/docmd-main.css'), 'docmd-main.css');
        await copy(path.join(ui.getAssetsDir(), 'css/docmd-highlight-light.css'), 'docmd-highlight-light.css');
        await copy(path.join(ui.getAssetsDir(), 'css/docmd-highlight-dark.css'), 'docmd-highlight-dark.css');
        await copy(path.join(ui.getAssetsDir(), 'js/docmd-main.js'), 'docmd-main.js');

        const mermaidPkgPath = require.resolve('@docmd/plugin-mermaid/package.json');
        const mermaidDir = path.dirname(mermaidPkgPath);
        const mermaidSrc = path.join(mermaidDir, 'dist', 'init-mermaid.js');
        await fs.copyFile(mermaidSrc, path.join(jsDest, 'init-mermaid.js'));

        const themesDir = themes.getThemesDir();
        const themeFiles = await fs.readdir(themesDir);
        for (const t of themeFiles) {
            if (t.endsWith('.css')) {
                const cleanName = t.replace('docmd-theme-', '');
                await copy(path.join(themesDir, t), `docmd-theme-${cleanName}`);
            }
        }

        try {
            await fs.copyFile(path.join(ui.getAssetsDir(), 'favicon.ico'), path.join(finalOutputDir, 'favicon.ico'));
        } catch { 
            TUI.warn('Missing Favicon');
        }

        const relPath = path.relative(process.cwd(), finalOutputDir);
        sp.done(`Live Editor built in ./${relPath} (${elapsed()})`);
    } catch (e) {
        sp.fail('Live build failed');
        TUI.error('Live build failed', e.message);
        process.exit(1);
    }
}

export { build };

if (process.argv[1]?.endsWith('build.js')) {
    build();
}