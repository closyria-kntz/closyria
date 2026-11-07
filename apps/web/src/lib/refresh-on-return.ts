"use client";

import { useEffect, useRef } from "react";

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

/**
 * Calls `refresh` when she comes back to the page (another tab, another app, the phone out of her pocket):
 * what she changed elsewhere shows up without reloading. Off while `enabled` is false (a selection in progress).
 */
export function useRefreshOnReturn(refresh: () => void, enabled = true) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return;
    const gate = createReturnGate(Date.now());
    const onReturn = () => {
      const state = {
        visible: document.visibilityState === "visible",
        dialogOpen: document.querySelector("dialog[open]") !== null,
        now: Date.now(),
      };
      if (gate(state)) latest.current();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [enabled]);
}
