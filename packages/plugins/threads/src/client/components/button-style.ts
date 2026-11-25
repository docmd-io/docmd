/**
 * The one base button style of the review UI: the review section's Publish, Save and play/pause, the Discard
 * trigger, and the buttons of the discard confirmation. Size, padding, font and radius are declared here once;
 * a component adds `tc-btn` to its own `<button>` (plus a variant) and gets the Shoelace buttons inside
 * `threads-discard-review` through the same declarations.
 */

const STYLE_ID = 'tc-button-styles';

const HEIGHT = '28px';

const BASE = `
  box-sizing: border-box;
  height: ${HEIGHT};
  min-height: 0;
  padding: 0 12px;
  font-family: var(--tc-font, var(--docmd-font-family, inherit));
  font-size: 13px;
  line-height: 1;
  border-radius: 6px;
`;

const CSS = `
  .tc-btn {
    ${BASE}
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--sl-color-neutral-300, currentColor);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .tc-btn:disabled { opacity: 0.5; cursor: default; }
  .tc-btn--primary {
    border-color: var(--sl-color-primary-600, currentColor);
    background: var(--sl-color-primary-600, transparent);
    color: var(--sl-color-neutral-0, inherit);
  }
  .tc-btn--danger {
    border-color: var(--sl-color-danger-600, currentColor);
    color: var(--sl-color-danger-600, inherit);
  }
  /* icon-only: keeps the height, font size and radius; width and padding are its own */
  .tc-btn.tc-btn--icon { width: ${HEIGHT}; padding: 0; border: none; }
  threads-discard-review sl-button::part(base) {
    ${BASE}
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
