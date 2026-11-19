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
  | { kind: 'add-thread'; opId: string; at: string; file: string; threadId: string; commentId: string; body: string }
  | { kind: 'add-comment'; opId: string; at: string; file: string; threadId: string; commentId: string; parentId: string | null; body: string }
  | { kind: 'edit-comment'; opId: string; at: string; file: string; threadId: string; commentId: string; body: string }
  | { kind: 'delete-comment'; opId: string; at: string; file: string; threadId: string; commentId: string }
  | { kind: 'delete-thread'; opId: string; at: string; file: string; threadId: string }
  | { kind: 'resolve-thread'; opId: string; at: string; file: string; threadId: string }
  | { kind: 'toggle-reaction'; opId: string; at: string; file: string; threadId: string; commentId: string; emoji: string };

/** A DraftOp as the caller supplies it: the store assigns `opId` and `at`. */
export type NewDraftOp = DraftOp extends infer O ? (O extends DraftOp ? Omit<O, 'opId' | 'at'> : never) : never;

/** One user's private, unpublished changes (`<docsRoot>/.threads/drafts/<slug>.json`). */
export interface Journal {
  version: 1;
  ops: DraftOp[];
}

/** Who is making a call: the journal key and the display name. */
export interface Caller {
  key: string;
  name: string;
}
