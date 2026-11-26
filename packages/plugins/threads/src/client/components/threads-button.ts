import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { getThreadSvg } from '../lib/icons';
import { baseStyles } from './tokens';
import { defineOnce } from './define';

/** A boolean attribute that stays `undefined` when absent, so `aria-pressed` is only set on toggles. */
const optionalBoolean = {
  fromAttribute: (value: string | null): boolean | undefined => (value === null ? undefined : value !== 'false'),
  toAttribute: (value: boolean | undefined): string | null => (value === undefined ? null : String(value)),
};

/**
 * The one button: text, icon, or both. An icon-only button is the same element with no text.
 *
 * Attributes: `variant` (neutral, primary, danger, ghost), `danger` (on a ghost button: the danger colour, with
 * the danger tint on hover), `size` (md, sm), `icon` (an icon name),
 * `label` (accessible name and tooltip; required when there is no text), `disabled`, `busy`,
 * `pressed` and `expanded` (set `aria-pressed` / `aria-expanded` when present).
 * Slots: default (text), `prefix`, `suffix`. Parts: `base`, `icon`, `label`, `spinner`.
 * Events: the native `click`. It never fires while `disabled` or `busy`.
 * It is not a form participant: there is no `type=submit`; read values from events.
 */
export class ThreadsButton extends LitElement {
  static override shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override styles = [baseStyles, css`
    :host { display: inline-block; vertical-align: middle; }
    /* A popover=manual host (the selection button) is hidden until shown; the host reset must not undo that. */
    :host([popover]:not(:popover-open)) { display: none; }
    :host([disabled]), :host([busy]) { cursor: default; }
    .base {
      box-sizing: border-box;
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: var(--_control-height);
      padding: 0 12px;
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      background: var(--_surface);
      color: var(--_fg);
      font: inherit;
      font-size: var(--_font-size-sm);
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      max-width: 100%;
    }
    .base:hover { background: var(--_surface-muted); border-color: var(--_border-strong); }
    .base:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .base[aria-pressed='true'] { background: var(--_accent-soft); border-color: var(--_accent); color: var(--_accent-strong); }
    .base:disabled, .base[aria-busy='true'] { opacity: 0.5; cursor: default; }
    .base[aria-busy='true'] { cursor: progress; }

    :host([size='sm']) .base { height: var(--_control-height-sm); padding: 0 8px; }
    .base.icon-only { width: var(--_control-height); padding: 0; }
    :host([size='sm']) .base.icon-only { width: var(--_control-height-sm); }

    :host([variant='primary']) .base { background: var(--_accent-strong); border-color: var(--_accent-strong); color: var(--_on-accent); }
    :host([variant='primary']) .base:hover { background: color-mix(in oklab, var(--_accent-strong) 85%, black); border-color: transparent; }

    /* Outlined, never filled: it must not look like the primary button, even where the accent is red. */
    :host([variant='danger']) .base { background: var(--_surface); border-color: var(--_danger); color: var(--_danger); }
    :host([variant='danger']) .base:hover { background: var(--_danger-soft); border-color: var(--_danger); }

    :host([variant='ghost']) .base { background: transparent; border-color: transparent; color: var(--_fg-muted); }
    :host([variant='ghost']) .base:hover { background: var(--_surface-muted); color: var(--_fg); }
    :host([variant='ghost']) .base[aria-pressed='true'] { background: var(--_accent-soft); color: var(--_accent-strong); }
    :host([variant='ghost'][danger]) .base { color: var(--_danger); }
    :host([variant='ghost'][danger]) .base:hover { background: var(--_danger-soft); color: var(--_danger); }

    .icon { display: inline-flex; align-items: center; }
    .label { display: contents; }
    .spinner {
      box-sizing: border-box;
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
  `];

  @property({ reflect: true }) variant: 'neutral' | 'primary' | 'danger' | 'ghost' = 'neutral';
  @property({ reflect: true }) size: 'md' | 'sm' = 'md';
  @property() icon = '';
  @property() label = '';
  /** With `variant="ghost"`: a quiet destructive action (a delete icon). */
  @property({ type: Boolean, reflect: true }) danger = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) busy = false;
  @property({ converter: optionalBoolean, reflect: true }) pressed: boolean | undefined = undefined;
  @property({ converter: optionalBoolean, reflect: true }) expanded: boolean | undefined = undefined;

  /** Whether the default slot holds text; an icon with no text becomes a square icon button. */
  @state() private hasText = false;

  constructor() {
    super();
    // Capture on the host, registered first: a disabled or busy button swallows the click before any listener sees it.
    this.addEventListener('click', (e) => {
      if (this.disabled || this.busy) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.measureText();
  }

  /** Text, or an element that is not an inline `svg` (decoration such as a progress ring), counts as content. */
  private measureText(): void {
    this.hasText = [...this.childNodes].some((n) => {
      if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').trim() !== '';
      if (n instanceof Element) return !n.hasAttribute('slot') && n.localName !== 'svg';
      return false;
    });
  }

  override render() {
    const iconOnly = !this.hasText;
    const name = iconOnly ? this.label : '';
    return html`
      <button
        part="base"
        type="button"
        class=${iconOnly ? 'base icon-only' : 'base'}
        ?disabled=${this.disabled}
        aria-label=${name || nothing}
        aria-busy=${this.busy ? 'true' : nothing}
        aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
        aria-expanded=${this.expanded === undefined ? nothing : String(this.expanded)}
        title=${this.label || nothing}
      >
        ${this.busy
          ? html`<span class="spinner" part="spinner" aria-hidden="true"></span>`
          : this.icon
            ? html`<span class="icon" part="icon" aria-hidden="true">${unsafeHTML(getThreadSvg(this.icon, 14))}</span>`
            : nothing}
        <slot name="prefix"></slot>
        <span class="label" part="label"><slot @slotchange=${this.measureText}></slot></span>
        <slot name="suffix"></slot>
      </button>
    `;
  }
}

defineOnce('threads-button', ThreadsButton);

declare global {
  interface HTMLElementTagNameMap {
    'threads-button': ThreadsButton;
  }
}
