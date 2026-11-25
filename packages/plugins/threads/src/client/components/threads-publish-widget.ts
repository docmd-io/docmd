import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import * as api from '../lib/api';
import { t } from '../lib/i18n';
import { createPublishTimer } from '../lib/mode';
import { createPublishController } from '../lib/publish-controller';
import { ensureButtonStyles } from './button-style';
import './threads-discard-review';
import type { DiscardOutcome } from '../lib/discard-controller';

const STYLE_ID = 'tc-publish-widget-styles';

const CSS = `
  threads-publish-widget {
    display: block;
    flex: none;
    font-family: var(--tc-font, var(--docmd-font-family, inherit));
    font-size: 13px;
  }
  .tpw {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: stretch;
    padding: 10px 16px;
    border-top: 1px solid var(--tc-border, var(--sl-color-neutral-200, currentColor));
    background: var(--tc-bg, var(--sl-color-neutral-0, canvas));
    color: var(--tc-fg, var(--sl-color-neutral-900, canvastext));
  }
  .tpw__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tpw__pill {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--sl-color-neutral-100, var(--docmd-bg-muted, transparent));
    color: var(--sl-color-neutral-700, inherit);
    font-size: 12px;
  }
  .tpw__pill--auto { background: var(--sl-color-primary-100, transparent); color: var(--sl-color-primary-700, inherit); }
  .tpw__btn { margin-left: auto; }
  .tpw__pp { position: relative; flex: none; }
  .tpw__ring { position: absolute; inset: 0; transform: rotate(-90deg); }
  .tpw__ring circle { fill: none; stroke-width: 2; }
  .tpw__ring-track { stroke: var(--sl-color-neutral-200, currentColor); }
  .tpw__ring-bar {
    stroke: var(--sl-color-primary-600, currentColor);
    stroke-dasharray: 75.4;
    stroke-dashoffset: 0;
    animation: tpw-countdown linear forwards;
  }
  @keyframes tpw-countdown { to { stroke-dashoffset: 75.4; } }
  .tpw__count { color: var(--sl-color-neutral-700, inherit); }
  .tpw__title { display: flex; flex-direction: column; gap: 6px; }
  .tpw__title-row { display: flex; gap: 6px; }
  .tpw__summary-input {
    resize: vertical;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    color: inherit;
    background: transparent;
    border: 1px solid var(--tc-input, var(--sl-color-neutral-300, currentColor));
    border-radius: 6px;
    padding: 4px 8px;
  }
  .tpw__title-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    color: inherit;
    background: transparent;
    border: 1px solid var(--tc-input, var(--sl-color-neutral-300, currentColor));
    border-radius: 6px;
    padding: 4px 8px;
  }
  .tpw__line { color: var(--sl-color-warning-700, inherit); font-size: 12px; }
  .tpw__line--error { color: var(--sl-color-danger-700, inherit); }
  .tpw__line--orphan { color: var(--tc-muted-fg, inherit); }
`;

@customElement('threads-publish-widget')
export class ThreadsPublishWidget extends LitElement {
  override createRenderRoot() { return this; }

  private controller = createPublishController({
    api,
    timer: this.createTimer(),
    t,
    onChange: () => this.requestUpdate(),
  });

  /** generateScripts always injects it; a missing value means no config, so collect-only. */
  private get autoPublish(): false | { seconds: number; startOn: boolean } {
    const cfg = (window as { __threads_config?: { autoPublish?: unknown } }).__threads_config?.autoPublish;
    return cfg && typeof cfg === 'object' ? (cfg as { seconds: number; startOn: boolean }) : false;
  }

  private createTimer() {
    const ap = this.autoPublish;
    if (!ap) return null;
    return createPublishTimer({
      seconds: ap.seconds,
      now: () => Date.now(),
      schedule: (cb, ms) => {
        const id = window.setTimeout(cb, ms);
        return () => window.clearTimeout(id);
      },
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    ensureButtonStyles();
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    // The owner (threads-app) calls refresh() on load and after every mutation.
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller.stop();
  }

  /** The title field's text; reset to the journal's when the open review or its saved title changes. */
  @state() private draftTitle = '';
  @state() private savingTitle = false;
  @state() private titleError: string | null = null;
  @state() private draftSummary = '';
  private titleSeen: { id: string | null; title: string | null; summary: string | null } = { id: null, title: null, summary: null };

  /** Save the fields as the open review's title (empty: the default one) and summary (empty: none). The journal is re-read after, which restarts the countdown. */
  private async saveTitle(e: Event): Promise<void> {
    e.preventDefault();
    if (this.savingTitle) return;
    this.savingTitle = true;
    this.titleError = null;
    try {
      await api.updateReview({ title: this.draftTitle.trim() || null, summary: this.draftSummary.trim() || null });
      await this.controller.refresh();
    } catch (err) {
      this.titleError = err instanceof api.ThreadsClientError ? err.text : t('saveFailed');
    } finally {
      this.savingTitle = false;
    }
  }

  /** Keep what the user is typing; take the journal's title and summary only when either or the review changed. */
  override willUpdate(): void {
    const { reviewId, reviewTitle, reviewSummary } = this.controller.view();
    if (this.titleSeen.id !== reviewId || this.titleSeen.title !== reviewTitle || this.titleSeen.summary !== reviewSummary) {
      this.titleSeen = { id: reviewId, title: reviewTitle, summary: reviewSummary };
      this.draftTitle = reviewTitle ?? '';
      this.draftSummary = reviewSummary ?? '';
    }
  }

  private renderTitle() {
    return html`
      <form class="tpw__title" data-testid="tpw-title-form" @submit=${(e: Event) => void this.saveTitle(e)}>
        <div class="tpw__title-row">
          <input class="tpw__title-input" data-testid="tpw-title" type="text" placeholder=${t('reviewTitle')}
            aria-label=${t('reviewTitle')} .value=${this.draftTitle}
            @input=${(e: Event) => { this.draftTitle = (e.target as HTMLInputElement).value; }} />
          <button class="tc-btn" data-testid="tpw-title-save" type="submit" ?disabled=${this.savingTitle}>${t('save')}</button>
        </div>
        <textarea class="tpw__summary-input" data-testid="tpw-summary" rows="3" placeholder=${t('reviewSummary')}
          aria-label=${t('reviewSummary')} .value=${this.draftSummary}
          @input=${(e: Event) => { this.draftSummary = (e.target as HTMLTextAreaElement).value; }}></textarea>
      </form>
      ${this.titleError ? html`<div class="tpw__line tpw__line--error" data-testid="tpw-title-error">${this.titleError}</div>` : nothing}`;
  }

  /** The unpublished count last announced to the page. */
  private announced: number | null = null;

  override updated(): void {
    // The drawer's FAB and toggle strip show this count while the drawer is closed.
    const count = this.controller.view().pendingCount;
    if (count !== this.announced) {
      this.announced = count;
      this.dispatchEvent(new CustomEvent<{ count: number }>('unpublished-count-change', { bubbles: true, detail: { count } }));
    }
    // The discard element left while its dialog was open (e.g. a failed refresh): no close event will come.
    // That is not a discard; the controller decides that from the journal itself.
    if (this.controller.isHeld() && !this.querySelector('threads-discard-review')) this.controller.release('kept');
  }

  /** Re-read the caller's journal. */
  refresh(): Promise<void> {
    return this.controller.refresh();
  }

  override render() {
    const { state: s, mode, ring, reviewId, opCount } = this.controller.view();
    const auto = s.variant === 'auto';
    return html`
      <div class="tpw" data-variant=${s.variant}>
        <div class="tpw__row">
          ${auto ? html`<span class="tpw__pill tpw__pill--auto">${t('autoPublishing')}</span>` : nothing}
          <span class="tpw__count" data-testid="tpw-count">${s.label}</span>
          ${s.showPlayPause ? html`
            <button class="tc-btn tc-btn--icon tpw__pp" data-testid="tpw-playpause" data-mode=${mode} title=${t(s.playPauseAction)}
              aria-label=${t(s.playPauseAction)} @click=${() => void this.controller.toggleMode()}>
              <svg class="tpw__ring" viewBox="0 0 28 28" aria-hidden="true">
                <circle class="tpw__ring-track" cx="14" cy="14" r="12"></circle>
                ${s.ringRunning && ring ? keyed(ring.key, html`
                  <circle class="tpw__ring-bar" cx="14" cy="14" r="12"
                    style="animation-duration:${ring.totalMs}ms;animation-delay:-${ring.delayMs}ms"></circle>`) : nothing}
              </svg>
              <span aria-hidden="true">${s.playPauseAction === 'pause' ? '⏸' : '▶'}</span>
            </button>` : nothing}
          <button class="tc-btn tc-btn--primary tpw__btn" data-testid="tpw-publish" ?disabled=${s.publishDisabled} @click=${() => void this.controller.publish()}>${t('publish')}</button>
          ${reviewId && opCount > 0 && !s.publishDisabled ? html`
            <threads-discard-review @discard-dialog-change=${(e: CustomEvent<{ open: boolean; outcome: DiscardOutcome }>) =>
                e.detail.open ? this.controller.hold() : this.controller.release(e.detail.outcome)} .reviewId=${reviewId} .label=${t('discardDrafts')}
              .confirmText=${t('discardDraftsConfirm').replace('{n}', String(opCount))}></threads-discard-review>` : nothing}
        </div>
        ${reviewId && opCount > 0 ? this.renderTitle() : nothing}
        ${s.orphanLine ? html`<div class="tpw__line tpw__line--orphan" data-testid="tpw-orphan">${s.orphanLine}</div>` : nothing}
        ${s.errorLine ? html`<div class="tpw__line tpw__line--error" data-testid="tpw-error">${s.errorLine}</div>` : nothing}
      </div>
    `;
  }
}
