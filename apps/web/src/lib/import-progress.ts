import { type AdminShopImportStatus, adminShopImportStatusSchema } from "@closyria/shared";
import { adminRequest } from "./admin-catalog";

/** While an import is queued or running, the shop page reads its progress this often. */
export const IMPORT_POLL_MS = 3000;

/**
 * One light read of a shop's import fields. Null on any failure (network, 4xx, 5xx, bad JSON): the caller keeps what
 * it knew and tries again, it never leaves the page.
 */
export async function readImportStatus(
  shopId: string,
  fetchImpl: typeof globalThis.fetch = fetch,
): Promise<AdminShopImportStatus | null> {
  const res = await adminRequest("GET", `/api/admin/shops/${shopId}/import-status`, undefined, fetchImpl);
  if (!res.ok) return null;
  const parsed = adminShopImportStatusSchema.safeParse(res.body);
  return parsed.success ? parsed.data : null;
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
