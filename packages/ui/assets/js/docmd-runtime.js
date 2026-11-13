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

      // Seed with initial variables from compiler/template if injected
      if (typeof window !== 'undefined' && window.__DOCMD_VARIABLES__ && typeof window.__DOCMD_VARIABLES__ === 'object') {
        Object.assign(this._store, window.__DOCMD_VARIABLES__);
      }
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
     * Supports direct keys ("DOCMD_VERSION"), dot-notation ("docmd.version", "git.branch", "site.title"),
     * DOM-hydrated defaults, and system built-ins.
     */
    get(key) {
      if (!key || typeof key !== 'string') return undefined;

      // 1. Direct match in active store
      if (key in this._store && this._store[key] !== undefined) {
        return this._store[key];
      }

      // 2. Nested dot-notation lookup in store (e.g. "docmd.version", "git.branch", "site.title")
      const parts = key.split('.');
      if (parts.length > 1) {
        let current = this._store;
        let found = true;
        for (const part of parts) {
          if (current !== null && current !== undefined && typeof current === 'object' && part in current) {
            current = current[part];
          } else {
            found = false;
            break;
          }
        }
        if (found && current !== undefined) return current;
      }

      // 3. Fallback to defaults captured from DOM hydration
      if (key in this._defaults && this._defaults[key] !== undefined) {
        return this._defaults[key];
      }

      // 4. Built-in system fallbacks
      if (key === 'docmd.version' || key === 'DOCMD_VERSION' || key === 'version') {
        return this._runtime.version || '0.10.0';
      }
      if (key === 'docmd.buildYear' || key === 'BUILD_YEAR') {
        return String(new Date().getFullYear());
      }
      if (key === 'docmd') {
        return { version: this._runtime.version || '0.10.0', buildYear: String(new Date().getFullYear()) };
      }

      return undefined;
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

      // Recover any code block spans that were HTML-escaped during highlighting or markdown compilation
      const codeBlocks = container.querySelectorAll('pre, code');
      codeBlocks.forEach((block) => {
        if (block.innerHTML && block.innerHTML.includes('&lt;span data-docmd-var=')) {
          block.innerHTML = block.innerHTML.replace(
            /&lt;span data-docmd-var=&quot;([^&]+)&quot; class=&quot;docmd-var&quot;&gt;([\s\S]*?)&lt;\/span&gt;/g,
            '<span data-docmd-var="$1" class="docmd-var">$2</span>'
          );
        }
      });

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
      const injected = (typeof window !== 'undefined' && window.__DOCMD_VARIABLES__ && typeof window.__DOCMD_VARIABLES__ === 'object') ? window.__DOCMD_VARIABLES__ : {};
      this.version = injected.docmd?.version || injected.DOCMD_VERSION || '0.10.0';
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

      // Playground runtime bridge
      const existingPg = window.docmd?.playground || {};
      this.playground = {
        ...existingPg,
        init: () => window.docmd?.playground?.init?.(),
        run: (id) => window.docmd?.playground?.run?.(id),
        reset: (id) => window.docmd?.playground?.reset?.(id),
        getInstance: (id) => window.docmd?.playground?.getInstance?.(id)
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

      // 3. SPA router page-mounted re-hydration
      document.addEventListener('docmd:page-mounted', () => {
        this.var.hydrate();
      });
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