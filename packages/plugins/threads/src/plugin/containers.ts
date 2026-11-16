// Import createDepthTrackingContainer from the parser package
import { createDepthTrackingContainer } from '@docmd/parser';

interface ThreadInfo {
  id: string;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

interface CommentInfo {
  id: string | null;
  parentId: string | null;
  author: string;
  date: string;
  editedAt: string | null;
}

function smartDedent(str: string): string {
  const lines = str.split('\n');

  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */)?.[0].length || 0;
    minIndent = Math.min(minIndent, indent);
  }

  if (!isFinite(minIndent) || minIndent === 0) return lines.join('\n');

  return lines.map(line =>
    line.startsWith(' '.repeat(minIndent)) ? line.slice(minIndent) : line
  ).join('\n');
}

function renderMarkdownWithoutRawHtml(md: any, source: string, env: any): string {
  const previousHtml = md.options.html;
  md.options.html = false;
  try {
    return md.render(source, env);
  } finally {
    md.options.html = previousHtml;
  }
}

function setupSafeCommentContainer(md: any): void {
  md.block.ruler.before('fence', 'custom_comment', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineContent = state.src.slice(start, max).trim();
    const match = lineContent.match(/^:::\s*comment(?:\s+(.*))?$/);
    if (!match) return false;
    if (silent) return true;

    let nextLine = startLine;
    let found = false;
    let depth = 1;
    let fenceMarker: string | null = null;

    while (nextLine < endLine) {
      nextLine++;
      if (nextLine >= endLine) break;

      const nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const nextMax = state.eMarks[nextLine];
      const nextContent = state.src.slice(nextStart, nextMax).trim();

      if (!fenceMarker) {
        const fenceMatch = nextContent.match(/^(`{3,}|~{3,})/);
        if (fenceMatch) fenceMarker = fenceMatch[1];
      } else if (nextContent.startsWith(fenceMarker)) {
        fenceMarker = null;
      }

      if (!fenceMarker) {
        if (nextContent.match(/^:::\s*[a-zA-Z]/) && !nextContent.match(/^:::\s*(button|embed|tag)\b/)) {
          depth++;
        } else if (nextContent.match(/^:::\s*$/)) {
          depth--;
          if (depth === 0) {
            found = true;
            break;
          }
        }
      }
    }

    if (!found) return false;

    let rawContent = '';
    for (let i = startLine + 1; i < nextLine; i++) {
      rawContent += state.src.slice(state.bMarks[i], state.eMarks[i]) + '\n';
    }
    const innerContent = smartDedent(rawContent);

    const openToken = state.push('custom_comment_open', 'div', 1);
    openToken.info = match[1] || '';

    if (innerContent) {
      const oldIsInsideContainer = state.env.isInsideContainer;
      state.env.isInsideContainer = true;
      let renderedContent = '';
      try {
        renderedContent = renderMarkdownWithoutRawHtml(state.md, innerContent, state.env);
      } finally {
        state.env.isInsideContainer = oldIsInsideContainer;
      }

      const htmlToken = state.push('html_block', '', 0);
      htmlToken.content = renderedContent;
    }

    state.push('custom_comment_close', 'div', -1);
    state.line = nextLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

/**
 * `::: anchor` - the quoted text a thread was anchored to. Rendered as plain
 * escaped text in a blockquote (no inner markdown). Only recognised inside a
 * container body (where threads render their children); a top-level
 * `::: anchor` is left to other rules. A quote line that is exactly `:::`
 * would close the block early, so the writer of anchors must reject or escape
 * it (TODO: enforce when drafts write anchors).
 */
interface AnchorBlockState {
  src: string;
  bMarks: number[];
  tShift: number[];
  eMarks: number[];
  line: number;
  env: { isInsideContainer?: boolean };
  push(type: string, tag: string, nesting: number): { content: string };
}

interface AnchorMarkdown {
  utils: { escapeHtml(s: string): string };
  block: {
    ruler: {
      before(
        before: string,
        name: string,
        fn: (state: AnchorBlockState, startLine: number, endLine: number, silent: boolean) => boolean,
        options: { alt: string[] },
      ): void;
    };
  };
}

function setupAnchorContainer(md: AnchorMarkdown): void {
  md.block.ruler.before('fence', 'custom_anchor', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const lineContent = state.src.slice(start, state.eMarks[startLine]).trim();
    if (!/^:::\s*anchor$/.test(lineContent)) return false;
    // Container bodies are rendered recursively with this flag set; a top-level
    // `::: anchor` is not part of a thread and is left alone.
    if (!state.env.isInsideContainer) return false;

    let nextLine = startLine + 1;
    while (nextLine < endLine) {
      const s = state.bMarks[nextLine] + state.tShift[nextLine];
      if (state.src.slice(s, state.eMarks[nextLine]).trim() === ':::') break;
      nextLine++;
    }
    if (nextLine >= endLine) return false;
    if (silent) return true;

    let raw = '';
    for (let i = startLine + 1; i < nextLine; i++) {
      raw += state.src.slice(state.bMarks[i], state.eMarks[i]) + '\n';
    }
    const token = state.push('html_block', '', 0);
    token.content = `<blockquote class="threads-anchor">${md.utils.escapeHtml(smartDedent(raw))}</blockquote>\n`;
    state.line = nextLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

/**
 * Parse a thread info string.
 * Format: `<id> [resolved "<by>" "<date>"]`
 */
export function parseThreadInfo(info: string): ThreadInfo {
  const trimmed = info.trim();
  const resolvedMatch = trimmed.match(
    /^(\S+)\s+resolved\s+"([^"]+)"\s+"([^"]+)"$/
  );
  if (resolvedMatch) {
    return {
      id: resolvedMatch[1],
      resolved: true,
      resolvedBy: resolvedMatch[2],
      resolvedAt: resolvedMatch[3],
    };
  }

  const simpleMatch = trimmed.match(/^(\S+)$/);
  if (simpleMatch) {
    return {
      id: simpleMatch[1],
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
    };
  }

  return { id: 'unknown', resolved: false, resolvedBy: null, resolvedAt: null };
}

/**
 * Parse a comment info string.
 * Format: `[<id>] "<author>" "<date>" [reply-to <parentId>] [edited "<date>"] [by <authorKey>] [review <reviewId>]`
 */
export function parseCommentInfo(info: string): CommentInfo {
  const trimmed = info.trim();

  // Format with ID, optional reply-to, optional edited
  const fullMatch = trimmed.match(
    /^(\S+)\s+"([^"]+)"\s+"([^"]+)"(?:\s+reply-to\s+(\S+))?(?:\s+edited\s+"([^"]+)")?(?:\s+by\s+\S+)?(?:\s+review\s+\S+)?$/
  );
  if (fullMatch) {
    return {
      id: fullMatch[1],
      author: fullMatch[2],
      date: fullMatch[3],
      parentId: fullMatch[4] || null,
      editedAt: fullMatch[5] || null,
    };
  }

  // Legacy format without ID: "<author>" "<date>" edited "<date>"
  const editedMatch = trimmed.match(
    /^"([^"]+)"\s+"([^"]+)"\s+edited\s+"([^"]+)"$/
  );
  if (editedMatch) {
    return {
      id: null,
      parentId: null,
      author: editedMatch[1],
      date: editedMatch[2],
      editedAt: editedMatch[3],
    };
  }

  // Legacy format without ID: "<author>" "<date>"
  const simpleMatch = trimmed.match(/^"([^"]+)"\s+"([^"]+)"$/);
  if (simpleMatch) {
    return {
      id: null,
      parentId: null,
      author: simpleMatch[1],
      date: simpleMatch[2],
      editedAt: null,
    };
  }

  return { id: null, parentId: null, author: 'unknown', date: '', editedAt: null };
}

/**
 * Register all thread-related container rules on a markdown-it instance.
 */
export function setup(md: any): void {
  // 1. threads - outer wrapper
  createDepthTrackingContainer(
    md,
    'threads',
    () => '<div class="threads-sidebar">\n',
    () => '</div>\n'
  );

  // 2. thread - individual thread
  createDepthTrackingContainer(
    md,
    'thread',
    (tokens: any[], idx: number) => {
      const info = tokens[idx].info.trim();
      const parsed = parseThreadInfo(info);
      const resolvedClass = parsed.resolved ? ' threads-thread--resolved' : '';
      const safeId = md.utils.escapeHtml(parsed.id);
      return `<div class="threads-thread${resolvedClass}" data-thread-id="${safeId}">\n`;
    },
    () => '</div>\n'
  );

  // 2b. anchor - first child of a thread
  setupAnchorContainer(md);

  // 3. comment - individual comment
  setupSafeCommentContainer(md);
  md.renderer.rules.custom_comment_open = (tokens: any[], idx: number) => {
    const info = tokens[idx].info.trim();
    const parsed = parseCommentInfo(info);

    const safeId = parsed.id ? md.utils.escapeHtml(parsed.id) : null;
    const safeParentId = parsed.parentId ? md.utils.escapeHtml(parsed.parentId) : null;
    const safeAuthor = md.utils.escapeHtml(parsed.author);
    const safeDate = md.utils.escapeHtml(parsed.date);
    const safeEdited = parsed.editedAt ? md.utils.escapeHtml(parsed.editedAt) : null;

    const idAttr = safeId ? ` data-comment-id="${safeId}"` : '';
    const parentAttr = safeParentId ? ` data-parent-id="${safeParentId}"` : '';
    const editedAttr = safeEdited ? ` data-edited="${safeEdited}"` : '';
    const replyClass = parsed.parentId ? ' threads-comment--reply' : '';

    return (
      `<div class="threads-comment${replyClass}"${idAttr}${parentAttr} data-author="${safeAuthor}" data-date="${safeDate}"${editedAttr}>` +
      `<div class="threads-comment__avatar-col"></div>` +
      `<div class="threads-comment__meta"><strong>${safeAuthor}</strong> &middot; ${safeDate}</div>` +
      `<div class="threads-comment__body">\n`
    );
  };
  md.renderer.rules.custom_comment_close = () => '</div></div>\n';

  // 4. reactions - reactions container
  createDepthTrackingContainer(
    md,
    'reactions',
    () => '<div class="threads-reactions">\n',
    () => '</div>\n'
  );

}
