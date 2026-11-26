import { isHttpUrl } from '../../shared/profile-link';

/** What the Profile link setting offers: the site's pattern, the person's own URL, or no link at all. */
export type LinkChoice = 'auto' | 'custom' | 'none';

/** The longest custom link the server accepts. */
export const LINK_MAX = 2048;

/** What goes to `threads:upsert-author` as `link`: null = automatic, false = no link, a string = own link. */
export type LinkValue = string | false | null;

export type LinkResult = { ok: true; value: LinkValue } | { ok: false };

/** Which radio is selected for a stored `link` (absent = automatic). Without the automatic option, absent reads as no link. */
export function choiceFromLink(link: string | false | undefined, autoAvailable: boolean): LinkChoice {
  if (link === false) return 'none';
  if (typeof link === 'string') return 'custom';
  return autoAvailable ? 'auto' : 'none';
}

/** The `link` to send for a choice, or `{ ok: false }` for a custom URL the server would refuse (not http/https, empty, too long). */
export function linkFromChoice(choice: LinkChoice, url: string, autoAvailable: boolean): LinkResult {
  if (choice === 'none') return { ok: true, value: false };
  if (choice === 'auto') return autoAvailable ? { ok: true, value: null } : { ok: true, value: false };
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > LINK_MAX || !isHttpUrl(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}
