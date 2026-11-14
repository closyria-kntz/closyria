import { createAuthClient, ensureSession } from "@closyria/auth/client";
import {
  type AlertPage,
  type AlertSettings,
  type AlertSettingsPatch,
  alertPageSchema,
  alertReadResultSchema,
  alertSettingsSchema,
  DEFAULT_ALERT_SETTINGS,
  type PushSubscriptionView,
  pushKeySchema,
  pushSubscriptionListSchema,
  pushSubscriptionViewSchema,
} from "@closyria/shared";
import { type ZodType, z } from "zod";
import type { ClientDeps } from "./catalog-client";
import { phoneKind } from "./phone-kind";

/** Where the service worker lives; its scope is the whole site. */
export const SERVICE_WORKER_URL = "/sw.js";

const defaultDeps: ClientDeps = {
  fetch: (...args) => fetch(...args),
  ensure: () => ensureSession(createAuthClient(window.location.origin)),
};

// --- can this browser receive notifications? ---

/** What the page knows of the browser, read once (`readPushEnvironment`). */
export type PushEnvironment = {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** Opened from the home screen (an installed app), not from a browser tab. */
  standalone: boolean;
};

/**
 * `supported`: « Activer les notifications » works. `iphone_home_screen`: an iPhone or iPad in a Safari tab, where
 * notifications only exist once Closyria is added to the home screen (no `PushManager` in the tab).
 * `unsupported`: this browser cannot receive them at all.
 */
export type PushSupport = "supported" | "iphone_home_screen" | "unsupported";

export function pushSupport(env: PushEnvironment): PushSupport {
  if (env.serviceWorker && env.pushManager && env.notification) return "supported";
  if (phoneKind(env.userAgent, env.maxTouchPoints) === "iphone" && !env.standalone) return "iphone_home_screen";
  return "unsupported";
}

export function readPushEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
  };
}

/** The VAPID public key (unpadded base64url) as the bytes `pushManager.subscribe` wants. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type DeviceKind = "iphone" | "ipad" | "android" | "mac" | "windows" | "linux";
export type BrowserKind = "safari" | "chrome" | "firefox" | "edge" | "samsung";

/** One of her devices in words (« Chrome sur Mac »), from the User-Agent the API kept; null parts are unknown. */
export function deviceOf(userAgent: string | null): { device: DeviceKind | null; browser: BrowserKind | null } {
  const ua = userAgent ?? "";
  const device: DeviceKind | null = /iPhone|iPod/.test(ua)
    ? "iphone"
    : /iPad/.test(ua)
      ? "ipad"
      : /Android/i.test(ua)
        ? "android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "mac"
          : /Windows/.test(ua)
            ? "windows"
            : /Linux|X11/.test(ua)
              ? "linux"
              : null;
  const browser: BrowserKind | null = /Edg(e|A|iOS)?\//.test(ua)
    ? "edge"
    : /SamsungBrowser\//.test(ua)
      ? "samsung"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "chrome"
          : /Safari\//.test(ua)
            ? "safari"
            : null;
  return { device, browser };
}

// --- the browser's side of a subscription (injected in tests) ---

type SubscriptionLike = { toJSON(): unknown; unsubscribe(): Promise<boolean> };
type PushManagerLike = {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<SubscriptionLike>;
};

export type PushBrowser = {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  /** Registers the service worker (scope `/`) and waits for it to be ready. */
  register(): Promise<{ pushManager: PushManagerLike }>;
  /** The registration already there, without registering anything. */
  existing(): Promise<{ pushManager: PushManagerLike } | null>;
};

export const browserPush: PushBrowser = {
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  register: async () => {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    return await navigator.serviceWorker.ready;
  },
  existing: async () => (await navigator.serviceWorker.getRegistration("/")) ?? null,
};

/** Whether this browser already sends her notifications (allowed, and subscribed). Never throws. */
export async function isThisDeviceOn(browser: PushBrowser = browserPush): Promise<boolean> {
  try {
    if (browser.permission() !== "granted") return false;
    const registration = await browser.existing();
    return (await registration?.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

/**
 * `dismissed`: she closed the browser's question without answering (the permission is still `default`), which is not
 * a refusal: « Activer » stays, and asking again works.
 */
export type EnableError = "denied" | "dismissed" | "account_required" | "failed";
/** On success, `userId` is the account it was turned on for (kept with the id, see `StoredDevice`). */
export type EnableResult =
  | { ok: true; device: PushSubscriptionView; userId: string }
  | { ok: false; error: EnableError };

/**
 * « Activer les notifications »: the browser's permission first (asked right away, while her tap still counts),
 * then the service worker, the browser's subscription with `publicKey`, and the API keeps this device.
 */
export async function enableNotifications(
  publicKey: string,
  browser: PushBrowser = browserPush,
  deps: ClientDeps = defaultDeps,
): Promise<EnableResult> {
  try {
    let permission = browser.permission();
    if (permission === "default") permission = await browser.requestPermission();
    if (permission === "default") return { ok: false, error: "dismissed" };
    if (permission !== "granted") return { ok: false, error: "denied" };
    const registration = await browser.register();
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      }));
    await deps.ensure();
    const me = await fetchCurrentUser(deps);
    const response = await postSubscription(subscription, deps);
    if (response.status === 403) {
      // A guest: nothing stays subscribed for an account she does not have yet.
      await subscription.unsubscribe().catch(() => false);
      return { ok: false, error: "account_required" };
    }
    if (!response.ok || !me) return { ok: false, error: "failed" };
    const device = pushSubscriptionViewSchema.safeParse(await response.json());
    return device.success ? { ok: true, device: device.data, userId: me.id } : { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}

function postSubscription(subscription: SubscriptionLike, deps: ClientDeps): Promise<Response> {
  return deps.fetch("/api/me/push-subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
}

// --- the id the API gave this browser's subscription ---

/** « Cet appareil » in the list; « Retirer » and « Se déconnecter » unsubscribe it. */
export const DEVICE_ID_KEY = "closyria.push.deviceId";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const localStore = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * What this browser remembers of its subscription: the id the API gave it and the account it was turned on for
 * (`userId` null: unknown, as in the first format, a plain id).
 */
export type StoredDevice = { id: string | null; userId: string | null };
const storedDeviceSchema = z.object({ id: z.string().min(1).nullable(), userId: z.string().min(1).nullable() });

export function readStoredDevice(storage: StorageLike | null = localStore()): StoredDevice | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(DEVICE_ID_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = storedDeviceSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {}
  // The first format: the id alone, its account unknown.
  return { id: raw, userId: null };
}

export function writeStoredDevice(value: StoredDevice | null, storage: StorageLike | null = localStore()): void {
  try {
    if (value) storage?.setItem(DEVICE_ID_KEY, JSON.stringify(value));
    else storage?.removeItem(DEVICE_ID_KEY);
  } catch {}
}

/** The id of this browser's subscription, whoever it belongs to (null when unknown). */
export function readDeviceId(storage: StorageLike | null = localStore()): string | null {
  return readStoredDevice(storage)?.id ?? null;
}

const sessionSchema = z
  .object({ user: z.object({ id: z.string().min(1), isAnonymous: z.boolean().nullish() }) })
  .nullable();

/**
 * Who is signed in on this browser: her user id, `guest` for a session without an account, null without a session.
 * Throws when it cannot be told (offline, server error): nothing is decided on a guess.
 */
export async function fetchCurrentUser(deps: ClientDeps = defaultDeps): Promise<{ id: string; guest: boolean } | null> {
  const response = await deps.fetch("/api/auth/get-session", { cache: "no-store" });
  if (!response.ok) throw new Error(`session ${response.status}`);
  const session = sessionSchema.parse(await response.json());
  return session ? { id: session.user.id, guest: session.user.isAnonymous === true } : null;
}

async function browserSubscription(browser: PushBrowser): Promise<SubscriptionLike | null> {
  return (await (await browser.existing())?.pushManager.getSubscription()) ?? null;
}

/** Per browser session (tab): the account whose device the API was last seen to know, so it is asked once. */
export const DEVICE_CHECKED_KEY = "closyria.push.checkedFor";

const sessionStore = (): StorageLike | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

function readCheckedFor(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(DEVICE_CHECKED_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeCheckedFor(userId: string | null, storage: StorageLike | null): void {
  try {
    if (userId) storage?.setItem(DEVICE_CHECKED_KEY, userId);
    else storage?.removeItem(DEVICE_CHECKED_KEY);
  } catch {}
}

/**
 * This browser stops receiving: its subscription is dropped (the endpoint dies; the API removes its row at the push
 * service's next 410, if it still has one) and its stored id is cleared. Never throws.
 */
export async function dropThisDevice(
  browser: PushBrowser = browserPush,
  storage: StorageLike | null = localStore(),
  session: StorageLike | null = sessionStore(),
): Promise<void> {
  writeStoredDevice(null, storage);
  writeCheckedFor(null, session);
  try {
    await (await browserSubscription(browser))?.unsubscribe();
  } catch {}
}

/**
 * `none`: not subscribed. `dropped`: the browser was unsubscribed. `kept`: hers, and the API still knows it.
 * `unknown`: could not tell, nothing changed.
 */
export type DeviceCheck = "none" | "dropped" | "kept" | "unknown";

/**
 * On app pages (the shell) and before « Notifications » reads her devices; it only ever unsubscribes (turning them
 * back on is « Activer », a tap of hers). Dropped: a subscription kept for another account, an unknown one (the
 * first format, or a lost id), or while she is a guest or signed out (a shared browser left without « Se
 * déconnecter »); and hers when the API no longer knows its id (« Retirer » from another device sticks). Her devices
 * are asked once per browser session and account (`DEVICE_CHECKED_KEY`); the session, on every check, only when the
 * browser is subscribed. Never asks the browser's permission. Never throws.
 */
export async function checkThisDevice(
  browser: PushBrowser = browserPush,
  deps: ClientDeps = defaultDeps,
  storage: StorageLike | null = localStore(),
  session: StorageLike | null = sessionStore(),
): Promise<DeviceCheck> {
  let subscription: SubscriptionLike | null;
  try {
    subscription = await browserSubscription(browser);
  } catch {
    return "unknown";
  }
  if (!subscription) return "none";
  let me: { id: string; guest: boolean } | null;
  try {
    me = await fetchCurrentUser(deps);
  } catch {
    return "unknown";
  }
  const stored = readStoredDevice(storage);
  if (me && !me.guest && stored?.id && stored.userId === me.id) {
    if (readCheckedFor(session) === me.id) return "kept";
    let devices: PushSubscriptionView[];
    try {
      devices = await fetchDevices(deps);
    } catch {
      return "unknown";
    }
    if (devices.some((d) => d.id === stored.id)) {
      writeCheckedFor(me.id, session);
      return "kept";
    }
  }
  await dropThisDevice(browser, storage, session);
  return "dropped";
}

let checkedOnce: Promise<DeviceCheck> | null = null;

/** `checkThisDevice` once per page load, shared by the app shell and « Notifications ». */
export function checkThisDeviceOnce(): Promise<DeviceCheck> {
  checkedOnce ??= checkThisDevice();
  return checkedOnce;
}

/**
 * Before « Se déconnecter » (the session is still there): the API forgets this device when its id is known, and the
 * browser drops its subscription in every case, so the next person on this device gets nothing of hers. True when
 * notifications were on here (an id or a subscription). Never throws.
 */
export async function forgetThisDevice(
  browser: PushBrowser = browserPush,
  deps: ClientDeps = defaultDeps,
  storage: StorageLike | null = localStore(),
): Promise<boolean> {
  const id = readDeviceId(storage);
  if (id) {
    try {
      await deps.fetch(`/api/me/push-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {}
  }
  writeStoredDevice(null, storage);
  writeCheckedFor(null, sessionStore());
  let subscribed = false;
  try {
    const subscription = await browserSubscription(browser);
    subscribed = subscription !== null;
    await subscription?.unsubscribe();
  } catch {}
  return id !== null || subscribed;
}

// --- the API ---

async function read<T>(deps: ClientDeps, path: string, schema: ZodType<T>, signedOut: T): Promise<T> {
  const response = await deps.fetch(path, { cache: "no-store" });
  if (response.status === 401) return signedOut;
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return schema.parse(await response.json());
}

/** The VAPID public key, or null when notifications are off on this server. Throws on failure. */
export async function fetchPushKey(deps: ClientDeps = defaultDeps): Promise<string | null> {
  const response = await deps.fetch("/api/push/key", { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`push key ${response.status}`);
  return pushKeySchema.parse(await response.json()).publicKey;
}

/** Her devices that receive notifications, newest first (none without a session). Throws on failure. */
export async function fetchDevices(deps: ClientDeps = defaultDeps): Promise<PushSubscriptionView[]> {
  return (await read(deps, "/api/me/push-subscriptions", pushSubscriptionListSchema, { subscriptions: [] }))
    .subscriptions;
}

/** « Retirer » one of her devices; true when it is gone (or was already). */
export async function removeDevice(id: string, deps: ClientDeps = defaultDeps): Promise<boolean> {
  try {
    await deps.ensure();
    const response = await deps.fetch(`/api/me/push-subscriptions/${id}`, { method: "DELETE" });
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

/** Her notification settings (the defaults without a session). Throws on failure. */
export async function fetchAlertSettings(deps: ClientDeps = defaultDeps): Promise<AlertSettings> {
  return await read(deps, "/api/me/alert-settings", alertSettingsSchema, DEFAULT_ALERT_SETTINGS);
}

export type SettingsResult = { ok: true; settings: AlertSettings } | { ok: false; error: EnableError };

export async function patchAlertSettings(
  patch: AlertSettingsPatch,
  deps: ClientDeps = defaultDeps,
): Promise<SettingsResult> {
  try {
    await deps.ensure();
    const response = await deps.fetch("/api/me/alert-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (response.status === 403) return { ok: false, error: "account_required" };
    if (!response.ok) return { ok: false, error: "failed" };
    const settings = alertSettingsSchema.safeParse(await response.json());
    return settings.success ? { ok: true, settings: settings.data } : { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** One page of « Nouvelles » (none without a session). Throws on failure. */
export async function fetchAlerts(cursor: string | null, deps: ClientDeps = defaultDeps): Promise<AlertPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return await read(deps, `/api/me/alerts${query}`, alertPageSchema, { alerts: [], nextCursor: null });
}

/** Marks these alerts as read; never throws (a failed mark only leaves them « Nouveau » next time). */
export async function markAlertsRead(ids: readonly string[], deps: ClientDeps = defaultDeps): Promise<void> {
  if (ids.length === 0) return;
  try {
    const response = await deps.fetch("/api/me/alerts/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (response.ok) alertReadResultSchema.parse(await response.json());
  } catch {}
}
