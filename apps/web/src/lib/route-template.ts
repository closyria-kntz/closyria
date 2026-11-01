/** Sent when the template cannot be built with certainty: never the raw path, which may hold identifiers. */
export const UNKNOWN_ROUTE = "/[unknown]";

type Params = Record<string, string | string[] | undefined>;

/** Decodes for comparison only; a malformed `%` sequence is kept as is (the result is never sent). */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const sameSegment = (segment: string, value: string) => segment === value || decoded(segment) === decoded(value);

/**
 * Turns a pathname into its App Router route template using the dynamic params of the route
 * (`/items/42` + `{ id: "42" }` -> `/items/[id]`; catch-all `/a/b/c` + `{ slug: ["b","c"] }` -> `/a/[...slug]`),
 * so identifiers never reach the audience events. Without params the pathname is returned as is: static
 * routes carry no personal data. Never throws. Values are matched from the right (a dynamic segment comes after
 * the static ones: `/u/[handle]` with handle "u" gives `/u/[handle]`). If params exist but cannot all be located
 * in the path (encoding mismatch, malformed input), the answer is `UNKNOWN_ROUTE`, never the raw pathname.
 * Limit: Next 16 exposes no template to client components, so this is rebuilt from `useParams()`.
 */
export function routeTemplate(pathname: string, params: Params | null): string {
  try {
    const present = Object.entries(params ?? {}).filter(
      ([, value]) => value !== undefined && (Array.isArray(value) ? value.length > 0 : value !== ""),
    ) as [string, string | string[]][];
    if (present.length === 0) return pathname;

    const segments = pathname.split("/");
    for (const [key, value] of present.reverse()) {
      const wanted = Array.isArray(value) ? value : [value];
      let found = -1;
      for (let i = segments.length - wanted.length; i >= 1; i--) {
        if (wanted.every((w, j) => sameSegment(segments[i + j] as string, w))) {
          found = i;
          break;
        }
      }
      if (found === -1) return UNKNOWN_ROUTE;
      segments.splice(found, wanted.length, Array.isArray(value) ? `[...${key}]` : `[${key}]`);
    }
    return segments.join("/") || "/";
  } catch {
    return UNKNOWN_ROUTE;
  }
}
