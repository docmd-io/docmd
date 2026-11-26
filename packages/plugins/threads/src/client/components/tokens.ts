import { css } from 'lit';

/**
 * Private aliases for the host page's --threads-* tokens. Every component reads only these --_*
 * names; each alias carries a light literal fallback, so a component also renders sensibly when no
 * threads.css is loaded (a non-docmd host app). threads.css declares the tokens and their dark values.
 */
export const tokens = css`
  :host {
    --_surface: var(--threads-surface, #ffffff);
    --_surface-raised: var(--threads-surface-raised, #f8f8f8);
    --_surface-muted: var(--threads-surface-muted, #fafafa);
    --_fg: var(--threads-fg, #1f1f20);
    --_fg-strong: var(--threads-fg-strong, #1f1f20);
    --_fg-muted: var(--threads-fg-muted, #6b6b75);
    --_border: var(--threads-border, #e4e4e7);
    --_border-strong: var(--threads-border-strong, #bcbcc2);
    --_accent: var(--threads-accent, #068ad5);
    --_accent-strong: var(--threads-accent-strong, #0568a0);
    --_accent-soft: var(--threads-accent-soft, rgb(6 138 213 / 0.14));
    --_on-accent: var(--threads-on-accent, #ffffff);
    --_danger: var(--threads-danger, #bb2020);
    --_danger-soft: var(--threads-danger-soft, rgb(187 32 32 / 0.12));
    --_draft: var(--threads-draft, #b45309);
    --_focus: var(--threads-focus, #068ad5);
    --_hl-yellow: var(--threads-hl-yellow, hsl(48 96% 53% / 0.3));
    --_hl-yellow-strong: var(--threads-hl-yellow-strong, hsl(48 96% 45%));
    --_hl-blue: var(--threads-hl-blue, hsl(210 100% 55% / 0.3));
    --_hl-blue-strong: var(--threads-hl-blue-strong, hsl(210 100% 45%));
    --_hl-green: var(--threads-hl-green, hsl(142 60% 45% / 0.3));
    --_hl-green-strong: var(--threads-hl-green-strong, hsl(142 60% 45%));
    --_hl-pink: var(--threads-hl-pink, hsl(340 80% 55% / 0.3));
    --_hl-pink-strong: var(--threads-hl-pink-strong, hsl(340 80% 45%));
    --_hl-purple: var(--threads-hl-purple, hsl(270 70% 55% / 0.3));
    --_hl-purple-strong: var(--threads-hl-purple-strong, hsl(270 70% 45%));
    --_hl-orange: var(--threads-hl-orange, hsl(28 100% 55% / 0.3));
    --_hl-orange-strong: var(--threads-hl-orange-strong, hsl(28 100% 45%));
    --_hl-neutral: var(--threads-hl-neutral, #bcbcc2);
    --_hl-neutral-strong: var(--threads-hl-neutral-strong, #bcbcc2);
    --_font: var(--threads-font, system-ui, sans-serif);
    --_font-mono: var(--threads-font-mono, ui-monospace, monospace);
    --_font-size: var(--threads-font-size, 14px);
    --_font-size-sm: var(--threads-font-size-sm, 13px);
    --_line-height: var(--threads-line-height, 1.5);
    --_radius: var(--threads-radius, 6px);
    --_radius-lg: var(--threads-radius-lg, 12px);
    --_shadow: var(--threads-shadow, 0 1px 2px rgb(0 0 0 / 0.06));
    --_shadow-lg: var(--threads-shadow-lg, 0 10px 30px rgb(0 0 0 / 0.15));
    --_control-height: var(--threads-control-height, 28px);
    --_control-height-sm: var(--threads-control-height-sm, 24px);
    --_panel-width: var(--threads-panel-width, 380px);
    --_z-panel: var(--threads-z-panel, 3000);
    --_z-fab: var(--threads-z-fab, 2100);
  }
`;

/**
 * The reset every component starts with, so the text styles of the surrounding page (inline cards
 * sit inside article prose) do not leak in. `all: initial` leaves custom properties alone.
 * A component sets its own `display` after this when it needs inline-block or contents.
 */
export const hostReset = css`
  :host {
    all: initial;
    display: block;
    font: var(--_font-size) / var(--_line-height) var(--_font);
    color: var(--_fg);
    text-align: start;
  }
`;

/** The usual start of a component's `static styles`: aliases, then the reset. */
export const baseStyles = [tokens, hostReset];
