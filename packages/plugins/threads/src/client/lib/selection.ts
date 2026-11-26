import type { Anchor } from '../../types';

const CONTEXT_CHARS = 40;
const BLOCK_ELEMENTS = new Set([
  "P", "DIV", "LI", "TD", "TH", "BLOCKQUOTE", "PRE", "H1", "H2", "H3",
  "H4", "H5", "H6", "SECTION", "ARTICLE", "ASIDE", "DT", "DD", "FIGCAPTION",
]);

/** Selectors for the page's content area, in priority order; the first match wins. */
export const CONTENT_AREA_SELECTORS = [
  ".summer-content",
  "[data-docmd-content]",
  ".docmd-content",
  ".main-content",
  "article",
  "main",
] as const;

export function getContentArea(): HTMLElement | null {
  for (const selector of CONTENT_AREA_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/** Whether a tag name belongs to one of our components (`threads-thread`, `threads-editor`, ...). */
export function isThreadsTag(tagName: string | null | undefined): boolean {
  return (tagName ?? '').toUpperCase().startsWith('THREADS-');
}

/**
 * Whether an event's composed path passes through one of our components. A mouse-up inside an
 * inline card (comment text, editor) is not a selection of the page and must not offer "Add comment".
 */
export function pathHasThreadsElement(path: ReadonlyArray<{ tagName?: string | null }>): boolean {
  return path.some((el) => isThreadsTag(el?.tagName));
}

/**
 * Whether a node is part of the page's own tree. Nodes inside a shadow root report that root as
 * theirs, so a selection inside one of our components is not one the page can anchor to.
 */
export function inDocumentTree(node: { getRootNode?(): unknown }, doc: unknown): boolean {
  return typeof node.getRootNode === 'function' && node.getRootNode() === doc;
}

export function isWithinContent(node: Node): boolean {
  const content = getContentArea();
  return content ? content.contains(node) : false;
}

/** The block a node sits in; null when it sits inside one of our components. */
function getBlockAncestor(node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== document.body) {
    if (current instanceof HTMLElement) {
      if (isThreadsTag(current.tagName)) return null;
      if (BLOCK_ELEMENTS.has(current.tagName)) return current;
    }
    current = current.parentNode;
  }
  return document.body;
}

function generateSelector(element: HTMLElement): string {
  const parts: string[] = [];
  const content = getContentArea();

  for (let cur = element as HTMLElement | null; cur && cur !== document.body && cur !== content; cur = cur.parentElement) {
    const tag = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const tagName = cur.tagName;
      // Our components are never counted: a stored selector must not depend on whether cards are loaded.
      const siblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === tagName && !isThreadsTag(sibling.tagName),
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(cur) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
      } else {
        parts.unshift(tag);
      }
    } else {
      parts.unshift(tag);
    }
  }

  return parts.join(" > ");
}

function getTextOffset(container: HTMLElement, range: Range): number {
  const treeWalker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );
  let offset = 0;

  while (treeWalker.nextNode()) {
    if (treeWalker.currentNode === range.startContainer) {
      return offset + range.startOffset;
    }
    offset += (treeWalker.currentNode as Text).length;
  }

  return offset;
}

function extractContext(
  text: string,
  start: number,
  end: number,
): { prefix: string; suffix: string } {
  const prefix = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const suffix = text.slice(end, end + CONTEXT_CHARS);
  return { prefix, suffix };
}

export function computeAnchor(selection: Selection): Anchor | null {
  if (selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const quote = selection.toString().trim();

  if (!quote || quote.length < 3) return null;
  if (!isWithinContent(range.startContainer)) return null;
  if (!inDocumentTree(range.startContainer, document) || !inDocumentTree(range.endContainer, document)) return null;

  const blockEl = getBlockAncestor(range.startContainer);
  if (!blockEl) return null;
  const selector = generateSelector(blockEl);
  const fullText = blockEl.textContent || "";
  const offset = getTextOffset(blockEl, range);
  const { prefix, suffix } = extractContext(fullText, offset, offset + quote.length);

  return {
    quote,
    prefix: prefix || null,
    suffix: suffix || null,
    selector,
    offset,
    blockText: fullText.trim() || null,
  };
}

export function getSelectionPosition(selection: Selection): { x: number; y: number } | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top,
  };
}
