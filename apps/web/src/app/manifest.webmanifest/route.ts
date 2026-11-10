import { manifest } from "./manifest";

// Served here rather than by Next's app/manifest.ts, whose <link> fetches it without credentials: behind dev's
// password (basic auth) that request is refused, and desktop Chrome asks for the password again and again.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(manifest()), {
    headers: { "content-type": "application/manifest+json" },
  });
}
