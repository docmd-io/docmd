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
import { validateLinks, findMarkdownFiles } from './mcp.js';
import path from 'path';
import fs from 'fs';

export interface ValidationError {
  file: string;
  line: number;
  link: string;
  error: string;
}

/**
 * Validates container source file references across all markdown files.
 * Catches missing files sourced via `::: playground src="..."`, `::: embed src="..."`, etc.
 */
export function validateContainerSources(docsDir: string, excludePatterns: string[] = []): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!fs.existsSync(docsDir)) return errors;

  const mdFiles = findMarkdownFiles(docsDir, excludePatterns, docsDir);
  const containerSrcRegex = /^:::\s*([a-zA-Z0-9_-]+)(?:(?!\/:::)[^:])*?\b(?:src|file)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s:]+))/i;

  for (const filePath of mdFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const relativeFile = path.relative(process.cwd(), filePath);

      lines.forEach((lineText, lineIdx) => {
        const lineNum = lineIdx + 1;
        const trimmed = lineText.trim();
        if (!trimmed.startsWith(':::')) return;

        const match = trimmed.match(containerSrcRegex);
        if (!match) return;

        const containerType = match[1];
        const rawSrc = match[2] || match[3] || match[4];
        if (!rawSrc) return;

        const cleanSrc = rawSrc.replace(/^[<'"]+|[>'"]+$/g, '').trim();
        if (!cleanSrc) return;

        const docDir = path.dirname(filePath);
        const candidates = [
          path.resolve(docDir, cleanSrc),
          path.resolve(process.cwd(), cleanSrc),
          path.resolve(docDir, '..', cleanSrc),
          path.resolve(docsDir, cleanSrc.replace(/^\/+/, ''))
        ];

        let found = false;
        for (const candidate of candidates) {
          try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              found = true;
              break;
            }
          } catch {
            // ignore fs check errors
          }
        }

        if (!found) {
          errors.push({
            file: relativeFile,
            line: lineNum,
            link: cleanSrc,
            error: `Missing container source: ::: ${containerType} source file "${cleanSrc}" does not exist`
          });
        }
      });
    } catch {
      // ignore read errors
    }
  }

  return errors;
}

export async function validateProject(options: { json?: boolean; strict?: boolean } = {}) {
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

  const linkErrors = validateLinks(docsDir, config.exclude || []);
  const sourceErrors = validateContainerSources(docsDir, config.exclude || []);
  const errors = [...linkErrors, ...sourceErrors];

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
      TUI.success('All internal links and container source files are valid!');
    } else {
      TUI.error('Validation Failed', `Found ${errors.length} issue(s):`);
      errors.forEach(e => {
        TUI.item(`[${e.file}:${e.line}]`, `${e.link} -> ${e.error}`);
      });
      TUI.footer();
      process.exit(1);
    }
  }
}