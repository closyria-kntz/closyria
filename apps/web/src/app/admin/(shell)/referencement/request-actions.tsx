"use client";

import { adminListingRequestAcceptedSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { CopySentence } from "@/components/copy-sentence";
import { adminRequest } from "@/lib/admin-catalog";
import { manageUrl } from "@/lib/listing";
import { buttonClass, primaryButtonClass } from "../../ui";

/**
 * « Accepter » (after « J'ai vérifié que cette personne représente la boutique ») or « Refuser ». An accepted request
 * gives the signer's private management link, shown here once, to send her.
 */
export function RequestActions({
  requestId,
  shopName,
  signerName,
}: {
  requestId: string;
  shopName: string;
  signerName: string;
}) {
  const t = useTranslations("Admin.listingRequests");
  const router = useRouter();
  const checkId = useId();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const decide = async (decision: "accept" | "refuse") => {
    if (busy) return;
    if (decision === "accept" && !verified) return setError(t("verifyFirst"));
    setBusy(true);
    setError(null);
    const res = await adminRequest(
      "POST",
      `/api/admin/listing-requests/${requestId}/${decision}`,
      decision === "accept" ? { verified: true } : undefined,
    );
    setBusy(false);
    if (!res.ok) return setError(res.status === 409 ? t("decidedAlready") : t("failed"));
    if (decision === "accept") {
      const parsed = adminListingRequestAcceptedSchema.safeParse(res.body);
      if (parsed.success) return setLink(manageUrl(window.location.origin, parsed.data.manageToken));
    }
    router.refresh();
  };

  if (link) {
    return (
      <div
        data-testid="request-accepted"
        className="flex flex-col gap-space-2 rounded-card bg-surface-sunken p-space-3"
      >
        <p role="status" className="font-strong">
          {t("accepted", { name: signerName })}
        </p>
        <CopySentence
          label={t("copy")}
          text={link}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
          failedLabel={t("failed")}
        />
        <button
          type="button"
          onClick={() => router.refresh()}
          className={`${buttonClass} min-h-touch-target self-start`}
        >
          {t("close")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-2">
      <label htmlFor={checkId} className="flex min-h-touch-target cursor-pointer items-center gap-space-3 text-sm">
        <input
          id={checkId}
          type="checkbox"
          checked={verified}
          onChange={(e) => {
            setVerified(e.target.checked);
            setError(null);
          }}
          className="size-space-5 shrink-0 accent-accent"
        />
        <span>
          {t("verified")}
          <span className="sr-only"> · {shopName}</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-space-3">
        <button
          type="button"
          onClick={() => void decide("accept")}
          disabled={busy}
          className={`${primaryButtonClass} min-h-touch-target`}
        >
          {busy ? t("busy") : t("accept")}
          <span className="sr-only"> {shopName}</span>
        </button>
        <button
          type="button"
          onClick={() => void decide("refuse")}
          disabled={busy}
          className={`${buttonClass} min-h-touch-target`}
        >
          {t("refuse")}
          <span className="sr-only"> {shopName}</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
