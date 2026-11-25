/**
 * Server errors. The message prefix `threads/<code>: ` is the wire contract:
 * the dispatcher returns plain error messages, and clients read the prefix.
 */

export type ThreadsErrorCode = 'not-found' | 'invalid' | 'config' | 'no-identity' | 'email-identity' | 'forbidden' | 'empty-review' | 'push-failed' | 'limit-chars' | 'rate-limited';

export class ThreadsError extends Error {
  readonly code: ThreadsErrorCode;

  constructor(code: ThreadsErrorCode, text: string, options?: { cause?: unknown }) {
    super(`threads/${code}: ${text}`, options);
    this.name = 'ThreadsError';
    this.code = code;
  }
}
