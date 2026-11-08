import { UNDO_DELAY_MS } from "@closyria/shared";

/** A mutation's message, and how to undo it, kept for 8 s (the toast shows it as « … · Annuler »). */
export type UndoEntry = { id: number; label: string; undoable: boolean };

/** How many messages the toast stacks; a new one beyond that pushes the oldest out. */
export const UNDO_STACK_MAX = 3;

type Held = { entry: UndoEntry; op: (() => Promise<boolean>) | null; timer: ReturnType<typeof setTimeout> };

let held: Held[] = [];
// Stable reference between changes: useSyncExternalStore compares snapshots with Object.is.
let snapshot: UndoEntry[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = held.map((h) => h.entry);
  for (const listener of listeners) listener();
};

function remove(id: number): Held | undefined {
  const found = held.find((h) => h.entry.id === id);
  if (!found) return undefined;
  clearTimeout(found.timer);
  held = held.filter((h) => h !== found);
  emit();
  return found;
}

/** Drops every message. */
export function clearUndo(): void {
  if (held.length === 0) return;
  for (const h of held) clearTimeout(h.timer);
  held = [];
  emit();
}

/** Stacks a message (op null: nothing to undo); it expires on its own after 8 s, the oldest of 3 is pushed out. */
export function pushUndo(label: string, op: (() => Promise<boolean>) | null): void {
  const entry: UndoEntry = { id: ++counter, label, undoable: op !== null };
  const timer = setTimeout(() => remove(entry.id), UNDO_DELAY_MS);
  held = [...held, { entry, op, timer }];
  while (held.length > UNDO_STACK_MAX) {
    const [oldest, ...rest] = held;
    if (oldest) clearTimeout(oldest.timer);
    held = rest;
  }
  emit();
}

/** Runs the operation of entry `id` (the newest by default) once; false when there is none (or it failed). */
export async function runUndo(id?: number): Promise<boolean> {
  const target = id === undefined ? held[held.length - 1] : held.find((h) => h.entry.id === id);
  if (!target?.op) return false;
  remove(target.entry.id);
  try {
    return await target.op();
  } catch {
    return false;
  }
}

/** The visible messages, newest last (at most 3). */
export const getUndoStack = (): UndoEntry[] => snapshot;

/** The newest message, or null. */
export const getUndo = (): UndoEntry | null => snapshot[snapshot.length - 1] ?? null;

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
