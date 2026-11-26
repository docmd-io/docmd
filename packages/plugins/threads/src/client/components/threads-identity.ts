import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { defineOnce } from './define';
import { t } from '../lib/i18n';
import {
  getAuthor, setAuthor,
  getEmail, setEmail,
  getGithub, setGithub,
  getAvatarUrl, setAvatarUrl,
  computeAvatarUrl,
  computeAuthorKey, getAuthorKey, setAuthorKey,
  getIdentityMode, setHeaderProfile,
  IDENTITY_NEEDED_EVENT, PROFILE_SAVED_EVENT,
} from '../lib/identity';
import { avatar, avatarStyles } from '../lib/avatar';
import { baseStyles, errorStyles } from './tokens';
import { fieldStyles } from './fields';
import './threads-button';
import { upsertAuthor, fetchAuthors, ThreadsClientError } from '../lib/api';
import { autoLinkAvailable, choiceFromLink, linkFromChoice, type LinkChoice } from '../lib/profile-link-setting';

/**
 * The person's avatar button in the page header and the profile panel it opens (name, GitHub user, e-mail
 * for the avatar). No public properties: it reads and writes through `lib/identity.ts`. The panel also
 * opens by itself when a write needs a name (the `threads-identity-needed` event on `document`).
 * Parts: `button`, `avatar`, `panel`, `field`, `input`, `link` (the Profile link radio group), `link-url`, `error`, `save`, `cancel`.
 */
export class ThreadsIdentity extends LitElement {
  static override styles = [baseStyles, errorStyles, avatarStyles, fieldStyles, css`
    :host { position: relative; display: flex; align-items: center; }
    /* The trigger is a threads-button (icon-only) whose base is drawn as a round avatar. */
    .button::part(base) {
      width: 32px;
      height: 32px;
      padding: 0;
      overflow: hidden;
      border: 2px solid var(--_border);
      border-radius: 50%;
    }
    .button::part(base):hover { border-color: var(--_accent); }
    .panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 1000;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 260px;
      padding: 14px;
      border: 1px solid var(--_border);
      border-radius: var(--_radius-lg);
      background: var(--_surface);
      color: var(--_fg);
      box-shadow: var(--_shadow-lg);
      font-size: var(--_font-size);
      line-height: var(--_line-height);
    }
    .preview { display: flex; justify-content: center; margin-bottom: 4px; }
    .preview .avatar { border: 2px solid var(--_border); }
    label { display: flex; flex-direction: column; gap: 4px; font-size: var(--_font-size-sm); font-weight: 500; }
    .hint { margin: 0; font-size: var(--_font-size-2xs); color: var(--_fg-muted); line-height: 1.4; }
    fieldset.link { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    fieldset.link legend { padding: 0; margin-bottom: 4px; font-size: var(--_font-size-sm); font-weight: 500; }
    fieldset.link label { flex-direction: row; align-items: center; gap: 6px; font-weight: 400; }
    .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 2px; }
  `];

  @state() private name = '';
  @state() private email = '';
  @state() private github = '';
  @state() private avatarUrl = '';
  @state() private panelOpen = false;
  @state() private error: string | null = null;
  @state() private linkChoice: LinkChoice = 'none';
  @state() private linkUrl = '';
  /**
   * The stored setting has been read into the radios. Until then they are disabled and none shows as chosen, so a
   * pick can never be overwritten by the load (a radio drawn checked before the load would swallow a click on it).
   */
  @state() private linkReady = false;
  /** The stored `link` has been read; until then, and until the person touches the setting, the save leaves it alone. */
  private linkTouched = false;

  private outsideClickHandler = (e: MouseEvent) => {
    if (!e.composedPath().includes(this)) {
      this.panelOpen = false;
    }
  };

  /** A write found no name: show the panel with the reason. */
  private identityNeededHandler = () => {
    if (!this.panelOpen) void this.loadLink();
    this.panelOpen = true;
    this.error = t('identityRequired');
  };

  override connectedCallback(): void {
    super.connectedCallback();
    const me = getIdentityMode();
    if (me.mode === 'header') {
      this.name = me.payload.author;
      this.avatarUrl = me.payload.avatarUrl;
      this.email = getEmail() || '';
    } else {
      this.name = getAuthor() || '';
      this.email = getEmail() || '';
      this.github = getGithub() || '';
      this.avatarUrl = getAvatarUrl() || '';

      // If we have identity info but no avatar yet, compute one
      if (!this.avatarUrl && (this.email || this.github)) {
        this.refreshAvatar();
      }
    }

    document.addEventListener('mousedown', this.outsideClickHandler);
    document.addEventListener(IDENTITY_NEEDED_EVENT, this.identityNeededHandler);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mousedown', this.outsideClickHandler);
    document.removeEventListener(IDENTITY_NEEDED_EVENT, this.identityNeededHandler);
  }

  private togglePanel(): void {
    this.panelOpen = !this.panelOpen;
    this.error = null;
    if (this.panelOpen) void this.loadLink();
  }

  /** Whether the site's profile URL pattern applies to this person: whenever the site sets one, in any mode. */
  private get autoAvailable(): boolean {
    return autoLinkAvailable((window.__threads_config as { profileUrl?: unknown } | undefined)?.profileUrl);
  }

  private myKey(): string | null {
    const me = getIdentityMode();
    return me.mode === 'header' ? me.payload.authorKey : getAuthorKey();
  }

  /** Show the stored setting: read this person's entry from authors.json. */
  private async loadLink(): Promise<void> {
    this.linkTouched = false;
    this.linkReady = false;
    const key = this.myKey();
    let link: string | false | undefined;
    if (key !== null) {
      const authors = await fetchAuthors();
      if (!this.panelOpen) return;
      link = Object.hasOwn(authors, key) ? authors[key]?.link : undefined;
    }
    this.linkChoice = choiceFromLink(link, this.autoAvailable);
    this.linkUrl = typeof link === 'string' ? link : '';
    this.linkReady = true;
  }

  private pickLink(choice: LinkChoice): void {
    this.linkTouched = true;
    this.linkChoice = choice;
    this.error = null;
  }

  /** The `link` to save: undefined when the setting was not touched. A bad custom URL stops the save. */
  private linkToSave(): { ok: true; value: string | false | null | undefined } | { ok: false } {
    if (!this.linkTouched) return { ok: true, value: undefined };
    return linkFromChoice(this.linkChoice, this.linkUrl, this.autoAvailable);
  }

  private async handleSave(): Promise<void> {
    const me = getIdentityMode();
    const nameInput = this.renderRoot.querySelector<HTMLInputElement>('#identity-name');
    const urlInput = this.renderRoot.querySelector<HTMLInputElement>('#identity-link-url');
    if (urlInput) this.linkUrl = urlInput.value;
    const link = this.linkToSave();
    if (!link.ok) {
      this.error = t('linkInvalid');
      return;
    }

    // A header identity owns its key: the name and avatar edit the profile only.
    if (me.mode === 'header') {
      const val = nameInput?.value.trim();
      if (val) this.name = val;
      // The email only picks the avatar; it never changes the key.
      const emailVal = this.renderRoot.querySelector<HTMLInputElement>('#identity-email')?.value.trim() ?? '';
      this.email = emailVal;
      setEmail(emailVal);
      if (emailVal) this.avatarUrl = await computeAvatarUrl(emailVal, '');
      try {
        await upsertAuthor(null, this.name, this.avatarUrl, link.value);
      } catch (err) {
        // The server is the authority on the profile: keep the panel open and say why (e.g. threads/forbidden).
        this.error = err instanceof ThreadsClientError ? err.text : (err instanceof Error ? err.message : String(err));
        return;
      }
      this.error = null;
      setHeaderProfile(this.name, this.avatarUrl);
      this.panelOpen = false;
      document.dispatchEvent(new CustomEvent(PROFILE_SAVED_EVENT));
      return;
    }

    const emailInput = this.renderRoot.querySelector<HTMLInputElement>('#identity-email');
    const githubInput = this.renderRoot.querySelector<HTMLInputElement>('#identity-github');

    if (nameInput) {
      const val = nameInput.value.trim();
      this.name = val;
      if (val) setAuthor(val);
    }

    if (emailInput) {
      const val = emailInput.value.trim();
      this.email = val;
      setEmail(val);
    }

    if (githubInput) {
      const val = githubInput.value.trim().replace(/^@/, '');
      this.github = val;
      setGithub(val);
    }

    await this.refreshAvatar();

    // Compute and save author key
    const authorKey = computeAuthorKey(this.name, this.github);
    setAuthorKey(authorKey);

    // Sync to server authors.json
    try {
      await upsertAuthor(authorKey, this.name, this.avatarUrl, link.value);
    } catch (err) {
      // The name is saved here already; say that the server did not take the profile.
      this.error = err instanceof ThreadsClientError ? err.text : (err instanceof Error ? err.message : String(err));
      return;
    }

    this.error = null;
    this.panelOpen = false;
    document.dispatchEvent(new CustomEvent(PROFILE_SAVED_EVENT));
  }

  private async refreshAvatar(): Promise<void> {
    const url = await computeAvatarUrl(this.email, this.github);
    this.avatarUrl = url;
    setAvatarUrl(url);
  }

  private handleCancel(): void {
    this.panelOpen = false;
    this.error = null;
  }

  private linkRadio(choice: LinkChoice, text: string) {
    return html`<label><input type="radio" name="link-choice" .checked=${this.linkReady && this.linkChoice === choice}
      @change=${() => this.pickLink(choice)} />${text}</label>`;
  }

  override render() {
    const header = getIdentityMode().mode === 'header';

    return html`
      <threads-button class="button" part="button" variant="ghost" label=${t('discussionIdentity')}
        .expanded=${this.panelOpen} @click=${this.togglePanel}>
        <span slot="prefix">${avatar({ src: this.avatarUrl, name: this.name, size: 28 })}</span>
      </threads-button>

      ${this.panelOpen ? html`
        <div class="panel" part="panel">
          <div class="preview">${avatar({ src: this.avatarUrl, name: this.name, size: 64 })}</div>
          <label>
            ${t('displayName')}
            <input id="identity-name" class="field" part="field input" type="text"
              .value=${this.name} placeholder=${t('yourName')} />
          </label>
          ${header ? nothing : html`
          <label>
            ${t('githubUsername')}
            <input id="identity-github" class="field" part="field input" type="text"
              .value=${this.github} placeholder="octocat" />
          </label>
          `}
          <label>
            ${t('gravatarEmail')}
            <input id="identity-email" class="field" part="field input" type="email"
              .value=${this.email} placeholder="you@example.com" />
          </label>
          <fieldset class="link" part="link" ?disabled=${!this.linkReady}>
            <legend>${t('profileLink')}</legend>
            ${this.autoAvailable ? this.linkRadio('auto', t('linkAutomatic')) : nothing}
            ${this.linkRadio('custom', t('linkCustom'))}
            ${this.linkChoice === 'custom' ? html`
              <input id="identity-link-url" class="field" part="field input link-url" type="url" inputmode="url"
                .value=${this.linkUrl} placeholder=${t('linkUrlPlaceholder')} aria-label=${t('linkCustom')}
                @input=${(e: Event) => { this.linkUrl = (e.target as HTMLInputElement).value; }} />
            ` : nothing}
            ${this.linkRadio('none', t('linkNone'))}
            <p class="hint">${t('linkHint')}</p>
          </fieldset>
          ${this.error ? html`<p class="error" part="error" data-testid="identity-error" role="alert">${this.error}</p>` : nothing}
          <p class="hint">${t('avatarHint')}</p>
          <div class="actions">
            <threads-button part="cancel" size="sm" @click=${this.handleCancel}>${t('cancel')}</threads-button>
            <threads-button part="save" size="sm" variant="primary" @click=${this.handleSave}>${t('save')}</threads-button>
          </div>
        </div>
      ` : nothing}
    `;
  }
}

defineOnce('threads-identity', ThreadsIdentity);
