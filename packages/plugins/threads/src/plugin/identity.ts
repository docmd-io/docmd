import type { ActionContext } from '@docmd/api';
import { ThreadsError } from './errors.js';
import type { Caller } from '../types.js';

type Payload = Record<string, unknown> | null | undefined;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Who is calling, or null when the call carries no identity. Never throws.
 * Under `docmd serve` the key is the host's trusted identity and the payload
 * only supplies the display name. In dev the client names itself.
 */
export function findCaller(ctx: Pick<ActionContext, 'mode' | 'caller'>, payload: Payload): Caller | null {
  const name = str(payload?.author);
  if (ctx.mode === 'serve') {
    const key = str(ctx.caller?.identity);
    return key ? { key, name: name ?? key } : null;
  }
  const key = str(payload?.authorKey) ?? name;
  return key ? { key, name: name ?? key } : null;
}

/** Like findCaller, but a call without identity is an error: `no-identity` under serve, `invalid` in dev. */
export function resolveCaller(ctx: Pick<ActionContext, 'mode' | 'caller'>, payload: Payload): Caller {
  const caller = findCaller(ctx, payload);
  if (caller) return caller;
  if (ctx.mode === 'serve') {
    throw new ThreadsError('no-identity', 'no trusted identity on this request (the serve identity header is missing)');
  }
  throw new ThreadsError('invalid', 'caller identity is required (author)');
}

/** The explicit profile an `upsert-author` call carries; `authorKey` and `name` are required. */
export function profileFromPayload(payload: Record<string, unknown>): { key: string; name: string; avatarUrl: string | undefined } {
  return {
    key: payload.authorKey as string,
    name: payload.name as string,
    avatarUrl: str(payload.avatarUrl) ?? undefined,
  };
}

/**
 * The profile a mutation records in authors.json: the payload's `authorKey` in
 * dev, the trusted identity under serve. Null when the caller sent no key.
 */
export function payloadProfile(
  ctx: Pick<ActionContext, 'mode'>,
  caller: Caller,
  payload: Record<string, unknown>,
): { key: string; name: string; avatarUrl: string } | null {
  const key = ctx.mode === 'serve' ? caller.key : str(payload.authorKey);
  const name = str(payload.author);
  return key && name ? { key, name, avatarUrl: str(payload.avatarUrl) ?? '' } : null;
}
