/**
 * Where a person's name links to. Pure and free of Node APIs: the server (build-time comment and
 * reactions rules) and the client bundle both import it, so the two views agree.
 */
import type { AuthorsMap } from '../types.js';

/** True for an absolute http or https URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Percent-encode a key once. A key that already carries escapes (the journal key of an identity
 * with a space is `a%20b`) is decoded first, so `%20` stays `%20` instead of becoming `%2520`.
 * A key with a stray `%` is not valid percent-encoding: it is encoded as it is.
 */
function encodeKey(key: string): string {
  let plain = key;
  try {
    plain = decodeURIComponent(key);
  } catch {
    /* not percent-encoded: use as is */
  }
  return encodeURIComponent(plain);
}

/**
 * The profile URL for a name, or null for none:
 * - no key: null (nothing identifies the person);
 * - `authors[key].link === false`: null, the person turned linking off;
 * - a string `link` that is an http(s) URL: that link (the author's own claim, not verified);
 * - otherwise the site's `profileUrl` pattern with `{id}` replaced by the key, or null when there is none.
 */
export function profileHref(key: string | null, authors: AuthorsMap, profileUrl: string | null): string | null {
  if (key === null) return null;
  const link = Object.hasOwn(authors, key) ? authors[key]?.link : undefined;
  if (link === false) return null;
  if (typeof link === 'string' && isHttpUrl(link)) return link;
  if (!profileUrl) return null;
  return profileUrl.split('{id}').join(encodeKey(key));
}
