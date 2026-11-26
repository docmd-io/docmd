export function injectComponentStyles(): void {
  if (document.getElementById("tc-styles")) return;

  const style = document.createElement("style");
  style.id = "tc-styles";
  style.textContent = `
    /* ========= Design tokens ========= */
    :root {
      --tc-bg: var(--summer-surface, var(--bg-color, hsl(0 0% 100%)));
      --tc-fg: var(--summer-fg, var(--summer-text, var(--text-color, hsl(0 0% 9%))));
      --tc-muted: var(--summer-surface-3, var(--sidebar-bg, hsl(0 0% 96.1%)));
      --tc-muted-fg: var(--summer-fg-muted, var(--summer-text-muted, var(--text-muted, hsl(0 0% 45.1%))));
      --tc-border: var(--summer-border, var(--border-color, hsl(0 0% 89.8%)));
      --tc-input: var(--summer-border, var(--border-color, hsl(0 0% 89.8%)));
      --tc-ring: var(--summer-accent, var(--link-color, var(--primary-color, hsl(210 100% 55%))));
      --tc-accent: var(--summer-surface-2, var(--sidebar-bg, hsl(0 0% 96.1%)));
      --tc-accent-fg: var(--summer-fg, var(--summer-text, var(--text-color, hsl(0 0% 9%))));
      --tc-card: var(--summer-surface, var(--bg-color, hsl(0 0% 100%)));
      --tc-card-fg: var(--summer-fg, var(--summer-text, var(--text-color, hsl(0 0% 9%))));
      --tc-thread-bg: hsl(220 20% 98.2%);
      --tc-thread-border: hsl(220 18% 88%);
      --tc-radius: var(--summer-radius-lg, var(--radius-md, 8px));
      --tc-font: var(--summer-font-sans, var(--font-family-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif));
    }

    [data-theme="dark"], html.dark, body.dark, :root[data-theme="dark"] {
      --tc-bg: var(--summer-surface, var(--bg-color, hsl(0 0% 12%)));
      --tc-fg: var(--summer-fg, var(--summer-text, var(--text-color, hsl(0 0% 95%))));
      --tc-muted: var(--summer-surface-3, var(--sidebar-bg, hsl(0 0% 18%)));
      --tc-muted-fg: var(--summer-fg-muted, var(--summer-text-muted, var(--text-muted, hsl(0 0% 65%))));
      --tc-border: var(--summer-border, var(--border-color, hsl(0 0% 24%)));
      --tc-input: var(--summer-border, var(--border-color, hsl(0 0% 24%)));
      --tc-ring: var(--summer-accent, var(--link-color, var(--primary-color, hsl(210 100% 65%))));
      --tc-accent: var(--summer-surface-2, var(--sidebar-bg, hsl(0 0% 20%)));
      --tc-accent-fg: var(--summer-fg, var(--summer-text, var(--text-color, hsl(0 0% 95%))));
      --tc-card: var(--summer-surface, var(--bg-color, hsl(0 0% 14%)));
      --tc-card-fg: var(--summer-fg, var(--summer-text, var(--text-color, hsl(0 0% 95%))));
      --tc-thread-bg: hsl(220 15% 15.5%);
      --tc-thread-border: hsl(220 14% 24%);
    }

    /* ========= Semantic Threads Color System ========= */
    .threads-highlight {
      border-radius: 2px;
      padding: 1px 2px;
      cursor: pointer;
      transition: opacity 0.15s, background-color 0.15s;
    }
    .threads-highlight:hover { opacity: 0.8; }

    /* Published / Pushed to Git: Blue */
    .threads-hl-published,
    .threads-hl-blue {
      background: hsl(210 100% 88% / 0.65);
      border-bottom: 2px solid hsl(210 100% 55%);
    }
    .threads-border-published,
    .threads-border-blue {
      border-left-color: hsl(210 100% 55%) !important;
    }

    /* Pending Publishing / Local Drafts: Warm Amber / Orange */
    .threads-hl-draft,
    .threads-hl-orange,
    .threads-hl-yellow {
      background: hsl(38 92% 50% / 0.22);
      border-bottom: 2px solid hsl(38 92% 50%);
    }
    .threads-border-draft,
    .threads-border-orange,
    .threads-border-yellow {
      border-left-color: hsl(38 92% 50%) !important;
    }

    /* Resolved: Green / Subtle Muted */
    .threads-hl-resolved,
    .threads-hl-green {
      background: hsl(142 60% 82% / 0.4);
      border-bottom: 2px solid hsl(142 60% 45%);
    }
    .threads-border-resolved,
    .threads-border-green {
      border-left-color: hsl(142 60% 45%) !important;
    }

    /* Fallback aliases for pink/purple if encountered */
    .threads-hl-pink   { background: hsl(340 80% 88% / 0.55); border-bottom: 2px solid hsl(340 80% 55%); }
    .threads-hl-purple { background: hsl(270 70% 88% / 0.55); border-bottom: 2px solid hsl(270 70% 55%); }
    .threads-border-pink   { border-left-color: hsl(340 80% 55%) !important; }
    .threads-border-purple { border-left-color: hsl(270 70% 55%) !important; }

    /* Dark mode adjustments */
    [data-theme="dark"] .threads-hl-published,
    [data-theme="dark"] .threads-hl-blue {
      background: hsl(210 100% 55% / 0.25);
      border-bottom: 2px solid hsl(210 100% 65%);
    }
    [data-theme="dark"] .threads-hl-draft,
    [data-theme="dark"] .threads-hl-orange,
    [data-theme="dark"] .threads-hl-yellow {
      background: hsl(38 92% 50% / 0.28);
      border-bottom: 2px solid hsl(38 92% 55%);
    }
    [data-theme="dark"] .threads-hl-resolved,
    [data-theme="dark"] .threads-hl-green {
      background: hsl(142 60% 45% / 0.25);
      border-bottom: 2px solid hsl(142 60% 55%);
    }

    /* ========= Layout: fixed right sidebar column ========= */
    .tc-sidebar-column {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 0;
      z-index: 3000;
      display: flex;
      flex-direction: column;
      pointer-events: none;
      transition: width 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: var(--tc-font);
    }

    body.tc-panel-open .tc-sidebar-column {
      width: 380px;
      pointer-events: auto;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.16);
    }

    body.tc-has-sidebar main,
    body.tc-has-sidebar .summer-main {
      max-width: 1440px;
    }

    body.tc-has-sidebar .main-content-wrapper,
    body.tc-has-sidebar .summer-layout {
      margin-right: 0;
      transition: margin-right 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    body.tc-panel-open .main-content-wrapper,
    body.tc-panel-open .summer-layout {
      margin-right: 380px;
    }

    @media (max-width: 1400px) {
      body.tc-panel-open .toc-sidebar,
      body.tc-panel-open .summer-toc {
        display: none;
      }
    }

    /* ========= Legacy Toggle strip (hidden in favor of floating notch) ========= */
    .tc-sidebar-toggle {
      display: none !important;
    }

    /* ========= Panel ========= */
    .tc-panel {
      flex: 1;
      min-height: 0;
      width: 380px;
      background: var(--tc-bg);
      border-left: 1px solid var(--tc-border);
      display: flex;
      flex-direction: column;
      animation: tc-slide-in 0.2s ease;
    }
    @keyframes tc-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .tc-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 12px;
      border-bottom: 1px solid var(--tc-border);
    }
    .tc-panel__title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      color: var(--tc-fg);
      letter-spacing: -0.01em;
    }
    .tc-panel__header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .tc-panel__filters {
      display: flex;
      gap: 4px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--tc-border);
    }
    .tc-panel__tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--tc-border); }
    .tc-panel__tab {
      background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
      color: var(--tc-muted-fg); font: inherit; font-size: 13px; padding: 6px 8px;
    }
    .tc-panel__tab[aria-selected="true"] { color: var(--tc-fg); border-bottom-color: var(--tc-ring); }
    .tc-reviews { padding: 8px 16px; display: flex; flex-direction: column; gap: 10px; font-family: var(--tc-font); color: var(--tc-fg); }
    .tc-reviews__error { color: var(--tc-muted-fg); font-size: 12px; border: 1px solid var(--tc-border); border-radius: 6px; padding: 6px 8px; }
    .tc-review { border: 1px solid var(--tc-border); border-radius: var(--tc-radius); padding: 10px 12px; background: var(--tc-card); }
    .tc-review--discarded { opacity: 0.55; }
    .tc-review__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .tc-review__title { font-weight: 600; font-size: 13px; }
    .tc-review__badge { font-size: 11px; color: var(--tc-muted-fg); border: 1px solid var(--tc-border); border-radius: 999px; padding: 0 8px; }
    .tc-review__meta { font-size: 12px; color: var(--tc-muted-fg); margin: 2px 0 6px; }
    .tc-review__ops { margin: 0 0 4px; padding-left: 16px; font-size: 12px; }
    .tc-review__link { color: var(--tc-ring); text-decoration: none; }
    .tc-review__link:hover { text-decoration: underline; }
    .tc-panel__body {
      flex: 1;
      min-height: 0; /* scroll inside the panel so the review section stays pinned below the list */
      overflow-y: auto;
      padding: 8px 0;
    }

    .tc-panel__group-title {
      padding: 12px 16px 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tc-muted-fg);
    }

    /* Unpublished-comment count on the FAB and the toggle strip, apart from the open-threads badge. */
    .tc-unpublished-marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 5px;
      border-radius: 999px;
      background: hsl(38 92% 50%);
      color: #1c1917;
      font-size: 10px;
      font-weight: 700;
      line-height: 16px;
      text-align: center;
      font-family: var(--tc-font);
      box-sizing: border-box;
      pointer-events: none;
    }
    .threads-fab__badge-wrap .tc-unpublished-marker {
      border-radius: 999px;
      border-left: none;
    }
    .threads-fab__badge-wrap .tc-unpublished-marker:only-child {
      border-radius: 999px;
      border-left: none;
    }
    .threads-fab__badge-wrap .threads-fab__badge {
      border-radius: 999px;
    }
    .threads-fab__badge-wrap .threads-fab__badge:only-child {
      border-radius: 999px;
    }

    /* ========= Empty state ========= */
    .tc-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--tc-muted-fg);
      padding: 48px 24px;
      font-size: 14px;
      line-height: 1.6;
    }

    /* ========= Thread (shadcn card) ========= */
    .tc-thread {
      margin: 0 8px 6px;
      border: 1px solid var(--tc-border);
      border-radius: var(--tc-radius);
      overflow: hidden;
      background: var(--tc-card);
      transition: box-shadow 0.15s;
    }
    .tc-thread:hover {
      box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    }
    .tc-thread--focused {
      border-color: var(--tc-ring);
      box-shadow: 0 0 0 1px var(--tc-ring);
    }
    .tc-thread--resolved { opacity: 0.6; }
    .tc-thread__quote {
      padding: 10px 14px;
      border-left: 2px solid var(--tc-border);
      margin: 10px 14px 0;
      cursor: pointer;
      border-radius: 0;
      background: var(--tc-muted);
      transition: background 0.15s;
    }
    .tc-thread__quote:hover {
      background: color-mix(in srgb, var(--tc-muted) 80%, var(--tc-fg) 20%);
    }
    .tc-thread__quote-text {
      font-size: 13px;
      color: var(--tc-muted-fg);
      line-height: 1.5;
      font-style: italic;
    }
    .tc-thread__comments {
      padding: 2px 0;
    }
    .tc-thread__reply {
      border-top: 1px solid var(--tc-border);
    }
    .tc-thread__footer {
      display: flex;
      gap: 2px;
      padding: 6px 10px 8px;
      border-top: 1px solid var(--tc-border);
    }

    /* ========= Comment ========= */
    .tc-comment {
      padding: 10px 14px;
    }
    .tc-comment + .tc-comment {
      border-top: 1px solid var(--tc-border);
    }
    .tc-comment__header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .tc-comment__meta {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .tc-comment__author {
      font-weight: 500;
      font-size: 13px;
      color: var(--tc-fg);
      line-height: 1.2;
    }
    .tc-comment__time {
      font-size: 11px;
      color: var(--tc-muted-fg);
      line-height: 1.2;
    }
    .tc-comment__draft {
      align-self: flex-start;
      margin-top: 2px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid var(--tc-border);
      color: var(--tc-muted-fg);
      font-size: 11px;
      line-height: 1.5;
    }
    .tc-comment__menu {
      display: flex;
      gap: 1px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .tc-comment:hover .tc-comment__menu {
      opacity: 1;
    }
    .tc-comment__body {
      font-size: 14px;
      line-height: 1.6;
      color: var(--tc-fg);
      margin-left: 34px;
    }
    .tc-comment__body p { margin: 0 0 4px 0; }
    .tc-comment__body p:last-child { margin-bottom: 0; }
    .tc-comment__body code {
      background: var(--tc-muted);
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 12px;
    }
    .tc-comment__body pre {
      background: var(--tc-muted);
      padding: 8px 12px;
      border-radius: var(--tc-radius);
      overflow-x: auto;
      font-size: 12px;
    }
    .tc-comment__footer {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: 34px;
      margin-top: 4px;
    }
    .tc-comment__actions {
      display: flex;
      gap: 1px;
    }

    /* ========= Reactions ========= */
    .tc-reactions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tc-reaction {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--tc-border);
      background: var(--tc-bg);
      cursor: pointer;
      font-size: 13px;
      line-height: 1.4;
      transition: all 0.15s;
    }
    .tc-reaction:hover {
      background: var(--tc-accent);
      border-color: var(--tc-input);
    }
    .tc-reaction--active {
      background: var(--tc-accent);
      border-color: var(--tc-fg);
    }
    .tc-reaction__count {
      font-size: 11px;
      font-weight: 500;
      color: var(--tc-muted-fg);
    }

    /* ========= Emoji picker item (used inside sl-popup) ========= */
    .tc-emoji-picker__item {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      border-radius: var(--tc-radius);
      cursor: pointer;
      font-size: 16px;
      transition: background 0.1s;
    }
    .tc-emoji-picker__item:hover {
      background: var(--tc-accent);
    }

    /* ========= Compose ========= */
    .tc-compose {
      padding: 10px 14px;
    }
    .tc-compose__quote {
      padding: 8px 12px;
      border-left: 2px solid var(--tc-border);
      background: var(--tc-muted);
      border-radius: 0;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--tc-muted-fg);
      font-style: italic;
      line-height: 1.4;
    }
    .tc-compose__actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      justify-content: flex-end;
    }
    .tc-compose sl-textarea,
    .tc-thread__reply sl-textarea,
    .threads-thread sl-textarea {
      width: 100% !important;
      display: block;
      box-sizing: border-box;
    }
    /* Force sl-textarea internal textarea to expand */
    .tc-compose sl-textarea::part(base),
    .tc-compose sl-textarea::part(textarea),
    .tc-thread__reply sl-textarea::part(base),
    .tc-thread__reply sl-textarea::part(textarea),
    .threads-thread sl-textarea::part(base),
    .threads-thread sl-textarea::part(textarea) {
      width: 100% !important;
      min-width: 0;
      box-sizing: border-box;
    }
    .threads-thread .tc-compose {
      width: 100%;
      box-sizing: border-box;
    }

    /* ========= New thread compose ========= */
    .tc-new-thread {
      margin: 0 8px 6px;
      border: 1px solid var(--tc-border);
      border-radius: var(--tc-radius);
      overflow: hidden;
      background: var(--tc-card);
    }

    /* ========= Server-rendered threads wrapper ========= */
    .threads-sidebar {
      margin: 24px 0 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .threads-sidebar--labeled {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--tc-border);
    }
    .threads-sidebar__heading {
      font-family: var(--tc-font);
      font-size: 13px;
      font-weight: 600;
      color: var(--tc-muted-fg);
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    /* ========= Thread card ========= */
    .threads-thread {
      margin: 14px 0 18px;
      border: 1px solid var(--tc-thread-border, var(--tc-border));
      border-radius: 10px;
      background: var(--tc-thread-bg, var(--tc-card));
      overflow: hidden;
      font-family: var(--tc-font);
      box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.06), 0 1px 4px -1px rgba(0, 0, 0, 0.04);
      transition: all 0.18s ease;
    }
    .threads-thread:hover {
      box-shadow: 0 4px 14px -2px rgba(0, 0, 0, 0.09), 0 2px 6px -1px rgba(0, 0, 0, 0.05);
    }

    /* In-page thread cards: thinner 2.5px colored differentiator */
    .threads-thread:not(.tc-panel .threads-thread),
    .threads-thread--inline {
      margin: 16px 0 22px;
      max-width: 740px;
      border-left-width: 2.5px !important;
      border-left-style: solid !important;
    }
    body.tc-panel-open .threads-thread--inline {
      display: none !important;
    }

    /* Sidebar panel thread cards: no colored left border needed */
    .tc-panel .threads-thread {
      margin: 0 8px 10px;
      border: 1px solid var(--tc-border);
      border-left: 1px solid var(--tc-border) !important;
      border-radius: 8px;
      background: var(--tc-card);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .tc-panel .threads-thread:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .threads-thread--resolved {
      opacity: 0.7;
    }

    /* Anchor Quote Badge & In-page blockquote.threads-anchor */
    blockquote.threads-anchor,
    .threads-thread__quote-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      margin: 0;
      background: color-mix(in srgb, var(--tc-muted) 80%, var(--tc-bg));
      border: none;
      border-bottom: 1px solid var(--tc-thread-border, var(--tc-border));
      font-size: 11.5px;
      color: var(--tc-muted-fg);
      font-style: italic;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    blockquote.threads-anchor:hover,
    .threads-thread__quote-badge:hover {
      background: color-mix(in srgb, var(--tc-muted) 92%, var(--tc-ring) 8%);
    }
    blockquote.threads-anchor::before {
      content: "";
      display: inline-block;
      width: 13px;
      height: 13px;
      flex-shrink: 0;
      background-color: var(--tc-ring);
      opacity: 0.85;
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z'/%3E%3Cpath d='M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z'/%3E%3C/svg%3E") no-repeat center;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z'/%3E%3Cpath d='M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z'/%3E%3C/svg%3E") no-repeat center;
      -webkit-mask-size: contain;
      mask-size: contain;
    }
    .threads-thread__quote-text {
      font-weight: 500;
      color: var(--tc-fg);
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .threads-thread__open-panel-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      color: var(--tc-ring);
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .threads-thread__open-panel-btn:hover {
      background: var(--tc-border);
    }

    /* ========= Comment item (flex layout, no grid collisions) ========= */
    .threads-comment {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 10px;
      font-size: 13px;
      box-sizing: border-box;
    }
    .threads-comment--reply {
      padding: 4px 0 !important;
      gap: 6px;
    }

    /* Avatar column */
    .threads-comment__avatar-col {
      flex-shrink: 0;
      width: 24px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 1px;
    }
    .threads-comment__avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .threads-comment--reply .threads-comment__avatar {
      width: 20px;
      height: 20px;
      font-size: 10px;
    }

    /* Main content column: meta -> body -> reactions -> replies */
    .threads-comment__content {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .threads-comment__meta {
      display: flex;
      align-items: center;
      font-size: 11.5px;
      color: var(--tc-muted-fg);
      gap: 6px;
      width: 100%;
    }
    .threads-comment__meta strong,
    .threads-comment__meta .threads-comment__author {
      color: var(--tc-fg);
      font-weight: 600;
    }
    .threads-comment__meta .threads-comment__date {
      color: var(--tc-muted-fg);
      font-size: 11.5px;
    }
    .threads-comment__meta .threads-comment__sep {
      color: var(--tc-muted-fg);
      opacity: 0.6;
    }

    /* Sidebar drawer comments: 2-line header right next to avatar */
    .tc-panel .threads-comment__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
      row-gap: 1px;
      column-gap: 4px;
      line-height: 1.25;
      font-size: 11px;
    }
    .tc-panel .threads-comment__meta strong,
    .tc-panel .threads-comment__meta .threads-comment__author {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--tc-fg);
      order: 1;
    }
    .tc-panel .threads-comment__meta .threads-comment__actions {
      margin-left: auto;
      order: 2;
    }
    .tc-panel .threads-comment__meta .threads-comment__sep {
      display: none !important;
    }
    .tc-panel .threads-comment__meta .threads-comment__date {
      display: block;
      width: 100%;
      order: 3;
      font-size: 11px;
      color: var(--tc-muted-fg);
      font-weight: 400;
      margin-top: 1px;
    }

    /* In-page comments: single line header right next to avatar */
    .threads-comment:not(.tc-panel .threads-comment) .threads-comment__meta {
      display: flex;
      align-items: center;
      gap: 6px;
      line-height: 1.4;
      font-size: 12px;
    }
    .threads-comment:not(.tc-panel .threads-comment) .threads-comment__meta strong,
    .threads-comment:not(.tc-panel .threads-comment) .threads-comment__meta .threads-comment__author {
      font-size: 13px;
      font-weight: 600;
      color: var(--tc-fg);
    }
    .threads-comment:not(.tc-panel .threads-comment) .threads-comment__meta .threads-comment__actions {
      margin-left: auto;
    }

    .threads-comment__actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      flex-shrink: 0;
    }
    .threads-comment__actions button {
      background: none;
      border: 1px solid transparent;
      cursor: pointer;
      color: var(--tc-muted-fg);
      padding: 2px 6px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11.5px;
      transition: all 0.15s;
    }
    .threads-comment__actions button:hover {
      color: var(--tc-fg);
      background: var(--tc-muted);
      border-color: var(--tc-border);
    }
    .threads-comment__actions .threads-delete-btn:hover {
      color: hsl(0 75% 55%);
      background: hsl(0 75% 55% / 0.08);
      border-color: hsl(0 75% 55% / 0.2);
    }

    .threads-comment__body {
      color: var(--tc-fg);
      line-height: 1.5;
      font-size: 13px;
      word-break: break-word;
    }
    .threads-comment__body p {
      margin: 0 0 4px 0;
    }
    .threads-comment__body p:last-child {
      margin-bottom: 0;
    }

    /* ========= Emoji reactions on comments: dedicated line ========= */
    .threads-comment__reactions-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      margin-top: 5px;
      margin-bottom: 2px;
      width: 100%;
      clear: both;
    }
    .threads-reaction-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--tc-border);
      background: var(--tc-card);
      font-size: 12px;
      line-height: 1.35;
      color: var(--tc-fg);
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      font-family: var(--tc-font);
    }
    .threads-reaction-pill:hover {
      border-color: var(--tc-ring);
      background: color-mix(in srgb, var(--tc-muted) 80%, var(--tc-ring) 20%);
    }
    .threads-reaction-pill--active {
      border-color: var(--tc-ring);
      background: color-mix(in srgb, var(--tc-ring) 14%, var(--tc-card));
      color: var(--tc-ring);
      font-weight: 600;
    }
    .threads-reaction-pill__count {
      font-size: 11px;
      opacity: 0.85;
    }
    .threads-add-reaction-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 1px dashed var(--tc-border);
      background: transparent;
      color: var(--tc-muted-fg);
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s ease;
      padding: 0;
    }
    .threads-add-reaction-btn:hover {
      border-color: var(--tc-ring);
      color: var(--tc-fg);
      background: var(--tc-muted);
    }
    .threads-emoji-popover {
      position: absolute;
      z-index: 3500;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
      background: var(--tc-card);
      border: 1px solid var(--tc-border);
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
      animation: tc-popover-in 0.12s ease-out;
    }
    @keyframes tc-popover-in {
      from { opacity: 0; transform: scale(0.92) translateY(-4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .threads-emoji-popover__btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 4px 5px;
      border-radius: 5px;
      transition: background 0.12s, transform 0.12s;
    }
    .threads-emoji-popover__btn:hover {
      background: var(--tc-muted);
      transform: scale(1.25);
    }

    /* ========= Nested replies tree ========= */
    .threads-replies {
      margin-top: 6px;
      padding-left: 8px;
      border-left: 1.5px solid var(--tc-border);
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
    }

    /* ========= Collapsed thread ========= */
    .threads-thread__summary {
      display: none;
      font-size: 13px;
      color: var(--tc-muted-fg);
      font-style: italic;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .threads-thread--collapsed .threads-thread__summary {
      display: block;
    }
    .threads-thread--collapsed .threads-comment,
    .threads-thread--collapsed .threads-replies {
      display: none;
    }
    .threads-thread--collapsed .threads-new-comment-btn {
      display: none;
    }
    .threads-thread--collapsed .threads-thread__footer {
      border-top: none;
    }

    /* ========= Thread footer & buttons ========= */
    .threads-thread__footer {
      display: flex;
      align-items: center;
      padding: 8px 14px;
      background: color-mix(in srgb, var(--tc-card) 95%, var(--tc-muted));
      border-top: 1px solid var(--tc-border);
      gap: 8px;
    }
    .threads-new-comment-btn {
      background: var(--tc-muted);
      border: 1px solid var(--tc-border);
      color: var(--tc-fg);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
    }
    .threads-new-comment-btn:hover {
      background: var(--tc-border);
      border-color: var(--tc-ring);
    }
    .threads-resolve-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 4px;
      margin-left: auto;
      transition: all 0.15s;
    }
    .threads-resolve-btn:hover {
      background: var(--tc-muted);
    }
    .threads-new-comment-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border: 1px dashed var(--tc-border);
      background: transparent;
      color: var(--tc-muted-fg);
      font-family: var(--tc-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border-radius: var(--tc-radius);
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .threads-new-comment-btn:hover {
      color: var(--tc-fg);
      border-color: var(--tc-fg);
      background: var(--tc-muted);
    }



    /* ========= Per-comment reply button ========= */
    .threads-comment-reply-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: transparent;
      border: none;
      color: var(--tc-muted-fg);
      font-family: var(--tc-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      border-radius: var(--tc-radius);
    }
    .threads-comment:hover .threads-comment-reply-btn {
      opacity: 0.6;
    }
    .threads-comment-reply-btn:hover {
      opacity: 1 !important;
      color: var(--tc-fg);
      background: var(--tc-muted);
    }

    /* ========= Server-rendered reactions ========= */
    .threads-reactions {
      margin-top: 8px;
    }
    .threads-reactions ul {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .threads-reactions li {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--tc-border);
      background: var(--tc-muted);
      font-size: 13px;
      line-height: 1;
      cursor: default;
      transition: background 0.15s, border-color 0.15s;
      user-select: none;
    }
    .threads-reactions li:hover {
      background: var(--tc-accent);
      border-color: var(--tc-input);
    }

    /* ========= Heading discussion button (hidden) ========= */
    .threads-heading-discuss { display: none !important; }
    .threads-heading-discuss-OFF {
      float: right;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: none;
      background: transparent;
      color: transparent;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border-radius: var(--tc-radius);
      transition: color 0.15s, background 0.15s;
      vertical-align: middle;
    }
    *:hover > .threads-heading-discuss {
      color: var(--tc-muted-fg);
    }
    .threads-heading-discuss:hover {
      color: var(--tc-accent-fg);
      background: var(--tc-accent);
    }

    /* ========= Heading wrapper for New Thread button ========= */
    .threads-heading-wrap {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 12px;
    }
    .docmd-focus-title.threads-heading-wrap:not(body.focus-mode *) {
      display: none !important;
    }
    .threads-heading-wrap .threads-new-thread-btn {
      margin-left: auto;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.2s ease, background 0.15s, color 0.15s, border-color 0.15s;
    }
    .threads-heading-wrap:hover .threads-new-thread-btn,
    .threads-heading-wrap:focus-within .threads-new-thread-btn {
      opacity: 1;
    }

    /* ========= New Thread button ========= */
    .threads-new-thread-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      font-family: var(--tc-font);
      font-size: 12px;
      font-weight: 500;
      color: var(--tc-muted-fg);
      background: var(--tc-card);
      border: 1px dashed var(--tc-border);
      border-radius: var(--tc-radius);
      cursor: pointer;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
      transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.15s;
    }
    .threads-new-thread-btn:hover {
      color: var(--tc-fg);
      border-color: var(--tc-ring);
      background: var(--tc-muted);
      transform: translateY(-1px);
    }

    /* ========= Delete button (on comment meta) ========= */
    .threads-delete-btn {
      display: inline-flex;
      align-items: center;
      padding: 3px 6px;
      background: transparent;
      border: none;
      color: var(--tc-muted-fg);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      border-radius: var(--tc-radius);
    }
    .threads-comment:hover .threads-delete-btn {
      opacity: 0.6;
    }
    .threads-delete-btn:hover {
      opacity: 1 !important;
      color: hsl(0 72% 51%);
      background: hsl(0 72% 51% / 0.08);
    }

    /* ========= Collapse/expand toggle button ========= */
    .threads-collapse-btn {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      padding: 3px 6px;
      background: transparent;
      border: none;
      color: var(--tc-muted-fg);
      cursor: pointer;
      border-radius: var(--tc-radius);
      transition: color 0.15s, background 0.15s;
    }
    .threads-collapse-btn:hover {
      color: var(--tc-fg);
      background: var(--tc-muted);
    }

    /* ========= Thread flash animation (on highlight click) ========= */
    .threads-thread--flash {
      animation: tc-flash 2s ease-out;
    }
    @keyframes tc-flash {
      0%   { outline: 2px solid var(--tc-ring); outline-offset: 4px; }
      100% { outline: 2px solid transparent; outline-offset: 8px; }
    }

    /* ========= Identity button & dropdown ========= */
    threads-identity {
      position: relative;
      display: flex;
      align-items: center;
      font-family: var(--tc-font);
    }
    .threads-identity-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid var(--tc-border);
      background: var(--tc-card);
      cursor: pointer;
      padding: 0;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .threads-identity-btn:hover {
      border-color: var(--tc-ring);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--tc-ring) 20%, transparent);
    }
    .threads-identity-avatar {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .threads-identity-initial {
      font-size: 14px;
      font-weight: 600;
      color: var(--tc-fg);
      line-height: 1;
    }

    /* ========= Dropdown panel ========= */
    .threads-identity-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 260px;
      background: var(--tc-card);
      border: 1px solid var(--tc-border);
      border-radius: var(--tc-radius);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.12), 0 1px 3px rgb(0 0 0 / 0.08);
      padding: 14px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      animation: tc-panel-drop 0.15s ease;
    }
    @keyframes tc-panel-drop {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .threads-identity-preview {
      display: flex;
      justify-content: center;
      margin-bottom: 4px;
    }
    .threads-identity-preview-img {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--tc-border);
    }
    .threads-identity-preview-placeholder {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 2px solid var(--tc-border);
      background: var(--tc-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 600;
      color: var(--tc-muted-fg);
    }
    .threads-identity-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      font-weight: 500;
      color: var(--tc-fg);
    }
    .threads-identity-input {
      padding: 6px 10px;
      border: 1px solid var(--tc-border);
      border-radius: var(--tc-radius);
      background: var(--tc-bg);
      color: var(--tc-fg);
      font-family: var(--tc-font);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    .threads-identity-input:focus {
      border-color: var(--tc-ring);
    }
    .threads-identity-hint {
      font-size: 11px;
      color: var(--tc-muted-fg);
      margin: 0;
      line-height: 1.4;
    }
    .threads-identity-hint a {
      color: var(--tc-muted-fg);
      text-decoration: underline;
    }
    .threads-identity-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 2px;
    }
    .threads-identity-cancel,
    .threads-identity-save {
      padding: 4px 12px;
      border-radius: var(--tc-radius);
      font-family: var(--tc-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .threads-identity-cancel {
      background: transparent;
      border: 1px solid var(--tc-border);
      color: var(--tc-muted-fg);
    }
    .threads-identity-cancel:hover {
      border-color: var(--tc-fg);
      color: var(--tc-fg);
    }
    .threads-identity-save {
      background: var(--tc-fg);
      border: 1px solid var(--tc-fg);
      color: var(--tc-bg);
    }
    .threads-identity-save:hover {
      opacity: 0.85;
    }

    /* ========= Sidebar column: hidden by default, shown via body.tc-sidebar-active or body.tc-panel-open ========= */
    .tc-sidebar-column { display: none; }
    body.tc-sidebar-active .tc-sidebar-column,
    body.tc-panel-open .tc-sidebar-column { display: flex; }
    body.tc-panel-open .tc-sidebar-column {
      width: 380px;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.18);
    }
    body.tc-sidebar-active .threads-sidebar { display: none !important; }
    body.tc-sidebar-active .tc-has-sidebar { padding-right: 40px; }

    /* Hide TOC when threads sidebar panel is open so the main content area has more room */
    body.tc-panel-open .toc-sidebar,
    body.tc-panel-open .summer-toc,
    body.tc-panel-open .toc-container {
      display: none !important;
    }

    /* ========= Floating threads toggle / right-docked notch ========= */
    .threads-fab {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      opacity: 0.88;
      z-index: 2900;
      width: 38px;
      height: 44px;
      border-radius: 8px 0 0 8px;
      border: 1px solid var(--tc-border);
      border-right: none;
      background: var(--tc-card);
      color: var(--tc-muted-fg);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: -2px 2px 10px rgba(0, 0, 0, 0.08);
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, color 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.2s ease;
      padding: 0;
    }
    .threads-fab:hover {
      width: 48px;
      opacity: 1;
      color: var(--tc-fg);
      border-color: var(--tc-ring);
      box-shadow: -4px 4px 16px rgba(0, 0, 0, 0.16);
    }
    body.tc-panel-open .threads-fab {
      opacity: 0;
      pointer-events: none;
      transform: translateY(-50%) translateX(48px);
    }
    .threads-fab__badge-wrap {
      position: absolute;
      top: -6px;
      left: -8px;
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      overflow: hidden;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
      pointer-events: none;
      z-index: 1;
    }
    .threads-fab__badge {
      display: inline-block;
      min-width: 16px;
      height: 16px;
      padding: 0 5px;
      background: var(--tc-ring);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      line-height: 16px;
      text-align: center;
      font-family: var(--tc-font);
    }

    /* Template-specific styling touches */
    body:has(.summer-layout) .threads-thread,
    body.summer-template .threads-thread {
      border-radius: var(--summer-radius, 14px);
      border-color: var(--tc-thread-border);
      background: var(--tc-thread-bg);
    }
    body:has(.summer-layout) .threads-thread__quote-badge,
    body.summer-template .threads-thread__quote-badge {
      background: color-mix(in srgb, var(--summer-surface-2) 80%, var(--tc-bg));
      border-color: var(--tc-thread-border);
    }
    body:has(.summer-layout) .threads-new-thread-btn,
    body.summer-template .threads-new-thread-btn {
      border-radius: 999px;
      font-family: var(--summer-font-sans, inherit);
    }
    body:has(.summer-layout) .threads-new-thread-btn:hover,
    body.summer-template .threads-new-thread-btn:hover {
      border-color: var(--summer-accent);
      color: var(--summer-accent);
      background: color-mix(in srgb, var(--summer-accent) 8%, transparent);
    }
    body:has(.summer-layout) .threads-comment-reply-btn:hover,
    body.summer-template .threads-comment-reply-btn:hover {
      color: var(--summer-accent);
    }
    body:has(.summer-layout) .threads-fab,
    body.summer-template .threads-fab {
      border-color: var(--summer-border);
      background: var(--summer-surface);
      color: var(--summer-fg-muted);
    }
    body:has(.summer-layout) .threads-fab:hover,
    body.summer-template .threads-fab:hover {
      border-color: var(--summer-accent);
      color: var(--summer-accent);
      background: var(--summer-surface-2);
    }
    body:has(.summer-layout) .threads-fab__badge,
    body.summer-template .threads-fab__badge {
      background: var(--summer-accent);
      color: #000;
    }
    body:has(.summer-layout) .tc-panel__title,
    body.summer-template .tc-panel__title {
      font-family: var(--summer-font-sans, inherit);
    }

    /* Default template styles */
    body:not(:has(.summer-layout)):not(.summer-template) .threads-fab {
      border-color: var(--border-color, hsl(0 0% 88%));
      background: var(--sidebar-bg, var(--bg-color, #fff));
      color: var(--text-muted, hsl(0 0% 45%));
    }
    body:not(:has(.summer-layout)):not(.summer-template) .threads-fab:hover {
      border-color: var(--link-color, var(--primary-color, hsl(215 85% 50%)));
      color: var(--link-color, var(--primary-color, hsl(215 85% 50%)));
    }
    body:not(:has(.summer-layout)):not(.summer-template) .threads-fab__badge {
      background: var(--link-color, var(--primary-color, hsl(215 85% 50%)));
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}