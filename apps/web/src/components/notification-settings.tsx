"use client";

import { type AlertSettings, DIGEST_HOUR_MAX, DIGEST_HOUR_MIN, type PushSubscriptionView } from "@closyria/shared";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { useAccount } from "@/lib/profile-context";
import {
  browserPush,
  checkThisDeviceOnce,
  deviceOf,
  enableNotifications,
  fetchAlertSettings,
  fetchDevices,
  fetchPushKey,
  isThisDeviceOn,
  patchAlertSettings,
  pushSupport,
  readDeviceId,
  readPushEnvironment,
  removeDevice,
  writeStoredDevice,
} from "@/lib/push";
import { Switch } from "./switch";
import { Tick } from "./tick";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "./ui";

const HERE = "/reglages/notifications";
const HOURS = Array.from({ length: DIGEST_HOUR_MAX - DIGEST_HOUR_MIN + 1 }, (_, i) => DIGEST_HOUR_MIN + i);
const SWITCHES = ["sizeBack", "targetPrice", "digest"] as const;

const cardClass = "flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4";
const subTitleClass = "font-display text-lead font-strong";
const linkClass = `inline-flex min-h-touch-target items-center self-start rounded-button text-sm font-strong text-accent underline underline-offset-4 ${focusRing}`;

/** This browser: what it can do, and whether it already receives her notifications. */
type DeviceState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "iphone" }
  | { kind: "off" }
  | { kind: "denied" }
  | { kind: "ready"; publicKey: string }
  | { kind: "on" };

type Loaded = { settings: AlertSettings; devices: PushSubscriptionView[]; device: DeviceState };

async function loadAll(): Promise<Loaded> {
  const support = pushSupport(readPushEnvironment());
  // A subscription left by another account goes first; hers is re-attached when its id is unknown.
  if (support === "supported") await checkThisDeviceOnce();
  const [settings, devices, publicKey] = await Promise.all([fetchAlertSettings(), fetchDevices(), fetchPushKey()]);
  let device: DeviceState;
  if (support === "iphone_home_screen") device = { kind: "iphone" };
  else if (support === "unsupported") device = { kind: "unsupported" };
  else if (publicKey === null) device = { kind: "off" };
  else if (Notification.permission === "denied") device = { kind: "denied" };
  else {
    // Subscribed in the browser, and one of her devices (she may have removed it from another one).
    const mine = readDeviceId();
    const on = (await isThisDeviceOn()) && devices.some((d) => d.id === mine);
    device = on ? { kind: "on" } : { kind: "ready", publicKey };
  }
  return { settings, devices, device };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cardClass}>
      <h3 id={id} className={subTitleClass}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Compte → Notifications (chantier 4 « Alertes », spec §3.1): « Activer les notifications » on this device (a guest
 * first creates her account; an iPhone in a Safari tab is sent to the home screen help; a refusal says what to do),
 * what she receives (« Ta taille est revenue », « Prix visé atteint », « Résumé du jour » and its hour), and her
 * devices with « Retirer ». Whatever happens here, her news stay on « Accueil » and « Nouvelles ».
 */
export function NotificationSettings() {
  const t = useTranslations("Notifications");
  const format = useFormatter();
  const account = useAccount();
  const guest = account !== null && account.email === null;
  const [data, setData] = useState<Loaded | "loading" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [enabling, setEnabling] = useState(false);
  const [deviceError, setDeviceError] = useState<"failed" | "accountRequired" | "dismissed" | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [status, setStatus] = useState("");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const hourId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once she is known to have an account, and on « Réessayer ».
  useEffect(() => {
    if (account === null || guest) return;
    let alive = true;
    setData("loading");
    loadAll().then(
      (loaded) => {
        if (!alive) return;
        setDeviceId(readDeviceId());
        setData(loaded);
      },
      () => alive && setData("failed"),
    );
    return () => {
      alive = false;
    };
  }, [account === null, guest, attempt]);

  const update = useCallback((change: (loaded: Loaded) => Loaded) => {
    setData((current) => (typeof current === "string" ? current : change(current)));
  }, []);

  if (account === null) return <p role="status">{t("loading")}</p>;

  if (guest) {
    return (
      <Shell intro={t("intro")} title={t("title")}>
        <section aria-labelledby="notifications-guest" className={`${cardClass} bg-hint`}>
          <h3 id="notifications-guest" className={subTitleClass}>
            {t("guestTitle")}
          </h3>
          <p>{t("guestBody")}</p>
          <Link
            href={`/connexion?next=${encodeURIComponent(HERE)}`}
            className={`${primaryButtonClass} min-h-touch-target self-start`}
          >
            {t("createAccount")}
          </Link>
          <p className="text-sm text-ink-muted">{t("device.keepNews")}</p>
        </section>
      </Shell>
    );
  }

  if (data === "loading") {
    return (
      <Shell intro={t("intro")} title={t("title")}>
        <p role="status">{t("loading")}</p>
      </Shell>
    );
  }
  if (data === "failed") {
    return (
      <Shell intro={t("intro")} title={t("title")}>
        <p role="alert" className="text-danger">
          {t("loadFailed")}
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

  const { settings, devices, device } = data;

  const enable = async () => {
    if (device.kind !== "ready") return;
    setEnabling(true);
    setDeviceError(null);
    const result = await enableNotifications(device.publicKey);
    setEnabling(false);
    if (result.ok) {
      writeStoredDevice({ id: result.device.id, userId: result.userId });
      setDeviceId(result.device.id);
      update((loaded) => ({
        ...loaded,
        device: { kind: "on" },
        devices: [result.device, ...loaded.devices.filter((d) => d.id !== result.device.id)],
      }));
      return;
    }
    if (result.error === "denied") update((loaded) => ({ ...loaded, device: { kind: "denied" } }));
    else setDeviceError(result.error === "account_required" ? "accountRequired" : result.error);
  };

  const change = async (patch: Partial<AlertSettings>) => {
    const before = settings;
    setSettingsError(false);
    update((loaded) => ({ ...loaded, settings: { ...loaded.settings, ...patch } }));
    const result = await patchAlertSettings(patch);
    if (result.ok) {
      update((loaded) => ({ ...loaded, settings: result.settings }));
      setStatus(t("what.saved"));
    } else {
      update((loaded) => ({ ...loaded, settings: before }));
      setSettingsError(true);
    }
  };

  const nameOf = (view: PushSubscriptionView) => {
    const { device: kind, browser } = deviceOf(view.userAgent);
    if (kind && browser) {
      return t("devices.name", { browser: t(`devices.browser.${browser}`), device: t(`devices.kind.${kind}`) });
    }
    if (kind) return t(`devices.kind.${kind}`);
    if (browser) return t(`devices.browser.${browser}`);
    return t("devices.unknown");
  };

  const remove = async (view: PushSubscriptionView) => {
    const name = nameOf(view);
    if (!(await removeDevice(view.id))) {
      setStatus(t("devices.removeFailed"));
      return;
    }
    const mine = view.id === deviceId;
    if (mine) {
      // This browser: it stops receiving, and « Activer les notifications » comes back.
      writeStoredDevice(null);
      setDeviceId(null);
      await (await browserPush.existing().catch(() => null))?.pushManager
        .getSubscription()
        .then((s) => s?.unsubscribe())
        .catch(() => false);
    }
    const publicKey = mine ? await fetchPushKey().catch(() => null) : null;
    update((loaded) => ({
      ...loaded,
      devices: loaded.devices.filter((d) => d.id !== view.id),
      device: mine && publicKey ? { kind: "ready", publicKey } : loaded.device,
    }));
    setStatus(t("devices.removed", { name }));
  };

  return (
    <Shell intro={t("intro")} title={t("title")}>
      <Section title={t("device.title")}>
        {device.kind === "on" ? (
          <p className="flex items-center gap-space-2 font-strong">
            <Tick />
            {t("device.on")}
          </p>
        ) : device.kind === "ready" ? (
          <>
            <button
              type="button"
              disabled={enabling}
              onClick={() => void enable()}
              className={`${primaryButtonClass} min-h-touch-target self-start`}
            >
              {enabling ? t("device.enabling") : t("device.enable")}
            </button>
            <p className="text-sm text-ink-muted">{t("device.enableHint")}</p>
            {deviceError && (
              <p role="alert" className="text-sm text-danger">
                {t(`device.${deviceError}`)}
              </p>
            )}
          </>
        ) : device.kind === "iphone" ? (
          <>
            <p className="font-strong">{t("device.iphoneTitle")}</p>
            <p>{t("device.iphoneBody")}</p>
            <Link href="/aide/iphone" className={`${primaryButtonClass} min-h-touch-target self-start`}>
              {t("device.iphoneLink")}
            </Link>
          </>
        ) : (
          <p role={device.kind === "denied" ? "alert" : undefined}>
            {t(`device.${device.kind === "loading" ? "unsupported" : device.kind}`)}
          </p>
        )}
        {device.kind !== "on" && device.kind !== "ready" && (
          <p className="text-sm text-ink-muted">{t("device.keepNews")}</p>
        )}
      </Section>

      <Section title={t("what.title")}>
        <div className="flex flex-col gap-space-2">
          {SWITCHES.map((key) => (
            <Switch
              key={key}
              label={t(`what.${key}`)}
              hint={t(`what.${key}Hint`)}
              on={settings[key]}
              onToggle={() => void change({ [key]: !settings[key] })}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-space-3">
          <label htmlFor={hourId} className="text-sm font-strong">
            {t("what.digestHour")}
          </label>
          <select
            id={hourId}
            value={settings.digestHour}
            disabled={!settings.digest}
            onChange={(event) => void change({ digestHour: Number(event.target.value) })}
            className={`${inputClass} min-h-touch-target w-auto disabled:opacity-60`}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {t("what.hour", { hour })}
              </option>
            ))}
          </select>
        </div>
        {settingsError && (
          <p role="alert" className="text-sm text-danger">
            {t("what.saveFailed")}
          </p>
        )}
      </Section>

      <Section title={t("devices.title")}>
        <p className="text-sm text-ink-muted">{t("devices.intro")}</p>
        {devices.length === 0 ? (
          <p>{t("devices.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-space-2">
            {devices.map((view) => {
              const name = nameOf(view);
              return (
                <li
                  key={view.id}
                  className="flex flex-wrap items-center justify-between gap-space-3 rounded-card bg-surface-sunken px-space-4 py-space-2"
                >
                  <span className="flex min-w-space-0 flex-col gap-space-0-5">
                    <span className="font-strong">
                      {name}
                      {view.id === deviceId && (
                        <span className="font-normal text-ink-muted"> · {t("devices.this")}</span>
                      )}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {t("devices.added", {
                        date: format.dateTime(new Date(view.createdAt), { day: "numeric", month: "long" }),
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={t("devices.removeLabel", { name })}
                    onClick={() => void remove(view)}
                    className={`${buttonClass} min-h-touch-target`}
                  >
                    {t("devices.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <p role="status" className="text-sm">
        {status}
      </p>
      <Link href="/nouvelles" className={linkClass}>
        {t("news")}
      </Link>
    </Shell>
  );
}

function Shell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby="notifications-title" className="flex max-w-measure flex-col gap-space-4">
      <h2 id="notifications-title" className="font-display text-lead font-strong">
        {title}
      </h2>
      <p>{intro}</p>
      {children}
    </section>
  );
}
