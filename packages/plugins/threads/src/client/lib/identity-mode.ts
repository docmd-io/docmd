import type { WhoAmI } from '../../types';
import type { ShowContext } from './can-show';

/** DOM-free identity decisions: nothing here touches the window, storage or the server. */
export type IdentityMode =
  | { mode: 'header'; payload: { author: string; authorKey: string; avatarUrl: string }; isAdmin: boolean }
  | { mode: 'local' };

/** A trusted header identity from the server, or the local (dev) path. */
export function identityFromWhoami(w: Pick<WhoAmI, 'identity'> | null | undefined): IdentityMode {
  const id = w?.identity;
  if (!id || id.source !== 'header') return { mode: 'local' };
  return { mode: 'header', payload: { author: id.name, authorKey: id.key, avatarUrl: id.avatarUrl }, isAdmin: id.isAdmin };
}

/** How long to wait for the server before taking the local path (a static site never answers). */
const WHOAMI_TIMEOUT_MS = 1500;

/** Ask the server who we are; no live server (a rejection or no answer in time) means the local path. */
export async function resolveIdentity(
  fetchWhoami: () => Promise<Pick<WhoAmI, 'identity'>>,
  timeoutMs: number = WHOAMI_TIMEOUT_MS,
): Promise<IdentityMode> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const local = new Promise<IdentityMode>((resolve) => { timer = setTimeout(() => resolve({ mode: 'local' }), timeoutMs); });
  try {
    return await Promise.race([fetchWhoami().then(identityFromWhoami), local]);
  } catch {
    return { mode: 'local' };
  } finally {
    clearTimeout(timer);
  }
}

/** Map the module identity and the injected `__threads_config` onto canShow's context. */
export function showContext(identity: IdentityMode, cfg: unknown, localKey: string | null): ShowContext {
  const resolve = (cfg as { permissions?: { resolve?: unknown } } | null | undefined)?.permissions?.resolve;
  const header = identity.mode === 'header';
  return {
    callerKey: identity.mode === 'header' ? identity.payload.authorKey : localKey,
    isAdmin: identity.mode === 'header' && identity.isAdmin,
    source: header ? 'header' : 'payload',
    resolveRule: resolve === 'author' ? 'author' : 'anyone',
  };
}
