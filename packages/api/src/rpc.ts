/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/api
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * Action dispatcher for live-edit WebSocket message handling.
 *
 * Routes incoming `call` messages to plugin action handlers and `event`
 * messages to plugin event handlers.  Each call gets a fresh context with
 * file I/O helpers and source editing tools.  Tracks modifications so the
 * caller knows whether a browser reload is needed.
 */

import fs from 'fs';
import path from 'path';
import { createSourceTools } from './source.js';
import { TUI } from '@docmd/tui';
import { safePath } from '@docmd/utils';
import type {
  ActionCaller,
  ActionContext,
  ActionHandler,
  EventHandler,
  DispatchResult,
} from './types.js';

interface DispatcherHooks {
  actions: Record<string, ActionHandler>;
  events: Record<string, EventHandler>;
}

/** Minimal pool surface the dispatcher needs; the host owns the real pool. */
interface WorkerPoolLike {
  runTask(task: unknown): Promise<unknown>;
}

interface DispatcherOptions {
  projectRoot: string;
  config: any;
  broadcast: (event: string, data: any) => void;
  /** Returns the host's worker pool, or undefined when none is running. */
  getWorkerPool?: () => WorkerPoolLike | undefined;
  /** Which command hosts the dispatcher (default 'dev'). */
  mode?: 'dev' | 'serve';
  /** Host rebuild entry point, forwarded by `ctx.requestRebuild`. */
  requestRebuild?: (files?: string[]) => Promise<void>;
}

const rpcWrittenFiles = new Map<string, number>();

/**
 * Record that a file was modified internally by an RPC action.
 * dev server file watchers can check this to avoid triggering full page reloads.
 */
export function markFileWrittenByRpc(filePath: string): void {
  const normalized = path.resolve(filePath);
  rpcWrittenFiles.set(normalized, Date.now());
}

/**
 * Check whether a file was modified by an RPC action recently (within 4 seconds).
 */
export function wasWrittenByRpc(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  const timestamp = rpcWrittenFiles.get(normalized);
  if (!timestamp) return false;
  if (Date.now() - timestamp > 4000) {
    rpcWrittenFiles.delete(normalized);
    return false;
  }
  return true;
}

/**
 * Create an action dispatcher bound to the given hooks and project context.
 *
 * @param hooks     - `{ actions: {name: handler}, events: {name: handler} }`
 * @param options   - Project root, config, and broadcast function
 * @returns `{ handleCall, handleEvent }`
 */
export function createActionDispatcher(hooks: DispatcherHooks, options: DispatcherOptions) {
  const { projectRoot, config, broadcast, getWorkerPool, requestRebuild } = options;
  const mode: 'dev' | 'serve' = options.mode ?? 'dev';

  const resolveProjectFile = (relativePath: string): string => {
    const direct = safePath(projectRoot, relativePath);
    if (fs.existsSync(direct)) return direct;

    // In workspace mode, search project src directories
    const ws = config?.workspace;
    if (ws && Array.isArray(ws.projects)) {
      for (const p of ws.projects) {
        if (p.src) {
          const candidate = safePath(projectRoot, path.join(p.src, relativePath));
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
    return direct;
  };

  /** Build a fresh per-call context plus the state the call mutates. */
  function buildContext(caller: ActionCaller | undefined) {
    const sourceTools = createSourceTools({ projectRoot });
    const written = new Set<string>();
    let modified = false;

    // Source write operations record their target in the per-call collector.
    const track = <A extends [string, ...unknown[]]>(fn: (...a: A) => Promise<void>) =>
      async (...a: A): Promise<void> => {
        await fn(...a);
        written.add(safePath(projectRoot, a[0]));
      };
    const source = {
      ...sourceTools,
      wrapText: track(sourceTools.wrapText),
      insertAfter: track(sourceTools.insertAfter),
      replaceBlock: track(sourceTools.replaceBlock),
      removeBlock: track(sourceTools.removeBlock),
    };

    const ctx: ActionContext = {
      projectRoot,
      config,
      broadcast,
      source,
      mode,
      caller: caller ?? {
        transport: 'local',
        headers: {},
        origin: null,
        remoteAddress: null,
        connectionId: 'local',
        connectedAt: Date.now(),
      },
      async readFile(relativePath: string): Promise<string> {
        return fs.promises.readFile(resolveProjectFile(relativePath), 'utf8');
      },
      async writeFile(relativePath: string, content: string): Promise<void> {
        const resolved = resolveProjectFile(relativePath);
        await fs.promises.writeFile(resolved, content);
        markFileWrittenByRpc(resolved);
        written.add(resolved);
        modified = true;
      },
      async readFileLines(relativePath: string): Promise<string[]> {
        const content = await ctx.readFile(relativePath);
        return content.split('\n');
      },
      runWorkerTask<T>(modulePath: string, functionName: string, args: any[]): Promise<T> {
        const pool = getWorkerPool?.();
        if (!pool) return Promise.reject(new Error('WorkerPool is not initialized'));
        return pool.runTask({ type: 'plugin-task', modulePath, functionName, args }) as Promise<T>;
      },
      requestRebuild(files?: string[]): Promise<void> {
        if (!requestRebuild) return Promise.reject(new Error('Rebuild is not available'));
        return requestRebuild(files);
      },
    };

    return {
      ctx,
      writtenFiles: () => Array.from(written),
      isModified: () => modified || sourceTools._modified,
    };
  }

  return {
    /**
     * Dispatch a call-style action.  Returns `{ result, reload, writtenFiles }`.
     * `caller` defaults to a local caller when omitted.
     */
    async handleCall(action: string, payload: any, caller?: ActionCaller): Promise<DispatchResult> {
      if (action === 'system:ping') {
        return { result: { ok: true, timestamp: Date.now() }, reload: false, writtenFiles: [] };
      }

      const handler = hooks.actions[action];
      if (!handler) throw new Error(`Unknown action: ${action}`);

      const call = buildContext(caller);
      const result = await handler(payload, call.ctx);
      return { result, reload: call.isModified(), writtenFiles: call.writtenFiles() };
    },

    /**
     * Dispatch a fire-and-forget event.  Unknown events are silently ignored.
     * `caller` defaults to a local caller when omitted.
     */
    handleEvent(name: string, data: any, caller?: ActionCaller): void {
      const handler = hooks.events[name];
      if (!handler) return;

      const { ctx } = buildContext(caller);
      try {
        handler(data, ctx);
      } catch (e: any) {
        TUI.warn(`Event handler error [${name}]: ${e.message}`);
      }
    },
  };
}
