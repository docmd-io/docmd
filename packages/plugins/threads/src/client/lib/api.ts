import { getIdentityPayload, getStoredIdentity } from './identity';
import type { Thread, Comment, Reaction, AuthorsMap, DraftMode, Journal, PublishResult, WhoAmI } from '../../types';

declare global {
  var docmd: {
    call(action: string, payload: any): Promise<any>;
    send(name: string, data: any): void;
    on(name: string, callback: (data: any) => void): () => void;
    afterReload(name: string, callback: (ctx: any) => void): void;
    scheduleReload(name: string, context?: any): void;
    /** Whether the live socket is open; absent on bridges that predate it. */
    isLive?(): boolean;
  };
}

function getSourceFile(): string {
  const file = document.body.dataset['sourceFile'];
  if (!file) throw new Error('[threads] data-source-file not found on body element');
  return file;
}

/** Identity for reads: whatever is stored. Page loads never prompt. */
function storedIdentity(): { author: string; authorKey: string; avatarUrl: string } | Record<string, never> {
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
  return docmd.call('threads:get-threads', { file: getSourceFile(), ...storedIdentity() });
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
    ...getIdentityPayload(),
    ...payload,
  });
}

export async function addComment(
  threadId: string,
  payload: { author: string; body: string; parentId?: string | null; authorKey?: string; avatarUrl?: string },
): Promise<Comment> {
  return docmd.call('threads:add-comment', {
    file: getSourceFile(),
    ...getIdentityPayload(),
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
    ...getIdentityPayload(),
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
    ...getIdentityPayload(),
    threadId,
    commentId,
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  await docmd.call('threads:delete-thread', {
    file: getSourceFile(),
    ...getIdentityPayload(),
    threadId,
  });
}

export async function resolveThread(
  threadId: string,
  payload: { resolved_by: string },
): Promise<Thread> {
  return docmd.call('threads:resolve-thread', {
    file: getSourceFile(),
    ...getIdentityPayload(),
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
    ...getIdentityPayload(),
    threadId,
    commentId,
    ...payload,
  });
}

/** A server rejection `threads/<code>: <text>` parsed back into its parts. */
export class ThreadsClientError extends Error {
  readonly code: string;
  readonly text: string;

  constructor(code: string, text: string) {
    super(`threads/${code}: ${text}`);
    this.name = 'ThreadsClientError';
    this.code = code;
    this.text = text;
  }
}

const WIRE_ERROR = /^threads\/([a-z][a-z-]*): ([\s\S]*)$/;

/** `docmd.call` that turns `threads/<code>: <text>` rejections into ThreadsClientError. */
async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await docmd.call(action, payload);
  } catch (err) {
    const m = WIRE_ERROR.exec(err instanceof Error ? err.message : String(err));
    if (m) throw new ThreadsClientError(m[1]!, m[2]!);
    throw err;
  }
}

/** The caller's journal. Read on every page load, so it never prompts for a name. */
export function whoami(): Promise<WhoAmI> {
  return call('threads:whoami', storedIdentity());
}

export function setMode(mode: DraftMode): Promise<Journal> {
  return call('threads:set-mode', { ...getIdentityPayload(), mode });
}

export function publishReview(): Promise<PublishResult> {
  return call('threads:publish-review', { ...getIdentityPayload() });
}
