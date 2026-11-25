import type { ActionContext } from '@docmd/api';
import { getOptions } from './config.js';

const MAX_EMAIL = 254;

/** One `@` with text on both sides; no whitespace or angle bracket (control characters are checked apart). */
const WELL_FORMED = /^[^@\s<>]+@[^@\s<>]+$/;
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * The commit author e-mail carried by the request, or null. Read only when a
 * commit is made for the caller, from the header `git.authorEmailHeader` names,
 * under `docmd serve`. The value goes to the commit's author argument and is
 * never stored, logged or returned.
 */
export function authorEmailOf(ctx: Pick<ActionContext, 'mode' | 'caller' | 'config'>): string | null {
  if (ctx.mode !== 'serve') return null;
  const header = getOptions(ctx).git?.authorEmailHeader;
  if (!header) return null;
  const value = ctx.caller?.headers?.[header.toLowerCase()];
  if (typeof value !== 'string') return null;
  const email = value.trim();
  return email.length <= MAX_EMAIL && WELL_FORMED.test(email) && !hasControl(email) ? email : null;
}
