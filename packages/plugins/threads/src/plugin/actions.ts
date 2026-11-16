import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import * as parser from './parser.js';
import { ThreadsError } from './errors.js';
import type { Thread, Comment, Reaction } from '../types.js';

// TODO(0.7.0): Import ActionContext from @docmd/api once types package is extracted
interface ActionContext {
  projectRoot: string;
  config: any;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  readFileLines(relativePath: string): Promise<string[]>;
  broadcast(event: string, data: any): void;
}

interface AuthorsMap {
  [key: string]: { name: string; avatarUrl: string };
}

/**
 * Resolve the .threads directory inside the docs source folder.
 * Falls back to projectRoot if config.src is not available.
 */
function getThreadsDir(ctx: ActionContext): string {
  const srcDir = ctx.config?.src || '';
  return path.join(ctx.projectRoot, srcDir, '.threads');
}

/**
 * Read the authors map from <docsRoot>/.threads/authors.json.
 * Returns {} if file doesn't exist.
 */
async function readAuthors(ctx: ActionContext): Promise<AuthorsMap> {
  const filePath = path.join(getThreadsDir(ctx), 'authors.json');
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content) as AuthorsMap;
  } catch (e: any) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * Write the authors map to <docsRoot>/.threads/authors.json.
 * Creates the directory if needed.
 */
async function writeAuthors(ctx: ActionContext, authors: AuthorsMap): Promise<void> {
  const dirPath = getThreadsDir(ctx);
  const filePath = path.join(dirPath, 'authors.json');
  await fs.promises.mkdir(dirPath, { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(authors, null, 2) + '\n');
}

/**
 * Upsert an author entry. Updates name/avatarUrl if provided.
 */
async function upsertAuthor(ctx: ActionContext, authorKey: string, name: string, avatarUrl?: string): Promise<void> {
  const authors = await readAuthors(ctx);
  const existing = authors[authorKey] || { name: '', avatarUrl: '' };
  authors[authorKey] = {
    name: name || existing.name || authorKey,
    avatarUrl: avatarUrl || existing.avatarUrl || '',
  };
  await writeAuthors(ctx, authors);
}

/**
 * Generate a thread ID: "t-" + 8 random hex chars.
 */
function generateThreadId(): string {
  return 't-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Generate a comment ID: "c-" + 8 random hex chars.
 */
function generateCommentId(): string {
  return 'c-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Read a file's content and parse its threads.
 */
async function readAndParse(file: string, ctx: ActionContext): Promise<{ content: string; threads: Thread[] }> {
  const content = await ctx.readFile(file);
  const threads = parser.parseThreadsFromContent(content);
  return { content, threads };
}

/**
 * Write threads back to a file, replacing the existing threads block.
 */
async function writeBack(file: string, content: string, threads: Thread[], ctx: ActionContext): Promise<void> {
  const updated = parser.replaceThreadsBlock(content, threads);
  await ctx.writeFile(file, updated);
}

/**
 * Find a thread by ID, throwing if not found.
 */
function findThread(threads: Thread[], threadId: string): Thread {
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) throw new ThreadsError('not-found', `Thread not found: ${threadId}`);
  return thread;
}

/**
 * Find a comment by ID within a thread, throwing if not found.
 */
function findComment(thread: Thread, commentId: string): Comment {
  const comment = thread.comments.find((c) => c.id === commentId);
  if (!comment) throw new ThreadsError('not-found', `Comment not found: ${commentId}`);
  return comment;
}

/**
 * Validate that required string fields are present and non-empty.
 */
function requireFields(action: string, payload: Record<string, any>, fields: string[]): void {
  for (const field of fields) {
    if (!payload[field] || (typeof payload[field] === 'string' && !payload[field].trim())) {
      throw new ThreadsError('invalid', `${action}: ${field} is required`);
    }
  }
}

export const actions: Record<string, (payload: any, ctx: ActionContext) => Promise<any>> = {
  /**
   * Get the authors map. Read-only, no reload.
   */
  'threads:get-authors': async (payload: any, ctx: ActionContext): Promise<AuthorsMap> => {
    return readAuthors(ctx);
  },

  /**
   * Upsert an author entry directly.
   */
  'threads:upsert-author': async (payload: any, ctx: ActionContext): Promise<{ ok: boolean }> => {
    requireFields('threads:upsert-author', payload, ['authorKey', 'name']);
    await upsertAuthor(ctx, payload.authorKey, payload.name, payload.avatarUrl);
    return { ok: true };
  },

  /**
   * Get all threads from a file. Read-only, no reload.
   */
  'threads:get-threads': async (payload: any, ctx: ActionContext): Promise<Thread[]> => {
    requireFields('threads:get-threads', payload, ['file']);
    const content = await ctx.readFile(payload.file);
    return parser.parseThreadsFromContent(content);
  },

  /**
   * Add a new thread with its first comment.
   */
  'threads:add-thread': async (payload: any, ctx: ActionContext): Promise<Thread> => {
    requireFields('threads:add-thread', payload, ['file', 'author', 'body']);
    const { file, author, body, anchor, authorKey, avatarUrl } = payload;

    // Upsert author profile if key provided
    if (authorKey) {
      await upsertAuthor(ctx, authorKey, author, avatarUrl);
    }
    const { content, threads } = await readAndParse(file, ctx);

    const threadId = generateThreadId();
    const commentId = generateCommentId();
    const date = todayDate();

    const thread: Thread = {
      id: threadId,
      resolved: false,
      resolved_by: null,
      resolved_at: null,
      comments: [
        {
          id: commentId,
          thread_id: threadId,
          parent_id: null,
          author,
          date,
          edited_at: null,
          body,
          reactions: [],
        },
      ],
    };

    threads.push(thread);

    // If anchor has a quote, wrap it with highlight markup in the document body
    let contentForWrite = content;
    if (anchor && anchor.quote) {
      const quote = anchor.quote as string;
      // Split at ::: threads boundary to avoid matching inside the threads block
      const threadsIdx = content.indexOf('\n::: threads');
      let bodyContent: string;
      let rest: string;
      if (threadsIdx >= 0) {
        bodyContent = content.slice(0, threadsIdx);
        rest = content.slice(threadsIdx);
      } else {
        bodyContent = content;
        rest = '';
      }

      const quoteIdx = bodyContent.indexOf(quote);
      if (quoteIdx >= 0) {
        bodyContent =
          bodyContent.slice(0, quoteIdx) +
          `==${quote}=={${threadId}}` +
          bodyContent.slice(quoteIdx + quote.length);
      }

      contentForWrite = bodyContent + rest;
    }

    const updated = parser.replaceThreadsBlock(contentForWrite, threads);
    await ctx.writeFile(file, updated);
    return thread;
  },

  /**
   * Add a comment to an existing thread.
   */
  'threads:add-comment': async (payload: any, ctx: ActionContext): Promise<Comment> => {
    requireFields('threads:add-comment', payload, ['file', 'threadId', 'author', 'body']);
    const { file, threadId, author, body, parentId, authorKey, avatarUrl } = payload;

    // Upsert author profile if key provided
    if (authorKey) {
      await upsertAuthor(ctx, authorKey, author, avatarUrl);
    }
    const { content, threads } = await readAndParse(file, ctx);
    const thread = findThread(threads, threadId);

    const commentId = generateCommentId();
    const date = todayDate();

    const comment: Comment = {
      id: commentId,
      thread_id: threadId,
      parent_id: parentId || null,
      author,
      date,
      edited_at: null,
      body,
      reactions: [],
    };

    thread.comments.push(comment);
    await writeBack(file, content, threads, ctx);
    return comment;
  },

  /**
   * Edit an existing comment's body.
   */
  'threads:edit-comment': async (payload: any, ctx: ActionContext): Promise<Comment> => {
    requireFields('threads:edit-comment', payload, ['file', 'threadId', 'commentId', 'body']);
    const { file, threadId, commentId, body } = payload;
    const { content, threads } = await readAndParse(file, ctx);
    const thread = findThread(threads, threadId);
    const comment = findComment(thread, commentId);

    comment.body = body;
    comment.edited_at = todayDate();

    await writeBack(file, content, threads, ctx);
    return comment;
  },

  /**
   * Delete a comment from a thread.
   */
  'threads:delete-comment': async (payload: any, ctx: ActionContext): Promise<{ deleted: boolean }> => {
    requireFields('threads:delete-comment', payload, ['file', 'threadId', 'commentId']);
    const { file, threadId, commentId } = payload;
    const { content, threads } = await readAndParse(file, ctx);
    const thread = findThread(threads, threadId);

    const idx = thread.comments.findIndex((c) => c.id === commentId);
    if (idx === -1) throw new ThreadsError('not-found', `Comment not found: ${commentId}`);
    thread.comments.splice(idx, 1);

    await writeBack(file, content, threads, ctx);
    return { deleted: true };
  },

  /**
   * Delete an entire thread.
   */
  'threads:delete-thread': async (payload: any, ctx: ActionContext): Promise<{ deleted: boolean }> => {
    requireFields('threads:delete-thread', payload, ['file', 'threadId']);
    const { file, threadId } = payload;
    const parsed = await readAndParse(file, ctx);
    const { threads } = parsed;
    let { content } = parsed;

    const idx = threads.findIndex((t) => t.id === threadId);
    if (idx === -1) throw new ThreadsError('not-found', `Thread not found: ${threadId}`);
    threads.splice(idx, 1);

    // Remove orphaned ==highlight=={threadId} markup from the body,
    // keeping just the inner text
    const highlightRe = new RegExp(`==((?:(?!==).)+)==\\{${threadId}\\}`, 'g');
    content = content.replace(highlightRe, '$1');

    await writeBack(file, content, threads, ctx);
    return { deleted: true };
  },

  /**
   * Toggle resolved status on a thread.
   */
  'threads:resolve-thread': async (payload: any, ctx: ActionContext): Promise<Thread> => {
    requireFields('threads:resolve-thread', payload, ['file', 'threadId', 'resolved_by']);
    const { file, threadId, resolved_by } = payload;
    const { content, threads } = await readAndParse(file, ctx);
    const thread = findThread(threads, threadId);

    if (thread.resolved) {
      thread.resolved = false;
      thread.resolved_by = null;
      thread.resolved_at = null;
    } else {
      thread.resolved = true;
      thread.resolved_by = resolved_by;
      thread.resolved_at = todayDate();
    }

    await writeBack(file, content, threads, ctx);
    return thread;
  },

  /**
   * Toggle a reaction emoji on a comment.
   */
  'threads:toggle-reaction': async (payload: any, ctx: ActionContext): Promise<Reaction[]> => {
    requireFields('threads:toggle-reaction', payload, ['file', 'threadId', 'commentId', 'emoji', 'author']);
    const { file, threadId, commentId, emoji, author } = payload;
    const { content, threads } = await readAndParse(file, ctx);
    const thread = findThread(threads, threadId);
    const comment = findComment(thread, commentId);

    if (!comment.reactions) comment.reactions = [];

    const reaction = comment.reactions.find((r) => r.emoji === emoji);

    if (reaction) {
      const authorIdx = reaction.authors.indexOf(author);
      if (authorIdx >= 0) {
        // Remove author from this reaction
        reaction.authors.splice(authorIdx, 1);
        // If no authors left, remove the reaction entirely
        if (reaction.authors.length === 0) {
          const reactionIdx = comment.reactions.indexOf(reaction);
          comment.reactions.splice(reactionIdx, 1);
        }
      } else {
        // Add author to existing reaction
        reaction.authors.push(author);
      }
    } else {
      // Create new reaction
      comment.reactions.push({ emoji, authors: [author] });
    }

    await writeBack(file, content, threads, ctx);
    return comment.reactions;
  },
};
