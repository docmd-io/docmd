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

/** Ask the server who we are; no live server (a rejection) means the local path. */
export async function resolveIdentity(fetchWhoami: () => Promise<Pick<WhoAmI, 'identity'>>): Promise<IdentityMode> {
  try {
    return identityFromWhoami(await fetchWhoami());
  } catch {
    return { mode: 'local' };
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
