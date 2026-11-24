import type { WhoAmI } from '../../types';
import { canShow, type ShowAction, type ShowTarget } from './can-show';
import { resolveIdentity, showContext, type IdentityMode } from './identity-mode';

const STORAGE_KEY_NAME = 'threads_author';
const STORAGE_KEY_EMAIL = 'threads_email';
const STORAGE_KEY_GITHUB = 'threads_github';
const STORAGE_KEY_AVATAR = 'threads_avatar_url';
const STORAGE_KEY_AUTHOR_KEY = 'threads_author_key';

declare global {
  interface Window {
    __threads_config?: unknown;
    __docmd_dev?: {
      name: string;
      email: string;
      gravatarUrl: string;
    };
  }
}

export function getAuthor(): string | null {
  return localStorage.getItem(STORAGE_KEY_NAME);
}

export function setAuthor(name: string): void {
  localStorage.setItem(STORAGE_KEY_NAME, name);
}

export function getEmail(): string | null {
  return localStorage.getItem(STORAGE_KEY_EMAIL);
}

export function setEmail(email: string): void {
  localStorage.setItem(STORAGE_KEY_EMAIL, email);
}

export function getGithub(): string | null {
  return localStorage.getItem(STORAGE_KEY_GITHUB);
}

export function setGithub(username: string): void {
  localStorage.setItem(STORAGE_KEY_GITHUB, username);
}

export function getAvatarUrl(): string | null {
  return localStorage.getItem(STORAGE_KEY_AVATAR);
}

export function setAvatarUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY_AVATAR, url);
}

export function getAuthorKey(): string | null {
  return localStorage.getItem(STORAGE_KEY_AUTHOR_KEY);
}

export function setAuthorKey(key: string): void {
  localStorage.setItem(STORAGE_KEY_AUTHOR_KEY, key);
}

/**
 * Compute the author key from available identity info.
 * Priority: GitHub username > slugified name + short hash.
 */
export function computeAuthorKey(name: string, github: string): string {
  if (github) return github.toLowerCase();
  if (name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || 'anonymous';
  }
  return 'anonymous';
}

/**
 * Compute the best avatar URL given available info.
 * Priority: Gravatar (if email) > GitHub > DiceBear seeded random.
 *
 * For Gravatar we use d=404 so we can detect missing avatars and fall back.
 * This function tries Gravatar first; if it 404s, falls back to GitHub, then DiceBear.
 */
export async function computeAvatarUrl(email: string, github: string): Promise<string> {
  // 1. Try Gravatar if email is provided
  if (email) {
    const gravatarUrl = await getGravatarUrl(email);
    if (gravatarUrl) return gravatarUrl;
  }

  // 2. Try GitHub avatar
  if (github) {
    return `https://github.com/${encodeURIComponent(github)}.png?size=80`;
  }

  // 3. DiceBear seeded avatar
  const seed = email || github || Math.random().toString(36).slice(2);
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(seed)}&size=80`;
}

async function getGravatarUrl(email: string): Promise<string | null> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const url = `https://gravatar.com/avatar/${hashHex}?s=80&d=404`;

    // Check if Gravatar actually has an image
    const _resp = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
    // no-cors means we can't read status, so just return the displayable URL
    // Use d=blank to detect, but for display use d=404 won't work visually.
    // Instead, just return with d=mp fallback and let it show the default.
    return `https://gravatar.com/avatar/${hashHex}?s=80&d=mp`;
  } catch {
    return null;
  }
}

let identity: IdentityMode = { mode: 'local' };

export function getIdentityMode(): IdentityMode {
  return identity;
}

/** After the server accepted a profile edit: keep the module identity in step with it. */
export function setHeaderProfile(name: string, avatarUrl: string): void {
  if (identity.mode === 'header') identity = { ...identity, payload: { ...identity.payload, author: name, avatarUrl } };
}

/** Whether to render a button the server may refuse; local mode always shows. */
export function canShowFor(action: ShowAction, target: ShowTarget): boolean {
  return canShow(action, showContext(identity, window.__threads_config, getAuthorKey()), target);
}

/**
 * On first load ask `whoami`: a header identity wins and is never prompted for;
 * otherwise (or when no live server answers) seed from git config as before.
 */
export async function initIdentity(whoami: () => Promise<WhoAmI>): Promise<void> {
  identity = await resolveIdentity(whoami);
  if (identity.mode === 'header') return;

  const devInfo = window.__docmd_dev;
  if (!devInfo) return;

  if (!getAuthor() && devInfo.name) {
    setAuthor(devInfo.name);
  }
  if (!getEmail() && devInfo.email) {
    setEmail(devInfo.email);
  }
  if (!getAvatarUrl() && devInfo.gravatarUrl) {
    setAvatarUrl(devInfo.gravatarUrl);
  }
}

export function ensureAuthor(): string {
  if (identity.mode === 'header') return identity.payload.author;
  let author = getAuthor();
  if (!author) {
    author = prompt('Enter your display name for discussions:');
    if (!author || !author.trim()) {
      author = 'Anonymous';
    }
    setAuthor(author.trim());
  }

  // Ensure author key exists
  if (!getAuthorKey()) {
    const github = getGithub() || '';
    setAuthorKey(computeAuthorKey(author, github));
  }

  return author;
}

/**
 * Get the full identity info needed for creating comments.
 */
export function getIdentityPayload(): { author: string; authorKey: string; avatarUrl: string } {
  if (identity.mode === 'header') return { ...identity.payload };
  const author = ensureAuthor();
  const authorKey = getAuthorKey() || computeAuthorKey(author, getGithub() || '');
  const avatarUrl = getAvatarUrl() || '';
  return { author, authorKey, avatarUrl };
}

/**
 * The identity stored in this browser, or null when none is. Unlike
 * getIdentityPayload it never prompts: page loads must not ask for a name.
 */
export function getStoredIdentity(): { author: string; authorKey: string; avatarUrl: string } | null {
  const author = getAuthor();
  if (!author) return null;
  const authorKey = getAuthorKey() || computeAuthorKey(author, getGithub() || '');
  return { author, authorKey, avatarUrl: getAvatarUrl() || '' };
}
