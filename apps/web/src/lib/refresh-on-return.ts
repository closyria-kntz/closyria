/** Two refreshes are at least this far apart: `focus` and `visibilitychange` often fire together. */
export const RETURN_REFRESH_GAP_MS = 2000;

type ReturnState = { visible: boolean; dialogOpen: boolean; now: number };

/**
 * Decides whether a return to the page reads the data again: only when the page is visible, no window
 * (dialog) is open, and the previous read is older than the gap. `since`: when the data was last read.
 */
export function createReturnGate(since: number, gap: number = RETURN_REFRESH_GAP_MS) {
  let last = since;
  return ({ visible, dialogOpen, now }: ReturnState): boolean => {
    if (!visible || dialogOpen || now - last < gap) return false;
    last = now;
    return true;
  };
}
