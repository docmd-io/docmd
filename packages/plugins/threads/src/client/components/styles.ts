export function injectComponentStyles(): void {
  if (document.getElementById("tc-styles")) return;

  const style = document.createElement("style");
  style.id = "tc-styles";
  style.textContent = `
    /* ========= Highlight colors (cycling palette) ========= */
    .threads-highlight {
      color: inherit;
      border-radius: 2px;
      padding: 1px 0;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .threads-highlight:hover { opacity: 0.75; }

    .threads-hl-yellow  { background: var(--threads-hl-yellow); border-bottom: 2px solid var(--threads-hl-yellow-strong); }
    .threads-hl-blue    { background: var(--threads-hl-blue); border-bottom: 2px solid var(--threads-hl-blue-strong); }
    .threads-hl-green   { background: var(--threads-hl-green); border-bottom: 2px solid var(--threads-hl-green-strong); }
    .threads-hl-pink    { background: var(--threads-hl-pink); border-bottom: 2px solid var(--threads-hl-pink-strong); }
    .threads-hl-purple  { background: var(--threads-hl-purple); border-bottom: 2px solid var(--threads-hl-purple-strong); }
    .threads-hl-orange  { background: var(--threads-hl-orange); border-bottom: 2px solid var(--threads-hl-orange-strong); }

    /* Matching left-border colors for thread cards */
    .threads-border-yellow { border-left-color: var(--threads-hl-yellow-strong) !important; }
    .threads-border-blue   { border-left-color: var(--threads-hl-blue-strong) !important; }
    .threads-border-green  { border-left-color: var(--threads-hl-green-strong) !important; }
    .threads-border-pink   { border-left-color: var(--threads-hl-pink-strong) !important; }
    .threads-border-purple { border-left-color: var(--threads-hl-purple-strong) !important; }
    .threads-border-orange { border-left-color: var(--threads-hl-orange-strong) !important; }

    /* ========= Layout: fixed right sidebar column ========= */
    .tc-sidebar-column {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 40px;
      z-index: var(--threads-z-panel);
      flex-direction: column;
      transition: width 0.2s ease;
      font-family: var(--threads-font);
    }

    body.tc-has-sidebar main,
    body.tc-has-sidebar .summer-main {
      max-width: 1440px;
    }

    body.tc-has-sidebar .main-content-wrapper,
    body.tc-has-sidebar .summer-layout {
      margin-right: 40px;
      transition: margin-right 0.2s ease;
    }
    body.tc-panel-open .main-content-wrapper,
    body.tc-panel-open .summer-layout {
      margin-right: var(--threads-panel-width);
    }

    @media (max-width: 1400px) {
      body.tc-panel-open .toc-sidebar,
      body.tc-panel-open .summer-toc {
        display: none;
      }
    }

    /* ========= Toggle strip ========= */
    .tc-sidebar-toggle {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      width: 40px;
      height: 100%;
      cursor: pointer;
      border: none;
      background: var(--threads-surface);
      color: var(--threads-fg-muted);
      border-left: 1px solid var(--threads-border);
      transition: color 0.15s, background 0.15s;
      position: relative;
      padding: 16px 0 0 0;
    }
    .tc-sidebar-toggle:hover {
      background: var(--threads-surface-muted);
      color: var(--threads-fg);
    }

    body.tc-panel-open .tc-sidebar-toggle {
      display: none;
    }

    /* ========= Panel ========= */
    .tc-panel {
      flex: 1;
      min-height: 0;
      width: var(--threads-panel-width);
      background: var(--threads-surface);
      border-left: 1px solid var(--threads-border);
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
      border-bottom: 1px solid var(--threads-border);
    }
    .tc-panel__title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      color: var(--threads-fg);
      letter-spacing: -0.01em;
    }
    .tc-panel__header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .tc-panel__tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--threads-border); }
    .tc-panel__tab {
      background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
      color: var(--threads-fg-muted); font: inherit; font-size: 13px; padding: 6px 8px;
    }
    .tc-panel__tab[aria-selected="true"] { color: var(--threads-fg); border-bottom-color: var(--threads-accent); }
    .tc-reviews { padding: 8px 16px; display: flex; flex-direction: column; gap: 10px; font-family: var(--threads-font); color: var(--threads-fg); }
    .tc-reviews__error { color: var(--threads-fg-muted); font-size: 12px; border: 1px solid var(--threads-border); border-radius: 6px; padding: 6px 8px; }
    .tc-review { border: 1px solid var(--threads-border); border-radius: var(--threads-radius-lg); padding: 10px 12px; background: var(--threads-surface); }
    .tc-review--discarded { opacity: 0.55; }
    .tc-review__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .tc-review__title { font-weight: 600; font-size: 13px; }
    .tc-review__badge { font-size: 11px; color: var(--threads-fg-muted); border: 1px solid var(--threads-border); border-radius: 999px; padding: 0 8px; }
    .tc-review__meta { font-size: 12px; color: var(--threads-fg-muted); margin: 2px 0 6px; }
    .tc-review__ops { margin: 0 0 4px; padding-left: 16px; font-size: 12px; }
    .tc-review__link { color: var(--threads-accent-strong); text-decoration: none; }
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
      color: var(--threads-fg-muted);
    }

    /* Unpublished-comment count on the FAB and the toggle strip, apart from the open-threads badge. */
    .tc-unpublished-marker {
      position: absolute;
      bottom: -6px;
      left: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      border: 1px solid var(--threads-surface);
      background: var(--threads-fg);
      color: var(--threads-surface);
      font-size: 11px;
      font-weight: 700;
      line-height: 16px;
      text-align: center;
      font-family: var(--threads-font);
      box-sizing: border-box;
      pointer-events: none;
    }
    .tc-sidebar-toggle .tc-unpublished-marker { bottom: auto; top: 44px; left: 4px; }

    /* ========= Empty state ========= */
    .tc-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--threads-fg-muted);
      padding: 48px 24px;
      font-size: 14px;
      line-height: 1.6;
    }

    /* ========= Server-rendered threads wrapper ========= */
    .threads-sidebar {
      margin: 24px 0 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ========= Thread card ========= */
    .threads-thread {
      margin: 14px 0;
      border: 1px solid var(--threads-border);
      border-left: 3px solid var(--threads-accent);
      border-radius: var(--threads-radius-lg);
      background: var(--threads-surface);
      overflow: hidden;
      font-family: var(--threads-font);
      box-shadow: 0 2px 10px -2px rgba(0, 0, 0, 0.06), 0 1px 4px -1px rgba(0, 0, 0, 0.04);
      transition: all 0.18s ease;
    }
    .threads-thread:hover {
      box-shadow: 0 4px 18px -2px rgba(0, 0, 0, 0.1), 0 2px 6px -1px rgba(0, 0, 0, 0.06);
    }
    .threads-thread--inline {
      margin: 16px 0 20px;
      max-width: 680px;
    }
    body.tc-panel-open .threads-thread--inline {
      display: none !important;
    }
    .threads-thread--resolved {
      opacity: 0.6;
    }

    /* Anchor Quote Badge */
    .threads-thread__quote-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      background: var(--threads-surface-muted);
      border-bottom: 1px solid var(--threads-border);
      font-size: 12px;
      color: var(--threads-fg-muted);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .threads-thread__quote-badge:hover {
      background: color-mix(in srgb, var(--threads-surface-muted) 80%, var(--threads-border));
    }
    .threads-thread__quote-text {
      font-weight: 500;
      color: var(--threads-fg);
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
      color: var(--threads-accent-strong);
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .threads-thread__open-panel-btn:hover {
      background: var(--threads-border);
    }

    /* ========= Comment item ========= */
    .threads-comment {
      display: grid;
      grid-template-columns: 32px 1fr;
      grid-template-rows: auto auto auto;
      padding: 10px 14px;
      font-size: 13.5px;
      column-gap: 10px;
      row-gap: 4px;
    }
    @media (max-width: 768px) {
      .threads-comment {
        column-gap: 8px;
      }
    }

    /* Avatar column */
    .threads-comment__avatar-col {
      grid-column: 1;
      grid-row: 1 / 3;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 2px;
    }
    .threads-comment__avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .threads-comment__meta {
      grid-column: 2;
      grid-row: 1;
      display: flex;
      align-items: center;
      font-size: 12px;
      color: var(--threads-fg-muted);
      gap: 6px;
    }
    .threads-comment__meta strong {
      color: var(--threads-fg);
      font-weight: 600;
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
      color: var(--threads-fg-muted);
      padding: 2px 6px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11.5px;
      transition: all 0.15s;
    }
    .threads-comment__actions button:hover {
      color: var(--threads-fg);
      background: var(--threads-surface-muted);
      border-color: var(--threads-border);
    }
    .threads-comment__actions .threads-delete-btn:hover {
      color: var(--threads-danger);
      background: var(--threads-danger-soft);
      border-color: var(--threads-danger);
    }

    .threads-comment__body {
      grid-column: 2;
      grid-row: 2;
      color: var(--threads-fg);
      line-height: 1.55;
      font-size: 13.5px;
    }
    .threads-comment__body p {
      margin: 0 0 6px 0;
    }
    .threads-comment__body p:last-child {
      margin-bottom: 0;
    }

    /* ========= Collapsed thread ========= */
    .threads-thread__summary {
      display: none;
      font-size: 13px;
      color: var(--threads-fg-muted);
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
      background: color-mix(in srgb, var(--threads-surface) 95%, var(--threads-surface-muted));
      border-top: 1px solid var(--threads-border);
      gap: 8px;
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
      background: var(--threads-surface-muted);
    }
    .threads-new-comment-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border: 1px dashed var(--threads-border);
      background: transparent;
      color: var(--threads-fg-muted);
      font-family: var(--threads-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border-radius: var(--threads-radius);
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .threads-new-comment-btn:hover {
      color: var(--threads-fg);
      border-color: var(--threads-fg);
      background: var(--threads-surface-muted);
    }

    /* ========= Nested replies ========= */
    .threads-replies {
      grid-column: 2;
      grid-row: 3;
      border-left: 2px solid var(--threads-border);
      margin-left: 14px;
      padding-left: 4px;
      margin-top: 12px;
    }

    /* Vertical connector line centered under avatar */
    .threads-comment:has(.threads-replies) > .threads-comment__avatar-col {
      grid-row: 1 / 4;
      align-items: flex-start;
      position: relative;
    }
    .threads-comment:has(.threads-replies) > .threads-comment__avatar-col::after {
      content: '';
      position: absolute;
      top: 36px;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 2px;
      background: var(--threads-border);
    }

    .threads-comment--reply {
      padding: 8px 0 !important;
      grid-template-columns: 24px 1fr;
      grid-template-rows: 24px auto auto;
    }
    .threads-comment--reply .threads-comment__avatar {
      width: 24px;
      height: 24px;
    }

    /* ========= Per-comment reply button ========= */
    .threads-comment-reply-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: transparent;
      border: none;
      color: var(--threads-fg-muted);
      font-family: var(--threads-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      border-radius: var(--threads-radius);
    }
    .threads-comment:hover .threads-comment-reply-btn {
      opacity: 0.6;
    }
    .threads-comment-reply-btn:hover {
      opacity: 1 !important;
      color: var(--threads-fg);
      background: var(--threads-surface-muted);
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
      border: 1px solid var(--threads-border);
      background: var(--threads-surface-muted);
      font-size: 13px;
      line-height: 1;
      cursor: default;
      transition: background 0.15s, border-color 0.15s;
      user-select: none;
    }
    .threads-reactions li:hover {
      background: var(--threads-surface-muted);
      border-color: var(--threads-border-strong);
    }

    /* ========= Heading discussion button (hidden) ========= */

    /* ========= Heading wrapper for New Thread button ========= */
    .threads-heading-wrap {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 12px;
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
      font-family: var(--threads-font);
      font-size: 12px;
      font-weight: 500;
      color: var(--threads-fg-muted);
      background: var(--threads-surface);
      border: 1px dashed var(--threads-border);
      border-radius: var(--threads-radius);
      cursor: pointer;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
      transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.15s;
    }
    .threads-new-thread-btn:hover {
      color: var(--threads-fg);
      border-color: var(--threads-accent);
      background: var(--threads-surface-muted);
      transform: translateY(-1px);
    }

    /* ========= Delete button (on comment meta) ========= */
    .threads-delete-btn {
      display: inline-flex;
      align-items: center;
      padding: 3px 6px;
      background: transparent;
      border: none;
      color: var(--threads-fg-muted);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      border-radius: var(--threads-radius);
    }
    .threads-comment:hover .threads-delete-btn {
      opacity: 0.6;
    }
    .threads-delete-btn:hover {
      opacity: 1 !important;
      color: var(--threads-danger);
      background: var(--threads-danger-soft);
    }

    /* ========= Collapse/expand toggle button ========= */
    .threads-collapse-btn {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      padding: 3px 6px;
      background: transparent;
      border: none;
      color: var(--threads-fg-muted);
      cursor: pointer;
      border-radius: var(--threads-radius);
      transition: color 0.15s, background 0.15s;
    }
    .threads-collapse-btn:hover {
      color: var(--threads-fg);
      background: var(--threads-surface-muted);
    }

    /* ========= Thread flash animation (on highlight click) ========= */
    .threads-thread--flash {
      animation: tc-flash 2s ease-out;
    }
    @keyframes tc-flash {
      0%   { outline: 2px solid var(--threads-accent); outline-offset: 4px; }
      100% { outline: 2px solid transparent; outline-offset: 8px; }
    }

    /* ========= Identity button & dropdown ========= */
    threads-identity {
      position: relative;
      display: flex;
      align-items: center;
      font-family: var(--threads-font);
    }
    .threads-identity-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid var(--threads-border);
      background: var(--threads-surface);
      cursor: pointer;
      padding: 0;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .threads-identity-btn:hover {
      border-color: var(--threads-accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--threads-accent) 20%, transparent);
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
      color: var(--threads-fg);
      line-height: 1;
    }

    /* ========= Dropdown panel ========= */
    .threads-identity-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 260px;
      background: var(--threads-surface);
      border: 1px solid var(--threads-border);
      border-radius: var(--threads-radius-lg);
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
      border: 2px solid var(--threads-border);
    }
    .threads-identity-preview-placeholder {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 2px solid var(--threads-border);
      background: var(--threads-surface-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 600;
      color: var(--threads-fg-muted);
    }
    .threads-identity-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      font-weight: 500;
      color: var(--threads-fg);
    }
    .threads-identity-input {
      padding: 6px 10px;
      border: 1px solid var(--threads-border);
      border-radius: var(--threads-radius);
      background: var(--threads-surface);
      color: var(--threads-fg);
      font-family: var(--threads-font);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    .threads-identity-input:focus {
      border-color: var(--threads-accent);
    }
    .threads-identity-hint {
      font-size: 11px;
      color: var(--threads-fg-muted);
      margin: 0;
      line-height: 1.4;
    }
    .threads-identity-hint a {
      color: var(--threads-fg-muted);
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
      border-radius: var(--threads-radius);
      font-family: var(--threads-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .threads-identity-cancel {
      background: transparent;
      border: 1px solid var(--threads-border);
      color: var(--threads-fg-muted);
    }
    .threads-identity-cancel:hover {
      border-color: var(--threads-fg);
      color: var(--threads-fg);
    }
    .threads-identity-save {
      background: var(--threads-fg);
      border: 1px solid var(--threads-fg);
      color: var(--threads-surface);
    }
    .threads-identity-save:hover {
      opacity: 0.85;
    }

    /* ========= Sidebar column: hidden by default, shown via body.tc-sidebar-active or body.tc-panel-open ========= */
    .tc-sidebar-column { display: none; }
    body.tc-sidebar-active .tc-sidebar-column,
    body.tc-panel-open .tc-sidebar-column { display: flex; }
    body.tc-panel-open .tc-sidebar-column {
      width: var(--threads-panel-width);
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.18);
    }
    body.tc-sidebar-active .threads-sidebar { display: none !important; }
    body.tc-sidebar-active .tc-has-sidebar { padding-right: 40px; }

    /* ========= Floating threads toggle / right-docked slide tab ========= */
    .threads-fab {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: var(--threads-z-fab);
      width: 40px;
      height: 48px;
      border-radius: 10px 0 0 10px;
      border: 1px solid var(--threads-border);
      border-right: none;
      background: var(--threads-surface);
      color: var(--threads-fg-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: -4px 4px 16px rgba(0, 0, 0, 0.1), -1px 1px 4px rgba(0, 0, 0, 0.06);
      transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      padding-left: 3px;
    }
    .threads-fab:hover {
      color: var(--threads-fg);
      border-color: var(--threads-accent);
      width: 46px;
      box-shadow: -6px 6px 22px rgba(0, 0, 0, 0.16), -2px 2px 6px rgba(0, 0, 0, 0.08);
    }
    body.tc-panel-open .threads-fab {
      right: var(--threads-panel-width);
      border-radius: 10px 0 0 10px;
    }
    .threads-fab__badge {
      position: absolute;
      top: -6px;
      left: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--threads-accent-strong);
      color: var(--threads-on-accent);
      font-size: 11px;
      font-weight: 700;
      line-height: 18px;
      text-align: center;
      font-family: var(--threads-font);
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
    }

    /* Template-specific styling touches */
    body:has(.summer-layout) .threads-thread,
    body.summer-template .threads-thread {
      border-radius: var(--summer-radius, 14px);
      border-color: var(--summer-border);
      background: var(--summer-surface);
    }
    body:has(.summer-layout) .threads-thread__quote-badge,
    body.summer-template .threads-thread__quote-badge {
      background: var(--summer-surface-2);
      border-color: var(--summer-border);
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