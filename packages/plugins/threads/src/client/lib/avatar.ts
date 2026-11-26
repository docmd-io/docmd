import { html, css, nothing, type TemplateResult } from 'lit';

export interface AvatarOptions {
  /** Image URL; when missing or when it fails to load, the initial shows instead. */
  src?: string | null;
  /** Display name: its first letter is the fallback. */
  name: string;
  /** Edge length in pixels (default 28). */
  size?: number;
}

/** The letter shown when there is no picture: the name's first letter, upper-cased, or "?". */
export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
}

function hideBrokenImage(e: Event): void {
  (e.target as HTMLElement).style.display = 'none';
}

/** The picture loaded: undo an earlier hide (the same `<img>` is reused when its `src` changes). */
function showLoadedImage(e: Event): void {
  (e.target as HTMLElement).style.display = '';
}

/**
 * A round avatar: the initial sits behind the picture and shows when the picture is missing or
 * fails to load (the `<img>` hides itself on `error` and shows again on a later `load`). A template function, not an element: it has
 * no state or events. Render it inside a component whose styles include `avatarStyles` and `tokens`.
 */
export function avatar({ src, name, size = 28 }: AvatarOptions): TemplateResult {
  return html`<span class="avatar" part="avatar" style="--_avatar-size:${size}px" aria-hidden="true"
    ><span class="avatar__initial">${avatarInitial(name)}</span
    >${src ? html`<img class="avatar__img" src=${src} alt="" @error=${hideBrokenImage} @load=${showLoadedImage} />` : nothing}</span
  >`;
}

export const avatarStyles = css`
  .avatar {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--_avatar-size, 28px);
    height: var(--_avatar-size, 28px);
    overflow: hidden;
    border-radius: 50%;
    background: var(--_surface-muted);
    color: var(--_fg-muted);
    font-size: calc(var(--_avatar-size, 28px) * 0.43);
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
  .avatar__img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;
