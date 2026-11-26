import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as Record<string, unknown>;
const savedWindow = Object.getOwnPropertyDescriptor(g, 'window');
let limitMessage: typeof import('../src/client/lib/limit-message.ts').limitMessage;
let ThreadsClientError: typeof import('../src/client/lib/api.ts').ThreadsClientError;

before(async () => {
  // `t` reads the English defaults when no translations are injected; api.ts reads document/localStorage only when called.
  Object.defineProperty(g, 'window', { value: {}, configurable: true, writable: true });
  ({ limitMessage } = await import('../src/client/lib/limit-message.ts'));
  ({ ThreadsClientError } = await import('../src/client/lib/api.ts'));
});
after(() => {
  if (savedWindow) Object.defineProperty(g, 'window', savedWindow);
  else delete g['window'];
});

const LIMIT_CHARS = 'This comment is too long. Shorten it and try again.';
const RATE_LIMITED = 'You are commenting too fast. Wait a minute and try again.';

test('limitMessage maps the two limit codes, in both error shapes, and nothing else', () => {
  const table: Array<[string, () => unknown, string | null]> = [
    ['wire limit-chars', () => new Error('threads/limit-chars: comment is 5001 characters; the limit is 5000'), LIMIT_CHARS],
    ['wire rate-limited', () => new Error('threads/rate-limited: too many comments'), RATE_LIMITED],
    ['client limit-chars', () => new ThreadsClientError('limit-chars', 'comment is 5001 characters'), LIMIT_CHARS],
    ['client rate-limited', () => new ThreadsClientError('rate-limited', 'too many comments'), RATE_LIMITED],
    ['forbidden', () => new Error('threads/forbidden: not yours'), null],
    ['no-identity', () => new Error('threads/no-identity: who are you'), null],
    ['invalid', () => new Error('threads/invalid: bad payload'), null],
    ['plain error', () => new Error('network down'), null],
    ['code only in the text', () => new Error('threads/invalid: threads/limit-chars'), null],
    ['code not at the start', () => new Error('Error: threads/limit-chars: x'), null],
    ['string', () => 'threads/limit-chars: x', null],
    ['undefined', () => undefined, null],
    ['null', () => null, null],
  ];
  for (const [name, make, expected] of table) assert.equal(limitMessage(make()), expected, name);
});
