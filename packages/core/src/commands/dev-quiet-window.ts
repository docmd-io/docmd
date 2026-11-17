/**
 * Post-rebuild quiet window for the dev watcher.
 *
 * Right after a content rebuild, fs.watch can still deliver stale events
 * (macOS phantom events, the build's own writes). Dropping them outright also
 * dropped a genuine save made inside the window. Instead, an event that
 * arrives inside the window is deferred until the window has passed and is
 * then handled like any other event: the caller's content-signature check
 * filters the phantom ones, and a real edit is rebuilt.
 */
export interface QuietWindowOptions {
  quietMs: number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
}

export function createQuietWindow(opts: QuietWindowOptions) {
  let lastRebuildAt = 0;
  const deferred = new Set<string>();

  const self = {
    /** Call when a content rebuild has finished. */
    markRebuilt(): void {
      lastRebuildAt = opts.now();
    },
    /** Call for every watcher event; `run` handles it once outside the window. */
    event(filePath: string, run: () => void): void {
      const remaining = opts.quietMs - (opts.now() - lastRebuildAt);
      if (remaining <= 0) {
        run();
        return;
      }
      // One pending re-check per file; it runs once the window has passed.
      if (deferred.has(filePath)) return;
      deferred.add(filePath);
      opts.setTimer(() => {
        deferred.delete(filePath);
        // A rebuild that finished meanwhile restarts the window.
        self.event(filePath, run);
      }, remaining);
    }
  };
  return self;
}
