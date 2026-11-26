import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { t } from '../lib/i18n';
import { dispatchRequest, requestErrorMessage } from '../lib/request';
import { fitHeight, needsAutosize } from '../lib/autosize';
import { baseStyles } from './tokens';
import { fieldStyles } from './fields';
import { defineOnce } from './define';
import './threads-button';

/**
 * The single text-entry box: new thread, anchored thread, reply, new comment, edit.
 *
 * Attributes: `value`, `label` (the text box's accessible name; required), `placeholder`,
 * `submit-label` (default "Submit"), `busy`, `quote` (a small quote line above the box),
 * `autofocus` (property, default true: focus the box when the editor first renders).
 * Events: `threads-submit` `{ body, waitUntil }` (a request event: the editor is busy until the
 * promise settles and shows its error in the error line when it rejects) and `threads-cancel`.
 * Cmd/Ctrl+Enter submits, Esc cancels. Parts: `base`, `quote`, `textarea`, `hint`, `error`,
 * `actions`, `cancel`, `submit`. It is not a form participant: read values from `threads-submit`.
 */
export class ThreadsEditor extends LitElement {
  static override styles = [baseStyles, fieldStyles, css`
    :host { display: block; }
    .editor {
      border: 1px solid var(--_border);
      border-radius: var(--_radius-lg);
      overflow: hidden;
      background: var(--_surface);
      box-shadow: var(--_shadow);
    }
    .quote {
      margin: 12px 12px 0;
      padding: 2px 8px;
      border-left: 3px solid var(--_border-strong);
      color: var(--_fg-muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body { padding: 12px; }
    textarea.field {
      display: block;
      min-height: 4.6em;
      max-height: 320px;
      font-size: var(--_font-size);
      field-sizing: content;
    }
    .error { margin: 8px 0 0; font-size: 12px; color: var(--_danger); }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--_border);
      background: var(--_surface-muted);
    }
    .hint { font-size: 12px; color: var(--_fg-muted); }
    .actions { display: flex; gap: 6px; }
  `];

  @property() value = '';
  @property() label = '';
  @property() placeholder = '';
  @property({ attribute: 'submit-label' }) submitLabel = '';
  @property({ type: Boolean, reflect: true }) busy = false;
  @property() quote = '';
  @property({ type: Boolean }) override autofocus = true;

  /** Busy because a `threads-submit` listener's promise is pending. */
  @state() private pending = false;
  @state() private error = '';

  private focused = false;
  private refocus = false;
  private readonly autosize = needsAutosize(typeof CSS !== 'undefined' && CSS.supports ? CSS.supports.bind(CSS) : undefined);

  private get isBusy(): boolean {
    return this.busy || this.pending;
  }

  private get textarea(): HTMLTextAreaElement | null {
    return this.renderRoot.querySelector('textarea');
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The app re-inserts the same element after a reload: give the box its focus back.
    if (this.refocus) {
      this.refocus = false;
      void this.updateComplete.then(() => this.textarea?.focus({ preventScroll: true }));
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.refocus = this.focused;
  }

  override firstUpdated(): void {
    if (this.autofocus) this.textarea?.focus();
    this.fit();
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('value')) this.fit();
  }

  /** The script fallback for browsers without `field-sizing: content`. */
  private fit(): void {
    const ta = this.textarea;
    if (!ta || !this.autosize) return;
    ta.style.height = 'auto';
    const cs = getComputedStyle(ta);
    const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const { height, overflowY } = fitHeight(ta.scrollHeight, borders);
    ta.style.height = `${height}px`;
    ta.style.overflowY = overflowY;
  }

  private onInput(e: Event): void {
    this.value = (e.target as HTMLTextAreaElement).value;
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!e.isComposing) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    }
    // docmd's page-wide shortcuts (Alt+F, Esc) judge "typing" by the event target's tag, which outside
    // the shadow root is this element, not a TEXTAREA: keep keystrokes in here.
    e.stopPropagation();
  }

  private async submit(): Promise<void> {
    // Read the box itself, so text set by a script or a test's fill() counts even before an input event.
    const body = (this.textarea?.value ?? this.value).trim();
    if (!body || this.isBusy) return;
    this.value = body;
    this.error = '';
    const request = dispatchRequest(this, 'threads-submit', { body });
    if (!request) return;
    this.pending = true;
    try {
      await request;
      this.value = '';
    } catch (err) {
      this.error = requestErrorMessage(err);
    } finally {
      this.pending = false;
    }
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('threads-cancel', { bubbles: true, composed: true, detail: {} }));
  }

  override render() {
    const busy = this.isBusy;
    return html`
      <div class="editor" part="base">
        ${this.quote ? html`<div class="quote" part="quote">${this.quote}</div>` : nothing}
        <div class="body">
          <textarea
            class="field"
            part="textarea"
            rows="3"
            aria-label=${this.label || nothing}
            placeholder=${this.placeholder || nothing}
            ?readonly=${busy}
            .value=${this.value}
            @input=${this.onInput}
            @keydown=${this.onKeydown}
            @focus=${() => { this.focused = true; }}
            @blur=${() => { if (this.isConnected) this.focused = false; }}
          ></textarea>
          ${this.error ? html`<p class="error" part="error" role="alert" data-testid="editor-message">${this.error}</p>` : nothing}
        </div>
        <div class="footer">
          <span class="hint" part="hint">${t('cmdEnterSubmit')}</span>
          <div class="actions" part="actions">
            <threads-button part="cancel" @click=${() => this.cancel()}>${t('cancel')}</threads-button>
            <threads-button part="submit" variant="primary" ?disabled=${!this.value.trim() || busy}
              @click=${() => void this.submit()}>${busy ? t('saving') : this.submitLabel || t('submit')}</threads-button>
          </div>
        </div>
      </div>
    `;
  }
}

defineOnce('threads-editor', ThreadsEditor);

declare global {
  interface HTMLElementTagNameMap {
    'threads-editor': ThreadsEditor;
  }
}
