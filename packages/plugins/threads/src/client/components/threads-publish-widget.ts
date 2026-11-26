import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { defineOnce } from './define';
import { keyed } from 'lit/directives/keyed.js';
import * as api from '../lib/api';
import { t } from '../lib/i18n';
import { createPublishTimer } from '../lib/mode';
import { createPublishController } from '../lib/publish-controller';
import { baseStyles } from './tokens';
import { fieldStyles } from './fields';
import './threads-button';
import './threads-discard-review';
import type { DiscardOutcome } from '../lib/discard-controller';

const widgetStyles = css`
  :host {
    display: block;
    flex: none;
    font-size: var(--_font-size-sm);
  }
  .tpw {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: stretch;
    padding: 10px 16px;
    border-top: 1px solid var(--_border);
    background: var(--_surface);
    color: var(--_fg);
  }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pill {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--_surface-muted);
    color: var(--_fg-muted);
    font-size: 12px;
  }
  .pill--auto { background: var(--_accent-soft); color: var(--_accent-strong); }
  .publish { margin-left: auto; }
  .pp { flex: none; }
  .ring { position: absolute; inset: -1px; transform: rotate(-90deg); pointer-events: none; }
  .ring circle { fill: none; stroke-width: 2; }
  .ring-track { stroke: var(--_border); }
  .ring-bar {
    stroke: var(--_accent);
    stroke-dasharray: 75.4;
    stroke-dashoffset: 0;
    animation: tpw-countdown linear forwards;
  }
  @keyframes tpw-countdown { to { stroke-dashoffset: 75.4; } }
  .count { color: var(--_fg-muted); }
  .title { display: flex; flex-direction: column; gap: 6px; }
  .title-row { display: flex; gap: 6px; }
  .title-input { flex: 1; }
  .line { color: var(--_draft); font-size: 12px; }
  .line--error { color: var(--_danger); }
  .line--orphan { color: var(--_fg-muted); }
`;

export class ThreadsPublishWidget extends LitElement {
  static override styles = [baseStyles, fieldStyles, widgetStyles];

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

  // The owner (threads-app) calls refresh() on load and after every mutation.

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
  private async saveTitle(e?: Event): Promise<void> {
    e?.preventDefault();
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
      <form class="title" data-testid="tpw-title-form" @submit=${(e: Event) => void this.saveTitle(e)}>
        <div class="title-row">
          <input class="field title-input" data-testid="tpw-title" type="text" placeholder=${t('reviewTitle')}
            aria-label=${t('reviewTitle')} .value=${this.draftTitle}
            @input=${(e: Event) => { this.draftTitle = (e.target as HTMLInputElement).value; }} />
          <threads-button data-testid="tpw-title-save" ?disabled=${this.savingTitle} @click=${() => void this.saveTitle()}>${t('save')}</threads-button>
        </div>
        <textarea class="field" data-testid="tpw-summary" rows="3" placeholder=${t('reviewSummary')}
          aria-label=${t('reviewSummary')} .value=${this.draftSummary}
          @input=${(e: Event) => { this.draftSummary = (e.target as HTMLTextAreaElement).value; }}></textarea>
      </form>
      ${this.titleError ? html`<div class="line line--error" part="error" data-testid="tpw-title-error">${this.titleError}</div>` : nothing}`;
  }

  /** The unpublished count last announced to the page. */
  private announced: number | null = null;

  override updated(): void {
    // The drawer's FAB and toggle strip show this count while the drawer is closed.
    const count = this.controller.view().pendingCount;
    if (count !== this.announced) {
      this.announced = count;
      this.dispatchEvent(new CustomEvent<{ count: number }>('unpublished-count-change', { bubbles: true, composed: true, detail: { count } }));
    }
    // The discard element left while its dialog was open (e.g. a failed refresh): no close event will come.
    // That is not a discard; the controller decides that from the journal itself.
    if (this.controller.isHeld() && !this.renderRoot.querySelector('threads-discard-review')) this.controller.release('kept');
  }

  /** Re-read the caller's journal. */
  refresh(): Promise<void> {
    return this.controller.refresh();
  }

  override render() {
    const { state: s, mode, ring, reviewId, opCount } = this.controller.view();
    const auto = s.variant === 'auto';
    return html`
      <div class="tpw" part="base" data-variant=${s.variant}>
        <div class="row">
          ${auto ? html`<span class="pill pill--auto" part="pill">${t('autoPublishing')}</span>` : nothing}
          <span class="count" part="count" data-testid="tpw-count">${s.label}</span>
          ${s.showPlayPause ? html`
            <threads-button class="pp" part="playpause" variant="ghost" icon=${s.playPauseAction} label=${t(s.playPauseAction)}
              data-testid="tpw-playpause" data-mode=${mode} @click=${() => void this.controller.toggleMode()}>
              <svg class="ring" viewBox="0 0 28 28" aria-hidden="true">
                <circle class="ring-track" cx="14" cy="14" r="12"></circle>
                ${s.ringRunning && ring ? keyed(ring.key, html`
                  <circle class="ring-bar" cx="14" cy="14" r="12"
                    style="animation-duration:${ring.totalMs}ms;animation-delay:-${ring.delayMs}ms"></circle>`) : nothing}
              </svg>
            </threads-button>` : nothing}
          <threads-button class="publish" part="publish" variant="primary" data-testid="tpw-publish" ?disabled=${s.publishDisabled}
            @click=${() => void this.controller.publish()}>${t('publish')}</threads-button>
          ${reviewId && opCount > 0 && !s.publishDisabled ? html`
            <threads-discard-review @discard-dialog-change=${(e: CustomEvent<{ open: boolean; outcome: DiscardOutcome }>) =>
                e.detail.open ? this.controller.hold() : this.controller.release(e.detail.outcome)} .reviewId=${reviewId} .label=${t('discardDrafts')}
              .confirmText=${t('discardDraftsConfirm').replace('{n}', String(opCount))}></threads-discard-review>` : nothing}
        </div>
        ${reviewId && opCount > 0 ? this.renderTitle() : nothing}
        ${s.orphanLine ? html`<div class="line line--orphan" part="orphan" data-testid="tpw-orphan">${s.orphanLine}</div>` : nothing}
        ${s.errorLine ? html`<div class="line line--error" part="error" data-testid="tpw-error">${s.errorLine}</div>` : nothing}
      </div>
    `;
  }
}

defineOnce('threads-publish-widget', ThreadsPublishWidget);
