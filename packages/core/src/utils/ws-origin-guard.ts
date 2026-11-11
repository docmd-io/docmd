/**
 * Origin-allowlist verifyClient callback factory for the dev-server
 * WebSocketServers. Used by packages/core/src/commands/dev.ts and
 * packages/core/src/engine/workspace.ts. Mitigates CSWSH
 * (Cross-Site WebSocket Hijacking, CWE-1385). See
 * DEVELOPMENT-BENCHMARK.md §S3.
 */

import type { IncomingMessage } from 'node:http';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Extract the hostname (lowercased) from an Origin URL header value.
 * Returns null if the value cannot be parsed.
 */
function originHost(originHeader: string | undefined | null): string | null {
  if (!originHeader) return null;
  try {
    const u = new URL(originHeader);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface VerifyClientInfo {
  origin?: string;
  req: IncomingMessage;
  secure: boolean;
}

/**
 * Build a verifyClient callback that allows loopback origins plus an
 * optional list of explicit additional hosts (e.g. a known LAN IP).
 * The port portion of the origin is intentionally ignored — we only
 * gate by hostname, because the dev server's port may vary per run.
 */
export function createOriginVerify(extraAllowedHosts: string[] = []) {
  const allowed = new Set<string>([...LOOPBACK_HOSTS]);
  for (const h of extraAllowedHosts) {
    if (h) allowed.add(h.toLowerCase());
  }

  return function verifyClient(
    info: VerifyClientInfo,
    callback: (allowed: boolean, code?: number, message?: string) => void
  ): void {
    const originHeader = info.origin || (info.req.headers.origin as string | undefined);
    const host = originHost(originHeader);
    if (!host) {
      // No Origin header at all (direct script / curl) — reject for safety.
      callback(false, 403, 'Origin header required');
      return;
    }
    if (allowed.has(host)) {
      callback(true);
      return;
    }
    callback(false, 403, `Origin ${host} not in allowlist`);
  };
}
/**
 * Build a verifyClient callback for production hosting (`docmd serve`).
 * Each configured origin is a full origin (`https://docs.example.com`),
 * normalised with `new URL(o).origin` and matched exactly against the
 * request's Origin: scheme, host and port all count, no wildcards.
 * Throws on a value that is not a URL or that names a wildcard, so a bad
 * config fails at startup instead of silently refusing every client.
 */
export function createOriginAllowlist(origins: string[]) {
  const allowed = new Set<string>();
  for (const o of origins) {
    let normalised: string;
    try {
      normalised = new URL(o).origin;
    } catch {
      throw new Error(`Invalid origin in allowlist: ${JSON.stringify(o)} (expected a full origin such as https://docs.example.com)`);
    }
    if (normalised === 'null') {
      throw new Error(`Invalid origin in allowlist: ${JSON.stringify(o)} (expected a full origin such as https://docs.example.com)`);
    }
    allowed.add(normalised);
  }

  return function verifyClient(
    info: VerifyClientInfo,
    callback: (allowed: boolean, code?: number, message?: string) => void
  ): void {
    const originHeader = info.origin || (info.req.headers.origin as string | undefined);
    if (!originHeader) {
      callback(false, 403, 'Origin header required');
      return;
    }
    let origin: string;
    try {
      origin = new URL(originHeader).origin;
    } catch {
      callback(false, 403, 'Origin not in allowlist');
      return;
    }
    if (allowed.has(origin)) {
      callback(true);
      return;
    }
    callback(false, 403, `Origin ${origin} not in allowlist`);
  };
}
