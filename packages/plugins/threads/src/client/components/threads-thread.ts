import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { AuthorsMap, Comment, Thread } from '../../types';
import { t } from '../lib/i18n';
import { getThreadSvg } from '../lib/icons';
import { dispatchRequest, requestErrorMessage, type RequestDetail } from '../lib/request';
import { toAuthorView, toReactionViews, type Viewer } from '../lib/reactions';
import type { ShowAction, ShowTarget } from '../lib/can-show';
import {
  buildCommentTree, canDeleteComment, canEditComment, chooseBodyHtml, summaryText, type CardColor, type TreeNode,
} from '../lib/thread-view';
import { baseStyles, errorStyles } from './tokens';
import { defineOnce } from './define';
import './threads-button';
import './threads-comment';
import './threads-editor';
import type { ReactionOptions } from './threads-comment';

/** The comment parts, re-exported with a `comment-` prefix. */
const COMMENT_PARTS = ['base', 'avatar', 'meta', 'author', 'date', 'edited', 'draft', 'reply-to', 'body', 'actions', 'reply', 'edit', 'delete', 'reactions']
  .map((p) => `${p}:comment-${p}`)
  .join(', ');

/** How long a flashed card keeps its highlight before the attribute clears. */
const FLASH_MS = 2000;

/**
 * One thread card. The same element is used inline (after the highlighted block) and in the panel.
 *
 * Properties: `thread` (a `Thread` with comments), `bodies` (`Map<commentId, html>`: the HTML the build
 * rendered for each published comment; drafts and pending edits use their own `bodyHtml`), `authors`,
 * `viewer` (`{ key, name }`), `profileUrl` (pattern for profile links, or null), `reactionOptions`
 * (`{ options, restricted, pickerSrc, emojiDataSrc }`), `canShow(action, target)` (the permission mirror;
 * allows everything by default), `canReact` and `canReply` (both default to true; the app turns them off with no identity or no live server), `localMode` (the viewer is a local, unverified identity: Edit shows on
 * their own comments only), `variant` (`inline` | `panel`), `color` (a highlight name or `neutral`),
 * `quote` (text of the mark, or the stored quote of an orphan), `collapsed`, `flash` (clears itself).
 * Reflected: `data-thread-id`, `resolved`, `draft`, `orphaned`, `variant`, `color`, `collapsed`, `flash`.
 * Events: `threads-resolve` `{ threadId, resolved, waitUntil }`; `threads-comment-submit` `{ threadId,
 * parentId, body, waitUntil }`; `threads-collapse-change` `{ threadId, collapsed }`; `threads-reveal-quote`
 * `{ threadId }` (panel); `threads-open-panel` `{ threadId }` (inline); and the comment events
 * (`threads-edit`, `threads-delete`, `threads-react`) bubbling through with `threadId` added.
 * Parts: `card`, `quote`, `quote-text`, `open-panel`, `comments`, `replies`, `footer`, `summary`,
 * `new-comment`, `editor`, `resolve`, `collapse`, `draft`, `status`, `error`, and the comment parts as `comment-*`.
 */
export class ThreadsThread extends LitElement {
  static override styles = [baseStyles, errorStyles, css`
    :host { display: block; }
    :host([variant='inline']) { max-width: 680px; margin: 16px 0 20px; }
    :host([variant='panel']) { margin: 0 0 12px; }

    .card {
      box-sizing: border-box;
      border: 1px solid var(--_border);
      border-left: 3px solid var(--_hl-neutral-strong);
      border-radius: var(--_radius-lg);
      background: var(--_surface);
      box-shadow: var(--_shadow);
      overflow: hidden;
    }
    :host([color='yellow']) .card { border-left-color: var(--_hl-yellow-strong); }
    :host([color='blue']) .card { border-left-color: var(--_hl-blue-strong); }
    :host([color='green']) .card { border-left-color: var(--_hl-green-strong); }
    :host([color='pink']) .card { border-left-color: var(--_hl-pink-strong); }
    :host([color='purple']) .card { border-left-color: var(--_hl-purple-strong); }
    :host([color='orange']) .card { border-left-color: var(--_hl-orange-strong); }

    /* Resolved: the colour fades and the card sinks to the muted surface; text keeps full contrast. */
    :host([resolved]) .card { background: var(--_surface-muted); }
    :host([resolved][color='yellow']) .card { border-left-color: color-mix(in oklab, var(--_hl-yellow-strong) 50%, transparent); }
    :host([resolved][color='blue']) .card { border-left-color: color-mix(in oklab, var(--_hl-blue-strong) 50%, transparent); }
    :host([resolved][color='green']) .card { border-left-color: color-mix(in oklab, var(--_hl-green-strong) 50%, transparent); }
    :host([resolved][color='pink']) .card { border-left-color: color-mix(in oklab, var(--_hl-pink-strong) 50%, transparent); }
    :host([resolved][color='purple']) .card { border-left-color: color-mix(in oklab, var(--_hl-purple-strong) 50%, transparent); }
    :host([resolved][color='orange']) .card { border-left-color: color-mix(in oklab, var(--_hl-orange-strong) 50%, transparent); }

    /* Orphans lost their mark: a dashed edge says so. */
    :host([orphaned]) .card { border-style: dashed; border-color: var(--_border-strong); }

    :host([flash]) .card { animation: flash ${FLASH_MS}ms ease-out; }
    @keyframes flash {
      0% { outline: 2px solid var(--_accent); outline-offset: 4px; }
      100% { outline: 2px solid transparent; outline-offset: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      :host([flash]) .card { animation: none; outline: 2px solid var(--_accent); outline-offset: 2px; }
    }

    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      padding: 7px 12px;
      border-bottom: 1px solid var(--_border);
      background: var(--_surface-muted);
      font-size: var(--_font-size-xs);
      color: var(--_fg-muted);
    }
    .quote {
      display: flex;
      flex: 1 1 140px;
      min-width: 0;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: start;
    }
    /* The panel's quote is a button: it jumps to the highlight. Same base as every other button, left-aligned. */
    threads-button.quote-button { display: block; flex: 1 1 140px; min-width: 0; }
    threads-button.quote-button::part(base) { width: 100%; justify-content: flex-start; font-size: var(--_font-size-xs); padding: 0 6px; }
    .quote-icon { display: inline-flex; flex: none; }
    .quote-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: italic; }
    .status { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
    .draft { display: inline-flex; align-items: center; gap: 4px; color: var(--_draft); }
    .draft::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--_draft); }
    .resolved-label { font-weight: 600; color: var(--_fg-muted); }

    .comments { padding: 12px; display: flex; flex-direction: column; gap: 14px; }
    .comments[hidden] { display: none; }
    .replies { margin-left: 14px; padding-left: 14px; border-left: 2px solid var(--_border); display: flex; flex-direction: column; gap: 12px; }

    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 6px;
      padding: 6px 12px 8px;
      border-top: 1px solid var(--_border);
    }
    .summary { flex: 1 1 100%; font-size: var(--_font-size-xs); color: var(--_fg-muted); }
    .summary[hidden] { display: none; }
    .grow { margin-left: auto; }
    .error { flex: 1 1 100%; }
  `];

  @property({ attribute: false }) thread!: Thread;
  @property({ attribute: false }) bodies: ReadonlyMap<string, string> = new Map();
  @property({ attribute: false }) authors: AuthorsMap = {};
  @property({ attribute: false }) viewer: Viewer = { key: null, name: '' };
  @property({ attribute: false }) profileUrl: string | null = null;
  @property({ attribute: false }) reactionOptions: ReactionOptions | null = null;
  @property({ attribute: false }) canShow: (action: ShowAction, target: ShowTarget) => boolean = () => true;
  /** Whether the viewer may react and reply: the app turns both off with no identity or no live server. */
  @property({ type: Boolean, attribute: 'can-react' }) canReact = true;
  @property({ type: Boolean, attribute: 'can-reply' }) canReply = true;
  @property({ type: Boolean, attribute: 'local-mode' }) localMode = false;
  @property({ reflect: true }) variant: 'inline' | 'panel' = 'inline';
  @property({ reflect: true }) color: CardColor = 'neutral';
  @property() quote = '';
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ type: Boolean, reflect: true }) flash = false;

  /** What the card's one editor is for: a new comment in the footer, a reply to this comment id, or nothing. */
  @state() private composing: null | 'new' | string = null;
  @state() private resolving = false;
  @state() private error = '';

  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.flashTimer);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('thread') && this.thread) {
      this.dataset.threadId = this.thread.id;
      this.toggleAttribute('resolved', !!this.thread.resolved);
      this.toggleAttribute('draft', this.isDraft);
      this.toggleAttribute('orphaned', !!this.thread.orphaned);
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has('flash')) {
      clearTimeout(this.flashTimer);
      if (this.flash) this.flashTimer = setTimeout(() => { this.flash = false; }, FLASH_MS);
    }
  }

  /** A thread whose first comment is unpublished. */
  private get isDraft(): boolean {
    return !!this.thread?.draft || !!this.thread?.comments[0]?.draft;
  }

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  /** Comment events pass through the card on their way to the app: say which thread they belong to. */
  private tagThread(e: Event): void {
    (e as CustomEvent<{ threadId?: string }>).detail.threadId = this.thread.id;
  }

  private onReply(e: CustomEvent<{ commentId: string }>): void {
    e.stopPropagation();
    this.composing = e.detail.commentId;
    this.collapsed = false;
  }

  private onSubmit(e: CustomEvent<{ body: string } & RequestDetail>): void {
    e.stopPropagation();
    const parentId = this.composing === 'new' ? null : this.composing;
    const request = dispatchRequest(this, 'threads-comment-submit', { threadId: this.thread.id, parentId, body: e.detail.body });
    if (request) e.detail.waitUntil(request.then(() => { this.composing = null; }));
  }

  private onCancelEditor(e: Event): void {
    e.stopPropagation();
    this.composing = null;
  }

  private async onResolve(): Promise<void> {
    if (this.resolving) return;
    this.error = '';
    const request = dispatchRequest(this, 'threads-resolve', { threadId: this.thread.id, resolved: !this.thread.resolved });
    if (!request) return;
    this.resolving = true;
    try {
      await request;
    } catch (err) {
      this.error = requestErrorMessage(err);
    } finally {
      this.resolving = false;
    }
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.emit('threads-collapse-change', { threadId: this.thread.id, collapsed: this.collapsed });
  }

  private nameOf(comment: Comment): string {
    return toAuthorView(comment, this.authors, this.profileUrl).name;
  }

  private renderEditor() {
    return html`<threads-editor
      class="editor"
      part="editor"
      label=${t('writeComment')}
      placeholder=${t('writeComment')}
      @threads-submit=${this.onSubmit}
      @threads-cancel=${this.onCancelEditor}
    ></threads-editor>`;
  }

  /** One comment row; `replies` fills its replies slot. */
  private renderComment(comment: Comment, replyTo: Comment | null, replies: unknown = nothing) {
    return html`<threads-comment
      .comment=${comment}
      .bodyHtml=${chooseBodyHtml(comment, this.bodies.get(comment.id))}
      .author=${toAuthorView(comment, this.authors, this.profileUrl)}
      .viewer=${this.viewer}
      .reactions=${toReactionViews(comment.reactions ?? [], this.authors, this.profileUrl)}
      .reactionOptions=${this.reactionOptions}
      .canEdit=${canEditComment(this.canShow, comment, this.viewer.name, this.localMode)}
      .canDelete=${canDeleteComment(this.canShow, this.thread, comment.id)}
      .canReact=${this.canReact}
      .canReply=${this.canReply}
      variant=${this.variant}
      reply-to=${replyTo ? this.nameOf(replyTo) : ''}
      data-comment-id=${comment.id}
      exportparts=${COMMENT_PARTS}
    >${replies}</threads-comment>`;
  }

  /** A top-level comment with all its descendants flat under it, and the editor where a reply is being written. */
  private renderNode(node: TreeNode) {
    const top = node.comment;
    const replying = this.composing === top.id || node.replies.some((r) => r.comment.id === this.composing);
    const replies = node.replies.length > 0 || replying ? html`
      <div slot="replies" class="replies" part="replies">
        ${this.composing === top.id ? this.renderEditor() : nothing}
        ${repeat(node.replies, (r) => r.comment.id, (r) => html`${this.renderComment(r.comment, r.replyTo)}${this.composing === r.comment.id ? this.renderEditor() : nothing}`)}
      </div>` : nothing;
    return this.renderComment(top, null, replies);
  }

  private renderHeader() {
    const quote = this.quote;
    const resolved = !!this.thread.resolved;
    if (!quote && !this.isDraft && !resolved) return nothing;
    const icon = html`<span class="quote-icon" aria-hidden="true">${unsafeHTML(getThreadSvg('quote', 12))}</span>`;
    const text = html`<span class="quote-text" part="quote-text">"${quote}"</span>`;
    let quoteEl;
    if (!quote) quoteEl = nothing;
    else if (this.variant === 'panel' && !this.thread.orphaned) {
      quoteEl = html`<threads-button class="quote-button" part="quote" variant="ghost" size="sm" icon="quote" label=${t('jumpToHighlight')}
        @click=${() => this.emit('threads-reveal-quote', { threadId: this.thread.id })}>${text}</threads-button>`;
    } else {
      quoteEl = html`<div class="quote" part="quote">${icon}${text}</div>`;
    }
    return html`
      <div class="header">
        ${quoteEl}
        ${quote && this.variant === 'inline' && !this.thread.orphaned ? html`
          <threads-button part="open-panel" size="sm" variant="ghost" icon="external-link" label=${t('openInSidebar')}
            @click=${() => this.emit('threads-open-panel', { threadId: this.thread.id })}>${t('sidebar')}</threads-button>` : nothing}
        <span class="status" part="status">
          ${this.isDraft ? html`<span class="draft" part="draft">${t('unpublished')}</span>` : nothing}
          ${resolved ? html`<span class="resolved-label">${t('resolved')}</span>` : nothing}
        </span>
      </div>`;
  }

  override render() {
    const thread = this.thread;
    if (!thread) return nothing;
    const tree = buildCommentTree(thread.comments);
    const resolved = !!thread.resolved;
    const mayResolve = this.canShow('resolve-thread', { threadAuthor: thread.comments[0]?.authorKey, drafted: !!thread.draft });
    const summary = summaryText(thread.comments.length, thread.comments.map((c) => this.nameOf(c)));
    return html`
      <div class="card" part="card"
        @threads-reply=${this.onReply}
        @threads-edit=${this.tagThread}
        @threads-delete=${this.tagThread}
        @threads-react=${this.tagThread}
      >
        ${this.renderHeader()}
        <div class="comments" part="comments" ?hidden=${this.collapsed}>
          ${repeat(tree, (n) => n.comment.id, (n) => this.renderNode(n))}
          ${this.composing === 'new' ? this.renderEditor() : nothing}
        </div>
        <div class="footer" part="footer">
          <div class="summary" part="summary" ?hidden=${!this.collapsed}>${summary}</div>
          ${this.collapsed ? nothing : html`
            <threads-button part="new-comment" size="sm" variant="ghost" icon="plus"
              @click=${() => { this.composing = 'new'; }}>${t('newComment')}</threads-button>`}
          ${mayResolve ? html`
            <threads-button class="grow" part="resolve" size="sm" variant="ghost" icon=${resolved ? 'x' : 'check'}
              ?busy=${this.resolving} @click=${() => void this.onResolve()}>${resolved ? t('unresolve') : t('resolve')}</threads-button>` : nothing}
          <threads-button class=${mayResolve ? '' : 'grow'} part="collapse" size="sm" variant="ghost"
            icon=${this.collapsed ? 'chevron-down' : 'chevron-up'}
            label=${this.collapsed ? t('expandThread') : t('collapseThread')}
            .expanded=${!this.collapsed}
            @click=${() => this.toggleCollapsed()}></threads-button>
          ${this.error ? html`<p class="error" part="error" role="alert">${this.error}</p>` : nothing}
        </div>
      </div>
    `;
  }
}

defineOnce('threads-thread', ThreadsThread);

declare global {
  interface HTMLElementTagNameMap {
    'threads-thread': ThreadsThread;
  }
}
