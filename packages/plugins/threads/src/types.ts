export interface Author {
  name: string;
  avatarUrl: string;
}

export interface AuthorsMap {
  [key: string]: Author;
}

export interface Thread {
  id: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  comments: Comment[];
  anchor?: { quote: string };
  /** Set by the overlay: this thread exists only in the caller's draft journal. */
  draft?: true;
  /** Set on read: the anchor quote has no `==...=={id}` mark in the page body any more. */
  orphaned?: true;
}

export interface Comment {
  id: string;
  thread_id: string;
  parent_id: string | null;
  author: string;
  date: string;
  edited_at: string | null;
  authorKey?: string;
  reviewId?: string;
  body: string;
  reactions: Reaction[];
  /** Set on the caller's own unpublished comments. */
  draft?: true;
}

export interface Reaction {
  emoji: string;
  authors: string[];
}

export interface Anchor {
  quote: string;
  prefix: string | null;
  suffix: string | null;
  selector: string | null;
  offset: number | null;
  blockText: string | null;
}

export interface CreateThreadPayload {
  file: string;
  anchor: Anchor | null;
  author: string;
  body: string;
}

export interface AddCommentPayload {
  file: string;
  threadId: string;
  parentId?: string | null;
  author: string;
  body: string;
}

export interface EditCommentPayload {
  file: string;
  threadId: string;
  commentId: string;
  body: string;
}

export interface DeleteCommentPayload {
  file: string;
  threadId: string;
  commentId: string;
}

export interface ResolveThreadPayload {
  file: string;
  threadId: string;
  resolved_by: string;
}

export interface ToggleReactionPayload {
  file: string;
  threadId: string;
  commentId: string;
  emoji: string;
  author: string;
}

/** One private, unpublished change. The store assigns `opId` and `at`. */
export type DraftOp =
  | { kind: 'add-thread'; opId: string; at: string; file: string; threadId: string; commentId: string; anchor: Anchor | null; body: string }
  | { kind: 'add-comment'; opId: string; at: string; file: string; threadId: string; commentId: string; parentId: string | null; body: string }
  | { kind: 'edit-comment'; opId: string; at: string; file: string; threadId: string; commentId: string; body: string }
  | { kind: 'delete-comment'; opId: string; at: string; file: string; threadId: string; commentId: string }
  /** `commentIds`: the published comments the caller saw; publish skips the op if the thread has gained others. */
  | { kind: 'delete-thread'; opId: string; at: string; file: string; threadId: string; commentIds?: string[] }
  | { kind: 'resolve-thread'; opId: string; at: string; file: string; threadId: string }
  | { kind: 'toggle-reaction'; opId: string; at: string; file: string; threadId: string; commentId: string; emoji: string };

/** A DraftOp as the caller supplies it: the store assigns `opId` and `at`. */
export type NewDraftOp = DraftOp extends infer O ? (O extends DraftOp ? Omit<O, 'opId' | 'at'> : never) : never;

/** One user's private, unpublished changes (`<docsRoot>/.threads/drafts/<slug>.json`). */
export interface Journal {
  version: 1;
  /** `auto` publishes on a timer after the last edit; `collect` waits for the Publish button. */
  mode: DraftMode;
  /** The review these ops belong to; a journal saved without it gets one on load. */
  review: {
    id: string;
    /** ISO time of the last change to the journal: the auto-publish countdown runs from it. */
    updatedAt: string;
    /** The commenter's name for the review; null means the manifest gets the default title. */
    title: string | null;
    /** Longer text for the review: the manifest records it and, with git sync, it is the commit body. */
    summary: string | null;
  };
  ops: DraftOp[];
  /**
   * The caller's own author entry, waiting for their next publish (set only under serve with git
   * sync on; a later edit replaces it). Absent on journals that never had one.
   */
  profile?: { name: string; avatarUrl: string };
}

export type DraftMode = 'auto' | 'collect';

/** What `threads:whoami` returns: the caller and their journal, both null when the call carries no identity. */
export interface WhoAmI {
  identity: Caller | null;
  journal: Journal | null;
  /** Published threads started by the caller whose anchor text is gone from the page. */
  orphanedMine: number;
}

/** A published op as a manifest records it: what a later reversal or listing needs. */
export type ManifestOp = DraftOp & {
  /** The state the op replaced (edit, delete, resolve and reaction ops). */
  before?: Record<string, unknown>;
  /** The quoted text an add-thread op anchored to. */
  quote?: string;
  /** Title of the page the op targeted, when it has one. */
  pageTitle?: string;
};

/** `<docsRoot>/.threads/reviews/<id>.json`: one published review. */
export interface ReviewManifest {
  version: 1;
  id: string;
  authorKey: string;
  authorName: string;
  title: string;
  /** The commenter's summary of the review, null when none. */
  summary: string | null;
  state: 'published' | 'discarded';
  publishedAt: string;
  discardedAt?: string;
  discardedBy?: string;
  ops: ManifestOp[];
  skipped: Array<{ opId: string; reason: string }>;
  /** Ops discard could not reverse (target gone since the publish). */
  discardSkipped?: Array<{ opId: string; reason: string }>;
}

/** One review as `threads:list-reviews` returns it. */
export interface ReviewSummary {
  id: string;
  authorKey: string;
  authorName: string;
  title: string;
  publishedAt: string;
  state: 'published' | 'discarded';
  ops: Array<{ file: string; threadId: string; quote: string | null; pageTitle: string | null }>;
}

export interface PublishResult {
  reviewId: string;
  skipped: Array<{ opId: string; reason: string }>;
}

/** Who is making a call: the journal key, the display name and where the identity came from. */
export interface Caller {
  key: string;
  name: string;
  avatarUrl: string;
  /** `header`: the core's trusted identity (`docmd serve`); `payload`: the client named itself (dev). */
  source: 'payload' | 'header';
  /** True iff the key is in `permissions.admins`; always false for payload callers. */
  isAdmin: boolean;
}
