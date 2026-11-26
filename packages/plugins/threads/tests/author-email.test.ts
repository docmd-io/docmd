import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionContext } from '@docmd/api';
import { authorEmailOf } from '../src/plugin/author-email.ts';

const ctxWith = (headers: Record<string, string>, mode: 'serve' | 'dev' = 'serve', header: string | null = 'X-Auth-Request-Email') =>
  ({
    mode,
    caller: { headers },
    config: { plugins: { threads: { git: { branch: 'main', ...(header ? { authorEmailHeader: header } : {}) } } } },
  }) as unknown as ActionContext;
const H = 'x-auth-request-email';

test('authorEmailOf: the header value is trimmed and checked; anything else is absent', () => {
  const rows: Array<[string, string | null]> = [
    ['ann@example.com', 'ann@example.com'],
    [' ann@example.com ', 'ann@example.com'],
    ['ann+tag@sub.example.com', 'ann+tag@sub.example.com'],
    ['ann', null],
    ['', null],
    ['   ', null],
    ['a@b@c', null],
    ['@example.com', null],
    ['ann@', null],
    ['"Ann" <ann@x.org>', null],
    ['<ann@x.org>', null],
    ['ann@x.org>', null],
    ['ann @example.com', null],
    ['ann@example.com\r\nX: y', null],
    ['ann@exa\u0000mple.com', null],
    [`${'a'.repeat(242)}@example.com`, `${'a'.repeat(242)}@example.com`], // 254
    [`${'a'.repeat(243)}@example.com`, null], // 255
  ];
  for (const [value, want] of rows) assert.equal(authorEmailOf(ctxWith({ [H]: value })), want, JSON.stringify(value));
});

test('authorEmailOf: the header name matches case-insensitively; no option, no header and dev give null', () => {
  assert.equal(authorEmailOf(ctxWith({ [H]: 'ann@example.com' }, 'serve', 'X-AUTH-request-EMAIL')), 'ann@example.com');
  assert.equal(authorEmailOf(ctxWith({}, 'serve')), null, 'absent header');
  assert.equal(authorEmailOf(ctxWith({ [H]: 'ann@example.com' }, 'serve', null)), null, 'no option');
  assert.equal(authorEmailOf(ctxWith({ [H]: 'ann@example.com' }, 'dev')), null, 'dev');
  assert.equal(authorEmailOf({ mode: 'serve', config: {} } as unknown as ActionContext), null, 'no git, no caller');
});
