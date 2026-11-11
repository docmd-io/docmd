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
import type { IncomingMessage, ServerResponse } from 'http';
import { fsUtils as fs, safePath, asUserPath } from '@docmd/utils';

// MIME types for static file serving
export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface StaticHandlerOptions {
  /** Root directory getter (dev swaps the output dir on config reload). */
  rootDir: () => string;
  /** Rewrite HTML before it is sent (200 pages and the custom 404 page). */
  transformHtml?: (html: string, req: IncomingMessage) => string;
  /** Text shown at the bottom of the built-in 404 page. */
  notFoundFooter?: string;
  /** Exact-pathname routes handled before any file lookup. */
  extraRoutes?: Record<string, Handler>;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(',') : header;
  return raw.split(',').some((t) => {
    const tag = t.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag.replace(/^W\//, '');
  });
}

/**
 * Create a request handler that serves static files from `rootDir`.
 */
export function createStaticHandler(opts: StaticHandlerOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const send = (status: number, headers: Record<string, string | number>, body?: string | Buffer) => {
      res.writeHead(status, headers);
      // HEAD: Node's http server drops the body itself, headers are unchanged.
      res.end(body);
    };

    // Split the raw request target ourselves: `new URL()` would collapse
    // `/../x` to `/x` and hide the traversal attempt from safePath().
    // Absolute-form targets (`GET http://host/page`) are reduced to their pathname.
    let rawPath = '/';
    let pathname: string;
    try {
      const target = req.url || '/';
      rawPath = target.startsWith('/') ? target.split(/[?#]/)[0] : new URL(target).pathname;
      pathname = decodeURIComponent(rawPath);
    } catch {
      send(400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request');
      return;
    }

    const extra = opts.extraRoutes?.[rawPath];
    if (extra) {
      try {
        await extra(req, res);
      } catch {
        if (!res.headersSent) send(500, { 'Content-Type': 'text/plain; charset=utf-8' }, '500 Server Error');
        else res.destroy();
      }
      return;
    }

    const rootDir = opts.rootDir();
    const rootAbs = path.resolve(rootDir);
    // Security (Phase 1.A: CWE-22 fix). Use safePath() to enforce the boundary.
    //
    // The previous `filePath.startsWith(rootAbs)` check was the outlier in the
    // repo: it did not append `path.sep`, so a sibling directory whose name
    // started with rootDir's name (e.g. rootDir=`/x/site`, sibling=`/x/site-private`)
    // passed the check, and a URL like `/..%2fsite-private/secret.txt` resolved
    // to the sibling. safePath() enforces the strict `root + path.sep` boundary
    // and throws on escape.
    //
    // Note: URL pathnames always start with `/` (e.g. `/index.html`). We
    // strip the leading slash before passing to safePath() so the second
    // argument is treated as a *relative* path. `path.resolve` (which
    // safePath uses internally) treats `/index.html` as absolute and would
    // bypass the boundary check; `path.join`-style resolution is the
    // correct semantic for "join this to the root".
    let filePath: string;
    try {
      const safeRelative = pathname.replace(/^\/+/, '') || '.';
      filePath = safePath(rootAbs, asUserPath(safeRelative));
    } catch {
      send(403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
      return;
    }

    try {
      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch (e) {
        if (path.extname(filePath) === '') {
          filePath += '.html';
          stats = await fs.stat(filePath);
        } else {
          throw e;
        }
      }

      if (stats.isDirectory()) {
        if (!rawPath.endsWith('/')) {
          const q = (req.url || '').split('?')[1];
          const loc = `${rawPath}/${q ? `?${q}` : ''}`;
          if (!loc.startsWith('//')) {
            send(301, { 'Location': loc });
            return;
          }
        }
        filePath = path.join(filePath, 'index.html');
        stats = await fs.stat(filePath);
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      // Transformed HTML differs from the file on disk, so it gets its own
      // validator (a dev-served page must never 304 a prod request, or vice versa).
      const transformed = contentType === 'text/html' && !!opts.transformHtml;
      const etag = `W/"${stats.size}-${stats.mtimeMs}${transformed ? '-t' : ''}"`;
      const baseHeaders = { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'ETag': etag };

      if (matchesEtag(req.headers['if-none-match'], etag)) {
        send(304, { 'Cache-Control': 'no-cache', 'ETag': etag });
        return;
      }

      const content = await fs.readFile(filePath);
      let body: string | Buffer = content;
      if (transformed) {
        body = opts.transformHtml!(content.toString('utf-8'), req);
      }
      send(200, { ...baseHeaders, 'Content-Length': Buffer.byteLength(body) }, body);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        const custom404Path = safePath(rootAbs, asUserPath('404.html'));
        let custom: Buffer | null = null;
        try { custom = await fs.readFile(custom404Path); } catch { /* no custom 404 */ }

        if (custom) {
          const body = opts.transformHtml ? opts.transformHtml(custom.toString('utf-8'), req) : custom;
          send(404, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(body) }, body);
          return;
        }
        const footer = opts.notFoundFooter
          ? `\n            <p style="color:#666;font-size:0.9em;">${opts.notFoundFooter}</p>`
          : '';
        const body = `
          <div style="font-family:system-ui;text-align:center;padding:50px;">
            <h1>404 Not Found</h1>
            <p>The requested URL <code>${escapeHtml(req.url || '')}</code> was not found.</p>${footer}
          </div>
        `;
        send(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, body);
      } else {
        send(500, { 'Content-Type': 'text/plain; charset=utf-8' }, '500 Server Error');
      }
    }
  };
}
