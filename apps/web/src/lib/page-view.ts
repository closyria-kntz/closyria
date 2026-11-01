/** Audience measurement covers the public site only: the admin area's visits are not counted. */
export function tracksPageViews(pathname: string): boolean {
  return pathname !== "/admin" && !pathname.startsWith("/admin/");
}
