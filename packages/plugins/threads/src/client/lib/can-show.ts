/**
 * Whether the UI should offer an action. The same table as the server's `canDo`
 * (src/plugin/permissions.ts); the server stays the authority and still answers
 * `threads/forbidden`. DOM-free.
 */
export type ShowAction = 'delete-comment' | 'delete-thread' | 'resolve-thread' | 'discard-review';

export interface ShowContext {
  callerKey: string | null;
  isAdmin: boolean;
  /** 'payload' is the local (dev) identity: never enforced, so always shown. */
  source: 'payload' | 'header';
  resolveRule: 'anyone' | 'author';
}

export interface ShowTarget {
  authorKey?: string | null;
  authorKeys?: Array<string | null | undefined>;
  threadAuthor?: string | null;
  /** discard-review: the key on the review's manifest; null if it has none. */
  reviewAuthor?: string | null;
  /** An op in the caller's own journal: always theirs. */
  drafted?: boolean;
}

export function canShow(action: ShowAction, ctx: ShowContext, target: ShowTarget): boolean {
  if (ctx.source === 'payload') return true;
  const mine = (key: string | null | undefined) => !!key && key === ctx.callerKey;
  if (ctx.isAdmin || target.drafted) return true;
  switch (action) {
    case 'delete-comment':
      return mine(target.authorKey);
    case 'delete-thread':
      return (target.authorKeys ?? []).every(mine);
    case 'resolve-thread':
      return ctx.resolveRule === 'anyone' || mine(target.threadAuthor);
    case 'discard-review':
      return mine(target.reviewAuthor);
  }
}

/**
 * The target the server checks for a comment delete. The opening comment of a
 * thread that has published replies deletes the whole thread and is admin only
 * (`authorKey: null`); drafts are always the caller's own.
 */
export function deleteCommentTarget(
  comments: Array<{ id: string; authorKey?: string | null; draft?: unknown }>,
  commentId: string,
): ShowTarget {
  const c = comments.find((x) => x.id === commentId);
  if (!c) return { authorKey: null };
  if (c.draft) return { authorKey: c.authorKey, drafted: true };
  const wholeThread = comments.filter((x) => !x.draft).length > 1 && comments[0]?.id === commentId;
  return { authorKey: wholeThread ? null : c.authorKey, drafted: false };
}
