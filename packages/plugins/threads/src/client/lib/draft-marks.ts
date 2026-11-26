import type { Thread } from '../../types';

/** A highlight found in the page: `client` is true when the client wrapped it for a draft, false for the page's own markup. */
export interface PageMark {
  id: string;
  client: boolean;
}

export interface DraftMarkPlan {
  /** Drafted threads with an anchor quote and no highlight yet. */
  add: Thread[];
  /** Thread ids whose client-added highlight must go. */
  remove: string[];
}

/**
 * Decide which highlights the client adds for the caller's drafted threads and which of its own it takes back.
 * Published highlights come from the page's markup and are never invented or removed here.
 */
export function planDraftMarks(threads: readonly Thread[], marks: readonly PageMark[]): DraftMarkPlan {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const marked = new Set(marks.map((m) => m.id));
  const fromMarkup = new Set(marks.filter((m) => !m.client).map((m) => m.id));

  const add = threads.filter((t) => t.draft && t.anchor?.quote && !marked.has(t.id));
  const remove = [...new Set(marks.filter((m) => m.client).map((m) => m.id))].filter((id) => {
    const thread = byId.get(id);
    // Gone, or published and now carried by the markup: the client mark would double it.
    return !thread || (!thread.draft && fromMarkup.has(id));
  });
  return { add, remove };
}
