import { DEV_ACCESS_PAGE } from "@closyria/shared";

/**
 * Audience measurement covers the public site only: the admin area's visits are not counted, nor dev's access page
 * (Caddy refuses `/api/events` there until the device has access).
 */
export function tracksPageViews(pathname: string): boolean {
  return pathname !== "/admin" && !pathname.startsWith("/admin/") && pathname !== DEV_ACCESS_PAGE;
}
