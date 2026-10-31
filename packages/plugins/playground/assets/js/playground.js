/**
 * docmd Playground Plugin Runtime
 * Lightweight client-side code runner with live preview & console interception.
 */

(function () {
  'use strict';

  function formatValue(val) {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${val}"`;
    if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
    if (val instanceof Error) return `${val.name}: ${val.message}\n${val.stack || ''}`;
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return Object.prototype.toString.call(val);
      }
    }
    return String(val);
  }

  function getTimeString() {
    const d = new Date();
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  class PlaygroundInstance {
    constructor(container) {
      this.container = container;
      this.lang = (container.getAttribute('data-lang') || 'js').toLowerCase();
      this.initialCode = container.querySelector('.docmd-playground-initial-code')?.textContent || '';
      this.editor = container.querySelector('.docmd-playground-editor');
      this.consoleEl = container.querySelector('.docmd-playground-console');
      this.previewEl = container.querySelector('.docmd-playground-preview');
      this.runBtn = container.querySelector('.docmd-playground-run-btn');
      this.resetBtn = container.querySelector('.docmd-playground-reset-btn');
      this.copyBtn = container.querySelector('.docmd-playground-copy-btn');
      this.clearBtn = container.querySelector('.docmd-playground-clear-btn');
      this.tabButtons = container.querySelectorAll('.docmd-playground-tab');
      this.panels = container.querySelectorAll('.docmd-playground-tab-panel');
      this.viewTabs = container.querySelectorAll('.docmd-playground-view-tab');
      this.hasRun = false;

      this.init();
    }

    init() {
      if (this.editor && !this.editor.value) {
        this.editor.value = this.initialCode.trim();
      }

      this.bindEditorEvents();
      this.bindActions();
      this.bindTabs();
      this.bindViewTabs();

      // Show empty console hint initially
      this.renderEmptyConsole();

      // Auto-run if data-live="true" or data-autorun="true"
      if (this.container.getAttribute('data-live') === 'true' || this.container.getAttribute('data-autorun') === 'true') {
        this.run();
      }
    }

    bindEditorEvents() {
      if (!this.editor) return;

      // Handle Tab key indentation
      this.editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = this.editor.selectionStart;
          const end = this.editor.selectionEnd;
          const val = this.editor.value;
          this.editor.value = val.substring(0, start) + '  ' + val.substring(end);
          this.editor.selectionStart = this.editor.selectionEnd = start + 2;
        }

        // Cmd+Enter or Ctrl+Enter to run
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          this.run();
        }
      });
    }

    bindActions() {
      if (this.runBtn) {
        this.runBtn.addEventListener('click', () => this.run());
      }
      if (this.resetBtn) {
        this.resetBtn.addEventListener('click', () => this.reset());
      }
      if (this.copyBtn) {
        this.copyBtn.addEventListener('click', () => this.copy());
      }
      if (this.clearBtn) {
        this.clearBtn.addEventListener('click', () => this.clearConsole());
      }
    }

    bindTabs() {
      this.tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetTab = btn.getAttribute('data-tab');
          this.switchTab(targetTab);
        });
      });
    }

    bindViewTabs() {
      this.viewTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const view = tab.getAttribute('data-view');
          this.switchView(view);
        });
      });
    }

    switchView(viewName) {
      this.container.setAttribute('data-active-view', viewName);
      this.viewTabs.forEach((t) => {
        t.classList.toggle('active', t.getAttribute('data-view') === viewName);
      });
      if (viewName === 'live') {
        if (!this.hasRun) {
          this.run();
        }
      }
    }

    switchTab(tabName) {
      this.tabButtons.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
      });
      this.panels.forEach((p) => {
        p.classList.toggle('active', p.getAttribute('data-panel') === tabName);
      });
    }

    renderEmptyConsole() {
      if (!this.consoleEl) return;
      this.consoleEl.innerHTML = '<div class="docmd-pg-log-empty">Console ready. Click "Run" or press ⌘↵ to execute.</div>';
    }

    clearConsole() {
      if (!this.consoleEl) return;
      this.renderEmptyConsole();
    }

    renderErrorNotice(errMsg) {
      if (!this.consoleEl) return;
      const existing = this.consoleEl.querySelector('.docmd-pg-error-notice');
      if (existing) existing.remove();

      const notice = document.createElement('div');
      notice.className = 'docmd-pg-error-notice';
      notice.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="docmd-pg-error-body">
          <div class="docmd-pg-error-title">Playground Execution Warning</div>
          <div class="docmd-pg-error-msg">${escapeHtml(errMsg)}</div>
        </div>
      `;
      this.consoleEl.prepend(notice);
    }

    appendLog(type, content) {
      if (!this.consoleEl) return;
      const emptyNotice = this.consoleEl.querySelector('.docmd-pg-log-empty');
      if (emptyNotice) emptyNotice.remove();

      const row = document.createElement('div');
      row.className = `docmd-pg-log-entry docmd-pg-log-${type}`;

      const time = document.createElement('span');
      time.className = 'docmd-pg-log-time';
      time.textContent = getTimeString();

      const msg = document.createElement('span');
      msg.className = 'docmd-pg-log-content';
      msg.textContent = content;

      row.appendChild(time);
      row.appendChild(msg);
      this.consoleEl.appendChild(row);
      this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    }

    async run() {
      this.hasRun = true;
      const code = this.editor ? this.editor.value : '';

      // If language is HTML or markup, render preview
      if (this.lang === 'html' || this.lang === 'xml' || this.lang === 'svg') {
        this.renderHtmlPreview(code);
        this.switchTab('preview');
        return;
      }

      // JavaScript / TypeScript execution
      this.clearConsole();
      this.switchTab('console');

      const customConsole = {
        log: (...args) => this.appendLog('info', args.map(formatValue).join(' ')),
        info: (...args) => this.appendLog('info', args.map(formatValue).join(' ')),
        warn: (...args) => this.appendLog('warn', args.map(formatValue).join(' ')),
        error: (...args) => this.appendLog('error', args.map(formatValue).join(' ')),
        table: (data) => this.appendLog('info', typeof data === 'object' ? JSON.stringify(data, null, 2) : formatValue(data)),
        clear: () => this.clearConsole()
      };

      try {
        // Strip simple TS type annotations if written in TS mode
        let cleanJs = code;
        if (this.lang === 'ts' || this.lang === 'typescript') {
          cleanJs = cleanJs
            .replace(/:\s*[A-Z][a-zA-Z0-9<>\[\]|&\s]*/g, '')
            .replace(/as\s+[A-Z][a-zA-Z0-9<>\[\]|&\s]*/g, '');
        }

        // Create async runner with scoped console and window.docmd access
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const runner = new AsyncFunction('console', 'docmd', cleanJs);

        const result = await runner(customConsole, window.docmd || {});
        if (result !== undefined) {
          this.appendLog('return', `=> ${formatValue(result)}`);
        }
      } catch (err) {
        const errMsg = err?.message || String(err);
        this.renderErrorNotice(errMsg);
        this.appendLog('error', `RuntimeError: ${errMsg}`);
        if (err?.stack) {
          const relevantStack = String(err.stack).split('\n').slice(0, 3).join('\n');
          this.appendLog('error', relevantStack);
        }
      }
    }

    renderHtmlPreview(html) {
      if (!this.previewEl) return;
      this.previewEl.innerHTML = '';

      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';

      this.previewEl.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>
                body {
                  margin: 0;
                  padding: 12px;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  color: #0f172a;
                  background: #ffffff;
                }
              </style>
            </head>
            <body>
              ${html}
            </body>
          </html>
        `);
        doc.close();
      }
    }

    reset() {
      if (this.editor) {
        this.editor.value = this.initialCode.trim();
      }
      this.clearConsole();
      if (this.previewEl) {
        this.previewEl.innerHTML = '';
      }
      if (this.container.getAttribute('data-live') === 'true') {
        this.run();
      }
    }

    async copy() {
      if (!this.editor) return;
      const code = this.editor.value;
      try {
        await navigator.clipboard.writeText(code);
        if (this.copyBtn) {
          const origHtml = this.copyBtn.innerHTML;
          this.copyBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          `;
          setTimeout(() => {
            if (this.copyBtn) this.copyBtn.innerHTML = origHtml;
          }, 1500);
        }
      } catch {
        // Fallback copy using textarea selection
        this.editor.select();
        document.execCommand('copy');
      }
    }
  }

  function initPlaygrounds() {
    const containers = document.querySelectorAll('.docmd-playground');
    containers.forEach((container) => {
      if (!container.__docmd_playground) {
        container.__docmd_playground = new PlaygroundInstance(container);
      }
    });
  }

  // Auto-init on initial DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlaygrounds);
  } else {
    initPlaygrounds();
  }

  // Re-hydrate on docmd SPA page navigation events
  document.addEventListener('docmd:page-mounted', initPlaygrounds);
  window.addEventListener('popstate', () => setTimeout(initPlaygrounds, 50));

  // Expose global API
  window.docmd = window.docmd || {};
  window.docmd.playground = {
    init: initPlaygrounds
  };
})();