"use client";

import { type SenderAddressList, type SenderAddressView, senderEmailSchema } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  addSenderAddress,
  fetchSenderAddresses,
  removeSenderAddress,
  resendSenderCode,
  verifySenderAddress,
} from "@/lib/orders-client";
import type { ClientError } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const cardClass = "flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4";
const chipClass = "self-start rounded-pill px-space-2 py-space-0-5 text-chip font-bold";
const rowClass = "flex flex-col gap-space-2 rounded-card bg-surface-sunken px-space-4 py-space-3";

/** The errors this section says in words; anything else is « Ça n'a pas marché ». */
const SAID = new Set<string>([
  "sender_exists",
  "sender_limit",
  "rate_limited",
  "mail_failed",
  "code_wrong",
  "code_expired",
  "code_locked",
]);
type Said = "invalidEmail" | "invalidCode" | "failed" | ClientError;
const said = (error: ClientError): Said => (SAID.has(error) ? error : "failed");

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; list: SenderAddressList };

/** One added address waiting for its code: the code field, « Valider », « Renvoyer le code ». */
function CodeForm({
  address,
  onVerified,
  onStatus,
  autoFocus,
}: {
  address: SenderAddressView;
  onVerified: (view: SenderAddressView) => void;
  onStatus: (message: string) => void;
  autoFocus: boolean;
}) {
  const t = useTranslations("Orders.inbox.senders");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Said | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ids = { code: useId(), hint: useId(), error: useId() };

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("invalidCode");
    setBusy(true);
    setError(null);
    const result = await verifySenderAddress(address.id, code);
    setBusy(false);
    if (!result.ok) return setError(result.error === "invalid_request" ? "invalidCode" : said(result.error));
    onVerified({ id: result.id, email: result.email, verified: result.verified, createdAt: result.createdAt });
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    const result = await resendSenderCode(address.id);
    setBusy(false);
    if (!result.ok) return setError(said(result.error));
    setCode("");
    onStatus(t("resent", { email: address.email }));
    input.current?.focus();
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-space-2">
      <label htmlFor={ids.code} className="text-sm font-strong">
        {t("codeLabel", { email: address.email })}
      </label>
      <input
        ref={input}
        id={ids.code}
        name="code"
        type="text"
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-invalid={error === "invalidCode" || error === "code_wrong" || undefined}
        aria-describedby={[ids.hint, error ? ids.error : ""].filter(Boolean).join(" ")}
        className={`${inputClass} min-h-touch-target max-w-search tabular-nums`}
      />
      <p id={ids.hint} className="text-sm text-ink-muted">
        {t("codeHint")}
      </p>
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-danger">
          {t(`errors.${error}` as "errors.failed")}
        </p>
      )}
      <div className="flex flex-wrap gap-space-2">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
          {t("verify")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resend()}
          className={`${buttonClass} min-h-touch-target`}
        >
          {t("resend")}
        </button>
      </div>
    </form>
  );
}

/**
 * « Mes adresses d'envoi » (spec §11): her account address (always read, not removable), the addresses she added with
 * their state, « Ajouter une adresse » (a 6-digit code by e-mail, typed back here), « Renvoyer le code », « Retirer »
 * (asked first). Only shown while e-mails are received here.
 */
export function OrderSenderAddresses() {
  const t = useTranslations("Orders.inbox.senders");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  /** The pending address whose code field is open (the one just added, or « Saisir le code »). */
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SenderAddressView | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const ids = { title: useId(), email: useId(), hint: useId(), error: useId() };

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, and on « Réessayer ».
  useEffect(() => {
    let alive = true;
    fetchSenderAddresses().then(
      (list) => alive && setState(list === "guest" ? { kind: "failed" } : { kind: "ready", list }),
      () => alive && setState({ kind: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (adding) emailInput.current?.focus();
  }, [adding]);

  const shell = (children: ReactNode) => (
    <section aria-labelledby={ids.title} className={cardClass} data-testid="sender-addresses">
      <h3 id={ids.title} className="font-display text-lead font-strong">
        {t("title")}
      </h3>
      <p className="text-sm">{t("intro")}</p>
      {children}
    </section>
  );

  if (state.kind === "loading") return shell(<p role="status">{t("loading")}</p>);
  if (state.kind === "failed") {
    return shell(
      <>
        <p role="alert" className="text-danger">
          {t("failed")}
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
          className={`${buttonClass} min-h-touch-target self-start`}
        >
          {t("retry")}
        </button>
      </>,
    );
  }

  const { list } = state;
  const full = list.addresses.length + 1 >= list.max;
  const replace = (addresses: SenderAddressView[]) => setState({ kind: "ready", list: { ...list, addresses } });

  const reload = async () => {
    const fresh = await fetchSenderAddresses().catch(() => null);
    if (fresh && fresh !== "guest") setState({ kind: "ready", list: fresh });
    return fresh && fresh !== "guest" ? fresh : null;
  };

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = senderEmailSchema.safeParse(email);
    if (!parsed.success) return setAddError("invalidEmail");
    setBusy(true);
    setAddError(null);
    const result = await addSenderAddress(parsed.data);
    setBusy(false);
    if (!result.ok) {
      if (result.error === "invalid_request") return setAddError("invalidEmail");
      setAddError(said(result.error));
      // The address was kept although its e-mail did not leave: shown, its code field open for « Renvoyer le code ».
      if (result.error === "mail_failed") {
        const fresh = await reload();
        const kept = fresh?.addresses.find((a) => a.email === parsed.data);
        if (kept) {
          setAdding(false);
          setEmail("");
          setOpen(kept.id);
          setStatus(t("errors.mail_failed"));
        }
      }
      return;
    }
    const view = { id: result.id, email: result.email, verified: result.verified, createdAt: result.createdAt };
    replace([...list.addresses, view]);
    setAdding(false);
    setEmail("");
    setOpen(view.id);
    setStatus(t("sent", { email: view.email }));
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveFailed(false);
    const result = await removeSenderAddress(removing.id);
    setBusy(false);
    if (!result.ok && result.error !== "not_found") return setRemoveFailed(true);
    replace(list.addresses.filter((a) => a.id !== removing.id));
    setRemoving(null);
    setStatus(t("removed"));
    addButton.current?.focus();
  };

  return shell(
    <>
      <ul className="flex flex-col gap-space-2">
        {list.accountEmail && (
          <li className={rowClass}>
            <span className="font-strong wrap-break-word">{list.accountEmail}</span>
            <span className={`${chipClass} bg-surface-raised text-ink`}>{t("account")}</span>
          </li>
        )}
        {list.addresses.map((address) => (
          <li key={address.id} className={rowClass} data-testid="sender-address">
            <span className="font-strong wrap-break-word">{address.email}</span>
            <span className={`${chipClass} ${address.verified ? "bg-hint text-ink" : "bg-une text-une-ink"}`}>
              {address.verified ? t("verified") : t("pending")}
            </span>
            {!address.verified && open === address.id && (
              <CodeForm
                address={address}
                autoFocus
                onStatus={setStatus}
                onVerified={(view) => {
                  replace(list.addresses.map((a) => (a.id === view.id ? view : a)));
                  setOpen(null);
                  setStatus(t("done", { email: view.email }));
                }}
              />
            )}
            <div className="flex flex-wrap gap-space-2">
              {!address.verified && open !== address.id && (
                <button
                  type="button"
                  onClick={() => setOpen(address.id)}
                  className={`${buttonClass} min-h-touch-target`}
                >
                  {t("enterCode")}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRemoveFailed(false);
                  setRemoving(address);
                }}
                aria-label={`${t("remove")} ${address.email}`}
                className={`${buttonClass} min-h-touch-target`}
              >
                {t("remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p role="status" className="text-sm empty:hidden">
        {status}
      </p>

      {full ? (
        <p className="text-sm text-ink-muted">{t("limit", { max: list.max })}</p>
      ) : adding ? (
        <form noValidate onSubmit={(e) => void submitAdd(e)} className="flex flex-col gap-space-2">
          <label htmlFor={ids.email} className="text-sm font-strong">
            {t("emailLabel")}
          </label>
          <input
            ref={emailInput}
            id={ids.email}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={addError === "invalidEmail" || addError === "sender_exists" || undefined}
            aria-describedby={[ids.hint, addError ? ids.error : ""].filter(Boolean).join(" ")}
            className={`${inputClass} min-h-touch-target`}
          />
          <p id={ids.hint} className="text-sm text-ink-muted">
            {t("emailHint")}
          </p>
          {addError && (
            <p id={ids.error} role="alert" className="text-sm text-danger">
              {t(`errors.${addError}` as "errors.failed", { max: list.max })}
            </p>
          )}
          <div className="flex flex-wrap gap-space-2">
            <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
              {t("sendCode")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddError(null);
                setEmail("");
              }}
              className={`${buttonClass} min-h-touch-target`}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={addButton}
          type="button"
          onClick={() => {
            setStatus("");
            setAdding(true);
          }}
          className={`${buttonClass} min-h-touch-target self-start`}
        >
          {t("add")}
        </button>
      )}

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("removeTitle")}
        closeLabel={t("cancel")}
      >
        <p>{t("removeBody", { email: removing?.email ?? "" })}</p>
        {removeFailed && (
          <p role="alert" className="text-sm text-danger">
            {t("errors.failed")}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className={`${primaryButtonClass} min-h-touch-target self-start`}
        >
          {t("remove")}
        </button>
      </Dialog>
    </>,
  );
}
