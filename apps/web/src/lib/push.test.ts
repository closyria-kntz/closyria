import { describe, expect, it, vi } from "vitest";
import {
  applicationServerKey,
  checkThisDevice,
  DEVICE_CHECKED_KEY,
  deviceOf,
  dropThisDevice,
  enableNotifications,
  fetchAlertSettings,
  fetchAlerts,
  fetchDevices,
  fetchPushKey,
  forgetThisDevice,
  isThisDeviceOn,
  markAlertsRead,
  type PushBrowser,
  type PushEnvironment,
  patchAlertSettings,
  pushSupport,
  readDeviceId,
  readStoredDevice,
  removeDevice,
  writeStoredDevice,
} from "./push";

const id = "00000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deps = (response: Response) => ({ fetch: vi.fn(async () => response), ensure: vi.fn(async () => {}) });
const USER = "user-a";
const session = (userId: string | null, isAnonymous = false) =>
  json(userId === null ? null : { session: { id: "s" }, user: { id: userId, isAnonymous } });
/** `response` for every call, except the session (`/api/auth/get-session`) and her devices when given. */
const withSession = (response: Response, who: Response = session(USER), devices?: Response) => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/api/auth/get-session") return who;
    if (devices && input === "/api/me/push-subscriptions" && !init?.method) return devices;
    return response;
  }),
  ensure: vi.fn(async () => {}),
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const PIXEL_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

const env = (over: Partial<PushEnvironment> = {}): PushEnvironment => ({
  serviceWorker: true,
  pushManager: true,
  notification: true,
  userAgent: MAC_SAFARI,
  maxTouchPoints: 0,
  standalone: false,
  ...over,
});

describe("pushSupport", () => {
  it("is supported when the service worker, PushManager and Notification are all there", () => {
    expect(pushSupport(env())).toBe("supported");
    expect(pushSupport(env({ userAgent: IPHONE, standalone: true }))).toBe("supported");
  });

  it("sends an iPhone or iPad in a Safari tab (no PushManager) to the home screen help", () => {
    expect(pushSupport(env({ userAgent: IPHONE, pushManager: false, notification: false }))).toBe("iphone_home_screen");
    // An iPad says it is a Mac; its touch points tell it apart.
    expect(pushSupport(env({ userAgent: MAC_SAFARI, maxTouchPoints: 5, pushManager: false }))).toBe(
      "iphone_home_screen",
    );
  });

  it("is unsupported elsewhere, and on an iPhone already on the home screen without push (too old)", () => {
    expect(pushSupport(env({ pushManager: false }))).toBe("unsupported");
    expect(pushSupport(env({ serviceWorker: false, userAgent: PIXEL_CHROME }))).toBe("unsupported");
    expect(pushSupport(env({ userAgent: IPHONE, pushManager: false, standalone: true }))).toBe("unsupported");
  });
});

describe("applicationServerKey", () => {
  it("decodes unpadded base64url", () => {
    expect([...applicationServerKey("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
    expect(applicationServerKey(`B${"A".repeat(86)}`)).toHaveLength(65);
  });
});

describe("deviceOf", () => {
  it("names the device and the browser", () => {
    expect(deviceOf(IPHONE)).toEqual({ device: "iphone", browser: "safari" });
    expect(deviceOf(MAC_SAFARI)).toEqual({ device: "mac", browser: "safari" });
    expect(deviceOf(PIXEL_CHROME)).toEqual({ device: "android", browser: "chrome" });
    expect(deviceOf(WINDOWS_EDGE)).toEqual({ device: "windows", browser: "edge" });
    expect(deviceOf(LINUX_FIREFOX)).toEqual({ device: "linux", browser: "firefox" });
  });

  it("knows nothing of an unknown or missing agent", () => {
    expect(deviceOf(null)).toEqual({ device: null, browser: null });
    expect(deviceOf("curl/8.0")).toEqual({ device: null, browser: null });
  });
});

const subscriptionJson = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } };
const device = { id, userAgent: "Chrome", createdAt: "2026-11-14T10:00:00.000Z", lastOkAt: null };

function fakeBrowser(permission: NotificationPermission, answer: NotificationPermission = permission) {
  const subscription = { toJSON: () => subscriptionJson, unsubscribe: vi.fn(async () => true) };
  const pushManager = {
    getSubscription: vi.fn(async () => null),
    subscribe: vi.fn(async () => subscription),
  };
  const browser = {
    permission: vi.fn(() => permission),
    requestPermission: vi.fn(async () => answer),
    register: vi.fn(async () => ({ pushManager })),
    existing: vi.fn(async () => ({ pushManager })),
  } satisfies PushBrowser;
  return { browser, pushManager, subscription };
}

describe("enableNotifications", () => {
  it("asks the browser, subscribes with the key and keeps the device", async () => {
    const { browser, pushManager } = fakeBrowser("default", "granted");
    const d = withSession(json(device));
    expect(await enableNotifications("AQID", browser, d)).toEqual({ ok: true, device, userId: USER });
    expect(browser.requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
    expect(d.ensure).toHaveBeenCalled();
    expect(d.fetch).toHaveBeenCalledWith(
      "/api/me/push-subscriptions",
      expect.objectContaining({ method: "POST", body: JSON.stringify(subscriptionJson) }),
    );
  });

  it("reuses the browser's subscription when there is one", async () => {
    const { browser, pushManager, subscription } = fakeBrowser("granted");
    pushManager.getSubscription.mockResolvedValue(subscription as never);
    expect(await enableNotifications("AQID", browser, withSession(json(device)))).toEqual({
      ok: true,
      device,
      userId: USER,
    });
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("stops at a refusal, now or earlier, without registering anything", async () => {
    for (const [now, answer] of [
      ["default", "denied"],
      ["denied", "denied"],
    ] as const) {
      const { browser } = fakeBrowser(now, answer);
      const d = withSession(json(device));
      expect(await enableNotifications("AQID", browser, d)).toEqual({ ok: false, error: "denied" });
      expect(browser.register).not.toHaveBeenCalled();
      expect(d.fetch).not.toHaveBeenCalled();
    }
  });

  it("tells a closed question (still « default ») apart from a refusal", async () => {
    const { browser } = fakeBrowser("default", "default");
    const d = withSession(json(device));
    expect(await enableNotifications("AQID", browser, d)).toEqual({ ok: false, error: "dismissed" });
    expect(browser.register).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("drops the browser's subscription for a guest", async () => {
    const { browser, subscription } = fakeBrowser("granted");
    const result = await enableNotifications("AQID", browser, withSession(json({ error: "account_required" }, 403)));
    expect(result).toEqual({ ok: false, error: "account_required" });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("fails on a server error, a bad answer or a browser error", async () => {
    expect(await enableNotifications("AQID", fakeBrowser("granted").browser, withSession(json({}, 500)))).toEqual({
      ok: false,
      error: "failed",
    });
    expect(await enableNotifications("AQID", fakeBrowser("granted").browser, withSession(json({ id: 1 })))).toEqual({
      ok: false,
      error: "failed",
    });
    const { browser } = fakeBrowser("granted");
    browser.register.mockRejectedValue(new Error("no worker"));
    expect(await enableNotifications("AQID", browser, withSession(json(device)))).toEqual({
      ok: false,
      error: "failed",
    });
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("this device's id and its account", () => {
  it("is kept with its account, read and cleared, and a broken storage reads as unknown", () => {
    const storage = memoryStorage();
    expect(readStoredDevice(storage)).toBeNull();
    expect(readDeviceId(storage)).toBeNull();
    writeStoredDevice({ id, userId: USER }, storage);
    expect(readStoredDevice(storage)).toEqual({ id, userId: USER });
    expect(readDeviceId(storage)).toBe(id);
    writeStoredDevice(null, storage);
    expect(readStoredDevice(storage)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredDevice(broken)).toBeNull();
    expect(() => writeStoredDevice({ id, userId: USER }, broken)).not.toThrow();
    expect(readStoredDevice(null)).toBeNull();
  });

  it("reads the first format (the id alone) as an unknown account", () => {
    const storage = memoryStorage();
    storage.setItem("closyria.push.deviceId", id);
    expect(readStoredDevice(storage)).toEqual({ id, userId: null });
    expect(readDeviceId(storage)).toBe(id);
    storage.setItem("closyria.push.deviceId", JSON.stringify({ id: 3 }));
    expect(readStoredDevice(storage)).toEqual({ id: '{"id":3}', userId: null });
  });
});

describe("checkThisDevice (app pages, Notifications)", () => {
  const subscribed = () => {
    const fake = fakeBrowser("granted");
    fake.pushManager.getSubscription.mockResolvedValue(fake.subscription as never);
    return fake;
  };
  const stored = (value: { id: string | null; userId: string | null } | string | null) => {
    const storage = memoryStorage();
    if (typeof value === "string") storage.setItem("closyria.push.deviceId", value);
    else writeStoredDevice(value, storage);
    return storage;
  };

  it("does nothing without a subscription, and never asks for the permission", async () => {
    const { browser } = fakeBrowser("default");
    const d = withSession(json(device));
    expect(await checkThisDevice(browser, d, stored({ id, userId: "user-b" }), memoryStorage())).toBe("none");
    expect(d.fetch).not.toHaveBeenCalled();
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });

  it("drops a subscription kept for another account, an unknown one (first format, lost id), a guest or nobody", async () => {
    for (const [value, who] of [
      [{ id, userId: "user-b" }, session(USER)],
      [id, session(USER)],
      [null, session(USER)],
      [{ id: null, userId: USER }, session(USER)],
      [{ id, userId: USER }, session(USER, true)],
      [{ id, userId: USER }, session(null)],
    ] as const) {
      const { browser, subscription } = subscribed();
      const storage = stored(value);
      const d = withSession(json(device), who);
      expect(await checkThisDevice(browser, d, storage, memoryStorage())).toBe("dropped");
      expect(subscription.unsubscribe).toHaveBeenCalled();
      expect(readStoredDevice(storage)).toBeNull();
      expect(d.fetch).toHaveBeenCalledTimes(1);
      expect(browser.requestPermission).not.toHaveBeenCalled();
    }
  });

  it("keeps hers while the API knows it, asking her devices once per browser session", async () => {
    const { browser, subscription } = subscribed();
    const storage = stored({ id, userId: USER });
    const tab = memoryStorage();
    const d = withSession(json({}, 500), session(USER), json({ subscriptions: [device] }));
    expect(await checkThisDevice(browser, d, storage, tab)).toBe("kept");
    expect(tab.getItem(DEVICE_CHECKED_KEY)).toBe(USER);
    const again = withSession(json({}, 500), session(USER), json({ subscriptions: [] }));
    expect(await checkThisDevice(browser, again, storage, tab)).toBe("kept");
    expect(again.fetch).toHaveBeenCalledTimes(1);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(readStoredDevice(storage)).toEqual({ id, userId: USER });
    // Another account in the same tab: the flag is not hers, so the owner check applies.
    const other = withSession(json({}), session("user-b"));
    expect(await checkThisDevice(browser, other, storage, tab)).toBe("dropped");
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(tab.getItem(DEVICE_CHECKED_KEY)).toBeNull();
  });

  it("drops hers once removed from another device, without sending it again", async () => {
    const { browser, subscription } = subscribed();
    const storage = stored({ id, userId: USER });
    const d = withSession(json(device), session(USER), json({ subscriptions: [] }));
    expect(await checkThisDevice(browser, d, storage, memoryStorage())).toBe("dropped");
    expect(d.fetch).not.toHaveBeenCalledWith("/api/me/push-subscriptions", expect.objectContaining({ method: "POST" }));
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(readStoredDevice(storage)).toBeNull();
  });

  it("changes nothing when it cannot tell (session or devices unreadable, no service worker)", async () => {
    const offline = subscribed();
    const storage = stored({ id, userId: "user-b" });
    const failing = { fetch: vi.fn(async () => Promise.reject(new Error("offline"))), ensure: vi.fn(async () => {}) };
    expect(await checkThisDevice(offline.browser, failing, storage, memoryStorage())).toBe("unknown");
    expect(offline.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(readStoredDevice(storage)).toEqual({ id, userId: "user-b" });

    const down = subscribed();
    const d = withSession(json({}), json({}, 500));
    expect(await checkThisDevice(down.browser, d, stored({ id, userId: "user-b" }), memoryStorage())).toBe("unknown");
    expect(down.subscription.unsubscribe).not.toHaveBeenCalled();

    const mine = subscribed();
    const own = withSession(json({}), session(USER), json({}, 500));
    expect(await checkThisDevice(mine.browser, own, stored({ id, userId: USER }), memoryStorage())).toBe("unknown");
    expect(mine.subscription.unsubscribe).not.toHaveBeenCalled();

    const broken = fakeBrowser("granted");
    broken.browser.existing.mockRejectedValue(new Error("no worker"));
    expect(await checkThisDevice(broken.browser, withSession(json({})), memoryStorage(), memoryStorage())).toBe(
      "unknown",
    );
  });

  it("a broken session storage only means her devices are asked again", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const { browser } = subscribed();
    const d = withSession(json({}), session(USER), json({ subscriptions: [device] }));
    expect(await checkThisDevice(browser, d, stored({ id, userId: USER }), blocked)).toBe("kept");
  });
});

describe("dropThisDevice", () => {
  it("unsubscribes and forgets the id, and never throws", async () => {
    const { browser, pushManager, subscription } = fakeBrowser("granted");
    pushManager.getSubscription.mockResolvedValue(subscription as never);
    const storage = memoryStorage();
    writeStoredDevice({ id, userId: USER }, storage);
    const tab = memoryStorage();
    tab.setItem(DEVICE_CHECKED_KEY, USER);
    await dropThisDevice(browser, storage, tab);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(readStoredDevice(storage)).toBeNull();
    expect(tab.getItem(DEVICE_CHECKED_KEY)).toBeNull();
    const broken = fakeBrowser("granted");
    broken.browser.existing.mockRejectedValue(new Error("no worker"));
    await expect(dropThisDevice(broken.browser, memoryStorage(), memoryStorage())).resolves.toBeUndefined();
  });
});

describe("forgetThisDevice (sign-out)", () => {
  it("removes the known device from the API, then unsubscribes the browser", async () => {
    const { browser, pushManager, subscription } = fakeBrowser("granted");
    pushManager.getSubscription.mockResolvedValue(subscription as never);
    const storage = memoryStorage();
    writeStoredDevice({ id, userId: USER }, storage);
    const d = deps(new Response(null, { status: 204 }));
    expect(await forgetThisDevice(browser, d, storage)).toBe(true);
    expect(d.fetch).toHaveBeenCalledWith(`/api/me/push-subscriptions/${id}`, { method: "DELETE" });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(readDeviceId(storage)).toBeNull();
  });

  it("unsubscribes the browser even without a known id, or when the API fails", async () => {
    const unknown = fakeBrowser("granted");
    unknown.pushManager.getSubscription.mockResolvedValue(unknown.subscription as never);
    const d = deps(json({}));
    await forgetThisDevice(unknown.browser, d, memoryStorage());
    expect(d.fetch).not.toHaveBeenCalled();
    expect(unknown.subscription.unsubscribe).toHaveBeenCalled();

    const down = fakeBrowser("granted");
    down.pushManager.getSubscription.mockResolvedValue(down.subscription as never);
    const storage = memoryStorage();
    writeStoredDevice({ id, userId: USER }, storage);
    const failing = { fetch: vi.fn(async () => Promise.reject(new Error("offline"))), ensure: vi.fn(async () => {}) };
    await forgetThisDevice(down.browser, failing, storage);
    expect(down.subscription.unsubscribe).toHaveBeenCalled();
    expect(readDeviceId(storage)).toBeNull();
  });

  it("never throws, with no service worker or no subscription", async () => {
    const none = fakeBrowser("granted");
    await expect(forgetThisDevice(none.browser, deps(json({})), memoryStorage())).resolves.toBe(false);
    const broken = fakeBrowser("granted");
    broken.browser.existing.mockRejectedValue(new Error("no worker"));
    await expect(forgetThisDevice(broken.browser, deps(json({})), memoryStorage())).resolves.toBe(false);
  });
});

describe("isThisDeviceOn", () => {
  it("is on only when allowed and subscribed", async () => {
    const on = fakeBrowser("granted");
    on.pushManager.getSubscription.mockResolvedValue(on.subscription as never);
    expect(await isThisDeviceOn(on.browser)).toBe(true);
    expect(await isThisDeviceOn(fakeBrowser("granted").browser)).toBe(false);
    const denied = fakeBrowser("denied");
    denied.pushManager.getSubscription.mockResolvedValue(denied.subscription as never);
    expect(await isThisDeviceOn(denied.browser)).toBe(false);
    const none = fakeBrowser("granted");
    none.browser.existing.mockResolvedValue(null as never);
    expect(await isThisDeviceOn(none.browser)).toBe(false);
  });
});

describe("the API", () => {
  it("reads the key, or null when push is off", async () => {
    expect(await fetchPushKey(deps(json({ publicKey: "BKEY" })))).toBe("BKEY");
    expect(await fetchPushKey(deps(json({ error: "not_found" }, 404)))).toBeNull();
    await expect(fetchPushKey(deps(json({}, 500)))).rejects.toThrow();
  });

  it("reads her devices, settings and alerts, empty without a session", async () => {
    expect(await fetchDevices(deps(json({ subscriptions: [device] })))).toEqual([device]);
    expect(await fetchDevices(deps(json({}, 401)))).toEqual([]);
    expect(await fetchAlertSettings(deps(json({}, 401)))).toEqual({
      sizeBack: true,
      targetPrice: true,
      digest: true,
      digestHour: 18,
    });
    expect(await fetchAlerts(null, deps(json({}, 401)))).toEqual({ alerts: [], nextCursor: null });
    const d = deps(json({ alerts: [], nextCursor: null }));
    await fetchAlerts("a b", d);
    expect(d.fetch).toHaveBeenCalledWith("/api/me/alerts?cursor=a%20b", { cache: "no-store" });
    await expect(fetchDevices(deps(json({}, 500)))).rejects.toThrow();
  });

  it("changes her settings, refused for a guest", async () => {
    const settings = { sizeBack: false, targetPrice: true, digest: true, digestHour: 20 };
    const d = deps(json(settings));
    expect(await patchAlertSettings({ sizeBack: false }, d)).toEqual({ ok: true, settings });
    expect(d.fetch).toHaveBeenCalledWith(
      "/api/me/alert-settings",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ sizeBack: false }) }),
    );
    expect(await patchAlertSettings({ digest: false }, deps(json({ error: "account_required" }, 403)))).toEqual({
      ok: false,
      error: "account_required",
    });
    expect(await patchAlertSettings({ digest: false }, deps(json({}, 500)))).toEqual({ ok: false, error: "failed" });
  });

  it("removes a device (already gone counts as removed)", async () => {
    expect(await removeDevice(id, deps(new Response(null, { status: 204 })))).toBe(true);
    expect(await removeDevice(id, deps(json({ error: "not_found" }, 404)))).toBe(true);
    expect(await removeDevice(id, deps(json({}, 500)))).toBe(false);
  });

  it("marks alerts read, and never throws", async () => {
    const d = deps(json({ read: 1 }));
    await markAlertsRead([id], d);
    expect(d.fetch).toHaveBeenCalledWith(
      "/api/me/alerts/read",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: [id] }) }),
    );
    const none = deps(json({ read: 0 }));
    await markAlertsRead([], none);
    expect(none.fetch).not.toHaveBeenCalled();
    await expect(
      markAlertsRead([id], { fetch: vi.fn().mockRejectedValue(new Error("offline")), ensure: vi.fn() }),
    ).resolves.toBeUndefined();
  });
});
