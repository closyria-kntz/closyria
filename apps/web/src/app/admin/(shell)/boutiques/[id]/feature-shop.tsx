"use client";

import type { ShopStatus } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * « Boutique de la semaine »: puts a published shop forward as the une of « Découvrir » (the one featured most
 * recently is shown), or takes it off.
 */
export function FeatureShop({ shopId, status, featured }: { shopId: string; status: ShopStatus; featured: boolean }) {
  const t = useTranslations("Admin.shops.feature");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await adminRequest(featured ? "DELETE" : "POST", `/api/admin/shops/${shopId}/feature`);
    setBusy(false);
    if (!res.ok) return setError(errors(catalogErrorKey(res.status, res.body)));
    router.refresh();
  };

  return (
    <section aria-labelledby="feature-title" className="flex flex-col gap-space-3">
      <h2 id="feature-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <p className="text-ink-muted">{featured ? t("on") : status === "published" ? t("off") : t("draft")}</p>
      {(featured || status === "published") && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`${featured ? buttonClass : primaryButtonClass} min-h-touch-target self-start`}
        >
          {featured ? t("remove") : t("add")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
