import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ThisDeviceCheck } from "@/components/this-device-check";
import { hasSessionCookie } from "@/lib/session-cookie";

/**
 * Signed-in pages (wardrobe, product sheets, lists, settings) share the adaptive shell. The session cookie's presence
 * tells the band, from the first paint, that a visitor without one is a guest (« Se connecter », 2026-11-14).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  return (
    <>
      <ThisDeviceCheck />
      <AppShell hasSession={hasSessionCookie((name) => jar.has(name))}>{children}</AppShell>
    </>
  );
}
