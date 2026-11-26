/** Types for the vendored picker (hand-written for @docmd/plugin-threads; the upstream .d.ts files are not copied). */
export interface EmojiPickerI18n {
  categoriesLabel: string;
  emojiUnsupportedMessage: string;
  favoritesLabel: string;
  loadingMessage: string;
  networkErrorMessage: string;
  regionLabel: string;
  searchDescription: string;
  searchLabel: string;
  searchResultsLabel: string;
  skinToneDescription: string;
  skinToneLabel: string;
  skinTonesLabel: string;
  skinTones: string[];
  categories: Record<string, string>;
}

export default class PickerElement extends HTMLElement {
  dataSource: string;
  locale: string;
  i18n: EmojiPickerI18n;
}

export function rescueElementPrototype(element: Element): void;
