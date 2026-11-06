"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isPaletteShortcut } from "./keyboard";
import { buttonClass, focusRing } from "./ui";

type Labels = { open: string; shortcut: string; label: string; placeholder: string; empty: string; navigation: string };

/**
 * ⌘K / Ctrl+K command palette (cmdk) to reach any admin page from the keyboard. A native modal <dialog>
 * provides the focus trap, Escape to close and an inert background; cmdk provides filtering and arrow keys.
 */
export function CommandPalette({ items, labels }: { items: Array<{ href: string; label: string }>; labels: Labels }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
      >
        {labels.open}
        <kbd className="rounded-sm border border-line px-space-1 font-body text-sm text-ink-muted">
          {labels.shortcut}
        </kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label={labels.label}
        onClose={() => setOpen(false)}
        className="mx-auto mt-space-8 w-full max-w-narrow rounded-card border border-line bg-surface-raised p-space-0 text-ink shadow-lifted backdrop:bg-ink/40"
      >
        {open ? (
          <Command label={labels.label} loop className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder={labels.placeholder}
              className={`w-full border-b border-line bg-surface-raised px-space-4 py-space-3 text-body text-ink placeholder:text-ink-muted ${focusRing}`}
            />
            <Command.List className="max-h-dvh overflow-y-auto p-space-2">
              <Command.Empty className="px-space-3 py-space-2 text-sm text-ink-muted">{labels.empty}</Command.Empty>
              <Command.Group heading={labels.navigation} className="px-space-1 text-sm text-ink-muted">
                {items.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={item.label}
                    onSelect={() => go(item.href)}
                    className="cursor-pointer rounded-button px-space-3 py-space-2 text-body text-ink data-[selected=true]:bg-surface-strong"
                  >
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        ) : null}
      </dialog>
    </>
  );
}
