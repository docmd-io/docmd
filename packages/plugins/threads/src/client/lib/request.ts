import { errorCode, limitMessage } from './limit-message';
import { t } from './i18n';

/** What a request event's `detail` carries on top of its own data. */
export interface RequestDetail {
  /** Call it synchronously from a listener with the promise of the work the event asked for. */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Dispatch a request event (name starting with `threads-`, bubbles, composed) whose detail has a
 * `waitUntil(promise)`. Returns what the listeners registered: null when none did (the component
 * goes straight back to idle), the one promise when one did (so its value reaches the caller), or
 * `Promise.all` of several. A `waitUntil` call after `dispatchEvent` has returned is ignored.
 */
export function dispatchRequest<D extends object>(target: EventTarget, type: string, data: D): Promise<unknown> | null {
  const pending: Promise<unknown>[] = [];
  const detail: D & RequestDetail = {
    ...data,
    waitUntil: (promise) => {
      pending.push(Promise.resolve(promise));
    },
  };
  target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  if (pending.length === 0) return null;
  return pending.length === 1 ? pending[0] : Promise.all(pending);
}

/** Rejections other than the limits that have their own message. */
const CODE_KEYS: Record<string, string> = {
  'threads/reaction-not-allowed': 'reactionNotAllowed',
};

/** The text a component shows in its error line for a rejected request. */
export function requestErrorMessage(err: unknown): string {
  const limit = limitMessage(err);
  if (limit) return limit;
  const code = errorCode(err);
  const key = code ? CODE_KEYS[code] : undefined;
  return key ? t(key) : t('couldNotSave');
}
