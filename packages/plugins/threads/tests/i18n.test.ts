import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, setThreadsStrings } from '../src/client/lib/i18n';

const here = path.dirname(fileURLToPath(import.meta.url));
const LANGS = ['en', 'hi', 'ko', 'zh'];
const load = (lang: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(here, '..', 'i18n', `${lang}.json`), 'utf8'));

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

test('t falls back to the English default, then to the key', () => {
  assert.equal(t('cancel'), 'Cancel');
  assert.equal(t('no-such-key'), 'no-such-key');
  assert.equal(t('constructor'), 'constructor');
});

test('t reads the page-injected strings before the defaults', () => {
  g.window = { __threads_i18n: { cancel: 'Annuler', save: 3 } };
  assert.equal(t('cancel'), 'Annuler');
  assert.equal(t('save'), 'Save', 'a non-string injected value is ignored');
});

test('t works with no window at all', () => {
  delete g.window;
  assert.equal(t('cancel'), 'Cancel');
});

test('setThreadsStrings wins over the injected strings and the defaults, and merges across calls', () => {
  g.window = { __threads_i18n: { cancel: 'Annuler', delete: 'Supprimer' } };
  setThreadsStrings({ cancel: 'Abbrechen' });
  assert.equal(t('cancel'), 'Abbrechen');
  assert.equal(t('delete'), 'Supprimer', 'an unset key still comes from the injected strings');
  setThreadsStrings({ submit: 'Senden' });
  assert.equal(t('cancel'), 'Abbrechen', 'an earlier key survives a later call');
  assert.equal(t('submit'), 'Senden');
  setThreadsStrings({ cancel: 'Zurück' });
  assert.equal(t('cancel'), 'Zurück', 'a later call replaces the key');
  setThreadsStrings({ cancel: 'Cancel', submit: 'Submit' }); // leave the module as the other tests expect it
});

test('setThreadsStrings ignores non-string values and an empty dictionary', () => {
  setThreadsStrings({});
  setThreadsStrings({ reply: 7 as unknown as string, comment: null as unknown as string });
  assert.equal(t('reply'), 'Reply');
  assert.equal(t('comment'), 'Comment');
});

test('every language file has exactly the keys of en.json, none empty', () => {
  const en = Object.keys(load('en')).sort();
  for (const lang of LANGS) {
    const dict = load(lang);
    assert.deepEqual(Object.keys(dict).sort(), en, `${lang}.json keys`);
    for (const [k, v] of Object.entries(dict)) assert.ok(typeof v === 'string' && v.trim() !== '', `${lang}.${k} is not empty`);
  }
});

test('the strings the primitives use exist in all four languages', () => {
  for (const lang of LANGS) {
    const dict = load(lang);
    for (const key of ['couldNotSave', 'addComment', 'cmdEnterSubmit', 'cancel', 'submit', 'save', 'saving', 'limitChars', 'rateLimited']) {
      assert.ok(dict[key], `${lang}.${key}`);
    }
  }
});

test('the strings the comment and reactions components use exist in all four languages', () => {
  for (const lang of LANGS) {
    const dict = load(lang);
    for (const key of ['moreEmoji', 'addReaction', 'chooseReaction', 'reactionNotAllowed', 'editComment', 'edited', 'unpublished', 'replyingTo', 'emojiPickerFailed', 'reply', 'replyToComment', 'deleteComment', 'save']) {
      assert.ok(dict[key], `${lang}.${key}`);
    }
    assert.ok(dict['replyingTo']!.includes('{name}'), `${lang}.replyingTo keeps its placeholder`);
  }
});

test('the strings the thread card and panel use exist in all four languages', () => {
  for (const lang of LANGS) {
    const dict = load(lang);
    for (const key of ['identityRequired', 'resolve', 'unresolve', 'emptyHint', 'sidebar', 'openInSidebar', 'jumpToHighlight', 'resolved', 'noThreads', 'newComment', 'collapseThread', 'expandThread', 'openThreadsPanel', 'closePanel', 'openCount', 'orphaned', 'unpublished']) {
      assert.ok(dict[key], `${lang}.${key}`);
    }
  }
});
