"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { sharedUrlFromQuery } from "@/lib/shared-url";
import { CaptureForm } from "./capture-form";

/**
 * The capture of `/partager`: the link read from the raw address first (an iOS shortcut may send it unencoded, with
 * its own `?` and `&`), else the one the server found in the parameters (`parsed`: url, then text, then title).
 */
export function ShareTarget({ parsed }: { parsed: string | null }) {
  const t = useTranslations("Capture");
  // undefined until the browser's address is read: nothing is sent before.
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setUrl(sharedUrlFromQuery(window.location.search) ?? parsed);
  }, [parsed]);

  if (url === undefined) {
    return (
      <p role="status" aria-busy="true" className="text-ink-muted">
        {t("share.adding")}
      </p>
    );
  }
  return url ? (
    <CaptureForm initialUrl={url} autoSubmit />
  ) : (
    <>
      <p role="status" className="text-ink-muted">
        {t("share.noLink")}
      </p>
      <CaptureForm />
    </>
  );
}
