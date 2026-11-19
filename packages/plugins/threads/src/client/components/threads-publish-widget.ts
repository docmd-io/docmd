import { LitElement, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import * as api from '../lib/api';
import { t } from '../lib/i18n';
import { createPublishTimer } from '../lib/mode';
import { createPublishController } from '../lib/publish-controller';

const STYLE_ID = 'tc-publish-widget-styles';

const CSS = `
  threads-publish-widget {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2200;
    font-family: var(--docmd-font-family, inherit);
    font-size: 13px;
  }
  .tpw {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
    padding: 8px 10px;
    border: 1px solid var(--sl-color-neutral-200, var(--docmd-border-color, currentColor));
    border-radius: 10px;
    background: var(--sl-color-neutral-0, var(--docmd-bg, canvas));
    color: var(--sl-color-neutral-900, var(--docmd-text, canvastext));
    box-shadow: var(--sl-shadow-large, none);
  }
  .tpw__row { display: flex; align-items: center; gap: 8px; }
  .tpw__pill {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--sl-color-neutral-100, var(--docmd-bg-muted, transparent));
    color: var(--sl-color-neutral-700, inherit);
    font-size: 12px;
  }
  .tpw__pill--auto { background: var(--sl-color-primary-100, transparent); color: var(--sl-color-primary-700, inherit); }
  .tpw__btn {
    border: 1px solid var(--sl-color-primary-600, currentColor);
    background: var(--sl-color-primary-600, transparent);
    color: var(--sl-color-neutral-0, inherit);
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font: inherit;
  }
  .tpw__btn:disabled { opacity: 0.5; cursor: default; }
  .tpw__pp {
    position: relative;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
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
  .tpw__line { color: var(--sl-color-warning-700, inherit); font-size: 12px; }
  .tpw__line--error { color: var(--sl-color-danger-700, inherit); }
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

  /** Re-read the caller's journal. */
  refresh(): Promise<void> {
    return this.controller.refresh();
  }

  override render() {
    const { state: s, mode, ring } = this.controller.view();
    const auto = s.variant === 'auto';
    return html`
      <div class="tpw" data-variant=${s.variant}>
        <div class="tpw__row">
          ${auto ? html`<span class="tpw__pill tpw__pill--auto">${t('autoPublishing')}</span>` : nothing}
          <span class="tpw__count" data-testid="tpw-count">${s.label}</span>
          ${s.showPlayPause ? html`
            <button class="tpw__pp" data-testid="tpw-playpause" data-mode=${mode} title=${t(s.playPauseAction)}
              aria-label=${t(s.playPauseAction)} @click=${() => void this.controller.toggleMode()}>
              <svg class="tpw__ring" viewBox="0 0 28 28" aria-hidden="true">
                <circle class="tpw__ring-track" cx="14" cy="14" r="12"></circle>
                ${s.ringRunning && ring ? keyed(ring.key, html`
                  <circle class="tpw__ring-bar" cx="14" cy="14" r="12"
                    style="animation-duration:${ring.totalMs}ms;animation-delay:-${ring.delayMs}ms"></circle>`) : nothing}
              </svg>
              <span aria-hidden="true">${s.playPauseAction === 'pause' ? '⏸' : '▶'}</span>
            </button>` : nothing}
          <button class="tpw__btn" data-testid="tpw-publish" ?disabled=${s.publishDisabled} @click=${() => void this.controller.publish()}>${t('publish')}</button>
        </div>
        ${s.errorLine ? html`<div class="tpw__line tpw__line--error" data-testid="tpw-error">${s.errorLine}</div>` : nothing}
      </div>
    `;
  }
}
