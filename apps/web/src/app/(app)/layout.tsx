import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ThisDeviceCheck } from "@/components/this-device-check";

/** Signed-in pages (wardrobe, product sheets, lists, settings) share the adaptive shell. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ThisDeviceCheck />
      <AppShell>{children}</AppShell>
    </>
  );
}
