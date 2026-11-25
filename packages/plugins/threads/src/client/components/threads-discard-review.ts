import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import * as api from '../lib/api';
import { createDiscardController } from '../lib/discard-controller';
import { t } from '../lib/i18n';
import { ensureButtonStyles } from './button-style';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

const STYLE_ID = 'tc-discard-review-styles';

const CSS = `
  threads-discard-review { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .tdr__error { color: var(--sl-color-danger-700, inherit); font-size: 12px; }
`;

/**
 * A Discard button for one review, behind a confirmation dialog. It knows only the review id and
 * its texts; after a success it dispatches `reviews-changed` (bubbles, composed, cancelable), and
 * a host that refreshes as a result cancels it. It also dispatches `discard-dialog-change`
 * (`detail: { open, outcome }`, outcome `kept`, `discarded` or `failed`) when the confirmation opens and closes.
 */
@customElement('threads-discard-review')
export class ThreadsDiscardReview extends LitElement {
  override createRenderRoot() { return this; }

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

  override connectedCallback(): void {
    super.connectedCallback();
    ensureButtonStyles();
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
  }

  override render() {
    const state = this.controller.state();
    const error = this.controller.error();
    return html`
      <button class="tc-btn tc-btn--danger" data-testid="discard-open" @click=${() => this.controller.ask(this.reviewId)}>${this.label}</button>
      ${error ? html`<div class="tdr__error" data-testid="discard-error">${error}</div>` : nothing}
      <sl-dialog data-testid="discard-dialog" label=${this.label} ?open=${state !== 'closed'}
        @sl-request-close=${(e: Event) => { if (e.target === e.currentTarget) { e.preventDefault(); this.controller.cancel(); } }}>
        ${this.confirmText}
        <sl-button slot="footer" variant="neutral" data-testid="discard-cancel" ?disabled=${state === 'discarding'}
          @click=${() => this.controller.cancel()}>${t('cancel')}</sl-button>
        <sl-button slot="footer" variant="danger" data-testid="discard-confirm" ?loading=${state === 'discarding'}
          @click=${() => void this.controller.confirm()}>${this.label}</sl-button>
      </sl-dialog>
    `;
  }
}
