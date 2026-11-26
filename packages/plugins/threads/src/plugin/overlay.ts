import type { Thread, Comment, DraftOp } from '../types.js';
import { addCaller, hasCaller, removeCaller, type ReactionCaller } from './reactors.js';

const day = (iso: string) => iso.slice(0, 10);

/**
 * Apply a journal's ops for one file onto the published threads. Pure: the
 * input is not modified. Ops whose target is gone are ignored. `who` is the
 * journal owner (reactions are recorded under their key and name, resolves under their name).
 */
export function overlay(threads: Thread[], ops: DraftOp[], file: string, who: ReactionCaller): Thread[] {
  const out: Thread[] = structuredClone(threads);
  const thread = (id: string) => out.find((t) => t.id === id);

  for (const op of ops) {
    if (op.file !== file) continue;
    switch (op.kind) {
      case 'add-thread': {
        if (thread(op.threadId)) break;
        out.push({
          id: op.threadId,
          resolved: false,
          resolved_by: null,
          resolved_at: null,
          draft: true,
          ...(op.anchor?.quote ? { anchor: { quote: op.anchor.quote } } : {}),
          comments: [draftComment(op.threadId, op.commentId, null, op.body, op.at, who)],
        });
        break;
      }
      case 'add-comment': {
        const t = thread(op.threadId);
        if (t && !t.comments.some((c) => c.id === op.commentId)) {
          t.comments.push(draftComment(op.threadId, op.commentId, op.parentId, op.body, op.at, who));
        }
        break;
      }
      case 'edit-comment': {
        const c = thread(op.threadId)?.comments.find((x) => x.id === op.commentId);
        if (c) {
          c.body = op.body;
          c.edited_at = day(op.at);
          if (!c.draft) c.pendingEdit = true;
        }
        break;
      }
      case 'delete-comment': {
        const t = thread(op.threadId);
        if (t) t.comments = t.comments.filter((c) => c.id !== op.commentId);
        break;
      }
      case 'delete-thread': {
        const i = out.findIndex((t) => t.id === op.threadId);
        if (i >= 0) out.splice(i, 1);
        break;
      }
      case 'resolve-thread': {
        const t = thread(op.threadId);
        if (!t) break;
        if (t.resolved) {
          t.resolved = false;
          t.resolved_by = null;
          t.resolved_at = null;
        } else {
          t.resolved = true;
          t.resolved_by = who.name;
          t.resolved_at = day(op.at);
        }
        break;
      }
      case 'toggle-reaction': {
        const c = thread(op.threadId)?.comments.find((x) => x.id === op.commentId);
        if (!c) break;
        c.reactions ??= [];
        if (hasCaller(c.reactions.find((x) => x.emoji === op.emoji), who)) c.reactions = removeCaller(c.reactions, op.emoji, who);
        else addCaller(c.reactions, op.emoji, who);
        break;
      }
    }
  }
  return out;
}

function draftComment(
  threadId: string,
  id: string,
  parentId: string | null,
  body: string,
  at: string,
  who: { name: string },
): Comment {
  return {
    id,
    thread_id: threadId,
    parent_id: parentId,
    author: who.name,
    date: day(at),
    edited_at: null,
    body,
    reactions: [],
    draft: true,
  };
}
