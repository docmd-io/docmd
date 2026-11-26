import { pageLang } from './plural';

/** A stored date with no time of day: `2026-03-05`. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A comment's stored date as a reader expects it in the page language: `Mar 5, 2026` for a date, and
 * `Mar 5, 2026, 10:00 AM` for a value that carries a time (shown in the reader's own time zone).
 * A date-only value names a calendar day, not an instant: it is formatted in UTC so no time zone can move it to
 * the day before. A value that is not a date comes back as written, and so does a language the browser lacks
 * (the browser's own default language is used then).
 */
export function formatDateTime(value: string, lang: string = pageLang()): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const dateOnly = DATE_ONLY.test(raw);
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat(lang, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}
