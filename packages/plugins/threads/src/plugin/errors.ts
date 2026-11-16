/**
 * Server errors. The message prefix `threads/<code>: ` is the wire contract:
 * the dispatcher returns plain error messages, and clients read the prefix.
 */

export type ThreadsErrorCode = 'not-found' | 'invalid' | 'config' | 'no-identity';

export class ThreadsError extends Error {
  readonly code: ThreadsErrorCode;

  constructor(code: ThreadsErrorCode, text: string) {
    super(`threads/${code}: ${text}`);
    this.name = 'ThreadsError';
    this.code = code;
  }
}
