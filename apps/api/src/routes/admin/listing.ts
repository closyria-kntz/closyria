import { and, desc, eq, isNull, schema, sql } from "@closyria/db";
import {
  adminInvitationCreatedSchema,
  adminListingRequestAcceptedSchema,
  adminListingRequestAcceptSchema,
  adminListingRequestListSchema,
  adminManageLinkSchema,
  adminShopAgreementsSchema,
  canonicalizeUrl,
  domainCandidates,
  type ListingRequestStatus,
  listingErrorSchema,
  listingRequestStatusSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import {
  agreementsOf,
  createInvitation,
  recordAgreement,
  revokeInvitations,
  rotateManageLink,
} from "../../catalog/agreements";
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

const manageLinkRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/agreements/current/manage-link",
    summary: "A new private management link for the agreement in force (the old one stops working)",
    description: "The token is in this answer only; the journal notes that a link was made, never the token.",
    request: { params: idParam },
    responses: {
      201: { description: "Made", content: { "application/json": { schema: adminManageLinkSchema } } },
      404: errorContent("Unknown or merged shop, or no agreement in force (no_agreement)"),
    },
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
  /**
   * The shop owning each site's most specific known domain (a parent domain too, `www.` aside), the one it was merged
   * into if so: one query for the whole list.
   */
  const shopsOfSites = async (siteUrls: string[]) => {
    const candidates = new Map<string, string[]>();
    for (const url of siteUrls) {
      try {
        candidates.set(url, domainCandidates(new URL(url).hostname));
      } catch {
        candidates.set(url, []);
      }
    }
    const all = [...new Set([...candidates.values()].flat())];
    const found = new Map<string, { id: string; name: string }>();
    if (all.length > 0) {
      const { rows } = await db.execute<{ domain: string; id: string; name: string }>(sql`
        select d.domain, coalesce(t.id, s.id) as id, coalesce(t.name, s.name) as name
        from shop_domains d join shops s on s.id = d.shop_id left join shops t on t.id = s.merged_into_id
        where d.domain in (${sql.join(
          all.map((d) => sql`${d}`),
          sql`, `,
        )})`);
      for (const r of rows) found.set(r.domain, { id: r.id, name: r.name });
    }
    return (url: string) =>
      (candidates.get(url) ?? []).map((d) => found.get(d)).find((shop) => shop !== undefined) ?? null;
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
      const shopOf = await shopsOfSites(
        rows.filter(({ request: r }) => r.status === "pending" && !r.shopId).map(({ request: r }) => r.siteUrl),
      );
      const requests = rows.map(({ request: r, shopName }) => {
        const shop =
          r.shopId && shopName !== null
            ? { id: r.shopId, name: shopName }
            : r.status === "pending"
              ? shopOf(r.siteUrl)
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
          shop,
        };
      });
      c.header("Cache-Control", "no-store");
      return c.json({ requests }, 200);
    })
    .openapi(acceptRequestRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "listing_request.accept", target: `listing_request:${id}` });
      const admin = c.var.session?.user;
      const at = now();
      // All in one transaction, the request locked first: a request decided meanwhile creates no shop.
      const outcome = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.listingRequests)
          .where(eq(schema.listingRequests.id, id))
          .for("update");
        if (!locked) return "not_found" as const;
        if (locked.status !== "pending" || !locked.signerName || !locked.signerEmail) return "decided" as const;
        // The shop of the site, or a new draft named as she wrote it (the admin publishes it as any other).
        let shopId = (await findShopByHost(tx, new URL(locked.siteUrl).hostname))?.id ?? null;
        if (!shopId) {
          const url = canonicalizeUrl(locked.siteUrl);
          if (!url) return "invalid_url" as const;
          const created = await createDraftShop(tx, url);
          shopId = "taken" in created ? created.taken : created.shop.id;
          if ("shop" in created) {
            await tx.update(schema.shops).set({ name: locked.shopName }).where(eq(schema.shops.id, shopId));
          }
        }
        const agreement = await recordAgreement(tx, {
          shopId,
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
          .set({ status: "accepted", shopId, agreementId: agreement.id, decidedAt: at })
          .where(eq(schema.listingRequests.id, id));
        return { shopId, agreementId: agreement.id, manageToken: agreement.manageToken };
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (typeof outcome === "string" || !outcome.manageToken) {
        return c.json({ error: outcome === "invalid_url" ? "invalid_url" : "decided" }, 409);
      }
      noteAudit(c, {
        action: "listing_request.accept",
        target: `listing_request:${id}`,
        details: { shopId: outcome.shopId, agreementId: outcome.agreementId },
      });
      c.header("Cache-Control", "no-store");
      return c.json({ shopId: outcome.shopId, manageToken: outcome.manageToken }, 200);
    })
    .openapi(manageLinkRoute, async (c) => {
      const { id } = c.req.valid("param");
      // Never the token in the journal: only that a new link was made.
      noteAudit(c, { action: "shop.agreement.manage_link", target: `shop:${id}` });
      if (!(await activeShop(id))) return c.json(notFound, 404);
      const token = await rotateManageLink(db, id);
      if (!token) return c.json({ error: "no_agreement" }, 404);
      c.header("Cache-Control", "no-store");
      return c.json({ token }, 201);
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
