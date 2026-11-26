import type { Comment, Thread } from '../../types';
import { t } from './i18n';
import { pageLang, tCount } from './plural';
import { deleteCommentTarget, type ShowAction, type ShowTarget } from './can-show';

/** Pure view logic of a thread card: the comment tree, the collapsed summary, which body HTML to show, and which buttons. DOM-free. */

/** A reply as the card shows it: `replyTo` is the comment it answers when that comment is itself a reply. */
export interface TreeReply {
  comment: Comment;
  replyTo: Comment | null;
}

/** One top-level comment with every descendant, flat. */
export interface TreeNode {
  comment: Comment;
  replies: TreeReply[];
}

/**
 * Group a thread's comments for display: top-level comments in their order, and under each one
 * every descendant (replies, replies of replies, ...) flat, oldest first. A reply to a reply
 * carries the comment it answers as `replyTo`; a reply to the top-level comment has none.
 * A comment whose parent is missing (or that sits in a parent cycle) is shown as top-level
 * rather than dropped.
 */
export function buildCommentTree(comments: readonly Comment[]): TreeNode[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const order = new Map(comments.map((c, i) => [c.id, i]));

  /** The top-level comment a comment hangs under; itself when it is top-level. */
  const rootOf = (comment: Comment): Comment => {
    const seen = new Set<string>([comment.id]);
    let cur = comment;
    while (cur.parent_id) {
      const parent = byId.get(cur.parent_id);
      if (!parent) return cur; // dangling: this one is the top
      if (seen.has(parent.id)) {
        // A cycle has no top: the member stored first stands in, the same one from every member.
        return [...seen].map((id) => byId.get(id)!).reduce((a, b) => (order.get(b.id)! < order.get(a.id)! ? b : a));
      }
      seen.add(parent.id);
      cur = parent;
    }
    return cur;
  };

  const nodes = new Map<string, TreeNode>();
  const tops: TreeNode[] = [];
  for (const c of comments) {
    if (rootOf(c) === c) {
      const node: TreeNode = { comment: c, replies: [] };
      nodes.set(c.id, node);
      tops.push(node);
    }
  }
  for (const c of comments) {
    const root = rootOf(c);
    if (root === c) continue;
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    const node = nodes.get(root.id);
    if (!node) {
      // Hangs off a cycle that does not resolve to a top-level comment: show it on its own, never drop it.
      const own: TreeNode = { comment: c, replies: [] };
      nodes.set(c.id, own);
      tops.push(own);
      continue;
    }
    node.replies.push({ comment: c, replyTo: parent && parent !== root ? parent : null });
  }
  for (const node of tops) {
    node.replies.sort((a, b) =>
      a.comment.date < b.comment.date ? -1 : a.comment.date > b.comment.date ? 1 : order.get(a.comment.id)! - order.get(b.comment.id)!);
  }
  return tops;
}

/** Names listed before "and N more". */
const MAX_NAMES = 3;

/**
 * "3 comments by Alice, Bob, and Carol": the count, then the first names of the distinct authors in
 * order of first comment. Up to three names are listed; with more, the first three and "N more".
 * Every sentence is one translated template (`commentSummary[By][One]`; `namesMore` is the "N more" list item), and the name
 * list follows the language's own list format, so word order and conjunctions are the translator's.
 */
export function summaryText(count: number, authorNames: readonly string[], tr: (key: string) => string = t, lang: string = pageLang()): string {
  const names: string[] = [];
  for (const full of authorNames) {
    const first = full.trim().split(/\s+/)[0];
    if (first && !names.includes(first)) names.push(first);
  }
  if (!names.length) return tCount('commentSummary', count, tr, lang);
  const shown = names.slice(0, MAX_NAMES);
  const rest = names.length - shown.length;
  // "N more" is one more item of the list, so the language's own separators and conjunction join it.
  const items = rest > 0 ? [...shown, tr('namesMore').replace('{m}', String(rest))] : shown;
  const list = formatList(items, lang);
  return tCount('commentSummaryBy', count, tr, lang).replace('{names}', list);
}

/** Items joined in the page language ("a, b, and c"); plain commas where Intl.ListFormat is missing. */
function formatList(items: string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/**
 * The body HTML a comment shows. A published, unchanged comment shows what the build rendered
 * (`pageHtml`, copied from the page), so the enhanced and no-JS views match. A draft, or a comment
 * with a pending edit, has no page HTML or an out-of-date one: it shows the server's `bodyHtml`.
 * Empty string when neither exists (the comment then shows its plain text).
 */
export function chooseBodyHtml(comment: Pick<Comment, 'draft' | 'pendingEdit' | 'bodyHtml'>, pageHtml: string | undefined): string {
  if (comment.draft || comment.pendingEdit) return comment.bodyHtml ?? pageHtml ?? '';
  return pageHtml ?? comment.bodyHtml ?? '';
}

/**
 * Whether to offer Edit: the server's rule, and in local mode (where the server lets anyone) only
 * on the viewer's own comments: a draft, or one written under the viewer's display name.
 */
export function canEditComment(
  canShow: (action: ShowAction, target: ShowTarget) => boolean,
  comment: Pick<Comment, 'author' | 'authorKey' | 'draft'>,
  viewerName: string,
  localMode: boolean,
): boolean {
  if (!canShow('edit-comment', { authorKey: comment.authorKey, drafted: !!comment.draft })) return false;
  if (!localMode) return true;
  return !!comment.draft || (viewerName !== '' && comment.author === viewerName);
}

/** What deleting a comment removes: the whole thread for a lone comment, else that comment. */
export function deleteScope(thread: Pick<Thread, 'comments'>): 'thread' | 'comment' {
  return thread.comments.length === 1 ? 'thread' : 'comment';
}

/** Whether to offer Delete on a comment, with the target the server checks for that scope. */
export function canDeleteComment(
  canShow: (action: ShowAction, target: ShowTarget) => boolean,
  thread: Pick<Thread, 'comments'>,
  commentId: string,
): boolean {
  if (deleteScope(thread) === 'thread') {
    return canShow('delete-thread', { authorKeys: thread.comments.filter((c) => !c.draft).map((c) => c.authorKey) });
  }
  return canShow('delete-comment', deleteCommentTarget(thread.comments, commentId));
}

/** The six highlight names marks and cards cycle through; `neutral` is for threads with no mark. */
export const HIGHLIGHT_NAMES = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'] as const;
export type CardColor = (typeof HIGHLIGHT_NAMES)[number] | 'neutral';

/** The colour of the nth mark in the page (cycling). */
export function colorAt(index: number): CardColor {
  return HIGHLIGHT_NAMES[((index % HIGHLIGHT_NAMES.length) + HIGHLIGHT_NAMES.length) % HIGHLIGHT_NAMES.length]!;
}

/** The languages the emoji data is built for (build.js copies the same list). */
const EMOJI_LANGS = ['en', 'de', 'es', 'hi', 'ko', 'zh'];

/** The emoji data language for the page's `lang` (`zh-CN` gives `zh`); `en` when there is none or it is not built. */
export function emojiLang(pageLang: string | null | undefined): string {
  const primary = (pageLang ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return EMOJI_LANGS.includes(primary) ? primary : 'en';
}

/**
 * Where the lazy picker module and the emoji data live, relative to the bundle's own URL
 * (`assets/js/threads.js`): `assets/js/threads-emoji-picker.js` and `assets/threads/emoji/<lang>.json`.
 */
export function pickerUrls(bundleUrl: string, pageLang: string | null | undefined): { pickerSrc: string; emojiDataSrc: string } {
  return {
    pickerSrc: new URL('./threads-emoji-picker.js', bundleUrl).href,
    emojiDataSrc: new URL(`../threads/emoji/${emojiLang(pageLang)}.json`, bundleUrl).href,
  };
}
