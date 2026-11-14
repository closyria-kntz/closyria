import { manifest } from "./manifest";

// Served here rather than by Next's app/manifest.ts, whose <link> fetches it without credentials: on dev, Caddy
// refuses a request without the access cookie (deploy/caddy/dev.closyria.com.caddy).
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(manifest()), {
    headers: { "content-type": "application/manifest+json" },
  });
}
