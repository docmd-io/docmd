import type { Caller } from '../../src/types.ts';
import type { PermissionAction, PermissionTarget } from '../../src/plugin/permissions.ts';

// One decision table, run through the server's `canDo` and the client's `canShow`.

export const who = (key: string, over: Partial<Caller> = {}): Caller =>
  ({ key, name: key, avatarUrl: '', source: 'header', isAdmin: false, ...over });
const alice = who('alice');
const bob = who('bob');
const root = who('root', { isAdmin: true });
const dev = who('dev', { source: 'payload' });

type Row = [label: string, caller: Caller, action: PermissionAction, target: PermissionTarget, resolve: 'anyone' | 'author', allowed: boolean];
export const rows: Row[] = [];
const add = (action: PermissionAction, target: PermissionTarget, callers: Array<[string, Caller, boolean]>, resolve: 'anyone' | 'author' = 'anyone') => {
  for (const [name, caller, allowed] of callers) rows.push([`${action} ${JSON.stringify(target)} by ${name}`, caller, action, target, resolve, allowed]);
};
const everyone = (owner: boolean, other: boolean, admin: boolean, devAllowed = true): Array<[string, Caller, boolean]> =>
  [['owner', alice, owner], ['other', bob, other], ['admin', root, admin], ['dev', dev, devAllowed]];

for (const action of ['edit-comment', 'delete-comment'] as const) {
  add(action, { authorKey: 'alice' }, everyone(true, false, true));
  add(action, { authorKey: null }, everyone(false, false, true));
  add(action, {}, everyone(false, false, true));
  add(action, { authorKey: 'bob', drafted: true }, everyone(true, true, true));
}
add('delete-thread', { authorKeys: ['alice', 'alice'] }, everyone(true, false, true));
add('delete-thread', { authorKeys: ['alice', 'bob'] }, everyone(false, false, true));
add('delete-thread', { authorKeys: ['alice', null] }, everyone(false, false, true));
add('delete-thread', { authorKeys: [] }, everyone(true, true, true));
add('resolve-thread', { threadAuthor: 'alice' }, everyone(true, true, true), 'anyone');
add('resolve-thread', { threadAuthor: 'alice' }, everyone(true, false, true), 'author');
add('resolve-thread', { threadAuthor: null }, everyone(false, false, true), 'author');
add('resolve-thread', { threadAuthor: 'bob', drafted: true }, everyone(true, true, true), 'author');
add('discard-review', { reviewAuthor: 'alice' }, everyone(true, false, true));
add('discard-review', { reviewAuthor: null }, everyone(false, false, true));
// upsert-author only ever touches the caller's own entry: admins are no exception
add('upsert-author', {}, everyone(true, true, true));
add('upsert-author', { authorKey: 'alice' }, everyone(true, false, false));
add('upsert-author', { authorKey: null }, everyone(true, true, true));
