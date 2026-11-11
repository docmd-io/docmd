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
 * The `serve` config section (production server): defaults and host/port
 * precedence. `normalizeServeConfig` never throws, so `build` and `dev`
 * keep working with a bad `serve` block; `docmd serve` checks the port
 * itself at startup.
 */

export interface ServeConfig {
  host: string;
  port: number;
}

const DEFAULT_SERVE_HOST = '127.0.0.1';
const DEFAULT_SERVE_PORT = 3000;

/** Fill defaults for the user's `serve` section. Never throws. */
export function normalizeServeConfig(userServe: unknown): ServeConfig {
  const u = (userServe && typeof userServe === 'object' ? userServe : {}) as { host?: unknown; port?: unknown };
  return {
    host: typeof u.host === 'string' && u.host !== '' ? u.host : DEFAULT_SERVE_HOST,
    port: u.port === undefined || u.port === null || u.port === '' ? DEFAULT_SERVE_PORT : Number(u.port),
  };
}

export interface ServeBindInput {
  cli: { host?: string; port?: string | number };
  env: Record<string, string | undefined>;
  config: ServeConfig;
}

/** CLI > environment > config > defaults (the config already carries the defaults). */
export function resolveServeBind(input: ServeBindInput): { host: string; port: number } {
  const { cli, env, config } = input;
  const host = cli.host || env.DOCMD_HOST || config.host || DEFAULT_SERVE_HOST;
  const rawPort = cli.port || env.PORT || config.port;
  return { host, port: Number(rawPort) };
}
