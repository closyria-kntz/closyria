import { conditionsBlocks } from "@closyria/shared";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { focusRing } from "./ui";

/**
 * The frame of the listing pages (invitation, management, request): Boudoir's burgundy band with the logo, as on the
 * shared list and dev's access page, outside the app shell (no session needed), and a narrow reading column.
 */
export async function ListingShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("Listing");
  const tShell = await getTranslations("Shell");
  return (
    <>
      <header className="bg-band text-band-ink">
        <div className="mx-auto flex w-full max-w-app items-center px-space-4 py-space-3 md:px-space-5 lg:px-space-6">
          <Link href="/" aria-label={t("brandHome")} className={`font-title text-logo leading-none ${focusRing}`}>
            {tShell("brand")}
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-narrow flex-col gap-space-5 px-space-4 pt-space-6 pb-space-7 md:px-space-5 md:pt-space-7">
        {children}
      </main>
    </>
  );
}

export const listingKickerClass = "text-meta font-bold tracking-wide text-une-ink uppercase";
export const listingTitleClass = "font-title text-page-title leading-tight font-regular break-words";

/**
 * The conditions exactly as bundled (their SHA-256 is recorded with each acceptance), as plain text blocks: the
 * document's own title is left out, the page gives its heading (the version is in the text and on the box).
 */
export async function ConditionsText({ markdown, titleId }: { markdown: string; titleId: string }) {
  const t = await getTranslations("Listing");
  const blocks = conditionsBlocks(markdown).filter((b) => b.kind !== "title");
  return (
    <section
      aria-labelledby={titleId}
      data-testid="listing-conditions"
      className="flex flex-col gap-space-3 rounded-card bg-surface-sunken p-space-4 text-sm md:p-space-5"
    >
      <h2 id={titleId} className="font-title text-section-title leading-tight font-regular">
        {t("conditionsTitle")}
      </h2>
      {blocks.map((block, i) => {
        const key = `${block.kind}-${i}`;
        if (block.kind === "heading")
          return (
            <h3 key={key} className="pt-space-1 font-bold text-ink">
              {block.text}
            </h3>
          );
        if (block.kind === "list")
          return (
            <ul key={key} className="flex list-disc flex-col gap-space-1 ps-space-5">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        if (block.kind === "paragraph") return <p key={key}>{block.text}</p>;
        return null;
      })}
    </section>
  );
}

/** A link that is no longer good (used, expired, revoked, replaced, unknown): nothing about any shop. */
export async function InvalidLink({ manage = false }: { manage?: boolean }) {
  const t = await getTranslations("Listing");
  return (
    <ListingShell>
      <h1 className={listingTitleClass}>{manage ? t("manage.invalidTitle") : t("invalid.title")}</h1>
      <p className="text-ink-muted">{manage ? t("manage.invalidBody") : t("invalid.body")}</p>
      {!manage && (
        <Link href="/referencer-ma-boutique" className={`self-start text-accent underline ${focusRing}`}>
          {t("invalid.request")}
        </Link>
      )}
    </ListingShell>
  );
}
