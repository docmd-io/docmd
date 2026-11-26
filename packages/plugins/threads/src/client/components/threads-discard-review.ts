import { LitElement, html, css, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { defineOnce } from './define';
import * as api from '../lib/api';
import { createDiscardController } from '../lib/discard-controller';
import { t } from '../lib/i18n';
import { baseStyles } from './tokens';
import './threads-button';
import './threads-dialog';

/**
 * A Discard button for one review, behind a confirmation dialog. It knows only the review id and
 * its texts; after a success it dispatches `reviews-changed` (bubbles, composed, cancelable), and
 * a host that refreshes as a result cancels it. It also dispatches `discard-dialog-change`
 * (`detail: { open, outcome }`, outcome `kept`, `discarded` or `failed`) when the confirmation opens and closes.
 */
export class ThreadsDiscardReview extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .error { color: var(--_danger); font-size: 12px; }
  `];

  @property({ attribute: false }) reviewId = '';
  /** The button's text. */
  @property({ attribute: false }) label = '';
  /** The dialog's question. */
  @property({ attribute: false }) confirmText = '';

  private controller = createDiscardController({
    api,
    t,
    onChange: () => this.requestUpdate(),
    onOpenChange: (open, outcome) => {
      this.dispatchEvent(new CustomEvent('discard-dialog-change', { bubbles: true, composed: true, detail: { open, outcome } }));
    },
    onDone: () => {
      this.dispatchEvent(new CustomEvent('reviews-changed', { bubbles: true, composed: true, cancelable: true }));
    },
  });

  override render() {
    const state = this.controller.state();
    const error = this.controller.error();
    return html`
      <threads-button variant="danger" data-testid="discard-open" @click=${() => this.controller.ask(this.reviewId)}>${this.label}</threads-button>
      ${error ? html`<div class="error" part="error" data-testid="discard-error">${error}</div>` : nothing}
      <threads-dialog
        data-testid="discard-dialog"
        tone="danger"
        heading=${this.label}
        confirm-label=${this.label}
        cancel-label=${t('cancel')}
        cancel-testid="discard-cancel"
        confirm-testid="discard-confirm"
        .open=${state !== 'closed'}
        .busy=${state === 'discarding'}
        @threads-confirm=${(e: CustomEvent<{ waitUntil(p: Promise<unknown>): void }>) => e.detail.waitUntil(this.controller.confirm())}
        @threads-close=${(e: CustomEvent<{ reason: string }>) => { if (e.detail.reason !== 'confirmed') this.controller.cancel(); }}
      >${this.confirmText}</threads-dialog>
    `;
  }
}

defineOnce('threads-discard-review', ThreadsDiscardReview);
