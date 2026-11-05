"use client";

import { type AdminCapture, adminCaptureSchema } from "@closyria/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollUntil } from "@/lib/capture-poll";

export type CaptureFollow =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; capture: AdminCapture }
  | { phase: "timeout" };

const FINAL = new Set(["succeeded", "failed", "skipped_manual"]);
const POLL_MS = 500;
const GIVE_UP_MS = 30_000;

async function fetchCapture(id: string, signal: AbortSignal): Promise<AdminCapture> {
  const res = await fetch(`/api/admin/captures/${id}`, { signal });
  if (!res.ok) throw new Error(`capture answered ${res.status}`);
  return adminCaptureSchema.parse(await res.json());
}

/** Follows an admin capture every 500 ms until it is finished, and gives up after 30 s. */
export function useCaptureFollow() {
  const [state, setState] = useState<CaptureFollow>({ phase: "idle" });
  const cancel = useRef<(() => void) | undefined>(undefined);

  const stop = useCallback(() => {
    cancel.current?.();
    cancel.current = undefined;
  }, []);

  const follow = useCallback(
    (id: string) => {
      stop();
      setState({ phase: "running" });
      cancel.current = pollUntil(
        (signal) => fetchCapture(id, signal),
        (capture) => FINAL.has(capture.status),
        {
          intervalMs: POLL_MS,
          softTimeoutMs: GIVE_UP_MS,
          slowDurationMs: 0,
          onUpdate: (capture) => {
            if (FINAL.has(capture.status)) setState({ phase: "done", capture });
          },
          onGiveUp: () => setState({ phase: "timeout" }),
        },
      );
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState({ phase: "idle" });
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { state, follow, reset };
}
