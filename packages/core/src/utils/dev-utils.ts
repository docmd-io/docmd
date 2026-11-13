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

import http from 'http';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execSync, spawn } from 'child_process';
import { fsUtils as fs } from '@docmd/utils';
import { createStaticHandler, MIME_TYPES } from '../server/static.js';
import { resolveUiAsset } from '../server/ui-assets.js';



export { MIME_TYPES };

/**
 * Format an absolute path for display relative to CWD.
 */
export function formatPathForDisplay(absolutePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, absolutePath);
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return `./${relativePath}`;
  }
  return relativePath;
}

/**
 * Get the first non-internal IPv4 network address.
 */
export function getNetworkIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

/**
 * Read git user.name and user.email, compute Gravatar URL.
 * Lazy-initialized on first call.
 */
let _gitDevInfoCache: { name: string; email: string; gravatarUrl: string } | null = null;
export function getGitDevInfo() {
  if (_gitDevInfoCache) return _gitDevInfoCache;
  let name = '';
  let email = '';
  try { name = execSync('git config user.name', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); } catch { /* git not configured */ }
  try { email = execSync('git config user.email', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); } catch { /* git not configured */ }
  const gravatarUrl = email
    ? `https://gravatar.com/avatar/${crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex')}?s=80&d=mp`
    : '';
  _gitDevInfoCache = { name, email, gravatarUrl };
  return _gitDevInfoCache;
}

export function getDevInfoScript(): string {
  return `<script>window.__docmd_dev=${JSON.stringify(getGitDevInfo())}</script>`;
}

/**
 * Serve static files from rootDir with live-reload injection.
 * Thin dev wrapper over the production static handler.
 */
export async function serveStatic(req: any, res: any, rootDir: string) {
  const inject = (html: string) =>
    html.replace('</body>', `${getDevInfoScript()}<script src="/__dev/docmd-api.js"></script></body>`);

  return createStaticHandler({
    rootDir: () => rootDir,
    transformHtml: inject,
    notFoundFooter: '(docmd dev server)',
    extraRoutes: {
      // Dev-only API script
      '/__dev/docmd-api.js': async (_req, r) => {
        try {
          const apiScript = await fs.readFile(resolveUiAsset('js/docmd-api.js'), 'utf-8');
          r.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
          r.end(apiScript);
        } catch {
          r.writeHead(404);
          r.end('Not found');
        }
      },
    },
  })(req, res);
}

/**
 * Check if a port is in use.
 */
export function checkPortInUse(port: number): Promise<boolean> {
  // The probe binds to 127.0.0.1, not 0.0.0.0, so it only checks whether
  // the loopback interface has the port. Binding to all interfaces here
  // was unnecessary (we just need to know if "our" port is taken) and
  // briefly exposed the probe socket to the LAN.
  return new Promise((resolve) => {
    const tester = http.createServer()
      .once('error', (err: any) => resolve(err.code === 'EADDRINUSE'))
      .once('listening', () => tester.close(() => resolve(false)))
      .listen(port, '127.0.0.1');
  });
}

/**
 * Find the next available port starting from startPort.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (await checkPortInUse(port)) {
    port++;
  }
  return port;
}

/**
 * Open a URL in the user's default browser. Best-effort: failures are
 * swallowed so the dev server is never taken down by a missing `xdg-open`
 * (e.g. inside the official Docker image, where the binary is not
 * installed). The call is also skipped entirely when running inside a
 * container — the official image sets DOCMD_CONTAINER=true for this.
 */
export function openBrowser(url: string): void {
  if (
    process.env.DOCMD_CONTAINER === 'true' ||
    process.env.DOCMD_TEST === 'true' ||
    process.env.DOCMD_TEST === '1' ||
    process.env.DOCMD_NO_OPEN === 'true' ||
    process.env.DOCMD_NO_OPEN === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true'
  ) {
    return;
  }

  let command = 'xdg-open';
  let args = [url];

  if (process.platform === 'darwin') {
    command = 'open';
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  }

  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* missing browser binary — ignore */ });
    child.unref();
  } catch {
    /* never let a browser-launch failure crash the dev server */
  }
}