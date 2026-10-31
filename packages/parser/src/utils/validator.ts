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


import { TUI } from '@docmd/tui';

// Known configuration keys for typo detection (V2 + V3)
const KNOWN_KEYS = [
  // V3 Modern Labels
  'title', 'url', 'src', 'out', 'base', 'layout',
  'versions', 'redirects', 'notFound', 'projects',

  // Engine selection (e.g. "rust" for the rust preview engine)
  'engine', 'engines',

  // V2 Legacy Labels
  'siteTitle', 'siteUrl', 'srcDir', 'outputDir',

  // Shared Features
  'logo', 'sidebar', 'theme', 'customCss', 'customJs', 'autoTitleFromH1',
  'copyCode', 'plugins', 'navigation', 'footer', 'sponsor', 'favicon',
  'search', 'minify', 'editLink', 'pageNavigation', 'i18n',
  'markdown', 'security', 'htmlPolicy', 'focusMode', 'print', 'copyWidgets',
  'cookie', 'tmp', 'titleSeparator', 'titleAppend',

  // Workspace & Variables
  'workspace', 'variables'
];

// Common typos mapping
const TYPO_MAPPING = {
  'site_title': 'title',
  'sitetitle': 'title',
  'baseUrl': 'url',
  'source': 'src',
  'outDir': 'out',
  'customCSS': 'theme.customCss',
  'customcss': 'theme.customCss',
  'customJS': 'theme.customJs',
  'customjs': 'theme.customJs',
  'htmlPolicy': 'security.html',
  'html_policy': 'security.html',
  'nav': 'navigation',
  'menu': 'navigation'
};

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  // 1. Required Fields (Accept either title OR siteTitle)
  // Skip for multi-project root configs - they only have projects[]
  if (!config.title && !config.siteTitle && !Array.isArray(config.projects)) {
    errors.push('Missing required property: "title" (or "siteTitle")');
  }

  // 2. Type Checking
  if (config.navigation && !Array.isArray(config.navigation)) {
    errors.push('"navigation" must be an Array');
  }

  if (config.customJs && !Array.isArray(config.customJs)) {
    errors.push('"customJs" must be an Array of strings');
  }

  if (config.customCss && !Array.isArray(config.customCss)) {
    errors.push('"customCss" must be an Array of strings');
  }

  if (config.theme) {
    if (config.theme.customCss && !Array.isArray(config.theme.customCss)) {
      errors.push('"theme.customCss" must be an Array of strings');
    }
    if (config.theme.customJs && !Array.isArray(config.theme.customJs)) {
      errors.push('"theme.customJs" must be an Array of strings');
    }
  }

  if (config.versions && config.versions.all && !Array.isArray(config.versions.all)) {
    errors.push('"versions.all" must be an Array');
  }

  // 3. Typos and Unknown Keys (Top Level)
  // T-Z3: previously completely-unknown keys were silently ignored. We
  // now warn about every unrecognised top-level key (typo suggestions
  // where applicable) so misconfigurations don't ship silently. Nested
  // plugin config (`plugins.<name>.*`) is intentionally NOT checked —
  // each plugin owns its own schema and is validated by the plugin
  // loader.
  Object.keys(config).forEach(key => {
    // Skip checking internal keys (starting with _)
    if (key.startsWith('_')) return;

    if (!KNOWN_KEYS.includes(key)) {
      if (TYPO_MAPPING[key]) {
        warnings.push(`Found unknown property "${key}". Did you mean "${TYPO_MAPPING[key]}"?`);
      } else {
        warnings.push(`Unknown property "${key}" in config — ignored. (Top-level keys only; plugin-specific options belong under "plugins.<name>".)`);
      }
    }
  });

  // 4. Theme specific typos
  if (config.theme) {
    if (config.theme.customCSS) {
      warnings.push('Found "theme.customCSS". Did you mean "theme.customCss"?');
    }
    if (config.theme.customJS) {
      warnings.push('Found "theme.customJS". Did you mean "theme.customJs"?');
    }
  }

  // Output results
  if (warnings.length > 0) {
    TUI.warn('Configuration Warnings:');
    warnings.forEach(w => TUI.warn(w));
  }

  if (errors.length > 0) {
    TUI.error('Configuration Errors');
    errors.forEach(e => TUI.error(e));
    throw new Error('Invalid configuration file.');
  }

  return { warnings, errors };
}

export { validateConfig };