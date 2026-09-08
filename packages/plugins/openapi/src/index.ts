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

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { safePath, asUserPath, type PluginDescriptor } from '@docmd/api';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const plugin: PluginDescriptor = {
  name: 'openapi',
  version: '0.9.5',
  capabilities: ['markdown', 'assets']
};

// ---------------------------------------------------------------------------
// Types (OpenAPI 3.x subset)
// ---------------------------------------------------------------------------

interface OASchema {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, OASchema>;
  items?: OASchema;
  enum?: (string | number)[];
  required?: string[];
  $ref?: string;
  example?: unknown;
  examples?: unknown[];
  default?: unknown;
  nullable?: boolean;
  oneOf?: OASchema[];
  anyOf?: OASchema[];
  allOf?: OASchema[];
  additionalProperties?: boolean | OASchema;
  discriminator?: { propertyName?: string };
}

interface OAExample {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
}

interface OAParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: OASchema;
  example?: unknown;
  examples?: Record<string, OAExample>;
}

interface OAMediaType {
  schema?: OASchema;
  example?: unknown;
  examples?: Record<string, OAExample>;
}

interface OARequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OAMediaType>;
}

interface OAResponse {
  description?: string;
  content?: Record<string, OAMediaType>;
}

interface OAOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OAParameter[];
  requestBody?: OARequestBody;
  responses?: Record<string, OAResponse>;
  deprecated?: boolean;
}

interface OAPathItem {
  get?: OAOperation;
  post?: OAOperation;
  put?: OAOperation;
  patch?: OAOperation;
  delete?: OAOperation;
  head?: OAOperation;
  options?: OAOperation;
}

interface OASpec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, OAPathItem>;
  components?: { schemas?: Record<string, OASchema> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

const METHOD_COLORS: Record<string, string> = {
  get: '#10b981',
  post: '#3b82f6',
  put: '#f59e0b',
  patch: '#8b5cf6',
  delete: '#ef4444',
  head: '#6b7280',
  options: '#6b7280'
};

function esc(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function describe(str: string | undefined, options: any): string {
  if (!str) return '';
  return options?.allowRawHtml ? str : esc(str);
}

/** Resolve a $ref like #/components/schemas/Foo against the spec */
function resolveRef(ref: string, spec: OASpec): OASchema | null {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node: any = spec;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return null;
    node = node[part];
  }
  return node as OASchema | null;
}

function resolveSchema(schema: OASchema | undefined, spec: OASpec, _depth = 0): OASchema {
  if (!schema) return {};
  if (schema.$ref) return resolveRef(schema.$ref, spec) || schema;
  return schema;
}

/** Expand a schema by resolving $ref and flattening allOf branches into a single
 *  schema (merged properties/required). Used wherever the actual field set of a
 *  schema is needed (table rendering), as opposed to typeLabel's display string. */
function expandSchema(schema: OASchema | undefined, spec: OASpec, depth = 0): OASchema {
  if (!schema || depth > 8) return schema || {};
  const resolved = resolveSchema(schema, spec);
  if (!resolved.allOf || resolved.allOf.length === 0) return resolved;

  const merged: OASchema = { properties: {}, required: [] };
  for (const branch of resolved.allOf) {
    const expanded = expandSchema(branch, spec, depth + 1);
    if (expanded.properties) Object.assign(merged.properties!, expanded.properties);
    if (expanded.required) merged.required = [...merged.required!, ...expanded.required];
  }
  // Own properties declared alongside allOf (a common inheritance pattern) win last.
  if (resolved.properties) Object.assign(merged.properties!, resolved.properties);
  if (resolved.required) merged.required = [...merged.required!, ...resolved.required];
  merged.description = resolved.description;
  merged.example = resolved.example;
  merged.examples = resolved.examples;
  merged.default = resolved.default;
  merged.additionalProperties = resolved.additionalProperties;
  return merged;
}

/** Render a schema as a compact type string */
function typeLabel(schema: OASchema | undefined, spec: OASpec): string {
  if (!schema) return 'any';
  if (schema.$ref) return schema.$ref.split('/').pop() || 'object';
  const resolved = resolveSchema(schema, spec);
  if (resolved.allOf && resolved.allOf.length > 0) return resolved.allOf.map(s => typeLabel(s, spec)).join(' & ');
  if (resolved.type === 'array') return `array[${typeLabel(resolved.items, spec)}]`;
  if (resolved.type === 'object' && resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
    return `map[string, ${typeLabel(resolved.additionalProperties, spec)}]`;
  }
  if (resolved.oneOf && resolved.oneOf.length > 0) return resolved.oneOf.map(s => typeLabel(s, spec)).join(' | ');
  if (resolved.anyOf && resolved.anyOf.length > 0) return resolved.anyOf.map(s => typeLabel(s, spec)).join(' | ');
  if (resolved.enum) return resolved.enum.map(v => `"${v}"`).join(' | ');
  const inferredType = resolved.type || (resolved.properties || resolved.additionalProperties ? 'object' : undefined);
  const base = [inferredType, resolved.format].filter(Boolean).join(':') || 'any';
  return resolved.nullable ? `${base} | null` : base;
}

/** Format a raw example value (string or JSON) as a code block */
function formatExampleValue(value: unknown): string {
  if (value === undefined) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<pre class="oa-example-value"><code>${esc(str)}</code></pre>`;
}

/** Format a field-level example value inline, without the boxed code block
 *  used for full-body examples — keeps schema table rows compact. */
function formatInlineExampleValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return esc(value);
  if (typeof value === 'number') return String(value);
  return formatExampleValue(value);
}

/** Render the example(s) for a media type or schema: named `examples` map takes
 *  priority over a single `example`, falling back to the schema's own example. */
function renderExamples(media: OAMediaType | undefined, schema: OASchema | undefined, spec: OASpec, options: any): string {
  let body = '';
  if (media?.examples && Object.keys(media.examples).length > 0) {
    const entries = Object.entries(media.examples);
    body = entries
      .map(
        ([name, example]) => `<details class="oa-example">
      <summary>${esc(example.summary || name)}</summary>
      ${example.description ? `<p class="oa-example-description">${describe(example.description, options)}</p>` : ''}
      ${
        example.value !== undefined
          ? formatExampleValue(example.value)
          : example.externalValue
            ? `<p><a href="${esc(example.externalValue)}" target="_blank" rel="noopener noreferrer">${esc(example.externalValue)}</a></p>`
            : ''
      }
    </details>`
      )
      .join('');
  } else if (media?.example !== undefined) {
    body = formatExampleValue(media.example);
  } else {
    const resolvedSchema = schema ? expandSchema(schema, spec) : undefined;
    const schemaExample = resolvedSchema?.example ?? resolvedSchema?.examples?.[0];
    if (schemaExample !== undefined) body = formatExampleValue(schemaExample);
  }
  if (!body) return '';
  return `<h6 class="oa-examples-title">Example</h6><div class="oa-examples">${body}</div>`;
}

/** Render a nested object/array-of-object schema inline as a collapsible sub-table */
function renderNestedSchema(schema: OASchema | undefined, spec: OASpec, options: any, depth: number): string {
  if (!schema || depth > 6) return '';
  const resolved = expandSchema(schema, spec);
  const target = resolved.type === 'array' ? resolved.items : schema;
  if (!target) return '';
  const targetResolved = expandSchema(target, spec);
  const hasFields =
    (targetResolved.properties && Object.keys(targetResolved.properties).length > 0) ||
    (targetResolved.oneOf?.length ?? 0) > 0 ||
    (targetResolved.anyOf?.length ?? 0) > 0;
  if (!hasFields) return '';
  const inner = renderSchemaTable(target, spec, options, depth + 1);
  if (!inner) return '';
  return `<details class="oa-nested-schema"><summary>Show fields</summary>${inner}</details>`;
}

/** Render schema properties as an HTML table, expanding allOf/oneOf/anyOf compositions,
 *  nested object/array fields and per-field examples. */
function renderSchemaTable(schema: OASchema | undefined, spec: OASpec, options: any, depth = 0): string {
  if (!schema || depth > 6) return '';
  const resolved = expandSchema(schema, spec);
  let html = '';

  const props = resolved.properties;
  if (props && Object.keys(props).length > 0) {
    const required = new Set(resolved.required || []);
    const rows = Object.entries(props)
      .map(([name, prop]) => {
        const r = expandSchema(prop, spec);
        const nested = renderNestedSchema(prop, spec, options, depth);
        const example = r.example ?? r.examples?.[0] ?? (r.default !== undefined ? r.default : undefined);
        return `<tr>
        <td><code>${esc(name)}</code>${required.has(name) ? ' <span class="oa-required">*</span>' : ''}</td>
        <td><span class="oa-type">${esc(typeLabel(prop, spec))}</span>${nested}</td>
        <td>${describe(r.description, options)}</td>
        <td>${formatInlineExampleValue(example)}</td>
      </tr>`;
      })
      .join('');

    html += `<div class="oa-table-wrap"><table class="oa-schema-table oa-hover">
    <thead><tr><th>Field</th><th>Type</th><th>Description</th><th>Example</th></tr></thead>
    <tbody>${rows}</tbody>
    </table></div>`;
  }

  if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
    html += `<p class="oa-additional-props">Additional properties: <span class="oa-type">${esc(typeLabel(resolved.additionalProperties, spec))}</span></p>`;
  }

  // oneOf/anyOf represent alternative schemas, not composed ones, so render them
  // from the un-flattened schema alongside (rather than instead of) the table above.
  const raw = resolveSchema(schema, spec);
  const variantGroups: [string, OASchema[] | undefined][] = [
    ['One of', raw.oneOf],
    ['Any of', raw.anyOf],
  ];
  for (const [label, variants] of variantGroups) {
    if (variants && variants.length > 0) {
      const discriminator = raw.discriminator?.propertyName
        ? `<p class="oa-discriminator">Discriminator: <code>${esc(raw.discriminator.propertyName)}</code></p>`
        : '';
      const items = variants
        .map(
          (v) => `<details class="oa-variant">
        <summary><span class="oa-type">${esc(typeLabel(v, spec))}</span></summary>
        ${renderSchemaTable(v, spec, options, depth + 1)}
      </details>`
        )
        .join('');
      html += `<div class="oa-variants"><p class="oa-variants-label">${esc(label)}:</p>${discriminator}${items}</div>`;
    }
  }

  return html;
}

/** Render a single operation */
function renderOperation(method: string, path_: string, op: OAOperation, spec: OASpec, options: any): string {
  const color = METHOD_COLORS[method] || '#6b7280';
  const deprecated = op.deprecated ? '<span class="oa-deprecated">DEPRECATED</span>' : '';
  const summaryOnly = options?.summaryOnly === true;

  // Parameters
  let paramsHtml = '';
  if (!summaryOnly && op.parameters && op.parameters.length > 0) {
    const rows = op.parameters
      .map((p) => {
        const paramSchema = p.schema ? expandSchema(p.schema, spec) : undefined;
        const example =
          p.example ??
          (p.examples ? Object.values(p.examples)[0]?.value : undefined) ??
          paramSchema?.example ??
          paramSchema?.examples?.[0];
        return `<tr>
        <td><code>${esc(p.name)}</code>${p.required ? ' <span class="oa-required">*</span>' : ''}</td>
        <td><span class="oa-param-in">${esc(p.in)}</span></td>
        <td><span class="oa-type">${esc(typeLabel(p.schema, spec))}</span></td>
        <td>${describe(p.description, options)}</td>
        <td>${formatInlineExampleValue(example)}</td>
      </tr>`;
      })
      .join('');
    paramsHtml = `<h5>Parameters</h5>
<div class="oa-table-wrap"><table class="oa-schema-table">
  <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Description</th><th>Example</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
  }

  // Request body
  let requestHtml = '';
  if (op.requestBody?.content) {
    const entries = Object.entries(op.requestBody.content);
    requestHtml = `<h5>Request Body${op.requestBody.required ? ' <span class="oa-required">*</span>' : ''}</h5>`;
    for (const [contentType, media] of entries) {
      requestHtml += `<p class="oa-content-type"><code>${esc(contentType)}</code></p>`;
      requestHtml += renderSchemaTable(media.schema, spec, options);
      requestHtml += renderExamples(media, media.schema, spec, options);
    }
  }

  // Responses — each status code is rendered as its own summary row immediately
  // followed by its body/example row, so examples stay attached to their own
  // response (in file order) instead of being grouped after all responses.
  let responsesHtml = '';
  if (!summaryOnly && op.responses) {
    const statusCodes = Object.entries(op.responses);
    const rows = statusCodes
      .map(([code, resp]) => {
        const cls = code.startsWith('2') ? 'oa-status-ok' : /^[45]/.test(code) ? 'oa-status-err' : 'oa-status-other';
        let schemaInfo = '';
        if (resp.content) {
          const firstMedia = Object.values(resp.content)[0];
          if (firstMedia?.schema)
            schemaInfo = `<br><span class="oa-type">${esc(typeLabel(firstMedia.schema, spec))}</span>`;
        }
        const summaryRow = `<tr>
        <td><span class="oa-status-badge ${cls}">${esc(code)}</span></td>
        <td>${describe(resp.description, options)}${schemaInfo}</td>
      </tr>`;

        const sections = resp.content
          ? Object.entries(resp.content)
              .map(([contentType, media]) => {
                const schemaHtml = renderSchemaTable(media.schema, spec, options);
                const examplesHtml = renderExamples(media, media.schema, spec, options);
                if (!schemaHtml && !examplesHtml) return '';
                return `<p class="oa-content-type"><code>${esc(contentType)}</code></p>${schemaHtml}${examplesHtml}`;
              })
              .join('')
          : '';

        const detailRow = sections
          ? `<tr class="oa-response-detail-row"><td colspan="2"><details class="oa-response-detail">
        <summary>${esc(code)} body</summary>
        ${sections}
      </details></td></tr>`
          : '';

        return summaryRow + detailRow;
      })
      .join('');
    responsesHtml = `<h5>Responses</h5>
<div class="oa-table-wrap"><table class="oa-schema-table oa-no-hover">
  <thead><tr><th>Status</th><th>Description</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
  }

  const id = `oa-${method}-${path_.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

  return `<div class="oa-operation" id="${esc(id)}">
  <div class="oa-operation-header">
    <span class="oa-method" style="background:${color}">${method.toUpperCase()}</span>
    <code class="oa-path">${esc(path_)}</code>
    ${deprecated}
  </div>
  ${op.summary ? `<p class="oa-summary">${esc(op.summary)}</p>` : ''}
  ${op.description ? `<p class="oa-description">${describe(op.description, options)}</p>` : ''}
  ${paramsHtml}
  ${requestHtml}
  ${responsesHtml}
</div>`;
}

/** Parse OpenAPI spec content from a string (JSON or YAML). */
function parseSpecContent(raw: string, label = '<inline>'): OASpec {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(raw);
  }
  try {
    const yaml = require('js-yaml');
    return yaml.load(raw) as OASpec;
  } catch {
    throw new Error(
      `OpenAPI plugin: YAML spec at "${label}" requires js-yaml to be installed.\nRun: npm install js-yaml`
    );
  }
}

/** Resolve OpenAPI spec file path safely with workspace and relative path support. */
function resolveSpecFile(specPath: string, rootDir: string, env: any): { absPath?: string; error?: string } {
  // Phase 1.A: CWE-22 fix (S-2, N-S2). Use safePath() to enforce boundary.
  const isDirectEscape = specPath.startsWith('/') || specPath.startsWith('\\') || /^[a-zA-Z]:/.test(specPath);

  // Find project boundary (directory containing docmd.config.json or package.json, or rootDir/cwd)
  let projectBoundary = rootDir || process.cwd();
  if (env?.filePath) {
    let cur = path.dirname(env.filePath);
    while (cur && cur !== path.dirname(cur)) {
      if (fs.existsSync(path.join(cur, 'docmd.config.json')) || fs.existsSync(path.join(cur, 'package.json'))) {
        projectBoundary = cur;
        break;
      }
      cur = path.dirname(cur);
    }
  }

  // Reject paths that escape project root
  if (isDirectEscape) {
    try {
      safePath(projectBoundary, asUserPath(specPath));
    } catch (_e: any) {
      return { error: `<div class="oa-error">OpenAPI spec path escapes project root: <code>${esc(specPath)}</code></div>` };
    }
  }

  const candidateDirs: string[] = [];

  // 1. Current markdown file directory & ancestors
  if (env?.filePath) {
    const fileDir = path.dirname(env.filePath);
    candidateDirs.push(fileDir);
    let cur = fileDir;
    while (cur && cur !== path.dirname(cur)) {
      candidateDirs.push(cur);
      candidateDirs.push(path.join(cur, 'assets'));
      candidateDirs.push(path.join(cur, 'docs'));
      if (cur === projectBoundary) break;
      cur = path.dirname(cur);
    }
  }

  // 2. Project boundary & cwd
  candidateDirs.push(projectBoundary);
  candidateDirs.push(path.join(projectBoundary, 'docs'));
  candidateDirs.push(path.join(projectBoundary, 'assets'));
  candidateDirs.push(process.cwd());
  candidateDirs.push(path.join(process.cwd(), 'docs'));

  for (const dir of candidateDirs) {
    try {
      const resolved = safePath(dir, asUserPath(specPath));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return { absPath: resolved };
      }
    } catch {
      // safePath threw for this candidate dir
    }
  }

  // Check if safePath rejects it
  try {
    safePath(projectBoundary, asUserPath(specPath));
  } catch (_e: any) {
    return { error: `<div class="oa-error">OpenAPI spec path escapes project root: <code>${esc(specPath)}</code></div>` };
  }

  return { error: `<div class="oa-error">OpenAPI spec not found: <code>${esc(specPath)}</code></div>` };
}

/** Render full spec as HTML */
function renderSpec(rawContent: string, rootDir: string, options: any, env?: any): string {
  const trimmed = rawContent.trim();

  let spec: OASpec;
  let specPathForDownload = '';

  // 1. Check if inline JSON/YAML spec
  if (trimmed.startsWith('{') || trimmed.startsWith('openapi:') || trimmed.startsWith('swagger:')) {
    try {
      spec = parseSpecContent(trimmed, '<inline>');
    } catch (e: any) {
      return `<div class="oa-error">Failed to parse OpenAPI spec: ${esc(String(e.message))}</div>`;
    }
  } else {
    // 2. Treat as spec file path
    const { absPath, error } = resolveSpecFile(trimmed, rootDir, env);
    if (error || !absPath) {
      return error || `<div class="oa-error">OpenAPI spec not found: <code>${esc(trimmed)}</code></div>`;
    }
    try {
      // eslint-disable-next-line docmd/no-unsafe-fs-read -- validated by safePath in resolveSpecFile
      spec = parseSpecContent(fs.readFileSync(absPath, 'utf8'), absPath);
      specPathForDownload = trimmed;
    } catch (e: any) {
      return `<div class="oa-error">Failed to parse OpenAPI spec: ${esc(String(e.message))}</div>`;
    }
  }

  const info = spec.info || {};
  let html = `<div class="oa-spec">`;

  if (options?.info !== false && info.title) {
    // Convert the spec path to a root-relative URL so the link resolves
    // correctly regardless of which page depth it is rendered on.
    // e.g. "./api-specs/my-api.yaml" -> "/api-specs/my-api.yaml"
    const downloadHref = '/' + specPathForDownload.replace(/^\.\//, '').replace(/^\//, '');
    const downloadLink = (options?.download && specPathForDownload)
      ? `<a href="${esc(downloadHref)}" class="oa-download-link" title="Download OpenAPI Spec" target="_blank">JSON / YAML</a>`
      : '';
    html += `<div class="oa-spec-header">
      <h2 class="oa-spec-title">${esc(info.title)}</h2>
      <div class="oa-spec-meta">
        ${info.version ? `<span class="oa-spec-version">v${esc(info.version)}</span>` : ''}
        ${downloadLink}
      </div>
    </div>`;
  }
  if (info.description) {
    html += `<p class="oa-spec-description">${describe(info.description, options)}</p>`;
  }

  if (spec.paths) {
    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (op) {
          html += renderOperation(method, pathStr, op, spec, options);
        }
      }
    }
  }

  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Plugin hooks
// ---------------------------------------------------------------------------

/**
 * Extend markdown-it to handle ```openapi fences.
 * Usage in markdown:
 *
 * ```openapi
 * ./path/to/spec.json
 * ```
 */
export function markdownSetup(md: any, options: any): void {
  const srcDir: string = options?.config?.src
    ? path.resolve(process.cwd(), options.config.src)
    : process.cwd();

  const originalFence = md.renderer.rules.fence || ((tokens: any[], idx: number, opts: any, _env: any, self: any) => self.renderToken(tokens, idx, opts));

  md.renderer.rules.fence = (tokens: any[], idx: number, opts: any, env: any, self: any) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();

    if (info !== 'openapi') {
      return originalFence(tokens, idx, opts, env, self);
    }

    const rawContent = token.content.trim();
    // options IS the plugin's own config sub-object (e.g. { download: true });
    // fallback to options?.config?.plugins?.openapi if passed full config
    const pluginOptions = (options?.config?.plugins?.openapi || ((typeof options === 'object' && options !== null) ? options : {})) || {};
    return renderSpec(rawContent, srcDir, pluginOptions, env);
  };
}

/**
 * Provide OpenAPI CSS asset.
 */
export function getAssets(_options?: any): any[] {
  const distCssPath = path.resolve(__dirname, '..', 'dist', 'openapi.css');
  const srcCssPath = path.resolve(__dirname, '..', 'src', 'openapi.css');
  const cssPath = fs.existsSync(distCssPath) ? distCssPath : srcCssPath;

  // Only inject if our bundled CSS exists
  if (!fs.existsSync(cssPath)) return [];

  return [{
    src: cssPath,
    dest: 'assets/css/docmd-openapi.css',
    type: 'css',
    location: 'head'
  }];
}
