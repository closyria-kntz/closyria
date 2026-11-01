import { createServer, type IncomingMessage, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Header a test sets to give its browser context its own client address. The proxy turns it into
 * `X-Forwarded-For`, as Caddy does with the real client address: each test is then a distinct visitor
 * for Better Auth's per-IP rate limits, instead of every test sharing one bucket.
 */
export const CLIENT_IP_HEADER = "x-e2e-client-ip";

export type Upstreams = { api: string; web: string };

/**
 * Same-origin front for the browser tests, standing in for Caddy (deploy/caddy/closyria.com.caddy): `/api/*` goes to the
 * API, everything else to the web server. Nothing in the apps changes for it.
 */
export async function startProxy(upstreams: Upstreams): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const target = new URL(isApiPath(req.url ?? "/") ? upstreams.api : upstreams.web);
    const headers = { ...req.headers };
    const clientIp = headers[CLIENT_IP_HEADER];
    delete headers[CLIENT_IP_HEADER];
    // Like Caddy: the client address replaces whatever the client claimed.
    headers["x-forwarded-for"] = typeof clientIp === "string" ? clientIp : (req.socket.remoteAddress ?? "127.0.0.1");
    headers["x-forwarded-proto"] = "http";
    headers["x-forwarded-host"] = req.headers.host ?? "";
    const upstream = request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers },
      (upstreamRes: IncomingMessage) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.rawHeaders);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Caddy's `handle /api/*`. */
function isApiPath(url: string): boolean {
  return url.startsWith("/api/");
}
