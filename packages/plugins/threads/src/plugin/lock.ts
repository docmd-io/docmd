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

/** What a publish or discard tells the sync layer (a git implementation builds the commit from it). */
export interface PublishMeta {
  authorKey: string;
  authorName: string;
  /** The request's well-formed e-mail for the commit author; in memory only, never serialised. */
  authorEmail?: string;
  /** What the change is: a published review or a discard (default publish). */
  kind?: 'publish' | 'discard';
  /** Pages the change may touch, relative to the project root. */
  files: string[];
  /** The review manifest the change writes, relative to the project root (committed with the files). */
  manifest?: string;
}

/** What `apply` reports once it has written the files: the commit subject is built from it. */
export interface Applied {
  title: string;
  /** The review's summary: the body of a publish commit (a discard commit has none). */
  summary?: string | null;
}

/**
 * How a publish reaches the outside world. `withLock` serialises repository
 * mutations; `publishWithRetry` runs `apply`, which may run more than once when
 * an implementation retries, so it must start from scratch each time. An
 * implementation that retries must put the files back to their pre-apply state
 * before calling `apply` again: apply reads the files it rewrites.
 */
export interface Sync {
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  publishWithRetry(apply: () => Promise<Applied>, meta: PublishMeta): Promise<void>;
}

/** The path without git: no process is spawned and `apply` runs once. */
export function createNoGitSync(lock: Lock): Sync {
  return {
    withLock: (fn) => lock.withLock(fn),
    publishWithRetry: async (apply) => void (await apply()),
  };
}
