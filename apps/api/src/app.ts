import { healthSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

export type AppDeps = {
  env: string;
  version: string;
  pingDb: () => Promise<boolean>;
};

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Service and database health",
  responses: {
    200: { description: "Healthy", content: { "application/json": { schema: healthSchema } } },
    503: { description: "Database unreachable", content: { "application/json": { schema: healthSchema } } },
  },
});

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono().basePath("/api");

  const routes = app.openapi(healthRoute, async (c) => {
    const dbOk = await deps.pingDb();
    const body = {
      status: dbOk ? "ok" : "degraded",
      env: deps.env,
      version: deps.version,
      database: dbOk ? "ok" : "error",
    } as const;
    return dbOk ? c.json(body, 200) : c.json(body, 503);
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Closyria API", version: deps.version },
  });

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
