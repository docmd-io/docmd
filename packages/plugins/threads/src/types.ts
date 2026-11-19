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
