/**
 * The one base button style of the review UI: the review section's Publish, Save and play/pause, the Discard
 * trigger, and the buttons of the discard confirmation. Size, padding, font and radius are declared here once;
 * a component adds `tc-btn` to its own `<button>` (plus a variant) and gets the Shoelace buttons inside
 * `threads-discard-review` through the same declarations.
 */

const STYLE_ID = 'tc-button-styles';

const HEIGHT = 'var(--threads-control-height)';

const BASE = `
  box-sizing: border-box;
  height: ${HEIGHT};
  min-height: 0;
  padding: 0 12px;
  font-family: var(--threads-font);
  font-size: var(--threads-font-size-sm);
  line-height: 1;
  border-radius: var(--threads-radius);
`;

const CSS = `
  .tc-btn {
    ${BASE}
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--threads-border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .tc-btn:disabled { opacity: 0.5; cursor: default; }
  .tc-btn--primary {
    border-color: var(--threads-accent-strong);
    background: var(--threads-accent-strong);
    color: var(--threads-on-accent);
  }
  .tc-btn--danger {
    border-color: var(--threads-danger);
    color: var(--threads-danger);
  }
  /* icon-only: keeps the height, font size and radius; width and padding are its own */
  .tc-btn.tc-btn--icon { width: ${HEIGHT}; padding: 0; border: none; }
  threads-discard-review sl-button::part(base) {
    ${BASE}
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: normal;
  }
  threads-discard-review sl-button::part(label) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  threads-discard-review sl-dialog::part(footer) {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
  }
`;

/** Add the base button styles to the page once. */
export function ensureButtonStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
