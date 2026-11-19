/**
 * Pure publish-mode logic: the auto-publish timer and the widget's
 * state → view mapping. No DOM, no clock, no timers of its own: `now` and
 * `schedule` are injected so tests drive time by hand.
 */

import type { DraftMode } from '../../types';

export interface PublishTimerOptions {
  /** Seconds of quiet after the last edit before an auto publish. */
  seconds: number;
  /** Current time in epoch ms. */
  now: () => number;
  /** Run `cb` after `ms`; returns a function that cancels it. */
  schedule: (cb: () => void, ms: number) => () => void;
}

export interface PublishTimerInput {
  mode: DraftMode;
  /** The journal's `review.updatedAt` (ISO string or epoch ms). */
  updatedAt: string | number;
  pendingCount: number;
}

export interface PublishTimer {
  update(input: PublishTimerInput): void;
  /** Ms until the pending fire, or `null` when nothing is scheduled. */
  remainingMs(): number | null;
  /** The full countdown length in ms. */
  totalMs(): number;
  onFire(cb: () => void): void;
  stop(): void;
}

export function createPublishTimer({ seconds, now, schedule }: PublishTimerOptions): PublishTimer {
  let cancel: (() => void) | null = null;
  let fireAt: number | null = null;
  let firedFor: number | null = null;
  const listeners: Array<() => void> = [];

  const clear = (): void => {
    if (cancel) cancel();
    cancel = null;
    fireAt = null;
  };

  return {
    update({ mode, updatedAt, pendingCount }) {
      clear();
      if (mode !== 'auto' || pendingCount < 1) return;
      const last = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
      if (!Number.isFinite(last)) return;
      // One fire per edit: a failed publish does not retry until the journal changes.
      if (firedFor === last) return;
      const at = last + seconds * 1000;
      fireAt = at;
      cancel = schedule(() => {
        cancel = null;
        fireAt = null;
        firedFor = last;
        for (const cb of listeners) cb();
      }, Math.max(0, at - now()));
    },
    remainingMs() {
      return fireAt === null ? null : Math.max(0, fireAt - now());
    },
    totalMs: () => seconds * 1000,
    onFire(cb) {
      listeners.push(cb);
    },
    stop: clear,
  };
}

export interface WidgetStateInput {
  autoPublish: boolean;
  mode: DraftMode;
  /** `null` while the count is unknown (the last `whoami` failed); no journal is a count of 0. */
  pendingCount: number | null;
  publishing: boolean;
  /** The timer has a fire scheduled (`remainingMs() !== null`). */
  armed: boolean;
  error?: string | null;
  /** Translate a key; defaults to the English strings below. */
  t?: (key: string) => string;
}

export interface WidgetState {
  variant: 'collect-only' | 'auto' | 'collect' | 'publishing';
  showPlayPause: boolean;
  publishDisabled: boolean;
  ringRunning: boolean;
  label: string;
  errorLine: string | null;
  /** What the play/pause button does when clicked. */
  playPauseAction: 'pause' | 'play';
}

const FALLBACK: Record<string, string> = {
  unpublishedCount: '{n} unpublished comments',
  unpublishedCountOne: '{n} unpublished comment',
};

export function widgetState(input: WidgetStateInput): WidgetState {
  const tr = input.t ?? ((k: string) => FALLBACK[k] ?? k);
  const known = input.pendingCount !== null;
  const pendingCount = input.pendingCount ?? 0;
  const variant: WidgetState['variant'] = input.publishing
    ? 'publishing'
    : !input.autoPublish
      ? 'collect-only'
      : input.mode;
  return {
    variant,
    showPlayPause: input.autoPublish,
    publishDisabled: input.publishing || pendingCount < 1,
    ringRunning: input.autoPublish && input.mode === 'auto' && input.armed && !input.publishing && pendingCount >= 1,
    label: !known ? '…' : tr(pendingCount === 1 ? 'unpublishedCountOne' : 'unpublishedCount').replace('{n}', String(pendingCount)),
    errorLine: input.error || null,
    playPauseAction: input.mode === 'auto' ? 'pause' : 'play',
  };
}
