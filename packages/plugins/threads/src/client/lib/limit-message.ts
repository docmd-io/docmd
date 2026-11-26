import { t } from './i18n';

const LIMIT_KEYS: Record<string, string> = {
  'threads/limit-chars': 'limitChars',
  'threads/rate-limited': 'rateLimited',
};

/**
 * The translated message for a write rejected by a limit, or null for any other failure.
 * Reads the `threads/<code>: <text>` message that both the wire error and ThreadsClientError carry.
 */
export function limitMessage(err: unknown): string | null {
  const message = err instanceof Error ? err.message : '';
  const code = /^(threads\/[a-z][a-z-]*):/.exec(message)?.[1];
  const key = code ? LIMIT_KEYS[code] : undefined;
  return key ? t(key) : null;
}
