import { type AdminShopImportStatus, adminShopImportStatusSchema } from "@closyria/shared";
import { adminRequest } from "./admin-catalog";

/** While an import is queued or running, the shop page reads its progress this often. */
export const IMPORT_POLL_MS = 3000;

/** A read that has not answered by then is given up (a hung request must not block the next ticks). */
export const IMPORT_READ_TIMEOUT_MS = 10_000;

/**
 * One light read of a shop's import fields. Null on any failure (network, 4xx, 5xx, bad JSON): the caller keeps what
 * it knew and tries again, it never leaves the page.
 */
export async function readImportStatus(
  shopId: string,
  fetchImpl: typeof globalThis.fetch = fetch,
  timeoutMs: number = IMPORT_READ_TIMEOUT_MS,
): Promise<AdminShopImportStatus | null> {
  const res = await adminRequest("GET", `/api/admin/shops/${shopId}/import-status`, undefined, fetchImpl, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const parsed = adminShopImportStatusSchema.safeParse(res.body);
  return parsed.success ? parsed.data : null;
}

/**
 * The state to show once « Importer maintenant » has answered: « En attente » at once when it queued the import;
 * otherwise (one is already under way) the current state stays until one read answers.
 */
export async function statusAfterImportRequest(options: {
  queued: boolean;
  current: AdminShopImportStatus;
  read: () => Promise<AdminShopImportStatus | null>;
  now?: Date;
}): Promise<AdminShopImportStatus> {
  const { queued, current, read, now = new Date() } = options;
  if (queued) {
    return { ...current, importState: "queued", importStartedAt: now.toISOString(), importPages: 0, importSeen: 0 };
  }
  return (await read().catch(() => null)) ?? current;
}

type PollDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/**
 * Reads the import status every `intervalMs` until it is idle (`importState` null). A failed read (null) changes
 * nothing and the polling goes on. Paused while the tab is hidden; one read at once when it is visible again. Reads
 * never overlap. When the import is over `onIdle` is called once. Returns the function that stops it.
 */
export function startImportPolling(options: {
  read: () => Promise<AdminShopImportStatus | null>;
  onStatus: (status: AdminShopImportStatus) => void;
  onIdle: () => void;
  intervalMs?: number;
  doc?: PollDocument;
}): () => void {
  const { read, onStatus, onIdle, intervalMs = IMPORT_POLL_MS, doc = document } = options;
  let stopped = false;
  let reading = false;

  const tick = async () => {
    if (stopped || reading || doc.visibilityState === "hidden") return;
    reading = true;
    let status: AdminShopImportStatus | null = null;
    try {
      status = await read();
    } catch {
      status = null;
    }
    reading = false;
    if (stopped || status === null) return;
    onStatus(status);
    if (status.importState === null) {
      stop();
      onIdle();
    }
  };

  const onVisibility = () => void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  doc.addEventListener("visibilitychange", onVisibility);

  function stop() {
    stopped = true;
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", onVisibility);
  }
  return stop;
}

/**
 * What the admin shop page shows while an import is queued or running: the line to write and the bar. `value` is
 * between 0 and 0.99 when the previous import's total gives a scale (never full before the end: the shop may have
 * grown), null for an indeterminate bar (« En attente », a first import). Null once the import is over (no bar).
 */
export type ImportProgress = {
  line: "queued" | "starting" | "running" | "runningTotal";
  value: number | null;
  seen: number;
  total: number | null;
};

export const IMPORT_PROGRESS_MAX = 0.99;

export function importProgress(status: AdminShopImportStatus): ImportProgress | null {
  if (status.importState === null) return null;
  if (status.importState === "queued") return { line: "queued", value: null, seen: 0, total: null };
  const seen = status.importSeen;
  const total = status.lastImportSeen;
  if (total !== null && total > 0) {
    return { line: "runningTotal", value: Math.min(seen / total, IMPORT_PROGRESS_MAX), seen, total };
  }
  return { line: status.importPages > 0 ? "running" : "starting", value: null, seen, total: null };
}
