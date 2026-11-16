const INTERVAL_MS = 250;
// Above docmd-api.js's reconnect window (5 retries, 1.5^n s backoff capped at 5 s, ~20 s):
// once this elapses the socket can no longer open, so the wait is over.
const MAX_WAIT_MS = 30_000;

/**
 * Run `onLive` once the docmd socket is live. The browser API exposes no
 * "connected" event, only `isLive()`, so while the socket is still connecting
 * this polls and stops for good once it fires, on cancel, or after MAX_WAIT_MS
 * (then `onGiveUp` runs). `onLive` runs at most once. Returns a cancel function.
 */
export function whenLive(isLive: () => boolean, onLive: () => void, onGiveUp?: () => void): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const cancel = (): void => {
    if (timer !== null) { clearInterval(timer); timer = null; }
  };

  if (isLive()) { onLive(); return cancel; }

  let waited = 0;
  timer = setInterval(() => {
    waited += INTERVAL_MS;
    if (isLive()) { cancel(); onLive(); return; }
    if (waited >= MAX_WAIT_MS) { cancel(); onGiveUp?.(); }
  }, INTERVAL_MS);
  return cancel;
}
