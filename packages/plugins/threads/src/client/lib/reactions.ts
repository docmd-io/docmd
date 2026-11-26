import { profileHref } from '../../shared/profile-link';
import type { AuthorsMap, Reaction } from '../../types';

/** Pure helpers for reactions and comment authors: who is "me", who to show, and where names link. DOM-free. */

/** One person who reacted, as the components show them: the name is the current one, `href` the profile link or null. */
export interface ReactorView {
  key: string | null;
  name: string;
  href: string | null;
}

export interface ReactionView {
  emoji: string;
  reactors: ReactorView[];
}

/** Who the server records for the current caller. */
export interface Viewer {
  key: string | null;
  name: string;
}

/** The comment author as `threads-comment` shows them. */
export interface AuthorView {
  name: string;
  avatarUrl: string;
  href: string | null;
}

const has = (authors: AuthorsMap, key: string): boolean => Object.hasOwn(authors, key);

/**
 * Turn the server's reactions into component props: the shown name is the author's current name when
 * the reactor has a key in `authors` (so renaming yourself keeps your reactions), the stored name
 * otherwise; `href` comes from `profileHref`. Keys are carried for "mine" matching and never displayed.
 */
export function toReactionViews(reactions: Reaction[], authors: AuthorsMap, profileUrl: string | null): ReactionView[] {
  return reactions.map((reaction) => ({
    emoji: reaction.emoji,
    reactors: reaction.reactors.map((reactor) => ({
      key: reactor.key,
      name: reactor.key !== null && has(authors, reactor.key) && authors[reactor.key]!.name ? authors[reactor.key]!.name : reactor.name,
      href: profileHref(reactor.key, authors, profileUrl),
    })),
  }));
}

/**
 * The author of a comment: looked up by `authorKey`, and for legacy comments with no key by display
 * name (then by first name, which old comments sometimes carry). Only a key gives a profile link.
 */
export function toAuthorView(
  comment: { author: string; authorKey?: string | null },
  authors: AuthorsMap,
  profileUrl: string | null,
): AuthorView {
  const key = comment.authorKey ?? null;
  const entries = Object.values(authors);
  const info =
    (key !== null && has(authors, key) ? authors[key] : undefined) ??
    entries.find((a) => a.name === comment.author) ??
    entries.find((a) => a.name.split(/\s+/)[0] === comment.author);
  return {
    name: info?.name || comment.author,
    avatarUrl: info?.avatarUrl ?? '',
    href: profileHref(key, authors, profileUrl),
  };
}

/**
 * Whether a reactor is the viewer: equal keys when both are set; for a reactor stored without a key
 * (an old name-only line), equal names. A reactor with a key never matches a viewer without one.
 */
export function isMine(reactor: Pick<ReactorView, 'key' | 'name'>, viewer: Viewer): boolean {
  if (reactor.key !== null) return viewer.key !== null && reactor.key === viewer.key;
  return viewer.name !== '' && reactor.name === viewer.name;
}

export function reactionIsMine(reaction: ReactionView, viewer: Viewer): boolean {
  return reaction.reactors.some((r) => isMine(r, viewer));
}

/** The names on a reaction, in stored order. Never keys. */
export function reactorNames(reaction: ReactionView): string[] {
  return reaction.reactors.map((r) => r.name);
}

/** `a, b and c` in the page language; plain commas where Intl.ListFormat is missing. */
export function listNames(names: string[], lang: string = 'en'): string {
  try {
    return new Intl.ListFormat(lang || 'en', { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** The accessible name of a chip: "<emoji> <count>: <names>". */
export function chipLabel(reaction: ReactionView, lang?: string): string {
  return `${reaction.emoji} ${reaction.reactors.length}: ${listNames(reactorNames(reaction), lang)}`;
}

export interface ChipRule {
  options: readonly string[];
  restricted: boolean;
}

/**
 * Whether a chip is disabled. Any existing emoji toggles, listed or not; the one exception is a
 * restricted site: a chip whose emoji is no longer in the list is clickable only while pressed (the
 * viewer may still take back their own old reaction). The server enforces the same rule.
 */
export function chipDisabled(emoji: string, pressed: boolean, rule: ChipRule): boolean {
  return rule.restricted && !rule.options.includes(emoji) && !pressed;
}

/** Whether the quick row shows the trailing + button: only when unrestricted and a picker module is set. */
export function showAddButton(restricted: boolean, pickerSrc: string | null | undefined): boolean {
  return !restricted && !!pickerSrc;
}

/** The picker locale for an emoji data URL such as `.../emoji/zh.json`; `en` when it does not say. */
export function pickerLocale(emojiDataSrc: string | null | undefined): string {
  const name = /(?:^|\/)([a-z]{2,3})\.json(?:[?#].*)?$/i.exec(emojiDataSrc ?? '')?.[1];
  return name ? name.toLowerCase() : 'en';
}

/** GitHub's eight, the default quick row. Mirrors `DEFAULT_REACTION_EMOJI` in shared/emoji.ts, which the client does not import (it builds a `v`-flag RegExp when loaded). */
export const QUICK_REACTIONS: readonly string[] = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];

/** How long a chip is hovered or focused before the who card opens, and the grace to move the pointer onto it. */
export const WHO_DELAY_MS = 400;
export const WHO_HIDE_MS = 150;

/**
 * What a `threads-react` listener resolved to, if it is a reaction list: the component replaces its
 * reactions with it. Anything else (no value, several listeners' array of arrays) leaves them alone.
 */
export function asReactionViews(result: unknown): ReactionView[] | null {
  if (!Array.isArray(result)) return null;
  const ok = result.every(
    (r) =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as ReactionView).emoji === 'string' &&
      Array.isArray((r as ReactionView).reactors),
  );
  return ok ? (result as ReactionView[]) : null;
}

/** Raw reactions with no profile links: what a comment shows before the app has resolved any. */
export function plainReactionViews(reactions: Reaction[]): ReactionView[] {
  return reactions.map((r) => ({ emoji: r.emoji, reactors: r.reactors.map((x) => ({ key: x.key, name: x.name, href: null })) }));
}
