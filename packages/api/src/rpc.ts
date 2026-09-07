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
  ActionContext,
  ActionHandler,
  EventHandler,
  DispatchResult,
} from './types.js';

interface DispatcherHooks {
  actions: Record<string, ActionHandler>;
  events: Record<string, EventHandler>;
}

interface DispatcherOptions {
  projectRoot: string;
  config: any;
  broadcast: (event: string, data: any) => void;
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
  const { projectRoot, config, broadcast } = options;

  return {
    /**
     * Dispatch a call-style action.  Returns `{ result, reload }`.
     */
    async handleCall(action: string, payload: any): Promise<DispatchResult> {
      const handler = hooks.actions[action];
      if (!handler) throw new Error(`Unknown action: ${action}`);

      const sourceTools = createSourceTools({ projectRoot });
      let modified = false;

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

      const ctx: ActionContext = {
        projectRoot,
        config,
        broadcast,
        source: sourceTools,
        async readFile(relativePath: string): Promise<string> {
          const resolved = resolveProjectFile(relativePath);
          return fs.promises.readFile(resolved, 'utf8');
        },
        async writeFile(relativePath: string, content: string): Promise<void> {
          const resolved = resolveProjectFile(relativePath);
          await fs.promises.writeFile(resolved, content);
          markFileWrittenByRpc(resolved);
          modified = true;
        },
        async readFileLines(relativePath: string): Promise<string[]> {
          const content = await ctx.readFile(relativePath);
          return content.split('\n');
        },
        runWorkerTask(modulePath: string, functionName: string, args: any[]) {
          if (!config._workerPool) throw new Error('WorkerPool is not initialized');
          return config._workerPool.runTask({ type: 'plugin-task', modulePath, functionName, args });
        }
      };

      const result = await handler(payload, ctx);
      return { result, reload: modified || sourceTools._modified };
    },

    /**
     * Dispatch a fire-and-forget event.  Unknown events are silently ignored.
     */
    handleEvent(name: string, data: any): void {
      const handler = hooks.events[name];
      if (!handler) return;

      const sourceTools = createSourceTools({ projectRoot });
      const ctx: ActionContext = {
        projectRoot,
        config,
        broadcast,
        source: sourceTools,
        async readFile(relativePath: string): Promise<string> {
          const resolved = safePath(projectRoot, relativePath);
          return fs.promises.readFile(resolved, 'utf8');
        },
        async writeFile(relativePath: string, content: string): Promise<void> {
          const resolved = safePath(projectRoot, relativePath);
          await fs.promises.writeFile(resolved, content);
          markFileWrittenByRpc(resolved);
        },
        async readFileLines(relativePath: string): Promise<string[]> {
          const content = await ctx.readFile(relativePath);
          return content.split('\n');
        },
        runWorkerTask(modulePath: string, functionName: string, args: any[]) {
          if (!config._workerPool) throw new Error('WorkerPool is not initialized');
          return config._workerPool.runTask({ type: 'plugin-task', modulePath, functionName, args });
        }
      };

      try {
        handler(data, ctx);
      } catch (e: any) {
        TUI.warn(`Event handler error [${name}]: ${e.message}`);
      }
    },
  };
}