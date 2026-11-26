/**
 * Hide the raw `.threads-sidebar` markdown-it renders for each `::: threads` block.
 * When onlyIfEmpty is true, leaves sidebars that still contain un-relocated thread cards visible.
 */
export function hideRawSidebars(root: ParentNode, onlyIfEmpty = false): void {
  root.querySelectorAll<HTMLElement>('.threads-sidebar').forEach((el) => {
    if (!onlyIfEmpty || el.querySelectorAll('.threads-thread').length === 0) {
      el.style.display = 'none';
    }
  });
}
