import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { getThreadSvg } from '../lib/icons';
import { tokens } from './tokens';

import '@shoelace-style/shoelace/dist/components/button/button.js';

@customElement('threads-popover')
export class ThreadsPopover extends LitElement {
  static override styles = [tokens, css`
    :host {
      position: fixed;
      z-index: 10001;
    }
    .popover-content {
      background: var(--_surface);
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      box-shadow: var(--_shadow-lg);
      padding: 4px;
    }
    sl-button::part(base) {
      color: var(--_fg);
      font-weight: 500;
      font-size: 13px;
    }
    sl-button::part(base):hover {
      background: var(--_surface-muted);
    }
  `];

  @property({ type: Boolean }) active = false;
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;

  private addComment(): void {
    this.dispatchEvent(new CustomEvent('add-comment', {
      bubbles: true, composed: true,
    }));
  }

  override render() {
    if (!this.active) return html``;

    return html`
      <div
        class="popover-content"
        style="position:fixed; left:${this.x}px; top:${this.y - 10}px; transform:translate(-50%, -100%);"
      >
        <sl-button size="small" variant="text" @click=${this.addComment}>
          <span slot="prefix" style="display:inline-flex;align-items:center;margin-right:6px;">${unsafeHTML(getThreadSvg('chat-left-text', 14))}</span>
          Add comment
        </sl-button>
      </div>
    `;
  }

  show(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.active = true;
  }

  hide(): void {
    this.active = false;
  }
}