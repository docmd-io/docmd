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
 * Helpers shared by the `docmd serve` contract tests: free ports, a
 * spawn wrapper that records output and exit state, and HTTP probes.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { DOCMD } from '../shared.js';

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function canConnect(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

export function request(port, urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Spawn `docmd serve <args>` in `cwd`; resolves nothing, returns handles. */
export function spawnServe(cwd, args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  delete env.DOCMD_HOST;
  delete env.DOCMD_PROJECT_OUT;
  if (!('DOCMD_CONTAINER' in envOverrides)) delete env.DOCMD_CONTAINER;
  if (!('PORT' in envOverrides)) delete env.PORT;
  const child = spawn(process.execPath, [DOCMD, 'serve', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { text: '' };
  child.stdout.on('data', (c) => { output.text += c; });
  child.stderr.on('data', (c) => { output.text += c; });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, output, exited };
}

/** Poll /healthz until it answers 200; rejects if the child exits first. */
export async function waitForHealthz(port, handle, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) throw new Error(`serve exited early (${handle.child.exitCode}): ${handle.output.text}`);
    try {
      const res = await request(port, '/healthz');
      if (res.status === 200) return res;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`serve did not answer /healthz on ${port} in time; output: ${handle.output.text}`);
}

/** SIGTERM (if still running) and wait for exit. */
export async function stopServe(handle) {
  if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill('SIGTERM');
  return handle.exited;
}

/** Wait for the child to exit on its own within `timeoutMs`; kills it otherwise. */
export async function exitWithin(handle, timeoutMs) {
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  const r = await Promise.race([handle.exited, timer]);
  if (r === 'timeout') {
    handle.child.kill('SIGKILL');
    await handle.exited;
    return { code: null, timedOut: true };
  }
  return { ...r, timedOut: false };
}
