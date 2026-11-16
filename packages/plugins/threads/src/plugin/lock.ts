/** A promise-chain mutex: callbacks run one after the other, in call order; a failure does not block the queue. */
export interface Lock {
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export function createLock(): Lock {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    withLock<T>(fn: () => Promise<T>): Promise<T> {
      const run = chain.then(fn, fn);
      chain = run.catch(() => undefined);
      return run;
    },
  };
}

/** One lock per docs root, so every caller's publish queues behind the same chain. */
const locks = new Map<string, Lock>();
export function lockFor(docsRoot: string): Lock {
  let lock = locks.get(docsRoot);
  if (!lock) locks.set(docsRoot, (lock = createLock()));
  return lock;
}
