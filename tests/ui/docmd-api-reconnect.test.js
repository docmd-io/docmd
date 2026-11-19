import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FLAG = 'docmd:reloaded-after-disconnect';
let source;

before(() => {
  source = readFileSync(new URL('../../packages/ui/assets/js/docmd-api.js', import.meta.url), 'utf8');
});

// Fresh vm context per case. setTimeout only captures; tests run the callbacks.
function makeBridge(initialStorage = {}) {
  const store = new Map(Object.entries(initialStorage));
  const instances = [];
  const timers = [];
  const state = { reloads: 0 };

  class WebSocket {
    constructor() { this.readyState = 0; instances.push(this); }
    send() {}
  }
  const window = {
    location: { protocol: 'https:', host: 'example.test', reload() { state.reloads++; } },
    scrollY: 0,
    scrollTo() {},
  };
  const context = {
    window,
    WebSocket,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame() {},
    queueMicrotask() {},
    console: { log() {}, error() {} },
  };
  vm.runInNewContext(source, context);

  const last = () => instances[instances.length - 1];
  return {
    store, state, timers, instances,
    open() { last().onopen(); },
    start() { timers.shift().fn(); }, // the initial setTimeout(connect, 100)
  };
}

test('reloads once and sets the flag after a connected page loses the server', () => {
  const b = makeBridge();
  b.start();
  b.open();
  for (let i = 0; i < 5; i++) {
    b.instances[b.instances.length - 1].onclose();
    if (i < 4) b.timers.pop().fn();
  }
  assert.equal(b.state.reloads, 1);
  assert.equal(b.store.get(FLAG), '1');
});

test('never reloads when the socket never connected, and keeps the retry schedule', () => {
  const b = makeBridge();
  b.start();
  const delays = [];
  for (let i = 0; i < 5; i++) {
    b.instances[b.instances.length - 1].onclose();
    if (i < 4) { const t = b.timers.pop(); delays.push(t.ms); t.fn(); }
  }
  assert.equal(b.state.reloads, 0);
  assert.equal(b.timers.length, 0, 'gives up after maxRetries');
  assert.deepEqual(delays, [1500, 2250, 3375, 5000]);
});

test('onopen clears a stale flag', () => {
  const b = makeBridge({ [FLAG]: '1' });
  b.start();
  b.open();
  assert.equal(b.store.has(FLAG), false);
});

test('flag present and no onopen since: five closes do not reload again', () => {
  const b = makeBridge();
  b.start();
  b.open(); // connected once...
  b.store.set(FLAG, '1'); // ...a reload already happened and the server stayed dead
  for (let i = 0; i < 5; i++) {
    b.instances[b.instances.length - 1].onclose();
    if (i < 4) b.timers.pop().fn();
  }
  assert.equal(b.state.reloads, 0);
});
