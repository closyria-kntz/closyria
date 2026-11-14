import { describe, expect, it, vi } from "vitest";
import {
  applicationServerKey,
  deviceOf,
  enableNotifications,
  fetchAlertSettings,
  fetchAlerts,
  fetchDevices,
  fetchPushKey,
  isThisDeviceOn,
  markAlertsRead,
  type PushBrowser,
  type PushEnvironment,
  patchAlertSettings,
  pushSupport,
  removeDevice,
} from "./push";

const id = "00000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deps = (response: Response) => ({ fetch: vi.fn(async () => response), ensure: vi.fn(async () => {}) });

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
    const d = deps(json(device));
    expect(await enableNotifications("AQID", browser, d)).toEqual({ ok: true, device });
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
    expect(await enableNotifications("AQID", browser, deps(json(device)))).toEqual({ ok: true, device });
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("stops at a refusal, now or earlier, without registering anything", async () => {
    for (const [now, answer] of [
      ["default", "denied"],
      ["denied", "denied"],
      ["default", "default"],
    ] as const) {
      const { browser } = fakeBrowser(now, answer);
      const d = deps(json(device));
      expect(await enableNotifications("AQID", browser, d)).toEqual({ ok: false, error: "denied" });
      expect(browser.register).not.toHaveBeenCalled();
      expect(d.fetch).not.toHaveBeenCalled();
    }
  });

  it("drops the browser's subscription for a guest", async () => {
    const { browser, subscription } = fakeBrowser("granted");
    const result = await enableNotifications("AQID", browser, deps(json({ error: "account_required" }, 403)));
    expect(result).toEqual({ ok: false, error: "account_required" });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("fails on a server error, a bad answer or a browser error", async () => {
    expect(await enableNotifications("AQID", fakeBrowser("granted").browser, deps(json({}, 500)))).toEqual({
      ok: false,
      error: "failed",
    });
    expect(await enableNotifications("AQID", fakeBrowser("granted").browser, deps(json({ id: 1 })))).toEqual({
      ok: false,
      error: "failed",
    });
    const { browser } = fakeBrowser("granted");
    browser.register.mockRejectedValue(new Error("no worker"));
    expect(await enableNotifications("AQID", browser, deps(json(device)))).toEqual({ ok: false, error: "failed" });
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
