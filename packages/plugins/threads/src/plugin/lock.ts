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
