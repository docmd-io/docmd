import type { ActionContext } from '@docmd/api';
import { ThreadsError } from './errors.js';
import { getOptions } from './config.js';
import { readAuthors } from './authors.js';
import type { Caller } from '../types.js';

type Payload = Record<string, unknown> | null | undefined;

/** What identity resolution reads from the action context. */
type IdentityCtx = Pick<ActionContext, 'mode' | 'caller' | 'config' | 'projectRoot'>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * The journal key for a trusted identity: trimmed, with inner whitespace encoded so the markdown can carry it.
 * An identity that already contains `%20` maps to the same key as one with a space; the identity source is trusted not to issue both.
 */
const keyOf = (identity: string): string => {
  const trimmed = identity.trim();
  return /\s/.test(trimmed) ? encodeURIComponent(trimmed) : trimmed;
};

/** True when a trimmed identity has no whitespace and has characters on both sides of an `@`. */
export const isEmailShaped = (identity: string): boolean => {
  const trimmed = identity.trim();
  const at = trimmed.indexOf('@');
  return at > 0 && at < trimmed.length - 1 && !/\s/.test(trimmed);
};

let warnedEmailIdentity = false;

/** Logs once per process that an e-mail-shaped identity arrived; the line never carries the identity. */
function warnEmailIdentity(): void {
  if (warnedEmailIdentity) return;
  warnedEmailIdentity = true;
  console.warn('[threads] a request carried an e-mail-shaped identity: writes are refused and it is treated as unidentified for reads. Point serve.actions.identityHeader at the identity provider\'s user id (for oauth2-proxy, X-Auth-Request-User).');
}

/**
 * Who is calling, or null when the call carries no identity. Throws only when
 * authors.json exists but cannot be read.
 * Under `docmd serve` the key is the host's trusted identity, the name and
 * avatar come from authors.json and the payload is ignored. In dev the client
 * names itself and nothing is enforced.
 */
export async function findCaller(ctx: IdentityCtx, payload: Payload): Promise<Caller | null> {
  if (ctx.mode === 'serve') {
    const identity = str(ctx.caller?.identity);
    if (!identity) return null;
    if (isEmailShaped(identity)) {
      warnEmailIdentity();
      return null;
    }
    const key = keyOf(identity);
    const entry = (await readAuthors(ctx))[key];
    return {
      key,
      name: str(entry?.name) ?? key,
      avatarUrl: str(entry?.avatarUrl) ?? '',
      source: 'header',
      isAdmin: getOptions(ctx).permissions.admins.some((a) => keyOf(a) === key),
    };
  }
  const name = str(payload?.author);
  const key = str(payload?.authorKey) ?? name;
  if (!key) return null;
  return { key, name: name ?? (isEmailShaped(key) ? 'Anonymous' : key), avatarUrl: str(payload?.avatarUrl) ?? '', source: 'payload', isAdmin: false };
}

/** Like findCaller, but a call without identity is an error: `no-identity` under serve (`email-identity` for an e-mail-shaped one), `invalid` in dev. */
export async function resolveCaller(ctx: IdentityCtx, payload: Payload): Promise<Caller> {
  const trusted = ctx.mode === 'serve' ? str(ctx.caller?.identity) : null;
  if (trusted && isEmailShaped(trusted)) {
    warnEmailIdentity();
    throw new ThreadsError('email-identity', "the trusted identity looks like an e-mail address; the site admin must point the serve identity header at the identity provider's user id (for oauth2-proxy, X-Auth-Request-User)");
  }
  const caller = await findCaller(ctx, payload);
  if (caller) return caller;
  if (ctx.mode === 'serve') {
    throw new ThreadsError('no-identity', 'no trusted identity on this request (the serve identity header is missing)');
  }
  throw new ThreadsError('invalid', 'caller identity is required (author)');
}

/** The explicit profile an `upsert-author` call carries in dev; `authorKey` and `name` are required. */
export function profileFromPayload(payload: Record<string, unknown>): { key: string; name: string; avatarUrl: string | undefined } {
  return {
    key: payload.authorKey as string,
    name: payload.name as string,
    avatarUrl: str(payload.avatarUrl) ?? undefined,
  };
}

/** The profile a dev mutation records in authors.json: the payload's `authorKey`, else null. */
export function payloadProfile(payload: Record<string, unknown>): { key: string; name: string; avatarUrl: string } | null {
  const key = str(payload.authorKey);
  const name = str(payload.author);
  return key && name ? { key, name, avatarUrl: str(payload.avatarUrl) ?? '' } : null;
}

/** The author key an `upsert-author` payload names, or null when it names none. */
export const claimedAuthorKey = (payload: Payload): string | null => str(payload?.authorKey);

/** The profile a serve caller sets with `upsert-author`: a name, and an avatar that defaults to the current one when none is sent (an empty one clears it). */
export function headerProfile(payload: Record<string, unknown>, caller: Caller): { name: string; avatarUrl: string } {
  return { name: payload.name as string, avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl.trim() : caller.avatarUrl };
}
