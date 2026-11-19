/**
 * The publish widget's logic without its DOM: what the caller's journal says,
 * publishing, play/pause and the auto fire. The Lit element renders from
 * `view()` and calls the methods; the api functions, the timer and `t` are
 * injected so tests drive everything by hand.
 */
import { ThreadsClientError } from './api';
import { widgetState, type PublishTimer, type WidgetState } from './mode';
import type { DraftMode, Journal, PublishResult, WhoAmI } from '../../types';

export interface PublishControllerApi {
  whoami(): Promise<WhoAmI>;
  setMode(mode: DraftMode): Promise<Journal>;
  publishReview(): Promise<PublishResult>;
}

export interface PublishControllerDeps {
  api: PublishControllerApi;
  /** Present when `autoPublish` is configured; its `onFire` publishes. */
  timer: PublishTimer | null;
  t: (key: string) => string;
  /** Called after every state change, so the element can re-render. */
  onChange: () => void;
}

export interface PublishView {
  state: WidgetState;
  mode: DraftMode;
  /** The countdown ring, while one is running: re-created per `updatedAt`, started `delayMs` into the countdown. */
  ring: { key: string; delayMs: number; totalMs: number } | null;
}

export function createPublishController({ api, timer, t, onChange }: PublishControllerDeps) {
  let journal: Journal | null = null;
  /** False when the last `whoami` failed: the count is unknown, not 0. */
  let known = false;
  let publishing = false;
  let toggling = false;
  /** Only the latest whoami answer counts: an older one resolving late would bring back a stale count. */
  let refreshSeq = 0;
  let error: string | null = null;
  let remaining: number | null = null;
  let ringKey: string | null = null;
  let ringDelay = 0;

  const mode = (): DraftMode => journal?.mode ?? 'collect';
  const pending = (): number => (known ? (journal?.ops.length ?? 0) : 0);
  const reason = (err: unknown, fallback: string): string => (err instanceof ThreadsClientError ? err.text : t(fallback));

  function syncTimer(): void {
    if (!timer) return;
    if (!journal) {
      timer.stop();
    } else {
      timer.update({ mode: mode(), updatedAt: journal.review.updatedAt, pendingCount: pending() });
    }
    remaining = timer.remainingMs();
    // No ring while unarmed (collect, paused, fired): the next one is created fresh and re-measured.
    if (remaining === null || !journal) {
      ringKey = null;
    } else if (journal.review.updatedAt !== ringKey) {
      ringKey = journal.review.updatedAt;
      ringDelay = Math.max(0, timer.totalMs() - remaining);
    }
  }

  async function refresh(): Promise<void> {
    const seq = ++refreshSeq;
    try {
      const me = await api.whoami();
      if (seq !== refreshSeq) return;
      journal = me.journal;
      known = true;
      error = null;
    } catch (err) {
      if (seq !== refreshSeq) return;
      known = false;
      error = reason(err, 'loadFailed');
      timer?.stop();
      remaining = null;
      ringKey = null;
      onChange();
      return;
    }
    syncTimer();
    onChange();
  }

  async function publish(): Promise<void> {
    if (publishing || pending() < 1) return;
    publishing = true;
    error = null;
    onChange();
    try {
      const result = await api.publishReview();
      await refresh();
      if (result.skipped.length > 0) {
        const n = result.skipped.length;
        const skipped = t(n === 1 ? 'skippedOpsOne' : 'skippedOps').replace('{n}', String(n));
        // A failed refresh left its own error: keep it beside the skipped line.
        error = error ? `${error}. ${skipped}` : skipped;
      }
    } catch (err) {
      error = reason(err, 'publishFailed');
    } finally {
      publishing = false;
      // The ring was removed while publishing and will be rebuilt: re-measure its offset against the live timer.
      ringKey = null;
      syncTimer();
      onChange();
    }
  }

  async function toggleMode(): Promise<void> {
    if (toggling) return;
    toggling = true;
    try {
      journal = await api.setMode(mode() === 'auto' ? 'collect' : 'auto');
      known = true;
      error = null;
    } catch (err) {
      error = reason(err, 'modeFailed');
      onChange();
      return;
    } finally {
      toggling = false;
    }
    syncTimer();
    onChange();
  }

  // Publishing re-syncs the timer when it ends, which drops the ring: nothing is scheduled after a fire.
  timer?.onFire(() => void publish());

  return {
    refresh,
    publish,
    toggleMode,
    stop: (): void => timer?.stop(),
    view(): PublishView {
      return {
        state: widgetState({
          autoPublish: timer !== null,
          mode: mode(),
          pendingCount: known ? pending() : null,
          publishing,
          armed: remaining !== null,
          error,
          t,
        }),
        mode: mode(),
        ring: timer && remaining !== null && ringKey ? { key: ringKey, delayMs: ringDelay, totalMs: timer.totalMs() } : null,
      };
    },
  };
}
