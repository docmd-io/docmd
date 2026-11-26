/**
 * Hide the raw `.threads-sidebar` markdown-it renders for each `::: threads` block.
 * A page may hold several blocks; the app shows their threads itself.
 */
export function hideRawSidebars(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.threads-sidebar').forEach((el) => {
    el.style.display = 'none';
  });
}
