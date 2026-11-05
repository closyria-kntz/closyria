import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";

const RESERVED_PORTS = new Set([3000, 3001, 3100, 3101]);
const FIXTURES_DIR = resolve(import.meta.dirname, "../../extract/fixtures");

export type FakeRoute = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Path relative to packages/extract/fixtures. */
  file?: string;
  delayMs?: number;
  /** Absolute URL or relative path; answers 302 unless `status` is a 3xx. */
  redirect?: string;
};

export type FakeShop = { origin: string; hits: string[]; close(): Promise<void> };

function fixturePath(file: string): string {
  const full = resolve(FIXTURES_DIR, file);
  const rel = relative(FIXTURES_DIR, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`fixture path escapes the fixtures directory: ${file}`);
  }
  return full;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolvePort(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
}

export async function startFakeShop(routes: Record<string, FakeRoute>): Promise<FakeShop> {
  const hits: string[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    hits.push(url);
    const route = routes[url.split("?")[0] ?? "/"];
    const respond = async () => {
      if (!route) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      try {
        if (route.redirect !== undefined) {
          const status = route.status && route.status >= 300 && route.status < 400 ? route.status : 302;
          res.writeHead(status, { ...route.headers, location: route.redirect }).end();
          return;
        }
        const body = route.file !== undefined ? await readFile(fixturePath(route.file)) : route.body;
        res.writeHead(route.status ?? 200, route.headers).end(body);
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
      }
    };
    if (route?.delayMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void respond();
      }, route.delayMs);
      timers.add(timer);
    } else void respond();
  });

  let port = await listen(server);
  while (RESERVED_PORTS.has(port) || port === 0) {
    await closeServer(server);
    port = await listen(server);
  }
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      return closeServer(server);
    },
  };
}
