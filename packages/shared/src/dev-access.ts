import { z } from "zod";

/**
 * Access to dev.closyria.com (never prod): the page /acces-dev asks the dev password once, `POST /api/dev-access`
 * then sets this cookie for a year, and Caddy lets in only the requests that carry it with the right token
 * (deploy/caddy/dev.closyria.com.caddy). A cookie, not the browser's password window: a home-screen web app on
 * iPhone never shows that window.
 */
export const DEV_ACCESS_COOKIE = "closyria_dev_access";

/** The page that asks the dev password, open without the cookie. */
export const DEV_ACCESS_PAGE = "/acces-dev";

/** `POST /api/dev-access`. */
export const devAccessInputSchema = z.object({ password: z.string().min(1).max(200) });
export type DevAccessInput = z.infer<typeof devAccessInputSchema>;

export const devAccessErrorSchema = z.object({ error: z.enum(["wrong_password", "rate_limited", "invalid_request"]) });
export type DevAccessError = z.infer<typeof devAccessErrorSchema>;
