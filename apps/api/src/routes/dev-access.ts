import { createHash, timingSafeEqual } from "node:crypto";
import { DEV_ACCESS_COOKIE, devAccessErrorSchema, devAccessInputSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { type AccessEnv, defineAccess } from "../access";
import { rateLimit } from "../rate-limit";

/** dev.closyria.com's access page (DEV_ACCESS_PASSWORD and DEV_ACCESS_TOKEN). Never given in prod. */
export type DevAccessDeps = {
  password: string;
  /** The cookie's value, the same token as Caddy's (deploy/caddy/dev.closyria.com.caddy). */
  token: string;
  /** Clock of the rate limit, injectable for tests. */
  now?: () => number;
};

/** 5 tries per 10 minutes per address: the right password is 8 characters at least, guessing it takes forever. */
const LIMIT = { max: 5, windowMs: 10 * 60_000 };
const ONE_YEAR_S = 365 * 24 * 60 * 60;

const invalid = { error: "invalid_request" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: devAccessErrorSchema } },
});

const devAccessRoute = (now?: () => number) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/dev-access",
      summary: "Open dev.closyria.com on this device",
      description:
        "Exists only on dev.closyria.com (DEV_ACCESS_PASSWORD and DEV_ACCESS_TOKEN set). With the dev password, sets " +
        `the \`${DEV_ACCESS_COOKIE}\` cookie (HttpOnly, Secure, SameSite=Lax, one year) that Caddy lets in. ` +
        "5 tries per 10 minutes per address.",
      // Rate limit first (cheapest refusal), then the size limit, before anything is parsed.
      middleware: [
        rateLimit(LIMIT, (c) => c.json({ error: "rate_limited" }, 429), now),
        bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json(invalid, 400) }),
      ],
      request: { body: { required: true, content: { "application/json": { schema: devAccessInputSchema } } } },
      responses: {
        204: { description: "Right password: the access cookie is set" },
        400: errorContent("Malformed body (invalid_request)"),
        401: errorContent("Wrong password (wrong_password)"),
        429: errorContent("Too many tries from this address (rate_limited)"),
      },
    }),
    "public",
  );

/** Equal-length digests, compared in constant time: neither the length nor a prefix of the password leaks. */
function samePassword(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export function devAccessRoutes(deps: DevAccessDeps) {
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalid, 400)),
  });

  // Hono answers malformed JSON with an HTTPException(400) and a text body: keep the stable error code. The request
  // (the password) is never logged; the error itself comes from hashing or the cookie, never from the body.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.status === 400 ? c.json(invalid, 400) : error.getResponse();
    console.error(error);
    return c.text("Internal Server Error", 500);
  });

  return app.openapi(devAccessRoute(deps.now), (c) => {
    const { password } = c.req.valid("json");
    if (!samePassword(password, deps.password)) return c.json({ error: "wrong_password" } as const, 401);
    setCookie(c, DEV_ACCESS_COOKIE, deps.token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: ONE_YEAR_S,
    });
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });
}
