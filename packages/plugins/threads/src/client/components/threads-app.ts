import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Thread, Comment, Anchor, AuthorsMap } from '../../types';
import * as api from '../lib/api';
import { initIdentity, getIdentityPayload } from '../lib/identity';
import { computeAnchor, getSelectionPosition, isWithinContent } from '../lib/selection';
import { initThemeBridge } from '../lib/theme';
import { t } from '../lib/i18n';
import { createSvgElement, getThreadSvg } from '../lib/icons';

import './threads-popover';
import './threads-inline-editor';
import './threads-identity';

import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

@customElement('threads-app')
export class ThreadsApp extends LitElement {
  override createRenderRoot() { return this; }

  @state() private threads: Thread[] = [];
  @state() private authorsMap: AuthorsMap = {};
  @state() private popoverActive = false;
  @state() private popoverX = 0;
  @state() private popoverY = 0;

  private pendingAnchor: Anchor | null = null;
  private pendingBlockEl: HTMLElement | null = null;
  private deleteTarget: { type: 'thread' | 'comment'; id: string; threadId?: string } | null = null;
  private inlineEditorEl: HTMLElement | null = null;

  /** Whether sidebar mode is enabled via plugin config. Default: false (inline mode). */
  private get sidebarEnabled(): boolean {
    return !!(window as any).__threads_config?.sidebar;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousedown', this.handleOutsidePopoverClick);
    document.removeEventListener('docmd:page-mounted', this.handlePageMounted as EventListener);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    initThemeBridge();
    initIdentity();
    this.injectIdentityButton();
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousedown', this.handleOutsidePopoverClick);
    document.addEventListener('docmd:page-mounted', this.handlePageMounted as EventListener);

    // Always initialize sidebar column so the panel is available for FAB toggle
    this.initSidebarColumn();

    this.loadThreads();
    this.injectNewThreadButton();
    this.injectFab();

    // Register afterReload handler for post-mutation continuity
    if (typeof docmd !== 'undefined' && docmd.afterReload) {
      docmd.afterReload('threads', () => {
        this.loadThreads();
        this.injectNewThreadButton();
        this.updateFabBadge();
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
        editor.submitting = false;
      }
    });

    editor.addEventListener('inline-cancel', () => this.removeInlineEditor());

    heading.insertAdjacentElement('afterend', editor);
    this.inlineEditorEl = editor;
  }

  // ─── Selection popover ────────────────────────────────────────────

  private handleMouseUp = (e: MouseEvent): void => {
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
        editor.submitting = false;
      }
    });

    editor.addEventListener('inline-cancel', () => this.removeInlineEditor());

    blockEl.insertAdjacentElement('afterend', editor);
    this.inlineEditorEl = editor;
  }

  private wrapAnchorInMark(blockEl: HTMLElement, quote: string, threadId: string): void {
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const val = textNode.nodeValue || '';
      const idx = val.indexOf(quote);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + quote.length);
        const mark = document.createElement('mark');
        mark.className = 'threads-highlight';
        mark.dataset.threadId = threadId;
        try {
          range.surroundContents(mark);
        } catch {
          // Ignore if boundary cross
        }
        break;
      }
    }
  }

  // ─── Page lifecycle ───────────────────────────────────────────────

  private handlePageMounted = (_e: CustomEvent): void => {
    this.popoverActive = false;
    this.loadThreads();
    this.injectNewThreadButton();
  };

  private async loadThreads(): Promise<void> {
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
    this.scanRenderedHighlights();
    this.updateFabBadge();
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
   * Assigns cycling highlight colors, moves thread cards inline after the block
   * containing the highlight, and attaches click handlers.
   */
  private scanRenderedHighlights(): void {
    const marks = document.querySelectorAll<HTMLElement>('mark.threads-highlight[data-thread-id]');
    const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE']);
    let colorIndex = 0;

    for (const mark of marks) {
      const threadId = mark.dataset.threadId;
      if (!threadId) continue;

      // 1. Assign cycling highlight color
      const colorClass = ThreadsApp.HIGHLIGHT_COLORS[colorIndex % ThreadsApp.HIGHLIGHT_COLORS.length];
      mark.classList.add(colorClass);
      colorIndex++;

      const threadData = this.threads.find(t => t.id === threadId);

      // 2. In inline mode, ensure the thread card exists right after the block
      if (!this.sidebarEnabled) {
        let threadEl = document.querySelector<HTMLElement>(`.threads-thread[data-thread-id="${threadId}"]:not(.tc-panel .threads-thread)`);
        if (!threadEl && threadData) {
          threadEl = this.renderThreadCard(threadData, false);
        }

        if (threadEl) {
          threadEl.classList.add('threads-thread--inline');
          threadEl.classList.add(colorClass.replace('threads-hl-', 'threads-border-'));

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
        this.populateSidebarPanel();
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

    // 5. Hide any raw .threads-sidebar bottom element rendered by markdown-it
    const bottomSidebar = document.querySelector('.threads-sidebar');
    if (bottomSidebar instanceof HTMLElement) {
      bottomSidebar.style.display = 'none';
    }

    // 6. If sidebar mode or panel is open, populate the right sidebar panel
    if (this.sidebarEnabled || document.body.classList.contains('tc-panel-open')) {
      this.populateSidebarPanel();
    }
  }

  /**
   * Enhance thread cards: nest replies under parents, add per-comment reply & delete buttons,
   * and a "+ New Comment" footer button for top-level comments.
   */
  private injectReplyButtons(): void {
    const threads = document.querySelectorAll<HTMLElement>('.threads-thread[data-thread-id]');
    for (const threadEl of threads) {
      // Skip if already enhanced
      if (threadEl.querySelector('.threads-new-comment-btn')) continue;

      const threadId = threadEl.dataset.threadId;
      if (!threadId) continue;

      // Nest replies under their parent comments
      this.nestReplies(threadEl);

      // Add per-comment reply + delete buttons
      const allComments = threadEl.querySelectorAll<HTMLElement>('.threads-comment');
      const totalComments = allComments.length;
      for (const commentEl of allComments) {
        const commentId = commentEl.dataset.commentId;
        if (!commentId) continue;

        const meta = commentEl.querySelector('.threads-comment__meta');
        if (!meta) continue;

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

        // Skip if actions already added (re-render)
        if (commentEl.querySelector('.threads-comment__actions')) continue;

        // Actions container - pushed to the right via margin-left: auto
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

        // Delete button
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

        meta.appendChild(actions);
      }

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
        parentEl.appendChild(repliesContainer);
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
          const bodyEl = parentComment.querySelector('.threads-comment__body');
          if (bodyEl) {
            bodyEl.appendChild(editor);
          } else {
            parentComment.appendChild(editor);
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
    if (document.querySelector('.tc-sidebar-column')) return;

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
      this.populateSidebarPanel();
    });
    column.appendChild(toggle);

    // Panel (expanded state)
    const panel = document.createElement('div');
    panel.className = 'tc-panel';

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
  }

  /**
   * Populate the sidebar panel body with thread cards directly from this.threads data.
   */
  private populateSidebarPanel(): void {
    const panelBody = document.querySelector('.tc-panel__body');
    if (!panelBody) return;

    // Clear existing panel threads
    panelBody.textContent = '';

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
      for (const thread of this.threads) {
        panelBody.appendChild(this.renderThreadCard(thread, true));
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

    // Anchor quote badge for both sidebar and inline preview
    const mark = document.querySelector<HTMLElement>(`mark.threads-highlight[data-thread-id="${thread.id}"]`);
    const quoteText = mark?.textContent?.trim() || '';
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
          this.populateSidebarPanel();
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
        commentEl.appendChild(repliesContainer);
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
    footer.appendChild(resolveBtn);

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

    // Meta header
    const meta = document.createElement('div');
    meta.className = 'threads-comment__meta';

    const authorStrong = document.createElement('strong');
    authorStrong.textContent = authorInfo?.name || comment.author;
    meta.appendChild(authorStrong);

    const dot = document.createTextNode(' · ');
    meta.appendChild(dot);

    const dateSpan = document.createElement('span');
    dateSpan.textContent = comment.date;
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

    // Delete button
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

    meta.appendChild(actions);
    commentEl.appendChild(meta);

    // Body
    const body = document.createElement('div');
    body.className = 'threads-comment__body';
    const paragraphs = comment.body.split(/\n\n+/);
    for (const pText of paragraphs) {
      const p = document.createElement('p');
      p.textContent = pText;
      body.appendChild(p);
    }
    commentEl.appendChild(body);

    return commentEl;
  }

  // ─── Floating action button ──────────────────────────────────────

  private injectFab(): void {
    if (document.querySelector('.threads-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'threads-fab';
    fab.title = t('jumpToThreads');
    fab.appendChild(createSvgElement('messages-square', 18));

    const badge = document.createElement('span');
    badge.className = 'threads-fab__badge';
    badge.style.display = 'none';
    fab.appendChild(badge);

    fab.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('tc-panel-open');
      if (isOpen) {
        document.body.classList.remove('tc-panel-open');
      } else {
        this.closeAiDrawerIfOpen();
        document.body.classList.add('tc-panel-open');
        this.populateSidebarPanel();
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
    if (count > 0) {
      badge.textContent = String(count);
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