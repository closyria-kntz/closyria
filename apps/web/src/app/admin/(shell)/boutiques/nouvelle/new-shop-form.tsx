"use client";

import { adminShopCreatedSchema } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass, inputClass, primaryButtonClass } from "../../../ui";
import { CaptureOutcome } from "../capture-outcome";
import { useCaptureFollow } from "../use-capture-follow";

type Notice = { text: string; failed: boolean; shopId?: string };

export function NewShopForm() {
  const t = useTranslations("Admin.shops.new");
  const errors = useTranslations("Admin.common.errors");
  const [url, setUrl] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const { state, follow, reset } = useCaptureFollow();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setShopId(null);
    reset();
    const res = await adminRequest("POST", "/api/admin/shops", { url });
    setBusy(false);
    const created = adminShopCreatedSchema.safeParse(res.body);
    if (!res.ok || !created.success) {
      const key = catalogErrorKey(res.status, res.body);
      const owner = (res.body as { shopId?: unknown } | null)?.shopId;
      return setNotice({
        text: errors(key),
        failed: true,
        ...(key === "domainTaken" && typeof owner === "string" ? { shopId: owner } : {}),
      });
    }
    setShopId(created.data.shopId);
    setNotice({ text: t("created"), failed: false });
    follow(created.data.captureId);
  };

  /** One explicit PATCH per suggestion: nothing is applied on its own. */
  const apply = async (patch: { name: string } | { testUrl: string }, success: string) => {
    const res = await adminRequest("PATCH", `/api/admin/shops/${shopId}`, patch);
    setNotice(
      res.ok ? { text: success, failed: false } : { text: errors(catalogErrorKey(res.status, res.body)), failed: true },
    );
  };

  return (
    <div className="flex flex-col gap-space-4">
      <form onSubmit={submit} className="flex flex-col gap-space-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-space-1 text-sm">
          {t("url")}
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </label>
        <button type="submit" className={primaryButtonClass} disabled={busy || state.phase === "running"}>
          {t("submit")}
        </button>
      </form>
      <p role={notice?.failed ? "alert" : "status"} className={notice?.failed ? "text-danger" : "text-success"}>
        {notice?.text}{" "}
        {notice?.shopId ? (
          <a className="underline" href={`/admin/boutiques/${notice.shopId}`}>
            {errors("domainTakenLink")}
          </a>
        ) : null}
      </p>
      <CaptureOutcome
        state={state}
        onProduct={(product, canonicalUrl) => (
          <div className="flex flex-wrap gap-space-2">
            {product.siteName ? (
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  apply({ name: product.siteName as string }, t("nameTaken", { name: product.siteName as string }))
                }
              >
                {t("takeName")}
              </button>
            ) : null}
            <button
              type="button"
              className={buttonClass}
              onClick={() => apply({ testUrl: canonicalUrl }, t("testUrlSet"))}
            >
              {t("useTestUrl")}
            </button>
          </div>
        )}
      />
      {shopId ? (
        <p>
          <a className="underline" href={`/admin/boutiques/${shopId}`}>
            {t("openShop")}
          </a>
        </p>
      ) : null}
    </div>
  );
}
