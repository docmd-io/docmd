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
    .threads-thread--resolved {
      opacity: 0.6;
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

    .threads-comment--reply {
      padding: 8px 0 !important;
      grid-template-columns: 24px 1fr;
      grid-template-rows: 24px auto auto;
    }
    .threads-comment--reply .threads-comment__avatar {
      width: 24px;
      height: 24px;
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

    /* ========= Thread flash animation (on highlight click) ========= */
    .threads-thread--flash {
      animation: tc-flash 2s ease-out;
    }
    @keyframes tc-flash {
      0%   { outline: 2px solid var(--threads-accent); outline-offset: 4px; }
      100% { outline: 2px solid transparent; outline-offset: 8px; }
    }

    /* Template-specific styling touches */
    body:has(.summer-layout) .threads-thread,
    body.summer-template .threads-thread {
      border-radius: var(--summer-radius, 14px);
      border-color: var(--summer-border);
      background: var(--summer-surface);
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
  `;
  document.head.appendChild(style);
}