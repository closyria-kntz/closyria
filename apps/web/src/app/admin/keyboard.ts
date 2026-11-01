/** True for ⌘K (macOS) or Ctrl+K (elsewhere): opens the command palette. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  return e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey;
}
