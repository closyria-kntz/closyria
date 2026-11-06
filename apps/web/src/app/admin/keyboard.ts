/** True for ⌘K (macOS) or Ctrl+K (elsewhere): opens the command palette. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  return e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey;
}

/** Keeps Tab and Shift+Tab on the enabled buttons of an aria-modal dialog. */
export function trapTab(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault"> & { currentTarget: HTMLElement },
) {
  if (e.key !== "Tab") return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return e.preventDefault();
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
