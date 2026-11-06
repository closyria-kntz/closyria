import { UNDO_DELAY_MS } from "@closyria/shared";

/** The last mutation's message, and how to undo it, kept for 8 s (the toast shows it as « … · Annuler »). */
export type UndoEntry = { id: number; label: string; undoable: boolean };

let current: { entry: UndoEntry; op: (() => Promise<boolean>) | null; timer: ReturnType<typeof setTimeout> } | null =
  null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function clearUndo(): void {
  if (!current) return;
  clearTimeout(current.timer);
  current = null;
  emit();
}

/** Remembers `op` (null: nothing to undo, only a message) for 8 s; it replaces the previous one. */
export function pushUndo(label: string, op: (() => Promise<boolean>) | null): void {
  if (current) clearTimeout(current.timer);
  const entry: UndoEntry = { id: ++counter, label, undoable: op !== null };
  current = { entry, op, timer: setTimeout(clearUndo, UNDO_DELAY_MS) };
  emit();
}

/** Runs the remembered operation once; false when there is none (or it failed). */
export async function runUndo(): Promise<boolean> {
  const held = current;
  if (!held?.op) return false;
  clearUndo();
  try {
    return await held.op();
  } catch {
    return false;
  }
}

export const getUndo = (): UndoEntry | null => current?.entry ?? null;

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
