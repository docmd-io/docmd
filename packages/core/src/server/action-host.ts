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

/**
 * Shared WebSocket plugin-action host. `docmd dev`, workspace dev and
 * `docmd serve` all attach plugin actions to their HTTP server through
 * `createActionHost`, so the WebSocket server and the action dispatcher
 * are wired in exactly one place.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { TUI, createActionDispatcher, loadPlugins, hooks as globalHooks } from '@docmd/api';
import type { ActionCaller, ServerHandle } from '@docmd/api';
import type { WorkerPool } from '@docmd/utils';
import type { VerifyClientInfo } from '../utils/ws-origin-guard.js';

type VerifyClientDone = (allowed: boolean, code?: number, message?: string) => void;

/** A frame from the browser bridge (docmd-api.js). */
interface ClientFrame {
  type?: string;
  id?: unknown;
  action?: string;
  payload?: unknown;
  name?: string;
  data?: unknown;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ActionHostOptions {
  server: http.Server;
  mode: 'dev' | 'serve';
  projectRoot: string;
  config: ServerHandle['config'];
  /** dev: createOriginVerify(...); serve: createOriginAllowlist(origins). */
  verifyClient: (info: VerifyClientInfo, cb: VerifyClientDone) => void;
  /** dev swaps the pool on config reload, so the host asks every time. */
  getWorkerPool: () => WorkerPool | undefined;
  /** Provided by the command; serialised and coalesced inside the host. */
  rebuild: (files?: string[]) => Promise<void>;
  /** Default true: the host calls loadPlugins(config, { resolvePaths, isDev: mode === 'dev' }). */
  loadPlugins?: boolean;
  /** Extra plugin resolution roots handed to loadPlugins (dev: the CLI dir; workspace dev: the project root). */
  resolvePaths?: string[];
}

export interface ActionHost {
  wss: InstanceType<typeof WebSocketServer>;
  /** `{type:'event', name, data}` to every OPEN client. */
  broadcast(event: string, data: unknown): void;
  /** dev only: sends the bare `reload` text frame. A no-op in serve. */
  broadcastReload(): void;
  /** Serialised, coalescing wrapper around `opts.rebuild`. */
  rebuild(files?: string[]): Promise<void>;
  /** What `onServerReady` receives. */
  handle: ServerHandle;
  /** Terminates sockets, closes wss, runs onShutdown callbacks. */
  close(): Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function defer(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  // Callers that never await (fire-and-forget) must not trigger unhandled rejections.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Build the per-socket caller from the upgrade request (cookies never reach plugins). */
function buildCaller(req: http.IncomingMessage): ActionCaller {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const key = name.toLowerCase();
    if (key === 'cookie' || key === 'set-cookie' || value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return {
    transport: 'websocket',
    headers,
    origin: (req.headers.origin as string | undefined) ?? null,
    remoteAddress: req.socket.remoteAddress ?? null,
    connectionId: crypto.randomUUID(),
    connectedAt: Date.now(),
  };
}

export async function createActionHost(opts: ActionHostOptions): Promise<ActionHost> {
  const { server, mode, projectRoot, config } = opts;
  const shutdownCallbacks: Array<() => void | Promise<void>> = [];

  // ── WebSocket server ─────────────────────────────────
  // Handshakes wait for `onServerReady`: a client that connects while a
  // plugin is still starting up is accepted only after the hooks resolved.
  const ready = defer();
  const wss = new WebSocketServer({
    server,
    verifyClient: (info: VerifyClientInfo, cb: VerifyClientDone) => {
      ready.promise.then(
        () => opts.verifyClient(info, cb),
        () => cb(false, 503, 'Server not ready'),
      );
    },
  });
  wss.on('error', (e: Error) => TUI.error('WebSocket Error', e.message));

  async function runShutdownCallbacks(): Promise<void> {
    for (const fn of shutdownCallbacks) {
      try { await fn(); } catch (e) { TUI.error('Shutdown callback failed', errorMessage(e)); }
    }
  }

  // ── Serialised, coalescing rebuild ───────────────────
  let inFlight = false;
  let pending: { files: Set<string> | null; waiter: Deferred } | null = null;

  const toAbsolute = (f: string) => path.resolve(projectRoot, f);

  const broadcast = (event: string, data: unknown): void => {
    const frame = JSON.stringify({ type: 'event', name: event, data });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    });
  };

  async function runBuild(files: string[] | null, waiter: Deferred): Promise<void> {
    inFlight = true;
    try {
      await opts.rebuild(files ?? undefined);
      broadcast('system:rebuilt', {
        files: files ? files.map((f) => path.relative(projectRoot, f).split(path.sep).join('/')) : null,
      });
      waiter.resolve();
    } catch (e) {
      waiter.reject(e);
    } finally {
      inFlight = false;
      if (pending) {
        const next = pending;
        pending = null;
        void runBuild(next.files ? [...next.files] : null, next.waiter);
      }
    }
  }

  function rebuild(files?: string[]): Promise<void> {
    const absolute = files ? files.map(toAbsolute) : null;
    if (!inFlight) {
      const waiter = defer();
      void runBuild(absolute, waiter);
      return waiter.promise;
    }
    if (!pending) pending = { files: new Set(), waiter: defer() };
    if (absolute === null) pending.files = null;
    else if (pending.files) for (const f of absolute) pending.files.add(f);
    return pending.waiter.promise;
  }

  // ── Handle ───────────────────────────────────────────
  const handle: ServerHandle = {
    mode,
    projectRoot,
    config,
    rebuild,
    broadcast,
    onShutdown: (fn) => { shutdownCallbacks.push(fn); },
  };

  const dispatcher = createActionDispatcher(globalHooks, {
    projectRoot,
    config,
    broadcast,
    mode,
    getWorkerPool: opts.getWorkerPool,
    requestRebuild: rebuild,
  });

  wss.on('connection', (ws, req: http.IncomingMessage) => {
    const caller = buildCaller(req);
    ws.on('message', async (raw: { toString(): string }) => {
      let msg: ClientFrame;
      try { msg = JSON.parse(raw.toString()) as ClientFrame; } catch { return; }

      if (msg.type === 'call') {
        try {
          const { result, writtenFiles } = await dispatcher.handleCall(msg.action as string, msg.payload, caller);
          // Never ask the client to reload from here: dev's watcher rebuilds and
          // broadcasts `reload`; serve rebuilds below and broadcasts `system:rebuilt`.
          ws.send(JSON.stringify({ id: msg.id, type: 'response', result, reload: false }));
          if (mode === 'serve' && writtenFiles.length > 0) {
            rebuild(writtenFiles).catch((e: unknown) => TUI.error('Rebuild failed', errorMessage(e)));
          }
        } catch (e) {
          ws.send(JSON.stringify({ id: msg.id, type: 'response', error: errorMessage(e) }));
        }
      } else if (msg.type === 'event') {
        dispatcher.handleEvent(msg.name as string, msg.data, caller);
      }
    });
  });

  const host: ActionHost = {
    wss,
    broadcast,
    broadcastReload() {
      if (mode !== 'dev') return;
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send('reload');
      });
    },
    rebuild,
    handle,
    async close() {
      wss.clients.forEach((client) => client.terminate());
      const closed = new Promise<void>((resolve) => wss.close(() => resolve()));
      await runShutdownCallbacks();
      await closed;
    },
  };

  // ── Plugins and ready hooks ──────────────────────────
  // Dev keeps live reload alive whatever a plugin does: failures are logged
  // and the host carries on. In serve any failure rejects, after the
  // shutdown callbacks plugins already registered have run.
  const fail = async (e: unknown, what: string): Promise<void> => {
    if (mode === 'serve') throw e;
    TUI.error(what, errorMessage(e));
  };
  try {
    if (opts.loadPlugins !== false) {
      try {
        await loadPlugins(config, { resolvePaths: opts.resolvePaths ?? [], isDev: mode === 'dev' });
      } catch (e) {
        await fail(e, 'Plugin loading failed');
      }
    }
    if (mode === 'dev') {
      for (const fn of globalHooks.onDevServerReady) {
        try { await fn(server, wss); } catch (e) { await fail(e, 'onDevServerReady failed'); }
      }
    }
    for (const fn of globalHooks.onServerReady) {
      try { await fn(handle); } catch (e) { await fail(e, 'onServerReady failed'); }
    }
  } catch (e) {
    ready.reject(e);
    await runShutdownCallbacks();
    wss.close();
    throw e;
  }
  ready.resolve();

  return host;
}
