import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { t } from '../lib/i18n';
import { dispatchRequest, requestErrorMessage } from '../lib/request';
import { normalizeEmoji } from '../../shared/emoji';
import { emojiPickerI18n } from '../lib/emoji-picker-i18n';
import { loadPickerModule } from '../lib/picker-loader';
import { placePopover } from '../lib/popover-position';
import {
  QUICK_REACTIONS,
  WHO_DELAY_MS,
  WHO_HIDE_MS,
  asReactionViews,
  chipDisabled,
  chipLabel,
  pickerLocale,
  reactionIsMine,
  showAddButton,
  type ReactionView,
  type Viewer,
} from '../lib/reactions';
import type { EmojiPickerElement } from '../vendor/emoji-picker/picker.js';
import { baseStyles } from './tokens';
import { defineOnce } from './define';
import './threads-button';

/**
 * The reactions bar of one comment: a chip per emoji already on it, a react button that opens the
 * quick row, and, on a site that does not restrict reactions, a + that opens the full emoji picker.
 *
 * Properties: `reactions` (`{ emoji, reactors: { key, name, href }[] }[]`), `viewer` (`{ key, name }`,
 * who the server records for this caller; decides which chips are pressed), `options` (the quick
 * row, default GitHub's eight), `restricted`, `picker-src` (URL of the lazy picker module; unset
 * hides the +), `emoji-data-src` (URL of the emoji data JSON), `disabled` (no identity or no live
 * server: chips stay visible but cannot be clicked; nothing at all when there are none).
 * Event: `threads-react` `{ emoji, waitUntil }`, a request event. The promise resolves to the
 * comment's new reaction list, which replaces `reactions`; there is no optimistic update.
 * Clicking a chip, a quick-row emoji or a picker emoji all emit it, and all toggle.
 * Parts: `base`, `chip`, `chip-emoji`, `chip-count`, `who`, `options`, `option`, `react` (the smiley
 * button), `add` (the +), `picker`, `error`. It never reads `window.__threads_config`.
 */
export class ThreadsReactions extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    .base { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .chip-emoji { font-size: 14px; line-height: 1; }
    .chip-count { font-variant-numeric: tabular-nums; }
    .error { flex-basis: 100%; margin: 2px 0 0; font-size: 12px; color: var(--_danger); }

    /* Cards live in the top layer (popover=manual) and are placed with JS. display is only set while open. */
    .card {
      position: fixed;
      inset: auto;
      margin: 0;
      box-sizing: border-box;
      padding: 6px;
      border: 1px solid var(--_border);
      border-radius: var(--_radius-lg);
      background: var(--_surface-raised);
      color: var(--_fg);
      box-shadow: var(--_shadow-lg);
      font-size: var(--_font-size-sm);
      max-width: calc(100vw - 16px);
      overflow: visible;
    }
    .options:popover-open { display: flex; flex-wrap: wrap; gap: 2px; width: max-content; max-width: min(280px, calc(100vw - 16px)); }
    .option-emoji { font-size: 18px; line-height: 1; }
    .who:popover-open { display: block; padding: 8px 10px; max-width: 240px; }
    .who ul { margin: 0; padding: 0; list-style: none; }
    .who li { padding: 1px 0; overflow-wrap: anywhere; }
    .who a { color: var(--_accent-strong); text-decoration: underline; text-underline-offset: 2px; }
    .picker:popover-open { display: block; padding: 0; overflow: hidden; }

    /* The picker's own colour variables, set from our tokens so it follows docmd's light and dark mode. */
    threads-emoji-picker {
      --background: var(--_surface-raised);
      --border-color: var(--_border);
      --input-border-color: var(--_border-strong);
      --input-font-color: var(--_fg);
      --input-placeholder-color: var(--_fg-muted);
      --outline-color: var(--_focus);
      --indicator-color: var(--_accent);
      --button-hover-background: var(--_surface-muted);
      --button-active-background: var(--_accent-soft);
      --category-font-color: var(--_fg-muted);
      font-family: var(--_font);
    }
  `];

  @property({ attribute: false }) reactions: ReactionView[] = [];
  @property({ attribute: false }) viewer: Viewer = { key: null, name: '' };
  @property({ attribute: false }) options: string[] = [...QUICK_REACTIONS];
  @property({ type: Boolean }) restricted = false;
  @property({ attribute: 'picker-src' }) pickerSrc = '';
  @property({ attribute: 'emoji-data-src' }) emojiDataSrc = '';
  @property({ type: Boolean, reflect: true }) disabled = false;

  @state() private quickOpen = false;
  @state() private pickerOpen = false;
  @state() private pickerLoading = false;
  /** The emoji whose request is in flight; every control waits for it. */
  @state() private busyEmoji: string | null = null;
  @state() private whoEmoji: string | null = null;
  @state() private error = '';

  private pickerEl: EmojiPickerElement | null = null;
  private whoAnchor: HTMLElement | null = null;
  private whoShowTimer: ReturnType<typeof setTimeout> | undefined;
  private whoHideTimer: ReturnType<typeof setTimeout> | undefined;
  private listening = false;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearWhoTimers();
    this.listen(false);
  }

  // ─── Toggling ────────────────────────────────────────────────────────

  private async react(emoji: string): Promise<void> {
    if (this.disabled || this.busyEmoji !== null) return;
    this.error = '';
    this.closePopovers();
    const request = dispatchRequest(this, 'threads-react', { emoji });
    if (!request) return;
    this.busyEmoji = emoji;
    try {
      const next = asReactionViews(await request);
      if (next) this.reactions = next;
    } catch (err) {
      this.error = requestErrorMessage(err);
    } finally {
      this.busyEmoji = null;
    }
  }

  // ─── The full picker ─────────────────────────────────────────────────

  private async openPicker(): Promise<void> {
    if (this.pickerLoading) return;
    this.error = '';
    this.pickerLoading = true;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
      await loadPickerModule(this.pickerSrc);
      this.ensurePicker();
    } catch (err) {
      console.error('[threads] emoji picker', err);
      this.error = t('emojiPickerFailed');
      return;
    } finally {
      this.pickerLoading = false;
    }
    this.quickOpen = false;
    this.pickerOpen = true;
    void this.updateComplete.then(() => {
      // Focus the search box once the picker has rendered.
      requestAnimationFrame(() => this.pickerEl?.shadowRoot?.getElementById('search')?.focus({ preventScroll: true }));
    });
  }

  private ensurePicker(): void {
    if (this.pickerEl) return;
    if (!customElements.get('threads-emoji-picker')) throw new Error('threads-emoji-picker is not defined');
    const picker = document.createElement('threads-emoji-picker') as EmojiPickerElement;
    // Set before it connects: its database is created from these.
    picker.dataSource = this.emojiDataSrc;
    picker.locale = pickerLocale(this.emojiDataSrc);
    picker.i18n = emojiPickerI18n();
    picker.addEventListener('emoji-click', (e) => {
      e.stopPropagation();
      const detail = (e as CustomEvent<{ unicode?: string; emoji?: { unicode?: string } }>).detail;
      const unicode = detail?.unicode ?? detail?.emoji?.unicode;
      const emoji = normalizeEmoji(unicode);
      if (emoji !== null) void this.react(emoji);
    });
    // A data file that cannot be fetched (or no usable IndexedDB) rejects here: say so and let the next click retry.
    picker.database.ready().catch((err: unknown) => {
      console.error('[threads] emoji data', err);
      if (this.pickerEl !== picker) return;
      this.pickerEl = null;
      this.pickerOpen = false;
      this.error = t('emojiPickerFailed');
    });
    this.pickerEl = picker;
  }

  // ─── Popovers ────────────────────────────────────────────────────────

  private closePopovers(): void {
    this.quickOpen = false;
    this.pickerOpen = false;
    this.hideWhoNow();
  }

  private toggleQuick(): void {
    this.hideWhoNow();
    this.pickerOpen = false;
    this.quickOpen = !this.quickOpen;
    if (this.quickOpen) void this.updateComplete.then(() => this.focusFirstOption());
  }

  private focusFirstOption(): void {
    this.renderRoot.querySelector<HTMLElement>('[part~=option]')?.focus({ preventScroll: true });
  }

  private card(name: 'options' | 'picker' | 'who'): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`.card.${name}`);
  }

  private anchorFor(name: 'options' | 'picker' | 'who'): HTMLElement | null {
    return name === 'who' ? this.whoAnchor : this.renderRoot.querySelector<HTMLElement>('[part~=react]');
  }

  /** Open or close one card to match state, and place it next to its anchor. */
  private syncCard(name: 'options' | 'picker' | 'who', open: boolean): void {
    const el = this.card(name);
    if (!el) return;
    let isOpen = false;
    try {
      isOpen = el.matches(':popover-open');
    } catch {
      /* no popover support: nothing to sync */
    }
    if (open && !isOpen) el.showPopover?.();
    else if (!open && isOpen) el.hidePopover?.();
    if (open) this.place(el, this.anchorFor(name));
  }

  private place(el: HTMLElement, anchor: HTMLElement | null): void {
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const size = el.getBoundingClientRect();
    const { top, left } = placePopover(
      { top: a.top, left: a.left, width: a.width, height: a.height },
      { width: size.width, height: size.height },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
    );
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    this.syncCard('options', this.quickOpen);
    this.syncCard('picker', this.pickerOpen);
    this.syncCard('who', this.whoEmoji !== null);
    this.listen(this.quickOpen || this.pickerOpen);
    if (changed.has('emojiDataSrc') && this.pickerEl && this.emojiDataSrc) {
      this.pickerEl.dataSource = this.emojiDataSrc;
      this.pickerEl.locale = pickerLocale(this.emojiDataSrc);
    }
  }

  private readonly onDocPointerDown = (e: Event): void => {
    const path = e.composedPath();
    const inside = [this.card('options'), this.card('picker'), this.renderRoot.querySelector('[part~=react]')].some((n) => n && path.includes(n));
    if (!inside) this.closePopovers();
  };

  private readonly onDocKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    this.closePopovers();
    this.renderRoot.querySelector<HTMLElement>('[part~=react]')?.focus({ preventScroll: true });
  };

  private readonly onViewportChange = (): void => {
    if (this.quickOpen) this.syncCard('options', true);
    if (this.pickerOpen) this.syncCard('picker', true);
  };

  /** Outside clicks, Esc and scrolling matter only while a card is open. */
  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const act = on ? 'addEventListener' : 'removeEventListener';
    document[act]('pointerdown', this.onDocPointerDown, true);
    document[act]('keydown', this.onDocKeydown as EventListener);
    window[act]('resize', this.onViewportChange);
    window[act]('scroll', this.onViewportChange, true);
  }

  // ─── Who reacted ─────────────────────────────────────────────────────

  private clearWhoTimers(): void {
    clearTimeout(this.whoShowTimer);
    clearTimeout(this.whoHideTimer);
  }

  private showWhoSoon(emoji: string, anchor: HTMLElement): void {
    this.clearWhoTimers();
    this.whoShowTimer = setTimeout(() => {
      this.whoAnchor = anchor;
      this.whoEmoji = emoji;
    }, WHO_DELAY_MS);
  }

  private hideWhoSoon(): void {
    this.clearWhoTimers();
    this.whoHideTimer = setTimeout(() => { this.whoEmoji = null; }, WHO_HIDE_MS);
  }

  private hideWhoNow(): void {
    this.clearWhoTimers();
    this.whoEmoji = null;
  }

  private onChipPointerEnter(e: PointerEvent, emoji: string): void {
    if (e.pointerType === 'touch') return;
    this.showWhoSoon(emoji, e.currentTarget as HTMLElement);
  }

  // ─── Render ──────────────────────────────────────────────────────────

  private renderChip(r: ReactionView) {
    const mine = reactionIsMine(r, this.viewer);
    const blocked = chipDisabled(r.emoji, mine, { options: this.options, restricted: this.restricted });
    const locale = document.documentElement.lang || undefined;
    return html`
      <threads-button
        part="chip"
        size="sm"
        data-emoji=${r.emoji}
        .pressed=${mine}
        ?disabled=${this.disabled || blocked}
        ?busy=${this.busyEmoji === r.emoji}
        label=${blocked && !this.disabled ? t('reactionNotAllowed') : ''}
        @click=${() => void this.react(r.emoji)}
        @pointerenter=${(e: PointerEvent) => this.onChipPointerEnter(e, r.emoji)}
        @pointerleave=${() => this.hideWhoSoon()}
        @focusin=${(e: FocusEvent) => this.showWhoSoon(r.emoji, e.currentTarget as HTMLElement)}
        @focusout=${() => this.hideWhoSoon()}
      >
        <span class="chip-emoji" part="chip-emoji" aria-hidden="true">${r.emoji}</span>
        <span class="chip-count" part="chip-count" aria-hidden="true">${r.reactors.length}</span>
        <span class="sr">${chipLabel(r, locale)}</span>
      </threads-button>
    `;
  }

  private renderWho() {
    const reaction = this.whoEmoji === null ? undefined : this.reactions.find((r) => r.emoji === this.whoEmoji);
    return html`
      <div class="card who" part="who" popover="manual" role="tooltip"
        @pointerenter=${() => this.clearWhoTimers()} @pointerleave=${() => this.hideWhoSoon()}>
        ${reaction
          ? html`<ul>${reaction.reactors.map((p) => html`<li>${p.href
              ? html`<a href=${p.href} rel="nofollow noopener">${p.name}</a>`
              : p.name}</li>`)}</ul>`
          : nothing}
      </div>
    `;
  }

  override render() {
    if (this.reactions.length === 0 && this.disabled) return nothing;
    const chipEmoji = new Set(this.reactions.map((r) => r.emoji));
    const mineEmoji = new Set(this.reactions.filter((r) => reactionIsMine(r, this.viewer)).map((r) => r.emoji));
    const canAdd = showAddButton(this.restricted, this.pickerSrc) && !!this.emojiDataSrc;
    return html`
      <div class="base" part="base">
        ${this.reactions.map((r) => this.renderChip(r))}
        ${this.disabled ? nothing : html`
          <threads-button part="react" variant="ghost" size="sm" icon="emoji-smile" label=${t('addReaction')}
            .expanded=${this.quickOpen || this.pickerOpen}
            ?busy=${this.busyEmoji !== null && !chipEmoji.has(this.busyEmoji)}
            @click=${() => this.toggleQuick()}></threads-button>
          <div class="card options" part="options" popover="manual" role="group" aria-label=${t('chooseReaction')}>
            ${this.options.map((emoji) => html`
              <threads-button part="option" variant="ghost" .pressed=${mineEmoji.has(emoji)}
                @click=${() => void this.react(emoji)}><span class="option-emoji">${emoji}</span></threads-button>`)}
            ${canAdd ? html`
              <threads-button part="add" variant="ghost" icon="plus" label=${t('moreEmoji')}
                ?busy=${this.pickerLoading} @click=${() => void this.openPicker()}></threads-button>` : nothing}
          </div>
          <div class="card picker" part="picker" popover="manual">${this.pickerEl ?? nothing}</div>
        `}
        ${this.renderWho()}
        ${this.error ? html`<p class="error" part="error" role="alert">${this.error}</p>` : nothing}
      </div>
    `;
  }
}

defineOnce('threads-reactions', ThreadsReactions);

declare global {
  interface HTMLElementTagNameMap {
    'threads-reactions': ThreadsReactions;
  }
}
