import type { AdminShopImportStatus } from "@closyria/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IMPORT_POLL_MS, readImportStatus, startImportPolling } from "./import-progress";

const status = (over: Partial<AdminShopImportStatus> = {}): AdminShopImportStatus => ({
  importState: "running",
  importStartedAt: "2026-11-13T12:00:00.000Z",
  importPages: 3,
  importSeen: 712,
  lastImportAt: null,
  lastImportError: null,
  lastImportSeen: null,
  lastImportCreated: null,
  lastImportRemoved: null,
  ...over,
});

function fakeDoc() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    fire: () => {
      for (const l of [...listeners]) l();
    },
    count: () => listeners.size,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("keeps the last state on a failed read and keeps polling", async () => {
  const doc = fakeDoc();
  const reads = [status({ importSeen: 100 }), null, null, status({ importSeen: 300 })];
  const read = vi.fn(async () => reads.shift() ?? null);
  const seen: AdminShopImportStatus[] = [];
  const onIdle = vi.fn();
  const stop = startImportPolling({ read, onStatus: (s) => seen.push(s), onIdle, doc: doc as never });
  await vi.advanceTimersByTimeAsync(IMPORT_POLL_MS * 4);
  expect(read).toHaveBeenCalledTimes(4);
  expect(seen.map((s) => s.importSeen)).toEqual([100, 300]);
  expect(onIdle).not.toHaveBeenCalled();
  stop();
});

it("treats a throwing read as a failure", async () => {
  const doc = fakeDoc();
  const read = vi
    .fn<() => Promise<AdminShopImportStatus | null>>()
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValue(status());
  const seen = vi.fn();
  const stop = startImportPolling({ read, onStatus: seen, onIdle: vi.fn(), doc: doc as never });
  await vi.advanceTimersByTimeAsync(IMPORT_POLL_MS * 2);
  expect(seen).toHaveBeenCalledTimes(1);
  stop();
});

it("stops when idle and calls onIdle once", async () => {
  const doc = fakeDoc();
  const read = vi.fn(async () => status({ importState: null, lastImportAt: "2026-11-13T13:05:00.000Z" }));
  const onIdle = vi.fn();
  startImportPolling({ read, onStatus: vi.fn(), onIdle, doc: doc as never });
  await vi.advanceTimersByTimeAsync(IMPORT_POLL_MS * 5);
  expect(read).toHaveBeenCalledTimes(1);
  expect(onIdle).toHaveBeenCalledTimes(1);
  expect(doc.count()).toBe(0);
});

it("pauses while the tab is hidden and reads at once when it is visible again", async () => {
  const doc = fakeDoc();
  const read = vi.fn(async () => status());
  const stop = startImportPolling({ read, onStatus: vi.fn(), onIdle: vi.fn(), doc: doc as never });
  doc.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(IMPORT_POLL_MS * 3);
  expect(read).not.toHaveBeenCalled();
  doc.visibilityState = "visible";
  doc.fire();
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
  await vi.advanceTimersByTimeAsync(IMPORT_POLL_MS * 3);
  expect(read).toHaveBeenCalledTimes(1);
});

it("readImportStatus returns null on a network error, a 5xx, a 404 or a bad body, and the status otherwise", async () => {
  const reply = (body: unknown, init?: ResponseInit) => (async () => new Response(JSON.stringify(body), init)) as never;
  expect(await readImportStatus("s", (async () => Promise.reject(new Error("net"))) as never)).toBeNull();
  expect(await readImportStatus("s", reply({ error: "x" }, { status: 503 }))).toBeNull();
  expect(await readImportStatus("s", reply({ error: "not_found" }, { status: 404 }))).toBeNull();
  expect(await readImportStatus("s", reply({ importState: "nope" }))).toBeNull();
  expect(await readImportStatus("s", (async () => new Response("<html>", { status: 200 })) as never)).toBeNull();
  expect(await readImportStatus("s", reply(status()))).toEqual(status());
});
