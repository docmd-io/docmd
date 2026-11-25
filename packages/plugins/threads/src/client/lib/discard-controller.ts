/**
 * The discard confirmation's logic without its DOM: closed, confirming, discarding.
 * The element renders from `state()` and calls the methods; the api, `t` and the
 * success hook are injected so tests drive everything by hand.
 */
import { ThreadsClientError } from './api';

export type DiscardOutcome = 'kept' | 'discarded' | 'failed';
export type DiscardState = 'closed' | 'confirming' | 'discarding';

export interface DiscardControllerDeps {
  api: { discardReview(reviewId: string): Promise<unknown> };
  t: (key: string) => string;
  /** Called once after a successful discard. */
  onDone: () => void;
  /** Called after every state change, so the element can re-render. */
  onChange: () => void;
  /**
   * Called when the confirmation opens (`open: true`) and when it closes. On close, `outcome` says
   * what happened: `discarded` (confirmed and succeeded), `failed` (confirmed, the call rejected) or
   * `kept` (cancelled). On open it is `kept`.
   * A host that must not act on the review while the question is open listens to this.
   */
  onOpenChange?: (open: boolean, outcome: DiscardOutcome) => void;
}

export function createDiscardController({ api, t, onDone, onChange, onOpenChange }: DiscardControllerDeps) {
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
      onOpenChange?.(true, 'kept');
    },
    /** Close the confirmation without calling anything. */
    cancel(): void {
      if (state !== 'confirming') return;
      reviewId = null;
      set('closed');
      onOpenChange?.(false, 'kept');
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
        onOpenChange?.(false, 'failed');
        return;
      }
      reviewId = null;
      set('closed');
      onDone();
      onOpenChange?.(false, 'discarded');
    },
  };
}
