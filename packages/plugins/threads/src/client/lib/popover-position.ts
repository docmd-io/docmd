/** Where to put a `popover=manual` card next to its anchor. Pure: the component measures, this decides. */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Below the anchor, left edges aligned; above it when there is not enough room below and more room
 * above; kept inside the viewport horizontally and vertically (with `margin` to the edges).
 */
export function placePopover(anchor: Box, size: { width: number; height: number }, viewport: Viewport, gap = 6, margin = 8): { top: number; left: number } {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - size.height;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = anchor.top - gap - margin;
  const top = size.height <= roomBelow || roomBelow >= roomAbove ? below : above;
  const maxLeft = viewport.width - margin - size.width;
  const left = Math.max(margin, Math.min(anchor.left, maxLeft));
  const maxTop = viewport.height - margin - size.height;
  return { top: Math.max(margin, Math.min(top, maxTop)), left };
}
