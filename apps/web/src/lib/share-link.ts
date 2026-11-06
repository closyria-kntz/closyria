/** The link to give out: the site's origin and the path (`/l/<token>`) that the API returned when sharing. */
export function absoluteShareUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path}`;
}
