import { and, count, eq, isNull, schema } from "@closyria/db";
import {
  type AgreementEndedBy,
  LISTING_CONDITIONS,
  listingAcceptedSchema,
  listingAcceptInputSchema,
  listingErrorSchema,
  listingInvitationViewSchema,
  listingManageViewSchema,
  listingRequestInputSchema,
  listingTokenSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../access";
import {
  endAgreement,
  hashListingToken,
  lockShop,
  mainDomain,
  openInvitation,
  recordAgreement,
  traceAgreement,
} from "../catalog/agreements";
import type { CatalogDeps } from "../catalog/deps";
import { rateLimit } from "../rate-limit";

// Accords de référencement en ligne (docs/specs/2026-11-14-catalogue-conforme.md §6): public, no account. A bad token
// (unknown, expired, revoked, used, or its shop merged) always gets the same 404, with nothing about the shop. The
// signer's IP address is never stored: the rate limits keep only salted hashes, in memory, for one window.

const HOUR_MS = 60 * 60 * 1000;
/** Generous for a person, tight for a script; per client address. */
export const LISTING_LIMITS = {
  read: { max: 60, windowMs: 10 * 60_000 },
  accept: { max: 10, windowMs: HOUR_MS },
  withdraw: { max: 10, windowMs: HOUR_MS },
  request: { max: 5, windowMs: HOUR_MS },
} as const;

/** Beyond this many requests waiting for the admin, the form is closed for everyone (a flood from many addresses). */
export const MAX_PENDING_REQUESTS = 50;

const invalidLink = { error: "invalid_link" } as const;
const invalid = { error: "invalid_request" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: listingErrorSchema } },
});
const json = <S extends z.ZodType>(schema: S) => ({ required: true, content: { "application/json": { schema } } });
const tokenParam = z.object({ token: z.string() });
const limited = (c: Context) => c.json({ error: "rate_limited" }, 429);
const small = bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json(invalid, 400) });

export function listingRoutes(deps: CatalogDeps, clock?: () => number) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const ms = clock ?? (() => now().getTime());
  const limit = (window: { max: number; windowMs: number }) => rateLimit(window, limited, ms);

  const invitationRoute = defineAccess(
    createRoute({
      method: "get",
      path: "/listing/invitations/{token}",
      summary: "The shop and the conditions of an invitation link",
      middleware: [limit(LISTING_LIMITS.read)],
      request: { params: tokenParam },
      responses: {
        200: { description: "Open", content: { "application/json": { schema: listingInvitationViewSchema } } },
        404: errorContent("Unknown, expired, revoked or used link (invalid_link): never anything about the shop"),
        429: errorContent("Too many tries from this address"),
      },
    }),
    "public",
  );

  const acceptRoute = defineAccess(
    createRoute({
      method: "post",
      path: "/listing/invitations/{token}/accept",
      summary: "Gives the shop's listing agreement (once per invitation)",
      middleware: [limit(LISTING_LIMITS.accept), small],
      request: { params: tokenParam, body: json(listingAcceptInputSchema) },
      responses: {
        201: { description: "Recorded", content: { "application/json": { schema: listingAcceptedSchema } } },
        400: errorContent("Missing name, e-mail, a box, or older conditions"),
        404: errorContent("Unknown, expired, revoked or used link (invalid_link)"),
        429: errorContent("Too many tries from this address"),
      },
    }),
    "public",
  );

  const manageRoute = defineAccess(
    createRoute({
      method: "get",
      path: "/listing/manage/{token}",
      summary: "The agreement behind a private management link",
      middleware: [limit(LISTING_LIMITS.read)],
      request: { params: tokenParam },
      responses: {
        200: { description: "The agreement", content: { "application/json": { schema: listingManageViewSchema } } },
        404: errorContent("Unknown link (invalid_link)"),
        429: errorContent("Too many tries from this address"),
      },
    }),
    "public",
  );

  const withdrawRoute = defineAccess(
    createRoute({
      method: "post",
      path: "/listing/manage/{token}/withdraw",
      summary: "Withdraws the shop from Closyria (immediate; again: the same answer)",
      middleware: [limit(LISTING_LIMITS.withdraw)],
      request: { params: tokenParam },
      responses: {
        200: { description: "Withdrawn", content: { "application/json": { schema: listingManageViewSchema } } },
        404: errorContent("Unknown link (invalid_link)"),
        429: errorContent("Too many tries from this address"),
      },
    }),
    "public",
  );

  const requestRoute = defineAccess(
    createRoute({
      method: "post",
      path: "/listing/requests",
      summary: "« Référencer ma boutique »: a request the admin decides on",
      description: "5 an hour per address. A filled honeypot (`website`) gets the same answer and is not recorded.",
      middleware: [limit(LISTING_LIMITS.request), small],
      request: { body: json(listingRequestInputSchema) },
      responses: {
        202: { description: "Received", content: { "application/json": { schema: z.object({}) } } },
        400: errorContent("Invalid fields"),
        429: errorContent("Too many requests from this address (rate_limited)"),
        503: errorContent(`${MAX_PENDING_REQUESTS} requests already wait for the admin (too_many_pending)`),
      },
    }),
    "public",
  );

  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalid, 400)),
  });
  const validToken = (token: string) => listingTokenSchema.safeParse(token).success;

  const manageView = async (token: string) => {
    const [row] = await db
      .select({ agreement: schema.shopAgreements, shopName: schema.shops.name })
      .from(schema.shopAgreements)
      .innerJoin(schema.shops, eq(schema.shops.id, schema.shopAgreements.shopId))
      .where(eq(schema.shopAgreements.manageTokenHash, hashListingToken(token)));
    return row ?? null;
  };
  const manageShape = (row: { agreement: typeof schema.shopAgreements.$inferSelect; shopName: string }) => ({
    shopName: row.shopName,
    acceptedAt: row.agreement.acceptedAt.toISOString(),
    withdrawnAt: row.agreement.withdrawnAt?.toISOString() ?? null,
    endedBy: (row.agreement.withdrawnBy as AgreementEndedBy | null) ?? null,
    conditionsVersion: row.agreement.conditionsVersion,
  });

  return app
    .openapi(invitationRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      const { token } = c.req.valid("param");
      const found = validToken(token) ? await openInvitation(db, token, now()) : null;
      if (!found) return c.json(invalidLink, 404);
      return c.json(
        {
          shop: { name: found.shop.name, domain: await mainDomain(db, found.shop.id) },
          conditions: { version: LISTING_CONDITIONS.version, sha256: LISTING_CONDITIONS.sha256 },
        },
        200,
      );
    })
    .openapi(acceptRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      const { token } = c.req.valid("param");
      const input = c.req.valid("json");
      if (!validToken(token)) return c.json(invalidLink, 404);
      const at = now();
      const outcome = await db.transaction(async (tx) => {
        // Shop first, then the invitation: two acceptances of one link run one after the other, and the second
        // finds it used.
        const seen = await openInvitation(tx, token, at);
        if (!seen) return null;
        await lockShop(tx, seen.shop.id);
        const found = await openInvitation(tx, token, at, true);
        if (!found) return null;
        const agreement = await recordAgreement(tx, {
          shopId: found.shop.id,
          via: "invitation",
          signerName: input.name,
          signerEmail: input.email,
          acceptedAt: at,
          withManageLink: true,
        });
        await tx
          .update(schema.shopInvitations)
          .set({ acceptedAt: at, agreementId: agreement.id })
          .where(eq(schema.shopInvitations.id, found.invitation.id));
        await traceAgreement(
          tx,
          "shop.agreement.accept",
          found.shop.id,
          { via: "invitation", agreementId: agreement.id, conditionsVersion: LISTING_CONDITIONS.version },
          at,
        );
        return { shopName: found.shop.name, manageToken: agreement.manageToken };
      });
      if (!outcome?.manageToken) return c.json(invalidLink, 404);
      return c.json({ shopName: outcome.shopName, manageToken: outcome.manageToken }, 201);
    })
    .openapi(manageRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      const { token } = c.req.valid("param");
      const row = validToken(token) ? await manageView(token) : null;
      if (!row) return c.json(invalidLink, 404);
      return c.json(manageShape(row), 200);
    })
    .openapi(withdrawRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      const { token } = c.req.valid("param");
      if (!validToken(token)) return c.json(invalidLink, 404);
      const at = now();
      await db.transaction(async (tx) => {
        const inForce = and(
          eq(schema.shopAgreements.manageTokenHash, hashListingToken(token)),
          isNull(schema.shopAgreements.withdrawnAt),
        );
        // Shop first, then the agreement (the lock order of every agreement write).
        const [found] = await tx
          .select({ shopId: schema.shopAgreements.shopId })
          .from(schema.shopAgreements)
          .where(inForce);
        if (!found) return;
        await lockShop(tx, found.shopId);
        const [agreement] = await tx.select().from(schema.shopAgreements).where(inForce).for("update");
        if (!agreement) return;
        await endAgreement(tx, agreement.shopId, "signer", at);
        await traceAgreement(tx, "shop.agreement.withdraw", agreement.shopId, { agreementId: agreement.id }, at);
      });
      const row = await manageView(token);
      if (!row) return c.json(invalidLink, 404);
      return c.json(manageShape(row), 200);
    })
    .openapi(requestRoute, async (c) => {
      const input = c.req.valid("json");
      // A robot filled the hidden field: the same answer, nothing kept.
      if (input.website) return c.json({}, 202);
      const [pending] = await db
        .select({ n: count() })
        .from(schema.listingRequests)
        .where(eq(schema.listingRequests.status, "pending"));
      if ((pending?.n ?? 0) >= MAX_PENDING_REQUESTS) return c.json({ error: "too_many_pending" }, 503);
      await db.insert(schema.listingRequests).values({
        shopName: input.shopName,
        siteUrl: input.siteUrl,
        signerName: input.name,
        signerEmail: input.email,
        message: input.message || null,
        conditionsVersion: LISTING_CONDITIONS.version,
        conditionsSha256: LISTING_CONDITIONS.sha256,
        createdAt: now(),
      });
      return c.json({}, 202);
    });
}
