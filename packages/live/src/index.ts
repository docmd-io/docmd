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
import http from 'http';
import fs from 'fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from './build.js';
import { TUI } from '@docmd/tui';
import { safePath as canonicalSafePath } from '@docmd/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function checkPortInUse(port: number): Promise<boolean> {
  // Probe binds to 127.0.0.1 only. We just need to know if the loopback
  // interface has the port — binding to 0.0.0.0 briefly exposed the probe
  // socket to the LAN.
  return new Promise((resolve) => {
    const tester = http.createServer()
      .once('error', (err: any) => resolve(err.code === 'EADDRINUSE'))
      .once('listening', () => tester.close(() => resolve(false)))
      .listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (await checkPortInUse(port)) {
    port++;
  }
  return port;
}

async function start() {
  // Resolution logic: index.js is in dist/, public/ is its sibling at root
  const publicDir = path.resolve(__dirname, '..', 'public');
  const initialPort = parseInt(process.env.PORT || '3000', 10);
  const port = await findAvailablePort(initialPort);

  // 2. Native HTTP Server
  const server = http.createServer(async (req, res) => {
    // Normalize path and prevent directory traversal attacks
    const rawPath = decodeURIComponent(req.url!).split('?')[0].split('#')[0];
    const safePathStr = rawPath.replace(/^[\\/]+/, '') || 'index.html';

    let filePath: string;
    try {
      filePath = canonicalSafePath(publicDir, safePathStr);
    } catch (e: any) {
      console.error('[LIVE 403 ERROR]', e.message, { publicDir, safePathStr });
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Dynamic routing for project-local user assets (bypassing the precompiled bundle)
    if (safePathStr.startsWith('assets/')) {
      try {
        const userAssetPath = canonicalSafePath(process.cwd(), safePathStr);
        await fs.stat(userAssetPath);
        filePath = userAssetPath;
      } catch {
        // fallback to bundled assets if not found locally
      }
    }

    try {
      const stats = await fs.stat(filePath);

      // If it's a directory, serve its index.html
      if (stats.isDirectory()) {
        filePath = canonicalSafePath(filePath, 'index.html');
        await fs.stat(filePath);
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await fs.readFile(filePath);

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);

    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // SPA Fallback: for clean routes without file extension, serve index.html
        if (!path.extname(safePathStr) && !safePathStr.startsWith('assets/')) {
          try {
            const fallbackPath = canonicalSafePath(publicDir, 'index.html');
            const fallbackContent = await fs.readFile(fallbackPath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fallbackContent);
            return;
          } catch { /* proceed to 404 */ }
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Server Error');
      }
    }
  });

  // 3. Start Listening
  // Security: default to loopback. Set DOCMD_HOST=0.0.0.0 to expose on the
  // LAN. The Live editor serves the built site + the project's `assets/`
  // directory, so LAN exposure is opt-in only — same model as the main
  // dev server (packages/core/src/commands/dev.ts).
  const BIND_HOST = process.env.DOCMD_HOST || '127.0.0.1';
  if (BIND_HOST !== '127.0.0.1' && BIND_HOST !== '::1' && BIND_HOST !== 'localhost') {
    TUI.warn(
      `Live editor bound to ${BIND_HOST} (LAN). Any host able to reach this port ` +
      `can browse the served site.`
    );
  }
  server.listen(port, BIND_HOST, () => {
    TUI.section('Live Editor Running', TUI.green);
    TUI.item('', '', TUI.dim, TUI.green);
    TUI.item('Local Access', `http://127.0.0.1:${port}`, TUI.bold, TUI.green);
    if (BIND_HOST !== '127.0.0.1' && BIND_HOST !== '::1' && BIND_HOST !== 'localhost') {
      TUI.item('LAN Access', `http://${BIND_HOST}:${port}`, TUI.bold, TUI.yellow);
    }
    TUI.item('Serving from', path.relative(process.cwd(), publicDir) || '.', TUI.dim, TUI.green);
    TUI.item('', '', TUI.dim, TUI.green);
    TUI.footer(TUI.green);
  });

  server.on('error', (err: any) => {
    TUI.error('Live server error', err.message);
    process.exit(1);
  });

  // Graceful shutdown - suppress ^C display
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      if (data[0] === 0x03) {
        process.emit('SIGINT' as any);
      }
    });
  }

  let isShuttingDown = false;
  process.on('SIGINT', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (process.stdin.isTTY) process.stdin.setRawMode(false);

    TUI.success('Shutting down Live Editor...\n');
    server.close();
    process.exit(0);
  });
}

export { start, build };