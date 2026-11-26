# @docmd/plugin-threads

Adds inline discussion threads to your docmd site - stored directly in Markdown as `::: threads` containers, so comments live in your repo and sync with your Git and PR workflows. Supports text highlighting, replies, thread resolution, and emoji reactions. An optional plugin, installed separately.

```bash
docmd add threads
```

Original author: [@svallory](https://github.com/svallory)

Part of the **[docmd](https://github.com/docmd-io/docmd)** documentation engine.

## Documentation

See **[docs.docmd.io](https://docs.docmd.io)** for full usage and API reference. The sections below cover what is specific to this package.

## Options

Set under `plugins.threads` in your docmd config. Only the options added or changed in this version are listed here.

### `reactions`

Which emoji people can react with.

```js
plugins: {
  threads: {
    reactions: {
      emoji: ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'], // default: GitHub's eight
      restricted: false,                                      // default
    },
  },
}
```

- `emoji`: 1 to 20 distinct single emoji, shown in the quick row of every comment.
- `restricted: false` (default): a **+** button after the reactions opens a full emoji picker, so people can react with any emoji. The picker and its data are loaded on the first click, and served with your site (no CDN).
- `restricted: true`: only the listed emoji are offered, there is no **+** button, and the server refuses any other emoji.

Clicking an emoji that is already on a comment toggles your own reaction.

```js
// Only these three, nothing else
reactions: { emoji: ['👍', '❤️', '🎉'], restricted: true }
```

### `profileUrl`

Turns a person's name into a link to their profile, wherever the name is shown (comment author, reactor, review author).

```js
profileUrl: 'https://github.com/{id}'
```

An absolute `http:` or `https:` URL that contains `{id}`. `{id}` is replaced by the person's identity key, URL-encoded. The default is `null`: no automatic links.

- Set it only when identity keys come from your identity provider (for example GitHub user names behind a trusted-header proxy). Under `docmd dev` the browser picks the key, so an automatic link would point at whatever was typed.
- Links are worked out when the page renders, from `authors.json` and this pattern. The Markdown never stores a link. "Resolved by X" is a name only and is never linked.
- Every link is rendered with `rel="nofollow noopener ugc"`.

### The Profile link setting

Each person can choose, in their profile panel, where their own name links to:

| Choice | What it does |
|---|---|
| Automatic | Uses `profileUrl`. Shown only when the site sets `profileUrl` and the identity comes from the server. |
| Custom link | Their own `http:` or `https:` URL (at most 2048 characters). |
| No link | Their name is never a link. |

The choice is saved in `authors.json` as `link` (absent = automatic, a string = custom link, `false` = no link) and applies everywhere their name appears. A custom link is the person's own claim and is **not verified**.

## Reactions in the Markdown

Each reactor is stored with a display name and the identity key:

```md
::: reactions
- 👍 Alice Smith {alice}, Bob {8812031}
- 🎉 Alice Smith {alice}
:::
```

`\`, `,`, `{` and `}` inside a name or key are escaped with a backslash. The UI always shows names. Older lines that carry names only (`- 👍 Alice, Bob`) are still read; those reactors have no key, so their names are not linked.

## Theming

Everything is themed through `--threads-*` CSS custom properties. The plugin's stylesheet maps them from docmd's template and theme variables, in light and dark, so threads follow your theme with no setup. Override any of them on `:root`, `body`, `threads-app` or any ancestor:

```css
:root {
  --threads-accent: #7c3aed;
  --threads-radius: 2px;
  --threads-panel-width: 420px;
}
```

Tokens: `--threads-surface`, `-surface-raised`, `-surface-muted`, `-fg`, `-fg-strong`, `-fg-muted`, `-border`, `-border-strong`, `-accent`, `-accent-strong`, `-accent-soft`, `-on-accent`, `-danger`, `-danger-soft`, `-draft`, `-focus`, the highlight palette `-hl-<colour>` and `-hl-<colour>-strong` (yellow, blue, green, pink, purple, orange, neutral), `-font`, `-font-mono`, `-font-size`, `-font-size-sm`, `-line-height`, `-radius`, `-radius-lg`, `-shadow`, `-shadow-lg`, `-control-height`, `-control-height-sm`, `-panel-width`, `-z-panel` and `-z-fab`.

The components render in shadow DOM and expose `::part()` hooks, for example:

```css
threads-comment::part(author) { font-weight: 700; }
threads-button::part(base) { text-transform: uppercase; }
```

Parts per component:

| Element | Parts |
|---|---|
| `threads-button` | `base`, `icon`, `label`, `spinner` |
| `threads-dialog` | `dialog`, `heading`, `body`, `footer`, `cancel`, `confirm`, `error` |
| `threads-editor` | `base`, `quote`, `textarea`, `hint`, `error`, `actions`, `cancel`, `submit` |
| `threads-reactions` | `base`, `chip`, `chip-emoji`, `chip-count`, `who`, `options`, `option`, `react`, `add`, `picker`, `error` |
| `threads-comment` | `base`, `avatar`, `meta`, `author`, `date`, `edited`, `draft`, `reply-to`, `body`, `actions`, `reply`, `edit`, `delete`, `reactions`, and the reactions parts as `reactions-*` |
| `threads-thread` | `card`, `quote`, `quote-text`, `open-panel`, `comments`, `replies`, `footer`, `summary`, `new-comment`, `editor`, `resolve`, `collapse`, `draft`, `status`, `error`, and the comment parts as `comment-*` |
| `threads-panel` | `launcher`, `launcher-badge`, `unpublished-marker`, `column`, `panel`, `header`, `title`, `count`, `new`, `close`, `tabs`, `tab`, `body`, `empty`, `orphans`, `footer` |
| `threads-identity` | `button`, `avatar`, `panel`, `field`, `input`, `link`, `link-url`, `error`, `save`, `cancel` |

## Using the components without docmd

The portable components (`threads-button`, `threads-dialog`, `threads-editor`, `threads-reactions`, `threads-comment`) are standard custom elements. Import them from the `./components` export:

```js
import '@docmd/plugin-threads/components';
import '@docmd/plugin-threads/threads.css'; // optional: maps the tokens from your theme
```

Without the stylesheet each component falls back to built-in light values, or you can set the `--threads-*` tokens yourself. Each tag is registered with a guard, so loading two copies on one page does not throw. `setThreadsStrings({...})` translates the UI text.

- **Data goes in as properties** (`comment`, `bodyHtml`, `reactions`, `viewer`, `options`), simple flags also exist as attributes.
- **Actions come out as events** named `threads-*`: `threads-submit`, `threads-cancel`, `threads-react`, `threads-reply`, `threads-edit`, `threads-delete`, `threads-confirm`, `threads-close`. Events that start a request carry `detail.waitUntil(promise)`: the component shows its busy state until the promise settles and shows the error when it rejects.
- **`bodyHtml` is trusted.** `threads-comment` renders it as HTML without sanitising. In docmd it is the build's own output with raw HTML disabled. If you pass your own `bodyHtml`, sanitise it first (for example with DOMPurify).

### Framework recipes

- **React 19 and newer**: works directly. Set properties as props and listen with `onthreads-react`-style props.
- **React 18 and older**: React sets everything as attributes and cannot listen to custom events. Wrap each element with `@lit/react`:

  ```jsx
  import React from 'react';
  import { createComponent } from '@lit/react';
  import { ThreadsReactions } from '@docmd/plugin-threads/components';

  export const Reactions = createComponent({
    tagName: 'threads-reactions',
    elementClass: ThreadsReactions,
    react: React,
    events: { onReact: 'threads-react' },
  });
  ```

  This package does not ship wrappers.
- **Vue 3**: add `compilerOptions.isCustomElement: (tag) => tag.startsWith('threads-')`, bind objects with `.prop` (`:comment.prop="c"`) and listen with `@threads-react`.
- **Svelte**: works directly; Svelte sets properties when the element has them.
- **Angular**: add `CUSTOM_ELEMENTS_SCHEMA`, bind with `[comment]` and listen with `(threads-react)`.
- **Server rendering**: the tags render empty on the server and fill in on the client.

### Browser support

Chrome and Edge 114, Safari 17, Firefox 125. The floor is set by the `popover` attribute.

## Limits

- Draft comments (not yet published) are previewed with a basic Markdown renderer. Syntax added by other docmd plugins is not rendered in a draft; it appears once the comment is published and the page is rebuilt.
- The build-time HTML of published comments is the view without JavaScript. Names there are linked from `authors.json` and `profileUrl` as of the last build of the page.

## Changes in this version

Breaking:

- `threads-thread`, `threads-comment` and `threads-panel` are tag names that existed before and are reused with new APIs (properties and `threads-*` events). Code that created or called the old elements must be updated.
- `threads-popover` is removed.
- The `--tc-*` CSS variables are removed. Use the `--threads-*` tokens.
- Shoelace is no longer used; the UI no longer loads it.
- `Reaction.authors` (a list of names) is replaced by `Reaction.reactors` (`{ key, name }` entries). Code that reads reactions from the actions API must read `reactors`.
- Reactions are stored as `name {key}`. Old name-only lines are still read.

New:

- `plugins.threads.reactions` and `plugins.threads.profileUrl` options, the any-emoji picker, and the Profile link setting.
- The `./components` export for using the components outside docmd.

## Credits

The emoji picker is adapted from [emoji-picker-element](https://github.com/nolanlawson/emoji-picker-element) by Nolan Lawson (Apache-2.0). The emoji data is from [emoji-picker-element-data](https://github.com/nolanlawson/emoji-picker-element-data) (Apache-2.0). The vendored picker keeps its licence and a note of what was changed, in `src/client/vendor/emoji-picker/`; the licence texts also ship in the published package next to the emoji data.

## License

MIT. The vendored emoji picker and the emoji data are Apache-2.0.
