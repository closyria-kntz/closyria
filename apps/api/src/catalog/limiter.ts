import type { Context, MiddlewareHandler } from "hono";
import type { AccessEnv } from "../access";
import { rateLimit } from "../rate-limit";
import { CATALOG_LIMITS, type CatalogDeps } from "./deps";

/**
 * The capture limiter: per client address, then per user (the anonymous limit or the account's one).
 * One instance is shared by every route that counts as a capture, so they share the same counters.
 * Runs after the `user` access check, so the session is there.
 */
export function catalogLimiter(limits: CatalogDeps["limits"]): MiddlewareHandler<AccessEnv> {
  const limited = (c: Context<AccessEnv>) => c.json({ error: "rate_limited" } as const, 429);
  const userKey = (c: Context<AccessEnv>) => `user:${c.var.session?.user.id ?? ""}`;
  const address = rateLimit<AccessEnv>(limits?.perAddress ?? CATALOG_LIMITS.perAddress, limited);
  const anonymous = rateLimit<AccessEnv>(
    { ...(limits?.perAnonymousUser ?? CATALOG_LIMITS.perAnonymousUser), key: userKey },
    limited,
  );
  const account = rateLimit<AccessEnv>({ ...(limits?.perUser ?? CATALOG_LIMITS.perUser), key: userKey }, limited);
  return async (c, next) => {
    const perUser = c.var.session?.user.isAnonymous ? anonymous : account;
    return address(c, async () => {
      const res = await perUser(c, next);
      if (res) c.res = res;
    });
  };
}
