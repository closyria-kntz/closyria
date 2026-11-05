"use client";

import { type AdminShop, canonicalizeUrl } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminRequest, shopPatchErrorKey } from "@/lib/admin-catalog";
import { inputClass, primaryButtonClass } from "../../ui";

const STATUSES = ["pending", "draft", "published"] as const;
const MODES = ["auto", "manual"] as const;
const KINDS = ["catalog", "secondhand"] as const;

/** The settings of a shop: one PATCH with the fields, then a refresh of the page. */
export function ShopSettingsForm({ shop }: { shop: AdminShop }) {
  const t = useTranslations("Admin.shops");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [name, setName] = useState(shop.name);
  const [slug, setSlug] = useState(shop.slug);
  const [status, setStatus] = useState(shop.status);
  const [captureMode, setCaptureMode] = useState(shop.captureMode);
  const [listingKind, setListingKind] = useState(shop.listingKind);
  const [testUrl, setTestUrl] = useState(shop.testUrl ?? "");
  const [domains, setDomains] = useState(shop.domains.join("\n"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean; shopId?: string } | null>(null);

  // After a save the page is refreshed: show what the server kept (domains come back normalised).
  useEffect(() => {
    setName(shop.name);
    setSlug(shop.slug);
    setStatus(shop.status);
    setCaptureMode(shop.captureMode);
    setListingKind(shop.listingKind);
    setTestUrl(shop.testUrl ?? "");
    setDomains(shop.domains.join("\n"));
  }, [shop]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (testUrl.trim() !== "" && canonicalizeUrl(testUrl.trim()) === null) {
      return setMessage({ text: errors("invalidUrl"), failed: true });
    }
    setBusy(true);
    const res = await adminRequest("PATCH", `/api/admin/shops/${shop.id}`, {
      name,
      slug,
      status,
      captureMode,
      listingKind,
      testUrl: testUrl.trim() === "" ? null : testUrl.trim(),
      domains: domains
        .split("\n")
        .map((d) => d.trim())
        .filter((d) => d !== ""),
    });
    setBusy(false);
    if (res.ok) {
      setMessage({ text: t("saved"), failed: false });
      return router.refresh();
    }
    const key = shopPatchErrorKey(res.status, res.body);
    const owner = (res.body as { shopId?: unknown } | null)?.shopId;
    setMessage({
      text: errors(key),
      failed: true,
      ...(key === "domainTaken" && typeof owner === "string" ? { shopId: owner } : {}),
    });
  };

  const field = "flex flex-col gap-space-1 text-sm";
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
      <label className={field}>
        {t("name")}
        <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className={field}>
        {t("slug")}
        <input
          required
          maxLength={80}
          pattern="[a-z0-9\-]+"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className={field}>
        {t("status")}
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t("mode")}
        <select
          value={captureMode}
          onChange={(e) => setCaptureMode(e.target.value as typeof captureMode)}
          className={inputClass}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(`modes.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t("kind")}
        <select
          value={listingKind}
          onChange={(e) => setListingKind(e.target.value as typeof listingKind)}
          className={inputClass}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <p className={field}>
        <span>{t("platform")}</span>
        <span className="py-space-2">{t(`platforms.${shop.platform}`)}</span>
      </p>
      <label className={`${field} sm:col-span-2`}>
        {t("testUrl")}
        <input
          type="url"
          maxLength={2048}
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
          className={inputClass}
          aria-describedby="test-url-hint"
        />
        <span id="test-url-hint" className="text-ink-muted">
          {t("testUrlHint")}
        </span>
      </label>
      <label className={`${field} sm:col-span-2`}>
        {t("domainsField")}
        <textarea
          required
          rows={4}
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          className={`${inputClass} font-mono`}
        />
      </label>
      <div className="flex flex-col gap-space-2 sm:col-span-2">
        <div>
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {t("save")}
          </button>
        </div>
        <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
          {message?.text}{" "}
          {message?.shopId ? (
            <a className="underline" href={`/admin/boutiques/${message.shopId}`}>
              {errors("domainTakenLink")}
            </a>
          ) : null}
        </p>
      </div>
    </form>
  );
}
