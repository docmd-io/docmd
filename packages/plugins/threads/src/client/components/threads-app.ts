import { LitElement, html, nothing, render } from 'lit';
import { state } from 'lit/decorators.js';
import { defineOnce } from './define';
import { repeat } from 'lit/directives/repeat.js';
import type { Thread, Anchor, AuthorsMap, Reaction } from '../../types';
import * as api from '../lib/api';
import { initIdentity, getIdentityPayload, getIdentityMode, getViewer, canShowFor, PROFILE_SAVED_EVENT } from '../lib/identity';
import { computeAnchor, getContentArea, getSelectionPosition, isWithinContent, pathHasThreadsElement } from '../lib/selection';
import { t } from '../lib/i18n';
import { createPublishMount } from '../lib/publish-mount';
import type { RequestDetail } from '../lib/request';
import { threadIdFromHash } from '../lib/reviews-view';
import { planDraftMarks, type PageMark } from '../lib/draft-marks';
import { hideRawSidebars } from '../lib/raw-sidebars';
import { QUICK_REACTIONS, toReactionViews } from '../lib/reactions';
import { colorAt, deleteScope, pickerUrls, type CardColor } from '../lib/thread-view';

import './threads-button';
import './threads-dialog';
import './threads-editor';
import './threads-identity';
import './threads-publish-widget';
import './threads-reviews-panel';
import './threads-panel';
import './threads-thread';
import type { ThreadsReviewsPanel } from './threads-reviews-panel';
import type { ThreadsPanel, PanelTab } from './threads-panel';
import type { ThreadsThread } from './threads-thread';
import type { ReactionOptions } from './threads-comment';
import type { ThreadsPublishWidget } from './threads-publish-widget';

/** Text under these is never a target when highlighting drafts after a load: thread cards, the panel, scripts. */
const SKIP_WRAP = '.threads-thread, threads-thread, .tc-panel, threads-panel, threads-app, script, style';

/** A request event from a card: the app calls `waitUntil` with the promise of the work. */
type CardEvent<D> = CustomEvent<D & RequestDetail>;

/** Blocks an inline card can follow: the nearest one around a mark. */
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE']);

/** The block a mark sits in, or null when it is directly in the body. */
function blockOf(mark: Element): HTMLElement | null {
  for (let el: Element | null = mark; el && el !== document.body; el = el.parentElement) {
    if (el instanceof HTMLElement && BLOCK_TAGS.has(el.tagName)) return el;
  }
  return null;
}

/**
 * Put a card directly after a block, after any cards already there, with no wrapper. A card already
 * in that run stays where it is, so a reload that re-inserts the same instances does not shuffle them.
 */
function placeAfterBlock(block: HTMLElement, card: HTMLElement): void {
  let ref: Element = block;
  for (let n = block.nextElementSibling; n && n.localName === 'threads-thread'; n = n.nextElementSibling) {
    if (n === card) return;
    ref = n;
  }
  ref.insertAdjacentElement('afterend', card);
}

export class ThreadsApp extends LitElement {
  override createRenderRoot() { return this; }

  @state() private threads: Thread[] = [];
  @state() private authorsMap: AuthorsMap = {};

  /** Inline cards, kept across reloads: a detached card keeps its open editors, typed text and collapsed state. */
  private instances = new Map<string, ThreadsThread>();
  /** Threads whose cards are collapsed, shared by a thread's inline and panel copies. */
  private collapsed = new Set<string>();
  private colors = new Map<string, CardColor>();
  /** The first mark of each thread in the page. */
  private marks = new Map<string, HTMLElement>();
  /** Comment id to the HTML the build rendered for it, read from the page's own server markup. */
  private bodies = new Map<string, string>();
  /** The cards replaced the server markup (the threads loaded at least once on this page). */
  private hydrated = false;
  /** Where the panel's cards end: they are rendered before this marker, so the reviews panel and publish widget appended after it stay. */
  private cardsEnd: Comment | null = null;

  /** Settles once `whoami` has answered; nothing that renders buttons or may prompt for a name runs before. */
  private identityReady: Promise<void> = Promise.resolve();
  private identityKnown = false;
  private pendingMouseUp: MouseEvent | null = null;
  private pendingAnchor: Anchor | null = null;
  private pendingBlockEl: HTMLElement | null = null;
  private deleteTarget: { type: 'thread' | 'comment'; id: string; threadId?: string } | null = null;
  private inlineEditorEl: HTMLElement | null = null;
  /** The panel: its cards, the reviews panel and the publish widget are its children. */
  private panelEl: ThreadsPanel | null = null;
  /** The last unpublished count the review section reported. */
  private unpublishedCount = 0;
  /** The `#thread-<id>` of the open URL has been revealed (or there is none); reset on a hash change and a page mount. */
  private deepLinkDone = false;
  private publishMount = createPublishMount<ThreadsPublishWidget>({
    isLive: () => docmd.isLive!(), // mountPublishWidget guards docmd and isLive before start()
    isConnected: () => this.isConnected,
    create: () => {
      const el = document.createElement('threads-publish-widget') as ThreadsPublishWidget;
      // The review section: pinned to the bottom of the panel, mounted whether or not the panel is open.
      if (!this.panelEl) return el; // no panel to show it in: nothing to refresh
      el.slot = 'footer';
      this.panelEl.appendChild(el);
      this.panelEl.showTabs = true;
      void el.refresh();
      return el;
    },
    remove: (el) => {
      el.remove();
      if (this.panelEl) this.panelEl.showTabs = false; // the panel falls back to the Threads tab itself
    },
  });

  /** Whether sidebar mode is enabled via plugin config. Default: false (inline mode). */
  private get sidebarEnabled(): boolean {
    return !!(window as any).__threads_config?.sidebar;
  }

  /** The card events the app answers; each is a request event whose promise the card waits on. */
  private cardEvents: Array<[string, EventListener]> = [
    ['threads-resolve', (e) => this.onResolve(e as CardEvent<{ threadId: string }>)],
    ['threads-comment-submit', (e) => this.onCommentSubmit(e as CardEvent<{ threadId: string; parentId: string | null; body: string }>)],
    ['threads-edit', (e) => this.onEdit(e as CardEvent<{ threadId: string; commentId: string; body: string }>)],
    ['threads-delete', (e) => this.onDelete(e as CardEvent<{ threadId: string; commentId: string }>)],
    ['threads-react', (e) => this.onReact(e as CardEvent<{ threadId: string; commentId: string; emoji: string }>)],
    ['threads-collapse-change', (e) => this.onCollapseChange(e as CustomEvent<{ threadId: string; collapsed: boolean }>)],
    ['threads-reveal-quote', (e) => this.revealMark((e as CustomEvent<{ threadId: string }>).detail.threadId)],
    ['threads-open-panel', (e) => this.revealInPanel((e as CustomEvent<{ threadId: string }>).detail.threadId)],
  ];

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const [type, listener] of this.cardEvents) document.removeEventListener(type, listener);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousedown', this.handleOutsidePopoverClick);
    document.removeEventListener('docmd:page-mounted', this.handlePageMounted as EventListener);
    window.removeEventListener('hashchange', this.handleHashChange);
    document.removeEventListener('reviews-changed', this.handleReviewsChanged);
    document.removeEventListener(PROFILE_SAVED_EVENT, this.handleProfileSaved);
    document.removeEventListener('unpublished-count-change', this.handleUnpublishedCount as EventListener);
    this.publishMount.stop();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    for (const [type, listener] of this.cardEvents) document.addEventListener(type, listener);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousedown', this.handleOutsidePopoverClick);
    document.addEventListener('docmd:page-mounted', this.handlePageMounted as EventListener);
    window.addEventListener('hashchange', this.handleHashChange);
    document.addEventListener('reviews-changed', this.handleReviewsChanged);
    document.addEventListener(PROFILE_SAVED_EVENT, this.handleProfileSaved);
    document.addEventListener('unpublished-count-change', this.handleUnpublishedCount as EventListener);

    this.initPanel();

    // Who the caller is decides which buttons render and whether a name is ever asked: learn it first.
    this.identityReady = initIdentity(api.whoami).then(() => { this.identityKnown = true; });
    void this.identityReady.then(() => {
      if (!this.isConnected) return;
      this.injectIdentityButton();
      this.loadThreads();
      this.injectNewThreadButton();
      this.mountPublishWidget();
    });

    // Register afterReload handler for post-mutation continuity
    if (typeof docmd !== 'undefined' && docmd.afterReload) {
      docmd.afterReload('threads', () => {
        void this.identityReady.then(() => {
          this.loadThreads();
          this.injectNewThreadButton();
          this.updatePanelState();
        });
      });
    }
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

    const contentArea = getContentArea();
    if (!contentArea) return;

    const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    // Only target direct children of the content area - avoids TOC, sidebar headings, etc.
    const headings = Array.from(contentArea.children).filter(el => HEADING_TAGS.has(el.tagName));

    for (const heading of headings) {
      // Only target direct-ish headings inside the content area
      if (!HEADING_TAGS.has(heading.tagName)) continue;

      heading.classList.add('threads-heading-wrap');

      const btn = document.createElement('threads-button');
      btn.className = 'threads-new-thread-btn';
      btn.setAttribute('size', 'sm');
      btn.setAttribute('icon', 'plus');
      btn.setAttribute('label', t('startThread'));
      btn.textContent = t('newThread');
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

    const editor = this.createEditor('', async (body) => {
      try {
        await api.createThread({ anchor: null, ...getIdentityPayload(), body });
      } catch (err) {
        console.error('[threads] Failed to create thread:', err);
        throw err;
      }
      this.removeInlineEditor();
      await this.loadThreads();
    });

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
    // A mouse-up inside one of our components (a card's text, an editor, the selection button) is not a
    // selection of the page: an inline card sits in the content area and would become the "block".
    if (pathHasThreadsElement(e.composedPath() as Array<{ tagName?: string }>)) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      this.hideSelectionButton();
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
    this.showSelectionButton(pos.x, pos.y);
  };

  private handleOutsidePopoverClick = (e: MouseEvent): void => {
    const button = this.selectionButton();
    if (button && !e.composedPath().includes(button)) this.hideSelectionButton();
  };

  /** The "Add comment" button, a popover=manual `threads-button` rendered by this element. */
  private selectionButton(): HTMLElement | null {
    return this.querySelector<HTMLElement>('threads-button.threads-selection');
  }

  /** Put the button above the point (x, y of the viewport) in the top layer. */
  private showSelectionButton(x: number, y: number): void {
    const button = this.selectionButton();
    if (!button) return;
    button.style.setProperty('--threads-selection-x', `${x}px`);
    button.style.setProperty('--threads-selection-y', `${y}px`);
    try {
      if (!button.matches(':popover-open')) button.showPopover();
    } catch (err) {
      console.error('[threads] Could not show the selection button:', err);
    }
  }

  private hideSelectionButton(): void {
    const button = this.selectionButton();
    try {
      if (button?.matches(':popover-open')) button.hidePopover();
    } catch {
      // No popover support or already hidden: nothing to take back.
    }
  }

  /**
   * Handle popover "add comment" - open inline editor after the block.
   */
  private handleAddComment(): void {
    if (!this.pendingAnchor || !this.pendingBlockEl) return;

    this.removeInlineEditor();
    this.hideSelectionButton();

    const anchor = this.pendingAnchor;
    const blockEl = this.pendingBlockEl;
    this.pendingAnchor = null;
    this.pendingBlockEl = null;
    window.getSelection()?.removeAllRanges();

    const editor = this.createEditor(anchor.quote || '', async (body) => {
      let createdThread: Thread;
      try {
        createdThread = await api.createThread({ anchor, ...getIdentityPayload(), body });
      } catch (err) {
        console.error('[threads] Failed to create thread:', err);
        throw err;
      }
      this.removeInlineEditor();
      if (anchor?.quote && createdThread?.id && blockEl) {
        this.wrapAnchorInMark(blockEl, anchor.quote, createdThread.id);
      }
      await this.loadThreads();
    });

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
    }
    const root = getContentArea() as HTMLElement | null;
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
    this.hideSelectionButton();
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
    return this.panelEl?.querySelector<ThreadsReviewsPanel>('threads-reviews-panel') ?? null;
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
    const mark = this.marks.get(id) ?? document.querySelector<HTMLElement>(`mark.threads-highlight[data-thread-id="${CSS.escape(id)}"]`);
    const card = this.instances.get(id);
    const target = mark ?? (card?.isConnected ? card : null);
    if (!target) return;
    this.deepLinkDone = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (mark) this.flashMark(mark);
    else if (card) card.flash = true;
  }

  private flashMark(mark: HTMLElement): void {
    mark.classList.add('threads-thread--flash');
    setTimeout(() => mark.classList.remove('threads-thread--flash'), 2000);
  }

  /** A profile was saved (name, avatar or Profile link): re-read authors.json and redraw the names. */
  private handleProfileSaved = (): void => {
    void api.fetchAuthors().then((authors) => {
      if (!authors || typeof authors !== 'object') return;
      this.authorsMap = authors;
      if (this.hydrated) this.renderCards();
    });
  };

  private async loadThreads(): Promise<void> {
    await this.identityReady;
    let loaded = false;
    try {
      const [threads, authors] = await Promise.all([
        api.fetchThreads(),
        api.fetchAuthors(),
      ]);
      if (Array.isArray(threads)) {
        this.threads = threads;
        loaded = true;
      }
      if (authors && typeof authors === 'object') {
        this.authorsMap = authors;
      }
    } catch (err) {
      console.error('[threads] Failed to load threads:', err);
    }
    this.syncDraftMarks();
    this.scanMarks();
    // The cards replace the server markup only when there is data to build them from; on a failed load
    // the server cards stay visible and readable.
    if (loaded) this.hydrate();
    this.updatePanelState();
    void this.publishMount.widget?.refresh();
    this.handleDeepLink();
  }

  /** The review section reports its unpublished count: show it on the FAB and the toggle strip. */
  private handleUnpublishedCount = (e: CustomEvent<{ count: number }>): void => {
    const count = e.detail.count;
    // Publishing empties the open review: the review it made is new in the Reviews tab.
    if (count < 1 && this.unpublishedCount > 0) void this.reviewsPanel()?.refresh();
    this.unpublishedCount = count;
    if (this.panelEl) this.panelEl.unpublished = count;
  };

  /** The publish widget exists only against a live server. */
  private mountPublishWidget(): void {
    if (typeof docmd === 'undefined' || !docmd.isLive) return;
    this.publishMount.start();
  }

  // ─── Marks, cards and hydration ────────────────────────────────────

  /**
   * Colour the page's marks (one colour per thread, cycling) and make each open its thread in the
   * panel. Runs whether or not the load succeeded: with no data a click scrolls to the server card.
   */
  private scanMarks(): void {
    this.marks.clear();
    this.colors.clear();
    let next = 0;
    for (const mark of document.querySelectorAll<HTMLElement>('mark.threads-highlight[data-thread-id]')) {
      const threadId = mark.dataset.threadId;
      if (!threadId) continue;
      if (!this.colors.has(threadId)) {
        this.colors.set(threadId, colorAt(next++));
        this.marks.set(threadId, mark);
      }
      for (const cls of [...mark.classList]) if (cls.startsWith('threads-hl-')) mark.classList.remove(cls);
      mark.classList.add(`threads-hl-${this.colors.get(threadId)}`);
      mark.onclick = (e) => {
        e.stopPropagation();
        if (this.hydrated) this.revealInPanel(threadId);
        else this.scrollToServerCard(threadId);
      };
    }
  }

  /** Before the cards exist (or when the load failed): bring the build's own card into view. */
  private scrollToServerCard(threadId: string): void {
    document.querySelector<HTMLElement>(`.threads-sidebar .threads-thread[data-thread-id="${CSS.escape(threadId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Replace the server markup with the cards, in one task: read the comment bodies the build rendered,
   * place the inline cards and the panel's cards, then hide the server markup.
   */
  private hydrate(): void {
    this.readBodies();
    this.renderCards();
    hideRawSidebars(document);
    this.hydrated = true;
  }

  /** Copy each published comment's body HTML from the page's server markup, before that markup is hidden. */
  private readBodies(): void {
    const bodies = new Map<string, string>();
    for (const el of document.querySelectorAll<HTMLElement>('.threads-sidebar .threads-comment[data-comment-id]')) {
      const body = el.querySelector(':scope > .threads-comment__body');
      if (body && el.dataset.commentId) bodies.set(el.dataset.commentId, body.innerHTML);
    }
    this.bodies = bodies;
  }

  /** Reaction options from the site's config and where the lazy picker and its emoji data are served. */
  private reactionOptions(): ReactionOptions {
    const cfg = (window.__threads_config as { reactions?: { emoji?: unknown; restricted?: unknown } } | undefined)?.reactions;
    const options = Array.isArray(cfg?.emoji) && cfg.emoji.every((e) => typeof e === 'string') ? (cfg.emoji as string[]) : [...QUICK_REACTIONS];
    return { options, restricted: cfg?.restricted === true, ...pickerUrls(import.meta.url, document.documentElement.lang) };
  }

  private get profileUrl(): string | null {
    const url = (window.__threads_config as { profileUrl?: unknown } | undefined)?.profileUrl;
    return typeof url === 'string' && url ? url : null;
  }

  /** The text of the mark, or an orphan's stored quote (the mark is gone from the page). */
  private quoteFor(thread: Thread): string {
    return this.marks.get(thread.id)?.textContent?.trim() || (thread.orphaned ? thread.anchor?.quote ?? '' : '');
  }

  /** Give a card its data. The inline copy and the panel's copy of a thread get the same. */
  private cardProps(thread: Thread) {
    return {
      thread,
      bodies: this.bodies,
      authors: this.authorsMap,
      viewer: getViewer(),
      profileUrl: this.profileUrl,
      reactionOptions: this.reactionOptions(),
      canShow: canShowFor,
      localMode: getIdentityMode().mode === 'local',
      color: this.colors.get(thread.id) ?? ('neutral' as CardColor),
      quote: this.quoteFor(thread),
      collapsed: this.collapsed.has(thread.id),
    };
  }

  /** Place the inline cards and render the panel's cards from the current data. */
  private renderCards(): void {
    this.renderInlineCards();
    this.renderPanelCards();
  }

  /**
   * Inline mode: one kept `threads-thread` per thread that has a mark, directly after the mark's block
   * (no wrapper element, so stored block selectors do not depend on whether cards are loaded). After a
   * page reload the article is new; the same instances are put back after the new blocks.
   */
  private renderInlineCards(): void {
    const wanted = new Set<string>();
    if (!this.sidebarEnabled) {
      for (const thread of this.threads) {
        const mark = this.marks.get(thread.id);
        const block = mark ? blockOf(mark) : null;
        if (!block) continue;
        wanted.add(thread.id);
        let card = this.instances.get(thread.id);
        if (!card) {
          card = document.createElement('threads-thread');
          this.instances.set(thread.id, card);
        }
        card.variant = 'inline';
        Object.assign(card, this.cardProps(thread));
        placeAfterBlock(block, card);
      }
    }
    for (const [id, card] of this.instances) {
      if (wanted.has(id)) continue;
      card.remove();
      this.instances.delete(id);
    }
  }

  /** The panel's card for a thread, if rendered. */
  private panelCard(threadId: string): ThreadsThread | null {
    return this.panelEl?.querySelector<ThreadsThread>(`threads-thread[data-thread-id="${CSS.escape(threadId)}"]`) ?? null;
  }

  private cardTemplate(thread: Thread) {
    const p = this.cardProps(thread);
    return html`<threads-thread
      variant="panel"
      slot=${thread.orphaned ? 'orphans' : nothing}
      .thread=${p.thread}
      .bodies=${p.bodies}
      .authors=${p.authors}
      .viewer=${p.viewer}
      .profileUrl=${p.profileUrl}
      .reactionOptions=${p.reactionOptions}
      .canShow=${p.canShow}
      .localMode=${p.localMode}
      .color=${p.color}
      .quote=${p.quote}
      .collapsed=${p.collapsed}
      data-thread-id=${thread.id}
    ></threads-thread>`;
  }

  /** Bring a thread into view in the panel: open it, show the Threads tab, scroll to the card and flash it. */
  private revealInPanel(threadId: string): void {
    const panel = this.panelEl;
    if (!panel) return;
    panel.open = true;
    panel.tab = 'threads';
    void panel.updateComplete.then(() => {
      const card = this.panelCard(threadId);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.flash = true;
    });
  }

  /** The card's quote was clicked: scroll to the highlight in the text and flash it. */
  private revealMark(threadId: string): void {
    const mark = this.marks.get(threadId);
    if (!mark) return;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.flashMark(mark);
  }

  // ─── What the cards ask for ─────────────────────────────────────────

  /** Resolve or unresolve (the server toggles), then reload; the card shows the error if it fails. */
  private onResolve(e: CardEvent<{ threadId: string }>): void {
    e.detail.waitUntil((async () => {
      await api.resolveThread(e.detail.threadId, { resolved_by: getIdentityPayload().author });
      await this.loadThreads();
    })());
  }

  private onCommentSubmit(e: CardEvent<{ threadId: string; parentId: string | null; body: string }>): void {
    const { threadId, parentId, body } = e.detail;
    e.detail.waitUntil((async () => {
      await api.addComment(threadId, { ...getIdentityPayload(), body, parentId });
      await this.loadThreads();
    })());
  }

  private onEdit(e: CardEvent<{ threadId: string; commentId: string; body: string }>): void {
    const { threadId, commentId, body } = e.detail;
    e.detail.waitUntil((async () => {
      await api.editComment(threadId, commentId, { body });
      await this.loadThreads();
    })());
  }

  /** Deleting the only comment deletes the thread; the app asks first. */
  private onDelete(e: CardEvent<{ threadId: string; commentId: string }>): void {
    const { threadId, commentId } = e.detail;
    const thread = this.threads.find((th) => th.id === threadId);
    if (!thread) return;
    this.askDelete(deleteScope(thread) === 'thread' ? { type: 'thread', id: threadId } : { type: 'comment', id: commentId, threadId });
  }

  /**
   * Toggle a reaction; the comment shows the list the server returns (with profile links), and the
   * kept thread data takes it too so a later render of the same data does not bring the old list back.
   */
  private onReact(e: CardEvent<{ threadId: string; commentId: string; emoji: string }>): void {
    const { threadId, commentId, emoji } = e.detail;
    e.detail.waitUntil((async () => {
      const reactions: Reaction[] = await api.toggleReaction(threadId, commentId, { emoji, author: getIdentityPayload().author });
      // New objects, not an in-place change: a card whose thread is the same object would not re-render.
      this.threads = this.threads.map((th) => (th.id !== threadId ? th : {
        ...th,
        comments: th.comments.map((c) => (c.id === commentId ? { ...c, reactions } : c)),
      }));
      this.renderCards(); // the thread's other copy (inline and panel) follows, with its pressed state
      void this.publishMount.widget?.refresh(); // the toggle is an unpublished change
      return toReactionViews(reactions, this.authorsMap, this.profileUrl);
    })());
  }

  private onCollapseChange(e: CustomEvent<{ threadId: string; collapsed: boolean }>): void {
    const { threadId, collapsed } = e.detail;
    if (collapsed) this.collapsed.add(threadId);
    else this.collapsed.delete(threadId);
    this.renderCards(); // the thread's other copy follows
  }

  // ─── Inline editor helpers ────────────────────────────────────────

  /**
   * An editor for one write. `submit` does the write and throws when it fails: the editor stays
   * open with the error (the limit message, or a generic one) under the text, and keeps the text.
   */
  private createEditor(quote: string, submit: (body: string) => Promise<void>): HTMLElement {
    const editor = document.createElement('threads-editor');
    editor.className = 'threads-inline-editor';
    editor.label = t('writeComment');
    editor.placeholder = t('writeComment');
    editor.quote = quote;
    editor.addEventListener('threads-submit', (e) => {
      const { body, waitUntil } = (e as CustomEvent<{ body: string; waitUntil(p: Promise<unknown>): void }>).detail;
      waitUntil(submit(body));
    });
    editor.addEventListener('threads-cancel', () => this.removeInlineEditor());
    return editor;
  }

  private removeInlineEditor(): void {
    this.inlineEditorEl?.remove();
    this.inlineEditorEl = null;
  }

  // ─── The panel ───────────────────────────────────────────────────

  /** Put the one `threads-panel` on the page (sidebar mode from the config, else floating) and hear what it reports. */
  private initPanel(): void {
    const existing = document.querySelector<ThreadsPanel>('threads-panel');
    const panel = existing ?? document.createElement('threads-panel');
    this.panelEl = panel;
    panel.mode = this.sidebarEnabled ? 'sidebar' : 'floating';
    if (existing) {
      this.cardsEnd = Array.from(panel.childNodes).find((n): n is Comment => n.nodeType === Node.COMMENT_NODE) ?? null;
    } else {
      this.cardsEnd = document.createComment('');
      panel.appendChild(this.cardsEnd);
      panel.addEventListener('threads-panel-toggle', this.onPanelToggle as EventListener);
      panel.addEventListener('threads-tab-change', this.onTabChange as EventListener);
      panel.addEventListener('threads-new-thread', this.onNewThreadFromPanel);
      document.body.appendChild(panel);
    }
  }

  /** Opening the panel closes docmd's AI drawer (they share the right edge) and reads the review list afresh. */
  private onPanelToggle = (e: CustomEvent<{ open: boolean }>): void => {
    if (!e.detail.open) return;
    this.closeAiDrawerIfOpen();
    if (this.panelEl?.tab === 'reviews') void this.reviewsPanel()?.refresh();
  };

  /** Show the Reviews tab (the list is created with the tab and read afresh) or the Threads tab. */
  private onTabChange = (e: CustomEvent<{ tab: PanelTab }>): void => {
    const panel = this.panelEl;
    if (!panel) return;
    if (e.detail.tab !== 'reviews') {
      this.reviewsPanel()?.remove();
      return;
    }
    const existing = this.reviewsPanel();
    if (existing) {
      void existing.refresh();
      return;
    }
    const reviews = document.createElement('threads-reviews-panel');
    reviews.slot = 'reviews';
    reviews.authors = this.authorsMap;
    reviews.profileUrl = this.profileUrl;
    // A link to the URL already open fires no hashchange: reveal the thread again.
    reviews.addEventListener('reveal-thread', (ev) => {
      ev.preventDefault();
      this.deepLinkDone = false;
      this.handleDeepLink();
    });
    panel.appendChild(reviews);
  };

  /** The panel's plus: a new thread on the page's first block of text. */
  private onNewThreadFromPanel = (): void => {
    const firstHeading = getContentArea()?.querySelector('h1, h2, h3, h4, p');
    if (!firstHeading) return;
    firstHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.startNewThread(firstHeading);
  };

  /** Render the panel's cards from the current data: unresolved threads, then orphans in their own slot. */
  private renderPanelCards(): void {
    const panel = this.panelEl;
    if (!panel || !this.cardsEnd) return;
    const normal = this.threads.filter(th => !th.orphaned);
    const orphaned = this.threads.filter(th => th.orphaned);
    render(html`${repeat(normal, th => th.id, th => this.cardTemplate(th))}${repeat(orphaned, th => th.id, th => this.cardTemplate(th))}`,
      panel, { renderBefore: this.cardsEnd });
    const reviews = this.reviewsPanel();
    if (reviews) {
      reviews.authors = this.authorsMap;
      reviews.profileUrl = this.profileUrl;
    }
    this.updatePanelState();
  }

  private closeAiDrawerIfOpen(): void {
    const aiDrawer = document.getElementById('docmd-ai-drawer');
    const aiBar = document.getElementById('docmd-ai-bar-wrap');
    if (aiDrawer?.classList.contains('open')) {
      aiDrawer.classList.remove('open');
      aiBar?.classList.remove('hidden');
    }
  }

  /** The launcher's open-thread count and the empty state. */
  private updatePanelState(): void {
    if (!this.panelEl) return;
    this.panelEl.openCount = this.threads.filter(th => !th.resolved).length;
    this.panelEl.empty = this.threads.length === 0;
  }

  // ─── Delete confirmation ──────────────────────────────────────────

  private handleDeleteRequest(e: CustomEvent, type: 'thread' | 'comment'): void {
    const id = type === 'thread' ? e.detail.threadId : e.detail.commentId;
    const threadId = type === 'comment' ? e.detail.threadId : undefined;
    this.askDelete({ type, id, threadId });
  }

  /** Open the confirmation for one thread or comment. */
  private askDelete(target: { type: 'thread' | 'comment'; id: string; threadId?: string }): void {
    this.deleteTarget = target;
    this.requestUpdate(); // the question names what is deleted
    const dialog = this.querySelector('threads-dialog');
    if (dialog) dialog.open = true;
  }

  /** The dialog stays busy until this settles; a failure keeps it open with the error. */
  private confirmDelete(e: CustomEvent<{ waitUntil(p: Promise<unknown>): void }>): void {
    const target = this.deleteTarget;
    if (!target) return;
    e.detail.waitUntil(this.deleteNow(target));
  }

  private async deleteNow(target: { type: 'thread' | 'comment'; id: string; threadId?: string }): Promise<void> {
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
        this.instances.get(target.id)?.remove();
        this.instances.delete(target.id);
      } else {
        await api.deleteComment(target.threadId!, target.id);
      }
    } catch (err) {
      console.error('[threads] Failed to delete:', err);
      throw err;
    }
    this.deleteTarget = null;
    void this.loadThreads();
  }

  /** Any way of closing the question but confirming it forgets the target. */
  private handleDeleteClose(e: CustomEvent<{ reason: string }>): void {
    if (e.detail.reason !== 'confirmed') this.deleteTarget = null;
  }

  override render() {
    return html`
      <threads-button
        class="threads-selection"
        popover="manual"
        size="sm"
        variant="ghost"
        icon="chat-left-text"
        @click=${this.handleAddComment}
      >${t('addComment')}</threads-button>

      <threads-dialog
        heading=${t('confirmDelete')}
        tone="danger"
        confirm-label=${t('delete')}
        cancel-label=${t('cancel')}
        @threads-confirm=${this.confirmDelete}
        @threads-close=${this.handleDeleteClose}
      >${t('confirmDeleteMessage')} ${this.deleteTarget?.type ?? 'item'}?</threads-dialog>
    `;
  }
}

defineOnce('threads-app', ThreadsApp);