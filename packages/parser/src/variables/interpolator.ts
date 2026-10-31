/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/parser
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import { VariableRegistry, VariableContext } from './registry.js';

export interface InterpolationOptions {
  wrapDynamic?: boolean;
}

/**
 * Parse an expression inside {{ ... }}
 * Supports:
 *   - "variableName"
 *   - "nested.variable.name"
 *   - "variableName || 'default value'"
 *   - "variableName || \"default value\""
 *   - "variableName || 2026"
 */
export function parseVariableExpression(expr: string): { key: string; fallback: string | undefined } {
  const trimmed = expr.trim();
  const orIndex = trimmed.indexOf('||');

  if (orIndex === -1) {
    return { key: trimmed, fallback: undefined };
  }

  const key = trimmed.substring(0, orIndex).trim();
  let fallbackRaw = trimmed.substring(orIndex + 2).trim();

  // Strip wrapping single or double quotes from fallback string
  if (
    (fallbackRaw.startsWith("'") && fallbackRaw.endsWith("'")) ||
    (fallbackRaw.startsWith('"') && fallbackRaw.endsWith('"'))
  ) {
    fallbackRaw = fallbackRaw.slice(1, -1);
  }

  return { key, fallback: fallbackRaw };
}

/**
 * Interpolate {{ variable }} placeholders within a Markdown or text string.
 */
export function interpolateVariables(
  content: string,
  registry: VariableRegistry,
  context?: VariableContext,
  options: InterpolationOptions = { wrapDynamic: true }
): string {
  if (!content || typeof content !== 'string' || !content.includes('{{')) {
    return content;
  }

  // Regex to match {{ expression }}, avoiding triple braces or escaped expressions
  const pattern = /\{\{\s*([^{}\n\r]+?)\s*\}\}/g;

  return content.replace(pattern, (match, expression) => {
    const { key, fallback } = parseVariableExpression(expression);

    // If key contains invalid identifier characters, ignore it
    if (!key || /[^a-zA-Z0-9_\.\-]/.test(key)) {
      return match;
    }

    const resolved = registry.get(key, context);
    const isDynamic = registry.isDynamic(key);

    if (isDynamic && options.wrapDynamic) {
      const displayVal = resolved !== undefined ? String(resolved) : (fallback !== undefined ? fallback : '');
      return `<span data-docmd-var="${key}" class="docmd-var">${displayVal}</span>`;
    }

    if (resolved !== undefined) {
      return String(resolved);
    }

    if (fallback !== undefined) {
      return fallback;
    }

    // Leave unmatched variable as-is
    return match;
  });
}

/**
 * Recursively interpolate variable expressions inside config objects (e.g. footer copyright, banners, titles).
 */
export function interpolateConfigVariables<T>(
  data: T,
  registry: VariableRegistry,
  context?: VariableContext
): T {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return interpolateVariables(data, registry, context, { wrapDynamic: false }) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map(item => interpolateConfigVariables(item, registry, context)) as unknown as T;
  }

  if (typeof data === 'object') {
    // Preserve Sets, Maps, Dates, RegExps, Buffers, and non-plain objects as-is
    if (data instanceof Set || data instanceof Map || data instanceof Date || data instanceof RegExp) {
      return data;
    }
    if (data.constructor && data.constructor.name !== 'Object') {
      return data;
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      // Don't recursively interpolate the 'variables' definition block itself, or internal engine properties starting with '_'
      if (key === 'variables' || key.startsWith('_')) {
        result[key] = value;
      } else {
        result[key] = interpolateConfigVariables(value, registry, context);
      }
    }
    return result as unknown as T;
  }

  return data;
}