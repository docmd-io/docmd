/**
 * The portable entry: the components that need no docmd (`threads-button`, `threads-editor`,
 * `threads-dialog`, `threads-reactions`, `threads-comment`). Importing it registers them, each guarded so that a second copy on the page
 * does not throw, and exports the classes and `setThreadsStrings` for translating them.
 *
 * It carries no stylesheet: every component falls back to light literals for its `--threads-*`
 * tokens. Load `@docmd/plugin-threads/threads.css` to theme them from docmd's variables, or set the
 * tokens yourself.
 */
export { ThreadsButton } from './components/threads-button';
export { ThreadsEditor } from './components/threads-editor';
export { ThreadsDialog } from './components/threads-dialog';
export type { DialogCloseReason } from './components/threads-dialog';
export { ThreadsReactions } from './components/threads-reactions';
export { ThreadsComment } from './components/threads-comment';
export type { ReactionOptions } from './components/threads-comment';
export type { ReactionView, ReactorView, Viewer, AuthorView } from './lib/reactions';
export { setThreadsStrings } from './lib/i18n';
export type { RequestDetail } from './lib/request';
