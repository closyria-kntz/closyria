import { DEV_ACCESS_PAGE } from "@closyria/shared";

/**
 * Whether a page links the web app manifest. Not the dev access page: before access, Caddy refuses the manifest
 * (401), and that page is not one to install anyway.
 */
export function linksManifest(pathname: string): boolean {
  return pathname !== DEV_ACCESS_PAGE;
}
