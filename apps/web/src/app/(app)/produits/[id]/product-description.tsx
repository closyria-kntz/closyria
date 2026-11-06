"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

/**
 * The shop's description, as plain text with its line breaks. Folded to four lines; « Lire la suite » unfolds
 * it, and only shows when the text is actually cut.
 */
export function ProductDescription({ text }: { text: string }) {
  const t = useTranslations("Capture.product.description");
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useEffect(() => {
    const element = body.current;
    if (!element || open) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  return (
    <section aria-labelledby={`${id}-title`} data-testid="product-description" className="flex flex-col gap-space-2">
      <h3 id={`${id}-title`} className="text-sm font-strong">
        {t("title")}
      </h3>
      <p id={`${id}-body`} ref={body} className={`whitespace-pre-line text-sm ${open ? "" : "line-clamp-4"}`}>
        {text}
      </p>
      {(cut || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((v) => !v)}
          className="self-start text-sm font-strong underline underline-offset-2 min-h-touch-target"
        >
          {open ? t("less") : t("more")}
        </button>
      )}
    </section>
  );
}
