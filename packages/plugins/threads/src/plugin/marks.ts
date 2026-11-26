/** One definition of the page body and of a thread mark, shared by publish and orphan detection. */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Offset of the first line that is exactly `::: threads` (the parser's rule), or -1. */
export function threadsBlockStart(content: string): number {
  let offset = 0;
  for (const line of content.split('\n')) {
    if (line.trim() === '::: threads') return offset;
    offset += line.length + 1;
  }
  return -1;
}

/** The page split at the threads block: `body` is what a mark can live in, `rest` is the block and what follows. */
export function splitPage(content: string): { body: string; rest: string } {
  const cut = threadsBlockStart(content);
  return cut >= 0 ? { body: content.slice(0, cut), rest: content.slice(cut) } : { body: content, rest: '' };
}

/** Pattern for `==quote=={id}`; the quote may span lines. Group 1 is the quote. Without an id it matches any thread's mark. */
export const markPattern = (threadId?: string, flags = ''): RegExp =>
  new RegExp(`==((?:(?!==)[\\s\\S])+)==\\{${threadId === undefined ? '[^}]+' : escapeRe(threadId)}\\}`, flags);
