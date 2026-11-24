import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t } from '../lib/i18n';
import {
  getAuthor, setAuthor,
  getEmail, setEmail,
  getGithub, setGithub,
  getAvatarUrl, setAvatarUrl,
  computeAvatarUrl,
  computeAuthorKey, setAuthorKey,
  getIdentityMode, setHeaderProfile,
} from '../lib/identity';
import { upsertAuthor, ThreadsClientError } from '../lib/api';

@customElement('threads-identity')
export class ThreadsIdentity extends LitElement {
  override createRenderRoot() { return this; }

  @state() private name = '';
  @state() private email = '';
  @state() private github = '';
  @state() private avatarUrl = '';
  @state() private panelOpen = false;
  @state() private error: string | null = null;

  private outsideClickHandler = (e: MouseEvent) => {
    if (!this.contains(e.target as Node)) {
      this.panelOpen = false;
    }
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
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mousedown', this.outsideClickHandler);
  }

  private togglePanel(): void {
    this.panelOpen = !this.panelOpen;
    this.error = null;
  }

  private async handleSave(): Promise<void> {
    const me = getIdentityMode();
    const nameInput = this.querySelector<HTMLInputElement>('#identity-name');

    // A header identity owns its key: the name and avatar edit the profile only.
    if (me.mode === 'header') {
      const val = nameInput?.value.trim();
      if (val) this.name = val;
      // The email only picks the avatar; it never changes the key.
      const emailVal = this.querySelector<HTMLInputElement>('#identity-email')?.value.trim() ?? '';
      this.email = emailVal;
      setEmail(emailVal);
      if (emailVal) this.avatarUrl = await computeAvatarUrl(emailVal, '');
      try {
        await upsertAuthor(null, this.name, this.avatarUrl);
      } catch (err) {
        // The server is the authority on the profile: keep the panel open and say why (e.g. threads/forbidden).
        this.error = err instanceof ThreadsClientError ? err.text : (err instanceof Error ? err.message : String(err));
        return;
      }
      this.error = null;
      setHeaderProfile(this.name, this.avatarUrl);
      this.panelOpen = false;
      return;
    }

    const emailInput = this.querySelector<HTMLInputElement>('#identity-email');
    const githubInput = this.querySelector<HTMLInputElement>('#identity-github');

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
      await upsertAuthor(authorKey, this.name, this.avatarUrl);
    } catch {
      // Server may not be available (e.g. static site); ignore
    }

    this.panelOpen = false;
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

  override render() {
    const header = getIdentityMode().mode === 'header';
    const initial = this.name ? this.name.charAt(0).toUpperCase() : '?';

    return html`
      <button
        class="threads-identity-btn"
        title=${t('discussionIdentity')}
        @click=${this.togglePanel}
      >
        ${this.avatarUrl
          ? html`<img class="threads-identity-avatar" src=${this.avatarUrl} alt=${this.name} />`
          : html`<span class="threads-identity-initial">${initial}</span>`
        }
      </button>

      ${this.panelOpen ? html`
        <div class="threads-identity-panel">
          <div class="threads-identity-preview">
            ${this.avatarUrl
              ? html`<img class="threads-identity-preview-img" src=${this.avatarUrl} alt=${this.name} />`
              : html`<div class="threads-identity-preview-placeholder">${initial}</div>`
            }
          </div>
          <label class="threads-identity-label">
            ${t('displayName')}
            <input
              id="identity-name"
              class="threads-identity-input"
              type="text"
              .value=${this.name}
              placeholder=${t('yourName')}
            />
          </label>
          ${header ? nothing : html`
          <label class="threads-identity-label">
            ${t('githubUsername')}
            <input
              id="identity-github"
              class="threads-identity-input"
              type="text"
              .value=${this.github}
              placeholder="octocat"
            />
          </label>
          `}
          <label class="threads-identity-label">
            ${t('gravatarEmail')}
            <input
              id="identity-email"
              class="threads-identity-input"
              type="email"
              .value=${this.email}
              placeholder="you@example.com"
            />
          </label>
          ${this.error ? html`<p class="threads-identity-hint" data-testid="identity-error" role="alert">${this.error}</p>` : nothing}
          <p class="threads-identity-hint">${t('avatarHint')}</p>
          <div class="threads-identity-actions">
            <button class="threads-identity-cancel" @click=${this.handleCancel}>${t('cancel')}</button>
            <button class="threads-identity-save" @click=${this.handleSave}>${t('save')}</button>
          </div>
        </div>
      ` : ''}
    `;
  }
}