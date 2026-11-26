/** The tallest an auto-sized text box grows before it scrolls. */
export const AUTOSIZE_MAX_PX = 320;

/**
 * Whether the text box needs the script to grow with its content: true unless the browser sizes it
 * itself with `field-sizing: content` (Chromium; Firefox and Safari need the script).
 */
export function needsAutosize(supports?: (property: string, value: string) => boolean): boolean {
  if (!supports) return true;
  try {
    return !supports('field-sizing', 'content');
  } catch {
    return true;
  }
}

/**
 * The height to give a text box: its content height plus the borders (`scrollHeight` leaves them
 * out of a border-box element), capped at `max`, with a scrollbar only once the cap is reached.
 */
export function fitHeight(scrollHeight: number, borders: number, max = AUTOSIZE_MAX_PX): { height: number; overflowY: 'hidden' | 'auto' } {
  const wanted = scrollHeight + borders;
  return wanted > max ? { height: max, overflowY: 'auto' } : { height: wanted, overflowY: 'hidden' };
}
