/**
 * Emoji handling shared by the server and the client.
 *
 * `\p{RGI_Emoji}` is the exact test, but it depends on the Unicode version of the JavaScript engine
 * (a newer emoji fails on an older Node) and refuses a redundant variation selector (U+FE0F after an
 * emoji that already shows as a picture, as the picker's data has it for 👍 and many more). So the
 * check has three steps: the string as given, the string without U+FE0F, and a structural check of one
 * emoji grapheme that does not depend on the engine's emoji table.
 */

const FE0F = /️/g;

let rgi: RegExp | null | undefined;
/** Built on first use, from a string, so engines or TypeScript targets without the `v` flag still load this file. */
function rgiEmoji(): RegExp | null {
  if (rgi === undefined) {
    try {
      rgi = new RegExp('^\\p{RGI_Emoji}$', 'v');
    } catch {
      rgi = null;
    }
  }
  return rgi;
}

/**
 * One emoji built from pictographs: modifiers, tags (subdivision flags), joiners, a region pair
 * (flag) or a keycap. No comma, space or line break can be part of it.
 */
const PICTOGRAPH = '\\p{Extended_Pictographic}[\\u{1F3FB}-\\u{1F3FF}\\uFE0F]*[\\u{E0020}-\\u{E007F}]*';
const STRUCTURE = new RegExp(
  `^(?:${PICTOGRAPH}(?:\\u200D${PICTOGRAPH})*|\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3)$`,
  'u',
);

let segmenter: Intl.Segmenter | null | undefined;
function oneGrapheme(value: string): boolean {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
  }
  if (!segmenter) return true;
  let n = 0;
  for (const _ of segmenter.segment(value)) if (++n > 1) return false;
  return n === 1;
}

const accepts = (value: string): boolean => {
  const re = rgiEmoji();
  if (re?.test(value)) return true;
  return value.length <= 64 && STRUCTURE.test(value) && oneGrapheme(value);
};

/**
 * The one spelling used to store, compare and show an emoji, or null when the value is not a
 * single emoji. A spelling that is already valid is kept (so ❤️ keeps its selector); otherwise
 * the redundant U+FE0F is dropped (so the picker's 👍️ becomes 👍).
 */
export function normalizeEmoji(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const re = rgiEmoji();
  if (re?.test(value)) return value;
  const bare = value.replace(FE0F, '');
  if (bare !== value && re?.test(bare)) return bare;
  if (!accepts(value)) return null;
  // Structural match only (an emoji this engine does not know): prefer the form without a redundant selector
  // when the base is a default-emoji-presentation character, which only the RGI table can tell; keep as given.
  return value;
}

/** One emoji: skin-tone, flag, keycap and ZWJ sequences count as one. */
export const isSingleEmoji = (value: unknown): value is string => normalizeEmoji(value) !== null;

/** GitHub's eight reactions: the default offer. */
export const DEFAULT_REACTION_EMOJI: readonly string[] = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];
