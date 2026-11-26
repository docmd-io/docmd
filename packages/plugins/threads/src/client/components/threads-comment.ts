import { LitElement, html, css, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { t } from '../lib/i18n';
import { avatar, avatarStyles } from '../lib/avatar';
import { getThreadSvg } from '../lib/icons';
import { dispatchRequest, type RequestDetail } from '../lib/request';
import { QUICK_REACTIONS, plainReactionViews, type AuthorView, type ReactionView, type Viewer } from '../lib/reactions';
import type { Comment } from '../../types';
import { baseStyles } from './tokens';
import { proseStyles } from './prose';
import { defineOnce } from './define';
import './threads-button';
import './threads-editor';
import './threads-reactions';

/** What the app passes through to every `threads-reactions`. */
export interface ReactionOptions {
  options: string[];
  restricted: boolean;
  pickerSrc: string;
  emojiDataSrc: string;
}

const DEFAULT_OPTIONS: string[] = [...QUICK_REACTIONS];

/** The reactions parts, re-exported with a `reactions-` prefix. */
const REACTION_PARTS = ['base', 'chip', 'chip-emoji', 'chip-count', 'who', 'options', 'option', 'react', 'add', 'picker', 'error']
  .map((p) => `${p}:reactions-${p}`)
  .join(', ');

/**
 * One comment row and its own action bar.
 *
 * Properties: `comment` (id, author, date, edited_at, body, reactions, draft, pendingEdit, parent_id),
 * `bodyHtml` (trusted HTML of the body: server output with raw HTML disabled; plain text of
 * `comment.body` when absent), `author` (`{ name, avatarUrl, href }`; `href` is the profile link or
 * null), `viewer` (`{ key, name }`), `reactions` (reaction views with profile links; the comment's own
 * reactions without links when absent), `reactionOptions` (`{ options, restricted, pickerSrc,
 * emojiDataSrc }`, passed to `threads-reactions`), `can-edit`, `can-delete`, `can-react`, `can-reply`
 * (booleans the app computes), `reply-to` (name shown as "replying to X"), `editing`.
 * Events: `threads-reply` `{ commentId }`; `threads-edit` `{ commentId, body, waitUntil }` (request: the
 * comment leaves edit mode when it resolves); `threads-delete` `{ commentId }`; `threads-react`
 * `{ commentId, emoji, waitUntil }` (re-emitted from its reactions bar).
 * Slot: `replies`. Parts: `base`, `avatar`, `meta`, `author`, `date`, `edited`, `draft`, `reply-to`,
 * `body`, `actions`, `reply`, `edit`, `delete`, `reactions` and the reactions parts as `reactions-*`.
 */
export class ThreadsComment extends LitElement {
  static override styles = [baseStyles, avatarStyles, proseStyles, css`
    :host { display: block; }
    .row { display: flex; gap: 10px; }
    .avatar-col { flex: none; padding-top: 2px; }
    .main { flex: 1; min-width: 0; }
    .meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin-bottom: 2px; font-size: var(--_font-size-xs); color: var(--_fg-muted); }
    .author { font-weight: 600; font-size: var(--_font-size-sm); color: var(--_fg-strong); }
    a.author { text-decoration: none; }
    a.author:hover { color: var(--_accent-strong); text-decoration: underline; text-underline-offset: 2px; }
    a.author:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; border-radius: 2px; }
    .draft { display: inline-flex; align-items: center; gap: 4px; color: var(--_draft); }
    .draft::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--_draft); }
    .reply-to { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; font-size: var(--_font-size-xs); color: var(--_fg-muted); }
    .body { font-size: var(--_font-size); line-height: var(--_line-height); overflow-wrap: anywhere; }
    .body.plain { white-space: pre-wrap; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
    .bar threads-reactions { flex: 1 1 auto; min-width: 0; }
    .actions { display: flex; gap: 2px; margin-left: auto; opacity: 0; transition: opacity 0.12s; }
    .row:hover .actions, .row:focus-within .actions { opacity: 1; }
    @media (hover: none) { .actions { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .actions { transition: none; } }
    ::slotted([slot='replies']) { display: block; margin-top: 10px; }
  `];

  @property({ attribute: false }) comment!: Comment;
  @property({ attribute: false }) bodyHtml = '';
  @property({ attribute: false }) author: AuthorView = { name: '', avatarUrl: '', href: null };
  @property({ attribute: false }) viewer: Viewer = { key: null, name: '' };
  @property({ attribute: false }) reactions: ReactionView[] | null = null;
  @property({ attribute: false }) reactionOptions: ReactionOptions | null = null;
  @property({ type: Boolean, attribute: 'can-edit' }) canEdit = false;
  @property({ type: Boolean, attribute: 'can-delete' }) canDelete = false;
  @property({ type: Boolean, attribute: 'can-react' }) canReact = false;
  @property({ type: Boolean, attribute: 'can-reply' }) canReply = false;
  @property({ attribute: 'reply-to' }) replyTo = '';
  @property({ type: Boolean, reflect: true }) editing = false;

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  /**
   * The reactions bar's request, passed on with the comment id. The original event stops here;
   * the promise it waits for is the one the app's listener returned.
   */
  private onReact(e: CustomEvent<{ emoji: string } & RequestDetail>): void {
    e.stopPropagation();
    const request = dispatchRequest(this, 'threads-react', { commentId: this.comment.id, emoji: e.detail.emoji });
    if (request) e.detail.waitUntil(request);
  }

  /** The editor's submit becomes `threads-edit`; the comment leaves edit mode when the write succeeds. */
  private onEditSubmit(e: CustomEvent<{ body: string } & RequestDetail>): void {
    e.stopPropagation();
    const request = dispatchRequest(this, 'threads-edit', { commentId: this.comment.id, body: e.detail.body });
    if (request) e.detail.waitUntil(request.then(() => { this.editing = false; }));
  }

  private onEditCancel(e: Event): void {
    e.stopPropagation();
    this.editing = false;
  }

  private renderBody() {
    if (this.editing) {
      return html`<threads-editor
        value=${this.comment.body}
        label=${t('editComment')}
        submit-label=${t('save')}
        @threads-submit=${this.onEditSubmit}
        @threads-cancel=${this.onEditCancel}
      ></threads-editor>`;
    }
    return this.bodyHtml
      ? html`<div class="body prose" part="body">${unsafeHTML(this.bodyHtml)}</div>`
      : html`<div class="body plain" part="body">${this.comment.body}</div>`;
  }

  private renderActions() {
    if (this.editing) return nothing;
    const { id } = this.comment;
    return html`
      <div class="actions" part="actions">
        ${this.canReply ? html`<threads-button part="reply" variant="ghost" size="sm" icon="reply"
          label=${t('replyToComment')} @click=${() => this.emit('threads-reply', { commentId: id })}>${t('reply')}</threads-button>` : nothing}
        ${this.canEdit ? html`<threads-button part="edit" variant="ghost" size="sm" icon="pencil" label=${t('editComment')}
          @click=${() => { this.editing = true; }}></threads-button>` : nothing}
        ${this.canDelete ? html`<threads-button part="delete" variant="ghost" danger size="sm" icon="trash" label=${t('deleteComment')}
          @click=${() => this.emit('threads-delete', { commentId: id })}></threads-button>` : nothing}
      </div>
    `;
  }

  override render() {
    const c = this.comment;
    if (!c) return nothing;
    const { name, avatarUrl, href } = this.author;
    const shownName = name || c.author;
    const reactions = this.reactions ?? plainReactionViews(c.reactions ?? []);
    const opts = this.reactionOptions;
    return html`
      <div class="base" part="base">
        <div class="row">
          <div class="avatar-col">${avatar({ src: avatarUrl, name: shownName })}</div>
          <div class="main">
            <div class="meta" part="meta">
              ${href
                ? html`<a class="author" part="author" href=${href} rel="nofollow noopener ugc">${shownName}</a>`
                : html`<span class="author" part="author">${shownName}</span>`}
              <time part="date" datetime=${c.date}>${c.date}</time>
              ${c.edited_at ? html`<span part="edited" title=${c.edited_at}>${t('edited')}</span>` : nothing}
              ${c.draft || c.pendingEdit ? html`<span class="draft" part="draft">${t('unpublished')}</span>` : nothing}
            </div>
            ${this.replyTo ? html`<div class="reply-to" part="reply-to"><span aria-hidden="true">${unsafeHTML(getThreadSvg('corner-down-right', 12))}</span>${t('replyingTo').replace('{name}', this.replyTo)}</div>` : nothing}
            ${this.renderBody()}
            <div class="bar">
              <threads-reactions
                part="reactions"
                exportparts=${REACTION_PARTS}
                .reactions=${reactions}
                .viewer=${this.viewer}
                .options=${opts?.options ?? DEFAULT_OPTIONS}
                .restricted=${opts?.restricted ?? false}
                picker-src=${opts?.pickerSrc ?? ''}
                emoji-data-src=${opts?.emojiDataSrc ?? ''}
                ?disabled=${!this.canReact}
                @threads-react=${this.onReact}
              ></threads-reactions>
              ${this.renderActions()}
            </div>
          </div>
        </div>
        <slot name="replies"></slot>
      </div>
    `;
  }
}

defineOnce('threads-comment', ThreadsComment);

declare global {
  interface HTMLElementTagNameMap {
    'threads-comment': ThreadsComment;
  }
}
