import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_REACTIONS,
  asReactionViews,
  chipDisabled,
  chipLabel,
  isMine,
  listNames,
  pickerLocale,
  plainReactionViews,
  reactionIsMine,
  reactorNames,
  showAddButton,
  toAuthorView,
  toReactionViews,
  type ReactionView,
} from '../src/client/lib/reactions.ts';
import { DEFAULT_REACTION_EMOJI } from '../src/shared/emoji.ts';
import type { AuthorsMap } from '../src/types.ts';

const alice = { key: 'alice', name: 'Alice' };
const authors: AuthorsMap = {
  alice: { name: 'Alice Smith', avatarUrl: 'a.png' },
  bob: { name: 'Bob', avatarUrl: 'b.png', link: false },
  carol: { name: 'Carol', avatarUrl: '', link: 'https://carol.example/me' },
  evil: { name: 'Evil', avatarUrl: '', link: 'javascript:alert(1)' },
};
const PATTERN = 'https://github.com/{id}';

test('the client quick row is the server default list', () => {
  assert.deepEqual([...QUICK_REACTIONS], [...DEFAULT_REACTION_EMOJI]);
});

test('isMine: equal keys when both are set', () => {
  assert.equal(isMine({ key: 'alice', name: 'x' }, { key: 'alice', name: 'y' }), true, 'names are not compared when keys are');
  assert.equal(isMine({ key: 'alice', name: 'Alice' }, { key: 'bob', name: 'Alice' }), false, 'same name, different key');
});

test('isMine: a reactor with a key never matches a viewer without one', () => {
  assert.equal(isMine({ key: 'alice', name: 'Alice' }, { key: null, name: 'Alice' }), false);
});

test('isMine: a key-less (old) entry matches by name only', () => {
  assert.equal(isMine({ key: null, name: 'Alice' }, { key: 'alice', name: 'Alice' }), true);
  assert.equal(isMine({ key: null, name: 'Alice' }, { key: null, name: 'Alice' }), true);
  assert.equal(isMine({ key: null, name: 'Alice' }, { key: 'alice', name: 'Bob' }), false);
  assert.equal(isMine({ key: null, name: '' }, { key: null, name: '' }), false, 'an empty name matches nobody');
});

test('reactionIsMine finds the viewer among several reactors', () => {
  const r: ReactionView = { emoji: '👍', reactors: [{ key: 'bob', name: 'Bob', href: null }, { key: 'alice', name: 'Alice', href: null }] };
  assert.equal(reactionIsMine(r, alice), true);
  assert.equal(reactionIsMine(r, { key: 'zed', name: 'Zed' }), false);
  assert.equal(reactionIsMine({ emoji: '👍', reactors: [] }, alice), false);
});

test('toReactionViews: the current author name wins for a keyed reactor, the stored name otherwise', () => {
  const views = toReactionViews(
    [{ emoji: '👍', reactors: [{ key: 'alice', name: 'Old Alice' }, { key: 'nobody', name: 'Stored' }, { key: null, name: 'Legacy' }] }],
    authors,
    null,
  );
  assert.deepEqual(views[0]!.reactors.map((r) => r.name), ['Alice Smith', 'Stored', 'Legacy']);
  assert.deepEqual(views[0]!.reactors.map((r) => r.key), ['alice', 'nobody', null], 'keys are carried for matching');
});

test('toReactionViews: hrefs follow profileHref (pattern, own link, opted out, unsafe link, no key)', () => {
  const [view] = toReactionViews(
    [{ emoji: '🎉', reactors: [
      { key: 'alice', name: 'a' }, { key: 'bob', name: 'b' }, { key: 'carol', name: 'c' }, { key: 'evil', name: 'e' }, { key: null, name: 'old' }, { key: 'a b', name: 'sp' },
    ] }],
    authors,
    PATTERN,
  );
  assert.deepEqual(view!.reactors.map((r) => r.href), [
    'https://github.com/alice', null, 'https://carol.example/me', 'https://github.com/evil', null, 'https://github.com/a%20b',
  ]);
  assert.ok(toReactionViews([{ emoji: '👍', reactors: [{ key: 'alice', name: 'a' }] }], authors, null)[0]!.reactors.every((r) => r.href === null), 'no pattern, no link');
});

test('toReactionViews keeps the emoji order and an empty list empty', () => {
  assert.deepEqual(toReactionViews([], authors, PATTERN), []);
  const views = toReactionViews([{ emoji: '🚀', reactors: [] }, { emoji: '👍', reactors: [] }], authors, PATTERN);
  assert.deepEqual(views.map((v) => v.emoji), ['🚀', '👍']);
});

test('names shown never include keys', () => {
  const [view] = toReactionViews([{ emoji: '👍', reactors: [{ key: '8812031', name: 'Dana' }] }], authors, PATTERN);
  assert.deepEqual(reactorNames(view!), ['Dana']);
  assert.ok(!chipLabel(view!).includes('8812031'));
});

test('plainReactionViews: raw reactions with no links', () => {
  assert.deepEqual(plainReactionViews([{ emoji: '👍', reactors: [{ key: 'a', name: 'A' }] }]), [{ emoji: '👍', reactors: [{ key: 'a', name: 'A', href: null }] }]);
});

test('toAuthorView: by key, then by display name, then by first name, then the stored name', () => {
  assert.deepEqual(toAuthorView({ author: 'x', authorKey: 'alice' }, authors, PATTERN), { name: 'Alice Smith', avatarUrl: 'a.png', href: 'https://github.com/alice' });
  assert.deepEqual(toAuthorView({ author: 'Bob' }, authors, PATTERN), { name: 'Bob', avatarUrl: 'b.png', href: null }, 'a key-less comment has no link even when the name matches');
  assert.equal(toAuthorView({ author: 'Alice' }, authors, PATTERN).avatarUrl, 'a.png', 'first-name match');
  assert.deepEqual(toAuthorView({ author: 'Stranger', authorKey: 'ghost' }, authors, PATTERN), { name: 'Stranger', avatarUrl: '', href: 'https://github.com/ghost' });
  assert.deepEqual(toAuthorView({ author: 'Stranger' }, {}, null), { name: 'Stranger', avatarUrl: '', href: null });
  assert.equal(toAuthorView({ author: 'x', authorKey: 'carol' }, authors, PATTERN).href, 'https://carol.example/me');
  assert.equal(toAuthorView({ author: 'x', authorKey: 'bob' }, authors, PATTERN).href, null, 'linking turned off');
});

test('toAuthorView ignores inherited object keys', () => {
  assert.equal(toAuthorView({ author: 'x', authorKey: 'constructor' }, authors, null).name, 'x');
  assert.equal(toReactionViews([{ emoji: '👍', reactors: [{ key: 'toString', name: 'N' }] }], authors, null)[0]!.reactors[0]!.name, 'N');
});

test('chipDisabled: any chip toggles, except an unlisted one on a restricted site unless it is pressed', () => {
  const listed = { options: ['👍', '🎉'], restricted: true };
  assert.equal(chipDisabled('👍', false, listed), false, 'listed');
  assert.equal(chipDisabled('🦄', false, listed), true, 'unlisted, not mine');
  assert.equal(chipDisabled('🦄', true, listed), false, 'unlisted but mine: may be taken back');
  assert.equal(chipDisabled('🦄', false, { options: ['👍'], restricted: false }), false, 'unrestricted: +1 any emoji');
  assert.equal(chipDisabled('🦄', false, { options: [], restricted: true }), true, 'empty list');
});

test('showAddButton: only when unrestricted and a picker module is set', () => {
  assert.equal(showAddButton(false, '/p.js'), true);
  assert.equal(showAddButton(true, '/p.js'), false);
  assert.equal(showAddButton(false, ''), false);
  assert.equal(showAddButton(false, undefined), false);
  assert.equal(showAddButton(false, null), false);
});

test('pickerLocale reads the language from the data URL, en otherwise', () => {
  assert.equal(pickerLocale('https://x.test/base/assets/threads/emoji/zh.json'), 'zh');
  assert.equal(pickerLocale('/assets/threads/emoji/KO.json?v=2'), 'ko');
  assert.equal(pickerLocale('/emoji.json'), 'en', 'a longer name is not a language');
  assert.equal(pickerLocale(''), 'en');
  assert.equal(pickerLocale(undefined), 'en');
  assert.equal(pickerLocale('/data/emoji-data.js'), 'en');
});

test('listNames and chipLabel: "<emoji> <count>: <names>"', () => {
  assert.equal(listNames(['A']), 'A');
  assert.equal(listNames(['A', 'B']), 'A and B');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B, and C');
  assert.equal(listNames([]), '');
  assert.equal(listNames(['A', 'B'], 'not a locale!!'), 'A, B', 'a bad language falls back to commas');
  const r: ReactionView = { emoji: '👍', reactors: [{ key: 'a', name: 'Alice', href: null }, { key: 'b', name: 'Bob', href: null }] };
  assert.equal(chipLabel(r, 'en'), '👍 2: Alice and Bob');
});

test('asReactionViews accepts a reaction list and nothing else', () => {
  const good = [{ emoji: '👍', reactors: [] }];
  assert.equal(asReactionViews(good), good);
  assert.deepEqual(asReactionViews([]), []);
  assert.equal(asReactionViews(undefined), null);
  assert.equal(asReactionViews(null), null);
  assert.equal(asReactionViews('x'), null);
  assert.equal(asReactionViews([good]), null, 'several listeners resolve to an array of arrays: ignored');
  assert.equal(asReactionViews([{ emoji: 1, reactors: [] }]), null);
  assert.equal(asReactionViews([{ emoji: '👍' }]), null);
  assert.equal(asReactionViews([null]), null);
});
