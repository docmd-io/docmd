/**
 * The publish widget's logic without its DOM: what the caller's journal says,
 * publishing, play/pause and the auto fire. The Lit element renders from
 * `view()` and calls the methods; the api functions, the timer and `t` are
 * injected so tests drive everything by hand.
 */
import { ThreadsClientError } from './api';
import { widgetState, type PublishTimer, type WidgetState } from './mode';
import type { DiscardOutcome } from './discard-controller';
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
  /** The open review's id while the journal is known, else null. */
  reviewId: string | null;
  /** The open review's title as the journal has it; null for the default title or while unknown. */
  reviewTitle: string | null;
  /** The open review's summary as the journal has it; null for none or while unknown. */
  reviewSummary: string | null;
  /** Unpublished changes in the open review: its operations plus one for a pending profile; 0 while unknown. */
  pendingCount: number;
  /** Unpublished comments (operations) in the open review, without the profile; 0 while unknown. */
  opCount: number;
  /** The caller's published threads that lost their anchor, from the latest `whoami`; 0 before the first answer and after a failed one. */
  orphanedMine: number;
  /** The countdown ring, while one is running: re-created per `updatedAt`, started `delayMs` into the countdown. */
  ring: { key: string; delayMs: number; totalMs: number } | null;
}

export function createPublishController({ api, timer, t, onChange }: PublishControllerDeps) {
  let journal: Journal | null = null;
  /** False when the last `whoami` failed: the count is unknown, not 0. */
  let known = false;
  let orphanedMine = 0;
  let publishing = false;
  let toggling = false;
  /** Only the latest whoami answer counts: an older one resolving late would bring back a stale count. */
  let refreshSeq = 0;
  let error: string | null = null;
  let remaining: number | null = null;
  let ringKey: string | null = null;
  let ringDelay = 0;
  /** A confirmation is open on the review: the timer's fire waits instead of publishing. */
  let held = false;
  /** The timer fired while held; `deferredFor` is the journal's `updatedAt` it fired for. */
  let deferred = false;
  let deferredFor: string | null = null;

  const mode = (): DraftMode => journal?.mode ?? 'collect';
  const pending = (): number => (known ? (journal ? journal.ops.length + (journal.profile ? 1 : 0) : 0) : 0);
  const reason = (err: unknown, fallback: string): string => (err instanceof ThreadsClientError ? err.text : t(fallback));

  function syncTimer(): void {
    if (!timer) return;
    if (!journal) {
      timer.stop();
    } else {
      timer.update({ mode: mode(), updatedAt: journal.review.updatedAt, pendingCount: pending() });
    }
    // A newer journal re-armed the countdown for its own deadline: the old fire no longer counts.
    if (deferred && journal?.review.updatedAt !== deferredFor) deferred = false;
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
      orphanedMine = me.orphanedMine;
      known = true;
      error = null;
    } catch (err) {
      if (seq !== refreshSeq) return;
      known = false;
      orphanedMine = 0;
      error = reason(err, 'loadFailed');
      timer?.stop();
      remaining = null;
      ringKey = null;
      onChange();
      return;
    }
    syncTimer();
    // The review is gone while a confirmation is open: it was discarded (here or elsewhere).
    if (held && (!journal || journal.ops.length === 0)) release('discarded');
    // A fire held back by a confirmation that closed while nothing could be published yet.
    if (deferred && !held && pending() > 0) {
      deferred = false;
      void publish();
    }
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
  timer?.onFire(() => {
    if (!held) {
      void publish();
      return;
    }
    deferred = true;
    deferredFor = journal?.review.updatedAt ?? null;
    // Fired: no countdown to show while the question is open.
    remaining = null;
    ringKey = null;
    onChange();
  });

  /** A confirmation opened: no auto publish starts until `release`. The countdown itself keeps its deadline. */
  function hold(): void {
    held = true;
  }

  /**
   * The confirmation closed. `kept` (Cancel): a fire that came due meanwhile publishes now.
   * `discarded`: nothing publishes; the countdown is dropped until the next refresh re-reads the journal.
   * `failed` (Confirm, the call rejected): the caller asked to discard, so a due fire is dropped without
   * publishing and the timer is left alone; the next edit re-arms it and an undue countdown keeps its deadline.
   */
  function release(outcome: DiscardOutcome): void {
    if (!held) return;
    held = false;
    if (outcome === 'failed') {
      deferred = false;
    } else if (outcome === 'discarded') {
      deferred = false;
      timer?.stop();
      remaining = null;
      ringKey = null;
      onChange();
    } else if (deferred && pending() > 0) {
      // Else (count unknown) the fire stays deferred; the next refresh publishes it.
      deferred = false;
      void publish();
    }
  }

  return {
    hold,
    release,
    isHeld: (): boolean => held,
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
          orphanedMine,
          publishing,
          armed: remaining !== null,
          error,
          t,
        }),
        mode: mode(),
        pendingCount: pending(),
        opCount: known ? (journal?.ops.length ?? 0) : 0,
        orphanedMine,
        reviewId: known ? (journal?.review.id ?? null) : null,
        reviewTitle: known ? (journal?.review.title ?? null) : null,
        reviewSummary: known ? (journal?.review.summary ?? null) : null,
        ring: timer && remaining !== null && ringKey ? { key: ringKey, delayMs: ringDelay, totalMs: timer.totalMs() } : null,
      };
    },
  };
}
