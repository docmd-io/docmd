/*
 * emoji-picker-element v1.29.1
 * Copyright 2020 Nolan Lawson
 * https://github.com/nolanlawson/emoji-picker-element
 * Licensed under the Apache License, Version 2.0 (see LICENSE in this folder).
 */
/* Modified for @docmd/plugin-threads: see NOTICE in this folder for the list of changes. */
function assertNonEmptyString (str) {
  if (typeof str !== 'string' || !str) {
    throw new Error('expected a non-empty string, got: ' + str)
  }
}

function assertNumber (number) {
  if (typeof number !== 'number') {
    throw new Error('expected a number, got: ' + number)
  }
}

const DB_VERSION_CURRENT = 1;
const DB_VERSION_INITIAL = 1;
const STORE_EMOJI = 'emoji';
const STORE_KEYVALUE = 'keyvalue';
const STORE_FAVORITES = 'favorites';
const FIELD_TOKENS = 'tokens';
const INDEX_TOKENS = 'tokens';
const FIELD_UNICODE = 'unicode';
const INDEX_COUNT = 'count';
const FIELD_GROUP = 'group';
const FIELD_ORDER = 'order';
const INDEX_GROUP_AND_ORDER = 'group-order';
const KEY_ETAG = 'eTag';
const KEY_URL = 'url';
const KEY_PREFERRED_SKINTONE = 'skinTone';
const MODE_READONLY = 'readonly';
const MODE_READWRITE = 'readwrite';
const INDEX_SKIN_UNICODE = 'skinUnicodes';
const FIELD_SKIN_UNICODE = 'skinUnicodes';

const DEFAULT_LOCALE = 'en';

// like lodash's uniqBy but much smaller
function uniqBy (arr, func) {
  const set = new Set();
  const res = [];
  for (const item of arr) {
    const key = func(item);
    if (!set.has(key)) {
      set.add(key);
      res.push(item);
    }
  }
  return res
}

function uniqEmoji (emojis) {
  return uniqBy(emojis, _ => _.unicode)
}

function initialMigration (db) {
  function createObjectStore (name, keyPath, indexes) {
    const store = keyPath
      ? db.createObjectStore(name, { keyPath })
      : db.createObjectStore(name);
    if (indexes) {
      for (const [indexName, [keyPath, multiEntry]] of Object.entries(indexes)) {
        store.createIndex(indexName, keyPath, { multiEntry });
      }
    }
    return store
  }

  createObjectStore(STORE_KEYVALUE);
  createObjectStore(STORE_EMOJI, /* keyPath */ FIELD_UNICODE, {
    [INDEX_TOKENS]: [FIELD_TOKENS, /* multiEntry */ true],
    [INDEX_GROUP_AND_ORDER]: [[FIELD_GROUP, FIELD_ORDER]],
    [INDEX_SKIN_UNICODE]: [FIELD_SKIN_UNICODE, /* multiEntry */ true]
  });
  createObjectStore(STORE_FAVORITES, undefined, {
    [INDEX_COUNT]: ['']
  });
}

const openIndexedDBRequests = {};
const databaseCache = {};
const onCloseListeners = {};

function handleOpenOrDeleteReq (resolve, reject, req) {
  // These things are almost impossible to test with fakeIndexedDB sadly
  /* istanbul ignore next */
  req.onerror = () => reject(req.error);
  /* istanbul ignore next */
  req.onblocked = () => reject(new Error('IDB blocked'));
  req.onsuccess = () => resolve(req.result);
}

async function createDatabase (dbName) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION_CURRENT);
    openIndexedDBRequests[dbName] = req;
    req.onupgradeneeded = e => {
      // Technically there is only one version, so we don't need this `if` check
      // But if an old version of the JS is in another browser tab
      // and it gets upgraded in the future and we have a new DB version, well...
      // better safe than sorry.
      /* istanbul ignore else */
      if (e.oldVersion < DB_VERSION_INITIAL) {
        initialMigration(req.result);
      }
    };
    handleOpenOrDeleteReq(resolve, reject, req);
  });
  // Handle abnormal closes, e.g. "delete database" in chrome dev tools.
  // No need for removeEventListener, because once the DB can no longer
  // fire "close" events, it will auto-GC.
  db.onclose = () => closeDatabase(dbName);
  return db
}

function openDatabase (dbName) {
  if (!databaseCache[dbName]) {
    databaseCache[dbName] = createDatabase(dbName);
  }
  return databaseCache[dbName]
}

function dbPromise (db, storeName, readOnlyOrReadWrite, cb) {
  return new Promise((resolve, reject) => {
    // Use relaxed durability because neither the emoji data nor the favorites/preferred skin tone
    // are really irreplaceable data. IndexedDB is just a cache in this case.
    const txn = db.transaction(storeName, readOnlyOrReadWrite, { durability: 'relaxed' });
    const store = typeof storeName === 'string'
      ? txn.objectStore(storeName)
      : storeName.map(name => txn.objectStore(name));
    let res;
    cb(store, txn, (result) => {
      res = result;
    });

    txn.oncomplete = () => resolve(res);
    /* istanbul ignore next */
    txn.onerror = () => reject(txn.error);
  })
}

function closeDatabase (dbName) {
  // close any open requests
  const req = openIndexedDBRequests[dbName];
  const db = req && req.result;
  if (db) {
    db.close();
    const listeners = onCloseListeners[dbName];
    /* istanbul ignore else */
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
  }
  delete openIndexedDBRequests[dbName];
  delete databaseCache[dbName];
  delete onCloseListeners[dbName];
}

function deleteDatabase (dbName) {
  return new Promise((resolve, reject) => {
    // close any open requests
    closeDatabase(dbName);
    const req = indexedDB.deleteDatabase(dbName);
    handleOpenOrDeleteReq(resolve, reject, req);
  })
}

// The "close" event occurs during an abnormal shutdown, e.g. a user clearing their browser data.
// However, it doesn't occur with the normal "close" event, so we handle that separately.
// https://www.w3.org/TR/IndexedDB/#close-a-database-connection
function addOnCloseListener (dbName, listener) {
  let listeners = onCloseListeners[dbName];
  if (!listeners) {
    listeners = onCloseListeners[dbName] = [];
  }
  listeners.push(listener);
}

// list of emoticons that don't match a simple \W+ regex
// extracted using:
// require('emoji-picker-element-data/en/emojibase/data.json').map(_ => _.emoticon).filter(Boolean).filter(_ => !/^\W+$/.test(_))
const irregularEmoticons = new Set([
  ':D', 'XD', ":'D", 'O:)',
  ':X', ':P', ';P', 'XP',
  ':L', ':Z', ':j', '8D',
  'XO', '8)', ':B', ':O',
  ':S', ":'o", 'Dx', 'X(',
  'D:', ':C', '>0)', ':3',
  '</3', '<3', '\\M/', ':E',
  '8#'
]);

function extractTokens (str) {
  return str
    .split(/[\s_]+/)
    .map(word => {
      if (!word.match(/\w/) || irregularEmoticons.has(word)) {
        // for pure emoticons like :) or :-), just leave them as-is
        return word.toLowerCase()
      }

      return word
        .replace(/[)(:,]/g, '')
        .replace(/’/g, "'")
        .toLowerCase()
    }).filter(Boolean)
}

const MIN_SEARCH_TEXT_LENGTH = 2;

// This is an extra step in addition to extractTokens(). The difference here is that we expect
// the input to have already been run through extractTokens(). This is useful for cases like
// emoticons, where we don't want to do any tokenization (because it makes no sense to split up
// ">:)" by the colon) but we do want to lowercase it to have consistent search results, so that
// the user can type ':P' or ':p' and still get the same result.
function normalizeTokens (str) {
  return str
    .filter(Boolean)
    .map(_ => _.toLowerCase())
    .filter(_ => _.length >= MIN_SEARCH_TEXT_LENGTH)
}

// Transform emoji data for storage in IDB
function transformEmojiData (emojiData) {
  const res = emojiData.map(({ annotation, emoticon, group, order, shortcodes, skins, tags, emoji, version }) => {
    const tokens = [...new Set(
      normalizeTokens([
        ...(shortcodes || []).map(extractTokens).flat(),
        ...(tags || []).map(extractTokens).flat(),
        ...extractTokens(annotation),
        emoticon
      ])
    )].sort();
    const res = {
      annotation,
      group,
      order,
      tags,
      tokens,
      unicode: emoji,
      version
    };
    if (emoticon) {
      res.emoticon = emoticon;
    }
    if (shortcodes) {
      res.shortcodes = shortcodes;
    }
    if (skins) {
      res.skinTones = [];
      res.skinUnicodes = [];
      res.skinVersions = [];
      for (const { tone, emoji, version } of skins) {
        res.skinTones.push(tone);
        res.skinUnicodes.push(emoji);
        res.skinVersions.push(version);
      }
    }
    return res
  });
  return res
}

// helper functions that help compress the code better

function callStore (store, method, key, cb) {
  store[method](key).onsuccess = e => (cb && cb(e.target.result));
}

function getIDB (store, key, cb) {
  callStore(store, 'get', key, cb);
}

function getAllIDB (store, key, cb) {
  callStore(store, 'getAll', key, cb);
}

function commit (txn) {
  /* istanbul ignore else */
  if (txn.commit) {
    txn.commit();
  }
}

// like lodash's minBy
function minBy (array, func) {
  let minItem = array[0];
  for (let i = 1; i < array.length; i++) {
    const item = array[i];
    if (func(minItem) > func(item)) {
      minItem = item;
    }
  }
  return minItem
}

// return an array of results representing all items that are found in each one of the arrays
//

function findCommonMembers (arrays, uniqByFunc) {
  const shortestArray = minBy(arrays, _ => _.length);
  const results = [];
  for (const item of shortestArray) {
    // if this item is included in every array in the intermediate results, add it to the final results
    if (!arrays.some(array => array.findIndex(_ => uniqByFunc(_) === uniqByFunc(item)) === -1)) {
      results.push(item);
    }
  }
  return results
}

async function isEmpty (db) {
  return !(await get(db, STORE_KEYVALUE, KEY_URL))
}

async function hasData (db, url, eTag) {
  const [oldETag, oldUrl] = await Promise.all([KEY_ETAG, KEY_URL]
    .map(key => get(db, STORE_KEYVALUE, key)));
  return (oldETag === eTag && oldUrl === url)
}

async function doFullDatabaseScanForSingleResult (db, predicate) {
  // This batching algorithm is just a perf improvement over a basic
  // cursor. The BATCH_SIZE is an estimate of what would give the best
  // perf for doing a full DB scan (worst case).
  //
  // Mini-benchmark for determining the best batch size:
  //
  // PERF=1 pnpm build:rollup && pnpm test:adhoc
  //
  // (async () => {
  //   performance.mark('start')
  //   await $('emoji-picker').database.getEmojiByShortcode('doesnotexist')
  //   performance.measure('total', 'start')
  //   console.log(performance.getEntriesByName('total').slice(-1)[0].duration)
  // })()
  const BATCH_SIZE = 50; // Typically around 150ms for 6x slowdown in Chrome for above benchmark
  return dbPromise(db, STORE_EMOJI, MODE_READONLY, (emojiStore, txn, cb) => {
    let lastKey;

    const processNextBatch = () => {
      emojiStore.getAll(lastKey && IDBKeyRange.lowerBound(lastKey, true), BATCH_SIZE).onsuccess = e => {
        const results = e.target.result;
        for (const result of results) {
          lastKey = result.unicode;
          if (predicate(result)) {
            return cb(result)
          }
        }
        if (results.length < BATCH_SIZE) {
          return cb()
        }
        processNextBatch();
      };
    };
    processNextBatch();
  })
}

async function loadData (db, emojiData, url, eTag) {
  try {
    const transformedData = transformEmojiData(emojiData);
    await dbPromise(db, [STORE_EMOJI, STORE_KEYVALUE], MODE_READWRITE, ([emojiStore, metaStore], txn) => {
      let oldETag;
      let oldUrl;
      let todo = 0;

      function checkFetched () {
        if (++todo === 2) { // 2 requests made
          onFetched();
        }
      }

      function onFetched () {
        if (oldETag === eTag && oldUrl === url) {
          // check again within the transaction to guard against concurrency, e.g. multiple browser tabs
          return
        }
        // delete old data
        emojiStore.clear();
        // insert new data
        for (const data of transformedData) {
          emojiStore.put(data);
        }
        metaStore.put(eTag, KEY_ETAG);
        metaStore.put(url, KEY_URL);
        commit(txn);
      }

      getIDB(metaStore, KEY_ETAG, result => {
        oldETag = result;
        checkFetched();
      });

      getIDB(metaStore, KEY_URL, result => {
        oldUrl = result;
        checkFetched();
      });
    });
  } finally {
  }
}

async function getEmojiByGroup (db, group) {
  return dbPromise(db, STORE_EMOJI, MODE_READONLY, (emojiStore, txn, cb) => {
    const range = IDBKeyRange.bound([group, 0], [group + 1, 0], false, true);
    getAllIDB(emojiStore.index(INDEX_GROUP_AND_ORDER), range, cb);
  })
}

async function getEmojiBySearchQuery (db, query) {
  const tokens = normalizeTokens(extractTokens(query));

  if (!tokens.length) {
    return []
  }

  return dbPromise(db, STORE_EMOJI, MODE_READONLY, (emojiStore, txn, cb) => {
    // get all results that contain all tokens (i.e. an AND query)
    const intermediateResults = [];

    const checkDone = () => {
      if (intermediateResults.length === tokens.length) {
        onDone();
      }
    };

    const onDone = () => {
      const results = findCommonMembers(intermediateResults, _ => _.unicode);
      cb(results.sort((a, b) => a.order < b.order ? -1 : 1));
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const range = i === tokens.length - 1
        ? IDBKeyRange.bound(token, token + '\uffff', false, true) // treat last token as a prefix search
        : IDBKeyRange.only(token); // treat all other tokens as an exact match
      getAllIDB(emojiStore.index(INDEX_TOKENS), range, result => {
        intermediateResults.push(result);
        checkDone();
      });
    }
  })
}

// This could have been implemented as an IDB index on shortcodes, but it seemed wasteful to do that
// when we can already query by tokens and this will give us what we're looking for 99.9% of the time
async function getEmojiByShortcode (db, shortcode) {
  const emojis = await getEmojiBySearchQuery(db, shortcode);

  // In very rare cases (e.g. the shortcode "v" as in "v for victory"), we cannot search because
  // there are no usable tokens (too short in this case). In that case, we have to do an inefficient
  // full-database scan, which I believe is an acceptable tradeoff for not having to have an extra
  // index on shortcodes.

  if (!emojis.length) {
    const predicate = _ => ((_.shortcodes || []).includes(shortcode.toLowerCase()));
    return (await doFullDatabaseScanForSingleResult(db, predicate)) || null
  }

  return emojis.filter(_ => {
    const lowerShortcodes = (_.shortcodes || []).map(_ => _.toLowerCase());
    return lowerShortcodes.includes(shortcode.toLowerCase())
  })[0] || null
}

async function getEmojiByUnicode (db, unicode) {
  return dbPromise(db, STORE_EMOJI, MODE_READONLY, (emojiStore, txn, cb) => (
    getIDB(emojiStore, unicode, result => {
      if (result) {
        return cb(result)
      }
      getIDB(emojiStore.index(INDEX_SKIN_UNICODE), unicode, result => cb(result || null));
    })
  ))
}

function get (db, storeName, key) {
  return dbPromise(db, storeName, MODE_READONLY, (store, txn, cb) => (
    getIDB(store, key, cb)
  ))
}

function set (db, storeName, key, value) {
  return dbPromise(db, storeName, MODE_READWRITE, (store, txn) => {
    store.put(value, key);
    commit(txn);
  })
}

function incrementFavoriteEmojiCount (db, unicode) {
  return dbPromise(db, STORE_FAVORITES, MODE_READWRITE, (store, txn) => (
    getIDB(store, unicode, result => {
      store.put((result || 0) + 1, unicode);
      commit(txn);
    })
  ))
}

function getTopFavoriteEmoji (db, customEmojiIndex, limit) {
  if (limit === 0) {
    return []
  }
  return dbPromise(db, [STORE_FAVORITES, STORE_EMOJI], MODE_READONLY, ([favoritesStore, emojiStore], txn, cb) => {
    const results = [];
    favoritesStore.index(INDEX_COUNT).openCursor(undefined, 'prev').onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { // no more results
        return cb(results)
      }

      function addResult (result) {
        results.push(result);
        if (results.length === limit) {
          return cb(results) // done, reached the limit
        }
        cursor.continue();
      }

      const unicodeOrName = cursor.primaryKey;
      const custom = customEmojiIndex.byName(unicodeOrName);
      if (custom) {
        return addResult(custom)
      }
      // This could be done in parallel (i.e. make the cursor and the get()s parallelized),
      // but my testing suggests it's not actually faster.
      getIDB(emojiStore, unicodeOrName, emoji => {
        if (emoji) {
          return addResult(emoji)
        }
        // emoji not found somehow, ignore (may happen if custom emoji change)
        cursor.continue();
      });
    };
  })
}

// trie data structure for prefix searches
// loosely based on https://github.com/nolanlawson/substring-trie

const CODA_MARKER = ''; // marks the end of the string

function trie (arr, itemToTokens) {
  const map = new Map();
  for (const item of arr) {
    const tokens = itemToTokens(item);
    for (const token of tokens) {
      let currentMap = map;
      for (let i = 0; i < token.length; i++) {
        const char = token.charAt(i);
        let nextMap = currentMap.get(char);
        if (!nextMap) {
          nextMap = new Map();
          currentMap.set(char, nextMap);
        }
        currentMap = nextMap;
      }
      let valuesAtCoda = currentMap.get(CODA_MARKER);
      if (!valuesAtCoda) {
        valuesAtCoda = [];
        currentMap.set(CODA_MARKER, valuesAtCoda);
      }
      valuesAtCoda.push(item);
    }
  }

  const search = (query, exact) => {
    let currentMap = map;
    for (let i = 0; i < query.length; i++) {
      const char = query.charAt(i);
      const nextMap = currentMap.get(char);
      if (nextMap) {
        currentMap = nextMap;
      } else {
        return []
      }
    }

    if (exact) {
      const results = currentMap.get(CODA_MARKER);
      return results || []
    }

    const results = [];
    // traverse
    const queue = [currentMap];
    while (queue.length) {
      const currentMap = queue.shift();
      const entriesSortedByKey = [...currentMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
      for (const [key, value] of entriesSortedByKey) {
        if (key === CODA_MARKER) { // CODA_MARKER always comes first; it's the empty string
          results.push(...value);
        } else {
          queue.push(value);
        }
      }
    }
    return results
  };

  return search
}

const requiredKeys$1 = [
  'name',
  'url'
];

function assertCustomEmojis (customEmojis) {
  const isArray = customEmojis && Array.isArray(customEmojis);
  const firstItemIsFaulty = isArray &&
    customEmojis.length &&
    (!customEmojis[0] || requiredKeys$1.some(key => !(key in customEmojis[0])));
  if (!isArray || firstItemIsFaulty) {
    throw new Error('Custom emojis are in the wrong format')
  }
}

function customEmojiIndex (customEmojis) {
  assertCustomEmojis(customEmojis);

  const sortByName = (a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;

  //
  // all()
  //
  const all = customEmojis.sort(sortByName);

  //
  // search()
  //
  const emojiToTokens = emoji => {
    const set = new Set();
    if (emoji.shortcodes) {
      for (const shortcode of emoji.shortcodes) {
        for (const token of extractTokens(shortcode)) {
          set.add(token);
        }
      }
    }
    return set
  };
  const searchTrie = trie(customEmojis, emojiToTokens);
  const searchByExactMatch = _ => searchTrie(_, true);
  const searchByPrefix = _ => searchTrie(_, false);

  // Search by query for custom emoji. Similar to how we do this in IDB, the last token
  // is treated as a prefix search, but every other one is treated as an exact match.
  // Then we AND the results together
  const search = query => {
    const tokens = extractTokens(query);
    const intermediateResults = tokens.map((token, i) => (
      (i < tokens.length - 1 ? searchByExactMatch : searchByPrefix)(token)
    ));
    return findCommonMembers(intermediateResults, _ => _.name).sort(sortByName)
  };

  //
  // byShortcode, byName
  //
  const shortcodeToEmoji = new Map();
  const nameToEmoji = new Map();
  for (const customEmoji of customEmojis) {
    nameToEmoji.set(customEmoji.name.toLowerCase(), customEmoji);
    for (const shortcode of (customEmoji.shortcodes || [])) {
      shortcodeToEmoji.set(shortcode.toLowerCase(), customEmoji);
    }
  }

  const byShortcode = shortcode => shortcodeToEmoji.get(shortcode.toLowerCase());
  const byName = name => nameToEmoji.get(name.toLowerCase());

  return {
    all,
    search,
    byShortcode,
    byName
  }
}

const isFirefoxContentScript = typeof wrappedJSObject !== 'undefined';

// remove some internal implementation details, i.e. the "tokens" array on the emoji object
// essentially, convert the emoji from the version stored in IDB to the version used in-memory
function cleanEmoji (emoji) {
  if (!emoji) {
    return emoji
  }
  // if inside a Firefox content script, need to clone the emoji object to prevent Firefox from complaining about
  // cross-origin object. See: https://github.com/nolanlawson/emoji-picker-element/issues/356
  /* istanbul ignore if */
  if (isFirefoxContentScript) {
    emoji = structuredClone(emoji);
  }
  delete emoji.tokens;
  if (emoji.skinTones) {
    const len = emoji.skinTones.length;
    emoji.skins = Array(len);
    for (let i = 0; i < len; i++) {
      emoji.skins[i] = {
        tone: emoji.skinTones[i],
        unicode: emoji.skinUnicodes[i],
        version: emoji.skinVersions[i]
      };
    }
    delete emoji.skinTones;
    delete emoji.skinUnicodes;
    delete emoji.skinVersions;
  }
  return emoji
}

function warnETag (eTag) {
  if (!eTag) {
    console.warn('emoji-picker-element is more efficient if the dataSource server exposes an ETag header.');
  }
}

const requiredKeys = [
  'annotation',
  'emoji',
  'group',
  'order',
  'version'
];

function assertEmojiData (emojiData) {
  if (!emojiData ||
    !Array.isArray(emojiData) ||
    !emojiData[0] ||
    (typeof emojiData[0] !== 'object') ||
    requiredKeys.some(key => (!(key in emojiData[0])))) {
    throw new Error('Emoji data is in the wrong format')
  }
}

function assertStatus (response, dataSource) {
  if (Math.floor(response.status / 100) !== 2) {
    throw new Error('Failed to fetch: ' + dataSource + ':  ' + response.status)
  }
}

async function getETag (dataSource) {
  const response = await fetch(dataSource, { method: 'HEAD' });
  assertStatus(response, dataSource);
  const eTag = response.headers.get('etag');
  warnETag(eTag);
  return eTag
}

async function getETagAndData (dataSource) {
  const response = await fetch(dataSource);
  assertStatus(response, dataSource);
  const eTag = response.headers.get('etag');
  warnETag(eTag);
  const emojiData = await response.json();
  assertEmojiData(emojiData);
  return [eTag, emojiData]
}

// TODO: including these in blob-util.ts causes typedoc to generate docs for them,
// even with --excludePrivate ¯\_(ツ)_/¯
/** @private */
/**
 * Convert an `ArrayBuffer` to a binary string.
 *
 * Example:
 *
 * ```js
 * var myString = blobUtil.arrayBufferToBinaryString(arrayBuff)
 * ```
 *
 * @param buffer - array buffer
 * @returns binary string
 */
function arrayBufferToBinaryString(buffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var length = bytes.byteLength;
    var i = -1;
    while (++i < length) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
}
/**
 * Convert a binary string to an `ArrayBuffer`.
 *
 * ```js
 * var myBuffer = blobUtil.binaryStringToArrayBuffer(binaryString)
 * ```
 *
 * @param binary - binary string
 * @returns array buffer
 */
function binaryStringToArrayBuffer(binary) {
    var length = binary.length;
    var buf = new ArrayBuffer(length);
    var arr = new Uint8Array(buf);
    var i = -1;
    while (++i < length) {
        arr[i] = binary.charCodeAt(i);
    }
    return buf;
}

// generate a checksum based on the stringified JSON
async function jsonChecksum (object) {
  const inString = JSON.stringify(object);
  let inBuffer = binaryStringToArrayBuffer(inString);

  // this does not need to be cryptographically secure, SHA-1 is fine
  const outBuffer = await crypto.subtle.digest('SHA-1', inBuffer);
  const outBinString = arrayBufferToBinaryString(outBuffer);
  const res = btoa(outBinString);
  return res
}

async function doCheckForUpdates (db, dataSource) {
  // just do a simple HEAD request first to see if the eTags match
  let emojiData;
  let eTag = await getETag(dataSource);
  if (!eTag) { // work around lack of ETag/Access-Control-Expose-Headers
    const eTagAndData = await getETagAndData(dataSource);
    eTag = eTagAndData[0];
    emojiData = eTagAndData[1];
    if (!eTag) {
      eTag = await jsonChecksum(emojiData);
    }
  }
  if (await hasData(db, dataSource, eTag)) ; else {
    if (!emojiData) {
      const eTagAndData = await getETagAndData(dataSource);
      emojiData = eTagAndData[1];
    }
    await loadData(db, emojiData, dataSource, eTag);
  }
}

async function loadDataForFirstTime (db, dataSource) {
  let [eTag, emojiData] = await getETagAndData(dataSource);
  if (!eTag) {
    // Handle lack of support for ETag or Access-Control-Expose-Headers
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers#Browser_compatibility
    eTag = await jsonChecksum(emojiData);
  }

  await loadData(db, emojiData, dataSource, eTag);
}

async function checkForUpdates (db, dataSource) {
  try {
    await doCheckForUpdates(db, dataSource);
  } catch (err) {
    // Checking for updates is not a critical operation, and it can fail if e.g. the picker is quickly removed and
    // re-added to the DOM. In those cases, we may get an IndexedDB InvalidStateError because we are attempting to close
    // the database connection, possibly while another request is inflight. So there's effectively no way to prevent
    // InvalidStateErrors unless we were to carefully sequence our IndexedDB operations. Much more simply, we can just
    // ignore IndexedDB InvalidStateErrors here and give users one less useless error message in their console.
    if (err.name !== 'InvalidStateError') {
      throw err
    }
  }
}

class Database {
  constructor ({ dataSource, locale = DEFAULT_LOCALE, customEmoji = [] } = {}) {
    // No default data source: the data is always served with the site, never from a CDN.
    assertNonEmptyString(dataSource);
    this.dataSource = dataSource;
    this.locale = locale;
    this._dbName = `emoji-picker-element-${this.locale}`;
    this._db = undefined;
    this._lazyUpdate = undefined;
    this._custom = customEmojiIndex(customEmoji);

    this._clear = this._clear.bind(this);
    this._ready = this._init();
  }

  async _init () {
    const db = this._db = await openDatabase(this._dbName);

    addOnCloseListener(this._dbName, this._clear);
    const dataSource = this.dataSource;
    const empty = await isEmpty(db);

    if (empty) {
      await loadDataForFirstTime(db, dataSource);
    } else { // offline-first - do an update asynchronously
      this._lazyUpdate = checkForUpdates(db, dataSource);
    }
  }

  async ready () {
    const checkReady = async () => {
      if (!this._ready) {
        this._ready = this._init();
      }
      return this._ready
    };
    await checkReady();
    // There's a possibility of a race condition where the element gets added, removed, and then added again
    // with a particular timing, which would set the _db to undefined.
    // We *could* do a while loop here, but that seems excessive and could lead to an infinite loop.
    if (!this._db) {
      await checkReady();
    }
  }

  async getEmojiByGroup (group) {
    assertNumber(group);
    await this.ready();
    return uniqEmoji(await getEmojiByGroup(this._db, group)).map(cleanEmoji)
  }

  async getEmojiBySearchQuery (query) {
    assertNonEmptyString(query);
    await this.ready();
    const customs = this._custom.search(query);
    const natives = uniqEmoji(await getEmojiBySearchQuery(this._db, query)).map(cleanEmoji);
    return [
      ...customs,
      ...natives
    ]
  }

  async getEmojiByShortcode (shortcode) {
    assertNonEmptyString(shortcode);
    await this.ready();
    const custom = this._custom.byShortcode(shortcode);
    if (custom) {
      return custom
    }
    return cleanEmoji(await getEmojiByShortcode(this._db, shortcode))
  }

  async getEmojiByUnicodeOrName (unicodeOrName) {
    assertNonEmptyString(unicodeOrName);
    await this.ready();
    const custom = this._custom.byName(unicodeOrName);
    if (custom) {
      return custom
    }
    return cleanEmoji(await getEmojiByUnicode(this._db, unicodeOrName))
  }

  async getPreferredSkinTone () {
    await this.ready();
    return (await get(this._db, STORE_KEYVALUE, KEY_PREFERRED_SKINTONE)) || 0
  }

  async setPreferredSkinTone (skinTone) {
    assertNumber(skinTone);
    await this.ready();
    return set(this._db, STORE_KEYVALUE, KEY_PREFERRED_SKINTONE, skinTone)
  }

  async incrementFavoriteEmojiCount (unicodeOrName) {
    assertNonEmptyString(unicodeOrName);
    await this.ready();
    return incrementFavoriteEmojiCount(this._db, unicodeOrName)
  }

  async getTopFavoriteEmoji (limit) {
    assertNumber(limit);
    await this.ready();
    return (await getTopFavoriteEmoji(this._db, this._custom, limit)).map(cleanEmoji)
  }

  set customEmoji (customEmojis) {
    this._custom = customEmojiIndex(customEmojis);
  }

  get customEmoji () {
    return this._custom.all
  }

  async _shutdown () {
    await this.ready(); // reopen if we've already been closed/deleted
    try {
      await this._lazyUpdate; // allow any lazy updates to process before closing/deleting
    } catch (err) { /* ignore network errors (offline-first) */ }
  }

  // clear references to IDB, e.g. during a close event
  _clear () {
    // We don't need to call removeEventListener or remove the manual "close" listeners.
    // The memory leak tests prove this is unnecessary. It's because:
    // 1) IDBDatabases that can no longer fire "close" automatically have listeners GCed
    // 2) we clear the manual close listeners in databaseLifecycle.js.
    this._db = this._ready = this._lazyUpdate = undefined;
  }

  async close () {
    await this._shutdown();
    await closeDatabase(this._dbName);
  }

  async delete () {
    await this._shutdown();
    await deleteDatabase(this._dbName);
  }
}

export { Database as default };
