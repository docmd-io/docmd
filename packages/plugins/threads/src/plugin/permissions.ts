import { ThreadsError } from './errors.js';
import type { Caller } from '../types.js';

export type PermissionAction = 'edit-comment' | 'delete-comment' | 'delete-thread' | 'resolve-thread' | 'discard-review' | 'upsert-author';

/** What the action touches. A missing or null key is a legacy (unattributed) record. */
export interface PermissionTarget {
  /** edit-comment, delete-comment, upsert-author: the key on the comment, or the key the payload names. */
  authorKey?: string | null;
  /** delete-thread: the key on each published comment of the thread. */
  authorKeys?: Array<string | null | undefined>;
  /** resolve-thread: the key on the thread's first comment; null if legacy. */
  threadAuthor?: string | null;
  /** discard-review: the key on the review's manifest; null if it has none. */
  reviewAuthor?: string | null;
  /** The target is an op in the caller's own journal: always theirs. */
  drafted?: boolean;
}

export interface PermissionOptions {
  resolve: 'anyone' | 'author';
}

/**
 * Whether `caller` may perform `action` on `target`. Payload callers (`docmd dev`)
 * are not enforced; admins pass everything except `upsert-author`, which only
 * ever touches the caller's own entry.
 */
export function canDo(caller: Caller, action: PermissionAction, target: PermissionTarget, opts: PermissionOptions): boolean {
  if (caller.source === 'payload') return true;
  const mine = (key: string | null | undefined) => !!key && key === caller.key;
  if (action === 'upsert-author') return target.authorKey == null || mine(target.authorKey);
  if (caller.isAdmin || target.drafted) return true;
  switch (action) {
    case 'edit-comment':
    case 'delete-comment':
      return mine(target.authorKey);
    case 'delete-thread':
      return (target.authorKeys ?? []).every(mine);
    case 'resolve-thread':
      return opts.resolve === 'anyone' || mine(target.threadAuthor);
    case 'discard-review':
      return mine(target.reviewAuthor);
  }
}

/** Throws `threads/forbidden` unless `canDo`. */
export function assertCan(caller: Caller, action: PermissionAction, target: PermissionTarget, opts: PermissionOptions): void {
  if (!canDo(caller, action, target, opts)) {
    throw new ThreadsError('forbidden', `${action} is not allowed for ${caller.key}`);
  }
}
