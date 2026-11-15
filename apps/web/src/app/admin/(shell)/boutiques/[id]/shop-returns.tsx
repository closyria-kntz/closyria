"use client";

import { type AdminShopDetail, adminShopPatchSchema, MAX_RETURN_DAYS } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminRequest, shopPatchErrorKey } from "@/lib/admin-catalog";
import { inputClass, primaryButtonClass } from "../../../ui";

type Props = Pick<AdminShopDetail, "id" | "returnDays" | "returnsUrl" | "carriersSeen">;

/**
 * « Retours et colis » (« Après la commande » §4): the days she has to send an item back from its delivery, the
 * shop's returns page (https), and the carriers seen on its orders' parcels. One PATCH of those two fields only.
 */
export function ShopReturns({ id, returnDays, returnsUrl, carriersSeen }: Props) {
  const t = useTranslations("Admin.shops.returns");
  const carrierT = useTranslations("Orders.parcel.carrier");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [days, setDays] = useState(String(returnDays));
  const [url, setUrl] = useState(returnsUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  // After a save the page is refreshed: show what the server kept.
  useEffect(() => setDays(String(returnDays)), [returnDays]);
  useEffect(() => setUrl(returnsUrl ?? ""), [returnsUrl]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const body = adminShopPatchSchema.safeParse({
      returnDays: days.trim() === "" ? Number.NaN : Number(days),
      returnsUrl: url.trim() === "" ? null : url.trim(),
    });
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      return setMessage({ text: field === "returnsUrl" ? t("invalidUrl") : t("invalidDays"), failed: true });
    }
    setBusy(true);
    const res = await adminRequest("PATCH", `/api/admin/shops/${id}`, body.data);
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(shopPatchErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t("saved"), failed: false });
    router.refresh();
  };

  const field = "flex flex-col gap-space-1 text-sm";
  return (
    <section aria-labelledby="returns-title" className="flex flex-col gap-space-3">
      <h2 id="returns-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
        <label className={field}>
          {t("days")}
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_RETURN_DAYS}
            step={1}
            required
            value={days}
            onChange={(e) => setDays(e.target.value)}
            aria-describedby="return-days-hint"
            data-testid="return-days"
            className={inputClass}
          />
          <span id="return-days-hint" className="text-ink-muted">
            {t("daysHint", { max: MAX_RETURN_DAYS })}
          </span>
        </label>
        <label className={field}>
          {t("url")}
          <input
            type="url"
            inputMode="url"
            maxLength={2048}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-describedby="returns-url-hint"
            data-testid="returns-url"
            className={inputClass}
          />
          <span id="returns-url-hint" className="text-ink-muted">
            {t("urlHint")}
          </span>
        </label>
        <div className="flex flex-col gap-space-2 sm:col-span-2">
          <div>
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              {t("save")}
            </button>
          </div>
          <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
            {message?.text}
          </p>
        </div>
      </form>
      <div className="flex flex-col gap-space-1 text-sm">
        <h3 className="font-strong">{t("carriers")}</h3>
        <p data-testid="carriers-seen" className={carriersSeen.length === 0 ? "text-ink-muted" : undefined}>
          {carriersSeen.length === 0 ? t("noCarriers") : carriersSeen.map((carrier) => carrierT(carrier)).join(" · ")}
        </p>
      </div>
    </section>
  );
}
