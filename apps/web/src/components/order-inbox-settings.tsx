"use client";

import type { OrderInboxView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";
import { mailboxHelp } from "@/lib/order-inbox-help";
import { fetchOrderInbox, newOrderInbox } from "@/lib/orders-client";
import { Dialog } from "./dialog";
import { buttonClass, focusRing, primaryButtonClass } from "./ui";

const HERE = "/reglages/commandes";

const cardClass = "flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4";
const subTitleClass = "font-display text-lead font-strong";
const linkClass = `inline-flex min-h-touch-target items-center self-start rounded-button text-sm font-strong text-accent underline underline-offset-4 ${focusRing}`;
const summaryClass = `flex min-h-touch-target cursor-pointer items-center justify-between gap-space-3 rounded-button font-strong ${focusRing}`;

type State = { kind: "loading" } | { kind: "failed" } | { kind: "guest" } | { kind: "ready"; inbox: OrderInboxView };

/** Her inbox, with an address: her first one is made the first time she opens this page. */
async function loadInbox(): Promise<OrderInboxView | "guest"> {
  const inbox = await fetchOrderInbox();
  // No reception here yet: no address to make (one nobody reads would lose her e-mails).
  if (inbox === "guest" || inbox.address || !inbox.receiving) return inbox;
  const created = await newOrderInbox();
  if (!created.ok) throw new Error(created.error);
  return {
    receiving: created.receiving,
    address: created.address,
    autoForward: created.autoForward,
    pendingGmailCode: inbox.pendingGmailCode,
  };
}

function Shell({ children, intro = true }: { children: ReactNode; intro?: boolean }) {
  const t = useTranslations("Orders.inbox");
  return (
    <section aria-labelledby="order-inbox-title" className="flex max-w-measure flex-col gap-space-4">
      <h2 id="order-inbox-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      {intro && <p>{t("intro")}</p>}
      {children}
    </section>
  );
}

/** A mailbox's steps: one e-mail at a time, then — when accepted — all of them automatically. */
function Mailbox({ name, one, auto }: { name: string; one: string; auto: string[] | null }) {
  const t = useTranslations("Orders.inbox");
  return (
    <details className="group rounded-card bg-surface-sunken px-space-4 py-space-1">
      <summary className={summaryClass}>
        <span>{name}</span>
        <span aria-hidden="true" className="text-ink-muted transition-transform duration-base group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="flex flex-col gap-space-3 pt-space-1 pb-space-3 text-sm">
        <div className="flex flex-col gap-space-1">
          {auto && <h4 className="font-strong">{t("oneByOne")}</h4>}
          <p>{one}</p>
        </div>
        {auto && (
          <div className="flex flex-col gap-space-1">
            <h4 className="font-strong">{t("automatic")}</h4>
            {auto.length === 1 ? (
              <p>{auto[0]}</p>
            ) : (
              <ol className="flex list-inside list-decimal flex-col gap-space-1-5 marker:font-bold marker:text-accent">
                {auto.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Compte → « Mes commandes par e-mail » (spec §3.1): her personal address with « Copier » and « Changer d'adresse »
 * (asked first: the former one stops at once), Gmail's confirmation code when one arrived, and how to forward her
 * order e-mails from Gmail, Outlook and iCloud. A guest creates her account first.
 */
export function OrderInboxSettings() {
  const t = useTranslations("Orders.inbox");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeFailed, setChangeFailed] = useState(false);
  const addressTitleId = useId();
  const hintId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, and on « Réessayer ».
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    loadInbox().then(
      (inbox) => alive && setState(inbox === "guest" ? { kind: "guest" } : { kind: "ready", inbox }),
      () => alive && setState({ kind: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <p role="status">{t("loading")}</p>
      </Shell>
    );
  }
  if (state.kind === "failed") {
    return (
      <Shell>
        <p role="alert" className="text-danger">
          {t("failed")}
        </p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className={`${buttonClass} min-h-touch-target self-start`}
        >
          {t("retry")}
        </button>
      </Shell>
    );
  }
  if (state.kind === "guest") {
    return (
      <Shell>
        <section aria-labelledby="order-inbox-guest" className={`${cardClass} bg-hint`}>
          <h3 id="order-inbox-guest" className={subTitleClass}>
            {t("guestTitle")}
          </h3>
          <p>{t("guestBody")}</p>
          <Link
            href={`/connexion?next=${encodeURIComponent(HERE)}`}
            className={`${primaryButtonClass} min-h-touch-target self-start`}
          >
            {t("createAccount")}
          </Link>
        </section>
      </Shell>
    );
  }

  const { inbox } = state;
  if (!inbox.receiving) {
    return (
      <Shell intro={false}>
        <section aria-labelledby="order-inbox-soon" className={`${cardClass} bg-hint`} data-testid="order-inbox-soon">
          <h3 id="order-inbox-soon" className={subTitleClass}>
            {t("soonTitle")}
          </h3>
          <p>{t("soonBody")}</p>
          <Link href="/mes-commandes" className={`${buttonClass} min-h-touch-target self-start`}>
            {t("soonLink")}
          </Link>
        </section>
      </Shell>
    );
  }
  const address = inbox.address ?? "";
  // Gmail's code only matters for its automatic forwarding (the API gives none while it is off).
  const code = inbox.autoForward ? inbox.pendingGmailCode : null;
  /** A message of `Orders.inbox` named by the help (`mailboxHelp`). */
  const tKey = (key: string, values?: { code: string }) => t(key as "gmail.one", values);

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(address);
      setStatus(t("copied"));
    } catch {
      setStatus("");
      setCopyFailed(true);
    }
  };

  const change = async () => {
    setChanging(true);
    setChangeFailed(false);
    const result = await newOrderInbox();
    setChanging(false);
    setAsking(false);
    if (!result.ok) return setChangeFailed(true);
    setState({
      kind: "ready",
      inbox: {
        receiving: result.receiving,
        address: result.address,
        autoForward: result.autoForward,
        pendingGmailCode: null,
      },
    });
    setStatus(t("changed"));
  };

  return (
    <Shell>
      <section aria-labelledby={addressTitleId} className={cardClass}>
        <h3 id={addressTitleId} className={subTitleClass}>
          {t("addressTitle")}
        </h3>
        <p
          data-testid="order-address"
          aria-describedby={hintId}
          className="rounded-card bg-surface-sunken px-space-4 py-space-3 font-strong wrap-break-word select-all"
        >
          {/* On a phone the address goes onto two lines before its « @ », never inside a word. */}
          {address.split("@")[0]}
          <wbr />@{address.split("@")[1]}
        </p>
        <p id={hintId} className="text-sm text-ink-muted">
          {t("addressHint")}
        </p>
        <div className="flex flex-wrap gap-space-2">
          <button type="button" onClick={() => void copy()} className={`${primaryButtonClass} min-h-touch-target`}>
            {t("copy")}
          </button>
          <button type="button" onClick={() => setAsking(true)} className={`${buttonClass} min-h-touch-target`}>
            {t("change")}
          </button>
        </div>
        <p role="status" className="text-sm empty:hidden">
          {status}
        </p>
        {copyFailed && (
          <p role="alert" className="text-sm text-danger">
            {t("copyFailed")}
          </p>
        )}
        {changeFailed && (
          <p role="alert" className="text-sm text-danger">
            {t("changeFailed")}
          </p>
        )}
        {code && (
          <div className="flex flex-col gap-space-1 rounded-card bg-une p-space-3">
            <p className="text-meta font-bold tracking-wide text-une-ink uppercase">{t("gmailCodeTitle")}</p>
            <p data-testid="gmail-code" className="font-title text-une-title tracking-wide tabular-nums">
              {code}
            </p>
            <p className="text-sm">{t("gmailCodeBody")}</p>
          </div>
        )}
      </section>

      <Dialog open={asking} onClose={() => setAsking(false)} title={t("changeTitle")} closeLabel={t("cancel")}>
        <p>{t("changeBody")}</p>
        <p className="text-sm text-ink-muted">{t("changeHint")}</p>
        <button
          type="button"
          disabled={changing}
          onClick={() => void change()}
          className={`${primaryButtonClass} min-h-touch-target self-start`}
        >
          {t("change")}
        </button>
      </Dialog>

      <section aria-labelledby="order-inbox-help" className={cardClass}>
        <h3 id="order-inbox-help" className={subTitleClass}>
          {t("helpTitle")}
        </h3>
        <p className="text-sm">{t("helpRule")}</p>
        <div className="flex flex-col gap-space-2">
          {mailboxHelp(inbox.autoForward, code !== null).map((mailbox) => (
            <Mailbox
              key={mailbox.name}
              name={tKey(mailbox.name)}
              one={tKey(mailbox.one)}
              auto={mailbox.auto?.map((key) => tKey(key, { code: code ?? "" })) ?? null}
            />
          ))}
        </div>
      </section>

      <Link href="/mes-commandes" className={linkClass}>
        {t("ordersLink")}
      </Link>
    </Shell>
  );
}
