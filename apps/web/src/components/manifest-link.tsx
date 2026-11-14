"use client";

import { usePathname } from "next/navigation";
import { linksManifest } from "@/lib/manifest-link";

/** The manifest <link> of the root layout's <head>, left out where `linksManifest` says so. */
export function ManifestLink() {
  const pathname = usePathname();
  if (!linksManifest(pathname)) return null;
  // With credentials: on dev, a manifest fetched without the access cookie is refused (401).
  return <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />;
}
