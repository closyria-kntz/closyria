"use client";

import type { AdminShopAgreements } from "@closyria/shared";
import { adminInvitationCreatedSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { CopySentence } from "@/components/copy-sentence";
import { adminRequest } from "@/lib/admin-catalog";
import { invitationUrl } from "@/lib/listing";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * « Accord de référencement » (accords en ligne): the status, the invitation link (made here, shown once: only its
 * hash is stored) with a ready-to-send e-mail, « Révoquer le lien », and the agreements' history.
 */
export function ShopAgreement({
  shopId,
  shopName,
  partnerSince,
  initial,
}: {
  shopId: string;
  shopName: string;
  partnerSince: string | null;
  initial: AdminShopAgreements;
}) {
  const t = useTranslations("Admin.shops.agreement");
  const errors = useTranslations("Admin.common.errors");
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "Europe/Paris" });
  const open = created ?? initial.invitation;

  const act = async (method: "POST" | "DELETE") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await adminRequest(method, `/api/admin/shops/${shopId}/invitations`);
    setBusy(false);
    if (!res.ok) return setError(errors("generic"));
    if (method === "DELETE") {
      setCreated(null);
      setNotice(t("revoked"));
    } else {
      const parsed = adminInvitationCreatedSchema.safeParse(res.body);
      if (!parsed.success) return setError(errors("generic"));
      setCreated({ url: invitationUrl(window.location.origin, parsed.data.token), expiresAt: parsed.data.expiresAt });
    }
    router.refresh();
  };

  return (
    <section aria-labelledby="agreement-title" className="flex flex-col gap-space-3">
      <h2 id="agreement-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <p data-testid="agreement-status">
        {partnerSince ? t("partnerSince", { date: day(partnerSince) }) : t("notPartner")}
      </p>
      {open && <p className="text-ink-muted">{t("invitationOpen", { date: day(open.expiresAt) })}</p>}
      <div className="flex flex-wrap gap-space-3">
        <button
          type="button"
          onClick={() => void act("POST")}
          disabled={busy}
          className={`${primaryButtonClass} min-h-touch-target`}
        >
          {open ? t("recreate") : t("create")}
        </button>
        {open && (
          <button
            type="button"
            onClick={() => void act("DELETE")}
            disabled={busy}
            className={`${buttonClass} min-h-touch-target`}
          >
            {t("revoke")}
          </button>
        )}
      </div>
      {created && (
        <div
          data-testid="invitation-link"
          className="flex flex-col gap-space-3 rounded-card bg-surface-sunken p-space-3"
        >
          <CopySentence
            label={t("linkLabel")}
            text={created.url}
            copyLabel={t("copy")}
            copiedLabel={t("copied")}
            failedLabel={t("copyFailed")}
          />
          <p className="text-sm text-ink-muted">{t("linkHint")}</p>
          <CopySentence
            label={t("emailLabel")}
            text={t("emailText", { shop: shopName, url: created.url, date: day(created.expiresAt) })}
            copyLabel={t("copyEmail")}
            copiedLabel={t("copied")}
            failedLabel={t("copyFailed")}
          />
        </div>
      )}
      <p role="status" className="text-sm empty:hidden">
        {notice ?? ""}
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <h3 className="font-strong">{t("history")}</h3>
      {initial.agreements.length === 0 ? (
        <p className="text-ink-muted">{t("noHistory")}</p>
      ) : (
        <ul data-testid="agreement-history" className="flex flex-col gap-space-2 text-sm">
          {initial.agreements.map((a) => (
            <li key={a.id} className="flex flex-col gap-space-0-5 rounded-md border border-card-border p-space-2-5">
              <span className="font-strong">
                {t(`via.${a.via}`)} ·{" "}
                {a.withdrawnAt ? t(`ended.${a.withdrawnBy ?? "admin"}`, { date: day(a.withdrawnAt) }) : t("inForce")}
              </span>
              <span>
                {a.signerEmail
                  ? t("signedByEmail", { date: day(a.acceptedAt), name: a.signerName, email: a.signerEmail })
                  : t("signedBy", { date: day(a.acceptedAt), name: a.signerName })}
              </span>
              <span className="text-ink-muted">{t("conditions", { version: a.conditionsVersion })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
