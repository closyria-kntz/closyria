/** The ids with `id` moved one place up or down; null when it cannot move (at the end, or unknown). */
export function moveId(ids: readonly string[], id: string, direction: "up" | "down"): string[] | null {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as string);
  return next;
}
