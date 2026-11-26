import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Thread, Comment, Anchor, AuthorsMap, Reaction } from '../../types';
import * as api from '../lib/api';
import { initIdentity, getIdentityPayload, getIdentityMode, getAuthorKey, getAuthor, canShowFor } from '../lib/identity';
import { deleteCommentTarget, type ShowTarget } from '../lib/can-show';
import { computeAnchor, getSelectionPosition, isWithinContent } from '../lib/selection';
import { initThemeBridge } from '../lib/theme';
import { t } from '../lib/i18n';
import { limitMessage } from '../lib/limit-message';
import { createSvgElement, getThreadSvg } from '../lib/icons';
import { createPublishMount } from '../lib/publish-mount';
import { threadIdFromHash } from '../lib/reviews-view';
import { planDraftMarks, type PageMark } from '../lib/draft-marks';
import { hideRawSidebars } from '../lib/raw-sidebars';

/**
 * Format raw ISO or timestamp string into an understandable, human-readable date & time.
 * E.g., '2026-11-19T10:00:00Z' -> 'Nov 19, 2026, 10:00 AM'
 * '2026-11-26' -> 'Nov 26, 2026'
 */
function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return trimmed;
  const hasTime = trimmed.includes('T') || trimmed.includes(':');
  const locale = (typeof document !== 'undefined' && document.documentElement.lang) || undefined;
  if (!hasTime) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

import './threads-popover';
import './threads-inline-editor';
import './threads-identity';
import './threads-publish-widget';
import './threads-reviews-panel';
import type { ThreadsReviewsPanel } from './threads-reviews-panel';
import type { ThreadsPublishWidget } from './threads-publish-widget';

import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

/** Text under these is never a target when highlighting drafts after a load: thread cards, the panel, scripts. */
const SKIP_WRAP = '.threads-thread, .tc-panel, threads-app, script, style';

const EMOJI_PRESETS = ['\u{1F44D}', '\u{1F44E}', '\u{1F602}', '\u{1F389}', '\u{1F914}', '\u{2764}\u{FE0F}', '\u{1F680}', '\u{1F440}'];

@customElement('threads-app')
export class ThreadsApp extends LitElement {
  override createRenderRoot() { return this; }

  @state() private threads: Thread[] = [];
  @state() private authorsMap: AuthorsMap = {};
  @state() private popoverActive = false;
  @state() private popoverX = 0;
  @state() private popoverY = 0;

  /** Settles once `whoami` has answered; nothing that renders buttons or may prompt for a name runs before. */
  private identityReady: Promise<void> = Promise.resolve();
  private identityKnown = false;
  private pendingMouseUp: MouseEvent | null = null;
  private pendingAnchor: Anchor | null = null;
  private pendingBlockEl: HTMLElement | null = null;
  private deleteTarget: { type: 'thread' | 'comment'; id: string; threadId?: string } | null = null;
  private inlineEditorEl: HTMLElement | null = null;
  /** The drawer panel: the review section mounts into it. Null when no panel exists (nothing is mounted then). */
  private panelEl: HTMLElement | null = null;
  /** The drawer's tab. Reviews exists only while the socket is live; the tab buttons are created with the review section. */
  private panelTab: 'threads' | 'reviews' = 'threads';
  private tabsEl: HTMLElement | null = null;
  /** The last unpublished count the review section reported. */
  private unpublishedCount = 0;
  /** The `#thread-<id>` of the open URL has been revealed (or there is none); reset on a hash change and a page mount. */
  private deepLinkDone = false;
  private publishMount = createPublishMount<ThreadsPublishWidget>({
    isLive: () => docmd.isLive!(), // mountPublishWidget guards docmd and isLive before start()
    isConnected: () => this.isConnected,
    create: () => {
      const el = document.createElement('threads-publish-widget') as ThreadsPublishWidget;
      // The review section: pinned to the bottom of the drawer, mounted whether or not the drawer is open.
      if (!this.panelEl) this.initSidebarColumn();
      if (this.panelEl) {
        this.panelEl.appendChild(el);
        this.mountTabs();
        void el.refresh();
      }
      return el;
    },
    remove: (el) => {
      el.remove();
      this.unmountTabs();
    },
  });

  /** Whether sidebar mode is enabled via plugin config. Default: false (inline mode). */
  private get sidebarEnabled(): boolean {
    return !!(window as any).__threads_config?.sidebar;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousedown', this.handleOutsidePopoverClick);
    document.removeEventListener('docmd:page-mounted', this.handlePageMounted as EventListener);
    window.removeEventListener('hashchange', this.handleHashChange);
    document.removeEventListener('reviews-changed', this.handleReviewsChanged);
    document.removeEventListener('unpublished-count-change', this.handleUnpublishedCount as EventListener);
    this.publishMount.stop();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    initThemeBridge();
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousedown', this.handleOutsidePopoverClick);
    document.addEventListener('docmd:page-mounted', this.handlePageMounted as EventListener);
    window.addEventListener('hashchange', this.handleHashChange);
    document.addEventListener('reviews-changed', this.handleReviewsChanged);
    document.addEventListener('unpublished-count-change', this.handleUnpublishedCount as EventListener);

    // Always initialize sidebar column so the panel is available for FAB toggle
    this.initSidebarColumn();

    // Who the caller is decides which buttons render and whether a name is ever asked: learn it first.
    this.identityReady = initIdentity(api.whoami).then(() => { this.identityKnown = true; });
    void this.identityReady.then(() => {
      if (!this.isConnected) return;
      this.injectIdentityButton();
      this.loadThreads();
      this.injectNewThreadButton();
      this.injectFab();
      this.mountPublishWidget();
    });

    // Register afterReload handler for post-mutation continuity
    if (typeof docmd !== 'undefined' && docmd.afterReload) {
      docmd.afterReload('threads', () => {
        void this.identityReady.then(() => {
          this.loadThreads();
          this.injectNewThreadButton();
          this.updateFabBadge();
        });
      });
    }
  }

  /**
   * Find the content area of the page.
   */
  private getContentArea(): Element | null {
    return document.querySelector('.summer-content')
      || document.querySelector('[data-docmd-content]')
      || document.querySelector('.docmd-content')
      || document.querySelector('.main-content')
      || document.querySelector('article')
      || document.querySelector('main');
  }

  /**
   * Create the identity button and place it in the page header.
   * Done imperatively so Lit re-renders don't pull it back into threads-app.
   */
  private injectIdentityButton(): void {
    // Avoid duplicates
    if (document.querySelector('threads-identity')) return;

    const target = document.querySelector('.summer-topbar__right')
      || document.querySelector('.docmd-options-menu')
      || document.querySelector('.header-right');
    if (!target) return;

    const identity = document.createElement('threads-identity');
    target.appendChild(identity);
  }

  /**
   * Inject a "New Thread" button into every heading in the content area.
   * Each button is right-aligned on the same line as the heading text.
   */
  private injectNewThreadButton(): void {
    // Remove existing buttons (e.g. after reload)
    document.querySelectorAll('.threads-new-thread-btn').forEach(el => el.remove());
    // Remove wrapper classes from headings
    document.querySelectorAll('.threads-heading-wrap').forEach(el => {
      el.classList.remove('threads-heading-wrap');
    });

    const contentArea = this.getContentArea();
    if (!contentArea) return;

    const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    // Only target direct children of the content area - avoids TOC, sidebar headings, etc.
    const headings = Array.from(contentArea.children).filter(el => HEADING_TAGS.has(el.tagName));

    for (const heading of headings) {
      // Only target direct-ish headings inside the content area
      if (!HEADING_TAGS.has(heading.tagName)) continue;
      if (heading.classList.contains('docmd-focus-title')) continue;

      heading.classList.add('threads-heading-wrap');

      const btn = document.createElement('button');
      btn.className = 'threads-new-thread-btn';
      btn.appendChild(createSvgElement('plus', 13));
      btn.appendChild(document.createTextNode(' ' + t('newThread')));
      btn.title = t('startThread');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startNewThread(heading);
      });
      heading.appendChild(btn);
    }
  }

  /**
   * Start a new top-level thread by opening an inline editor after the given heading.
   */
  private startNewThread(heading: Element): void {
    this.removeInlineEditor();

    const editor = document.createElement('threads-inline-editor') as any;
    editor.quote = '';

    editor.addEventListener('inline-submit', async (e: CustomEvent) => {
      const identity = getIdentityPayload();
      try {
        await api.createThread({
          anchor: null,
          ...identity,
          body: e.detail.body,
        });
        this.removeInlineEditor();
        await this.loadThreads();
      } catch (err) {
        console.error('[threads] Failed to create thread:', err);
        editor.message = limitMessage(err) ?? '';
        editor.submitting = false;
      }
    });

    editor.addEventListener('inline-cancel', () => this.removeInlineEditor());

    heading.insertAdjacentElement('afterend', editor);
    this.inlineEditorEl = editor;
  }

  // ─── Selection popover ────────────────────────────────────────────

  private handleMouseUp = (e: MouseEvent): void => {
    // Starting a thread may ask for the caller's name: not before we know whether the server names them.
    // The selection outlives the click, so handle it once the answer is in instead of dropping it.
    if (!this.identityKnown) {
      // Only the latest selection matters: keep one pending event, not one replay per click.
      const first = this.pendingMouseUp === null;
      this.pendingMouseUp = e;
      if (first) {
        void this.identityReady.then(() => {
          const latest = this.pendingMouseUp;
          this.pendingMouseUp = null;
          if (latest && this.isConnected) this.handleMouseUp(latest);
        });
      }
      return;
    }
    const popover = this.querySelector('threads-popover');
    if (popover?.contains(e.target as Node)) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      this.popoverActive = false;
      return;
    }

    if (!selection.anchorNode || !isWithinContent(selection.anchorNode)) return;

    const anchor = computeAnchor(selection);
    if (!anchor) return;

    const pos = getSelectionPosition(selection);
    if (!pos) return;

    // Find the enclosing block element for inline editor insertion
    const BLOCK_TAGS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);
    let blockEl: HTMLElement | null = null;
    let node: Node | null = selection.getRangeAt(0).startContainer;
    while (node && node !== document.body) {
      if (node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)) {
        blockEl = node;
        break;
      }
      node = node.parentNode;
    }

    this.pendingAnchor = anchor;
    this.pendingBlockEl = blockEl;
    this.popoverX = pos.x;
    this.popoverY = pos.y;
    this.popoverActive = true;
  };

  private handleOutsidePopoverClick = (e: MouseEvent): void => {
    const popover = this.querySelector('threads-popover');
    if (popover && !e.composedPath().includes(popover)) {
      this.popoverActive = false;
    }
  };

  /**
   * Handle popover "add comment" - open inline editor after the block.
   */
  private handleAddComment(): void {
    if (!this.pendingAnchor || !this.pendingBlockEl) return;

    this.removeInlineEditor();
    this.popoverActive = false;

    const anchor = this.pendingAnchor;
    const blockEl = this.pendingBlockEl;
    this.pendingAnchor = null;
    this.pendingBlockEl = null;
    window.getSelection()?.removeAllRanges();

    const editor = document.createElement('threads-inline-editor') as any;
    editor.quote = anchor.quote || '';

    editor.addEventListener('inline-submit', async (e: CustomEvent) => {
      const identity = getIdentityPayload();
      try {
        const createdThread = await api.createThread({
          anchor,
          ...identity,
          body: e.detail.body,
        });
        this.removeInlineEditor();
        if (anchor?.quote && createdThread?.id && blockEl) {
          this.wrapAnchorInMark(blockEl, anchor.quote, createdThread.id);
        }
        await this.loadThreads();
      } catch (err) {
        console.error('[threads] Failed to create thread:', err);
        editor.message = limitMessage(err) ?? '';
        editor.submitting = false;
      }
    });

    editor.addEventListener('inline-cancel', () => this.removeInlineEditor());

    blockEl.insertAdjacentElement('afterend', editor);
    this.inlineEditorEl = editor;
  }

  /** Wrap the first occurrence of `quote` under `root` in a highlight. Text under `skip` is not searched. */
  private wrapAnchorInMark(root: HTMLElement, quote: string, threadId: string, skip?: string): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (skip && n.parentElement?.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const val = textNode.nodeValue || '';
      const idx = val.indexOf(quote);
      if (idx >= 0) {
        // The range lies inside one text node, so wrapping it cannot cross an element boundary.
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + quote.length);
        const mark = document.createElement('mark');
        mark.className = 'threads-highlight';
        mark.dataset.threadId = threadId;
        mark.dataset.threadsClientMark = '';
        range.surroundContents(mark);
        return;
      }
    }
  }

  /**
   * After a threads load: highlight the caller's drafted threads (the page's markup has none) and take back
   * client highlights whose draft is gone. A quote that is not in the page is skipped; the card stays in the panel.
   */
  private syncDraftMarks(): void {
    const marks: PageMark[] = [...document.querySelectorAll<HTMLElement>('mark.threads-highlight[data-thread-id]')]
      .map((m) => ({ id: m.dataset.threadId!, client: m.hasAttribute('data-threads-client-mark') }));
    const { add, remove } = planDraftMarks(this.threads, marks);

    for (const id of remove) {
      for (const mark of document.querySelectorAll<HTMLElement>(`mark.threads-highlight[data-threads-client-mark][data-thread-id="${CSS.escape(id)}"]`)) {
        const parent = mark.parentNode;
        mark.replaceWith(...mark.childNodes);
        parent?.normalize(); // join the text the mark had split, so a later quote spanning it is found
      }
      // In inline mode the highlight had put the thread's card after its block: it goes with the highlight.
      document.querySelectorAll(`.threads-thread--inline[data-thread-id="${CSS.escape(id)}"]`).forEach((el) => el.remove());
    }
    const root = this.getContentArea() as HTMLElement | null;
    if (!root) return;
    for (const thread of add) this.wrapAnchorInMark(root, thread.anchor!.quote, thread.id, SKIP_WRAP);
  }

  // ─── Page lifecycle ───────────────────────────────────────────────

  /** A link to another spot of the open page only changes the fragment: reveal its thread without a reload. */
  private handleHashChange = (): void => {
    this.deepLinkDone = false;
    this.handleDeepLink();
  };

  private handlePageMounted = (_e: CustomEvent): void => {
    this.popoverActive = false;
    this.deepLinkDone = false;
    void this.identityReady.then(() => {
      this.loadThreads();
      this.injectNewThreadButton();
    });
  };

  /** A review was discarded: the reload refreshes everything that shows it, so nobody else needs to. */
  private handleReviewsChanged = (e: Event): void => {
    e.preventDefault();
    void this.loadThreads();
    void this.reviewsPanel()?.refresh();
  };

  private reviewsPanel(): ThreadsReviewsPanel | null {
    return document.querySelector<ThreadsReviewsPanel>('.tc-panel__body threads-reviews-panel');
  }

  /** `#thread-<id>` in the URL: scroll the thread's highlight (or inline card) into view and flash it once. An unknown id does nothing. */
  private handleDeepLink(): void {
    if (this.deepLinkDone) return;
    const hash = location.hash;
    if (!hash) { this.deepLinkDone = true; return; }
    const id = threadIdFromHash(hash);
    if (id === null) { this.deepLinkDone = true; return; }
    // Not loaded yet (or not a thread of this page): leave the latch open for the next load.
    if (!this.threads.some(th => th.id === id)) return;
    const sel = `[data-thread-id="${CSS.escape(id)}"]`;
    const target = document.querySelector<HTMLElement>(`mark.threads-highlight${sel}`)
      ?? document.querySelector<HTMLElement>(`.threads-thread${sel}:not(.tc-panel .threads-thread)`);
    if (!target) return;
    this.deepLinkDone = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('threads-thread--flash');
    setTimeout(() => target.classList.remove('threads-thread--flash'), 2000);
  }

  private async loadThreads(): Promise<void> {
    await this.identityReady;
    try {
      const [threads, authors] = await Promise.all([
        api.fetchThreads(),
        api.fetchAuthors(),
      ]);
      if (Array.isArray(threads)) {
        this.threads = threads;
      }
      if (authors && typeof authors === 'object') {
        this.authorsMap = authors;
      }
    } catch (err) {
      console.error('[threads] Failed to load threads:', err);
    }
    this.syncDraftMarks();
    this.scanRenderedHighlights();
    this.updateFabBadge();
    void this.publishMount.widget?.refresh();
    this.handleDeepLink();

    // Re-sync all reaction bars in the DOM (in-page and sidebar)
    for (const thread of this.threads) {
      for (const comment of thread.comments) {
        if (comment.id) {
          this.updateCommentReactionsInDOM(thread.id, comment.id, comment.reactions || []);
        }
      }
    }

    // Keep open sidebar panel in sync with fresh thread data
    if (document.body.classList.contains('tc-panel-open')) {
      this.populateSidebarPanel(true);
    }
  }

  /** The review section reports its unpublished count: show it on the FAB and the toggle strip. */
  private handleUnpublishedCount = (e: CustomEvent<{ count: number }>): void => {
    const count = e.detail.count;
    // Publishing empties the open review: the review it made is new in the Reviews tab.
    if (count < 1 && this.unpublishedCount > 0) void this.reviewsPanel()?.refresh();
    this.unpublishedCount = count;
    const label = t(count === 1 ? 'unpublishedCountOne' : 'unpublishedCount').replace('{n}', String(count));
    for (const host of document.querySelectorAll<HTMLElement>('.threads-fab, .tc-sidebar-toggle')) {
      host.querySelector('.tc-unpublished-marker')?.remove();
      if (count < 1) continue;
      const marker = document.createElement('span');
      marker.className = 'tc-unpublished-marker';
      marker.textContent = String(count);
      marker.title = label;
      marker.setAttribute('aria-label', label);
      const wrap = host.querySelector('.threads-fab__badge-wrap');
      if (wrap) wrap.appendChild(marker);
      else host.appendChild(marker);
    }
    this.updateFabBadge();
  };

  /**
   * Determine whether the delete action should be offered to the current user.
   * Only the author of the comment (or thread) or an admin may delete.
   */
  private canDeleteComment(target: ShowTarget, commentAuthor?: string | null, commentAuthorKey?: string | null): boolean {
    if (target.drafted) return true;
    const idMode = getIdentityMode();
    if (idMode.mode === 'header' && idMode.isAdmin) return true;
    const currentKey = idMode.mode === 'header' ? idMode.payload.authorKey : getAuthorKey();
    const currentName = idMode.mode === 'header' ? idMode.payload.author : getAuthor();
    if (target.authorKey && currentKey && target.authorKey === currentKey) return true;
    if (commentAuthorKey && currentKey && commentAuthorKey === currentKey) return true;
    if (commentAuthor && currentName && commentAuthor.toLowerCase().trim() === currentName.toLowerCase().trim()) return true;
    if (target.authorKeys && target.authorKeys.length > 0) {
      if (currentKey && target.authorKeys.every(k => k === currentKey)) return true;
    }
    return false;
  }

  /** The publish widget exists only against a live server. */
  private mountPublishWidget(): void {
    if (typeof docmd === 'undefined' || !docmd.isLive) return;
    this.publishMount.start();
  }

  // Color palette for highlights - cycles through these
  private static HIGHLIGHT_COLORS = [
    'threads-hl-yellow',
    'threads-hl-blue',
    'threads-hl-green',
    'threads-hl-pink',
    'threads-hl-purple',
    'threads-hl-orange',
  ];

  /**
   * Scan the DOM for <mark class="threads-highlight" data-thread-id="..."> elements.
   * Assigns semantic highlight colors (blue=published, orange=draft, green=resolved),
   * moves thread cards inline after the block containing the highlight, and attaches click handlers.
   */
  private scanRenderedHighlights(): void {
    const marks = document.querySelectorAll<HTMLElement>('mark.threads-highlight[data-thread-id]');
    const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE']);

    for (const mark of marks) {
      const threadId = mark.dataset.threadId;
      if (!threadId) continue;

      const threadData = this.threads.find(t => t.id === threadId);

      // Semantic highlight color:
      // Draft -> Orange/Amber (pending publish / local changes)
      // Resolved -> Green/Muted
      // Published -> Blue (pushed to git / live active)
      let hlClasses = ['threads-hl-published', 'threads-hl-blue'];
      let borderClasses = ['threads-border-published', 'threads-border-blue'];

      if (threadData?.draft) {
        hlClasses = ['threads-hl-draft', 'threads-hl-orange'];
        borderClasses = ['threads-border-draft', 'threads-border-orange'];
      } else if (threadData?.resolved) {
        hlClasses = ['threads-hl-resolved', 'threads-hl-green'];
        borderClasses = ['threads-border-resolved', 'threads-border-green'];
      }

      for (const c of Array.from(mark.classList)) {
        if (c.startsWith('threads-hl-')) mark.classList.remove(c);
      }
      for (const cls of hlClasses) {
        mark.classList.add(cls);
      }

      // 2. In inline mode, ensure the thread card exists right after the block
      if (!this.sidebarEnabled) {
        let threadEl = document.querySelector<HTMLElement>(`.threads-thread[data-thread-id="${threadId}"]:not(.tc-panel .threads-thread)`);
        if (!threadEl && threadData) {
          threadEl = this.renderThreadCard(threadData, false);
        }

        if (threadEl) {
          threadEl.classList.add('threads-thread--inline');
          for (const c of Array.from(threadEl.classList)) {
            if (c.startsWith('threads-border-')) threadEl.classList.remove(c);
          }
          for (const cls of borderClasses) {
            threadEl.classList.add(cls);
          }

          let blockEl: Element | null = mark;
          while (blockEl && blockEl !== document.body) {
            if (blockEl instanceof HTMLElement && BLOCK_TAGS.has(blockEl.tagName)) {
              break;
            }
            blockEl = blockEl.parentElement;
          }

          if (blockEl && blockEl !== document.body && threadEl.parentElement !== blockEl.parentElement) {
            blockEl.insertAdjacentElement('afterend', threadEl);
          }
        }
      }

      // 3. Click handler: always open thread in sidebar panel and focus it
      mark.style.cursor = 'pointer';
      mark.onclick = (e) => {
        e.stopPropagation();
        this.closeAiDrawerIfOpen();
        document.body.classList.add('tc-panel-open');
        this.selectTab('threads');
        const targetInPanel = document.querySelector(`.tc-panel__body .threads-thread[data-thread-id="${threadId}"]`);
        if (targetInPanel) {
          targetInPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetInPanel.classList.add('threads-thread--flash');
          setTimeout(() => targetInPanel.classList.remove('threads-thread--flash'), 2000);
        }
      };
    }

    // 4. Inject reply buttons into any static server-rendered thread cards
    this.injectReplyButtons();

    // 5. Hide the raw .threads-sidebar markdown-it renders for every threads block
    hideRawSidebars(document, !this.sidebarEnabled);

    // 6. If sidebar mode or panel is open, populate the right sidebar panel
    if (this.sidebarEnabled || document.body.classList.contains('tc-panel-open')) {
      this.populateSidebarPanel();
    }
  }

  /**
   * Enhance thread cards: nest replies under parents, add per-comment reply & delete buttons,
   * reaction bars, quote styling consistency, and a "+ New Comment" footer button for top-level comments.
   */
  private injectReplyButtons(): void {
    const threads = document.querySelectorAll<HTMLElement>('.threads-thread[data-thread-id]');
    for (const threadEl of threads) {
      const threadId = threadEl.dataset.threadId;
      if (!threadId) continue;

      // Enhance quote badge if server-rendered blockquote.threads-anchor
      const anchorEl = threadEl.querySelector<HTMLElement>('blockquote.threads-anchor');
      if (anchorEl && !anchorEl.querySelector('.threads-thread__quote-text')) {
        const text = anchorEl.textContent?.trim() || '';
        anchorEl.textContent = '';
        anchorEl.className = 'threads-thread__quote-badge';
        anchorEl.appendChild(createSvgElement('quote', 12));
        const textSpan = document.createElement('span');
        textSpan.className = 'threads-thread__quote-text';
        textSpan.textContent = `"${text}"`;
        anchorEl.appendChild(textSpan);

        const openBtn = document.createElement('button');
        openBtn.className = 'threads-thread__open-panel-btn';
        openBtn.title = 'Open discussion in sidebar';
        openBtn.innerHTML = `<span>Sidebar</span>${getThreadSvg('external-link', 11)}`;
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeAiDrawerIfOpen();
          document.body.classList.add('tc-panel-open');
          this.selectTab('threads');
          const targetInPanel = document.querySelector(`.tc-panel__body .threads-thread[data-thread-id="${threadId}"]`);
          if (targetInPanel) {
            targetInPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetInPanel.classList.add('threads-thread--flash');
            setTimeout(() => targetInPanel.classList.remove('threads-thread--flash'), 2000);
          }
        });
        anchorEl.appendChild(openBtn);
      }

      // Apply semantic border color based on status
      const thread = this.threads.find(th => th.id === threadId);
      if (thread) {
        for (const c of Array.from(threadEl.classList)) {
          if (c.startsWith('threads-border-')) threadEl.classList.remove(c);
        }
        if (thread.draft) {
          threadEl.classList.add('threads-border-draft', 'threads-border-orange');
        } else if (thread.resolved) {
          threadEl.classList.add('threads-border-resolved', 'threads-border-green');
        } else {
          threadEl.classList.add('threads-border-published', 'threads-border-blue');
        }
      }

      // Skip footer/button injection if already enhanced
      if (threadEl.querySelector('.threads-new-comment-btn')) {
        // Still update reaction bars in case thread state changed
        const allComments = threadEl.querySelectorAll<HTMLElement>('.threads-comment');
        for (const commentEl of allComments) {
          const commentId = commentEl.dataset.commentId;
          if (!commentId) continue;
          const comm = thread?.comments.find(c => c.id === commentId);
          if (comm) {
            const rxBar = commentEl.querySelector('.threads-comment__reactions-bar');
            if (rxBar) {
              rxBar.replaceWith(this.renderReactionsBar(threadId, commentId, comm.reactions || []));
            }
          }
        }
        continue;
      }

      // Add per-comment reply, delete buttons, and reaction bars
      const allComments = threadEl.querySelectorAll<HTMLElement>('.threads-comment');
      const totalComments = allComments.length;
      for (const commentEl of allComments) {
        const commentId = commentEl.dataset.commentId;
        if (!commentId) continue;

        const meta = commentEl.querySelector<HTMLElement>('.threads-comment__meta');
        if (meta) {
          const authorEl = meta.querySelector('strong');
          if (authorEl) authorEl.classList.add('threads-comment__author');
          let dateEl = meta.querySelector<HTMLElement>('.threads-comment__date');
          if (!dateEl) {
            const rawDate = commentEl.dataset.date || meta.textContent?.replace(authorEl?.textContent || '', '').replace(/^[·\s·\s]+/, '').trim() || '';
            const dateFormatted = formatDateTime(rawDate);
            for (const node of Array.from(meta.childNodes)) {
              if (node !== authorEl) node.remove();
            }
            const sep = document.createElement('span');
            sep.className = 'threads-comment__sep';
            sep.textContent = ' · ';
            meta.appendChild(sep);

            dateEl = document.createElement('span');
            dateEl.className = 'threads-comment__date';
            dateEl.textContent = dateFormatted;
            if (rawDate) dateEl.title = rawDate;
            meta.appendChild(dateEl);
          } else if (dateEl.textContent) {
            const rawDate = commentEl.dataset.date || dateEl.title || dateEl.textContent.trim();
            if (rawDate) {
              dateEl.title = rawDate;
              dateEl.textContent = formatDateTime(rawDate);
            }
          }
        }

        // Inject avatar into the avatar column if not already present
        const avatarCol = commentEl.querySelector('.threads-comment__avatar-col');
        if (avatarCol && !avatarCol.querySelector('.threads-comment__avatar')) {
          const authorVal = commentEl.dataset.author || '';
          const authorInfo = this.resolveAuthor(authorVal);
          if (authorInfo?.avatarUrl) {
            const avatar = document.createElement('img');
            avatar.className = 'threads-comment__avatar';
            avatar.src = authorInfo.avatarUrl;
            avatar.alt = authorInfo.name || authorVal;
            avatarCol.appendChild(avatar);
          }
        }

        // Restructure comment children into .threads-comment__content for clean flex column
        let contentCol = commentEl.querySelector<HTMLElement>('.threads-comment__content');
        if (!contentCol) {
          contentCol = document.createElement('div');
          contentCol.className = 'threads-comment__content';
          if (meta) contentCol.appendChild(meta);
          const bodyEl = commentEl.querySelector('.threads-comment__body');
          if (bodyEl) contentCol.appendChild(bodyEl);
          commentEl.appendChild(contentCol);
        }

        // Actions container - pushed to the right via margin-left: auto
        if (meta && !commentEl.querySelector('.threads-comment__actions')) {
          const actions = document.createElement('div');
          actions.className = 'threads-comment__actions';

          // Reply button
          const replyBtn = document.createElement('button');
          replyBtn.className = 'threads-comment-reply-btn';
          replyBtn.appendChild(createSvgElement('reply', 13));
          replyBtn.appendChild(document.createTextNode(' ' + t('reply')));
          replyBtn.title = t('replyToComment');
          replyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openReplyEditor(threadEl, threadId, commentId);
          });
          actions.appendChild(replyBtn);

          // Delete button: only when user is author or admin and canShowFor passes
          let deletable = false;
          const comm = thread?.comments.find(c => c.id === commentId);
          const target = !thread
            ? { authorKey: null }
            : (totalComments === 1
                ? { authorKeys: thread.comments.filter(c => !c.draft).map(c => c.authorKey) }
                : deleteCommentTarget(thread.comments, commentId));
          if (canShowFor('delete-comment', target)) {
            deletable = this.canDeleteComment(target, comm?.author || commentEl.dataset.author, comm?.authorKey);
          }
          if (deletable) {
            const delBtn = document.createElement('button');
            delBtn.className = 'threads-delete-btn';
            delBtn.appendChild(createSvgElement('trash', 13));
            delBtn.title = t('deleteComment');
            delBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (totalComments === 1) {
                this.deleteTarget = { type: 'thread', id: threadId };
              } else {
                this.deleteTarget = { type: 'comment', id: commentId, threadId };
              }
              const dialog = this.querySelector<HTMLElement & { open: boolean }>('#delete-dialog');
              if (dialog) dialog.open = true;
            });
            actions.appendChild(delBtn);
          }

          meta.appendChild(actions);
        }

        // Attach reactions bar
        const rawReactions = commentEl.querySelector('.threads-reactions');
        rawReactions?.remove();
        const comm = thread?.comments.find(c => c.id === commentId);
        const reactions = comm?.reactions || [];
        const existingRxBar = commentEl.querySelector('.threads-comment__reactions-bar');
        const rxBar = this.renderReactionsBar(threadId, commentId, reactions);
        if (existingRxBar) {
          existingRxBar.replaceWith(rxBar);
        } else {
          contentCol.appendChild(rxBar);
        }
      }

      // Nest replies under their parent comments after reactions are attached
      this.nestReplies(threadEl);

      // Build collapse summary
      const allCommentsForSummary = threadEl.querySelectorAll<HTMLElement>('.threads-comment');
      const summary = this.buildCollapseSummary(allCommentsForSummary);

      // Footer with summary (hidden when expanded), "+ New Comment", and collapse toggle
      const footer = document.createElement('div');
      footer.className = 'threads-thread__footer';

      // Summary element (visible only when collapsed, via CSS)
      const summaryEl = document.createElement('div');
      summaryEl.className = 'threads-thread__summary';
      summaryEl.textContent = summary;
      footer.appendChild(summaryEl);

      const btn = document.createElement('button');
      btn.className = 'threads-new-comment-btn';
      btn.appendChild(createSvgElement('plus', 13));
      btn.appendChild(document.createTextNode(' ' + t('newComment')));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openReplyEditor(threadEl, threadId, null);
      });
      footer.appendChild(btn);

      // Collapse/expand toggle button
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'threads-collapse-btn';
      toggleBtn.appendChild(createSvgElement('chevron-up', 14));
      toggleBtn.title = t('collapseThread');
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = threadEl.classList.toggle('threads-thread--collapsed');
        toggleBtn.innerHTML = '';
        toggleBtn.appendChild(createSvgElement(isCollapsed ? 'chevron-down' : 'chevron-up', 14));
        toggleBtn.title = isCollapsed ? t('expandThread') : t('collapseThread');
      });
      footer.appendChild(toggleBtn);

      threadEl.appendChild(footer);
    }
  }

  /**
   * Build a summary string like "3 comments by Alice, Bob, and 1 more".
   * Uses only the first name of each author.
   */
  private buildCollapseSummary(comments: NodeListOf<HTMLElement> | HTMLElement[]): string {
    const count = comments.length;
    const authors = new Set<string>();
    for (const c of comments) {
      const author = c.dataset.author;
      if (author) {
        const firstName = author.split(/\s+/)[0];
        authors.add(firstName);
      }
    }

    const uniqueNames = Array.from(authors);
    const MAX_SHOWN = 3;
    let byPart: string;

    if (uniqueNames.length === 0) {
      byPart = '';
    } else if (uniqueNames.length <= MAX_SHOWN) {
      if (uniqueNames.length === 1) {
        byPart = ` ${t('by')} ${uniqueNames[0]}`;
      } else if (uniqueNames.length === 2) {
        byPart = ` ${t('by')} ${uniqueNames[0]} ${t('and')} ${uniqueNames[1]}`;
      } else {
        byPart = ` ${t('by')} ${uniqueNames.slice(0, -1).join(', ')}, ${t('and')} ${uniqueNames[uniqueNames.length - 1]}`;
      }
    } else {
      const shown = uniqueNames.slice(0, MAX_SHOWN);
      const remaining = uniqueNames.length - MAX_SHOWN;
      byPart = ` ${t('by')} ${shown.join(', ')}, ${t('and')} ${remaining} ${t('more')}`;
    }

    return `${count} ${count === 1 ? t('commentCount') : t('commentsCount')}${byPart}`;
  }

  /**
   * Reorganize flat comment elements into a nested structure.
   * Comments with data-parent-id get moved into a .threads-replies container
   * after their parent comment.
   */
  private nestReplies(threadEl: HTMLElement): void {
    const comments = Array.from(threadEl.querySelectorAll<HTMLElement>('.threads-comment'));
    // Build a map of comment ID → element
    const commentMap = new Map<string, HTMLElement>();
    for (const c of comments) {
      const id = c.dataset.commentId;
      if (id) commentMap.set(id, c);
    }

    // Move replies under their parents
    for (const commentEl of comments) {
      const parentId = commentEl.dataset.parentId;
      if (!parentId) continue;

      const parentEl = commentMap.get(parentId);
      if (!parentEl) continue;

      // Ensure the parent has a replies container
      let repliesContainer = parentEl.querySelector('.threads-replies') as HTMLElement;
      if (!repliesContainer) {
        repliesContainer = document.createElement('div');
        repliesContainer.className = 'threads-replies';
        const contentCol = parentEl.querySelector('.threads-comment__content');
        if (contentCol) contentCol.appendChild(repliesContainer);
        else parentEl.appendChild(repliesContainer);
      }

      commentEl.classList.add('threads-comment--reply');
      repliesContainer.appendChild(commentEl);
    }
  }

  /**
   * Open an inline editor for replying to a comment or adding a new top-level comment.
   * @param parentCommentId - null for top-level comment, or comment ID to reply to
   */
  private openReplyEditor(threadEl: HTMLElement, threadId: string, parentCommentId: string | null): void {
    this.removeInlineEditor();

    const editor = document.createElement('threads-inline-editor') as any;
    editor.quote = '';

    editor.addEventListener('inline-submit', async (e: CustomEvent) => {
      const identity = getIdentityPayload();
      try {
        await api.addComment(threadId, {
          ...identity,
          body: e.detail.body,
          parentId: parentCommentId,
        });
        this.removeInlineEditor();
        await this.loadThreads();
      } catch (err) {
        console.error('[threads] Failed to add comment:', err);
        editor.message = limitMessage(err) ?? '';
        editor.submitting = false;
      }
    });

    editor.addEventListener('inline-cancel', () => this.removeInlineEditor());

    if (parentCommentId) {
      // Insert editor after the specific comment (or its replies container)
      const parentComment = threadEl.querySelector(`.threads-comment[data-comment-id="${parentCommentId}"]`);
      if (parentComment) {
        const repliesContainer = parentComment.querySelector('.threads-replies');
        if (repliesContainer) {
          repliesContainer.appendChild(editor);
        } else {
          const contentCol = parentComment.querySelector('.threads-comment__content');
          if (contentCol) {
            contentCol.appendChild(editor);
          } else {
            const bodyEl = parentComment.querySelector('.threads-comment__body');
            if (bodyEl) {
              bodyEl.appendChild(editor);
            } else {
              parentComment.appendChild(editor);
            }
          }
        }
      } else {
        threadEl.appendChild(editor);
      }
    } else {
      // Top-level: insert before the footer
      const footer = threadEl.querySelector('.threads-thread__footer');
      if (footer) {
        threadEl.insertBefore(editor, footer);
      } else {
        threadEl.appendChild(editor);
      }
    }
    this.inlineEditorEl = editor;
  }

  // ─── Author resolution ──────────────────────────────────────────

  /**
   * Look up author info by key or display name.
   * Tries direct key match first, then scans by display name for legacy comments.
   */
  private resolveAuthor(authorVal: string): { name: string; avatarUrl: string } | null {
    // Direct key match
    if (this.authorsMap[authorVal]) return this.authorsMap[authorVal];

    // Fallback: match by display name (legacy comments store full name)
    for (const info of Object.values(this.authorsMap)) {
      if (info.name === authorVal) return info;
    }

    // Fallback: match by first name (comments may only show first name)
    for (const info of Object.values(this.authorsMap)) {
      if (info.name.split(/\s+/)[0] === authorVal) return info;
    }

    return null;
  }

  // ─── Inline editor helpers ────────────────────────────────────────

  private removeInlineEditor(): void {
    this.inlineEditorEl?.remove();
    this.inlineEditorEl = null;
  }

  // ─── Sidebar column ──────────────────────────────────────────────

  /**
   * Create the fixed right sidebar column with toggle strip + panel.
   * Only called when sidebar config is enabled.
   */
  private initSidebarColumn(): void {
    if (document.querySelector('.tc-sidebar-column')) {
      this.panelEl = document.querySelector<HTMLElement>('.tc-panel');
      return;
    }

    if (this.sidebarEnabled) {
      // Activate permanent sidebar mode via body class
      document.body.classList.add('tc-sidebar-active', 'tc-has-sidebar');
    }

    // Create sidebar column
    const column = document.createElement('div');
    column.className = 'tc-sidebar-column';

    // Toggle strip (collapsed state)
    const toggle = document.createElement('button');
    toggle.className = 'tc-sidebar-toggle';
    toggle.title = t('openThreadsPanel');
    toggle.appendChild(createSvgElement('messages-square', 18));
    toggle.addEventListener('click', () => {
      this.closeAiDrawerIfOpen();
      document.body.classList.add('tc-panel-open');
      this.populateSidebarPanel(true);
    });
    column.appendChild(toggle);

    // Panel (expanded state)
    const panel = document.createElement('div');
    panel.className = 'tc-panel';
    this.panelEl = panel;

    // Panel header
    const header = document.createElement('div');
    header.classList.add('tc-panel__header');
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'tc-panel__title';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = t('threads');
    const countSpan = document.createElement('span');
    countSpan.className = 'tc-panel__count';
    titleDiv.appendChild(titleSpan);
    titleDiv.appendChild(countSpan);
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'tc-panel__header-actions';

    const newThreadBtn = document.createElement('button');
    newThreadBtn.className = 'tc-panel__new-btn';
    newThreadBtn.title = t('newThread') || 'Start new discussion';
    newThreadBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--tc-muted-fg);padding:4px;display:inline-flex;align-items:center;margin-right:4px;border-radius:4px;';
    newThreadBtn.appendChild(createSvgElement('plus', 16));
    newThreadBtn.addEventListener('click', () => {
      const content = this.getContentArea();
      const firstHeading = content?.querySelector('h1, h2, h3, h4, p');
      if (firstHeading) {
        firstHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.startNewThread(firstHeading);
      }
    });
    actionsDiv.appendChild(newThreadBtn);

    const cBtn = document.createElement('button');
    cBtn.className = 'tc-panel__close-btn';
    cBtn.title = t('closePanel');
    cBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--tc-muted-fg);padding:4px;display:inline-flex;align-items:center;border-radius:4px;';
    cBtn.appendChild(createSvgElement('x', 16));
    cBtn.addEventListener('click', () => {
      document.body.classList.remove('tc-panel-open');
    });
    actionsDiv.appendChild(cBtn);

    header.appendChild(titleDiv);
    header.appendChild(actionsDiv);
    panel.appendChild(header);

    // Panel body (thread cards go here)
    const body = document.createElement('div');
    body.className = 'tc-panel__body';
    panel.appendChild(body);

    column.appendChild(panel);
    document.body.appendChild(column);

    // Ensure publish widget is mounted in panel if already created
    if (this.publishMount.widget && !panel.contains(this.publishMount.widget)) {
      panel.appendChild(this.publishMount.widget);
      this.mountTabs();
      void this.publishMount.widget.refresh();
    }
  }

  /** The Threads / Reviews tab buttons, between the drawer's header and body. Only a live drawer has them. */
  private mountTabs(): void {
    if (!this.panelEl || this.tabsEl) return;
    const tabs = document.createElement('div');
    tabs.className = 'tc-panel__tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [['threads', t('threads')], ['reviews', t('reviews')]] as const) {
      const btn = document.createElement('button');
      btn.className = 'tc-panel__tab';
      btn.dataset.tab = id;
      btn.dataset.testid = `tab-${id}`;
      btn.textContent = label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(id === this.panelTab));
      btn.addEventListener('click', () => this.selectTab(id));
      tabs.appendChild(btn);
    }
    this.panelEl.insertBefore(tabs, this.panelEl.querySelector('.tc-panel__body'));
    this.tabsEl = tabs;
  }

  private unmountTabs(): void {
    this.tabsEl?.remove();
    this.tabsEl = null;
    if (this.panelTab === 'reviews') this.selectTab('threads');
  }

  /** Show a tab. Choosing Reviews reads the list afresh. */
  private selectTab(tab: 'threads' | 'reviews'): void {
    this.panelTab = tab;
    this.populateSidebarPanel(tab === 'reviews');
  }

  /**
   * Populate the sidebar panel body with thread cards directly from this.threads data, or the Reviews tab.
   * `refreshReviews`: re-read an already mounted Reviews tab (a user opened it); other callers leave its list alone.
   */
  private populateSidebarPanel(refreshReviews = false): void {
    const panelBody = document.querySelector('.tc-panel__body');
    if (!panelBody) return;

    this.tabsEl?.querySelectorAll<HTMLElement>('.tc-panel__tab').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.tab === this.panelTab)));

    if (this.panelTab === 'reviews') {
      const existing = panelBody.querySelector<ThreadsReviewsPanel>('threads-reviews-panel');
      if (existing) {
        if (refreshReviews) void existing.refresh();
        return;
      }
      panelBody.textContent = '';
      const reviews = document.createElement('threads-reviews-panel');
      // A link to the URL already open fires no hashchange: reveal the thread again.
      reviews.addEventListener('reveal-thread', (e) => {
        e.preventDefault();
        this.deepLinkDone = false;
        this.handleDeepLink();
      });
      panelBody.appendChild(reviews);
      return;
    }

    // Clear existing panel threads
    panelBody.textContent = '';

    const normal = this.threads.filter(th => !th.orphaned);
    const orphaned = this.threads.filter(th => th.orphaned);

    if (this.threads.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'tc-panel__empty';
      emptyState.innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:var(--tc-muted-fg);">
          <div style="margin-bottom:12px;opacity:0.6;display:flex;justify-content:center;">${createSvgElement('messages-square', 32).outerHTML}</div>
          <div style="font-weight:600;font-size:14px;margin-bottom:6px;color:var(--tc-fg);">${t('noThreads') || 'No discussions yet'}</div>
          <div style="font-size:12px;line-height:1.5;">Select any text on this page to leave a comment, or click the <strong>+</strong> button beside any heading.</div>
        </div>
      `;
      panelBody.appendChild(emptyState);
    } else {
      for (const thread of normal) {
        panelBody.appendChild(this.renderThreadCard(thread, true));
      }
      if (orphaned.length > 0) {
        const group = document.createElement('div');
        group.dataset.testid = 'orphaned-group';
        const heading = document.createElement('div');
        heading.className = 'tc-panel__group-title';
        heading.textContent = t('orphaned');
        group.appendChild(heading);
        for (const thread of orphaned) group.appendChild(this.renderThreadCard(thread, true));
        panelBody.appendChild(group);
      }
    }

    // Update count
    const countEl = document.querySelector('.tc-panel__count');
    if (countEl) {
      const openCount = this.threads.filter(t => !t.resolved).length;
      countEl.textContent = openCount > 0 ? `(${openCount} ${t('openCount')})` : '';
    }
  }

  private renderThreadCard(thread: Thread, isSidebar = false): HTMLElement {
    const threadEl = document.createElement('div');
    threadEl.className = 'threads-thread' + (thread.resolved ? ' threads-thread--resolved' : '');
    if (!isSidebar) {
      threadEl.classList.add('threads-thread--inline');
    }
    threadEl.dataset.threadId = thread.id;

    // Apply semantic border color based on status
    if (thread.draft) {
      threadEl.classList.add('threads-border-draft', 'threads-border-orange');
    } else if (thread.resolved) {
      threadEl.classList.add('threads-border-resolved', 'threads-border-green');
    } else {
      threadEl.classList.add('threads-border-published', 'threads-border-blue');
    }

    // Anchor quote badge for both sidebar and inline preview
    const mark = document.querySelector<HTMLElement>(`mark.threads-highlight[data-thread-id="${thread.id}"]`);
    // An orphaned thread has no mark in the page: its stored quote is all that is left of the anchor.
    const quoteText = mark?.textContent?.trim() || (thread.orphaned ? thread.anchor?.quote ?? '' : '');
    if (quoteText) {
      const quoteHeader = document.createElement('div');
      quoteHeader.className = 'threads-thread__quote-badge';
      quoteHeader.appendChild(createSvgElement('quote', 12));
      const textSpan = document.createElement('span');
      textSpan.className = 'threads-thread__quote-text';
      textSpan.textContent = `"${quoteText}"`;
      quoteHeader.appendChild(textSpan);

      if (isSidebar) {
        quoteHeader.title = 'Jump to highlight in text';
        quoteHeader.addEventListener('click', (e) => {
          e.stopPropagation();
          mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          mark?.classList.add('threads-thread--flash');
          setTimeout(() => mark?.classList.remove('threads-thread--flash'), 2000);
        });
      } else {
        const openBtn = document.createElement('button');
        openBtn.className = 'threads-thread__open-panel-btn';
        openBtn.title = 'Open discussion in sidebar';
        openBtn.innerHTML = `<span>Sidebar</span>${getThreadSvg('external-link', 11)}`;
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeAiDrawerIfOpen();
          document.body.classList.add('tc-panel-open');
          this.selectTab('threads');
          const targetInPanel = document.querySelector(`.tc-panel__body .threads-thread[data-thread-id="${thread.id}"]`);
          if (targetInPanel) {
            targetInPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetInPanel.classList.add('threads-thread--flash');
            setTimeout(() => targetInPanel.classList.remove('threads-thread--flash'), 2000);
          }
        });
        quoteHeader.appendChild(openBtn);
      }
      threadEl.appendChild(quoteHeader);
    }

    // Render comments
    const topLevelComments = thread.comments.filter(c => !c.parent_id);
    const replyComments = thread.comments.filter(c => !!c.parent_id);

    for (const comment of topLevelComments) {
      const commentEl = this.renderCommentElement(thread.id, comment, false);
      const replies = replyComments.filter(r => r.parent_id === comment.id);
      if (replies.length > 0) {
        const repliesContainer = document.createElement('div');
        repliesContainer.className = 'threads-replies';
        for (const reply of replies) {
          repliesContainer.appendChild(this.renderCommentElement(thread.id, reply, true));
        }
        const contentCol = commentEl.querySelector('.threads-comment__content');
        if (contentCol) {
          contentCol.appendChild(repliesContainer);
        } else {
          commentEl.appendChild(repliesContainer);
        }
      }
      threadEl.appendChild(commentEl);
    }

    // Footer with summary, new comment, resolve/unresolve, and collapse toggle
    const footer = document.createElement('div');
    footer.className = 'threads-thread__footer';

    const allCommentEls = threadEl.querySelectorAll<HTMLElement>('.threads-comment');
    const summaryEl = document.createElement('div');
    summaryEl.className = 'threads-thread__summary';
    summaryEl.textContent = this.buildCollapseSummary(allCommentEls);
    footer.appendChild(summaryEl);

    // "+ New Comment" button
    const btn = document.createElement('button');
    btn.className = 'threads-new-comment-btn';
    btn.appendChild(createSvgElement('plus', 13));
    btn.appendChild(document.createTextNode(' ' + t('newComment')));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openReplyEditor(threadEl, thread.id, null);
    });
    footer.appendChild(btn);

    // Resolve / Unresolve button
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'threads-resolve-btn';
    resolveBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:4px 8px;margin-left:auto;color:' + (thread.resolved ? 'var(--tc-muted-fg)' : 'hsl(142 60% 45%)') + ';display:inline-flex;align-items:center;gap:4px;font-family:var(--tc-font);';
    resolveBtn.appendChild(createSvgElement(thread.resolved ? 'x' : 'check', 13));
    resolveBtn.appendChild(document.createTextNode(thread.resolved ? ' ' + (t('unresolve') || 'Unresolve') : ' ' + (t('resolve') || 'Resolve')));
    resolveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const identity = getIdentityPayload();
        await api.resolveThread(thread.id, { resolved_by: identity.author });
        await this.loadThreads();
      } catch (err) {
        console.error('[threads] Failed to toggle resolve:', err);
      }
    });
    if (canShowFor('resolve-thread', { threadAuthor: thread.comments[0]?.authorKey, drafted: !!thread.draft })) footer.appendChild(resolveBtn);

    // Collapse toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'threads-collapse-btn';
    toggleBtn.appendChild(createSvgElement('chevron-up', 14));
    toggleBtn.title = t('collapseThread');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = threadEl.classList.toggle('threads-thread--collapsed');
      toggleBtn.innerHTML = '';
      toggleBtn.appendChild(createSvgElement(isCollapsed ? 'chevron-down' : 'chevron-up', 14));
      toggleBtn.title = isCollapsed ? t('expandThread') : t('collapseThread');
    });
    footer.appendChild(toggleBtn);

    threadEl.appendChild(footer);
    return threadEl;
  }

  private renderCommentElement(threadId: string, comment: Comment, isReply = false): HTMLElement {
    const commentEl = document.createElement('div');
    commentEl.className = 'threads-comment' + (isReply ? ' threads-comment--reply' : '');
    commentEl.dataset.commentId = comment.id;
    if (comment.parent_id) commentEl.dataset.parentId = comment.parent_id;
    commentEl.dataset.author = comment.author;
    commentEl.dataset.date = comment.date;
    if (comment.edited_at) commentEl.dataset.edited = comment.edited_at;

    // Avatar column
    const avatarCol = document.createElement('div');
    avatarCol.className = 'threads-comment__avatar-col';
    const authorInfo = this.resolveAuthor(comment.author);
    if (authorInfo?.avatarUrl) {
      const avatar = document.createElement('img');
      avatar.className = 'threads-comment__avatar';
      avatar.src = authorInfo.avatarUrl;
      avatar.alt = authorInfo.name || comment.author;
      avatarCol.appendChild(avatar);
    } else {
      const avatarPlaceholder = document.createElement('div');
      avatarPlaceholder.className = 'threads-comment__avatar';
      avatarPlaceholder.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--tc-muted);color:var(--tc-muted-fg);border-radius:50%;font-size:11px;font-weight:600;';
      avatarPlaceholder.textContent = (comment.author || '?').charAt(0).toUpperCase();
      avatarCol.appendChild(avatarPlaceholder);
    }
    commentEl.appendChild(avatarCol);

    // Main content column: meta -> body -> reactionsBar (flex column)
    const content = document.createElement('div');
    content.className = 'threads-comment__content';

    // Meta header
    const meta = document.createElement('div');
    meta.className = 'threads-comment__meta';

    const authorStrong = document.createElement('strong');
    authorStrong.className = 'threads-comment__author';
    authorStrong.textContent = authorInfo?.name || comment.author;
    meta.appendChild(authorStrong);

    const sep = document.createElement('span');
    sep.className = 'threads-comment__sep';
    sep.textContent = ' · ';
    meta.appendChild(sep);

    const dateSpan = document.createElement('span');
    dateSpan.className = 'threads-comment__date';
    dateSpan.textContent = formatDateTime(comment.date);
    if (comment.date) dateSpan.title = comment.date;
    meta.appendChild(dateSpan);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'threads-comment__actions';

    // Reply button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'threads-comment-reply-btn';
    replyBtn.appendChild(createSvgElement('reply', 13));
    replyBtn.appendChild(document.createTextNode(' ' + t('reply')));
    replyBtn.title = t('replyToComment');
    replyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentThreadEl = commentEl.closest('.threads-thread') as HTMLElement;
      if (parentThreadEl) {
        this.openReplyEditor(parentThreadEl, threadId, comment.id);
      }
    });
    actions.appendChild(replyBtn);

    // Delete button: only when user is author or admin and canShowFor passes
    const delTarget = deleteCommentTarget(this.threads.find(th => th.id === threadId)?.comments ?? [], comment.id);
    if (canShowFor('delete-comment', delTarget) && this.canDeleteComment(delTarget, comment.author, comment.authorKey)) {
      const delBtn = document.createElement('button');
      delBtn.className = 'threads-delete-btn';
      delBtn.appendChild(createSvgElement('trash', 13));
      delBtn.title = t('deleteComment');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteTarget = { type: 'comment', id: comment.id, threadId };
        const dialog = this.querySelector<HTMLElement & { open: boolean }>('#delete-dialog');
        if (dialog) dialog.open = true;
      });
      actions.appendChild(delBtn);
    }

    meta.appendChild(actions);
    content.appendChild(meta);

    // Body
    const body = document.createElement('div');
    body.className = 'threads-comment__body';
    const paragraphs = comment.body.split(/\n\n+/);
    for (const pText of paragraphs) {
      const p = document.createElement('p');
      p.textContent = pText;
      body.appendChild(p);
    }
    content.appendChild(body);

    // Reactions bar on dedicated line
    const reactions = comment.reactions || [];
    content.appendChild(this.renderReactionsBar(threadId, comment.id, reactions));

    commentEl.appendChild(content);
    return commentEl;
  }

  // ─── Reactions & Emoji picker ──────────────────────────────────────

  private activeEmojiPopover: HTMLElement | null = null;

  private async handleToggleReaction(threadId: string, commentId: string, emoji: string): Promise<void> {
    try {
      const identity = getIdentityPayload();
      const updatedReactions = await api.toggleReaction(threadId, commentId, { emoji, author: identity.author || 'Anonymous' });
      // Instantly update all instances in DOM (both in-page and sidebar)
      this.updateCommentReactionsInDOM(threadId, commentId, updatedReactions);
      await this.loadThreads();
    } catch (err) {
      console.error('[threads] Failed to toggle reaction:', err);
    }
  }

  private updateCommentReactionsInDOM(threadId: string, commentId: string, reactions: Reaction[]): void {
    const thread = this.threads.find(th => th.id === threadId);
    const comm = thread?.comments.find(c => c.id === commentId);
    if (comm) {
      comm.reactions = reactions;
    }
    const comments = document.querySelectorAll<HTMLElement>(`.threads-comment[data-comment-id="${CSS.escape(commentId)}"]`);
    for (const commentEl of comments) {
      const existingBar = commentEl.querySelector('.threads-comment__reactions-bar');
      const newBar = this.renderReactionsBar(threadId, commentId, reactions);
      if (existingBar) {
        existingBar.replaceWith(newBar);
      } else {
        const contentCol = commentEl.querySelector('.threads-comment__content');
        if (contentCol) {
          contentCol.appendChild(newBar);
        } else {
          const bodyEl = commentEl.querySelector('.threads-comment__body');
          if (bodyEl) bodyEl.insertAdjacentElement('afterend', newBar);
          else commentEl.appendChild(newBar);
        }
      }
    }
  }

  private toggleEmojiPicker(anchorEl: HTMLElement, threadId: string, commentId: string): void {
    if (this.activeEmojiPopover) {
      this.activeEmojiPopover.remove();
      this.activeEmojiPopover = null;
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'threads-emoji-popover';

    for (const emoji of EMOJI_PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'threads-emoji-popover__btn';
      btn.textContent = emoji;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.remove();
        this.activeEmojiPopover = null;
        void this.handleToggleReaction(threadId, commentId, emoji);
      });
      popover.appendChild(btn);
    }

    document.body.appendChild(popover);
    this.activeEmojiPopover = popover;

    const rect = anchorEl.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${Math.max(8, rect.left + window.scrollX - 4)}px`;

    const closeHandler = (e: MouseEvent) => {
      if (this.activeEmojiPopover && !this.activeEmojiPopover.contains(e.target as Node) && e.target !== anchorEl) {
        this.activeEmojiPopover.remove();
        this.activeEmojiPopover = null;
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  private renderReactionsBar(threadId: string, commentId: string, reactions: Reaction[]): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'threads-comment__reactions-bar';

    const identity = getIdentityPayload();
    const currentAuthor = identity.author || '';

    for (const r of reactions) {
      if (!r.authors || r.authors.length === 0) continue;
      const pill = document.createElement('button');
      const isActive = r.authors.includes(currentAuthor);
      pill.className = `threads-reaction-pill${isActive ? ' threads-reaction-pill--active' : ''}`;
      pill.title = r.authors.join(', ');
      pill.innerHTML = `${r.emoji} <span class="threads-reaction-pill__count">${r.authors.length}</span>`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.handleToggleReaction(threadId, commentId, r.emoji);
      });
      bar.appendChild(pill);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'threads-add-reaction-btn';
    addBtn.title = t('addReaction') || 'Add reaction';
    addBtn.appendChild(createSvgElement('emoji-smile', 13));
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleEmojiPicker(addBtn, threadId, commentId);
    });
    bar.appendChild(addBtn);

    return bar;
  }

  // ─── Floating action button ──────────────────────────────────────

  private injectFab(): void {
    if (document.querySelector('.threads-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'threads-fab';
    fab.title = t('jumpToThreads');
    fab.appendChild(createSvgElement('messages-square', 18));

    const badgeWrap = document.createElement('span');
    badgeWrap.className = 'threads-fab__badge-wrap';

    const badge = document.createElement('span');
    badge.className = 'threads-fab__badge';
    badge.style.display = 'none';
    badgeWrap.appendChild(badge);

    fab.appendChild(badgeWrap);

    fab.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('tc-panel-open');
      if (isOpen) {
        document.body.classList.remove('tc-panel-open');
      } else {
        this.closeAiDrawerIfOpen();
        document.body.classList.add('tc-panel-open');
        this.populateSidebarPanel(true);
      }
    });

    document.body.appendChild(fab);
  }

  private closeAiDrawerIfOpen(): void {
    const aiDrawer = document.getElementById('docmd-ai-drawer');
    const aiBar = document.getElementById('docmd-ai-bar-wrap');
    if (aiDrawer?.classList.contains('open')) {
      aiDrawer.classList.remove('open');
      aiBar?.classList.remove('hidden');
    }
  }

  private updateFabBadge(): void {
    const badge = document.querySelector('.threads-fab__badge') as HTMLElement | null;
    if (!badge) return;
    const count = this.threads.filter(t => !t.resolved).length;
    // When unpublished marker is active on FAB, hide open-threads badge to avoid confusing dual-pill crowding
    const hasUnpublished = this.unpublishedCount > 0;
    if (count > 0 && !hasUnpublished) {
      badge.textContent = String(count);
      badge.title = `${count} ${t('openCount') || 'discussions'}`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // ─── Delete confirmation ──────────────────────────────────────────

  private handleDeleteRequest(e: CustomEvent, type: 'thread' | 'comment'): void {
    const id = type === 'thread' ? e.detail.threadId : e.detail.commentId;
    const threadId = type === 'comment' ? e.detail.threadId : undefined;
    this.deleteTarget = { type, id, threadId };
    const dialog = this.querySelector<HTMLElement & { open: boolean }>('#delete-dialog');
    if (dialog) dialog.open = true;
  }

  private async confirmDelete(): Promise<void> {
    const dialog = this.querySelector<HTMLElement & { open: boolean }>('#delete-dialog');
    if (dialog) dialog.open = false;

    if (!this.deleteTarget) return;
    const target = this.deleteTarget;
    this.deleteTarget = null;

    try {
      if (target.type === 'thread') {
        await api.deleteThread(target.id);
        const marks = document.querySelectorAll<HTMLElement>(`mark.threads-highlight[data-thread-id="${target.id}"]`);
        marks.forEach(m => {
          const parent = m.parentNode;
          while (m.firstChild) parent?.insertBefore(m.firstChild, m);
          m.remove();
        });
        document.querySelectorAll(`.threads-thread[data-thread-id="${target.id}"]`).forEach(el => el.remove());
      } else {
        await api.deleteComment(target.threadId!, target.id);
      }
    } catch (err) {
      console.error('[threads] Failed to delete:', err);
    }
    await this.loadThreads();
  }

  private cancelDelete(): void {
    const dialog = this.querySelector<HTMLElement & { open: boolean }>('#delete-dialog');
    if (dialog) dialog.open = false;
    this.deleteTarget = null;
  }

  override render() {
    return html`
      <threads-popover
        ?active=${this.popoverActive}
        .x=${this.popoverX}
        .y=${this.popoverY}
        @add-comment=${this.handleAddComment}
      ></threads-popover>

      <sl-dialog id="delete-dialog" label=${t('confirmDelete')}>
        ${t('confirmDeleteMessage')} ${this.deleteTarget?.type ?? 'item'}?
        <sl-button slot="footer" variant="neutral" @click=${this.cancelDelete}>${t('cancel')}</sl-button>
        <sl-button slot="footer" variant="danger" @click=${this.confirmDelete}>${t('delete')}</sl-button>
      </sl-dialog>
    `;
  }
}