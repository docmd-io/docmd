import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emojiPickerI18n } from '../src/client/lib/emoji-picker-i18n.ts';
import { getAssets } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const vendor = path.join(root, 'src', 'client', 'vendor', 'emoji-picker');
const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');
const LANGS = ['en', 'hi', 'ko', 'zh'];

const g = globalThis as Record<string, unknown>;
let hadWindow = false;
let savedWindow: unknown;
beforeEach(() => {
  hadWindow = 'window' in g;
  savedWindow = g.window;
  g.window = {};
});
afterEach(() => {
  if (hadWindow) g.window = savedWindow;
  else delete g.window;
});

test('emojiPickerI18n has the shape the picker reads, from the English defaults', () => {
  const dict = emojiPickerI18n();
  assert.equal(dict.searchLabel, 'Search');
  assert.equal(dict.skinTones.length, 6);
  assert.equal(dict.skinToneLabel, 'Choose a skin tone (currently {skinTone})', 'the placeholder is kept for the picker to fill');
  assert.deepEqual(Object.keys(dict.categories), [
    'custom', 'smileys-emotion', 'people-body', 'animals-nature', 'food-drink', 'travel-places', 'activities', 'objects', 'symbols', 'flags',
  ]);
  for (const v of [...dict.skinTones, ...Object.values(dict.categories)]) assert.ok(v.trim() !== '');
});

test('emojiPickerI18n follows the page strings and never returns a bare key in any language', () => {
  for (const lang of LANGS) {
    g.window = { __threads_i18n: JSON.parse(read(root, 'i18n', `${lang}.json`)) };
    const dict = emojiPickerI18n();
    const flat = [dict.searchLabel, dict.regionLabel, ...dict.skinTones, ...Object.values(dict.categories)];
    for (const v of flat) assert.ok(!v.startsWith('emojiPicker.'), `${lang}: ${v}`);
    assert.ok(dict.skinToneLabel.includes('{skinTone}'), `${lang} keeps the placeholder`);
  }
  g.window = { __threads_i18n: { 'emojiPicker.searchLabel': 'Chercher' } };
  assert.equal(emojiPickerI18n().searchLabel, 'Chercher');
});

test('the vendored picker keeps its licence and says where it was changed', () => {
  assert.match(read(vendor, 'LICENSE'), /Apache License\s+Version 2\.0, January 2004/);
  const notice = read(vendor, 'NOTICE');
  for (const needle of ['1.29.1', 'github.com/nolanlawson/emoji-picker-element', 'Apache']) assert.ok(notice.includes(needle), needle);
  for (const file of ['picker.js', 'database.js']) {
    const src = read(vendor, file);
    assert.ok(src.startsWith('/*\n * emoji-picker-element v1.29.1'), `${file} keeps the original attribution`);
    assert.ok(src.slice(0, 600).includes('Modified for @docmd/plugin-threads'), `${file} carries the change line`);
  }
});

test('the vendored picker has only the planned changes: own tag, no CDN, no media-query theme', () => {
  const picker = read(vendor, 'picker.js');
  const database = read(vendor, 'database.js');
  assert.ok(picker.includes("customElements.define('threads-emoji-picker', PickerElement)"));
  assert.ok(picker.includes("!customElements.get('threads-emoji-picker')"), 'the define is guarded');
  assert.ok(!picker.includes("define('emoji-picker'"));
  for (const src of [picker, database]) assert.ok(!src.includes('jsdelivr'), 'no CDN default');
  assert.ok(!picker.includes('prefers-color-scheme'), 'colours come from tokens, not the OS setting');
  assert.ok(picker.includes('prefers-reduced-motion'), 'the rest of the stylesheet is untouched');
  assert.match(database, /constructor \(\{ dataSource, locale/);
  assert.match(database, /assertNonEmptyString\(dataSource\)/, 'a missing dataSource is an error');
});

test('getAssets serves the picker with no script tag and the emoji data as static files', () => {
  const assets = getAssets();
  const picker = assets.find((a) => a.dest === 'assets/js/threads-emoji-picker.js');
  assert.ok(picker);
  assert.equal(picker.location, 'none');
  assert.equal(picker.type, 'js');
  assert.ok(picker.src.endsWith(path.join('dist', 'client', 'emoji-picker.js')));
  for (const lang of LANGS) {
    const data = assets.find((a) => a.dest === `assets/threads/emoji/${lang}.json`);
    assert.ok(data, lang);
    assert.equal(data.type, 'static');
    assert.ok(data.src.endsWith(path.join('dist', 'client', 'emoji', `${lang}.json`)));
  }
  assert.ok(assets.find((a) => a.dest === 'assets/js/threads.js'), 'the main bundle is still served');
  assert.equal(assets.filter((a) => a.location === 'body' && a.type === 'js').length, 1, 'the picker is the only lazy script');
});
