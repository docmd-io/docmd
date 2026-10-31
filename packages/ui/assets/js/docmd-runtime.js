/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/ui (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 *
 * docmd-runtime.js — Core Client Runtime Engine & Global SDK.
 * Powers dynamic variables, cross-window session sync, reactive DOM hydration,
 * and unified client APIs.
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // Event bus implementation
  class DocmdEventEmitter {
    constructor() {
      this._listeners = new Map();
    }

    on(event, handler) {
      if (typeof handler !== 'function') return;
      if (!this._listeners.has(event)) {
        this._listeners.set(event, new Set());
      }
      this._listeners.get(event).add(handler);
    }

    off(event, handler) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).delete(handler);
      }
    }

    emit(event, payload) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).forEach((fn) => {
          try {
            fn(payload);
          } catch (err) {
            console.error(`[docmd-runtime] Error in listener for event "${event}":`, err);
          }
        });
      }
    }
  }

  // Variables Manager
  class DocmdVariablesManager {
    constructor(runtime) {
      this._runtime = runtime;
      this._store = {};
      this._defaults = {};
    }

    /**
     * Set a single variable or a batch of variables.
     * Updates all matching [data-docmd-var] elements in the DOM immediately.
     */
    set(keyOrMap, value) {
      const updates = {};
      if (typeof keyOrMap === 'string') {
        updates[keyOrMap] = value;
      } else if (typeof keyOrMap === 'object' && keyOrMap !== null) {
        Object.assign(updates, keyOrMap);
      }

      for (const [k, v] of Object.entries(updates)) {
        this._store[k] = v;
        this._updateDomElements(k, v);
        this._runtime.emit('var:change', { key: k, value: v });
      }

      return this;
    }

    /**
     * Get active variable value.
     */
    get(key) {
      return this._store[key];
    }

    /**
     * Get all active variables.
     */
    all() {
      return { ...this._store };
    }

    /**
     * Reset variables back to their build-time initial defaults.
     */
    reset() {
      for (const [k, defaultVal] of Object.entries(this._defaults)) {
        this._store[k] = defaultVal;
        this._updateDomElements(k, defaultVal);
      }
      this._runtime.emit('var:reset', { defaults: this.all() });
      return this;
    }

    /**
     * Scan DOM and hydrate all [data-docmd-var] elements.
     * Records initial text as default fallback and applies stored values.
     */
    hydrate(container = document) {
      if (!container || typeof container.querySelectorAll !== 'function') return;

      const elements = container.querySelectorAll('[data-docmd-var]');
      elements.forEach((el) => {
        const key = el.getAttribute('data-docmd-var');
        if (!key) return;

        // Record initial value as default if not yet recorded
        if (!(key in this._defaults)) {
          this._defaults[key] = el.textContent || '';
        }

        // If variable is already set in store, update element text
        if (key in this._store) {
          el.textContent = String(this._store[key]);
        }
      });
    }

    _updateDomElements(key, value) {
      if (typeof document === 'undefined') return;
      const elements = document.querySelectorAll(`[data-docmd-var="${key}"]`);
      elements.forEach((el) => {
        el.textContent = value !== undefined && value !== null ? String(value) : '';
      });
    }
  }

  // Theme Manager
  class DocmdThemeManager {
    constructor(runtime) {
      this._runtime = runtime;
    }

    get() {
      if (typeof document === 'undefined') return 'light';
      return document.documentElement.getAttribute('data-theme') || 'light';
    }

    set(theme) {
      if (typeof document === 'undefined') return;
      const cleanTheme = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cleanTheme);
      try {
        localStorage.setItem('docmd-theme', cleanTheme);
      } catch (_err) {
        /* ignore localStorage quota/permission errors */
      }
      this._runtime.emit('theme:change', cleanTheme);
    }

    toggle() {
      const current = this.get();
      const next = current === 'dark' ? 'light' : 'dark';
      this.set(next);
      return next;
    }
  }

  // Navigation Manager
  class DocmdNavManager {
    constructor(runtime) {
      this._runtime = runtime;
    }

    current() {
      if (typeof location === 'undefined') return { path: '/' };
      return {
        path: location.pathname,
        hash: location.hash,
        search: location.search,
        url: location.href
      };
    }

    go(url) {
      if (typeof window === 'undefined' || !url) return;
      // If SPA router is available in docmd-main, trigger it via link click or direct navigation
      const a = document.createElement('a');
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  // Main Runtime Class
  class DocmdRuntime extends DocmdEventEmitter {
    constructor() {
      super();
      this.version = '0.9.9';
      this.var = new DocmdVariablesManager(this);
      this.theme = new DocmdThemeManager(this);
      this.nav = new DocmdNavManager(this);

      // Top-level shortcuts
      this.set = (k, v) => this.var.set(k, v);
      this.get = (k) => this.var.get(k);

      // Cross-context synchronization helper
      this.sync = (targetOrData, maybeData) => {
        let target = null;
        let data = null;

        if (maybeData !== undefined) {
          target = targetOrData;
          data = maybeData;
        } else {
          data = targetOrData;
        }

        if (data && typeof data === 'object') {
          // If a specific target iframe or window is given
          if (target && target.contentWindow && typeof target.contentWindow.postMessage === 'function') {
            target.contentWindow.postMessage({ type: 'docmd:sync', variables: data }, '*');
          } else {
            // Apply to local store
            this.var.set(data);
            // Broadcast to any child docmd iframes
            if (typeof document !== 'undefined') {
              document.querySelectorAll('iframe').forEach((frame) => {
                try {
                  if (frame.contentWindow && typeof frame.contentWindow.postMessage === 'function') {
                    frame.contentWindow.postMessage({ type: 'docmd:sync', variables: data }, '*');
                  }
                } catch (_err) {
                  /* ignore cross-origin iframe security restrictions */
                }
              });
            }
          }
        }
      };

      this._initWindowListeners();
    }

    _initWindowListeners() {
      // 1. Cross-window / iframe postMessage listener
      window.addEventListener('message', (e) => {
        try {
          if (e.data && e.data.type === 'docmd:sync' && e.data.variables) {
            this.var.set(e.data.variables);
          }
        } catch (_err) {
          /* ignore invalid message data */
        }
      });

      // 2. DOMContentLoaded auto-hydration
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.var.hydrate());
      } else {
        this.var.hydrate();
      }
    }
  }

  // Export globally as window.docmd
  const runtime = new DocmdRuntime();
  window.docmd = runtime;

  // CommonJS / module support if imported
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = runtime;
  }
})();