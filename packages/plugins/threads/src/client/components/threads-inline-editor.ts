import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../lib/i18n';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

@customElement('threads-inline-editor')
export class ThreadsInlineEditor extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin: 16px 0;
    }
    .editor {
      border: 1px solid var(--tc-border, hsl(0 0% 89.8%));
      border-radius: var(--tc-radius, 6px);
      overflow: hidden;
      font-size: 14px;
      background: var(--tc-card, hsl(0 0% 100%));
      box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    }
    .editor-body {
      padding: 12px;
    }
    sl-textarea {
      width: 100%;
    }
    .editor-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      border-top: 1px solid var(--tc-border, hsl(0 0% 89.8%));
      background: var(--sl-color-neutral-50, hsl(0 0% 96.1%));
    }
    .hint {
      font-size: 12px;
      color: var(--tc-muted-fg, hsl(0 0% 45.1%));
    }
    .error {
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--sl-color-danger-700, inherit);
    }
    .actions {
      display: flex;
      gap: 6px;
    }
  `;

  @property({ type: String }) quote = '';
  /** A message shown under the text, e.g. why a submit was rejected; cleared on the next submit. */
  @property({ type: String }) message = '';
  @state() private value = '';
  @state() private submitting = false;

  private _innerTextarea: HTMLTextAreaElement | null = null;
  private _nativeInputListener = (e: Event) => {
    this.value = (e.target as HTMLTextAreaElement).value;
  };

  private _attachNativeListener(): void {
    const slTextarea = this.shadowRoot?.querySelector('sl-textarea');
    if (!slTextarea) return;
    const inner = (slTextarea as Element).shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | null;
    if (inner && inner !== this._innerTextarea) {
      if (this._innerTextarea) {
        this._innerTextarea.removeEventListener('input', this._nativeInputListener);
      }
      this._innerTextarea = inner;
      inner.addEventListener('input', this._nativeInputListener);
    }
  }

  override firstUpdated() {
    // Attach native input listener and focus after sl-textarea upgrades its internal DOM.
    requestAnimationFrame(() => {
      this._attachNativeListener();
      const inner = this._innerTextarea;
      if (inner) {
        inner.focus();
      } else {
        const slTextarea = this.shadowRoot?.querySelector('sl-textarea');
        (slTextarea as unknown as HTMLElement)?.focus();
      }
    });
  }

  override updated() {
    this._attachNativeListener();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this._innerTextarea) {
      this._innerTextarea.removeEventListener('input', this._nativeInputListener);
      this._innerTextarea = null;
    }
  }

  private handleInput(e: Event) {
    this.value = (e.target as any).value ?? '';
  }

  private getTextareaValue(): string {
    // Read from native textarea as source of truth (handles Playwright fill())
    if (this._innerTextarea) return this._innerTextarea.value;
    const slTextarea = this.shadowRoot?.querySelector('sl-textarea') as any;
    if (slTextarea?.value !== undefined) return String(slTextarea.value);
    return this.value;
  }

  private submit() {
    const body = this.getTextareaValue().trim();
    if (!body || this.submitting) return;
    this.value = body; // sync state
    this.message = '';
    this.submitting = true;
    this.dispatchEvent(new CustomEvent('inline-submit', {
      bubbles: true, composed: true,
      detail: { body },
    }));
  }

  private cancel() {
    this.dispatchEvent(new CustomEvent('inline-cancel', {
      bubbles: true, composed: true,
    }));
  }

  override render() {
    return html`
      <div class="editor">
        <div class="editor-body">
          <sl-textarea
            placeholder=${t('writeComment')}
            .value=${this.value}
            rows="3"
            resize="vertical"
            size="small"
            @sl-input=${this.handleInput}
            @input=${this.handleInput}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.submit();
              if (e.key === 'Escape') this.cancel();
            }}
          ></sl-textarea>
          ${this.message ? html`<p class="error" role="alert" data-testid="editor-message">${this.message}</p>` : null}
        </div>
        <div class="editor-footer">
          <span class="hint">${t('cmdEnterSubmit')}</span>
          <div class="actions">
            <sl-button size="small" variant="neutral" @click=${this.cancel}>${t('cancel')}</sl-button>
            <sl-button
              size="small"
              variant="primary"
              ?disabled=${!this.value.trim() || this.submitting}
              @click=${this.submit}
            >${this.submitting ? t('saving') : t('submit')}</sl-button>
          </div>
        </div>
      </div>
    `;
  }
}