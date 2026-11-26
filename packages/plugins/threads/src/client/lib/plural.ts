import { t } from './i18n';

const rules = new Map<string, Intl.PluralRules>();

/** The page language, `en` when there is none (or no document). */
export function pageLang(): string {
  return (globalThis as { document?: Document }).document?.documentElement?.lang || 'en';
}

/** True when `n` takes the "one" form in the language (`en`: 1; `hi`: 0 and 1; `ko`, `zh`: never). */
export function isOne(n: number, lang: string = pageLang()): boolean {
  let pr = rules.get(lang);
  if (pr === undefined) {
    try {
      pr = new Intl.PluralRules(lang);
    } catch {
      pr = new Intl.PluralRules('en');
    }
    rules.set(lang, pr);
  }
  return pr.select(n) === 'one';
}

/** The string key for a count: `key` for many, `keyOne` for one, as chosen by the page language's plural rules. */
export const pluralKey = (key: string, n: number, lang?: string): string => (isOne(n, lang) ? `${key}One` : key);

/** A counted string with `{n}` filled in: `unpublishedCount` / `unpublishedCountOne`. */
export function tCount(key: string, n: number, tr: (key: string) => string = t, lang?: string): string {
  return tr(pluralKey(key, n, lang)).replace('{n}', String(n));
}
