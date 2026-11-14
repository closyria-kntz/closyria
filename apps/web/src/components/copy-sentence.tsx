"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COPIED_FEEDBACK_MS } from "@/lib/timing";
import { buttonClass, focusRing } from "./ui";

/**
 * A sentence to paste elsewhere (the iPhone help's request to the phone's AI), shown in full: « Copier » puts it in the
 * clipboard in the click, « Copié ✓ » for a moment; if the clipboard refuses, the sentence is selected, to copy by hand.
 */
export function CopySentence({
  label,
  text,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  label: string;
  text: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailed(true);
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-space-2">
      <label htmlFor={id} className="text-sm font-strong">
        {label}
      </label>
      <textarea
        ref={field}
        id={id}
        readOnly
        rows={3}
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        className={`w-full resize-none rounded-md border border-dashed border-selected-line bg-surface-sunken px-space-3 py-space-2 text-sm text-ink field-sizing-content ${focusRing}`}
      />
      <button type="button" onClick={() => void copy()} className={`${buttonClass} min-h-touch-target self-start`}>
        {copied ? copiedLabel : copyLabel}
      </button>
      <span role="status" className="text-sm text-ink-muted">
        {copied ? copiedLabel : failed ? failedLabel : ""}
      </span>
    </div>
  );
}
