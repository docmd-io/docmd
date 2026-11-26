import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { t } from '../lib/i18n';
import * as api from '../lib/api';
import { canShowFor } from '../lib/identity';
import { siteFromPage, threadHref } from '../lib/reviews-view';
import type { ReviewSummary } from '../../types';

import './threads-discard-review';

/**
 * The Reviews tab: every review, in the order the server returns them (newest first), with a link to each
 * of its comments and, for a published review its author or an admin may take back, a Discard button.
 * The Discard element is the same one the review section uses; a `reviews-changed` event from it is
 * handled by the host, which calls `refresh()`.
 */
@customElement('threads-reviews-panel')
export class ThreadsReviewsPanel extends LitElement {
  override createRenderRoot() { return this; }

  @state() private reviews: ReviewSummary[] = [];
  @state() private loaded = false;
  @state() private error: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.reviews = await api.listReviews();
      this.error = null;
    } catch (err) {
      console.error('[threads] reviews load failed:', err);
      this.error = err instanceof api.ThreadsClientError ? err.text : err instanceof Error ? err.message : String(err);
    }
    this.loaded = true;
  }

  /** The link already points at the open URL: the browser would do nothing, so ask the host to reveal the thread. */
  private onOpClick(e: Event): void {
    const a = e.currentTarget as HTMLAnchorElement;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || url.hash !== location.hash) return;
    // The host cancels the event when it reveals the thread; without a host the link keeps its default.
    const handled = !this.dispatchEvent(new CustomEvent('reveal-thread', { bubbles: true, composed: true, cancelable: true }));
    if (handled) e.preventDefault();
  }

  private renderReview(r: ReviewSummary, site: { siteBase: string; srcRoot: string }) {
    const discarded = r.state === 'discarded';
    return html`
      <div class="tc-review ${discarded ? 'tc-review--discarded' : ''}" data-testid="review" data-review-id=${r.id} data-state=${r.state}>
        <div class="tc-review__head">
          <span class="tc-review__title">${r.title || r.id}</span>
          <span class="tc-review__badge" data-testid="review-state">${discarded ? t('discarded') : t('published')}</span>
        </div>
        <div class="tc-review__meta">${r.authorName} · ${new Date(r.publishedAt).toLocaleDateString()}</div>
        <ul class="tc-review__ops">
          ${r.ops.map(op => html`
            <li><a class="tc-review__link" data-testid="review-op"
              href=${threadHref(op.file, op.threadId, site.siteBase, site.srcRoot)}
              @click=${(e: Event) => this.onOpClick(e)}>${op.quote ?? op.pageTitle ?? op.file}</a></li>`)}
        </ul>
        ${discarded || !canShowFor('discard-review', { reviewAuthor: r.authorKey }) ? nothing : html`
          <threads-discard-review .reviewId=${r.id} .label=${t('discard')} .confirmText=${t('discardConfirm')}></threads-discard-review>`}
      </div>`;
  }

  override render() {
    const site = siteFromPage(document.body.dataset['sourceFile'] ?? '', location.pathname);
    return html`
      <div class="tc-reviews">
        ${this.error ? html`<div class="tc-reviews__error" data-testid="reviews-error">${this.error}</div>` : nothing}
        ${this.loaded && this.reviews.length === 0 && !this.error ? html`<div class="tc-empty" data-testid="reviews-empty">${t('noReviews')}</div>` : nothing}
        ${repeat(this.reviews, r => r.id, r => this.renderReview(r, site))}
      </div>`;
  }
}
