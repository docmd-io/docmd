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
import type { Duplex } from 'stream';
import path from 'path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fsUtils as fs, WorkerPool } from '@docmd/utils';
import { TUI } from '@docmd/api';
import { buildSite } from './build.js';
import { loadConfig } from '../utils/config-loader.js';
import { exitWithError, exitCodeFor, failWith } from '../utils/exit.js';
import { formatPathForDisplay, getNetworkIp } from '../utils/dev-utils.js';
import { createStaticHandler } from '../server/static.js';
import { resolveServeBind, validateServeConfig, type ServeActionsConfig, type ServeMcpConfig } from '../server/serve-config.js';
import { createMcpHandler } from './mcp.js';
import { createMcpHttpHandler } from '../server/mcp-http.js';
import { createActionHost, type ActionHost } from '../server/action-host.js';
import { createOriginAllowlist } from '../utils/ws-origin-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Graceful shutdown budget; stays below `docmd stop`'s 5 s SIGTERM grace. */
const SHUTDOWN_BUDGET_MS = 4000;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return String(pkg.version);
  } catch {
    return 'unknown';
  }
}

/**
 * `true` when clearing `outputDir` would delete the project root or the
 * source directory (the output dir equals or contains either).
 */
export function outputDirConflict(outputDir: string, cwd: string, srcDir: string): boolean {
  const contains = (a: string, b: string) => {
    const r = path.relative(a, b);
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
  };
  return contains(outputDir, cwd) || contains(outputDir, srcDir);
}

/** The banner's Actions line: off, or on with the origins and who may write. */
export function actionsBanner(actions: ServeActionsConfig): string {
  if (!actions.enabled) return 'off';
  const writes = actions.identityHeader ? `writes need ${actions.identityHeader}` : 'writes refused (no identityHeader)';
  return `on (origins: ${actions.origins.join(', ')}; ${writes})`;
}

/** The banner's MCP line: off, or on with the browser origins it accepts. */
export function mcpBanner(mcp: ServeMcpConfig): string {
  if (!mcp.enabled) return 'off';
  const browsers = mcp.origins.length > 0 ? `browser origins: ${mcp.origins.join(', ')}` : 'no browser origins';
  return `on at POST /mcp (read-only; ${browsers})`;
}

export interface ServeRouterOptions {
  outputDir: () => string;
  version: string;
  /** Serves `/mcp`; absent means MCP is off and `/mcp` falls through to the static handler. */
  mcp?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
}

/**
 * The request router: `/healthz`, `/mcp` when MCP is on, and everything
 * else through the production static handler.
 */
export function createServeRouter(opts: ServeRouterOptions) {
  const staticHandler = createStaticHandler({ rootDir: opts.outputDir });
  const health = JSON.stringify({ status: 'ok', version: opts.version });

  return async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const target = req.url || '/';
    const pathname = target.startsWith('/') ? target.split(/[?#]/)[0] : target;

    if (pathname === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(health),
        'Cache-Control': 'no-store',
      });
      res.end(health);
      return;
    }

    if (opts.mcp && pathname === '/mcp') {
      await opts.mcp(req, res);
      return;
    }

    await staticHandler(req, res);
  };
}

/**
 * `docmd serve`: build once, then serve the output with the production
 * static handler. No watcher, no browser, no port probing, no raw stdin.
 */
export async function startServe(
  configPathOption: string,
  opts: { host?: string; port?: string } = {}
): Promise<void> {
  const CWD = process.cwd();

  // 1. Workspaces are not supported yet.
  try {
    const { detectWorkspace } = await import('../engine/workspace.js');
    if (await detectWorkspace(configPathOption)) {
      failWith('docmd serve does not support workspaces yet');
    }
  } catch (e) {
    exitWithError(e);
  }

  // 2. Config.
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(configPathOption, { isDev: false, quiet: true });
  } catch (e) {
    exitWithError(e, { section: 'Failed to load config' });
  }

  // 3. Bind address: CLI > env > config > defaults.
  const { host, port } = resolveServeBind({
    cli: { host: opts.host, port: opts.port },
    env: process.env,
    config: config.serve,
  });
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    const raw = opts.port || process.env.PORT || config.serve.port;
    failWith(`Invalid port: ${String(raw)}. Expected an integer between 0 and 65535.`);
  }

  const serveErrors = validateServeConfig(config.serve);
  if (serveErrors.length > 0) {
    failWith(`Invalid serve config:\n  - ${serveErrors.join('\n  - ')}`);
  }
  const actions = config.serve.actions;

  // 4. Refuse an output dir whose clearing would delete the project or its sources.
  const outputDir = path.resolve(CWD, config.out || 'site');
  const srcDir = path.resolve(CWD, config.src || 'docs');
  if (outputDirConflict(outputDir, CWD, srcDir)) {
    failWith(`Refusing to clear output directory "${outputDir}": it contains the project root or the source directory.`);
  }

  // 5. Bind first, so a port already in use fails fast and never touches a
  // live instance's output. Until the build finishes every request is 503.
  let ready = false;
  // MCP over HTTP: the same tools as `docmd mcp`, reading the same config
  // file as this server, and read-only (no tool rebuilds the live site).
  const mcp = config.serve.mcp.enabled
    ? createMcpHttpHandler({
        handler: createMcpHandler({ configPath: configPathOption, readOnly: true }),
        origins: config.serve.mcp.origins,
      })
    : undefined;
  const route = createServeRouter({ outputDir: () => outputDir, version: readVersion(), mcp });
  const server = http.createServer((req, res) => {
    if (!ready) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' });
      res.end('Service Unavailable: site is building');
      return;
    }
    route(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Server Error');
      } else {
        res.destroy();
      }
    });
  });

  // Actions off: no WebSocket endpoint, an upgrade gets a definite 404.
  // Actions on: until the action host attaches (it then owns the upgrade),
  // an upgrade gets the same 503 as plain requests.
  function startupUpgrade(_req: http.IncomingMessage, socket: Duplex): void {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
  }
  if (actions.enabled) {
    server.on('upgrade', startupUpgrade);
  } else {
    server.on('upgrade', (_req, socket) => {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
    });
  }

  // Listen on exactly host:port; no fallback.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      exitWithError(new Error(`Port ${port} is already in use on ${host}.`), { section: 'Failed to start server' });
    }
    exitWithError(err, { section: 'Failed to start server' });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  // 6. Clear the output dir (no stale files), then build once.
  const elapsed = TUI.timer();
  const workerScript = path.resolve(__dirname, '../engine/worker-parser.js');
  const workerConfig = { ...config };
  delete workerConfig._workerPool;
  const workerPool = new WorkerPool(workerScript, { config: workerConfig, cwd: CWD });
  try {
    if (await fs.exists(outputDir)) await fs.remove(outputDir);
    await buildSite(configPathOption, { isDev: false, quiet: false, showStats: false, workerPool, liveServer: actions.enabled });
  } catch (e) {
    await workerPool.terminateAll().catch(() => {});
    exitWithError(e, { section: 'Build failed' });
  }
  TUI.info(`Build completed in ${elapsed()}.`);

  // 7. Plugin actions, once the first build is on disk. A plugin whose
  // `onServerReady` throws makes serve exit non-zero.
  let actionHost: ActionHost | null = null;
  if (actions.enabled) {
    server.off('upgrade', startupUpgrade);
    try {
      actionHost = await createActionHost({
        server,
        mode: 'serve',
        projectRoot: CWD,
        config,
        verifyClient: createOriginAllowlist(actions.origins),
        identityHeader: actions.identityHeader,
        getWorkerPool: () => workerPool,
        rebuild: (files?: string[]) =>
          buildSite(configPathOption, { isDev: false, quiet: true, workerPool, liveServer: true, targetFiles: files }),
      });
    } catch (e) {
      await workerPool.terminateAll().catch(() => {});
      exitWithError(e, { section: 'Failed to start plugin actions' });
    }
  }
  ready = true;

  // 8. Banner.
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  const anyHost = host === '0.0.0.0' || host === '::';
  const urlHost = (h: string) => (h.includes(':') ? `[${h}]` : h);
  const localHost = anyHost || host === '127.0.0.1' ? '127.0.0.1' : urlHost(host);
  const networkIp = anyHost ? getNetworkIp() : null;
  TUI.section('Production Server Running', TUI.green);
  TUI.item('', '', TUI.dim, TUI.green);
  TUI.item('Local Access', `http://${localHost}:${boundPort}`, TUI.bold, TUI.green);
  if (networkIp) TUI.item('Network Access', `http://${networkIp}:${boundPort}`, TUI.bold, TUI.green);
  TUI.item('Serving from', formatPathForDisplay(outputDir, CWD), TUI.dim, TUI.green);
  TUI.item('Actions', actionsBanner(actions), TUI.dim, TUI.green);
  TUI.item('MCP', mcpBanner(config.serve.mcp), TUI.dim, TUI.green);
  TUI.item('', '', TUI.dim, TUI.green);
  TUI.footer(TUI.green);

  // 9. Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // In-flight requests may finish within the budget; whatever is left is cut.
    setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(exitCodeFor(new Error('shutdown timed out')));
    }, SHUTDOWN_BUDGET_MS).unref();
    try {
      // Sockets and plugin onShutdown callbacks first, then the HTTP server.
      if (actionHost) await actionHost.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
      });
      await workerPool.terminateAll();
    } catch {
      // shutting down anyway
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
