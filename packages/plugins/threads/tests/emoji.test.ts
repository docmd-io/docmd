import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isSingleEmoji, normalizeEmoji, DEFAULT_REACTION_EMOJI } from '../src/shared/emoji.ts';
import { normalizeOptions } from '../src/plugin/config.ts';

const require = createRequire(import.meta.url);
const dataDir = path.join(path.dirname(require.resolve('emoji-picker-element-data/package.json')));

test('every emoji of the shipped picker data is accepted, and its normal form is accepted too', () => {
  let total = 0;
  for (const lang of ['en', 'hi', 'ko', 'zh']) {
    // The same source order build.js uses for the shipped file
    const file = ['emojibase', 'cldr'].map((d) => path.join(dataDir, lang, d, 'data.json')).find((f) => fs.existsSync(f))!;
    const entries = JSON.parse(fs.readFileSync(file, 'utf8')) as { emoji: string }[];
    for (const { emoji } of entries) {
      total++;
      assert.ok(isSingleEmoji(emoji), `${lang}: ${[...emoji].map((c) => c.codePointAt(0)!.toString(16)).join(' ')} was refused`);
      const normal = normalizeEmoji(emoji);
      assert.ok(normal !== null && isSingleEmoji(normal));
      assert.equal(normalizeEmoji(normal), normal, 'normalizing twice changes nothing');
    }
  }
  assert.ok(total > 1500);
});

test('the picker spelling of an emoji and the quick row spelling are one reaction', () => {
  assert.equal(normalizeEmoji('👍️'), '👍');
  assert.equal(normalizeEmoji('👈️'), '👈');
  assert.equal(normalizeEmoji('👍'), '👍');
  assert.equal(normalizeEmoji('❤️'), '❤️', 'a selector that is needed stays');
  for (const e of DEFAULT_REACTION_EMOJI) assert.equal(normalizeEmoji(e), e);
});

test('flags, keycaps, skin tones and ZWJ sequences are one emoji; text, lists and separators are not', () => {
  for (const ok of ['🇧🇷', '1️⃣', '👍🏽', '👨‍👩‍👧', '🏴󠁧󠁢󠁥󠁮󠁧󠁿']) assert.ok(isSingleEmoji(ok), ok);
  for (const bad of ['', 'a', '1', '👍👎', '👍, 👎', '👍\n', ' 👍', '👍 x', '::: x', 42, null, undefined]) assert.equal(isSingleEmoji(bad), false, String(bad));
});

test('a configured emoji list is stored in its one spelling and duplicates by spelling are refused', () => {
  const opts = normalizeOptions({ reactions: { emoji: ['👍️', '🎉'] } });
  assert.deepEqual(opts.reactions.emoji, ['👍', '🎉']);
  assert.throws(() => normalizeOptions({ reactions: { emoji: ['👍', '👍️'] } }), /repeat/);
});
