import { type Database, trackServer } from "@closyria/db";
import {
  deviceFromUserAgent,
  eventBatchSchema,
  eventErrorSchema,
  MAX_EVENT_AGE_MS,
  MAX_EVENT_FUTURE_MS,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { type AccessEnv, defineAccess } from "../access";
import { rateLimit } from "../rate-limit";

export type EventsDeps = {
  db: Database;
  /** Clock, injectable for tests. */
  now?: () => Date;
  /** Requests per client per window. Default: 60 per minute. */
  rateLimit?: { max: number; windowMs: number };
};

/** 20 events of the maximum size weigh about 55 KB. */
export const MAX_EVENTS_BODY_BYTES = 64 * 1024;

const invalid = { error: "invalid_event" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: eventErrorSchema } },
});

const eventsRoute = (limits: { max: number; windowMs: number }) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/events",
      summary: "Record audience events",
      description:
        "First-party audience measurement (no IP, no user agent stored). Up to 20 events per batch, body 64 KB at most. " +
        "`path` is cut at `?` and `#`. `occurredAt` must be within the last 7 days and at most 5 minutes ahead, " +
        "otherwise the whole batch is refused. `props`: at most 10 keys (40 characters), string values up to 200 characters. " +
        "The session, when there is one, attaches the user; without it the events stay anonymous.",
      // Rate limit first (cheapest refusal), then the size limit, before anything is parsed.
      middleware: [
        rateLimit(limits, (c) => c.json({ error: "rate_limited" }, 429)),
        bodyLimit({ maxSize: MAX_EVENTS_BODY_BYTES, onError: (c) => c.json({ error: "payload_too_large" }, 413) }),
      ],
      request: {
        body: { required: true, content: { "application/json": { schema: eventBatchSchema } } },
      },
      responses: {
        202: {
          description: "Recorded",
          content: { "application/json": { schema: z.object({ accepted: z.number().int().positive() }) } },
        },
        400: errorContent("Unknown name, bad shape, date out of the accepted window (invalid_event)"),
        413: errorContent("Body over 64 KB (payload_too_large)"),
        429: errorContent("Too many requests from this client (rate_limited)"),
      },
    }),
    "public",
  );

export function eventsRoutes(deps: EventsDeps) {
  const now = deps.now ?? (() => new Date());
  const limits = deps.rateLimit ?? { max: 60, windowMs: 60_000 };
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalid, 400)),
  });

  // Hono answers malformed JSON with an HTTPException(400) and a text body: keep our stable error codes.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.status === 400 ? c.json(invalid, 400) : error.getResponse();
    console.error(error);
    return c.text("Internal Server Error", 500);
  });

  return app.openapi(eventsRoute(limits), async (c) => {
    const { events } = c.req.valid("json");
    const received = now();
    const oldest = received.getTime() - MAX_EVENT_AGE_MS;
    const latest = received.getTime() + MAX_EVENT_FUTURE_MS;
    const dated = events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) }));
    if (dated.some((e) => e.occurredAt.getTime() < oldest || e.occurredAt.getTime() > latest)) {
      return c.json(invalid, 400);
    }

    // Public route: the session is optional. A broken session store must not lose audience events.
    const session = await c.var.getSession().catch(() => null);
    const device = deviceFromUserAgent(c.req.header("user-agent")); // the user agent is read here and dropped
    await trackServer(
      deps.db,
      dated.map((e) => ({ ...e, userId: session?.user.id ?? null, device })),
    );
    return c.json({ accepted: events.length }, 202);
  });
}
