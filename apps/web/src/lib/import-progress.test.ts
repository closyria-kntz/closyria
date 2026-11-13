import type { AdminShopImportStatus } from "@closyria/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMPORT_POLL_MS,
  importProgress,
  readImportStatus,
  startImportPolling,
  statusAfterImportRequest,
} from "./import-progress";

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
  importExpected: null,
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

it("gives up a hung read after the timeout, sends no-store, and the next tick still reads", async () => {
  let init: RequestInit | undefined;
  const hung = ((_: string, i?: RequestInit) => {
    init = i;
    return new Promise((_resolve, reject) => i?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  }) as never;
  // AbortSignal.timeout runs on the real clock.
  vi.useRealTimers();
  expect(await readImportStatus("s", hung, 20)).toBeNull();
  expect(init?.cache).toBe("no-store");

  const doc = fakeDoc();
  let calls = 0;
  const read = () => (++calls === 1 ? readImportStatus("s", hung, 20) : Promise.resolve(status()));
  const seen = vi.fn();
  const stop = startImportPolling({ read, onStatus: seen, onIdle: vi.fn(), doc: doc as never, intervalMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(calls).toBeGreaterThan(1);
  expect(seen).toHaveBeenCalled();
  stop();
});

it("after « Importer maintenant »: queued at once only when queued, else the current state until a read answers", async () => {
  const current = status({ importPages: 5, importSeen: 500 });
  const read = vi.fn(async () => status({ importPages: 6, importSeen: 600 }));
  const now = new Date("2026-11-13T12:00:00Z");
  const queued = await statusAfterImportRequest({ queued: true, current, read, now });
  expect(queued).toMatchObject({ importState: "queued", importStartedAt: now.toISOString(), importPages: 0 });
  expect(read).not.toHaveBeenCalled();

  expect(await statusAfterImportRequest({ queued: false, current, read, now })).toMatchObject({ importPages: 6 });
  const failing = vi.fn(async () => null);
  expect(await statusAfterImportRequest({ queued: false, current, read: failing, now })).toEqual(current);
});

describe("importProgress", () => {
  it("has no bar once the import is over", () => {
    expect(importProgress(status({ importState: null, lastImportSeen: 900 }))).toBeNull();
  });

  it("waits with an indeterminate bar, even with a previous total", () => {
    expect(
      importProgress(status({ importState: "queued", importPages: 0, importSeen: 0, lastImportSeen: 900 })),
    ).toEqual({ line: "queued", value: null, seen: 0, total: null });
  });

  it("is indeterminate on a first import, with the pages read", () => {
    expect(importProgress(status({ lastImportSeen: null }))).toEqual({
      line: "running",
      value: null,
      seen: 712,
      total: null,
    });
    // A previous import that read nothing is no total either.
    expect(importProgress(status({ lastImportSeen: 0 }))?.value).toBeNull();
    expect(importProgress(status({ lastImportSeen: null, importPages: 0, importSeen: 0 }))?.line).toBe("starting");
  });

  it("measures against the sitemap's estimate when there is no previous total (first import)", () => {
    expect(importProgress(status({ importSeen: 500, lastImportSeen: null, importExpected: 2000 }))).toEqual({
      line: "runningTotal",
      value: 0.25,
      seen: 500,
      total: 2000,
    });
    expect(importProgress(status({ importSeen: 2500, lastImportSeen: null, importExpected: 2000 }))?.value).toBe(0.99);
    expect(importProgress(status({ lastImportSeen: null, importExpected: null }))?.line).toBe("running");
  });

  it("prefers the previous import's real count to the estimate", () => {
    expect(importProgress(status({ importSeen: 500, lastImportSeen: 1000, importExpected: 2000 }))).toMatchObject({
      value: 0.5,
      total: 1000,
    });
  });

  it("measures against the previous import's total", () => {
    expect(importProgress(status({ importSeen: 712, lastImportSeen: 1900 }))).toEqual({
      line: "runningTotal",
      value: 712 / 1900,
      seen: 712,
      total: 1900,
    });
    expect(importProgress(status({ importPages: 0, importSeen: 0, lastImportSeen: 1900 }))).toMatchObject({
      line: "runningTotal",
      value: 0,
    });
  });

  it("never shows a full bar before the end, even past the previous total", () => {
    expect(importProgress(status({ importSeen: 1900, lastImportSeen: 1900 }))?.value).toBe(0.99);
    expect(importProgress(status({ importSeen: 2500, lastImportSeen: 1900 }))?.value).toBe(0.99);
  });
});
