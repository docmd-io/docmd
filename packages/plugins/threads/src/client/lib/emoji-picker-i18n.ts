import { t } from './i18n';
import type { EmojiPickerI18n } from '../vendor/emoji-picker/picker.js';

const CATEGORIES = [
  'custom',
  'smileys-emotion',
  'people-body',
  'animals-nature',
  'food-drink',
  'travel-places',
  'activities',
  'objects',
  'symbols',
  'flags',
] as const;

/**
 * The strings the vendored picker shows, from `t()` under `emojiPicker.*` (the picker's own i18n files
 * are not copied). Passed as its `i18n` property. Read at call time, so a later `setThreadsStrings`
 * or the page's injected language is honoured.
 */
export function emojiPickerI18n(): EmojiPickerI18n {
  const s = (key: string) => t(`emojiPicker.${key}`);
  return {
    categoriesLabel: s('categoriesLabel'),
    emojiUnsupportedMessage: s('emojiUnsupportedMessage'),
    favoritesLabel: s('favoritesLabel'),
    loadingMessage: s('loadingMessage'),
    networkErrorMessage: s('networkErrorMessage'),
    regionLabel: s('regionLabel'),
    searchDescription: s('searchDescription'),
    searchLabel: s('searchLabel'),
    searchResultsLabel: s('searchResultsLabel'),
    skinToneDescription: s('skinToneDescription'),
    skinToneLabel: s('skinToneLabel'),
    skinTonesLabel: s('skinTonesLabel'),
    skinTones: [0, 1, 2, 3, 4, 5].map((i) => s(`skinTone.${i}`)),
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, s(`category.${c}`)])),
  };
}
