import { css } from 'lit';

/**
 * One look for the text controls (single-line inputs and text areas) inside components: the
 * identity name field, the editor box, the publish title and summary. Add the `field` class to
 * the native element. Use after `tokens` (components/tokens.ts).
 */
export const fieldStyles = css`
  .field {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    background: var(--_surface-muted);
    color: var(--_fg);
    font: inherit;
    font-size: var(--_font-size-sm);
    line-height: 1.4;
  }
  input.field { min-height: var(--_control-height); }
  textarea.field { resize: vertical; }
  .field::placeholder { color: var(--_fg-muted); }
  .field:hover { border-color: var(--_border-strong); }
  .field:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
  .field:disabled { opacity: 0.6; cursor: default; }
`;
