/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025 docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * Browser API for docmd plugin communication.
 *
 * Provides docmd.call(), docmd.send(), docmd.on(), docmd.afterReload(),
 * and docmd.scheduleReload() over a WebSocket connection.
 * Injected automatically by the dev server.
 */

/* global WebSocket, sessionStorage, queueMicrotask */

(function() {
  if (typeof window === 'undefined') return;
  if (window.docmd && window.docmd.call) return; // already initialized

  const docmd = window.docmd || {};
  window.docmd = docmd;

  /**
   * Returns true if the WebSocket connection to the live dev server is currently active.
   */
  docmd.isLive = function() {
    return socket !== null && socket.readyState === 1;
  };

  /**
   * Ping the live dev server RPC bridge. Resolves true if connected and responsive.
   */
  docmd.ping = async function(timeoutMs = 2000) {
    if (!docmd.isLive()) return false;
    try {
      const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
      const res = await Promise.race([docmd.call('system:ping', {}), timer]);
      return !!(res && res.ok);
    } catch {
      return false;
    }
  };

  // Restore scroll position after reload
  const savedScroll = sessionStorage.getItem('docmd:scrollY');
  if (savedScroll) {
    sessionStorage.removeItem('docmd:scrollY');
    requestAnimationFrame(() => {
      window.scrollTo(0, parseInt(savedScroll, 10));
    });
  }

  let socket = null;
  let messageId = 0;
  const pendingCalls = new Map(); // id → { resolve, reject }
  const eventListeners = new Map(); // name → Set<callback>

  // retryCount lives outside connect() so it persists across reconnect calls.
  // This ensures maxRetries is actually enforced — previously it reset to 0
  // on every invocation, causing infinite reconnection loops on static servers.
  let retryCount = 0;
  const maxRetries = 5;

  function connect() {
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    if (retryCount >= maxRetries) return; // give up — not a dev server

    socket = new WebSocket('ws://' + window.location.host);

    socket.onopen = () => {
      console.log('⚡ docmd connected');
      retryCount = 0; // reset on successful connection
    };

    socket.onmessage = (e) => {
      if (e.data === 'reload') {
        sessionStorage.setItem('docmd:scrollY', String(window.scrollY));
        window.location.reload();
        return;
      }
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'response' && msg.id) {
        const pending = pendingCalls.get(msg.id);
        if (pending) {
          pendingCalls.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve({ result: msg.result, reload: msg.reload });
          }
        }
      } else if (msg.type === 'event' && msg.name) {
        const listeners = eventListeners.get(msg.name);
        if (listeners) {
          listeners.forEach(cb => { try { cb(msg.data); } catch (e) { console.error(e); } });
        }
      }
    };

    // Suppress the browser's default connection-refused error in the console.
    socket.onerror = () => { /* handled via onclose */ };

    socket.onclose = () => {
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(connect, Math.min(1000 * (1.5 ** retryCount), 5000));
      }
      // No log on final failure — this is expected when serving a static build.
    };
  }

  function waitForConnection() {
    if (socket && socket.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('docmd: WebSocket connection timeout')), 5000);
      function check() {
        if (socket && socket.readyState === 1) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      }
      check();
    });
  }

  /**
   * Call a server-side action and return the result.
   * If the action modifies files, the page reloads automatically after
   * the promise resolves and the current microtask completes.
   */
  docmd.call = async function(action, payload) {
    await waitForConnection();
    return new Promise((resolve, reject) => {
      const id = String(++messageId);
      pendingCalls.set(id, {
        resolve: ({ result, reload }) => {
          resolve(result);
          if (reload) {
            sessionStorage.setItem('docmd:scrollY', String(window.scrollY));
            queueMicrotask(() => window.location.reload());
          }
        },
        reject
      });
      socket.send(JSON.stringify({ id, type: 'call', action, payload }));
    });
  };

  /**
   * Send a fire-and-forget event to the server.
   */
  docmd.send = async function(name, data) {
    await waitForConnection();
    socket.send(JSON.stringify({ type: 'event', name, data }));
  };

  /**
   * Subscribe to server-pushed events. Returns an unsubscribe function.
   */
  docmd.on = function(name, callback) {
    if (!eventListeners.has(name)) eventListeners.set(name, new Set());
    eventListeners.get(name).add(callback);
    return () => eventListeners.get(name).delete(callback);
  };

  /**
   * Declare a named reload handler. Runs on every page load.
   * If sessionStorage has stashed context for this name, calls the
   * callback immediately with that context and clears the stash.
   */
  docmd.afterReload = function(name, callback) {
    const key = 'docmd:reload:' + name;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      sessionStorage.removeItem(key);
      try {
        const context = JSON.parse(raw);
        callback(context);
      } catch (e) {
        console.error('docmd.afterReload[' + name + '] error:', e);
      }
    }
  };

  /**
   * Stash context for a named reload handler. The matching afterReload
   * handler will fire with this context after the next page reload.
   */
  docmd.scheduleReload = function(name, context) {
    const key = 'docmd:reload:' + name;
    sessionStorage.setItem(key, JSON.stringify(context || {}));
  };

  // Connect
  setTimeout(connect, 100);
})();