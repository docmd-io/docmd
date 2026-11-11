/**
 * Fixture plugin for the action-host tests. Exercises caller headers,
 * the worker pool, writes, rebuild requests and the `onServerReady` hook.
 *
 * Test knobs (in-process hosts only, via globalThis):
 *   __serveFixtureGate     promise `onServerReady` awaits before resolving
 *   __serveFixtureThrow    when truthy, `onServerReady` throws
 *   __serveFixtureShutdown called from the handle's onShutdown callback
 * Spawned commands:
 *   DOCMD_TEST_ONSERVERREADY_THROW=1 (env) makes `onServerReady` throw
 */
import { fileURLToPath } from 'node:url';

export const plugin = {
  name: 'serve-plugin',
  version: '1.0.0',
  capabilities: ['actions', 'server'],
  requiresLiveServer: true,
};

let savedHandle = null;
const workerModule = fileURLToPath(new URL('./worker-task.js', import.meta.url));

export const actions = {
  'test:whoami': async (payload, ctx) => {
    if (payload && payload.dump) {
      return {
        headers: ctx.caller.headers,
        transport: ctx.caller.transport,
        connectionId: ctx.caller.connectionId,
        trustedIdentity: ctx.caller.identity,
      };
    }
    return {
      identity: ctx.caller.headers['x-test-identity'] ?? null,
      mode: ctx.mode,
      origin: ctx.caller.origin,
    };
  },
  'test:worker': (payload, ctx) => ctx.runWorkerTask(workerModule, 'square', [payload?.n ?? 7]),
  'test:write': async (payload, ctx) => {
    await ctx.writeFile(payload.file, payload.content);
    return { written: payload.file };
  },
  'test:rebuild': async (payload, ctx) => {
    await ctx.requestRebuild(payload?.files);
    return { requested: payload?.files ?? null };
  },
  'test:handle-rebuild': async (payload) => {
    await savedHandle.rebuild(payload?.files);
    return { mode: savedHandle.mode };
  },
};

export async function onServerReady(handle) {
  savedHandle = handle;
  handle.onShutdown(() => globalThis.__serveFixtureShutdown?.());
  if (globalThis.__serveFixtureGate) await globalThis.__serveFixtureGate;
  if (globalThis.__serveFixtureThrow || process.env.DOCMD_TEST_ONSERVERREADY_THROW === '1') {
    throw new Error('fixture onServerReady failed');
  }
}
