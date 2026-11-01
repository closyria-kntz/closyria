"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { createOncePerPath } from "@/lib/once-per-path";
import { routeTemplate } from "@/lib/route-template";
import { track } from "@/lib/track";

/**
 * Sends a `page_view` on the first render and on each route change. Renders nothing.
 * PRIVACY: only the route template (`/items/[id]`) is sent, never a path with identifiers.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const params = useParams();
  const once = useRef(createOncePerPath());
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname is the trigger, params belong to it
  useEffect(() => {
    // React strict mode (dev) runs effects twice: one page_view per path.
    if (!once.current(pathname)) return;
    // Audience measurement must never break the page.
    try {
      track("page_view", undefined, routeTemplate(pathname, params));
    } catch {}
  }, [pathname]);
  return null;
}
