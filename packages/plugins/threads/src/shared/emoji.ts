/** One emoji: skin-tone, flag, keycap and ZWJ sequences count as one. Built from a string so older TypeScript targets accept the `v` flag. */
const SINGLE_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');

export const isSingleEmoji = (value: unknown): value is string => typeof value === 'string' && SINGLE_EMOJI.test(value);

/** GitHub's eight reactions: the default offer. */
export const DEFAULT_REACTION_EMOJI: readonly string[] = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];
