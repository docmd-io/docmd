import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { t } from '../lib/i18n';
import * as api from '../lib/api';
import { canShowFor } from '../lib/identity';
import { siteFromPage, threadHref } from '../lib/reviews-view';
import { profileHref } from '../../shared/profile-link';
import type { AuthorsMap, ReviewSummary } from '../../types';
import { baseStyles } from './tokens';

import './threads-discard-review';

/**
 * The Reviews tab: every review, in the order the server returns them (newest first), with a link to each
 * of its comments and, for a published review its author or an admin may take back, a Discard button.
 * The Discard element is the same one the review section uses; a `reviews-changed` event from it is
 * handled by the host, which calls `refresh()`.
 *
 * Properties: `authors` and `profileUrl` (the review author's name links to their profile when there is one).
 * Parts: `base`, `review`, `title`, `badge`, `meta`, `ops`, `link`, `error`, `empty`.
 */
@customElement('threads-reviews-panel')
export class ThreadsReviewsPanel extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: block; }
    .base { display: flex; flex-direction: column; gap: 10px; padding: 8px 4px; font-size: var(--_font-size-sm); }
    .error { color: var(--_fg-muted); font-size: 12px; border: 1px solid var(--_border); border-radius: var(--_radius); padding: 6px 8px; }
    .empty { padding: 48px 24px; text-align: center; color: var(--_fg-muted); line-height: 1.6; }
    .review { border: 1px solid var(--_border); border-radius: var(--_radius-lg); padding: 10px 12px; background: var(--_surface); }
    .review--discarded { opacity: 0.55; }
    .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .title { font-weight: 600; }
    .badge { font-size: 11px; color: var(--_fg-muted); border: 1px solid var(--_border); border-radius: 999px; padding: 0 8px; }
    .meta { font-size: 12px; color: var(--_fg-muted); margin: 2px 0 6px; }
    .meta a { color: inherit; }
    .ops { margin: 0 0 4px; padding-left: 16px; font-size: 12px; }
    .link { color: var(--_accent-strong); text-decoration: none; }
    .link:hover { text-decoration: underline; }
    a:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
  `];

  @property({ attribute: false }) authors: AuthorsMap = {};
  @property({ attribute: false }) profileUrl: string | null = null;

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
    const href = profileHref(r.authorKey || null, this.authors, this.profileUrl);
    return html`
      <div class="review ${discarded ? 'review--discarded' : ''}" part="review" data-testid="review" data-review-id=${r.id} data-state=${r.state}>
        <div class="head">
          <span class="title" part="title">${r.title || r.id}</span>
          <span class="badge" part="badge" data-testid="review-state">${discarded ? t('discarded') : t('published')}</span>
        </div>
        <div class="meta" part="meta">${href ? html`<a href=${href}>${r.authorName}</a>` : r.authorName} · ${new Date(r.publishedAt).toLocaleDateString()}</div>
        <ul class="ops" part="ops">
          ${r.ops.map(op => html`
            <li><a class="link" part="link" data-testid="review-op"
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
      <div class="base" part="base">
        ${this.error ? html`<div class="error" part="error" data-testid="reviews-error">${this.error}</div>` : nothing}
        ${this.loaded && this.reviews.length === 0 && !this.error ? html`<div class="empty" part="empty" data-testid="reviews-empty">${t('noReviews')}</div>` : nothing}
        ${repeat(this.reviews, r => r.id, r => this.renderReview(r, site))}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'threads-reviews-panel': ThreadsReviewsPanel;
  }
}
