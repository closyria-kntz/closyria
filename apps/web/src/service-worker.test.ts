import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://closyria.com";

type Listener = (event: Record<string, unknown>) => void;

/** public/sw.js in a sandbox: its listeners, and fakes for what it calls. */
function load(windows: { url: string; navigate?: (url: string) => Promise<unknown> }[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => null);
  const clients = windows.map((w) => ({ url: w.url, focus: vi.fn(async () => {}), navigate: w.navigate }));
  for (const client of clients) {
    if (!client.navigate) delete (client as { navigate?: unknown }).navigate;
  }
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clients), openWindow, claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
  };
  runInNewContext(SOURCE, { self, URL, console });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return { fire, showNotification, openWindow, clients, listeners };
}

const pushData = (value: unknown) => ({
  json: () => (typeof value === "string" ? JSON.parse(value) : value),
  text: () => (typeof value === "string" ? value : JSON.stringify(value)),
});

describe("public/sw.js", () => {
  it("has no fetch handler: every request goes to the network as before", () => {
    expect([...load().listeners.keys()].sort()).toEqual(["activate", "install", "notificationclick", "push"]);
  });

  it("shows the worker's message, with its address kept for the tap", async () => {
    const sw = load();
    await sw.fire("push", { data: pushData({ title: "Ta taille est revenue", body: "Iris : de retour", url: "/x" }) });
    expect(sw.showNotification).toHaveBeenCalledWith(
      "Ta taille est revenue",
      expect.objectContaining({ body: "Iris : de retour", data: { url: `${ORIGIN}/x` } }),
    );
  });

  it("never keeps another site's address, and shows plain text as it is", async () => {
    const sw = load();
    await sw.fire("push", { data: pushData({ title: "T", body: "B", url: "https://evil.test/" }) });
    expect(sw.showNotification).toHaveBeenLastCalledWith("T", expect.objectContaining({ data: { url: `${ORIGIN}/` } }));
    await sw.fire("push", { data: pushData("bonjour") });
    expect(sw.showNotification).toHaveBeenLastCalledWith(
      "Closyria",
      expect.objectContaining({ body: "bonjour", data: { url: `${ORIGIN}/` } }),
    );
  });

  it("opens the address in a new window when none of Closyria's is open", async () => {
    const sw = load([{ url: "https://other.test/" }]);
    const close = vi.fn();
    await sw.fire("notificationclick", { notification: { close, data: { url: `${ORIGIN}/nouvelles` } } });
    expect(close).toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/nouvelles`);
  });

  it("takes her open Closyria window there and brings it to the front", async () => {
    const navigate = vi.fn(async function (this: unknown) {
      return this;
    });
    const sw = load([{ url: `${ORIGIN}/`, navigate }]);
    const [client] = sw.clients;
    if (client) client.navigate = navigate.bind(client);
    await sw.fire("notificationclick", { notification: { close: vi.fn(), data: { url: `${ORIGIN}/produits/1` } } });
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/produits/1`);
    expect(client?.focus).toHaveBeenCalled();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("falls back to a new window when her window cannot be steered", async () => {
    const sw = load([{ url: `${ORIGIN}/`, navigate: async () => Promise.reject(new TypeError("not controlled")) }]);
    await sw.fire("notificationclick", { notification: { close: vi.fn(), data: { url: `${ORIGIN}/nouvelles` } } });
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/nouvelles`);
  });
});
