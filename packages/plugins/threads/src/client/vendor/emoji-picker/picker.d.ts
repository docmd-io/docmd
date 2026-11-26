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
  /** Resolves once the emoji data is in IndexedDB; rejects when it cannot be loaded. */
  readonly database: { ready(): Promise<void> };
}

export function rescueElementPrototype(element: Element): void;

/** The picker element, as `document.createElement('threads-emoji-picker')` returns it. */
export type EmojiPickerElement = PickerElement;
