import { injectComponentStyles } from '../components/styles';

const THEME_STYLE_ID = 'threads-theme-bridge';

export function initThemeBridge(): void {
  injectThemeCSS();
  syncDarkMode();
  observeThemeChanges();
  injectComponentStyles();
}

function injectThemeCSS(): void {
  if (document.getElementById(THEME_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = `
    :root {
      --sl-color-neutral-0: var(--threads-surface);
      --sl-color-neutral-50: var(--threads-surface-muted);
      --sl-color-neutral-200: var(--threads-border);
      --sl-color-neutral-900: var(--threads-fg);
      --sl-color-neutral-500: var(--threads-fg-muted);
      --sl-color-primary-600: var(--threads-fg);
      --sl-color-primary-50: var(--threads-surface-muted);
      --sl-focus-ring-color: var(--threads-focus);
      --sl-font-sans: var(--threads-font);
      --sl-font-mono: var(--threads-font-mono);
    }

  `;
  document.head.appendChild(style);
}

function syncDarkMode(): void {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.classList.toggle('sl-theme-dark', isDark);
}

function observeThemeChanges(): void {
  const observer = new MutationObserver(() => syncDarkMode());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
