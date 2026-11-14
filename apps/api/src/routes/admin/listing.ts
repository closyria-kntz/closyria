import { and, desc, eq, isNull, schema } from "@closyria/db";
import {
  adminInvitationCreatedSchema,
  adminListingRequestAcceptedSchema,
  adminListingRequestAcceptSchema,
  adminListingRequestListSchema,
  adminShopAgreementsSchema,
  canonicalizeUrl,
  type ListingRequestStatus,
  listingErrorSchema,
  listingRequestStatusSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import { agreementsOf, createInvitation, recordAgreement, revokeInvitations } from "../../catalog/agreements";
import type { CatalogDeps } from "../../catalog/deps";
import { createDraftShop, findShopByHost } from "../../catalog/shops";

// Accords de référencement en ligne, the admin's side: the invitation link of a shop, its agreements' history, and
// « Demandes de référencement » (docs/specs/2026-11-14-catalogue-conforme.md §6).

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: listingErrorSchema } },
});
const idParam = z.object({ id: z.uuid() });

const agreementsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/shops/{id}/agreements",
    summary: "A shop's open invitation (never its token) and its agreements, newest first",
    request: { params: idParam },
    responses: {
      200: { description: "Agreements", content: { "application/json": { schema: adminShopAgreementsSchema } } },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const createInvitationRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/invitations",
    summary: "A new invitation link (60 days; the open one is revoked). The token is in this answer only",
    request: { params: idParam },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: adminInvitationCreatedSchema } } },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const revokeInvitationRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/shops/{id}/invitations",
    summary: "Revokes the shop's open invitation link",
    request: { params: idParam },
    responses: { 204: { description: "Revoked (or none was open)" } },
  }),
  "admin",
);

const requestsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/listing-requests",
    summary: "« Demandes de référencement », newest first",
    request: { query: z.object({ status: listingRequestStatusSchema.optional() }) },
    responses: {
      200: { description: "Requests", content: { "application/json": { schema: adminListingRequestListSchema } } },
      400: errorContent("Invalid filter"),
    },
  }),
  "admin",
);

const acceptRequestRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/listing-requests/{id}/accept",
    summary: "Records the agreement of a request (via 'request'), creating the shop as a draft if Closyria has none",
    description: "`verified`: the admin checked that the person represents the shop.",
    request: {
      params: idParam,
      body: { required: true, content: { "application/json": { schema: adminListingRequestAcceptSchema } } },
    },
    responses: {
      200: {
        description: "Accepted: the shop and the signer's private management link (given once)",
        content: { "application/json": { schema: adminListingRequestAcceptedSchema } },
      },
      400: errorContent("Not verified"),
      404: errorContent("Unknown request"),
      409: errorContent("Already decided (decided), or the site's shop was merged away"),
    },
  }),
  "admin",
);

const refuseRequestRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/listing-requests/{id}/refuse",
    summary: "Refuses a request: its name, e-mail and message are erased",
    request: { params: idParam },
    responses: {
      204: { description: "Refused" },
      404: errorContent("Unknown request"),
      409: errorContent("Already decided (decided)"),
    },
  }),
  "admin",
);

export function adminListingRoutes(deps: CatalogDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  const activeShop = async (id: string) => {
    const [shop] = await db
      .select({ id: schema.shops.id, name: schema.shops.name })
      .from(schema.shops)
      .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)));
    return shop ?? null;
  };
  const shopOfSite = async (siteUrl: string) => {
    try {
      return await findShopByHost(db, new URL(siteUrl).hostname);
    } catch {
      return null;
    }
  };

  return app
    .openapi(agreementsRoute, async (c) => {
      const { id } = c.req.valid("param");
      if (!(await activeShop(id))) return c.json(notFound, 404);
      const at = now();
      const [open] = await db
        .select()
        .from(schema.shopInvitations)
        .where(
          and(
            eq(schema.shopInvitations.shopId, id),
            isNull(schema.shopInvitations.revokedAt),
            isNull(schema.shopInvitations.acceptedAt),
          ),
        );
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          invitation:
            open && open.expiresAt > at
              ? { createdAt: open.createdAt.toISOString(), expiresAt: open.expiresAt.toISOString() }
              : null,
          agreements: await agreementsOf(db, id),
        },
        200,
      );
    })
    .openapi(createInvitationRoute, async (c) => {
      const { id } = c.req.valid("param");
      // Never the token in the journal: only that a link was made.
      noteAudit(c, { action: "shop.invitation.create", target: `shop:${id}` });
      if (!(await activeShop(id))) return c.json(notFound, 404);
      const created = await createInvitation(db, id, c.var.session?.user.id ?? null, now());
      c.header("Cache-Control", "no-store");
      return c.json({ token: created.token, expiresAt: created.expiresAt.toISOString() }, 201);
    })
    .openapi(revokeInvitationRoute, async (c) => {
      const { id } = c.req.valid("param");
      const revoked = await revokeInvitations(db, id, now());
      noteAudit(c, { action: "shop.invitation.revoke", target: `shop:${id}`, details: { revoked } });
      return c.body(null, 204);
    })
    .openapi(requestsRoute, async (c) => {
      const { status } = c.req.valid("query");
      const rows = await db
        .select({ request: schema.listingRequests, shopName: schema.shops.name })
        .from(schema.listingRequests)
        .leftJoin(schema.shops, eq(schema.shops.id, schema.listingRequests.shopId))
        .where(status ? eq(schema.listingRequests.status, status) : undefined)
        .orderBy(desc(schema.listingRequests.createdAt))
        .limit(200);
      const requests = await Promise.all(
        rows.map(async ({ request: r, shopName }) => {
          const shop =
            r.shopId && shopName !== null
              ? { id: r.shopId, name: shopName }
              : r.status === "pending"
                ? await shopOfSite(r.siteUrl)
                : null;
          return {
            id: r.id,
            status: r.status as ListingRequestStatus,
            shopName: r.shopName,
            siteUrl: r.siteUrl,
            signerName: r.signerName,
            signerEmail: r.signerEmail,
            message: r.message,
            conditionsVersion: r.conditionsVersion,
            createdAt: r.createdAt.toISOString(),
            decidedAt: r.decidedAt?.toISOString() ?? null,
            shop: shop ? { id: shop.id, name: shop.name } : null,
          };
        }),
      );
      c.header("Cache-Control", "no-store");
      return c.json({ requests }, 200);
    })
    .openapi(acceptRequestRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "listing_request.accept", target: `listing_request:${id}` });
      const [request] = await db.select().from(schema.listingRequests).where(eq(schema.listingRequests.id, id));
      if (!request) return c.json(notFound, 404);
      if (request.status !== "pending") return c.json({ error: "decided" } as const, 409);
      // The shop of the site, or a new draft named as she wrote it (the admin publishes it as any other).
      let shopId = (await shopOfSite(request.siteUrl))?.id ?? null;
      if (!shopId) {
        const url = canonicalizeUrl(request.siteUrl);
        if (!url) return c.json({ error: "invalid_url" } as const, 409);
        const created = await createDraftShop(db, url);
        shopId = "taken" in created ? created.taken : created.shop.id;
        if ("shop" in created) {
          await db.update(schema.shops).set({ name: request.shopName }).where(eq(schema.shops.id, shopId));
        }
      }
      const admin = c.var.session?.user;
      const at = now();
      const targetShop = shopId;
      const outcome = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.listingRequests)
          .where(eq(schema.listingRequests.id, id))
          .for("update");
        if (locked?.status !== "pending" || !locked.signerName || !locked.signerEmail) return null;
        const agreement = await recordAgreement(tx, {
          shopId: targetShop,
          via: "request",
          signerName: locked.signerName,
          signerEmail: locked.signerEmail,
          acceptedAt: at,
          adminId: admin?.id ?? null,
          conditions: { version: locked.conditionsVersion, sha256: locked.conditionsSha256 },
          withManageLink: true,
        });
        await tx
          .update(schema.listingRequests)
          .set({ status: "accepted", shopId: targetShop, agreementId: agreement.id, decidedAt: at })
          .where(eq(schema.listingRequests.id, id));
        return agreement;
      });
      if (!outcome?.manageToken) return c.json({ error: "decided" } as const, 409);
      noteAudit(c, {
        action: "listing_request.accept",
        target: `listing_request:${id}`,
        details: { shopId: targetShop, agreementId: outcome.id },
      });
      c.header("Cache-Control", "no-store");
      return c.json({ shopId: targetShop, manageToken: outcome.manageToken }, 200);
    })
    .openapi(refuseRequestRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "listing_request.refuse", target: `listing_request:${id}` });
      const [request] = await db
        .select({ status: schema.listingRequests.status })
        .from(schema.listingRequests)
        .where(eq(schema.listingRequests.id, id));
      if (!request) return c.json(notFound, 404);
      const refused = await db
        .update(schema.listingRequests)
        // Minimisation: nothing personal is kept of a refused request.
        .set({ status: "refused", signerName: null, signerEmail: null, message: null, decidedAt: now() })
        .where(and(eq(schema.listingRequests.id, id), eq(schema.listingRequests.status, "pending")))
        .returning({ id: schema.listingRequests.id });
      if (refused.length === 0) return c.json({ error: "decided" } as const, 409);
      return c.body(null, 204);
    });
}
