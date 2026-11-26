/**
 * Client-side i18n helper for the threads plugin.
 * Reads translations from window.__threads_i18n injected by the server plugin.
 * Falls back to English defaults if a key is missing.
 */

const defaults: Record<string, string> = {
  threads: 'Threads',
  newThread: 'New Thread',
  newComment: 'New Comment',
  startThread: 'Start a new discussion thread',
  addGeneralComment: 'Add general comment',
  collapseSidebar: 'Collapse sidebar',
  openThreadsPanel: 'Open threads panel',
  closePanel: 'Close panel',
  jumpToThreads: 'Jump to threads',
  all: 'All',
  open: 'Open',
  resolved: 'Resolved',
  noThreads: 'No threads on this page yet.',
  selectTextToStart: 'Select text to start one.',
  writeComment: 'Write your comment...',
  addComment: 'Add a comment...',
  cmdEnterSubmit: 'Cmd+Enter to submit',
  cancel: 'Cancel',
  submit: 'Submit',
  saving: 'Saving...',
  comment: 'Comment',
  reply: 'Reply',
  replyToComment: 'Reply to this comment',
  deleteComment: 'Delete comment',
  collapseThread: 'Collapse thread',
  expandThread: 'Expand thread',
  confirmDelete: 'Confirm Delete',
  confirmDeleteMessage: 'Are you sure you want to delete this',
  delete: 'Delete',
  discussionIdentity: 'Discussion identity',
  displayName: 'Display Name',
  yourName: 'Your name',
  githubUsername: 'GitHub Username',
  gravatarEmail: 'Gravatar Email',
  save: 'Save',
  avatarHint: 'Avatar: Gravatar > GitHub > random. Stored in your browser only.',
  openCount: 'open',
  commentCount: 'comment',
  commentsCount: 'comments',
  by: 'by',
  and: 'and',
  more: 'more',
  publish: 'Publish',
  autoPublishing: 'Auto-publishing',
  pause: 'Pause auto-publishing',
  play: 'Resume auto-publishing',
  unpublishedCount: '{n} unpublished comments',
  unpublishedCountOne: '{n} unpublished comment',
  publishFailed: 'Publish failed',
  skippedOps: '{n} changes could not be applied',
  skippedOpsOne: '{n} change could not be applied',
  modeFailed: 'Could not change publishing mode',
  loadFailed: 'Could not load your comments',
  draft: 'Draft',
  discardDrafts: 'Discard',
  discardDraftsConfirm: 'Discard your unpublished comments ({n})? This cannot be undone.',
  discardFailed: 'Could not discard',
  orphaned: 'Orphaned',
  lostAnchor: '{n} of your comments lost its anchor',
  lostAnchorPlural: '{n} of your comments lost their anchor',
  reviews: 'Reviews',
  discard: 'Discard',
  discardConfirm: 'Discard this review? Its comments are removed from the pages.',
  discarded: 'Discarded',
  published: 'Published',
  noReviews: 'No reviews yet.',
  reviewTitle: 'Review title',
  reviewSummary: 'Summary',
  saveFailed: 'Could not save the review',
  limitChars: 'This comment is too long. Shorten it and try again.',
  rateLimited: 'You are commenting too fast. Wait a minute and try again.',
  addReaction: 'Add reaction',
  resolve: 'Resolve',
  unresolve: 'Unresolve',
};

/**
 * Get a translated string by key.
 * Priority: window.__threads_i18n[key] → defaults[key] → key itself.
 */
export function t(key: string): string {
  const injected = (window as any).__threads_i18n;
  if (injected && typeof injected[key] === 'string') return injected[key];
  return defaults[key] || key;
}
