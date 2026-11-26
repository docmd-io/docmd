import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { dispatchRequest, requestErrorMessage } from '../lib/request';
import { t } from '../lib/i18n';
import { baseStyles, errorStyles } from './tokens';
import { defineOnce } from './define';
import './threads-button';

export type DialogCloseReason = 'cancel' | 'escape' | 'backdrop' | 'confirmed';

/** The focused element, looking through shadow roots, so focus can return to it after the dialog. */
function deepActiveElement(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement ? el : null;
}

/**
 * The one confirm dialog, on the native `<dialog>` (top layer, focus trap, Esc, inert background).
 *
 * Attributes: `open`, `heading`, `confirm-label`, `cancel-label`, `tone` (neutral or danger), `busy`.
 * `confirm-testid` and `cancel-testid` put a `data-testid` on those two buttons, for tests.
 * Slot: default (the message). Parts: `dialog`, `heading`, `body`, `footer`, `cancel`, `confirm`, `error`.
 * Events: `threads-confirm` `{ waitUntil }` (the dialog closes when the promise resolves; when it
 * rejects the dialog stays open and shows the error) and `threads-close` `{ reason }`.
 * With no listener calling `waitUntil`, a confirm closes the dialog at once.
 */
export class ThreadsDialog extends LitElement {
  static override styles = [baseStyles, errorStyles, css`
    :host { display: block; }
    dialog {
      box-sizing: border-box;
      width: min(420px, calc(100vw - 32px));
      max-width: none;
      padding: 0;
      border: 1px solid var(--_border);
      border-radius: var(--_radius-lg);
      background: var(--_surface-raised);
      color: var(--_fg);
      font: inherit;
      box-shadow: var(--_shadow-lg);
    }
    /* A literal colour: custom properties do not reach ::backdrop in Chrome before 122. */
    dialog::backdrop { background: rgb(0 0 0 / 0.4); }
    .panel { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .heading { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.3; color: var(--_fg-strong); }
    .body { font-size: var(--_font-size); line-height: var(--_line-height); }
    .footer { display: flex; justify-content: flex-end; gap: 8px; }
  `];

  @property({ type: Boolean, reflect: true }) open = false;
  @property() heading = '';
  @property({ attribute: 'confirm-label' }) confirmLabel = '';
  @property({ attribute: 'cancel-label' }) cancelLabel = '';
  @property({ reflect: true }) tone: 'neutral' | 'danger' = 'neutral';
  @property({ type: Boolean }) busy = false;
  @property({ attribute: 'confirm-testid' }) confirmTestid = '';
  @property({ attribute: 'cancel-testid' }) cancelTestid = '';

  /** Busy because a `threads-confirm` listener's promise is pending. */
  @state() private pending = false;
  @state() private error = '';

  private opener: HTMLElement | null = null;

  private get isBusy(): boolean {
    return this.busy || this.pending;
  }

  private get nativeDialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('open')) return;
    const dialog = this.nativeDialog;
    if (!dialog) return;
    if (this.open && !dialog.open) {
      this.opener = deepActiveElement();
      this.error = '';
      dialog.showModal();
    } else if (!this.open && dialog.open) {
      dialog.close();
      this.restoreFocus();
    }
  }

  private restoreFocus(): void {
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  private dismiss(reason: DialogCloseReason): void {
    this.open = false;
    this.error = '';
    this.dispatchEvent(new CustomEvent('threads-close', { bubbles: true, composed: true, detail: { reason } }));
  }

  private onCancel(e: Event): void {
    // Esc: the native dialog would close itself, even while busy; the component decides.
    e.preventDefault();
    if (this.isBusy) return;
    this.dismiss('escape');
  }

  private onClick(e: MouseEvent): void {
    // The panel fills the dialog, so a click on the dialog element itself is a click on the backdrop.
    if (e.target === e.currentTarget && !this.isBusy) this.dismiss('backdrop');
  }

  private async confirm(): Promise<void> {
    if (this.isBusy) return;
    this.error = '';
    const request = dispatchRequest(this, 'threads-confirm', {});
    if (!request) {
      this.dismiss('confirmed');
      return;
    }
    this.pending = true;
    try {
      await request;
      this.dismiss('confirmed');
    } catch (err) {
      this.error = requestErrorMessage(err);
    } finally {
      this.pending = false;
    }
  }

  override render() {
    const busy = this.isBusy;
    return html`
      <dialog part="dialog" aria-labelledby="heading" @cancel=${this.onCancel} @click=${this.onClick}>
        <div class="panel">
          <h2 class="heading" id="heading" part="heading">${this.heading}</h2>
          <div class="body" part="body"><slot></slot></div>
          ${this.error ? html`<p class="error" part="error" role="alert">${this.error}</p>` : nothing}
          <div class="footer" part="footer">
            <threads-button part="cancel" ?disabled=${busy} data-testid=${this.cancelTestid || nothing}
              @click=${() => this.dismiss('cancel')}>${this.cancelLabel || t('cancel')}</threads-button>
            <threads-button part="confirm" variant=${this.tone === 'danger' ? 'danger' : 'primary'} ?busy=${busy}
              data-testid=${this.confirmTestid || nothing} @click=${() => void this.confirm()}>${this.confirmLabel || t('submit')}</threads-button>
          </div>
        </div>
      </dialog>
    `;
  }
}

defineOnce('threads-dialog', ThreadsDialog);

declare global {
  interface HTMLElementTagNameMap {
    'threads-dialog': ThreadsDialog;
  }
}
