import { getStoredIdentity } from './identity';
import type { Thread, Comment, Reaction, AuthorsMap } from '../../types';

declare global {
  var docmd: {
    call(action: string, payload: any): Promise<any>;
    send(name: string, data: any): void;
    on(name: string, callback: (data: any) => void): () => void;
    afterReload(name: string, callback: (ctx: any) => void): void;
    scheduleReload(name: string, context?: any): void;
  };
}

function getSourceFile(): string {
  const file = document.body.dataset['sourceFile'];
  if (!file) throw new Error('[threads] data-source-file not found on body element');
  return file;
}

/** The identity every threads call carries, so the server can tell whose drafts to use. Never prompts. */
function identity(): { author: string; authorKey: string; avatarUrl: string } | Record<string, never> {
  return getStoredIdentity() ?? {};
}

export async function fetchAuthors(): Promise<AuthorsMap> {
  try {
    return await docmd.call('threads:get-authors', {});
  } catch {
    // Fallback to injected global (static builds)
    return (window as any).__threads_authors || {};
  }
}

export async function upsertAuthor(authorKey: string, name: string, avatarUrl: string): Promise<void> {
  await docmd.call('threads:upsert-author', { authorKey, name, avatarUrl });
}

export async function fetchThreads(): Promise<Thread[]> {
  return docmd.call('threads:get-threads', { file: getSourceFile(), ...identity() });
}

export async function createThread(payload: {
  anchor: any | null;
  author: string;
  body: string;
  authorKey?: string;
  avatarUrl?: string;
}): Promise<Thread> {
  return docmd.call('threads:add-thread', {
    file: getSourceFile(),
    ...identity(),
    ...payload,
  });
}

export async function addComment(
  threadId: string,
  payload: { author: string; body: string; parentId?: string | null; authorKey?: string; avatarUrl?: string },
): Promise<Comment> {
  return docmd.call('threads:add-comment', {
    file: getSourceFile(),
    ...identity(),
    threadId,
    ...payload,
  });
}

export async function editComment(
  threadId: string,
  commentId: string,
  payload: { body: string },
): Promise<Comment> {
  return docmd.call('threads:edit-comment', {
    file: getSourceFile(),
    ...identity(),
    threadId,
    commentId,
    ...payload,
  });
}

export async function deleteComment(
  threadId: string,
  commentId: string,
): Promise<void> {
  await docmd.call('threads:delete-comment', {
    file: getSourceFile(),
    ...identity(),
    threadId,
    commentId,
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  await docmd.call('threads:delete-thread', {
    file: getSourceFile(),
    ...identity(),
    threadId,
  });
}

export async function resolveThread(
  threadId: string,
  payload: { resolved_by: string },
): Promise<Thread> {
  return docmd.call('threads:resolve-thread', {
    file: getSourceFile(),
    ...identity(),
    threadId,
    ...payload,
  });
}

export async function toggleReaction(
  threadId: string,
  commentId: string,
  payload: { emoji: string; author: string },
): Promise<Reaction[]> {
  return docmd.call('threads:toggle-reaction', {
    file: getSourceFile(),
    ...identity(),
    threadId,
    commentId,
    ...payload,
  });
}
