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
 * The `serve` config section (production server): defaults, validation and
 * host/port precedence. `normalizeServeConfig` never throws, so `build` and
 * `dev` keep working with a bad `serve` block; `docmd serve` checks the port
 * and calls `validateServeConfig` itself at startup.
 */

export interface ServeActionsConfig {
  /** Plugin actions over WebSocket; off unless exactly `true`. */
  enabled: boolean;
  /** Full origins (`https://docs.example.com`) allowed to open the action socket. */
  origins: string[];
  /**
   * Lower-cased header a trusted reverse proxy sets to the authenticated
   * user. Null means no trusted identity source: every write is refused.
   */
  identityHeader: string | null;
}

export interface ServeMcpConfig {
  /** MCP over HTTP at `POST /mcp`; off unless exactly `true`. */
  enabled: boolean;
  /**
   * Full origins allowed to call `/mcp` from a browser. A request with any
   * other `Origin` gets 403; one without `Origin` (a non-browser MCP client)
   * is accepted. Empty means no browser may call it.
   */
  origins: string[];
}

export interface ServeConfig {
  host: string;
  port: number;
  actions: ServeActionsConfig;
  mcp: ServeMcpConfig;
}

const DEFAULT_SERVE_HOST = '127.0.0.1';
const DEFAULT_SERVE_PORT = 3000;

/** RFC 9110 field-name token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;
/** Headers the action host never passes to plugins, so they can never carry an identity. */
const STRIPPED_HEADERS = new Set(['cookie', 'set-cookie']);

/** Fill defaults for the user's `serve` section. Never throws. */
export function normalizeServeConfig(userServe: unknown): ServeConfig {
  const u = (userServe && typeof userServe === 'object' ? userServe : {}) as { host?: unknown; port?: unknown; actions?: unknown; mcp?: unknown };
  const a = (u.actions && typeof u.actions === 'object' ? u.actions : {}) as { enabled?: unknown; origins?: unknown; identityHeader?: unknown };
  const m = (u.mcp && typeof u.mcp === 'object' ? u.mcp : {}) as { enabled?: unknown; origins?: unknown };
  return {
    host: typeof u.host === 'string' && u.host !== '' ? u.host : DEFAULT_SERVE_HOST,
    port: u.port === undefined || u.port === null || u.port === '' ? DEFAULT_SERVE_PORT : Number(u.port),
    actions: {
      enabled: a.enabled === true,
      origins: Array.isArray(a.origins) ? a.origins.map((o) => String(o)) : [],
      identityHeader: typeof a.identityHeader === 'string' && a.identityHeader.trim() !== ''
        ? a.identityHeader.trim().toLowerCase()
        : null,
    },
    mcp: {
      enabled: m.enabled === true,
      origins: Array.isArray(m.origins) ? m.origins.map((o) => String(o)) : [],
    },
  };
}

/** `true` when `value` is a full http(s) origin such as `https://docs.example.com`. */
function isValidOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== 'null';
  } catch {
    return false;
  }
}

/** Startup validation of the `serve.actions` and `serve.mcp` blocks. Returns one message per problem; empty means valid. */
export function validateServeConfig(serve: ServeConfig): string[] {
  const errors: string[] = [];
  const { actions } = serve;
  if (actions.enabled && actions.origins.length === 0) {
    errors.push('serve.actions.origins must list at least one origin when serve.actions.enabled is true.');
  }
  for (const o of actions.origins) {
    if (!isValidOrigin(o)) errors.push(`serve.actions.origins contains an invalid origin: "${o}" (expected e.g. "https://docs.example.com").`);
  }
  const header = actions.identityHeader;
  if (header !== null && (!HEADER_NAME.test(header) || STRIPPED_HEADERS.has(header))) {
    errors.push(`serve.actions.identityHeader is not a usable header name: "${header}".`);
  }
  for (const o of serve.mcp.origins) {
    if (!isValidOrigin(o)) errors.push(`serve.mcp.origins contains an invalid origin: "${o}" (expected e.g. "https://docs.example.com").`);
  }
  return errors;
}

export interface ServeBindInput {
  cli: { host?: string; port?: string | number };
  env: Record<string, string | undefined>;
  config: Pick<ServeConfig, 'host' | 'port'>;
}

/** CLI > environment > config > defaults (the config already carries the defaults). */
export function resolveServeBind(input: ServeBindInput): { host: string; port: number } {
  const { cli, env, config } = input;
  const host = cli.host || env.DOCMD_HOST || config.host || DEFAULT_SERVE_HOST;
  const rawPort = cli.port || env.PORT || config.port;
  return { host, port: Number(rawPort) };
}
