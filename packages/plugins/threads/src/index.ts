import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { setup as setupContainers } from './plugin/containers.js';
import { setup as setupHighlightRule } from './plugin/highlight-rule.js';
import { actions } from './plugin/actions.js';
import { scriptLiteral } from '@docmd/utils';
import type { PluginDescriptor } from '@docmd/api';

export const plugin: PluginDescriptor = {
  name: 'threads',
  version: '0.9.5',
  capabilities: ['markdown', 'body', 'assets', 'actions', 'translations'],
  requiresLiveServer: true
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.resolve(__dirname, '..', 'i18n');

function loadPluginStrings(localeId: string): Record<string, string> {
  try {
    const localePath = path.join(i18nDir, `${localeId}.json`);
    if (fs.existsSync(localePath)) {
      return JSON.parse(fs.readFileSync(localePath, 'utf8'));
    }
  } catch { /* fallback below */ }
  try {
    const enPath = path.join(i18nDir, 'en.json');
    if (fs.existsSync(enPath)) {
      return JSON.parse(fs.readFileSync(enPath, 'utf8'));
    }
  } catch { /* silent */ }
  return {};
}

export function translations(localeId: string): Record<string, string> {
  return loadPluginStrings(localeId || 'en');
}

export function markdownSetup(md: any, _options?: any): void {
  setupContainers(md);
  setupHighlightRule(md);
}

export function generateScripts(config: any, options?: any): { headScriptsHtml: string; bodyScriptsHtml: string } {
  // S-7: parse authors.json, never inline the raw file text. scriptLiteral
  // escapes </script, <!--, U+2028, U+2029 so the JSON is safe inside <script>.
  let authors: unknown = {};
  try {
    const srcDir = config.src || 'docs';
    const authorsPath = path.resolve(srcDir, '.threads', 'authors.json');
    if (fs.existsSync(authorsPath)) {
      const parsed = JSON.parse(fs.readFileSync(authorsPath, 'utf8'));
      // Runtime schema is a plain object — coerce arrays/primitives to {}.
      authors = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    }
  } catch (err: any) {
    console.error(`[threads] Failed to parse .threads/authors.json: ${err.message}. Using empty authors.`);
    authors = {};
  }

  const clientConfig = { sidebar: options?.sidebar === true };
  const i18nStrings = loadPluginStrings(config._activeLocale?.id || 'en');

  return {
    headScriptsHtml: '',
    bodyScriptsHtml: `<script>window.__threads_authors=${scriptLiteral(authors)};window.__threads_config=${scriptLiteral(clientConfig)};window.__threads_i18n=${scriptLiteral(i18nStrings)}</script>`
  };
}

export function getAssets(_options?: any): any[] {
  // Resolve relative to the compiled output location
  const distDir = path.resolve(__dirname, '..', 'dist', 'client');
  return [
    {
      src: path.join(distDir, 'index.js'),
      dest: 'assets/js/threads.js',
      type: 'js',
      location: 'body',
      attributes: { type: 'module' }
    },
    {
      src: path.join(distDir, 'index.css'),
      dest: 'assets/css/threads.css',
      type: 'css',
      location: 'head'
    }
  ];
}

export { actions };