import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { getThreadSvg } from '../lib/icons';
import { t } from '../lib/i18n';
import { tCount } from '../lib/plural';
import { baseStyles } from './tokens';
import { defineOnce } from './define';
import './threads-button';

export type PanelTab = 'threads' | 'reviews';
export type PanelMode = 'sidebar' | 'floating';

const TABS: readonly PanelTab[] = ['threads', 'reviews'];

/** Body classes the page's own layout rules (threads.css) and the e2e specs read. */
const BODY_CLASSES = ['tc-panel-open', 'tc-has-sidebar', 'tc-sidebar-active'] as const;

/**
 * The right-hand panel and its launcher. One element on `body`, in two looks: `sidebar` (a 40px strip
 * that is always there and widens into the panel) and `floating` (a tab on the page edge that opens the
 * panel over it).
 *
 * Attributes and properties: `open`, `mode`, `open-count` (unresolved threads, shown on the launcher),
 * `unpublished` (draft change count, shown as a marker), `tab` (`threads` | `reviews`), `show-tabs`
 * (the Reviews tab exists only against a live server), `empty` (no threads: show the empty state).
 * Events: `threads-panel-toggle` `{ open }` (whenever `open` changes), `threads-tab-change` `{ tab }`,
 * `threads-new-thread`. Slots: default (thread cards), `orphans` (cards whose text is gone, grouped under a
 * title), `reviews` (the reviews panel), `footer` (the publish widget). Parts: `launcher`,
 * `launcher-badge`, `unpublished-marker`, `column`, `panel`, `header`, `title`, `count`, `new`, `close`,
 * `tabs`, `tab`, `body`, `empty`, `orphans`, `footer`.
 *
 * While connected it keeps `tc-panel-open` (open), `tc-has-sidebar` and `tc-sidebar-active` (sidebar
 * mode) on `body`. What opening does to the rest of the page (the AI drawer, the review list) is the
 * host's business: it listens for `threads-panel-toggle`.
 */
export class ThreadsPanel extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: contents; }
    button { font: inherit; }
    .column {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: var(--_z-panel);
      display: flex;
      flex-direction: column;
      width: 40px;
      font-family: var(--_font);
      font-size: var(--_font-size);
      line-height: var(--_line-height);
      color: var(--_fg);
      transition: width 0.2s ease;
    }
    .column.open { width: var(--_panel-width); box-shadow: var(--_shadow-lg); }

    .launcher {
      position: relative;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      width: 40px;
      height: 100%;
      padding: 16px 0 0;
      border: 0;
      border-left: 1px solid var(--_border);
      background: var(--_surface);
      color: var(--_fg-muted);
      cursor: pointer;
    }
    .launcher:hover { background: var(--_surface-muted); color: var(--_fg); }
    .launcher:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
    .launcher .icon { display: inline-flex; }

    /* The floating look: a tab docked to the page edge, beside the panel when it is open. */
    .launcher.fab {
      position: fixed;
      top: 50%;
      right: 0;
      z-index: var(--_z-fab);
      width: 40px;
      height: 48px;
      padding: 0 0 0 3px;
      align-items: center;
      transform: translateY(-50%);
      border: 1px solid var(--_border);
      border-right: 0;
      border-radius: 10px 0 0 10px;
      box-shadow: var(--_shadow-lg);
      transition: width 0.22s cubic-bezier(0.16, 1, 0.3, 1), right 0.2s ease;
    }
    .launcher.fab:hover { width: 46px; border-color: var(--_accent); }
    :host([open]) .launcher.fab { right: var(--_panel-width); }

    .badge, .marker {
      position: absolute;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      border-radius: 999px;
      font-size: var(--_font-size-2xs);
      font-weight: 700;
      line-height: 16px;
      text-align: center;
      pointer-events: none;
    }
    .badge { background: var(--_accent-strong); color: var(--_on-accent); line-height: 18px; }
    .marker { border: 1px solid var(--_surface); background: var(--_fg); color: var(--_surface); }
    .strip .badge { top: 40px; left: 50%; transform: translateX(-50%); }
    .strip .marker { top: 62px; left: 50%; transform: translateX(-50%); }
    .fab .badge { top: -6px; left: -6px; }
    .fab .marker { bottom: -6px; left: -6px; }

    .panel {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      width: var(--_panel-width);
      border-left: 1px solid var(--_border);
      background: var(--_surface);
      animation: slide-in 0.2s ease;
    }
    @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } .column { transition: none; } }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 12px;
      border-bottom: 1px solid var(--_border);
    }
    .title { display: flex; align-items: center; gap: 8px; font-weight: 600; letter-spacing: -0.01em; }
    .count { font-weight: 400; color: var(--_fg-muted); }
    .actions { display: flex; align-items: center; gap: 2px; }

    .tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--_border); }
    .tab {
      padding: 6px 8px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--_fg-muted);
      font-size: var(--_font-size-sm);
      cursor: pointer;
    }
    .tab:hover { color: var(--_fg); }
    .tab[aria-selected='true'] { background: var(--_accent-soft); color: var(--_accent-strong); border-bottom-color: var(--_accent); }
    .tab:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }

    .body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 12px; }
    ::slotted(threads-thread) { display: block; margin: 8px 0; }
    ::slotted([slot='footer']) { flex: none; }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 48px 24px;
      text-align: center;
      color: var(--_fg-muted);
      line-height: 1.6;
    }
    .empty strong { color: var(--_fg); font-weight: 600; }

    .group-title {
      padding: 12px 4px 6px;
      font-size: var(--_font-size-2xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--_fg-muted);
    }
  `];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ reflect: true }) mode: PanelMode = 'floating';
  @property({ type: Number, attribute: 'open-count' }) openCount = 0;
  @property({ type: Number }) unpublished = 0;
  @property({ reflect: true }) tab: PanelTab = 'threads';
  @property({ type: Boolean, attribute: 'show-tabs' }) showTabs = false;
  @property({ type: Boolean }) empty = false;

  @state() private hasOrphans = false;

  /** `open` as last announced; the first render announces nothing. */
  private announcedOpen: boolean | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.body.classList.remove(...BODY_CLASSES);
    this.announcedOpen = null;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Without a live server there is no Reviews tab: fall back to Threads.
    if (changed.has('showTabs') && !this.showTabs && this.tab === 'reviews') this.setTab('threads');
  }

  override updated(): void {
    const cl = document.body.classList;
    cl.toggle('tc-panel-open', this.open);
    cl.toggle('tc-sidebar-active', this.mode === 'sidebar');
    cl.toggle('tc-has-sidebar', this.mode === 'sidebar');
    if (this.announcedOpen !== null && this.announcedOpen !== this.open) {
      this.dispatchEvent(new CustomEvent('threads-panel-toggle', { bubbles: true, composed: true, detail: { open: this.open } }));
    }
    this.announcedOpen = this.open;
  }

  private setTab(tab: PanelTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.dispatchEvent(new CustomEvent('threads-tab-change', { bubbles: true, composed: true, detail: { tab } }));
  }

  private onTabKeydown(e: KeyboardEvent): void {
    const i = TABS.indexOf(this.tab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    this.setTab(TABS[next]!);
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`[data-tab="${this.tab}"]`)?.focus());
  }

  private onOrphansSlot(e: Event): void {
    this.hasOrphans = (e.target as HTMLSlotElement).assignedElements().length > 0;
  }

  private icon(name: string, size = 18) {
    return html`<span class="icon" aria-hidden="true">${unsafeHTML(getThreadSvg(name, size))}</span>`;
  }

  private renderLauncher(fab: boolean) {
    const label = this.open ? t('closePanel') : t('openThreadsPanel');
    const unpublishedLabel = this.unpublished > 0
      ? tCount('unpublishedCount', this.unpublished)
      : '';
    return html`<button class="launcher ${fab ? 'fab' : 'strip'}" part="launcher" type="button"
      aria-label=${label} title=${label} aria-expanded=${String(this.open)}
      @click=${() => { this.open = !this.open; }}>
      ${this.icon('messages-square')}
      ${this.openCount > 0 ? html`<span class="badge" part="launcher-badge">${this.openCount}</span>` : nothing}
      ${this.unpublished > 0
        ? html`<span class="marker" part="unpublished-marker" data-testid="unpublished-marker"
          title=${unpublishedLabel} aria-label=${unpublishedLabel}>${this.unpublished}</span>`
        : nothing}
    </button>`;
  }

  private renderTabs() {
    if (!this.showTabs) return nothing;
    return html`<div class="tabs" part="tabs" role="tablist" @keydown=${this.onTabKeydown}>
      ${TABS.map((id) => html`<button class="tab" part="tab" type="button" role="tab"
        id="tab-${id}" data-tab=${id} data-testid="tab-${id}"
        aria-selected=${String(this.tab === id)} aria-controls="body" tabindex=${this.tab === id ? '0' : '-1'}
        @click=${() => this.setTab(id)}>${t(id)}</button>`)}
    </div>`;
  }

  private renderBody() {
    if (this.tab === 'reviews') return html`<slot name="reviews"></slot>`;
    const orphans = this.hasOrphans
      ? html`<div class="orphans" part="orphans" data-testid="orphaned-group">
          <div class="group-title">${t('orphaned')}</div>
          <slot name="orphans" @slotchange=${this.onOrphansSlot}></slot>
        </div>`
      : html`<slot name="orphans" @slotchange=${this.onOrphansSlot}></slot>`;
    return html`
      ${this.empty ? html`<div class="empty" part="empty" data-testid="panel-empty">
        <strong>${t('noThreads')}</strong><span>${t('emptyHint')}</span></div>` : nothing}
      <slot></slot>
      ${orphans}`;
  }

  override render() {
    const sidebar = this.mode === 'sidebar';
    const showColumn = sidebar || this.open;
    return html`
      ${showColumn ? html`<div class="column ${this.open ? 'open' : ''}" part="column">
        ${this.open ? html`
          <div class="panel" part="panel" role="complementary" aria-label=${t('threads')}>
            <div class="header" part="header">
              <div class="title" part="title">
                <span>${t('threads')}</span>
                ${this.openCount > 0 ? html`<span class="count" part="count">${t('openCount').replace('{n}', String(this.openCount))}</span>` : nothing}
              </div>
              <div class="actions">
                <threads-button part="new" variant="ghost" size="sm" icon="plus" label=${t('newThread')}
                  @click=${() => this.dispatchEvent(new CustomEvent('threads-new-thread', { bubbles: true, composed: true }))}></threads-button>
                <threads-button part="close" variant="ghost" size="sm" icon="x" label=${t('closePanel')}
                  @click=${() => { this.open = false; }}></threads-button>
              </div>
            </div>
            ${this.renderTabs()}
            <div class="body" part="body" id="body" role=${this.showTabs ? 'tabpanel' : nothing}
              aria-labelledby=${this.showTabs ? `tab-${this.tab}` : nothing}>${this.renderBody()}</div>
            <div class="footer" part="footer"><slot name="footer"></slot></div>
          </div>` : (sidebar ? this.renderLauncher(false) : nothing)}
      </div>` : nothing}
      ${!sidebar ? this.renderLauncher(true) : nothing}
    `;
  }
}

defineOnce('threads-panel', ThreadsPanel);

declare global {
  interface HTMLElementTagNameMap {
    'threads-panel': ThreadsPanel;
  }
}
