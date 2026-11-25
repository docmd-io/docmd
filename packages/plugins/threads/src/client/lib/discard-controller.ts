/**
 * The discard confirmation's logic without its DOM: closed, confirming, discarding.
 * The element renders from `state()` and calls the methods; the api, `t` and the
 * success hook are injected so tests drive everything by hand.
 */
import { ThreadsClientError } from './api';

export type DiscardState = 'closed' | 'confirming' | 'discarding';

export interface DiscardControllerDeps {
  api: { discardReview(reviewId: string): Promise<unknown> };
  t: (key: string) => string;
  /** Called once after a successful discard. */
  onDone: () => void;
  /** Called after every state change, so the element can re-render. */
  onChange: () => void;
}

export function createDiscardController({ api, t, onDone, onChange }: DiscardControllerDeps) {
  let state: DiscardState = 'closed';
  let reviewId: string | null = null;
  let error: string | null = null;

  function set(next: DiscardState): void {
    state = next;
    onChange();
  }

  return {
    state: (): DiscardState => state,
    error: (): string | null => error,
    /** Open the confirmation for a review. */
    ask(id: string): void {
      if (state !== 'closed') return;
      reviewId = id;
      error = null;
      set('confirming');
    },
    /** Close the confirmation without calling anything. */
    cancel(): void {
      if (state !== 'confirming') return;
      reviewId = null;
      set('closed');
    },
    /** Discard the asked review: one call, however often it is confirmed. */
    async confirm(): Promise<void> {
      if (state !== 'confirming') return;
      const id = reviewId as string; // set by ask(), which is the only way into 'confirming'
      set('discarding');
      try {
        await api.discardReview(id);
      } catch (err) {
        error = err instanceof ThreadsClientError ? err.text : t('discardFailed');
        reviewId = null;
        set('closed');
        return;
      }
      reviewId = null;
      set('closed');
      onDone();
    },
  };
}
