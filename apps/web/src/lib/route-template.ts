/**
 * Turns a pathname into its App Router route template using the dynamic params of the route
 * (`/items/42` + `{ id: "42" }` -> `/items/[id]`; catch-all `/a/b/c` + `{ slug: ["b","c"] }` -> `/a/[...slug]`),
 * so identifiers never reach the audience events. Without params the pathname is returned as is: static
 * routes carry no personal data. Limit: Next 16 exposes no template to client components, so this is rebuilt
 * from `useParams()`; a static segment equal to a param value at the same place is treated as that param.
 */
export function routeTemplate(pathname: string, params: Record<string, string | string[] | undefined> | null): string {
  if (!params) return pathname;
  const segments = pathname.split("/");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const wanted = (Array.isArray(value) ? value : [value]).map((v) => decodeURIComponent(v));
    for (let i = 1; i + wanted.length <= segments.length; i++) {
      const slice = segments.slice(i, i + wanted.length).map((s) => decodeURIComponent(s));
      if (slice.every((s, j) => s === wanted[j])) {
        segments.splice(i, wanted.length, Array.isArray(value) ? `[...${key}]` : `[${key}]`);
        break;
      }
    }
  }
  return segments.join("/") || "/";
}
