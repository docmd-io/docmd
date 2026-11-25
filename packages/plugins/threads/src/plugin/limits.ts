/**
 * Limits against a runaway agent, not against commenters (who are trusted):
 * a body-length cap and a per-author sliding-window rate limit. State is in
 * memory and resets on restart by design.
 */
import type { ActionContext } from '@docmd/api';
import { ThreadsError } from './errors.js';
import { getOptions } from './config.js';
import type { Caller } from '../types.js';

/** Reject a body longer than `maxCommentChars` characters (code points). Emptiness is `requireFields`' concern. */
export function checkBody(body: string, opts: { maxCommentChars: number }): void {
  const length = [...body].length;
  if (length > opts.maxCommentChars) {
    throw new ThreadsError('limit-chars', `comment is ${length} characters; the limit is ${opts.maxCommentChars}`);
  }
}

interface RateLimiter {
  /** Record one event for `key`, or throw `rate-limited` when the window already holds `max`. */
  take(key: string): void;
}

/** Sliding window: at most `max` events per key in any `windowMs`. A rejected call is not recorded. */
export function createRateLimiter(opts: { now: () => number; windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key) {
      const t = opts.now();
      // Forget keys whose every hit has slid out, so rotating keys cannot grow the map without bound.
      for (const [k, at] of hits) if (t - at[at.length - 1] >= opts.windowMs) hits.delete(k);
      const recent = (hits.get(key) ?? []).filter((at) => t - at < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        throw new ThreadsError('rate-limited', `more than ${opts.max} comments per minute; retry shortly`);
      }
      recent.push(t);
      hits.set(key, recent);
    },
  };
}

/** One limiter per project root, so every caller of a project shares the same windows. */
const limiters = new Map<string, { max: number; limiter: RateLimiter }>();

/**
 * The first checks of a write handler, after the caller is resolved and
 * before anything is read or written: body length, then (if `rate`) the
 * caller's rate. A too-long body does not consume the caller's rate; a call
 * the handler rejects later (e.g. an unknown thread) still counts toward it.
 * `now` is read only when the project's limiter is created, so pass a
 * closure that reads the clock on each call, not a captured value. Under
 * `docmd dev` the key comes from the payload, so it is not a defence against
 * a caller that rotates keys; a change of `commentsPerMinute` in the config
 * resets the project's windows.
 */
export function guardWrite(
  ctx: ActionContext,
  payload: Record<string, unknown>,
  caller: Caller,
  opts: { rate: boolean; now: () => number },
): void {
  const { limits } = getOptions(ctx);
  checkBody(String(payload.body ?? ''), limits);
  if (!opts.rate) return;
  let entry = limiters.get(ctx.projectRoot);
  if (!entry || entry.max !== limits.commentsPerMinute) {
    entry = {
      max: limits.commentsPerMinute,
      limiter: createRateLimiter({ now: opts.now, windowMs: 60_000, max: limits.commentsPerMinute }),
    };
    limiters.set(ctx.projectRoot, entry);
  }
  entry.limiter.take(caller.key);
}
