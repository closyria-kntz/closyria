"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/track";

/** Sends a `page_view` on the first render and on each route change. Renders nothing. */
export function PageViewTracker() {
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname is the trigger, track() reads the location itself
  useEffect(() => {
    track("page_view");
  }, [pathname]);
  return null;
}
