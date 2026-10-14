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

import { TUI } from '@docmd/api';
import { loadConfig } from '../utils/config-loader.js';
import { validateLinks } from './mcp.js';
import path from 'path';
import fs from 'fs';

export async function validateProject(options: { json?: boolean } = {}) {
  let config: any;
  try {
    config = await loadConfig('docmd.config.js', { quiet: true });
  } catch {
    config = { src: 'docs' };
  }

  const docsDir = path.resolve(process.cwd(), config.src || 'docs');

  if (!fs.existsSync(docsDir)) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Docs directory not found at ${docsDir}`, errors: [] }));
    } else {
      TUI.error('Validation Error', `Docs directory not found: ${docsDir}`);
    }
    process.exit(1);
  }

  const errors = validateLinks(docsDir, config.exclude || []);

  if (options.json) {
    // Phase 3 PR 3.A (M-12): even when JSON output is requested, the
    // process MUST exit 1 if any errors were found. CI pipelines
    // (`docmd validate --json | jq .errors | if [ $(. | length) -gt 0 ]; then exit 1`)
    // rely on the exit code, not the JSON payload, to gate merges.
    console.log(JSON.stringify({ errors }));
    if (errors.length > 0) {
      process.exit(1);
    }
  } else {
    TUI.section('Documentation Validation');
    if (errors.length === 0) {
      TUI.success('All internal links and references are valid!');
    } else {
      TUI.error('Validation Failed', `Found ${errors.length} broken links:`);
      errors.forEach(e => {
        TUI.item(`[${e.file}:${e.line}]`, `${e.link} -> ${e.error}`);
      });
      TUI.footer();
      process.exit(1);
    }
  }
}