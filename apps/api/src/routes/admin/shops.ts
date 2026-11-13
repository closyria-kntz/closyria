import { and, asc, count, type Database, desc, eq, gte, inArray, isNull, ne, schema, sql } from "@closyria/db";
import {
  adminCatalogErrorSchema,
  adminImportQueuedSchema,
  adminMergedSchema,
  adminMergeSchema,
  adminShopCreatedSchema,
  adminShopCreateSchema,
  adminShopDetailSchema,
  adminShopImportStatusSchema,
  adminShopListSchema,
  adminShopPatchSchema,
  adminShopSchema,
  CATALOGUE_IMPORT_STALE_MS,
  type CaptureErrorCode,
  type CaptureMode,
  type CaptureStatus,
  type CaptureTrigger,
  canonicalizeUrl,
  captureModeSchema,
  type ListingKind,
  liveImportState,
  type Platform,
  type ShopStatus,
  type ShopValue,
  shopHealthSchema,
  shopStatusSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import { inCatalogue } from "../../catalog/catalogue";
import type { CatalogDeps } from "../../catalog/deps";
import { featuredShopId } from "../../catalog/directory";
import { enqueueCapture } from "../../catalog/enqueue";
import { loadShopStats, type ShopStats, shopHealth } from "../../catalog/health";
import { createDraftShop, type Shop } from "../../catalog/shops";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ERRORS = 10;
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const idParam = z.object({ id: z.uuid() });
const json = <S extends z.ZodType>(schema: S) => ({ required: true, content: { "application/json": { schema } } });

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/shops",
    summary: "Shops with their domains, health and latest capture",
    description:
      "Merged shops are left out. Pending shops come first, by products created over 30 days (most first), then by name.",
    request: {
      query: z.object({
        status: shopStatusSchema.optional(),
        mode: captureModeSchema.optional(),
        health: shopHealthSchema.optional(),
      }),
    },
    responses: {
      200: { description: "Shops", content: { "application/json": { schema: adminShopListSchema } } },
      400: errorContent("Invalid filter"),
    },
  }),
  "admin",
);

const detailRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/shops/{id}",
    summary: "A shop's settings, health and latest errors",
    request: { params: idParam },
    responses: {
      200: { description: "The shop", content: { "application/json": { schema: adminShopDetailSchema } } },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const importStatusRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/shops/{id}/import-status",
    summary: "The import fields of a shop, nothing else (polled by the shop page while an import runs)",
    request: { params: idParam },
    responses: {
      200: {
        description: "The import state and the figures of the last import",
        content: { "application/json": { schema: adminShopImportStatusSchema } },
      },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const patchRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/admin/shops/{id}",
    summary: "Edit a shop; `domains` replaces the whole set",
    request: { params: idParam, body: json(adminShopPatchSchema) },
    responses: {
      200: { description: "The shop", content: { "application/json": { schema: adminShopSchema } } },
      400: errorContent("Invalid body"),
      404: errorContent("Unknown or merged shop"),
      409: errorContent("domain_taken or slug_taken"),
    },
  }),
  "admin",
);

const createShopRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops",
    summary: "Create a draft shop from a product link and test it",
    request: { body: json(adminShopCreateSchema) },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: adminShopCreatedSchema } } },
      400: errorContent("invalid_url"),
      409: errorContent("The domain already belongs to a shop (shopId)"),
    },
  }),
  "admin",
);

const mergeRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/merge",
    summary: "Merge a shop into another one",
    request: { params: idParam, body: json(adminMergeSchema) },
    responses: {
      200: { description: "Merged", content: { "application/json": { schema: adminMergedSchema } } },
      400: errorContent("invalid_merge: same shop, or a merged shop involved"),
      404: errorContent("Unknown shop"),
    },
  }),
  "admin",
);

const featureRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/feature",
    summary: "Make a published shop the « boutique de la semaine » of « Découvrir »",
    description: "Sets `featured_at` to now: the published shop featured most recently is the one shown.",
    request: { params: idParam },
    responses: {
      204: { description: "Featured" },
      404: errorContent("Unknown or merged shop"),
      409: errorContent("not_published: only a published shop is shown"),
    },
  }),
  "admin",
);

const unfeatureRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/shops/{id}/feature",
    summary: "Take a shop off the « une » of « Découvrir »",
    description: "Clears `featured_at`: the shop featured before it, if any, is shown again.",
    request: { params: idParam },
    responses: {
      204: { description: "Not featured any more" },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const publishRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/publish",
    summary: "« Valider »: publish a shop (pending, draft or refused); its complete articles enter the catalogue",
    request: { params: idParam },
    responses: {
      204: { description: "Published" },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const refuseRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/refuse",
    summary: "« Refuser »: the shop never shows in the catalogue; its products stay (wishes point at them)",
    description: "A new link to a refused shop finds it as it is: the status is never set back to pending.",
    request: { params: idParam },
    responses: {
      204: { description: "Refused" },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const importRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/import",
    summary: "« Importer maintenant »: queue the import of a Shopify shop's catalogue",
    description:
      "Queued like the nightly import (one job per shop at a time): `queued` is false when one is already queued or running.",
    request: { params: idParam },
    responses: {
      202: { description: "Queued", content: { "application/json": { schema: adminImportQueuedSchema } } },
      404: errorContent("Unknown shop"),
      409: errorContent(
        "not_shopify: only a Shopify shop's catalogue can be imported; merged or refused: the shop is out of the catalogue",
      ),
    },
  }),
  "admin",
);

/** Hostname as `shopDomain` writes it, or null when it is not a plain hostname. */
function normaliseDomain(raw: string): string | null {
  const domain = raw
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return DOMAIN_PATTERN.test(domain) && domain.length <= 253 ? domain : null;
}

/** The Postgres error code, whether the driver error is wrapped by Drizzle or not. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

type Outcome = { shop: Shop } | { error: "domain_taken" | "slug_taken" | "not_found" };

function importStatusShape(shop: Shop, now: Date) {
  return {
    importState: liveImportState(shop.importState, shop.importStartedAt, now),
    importStartedAt: shop.importStartedAt?.toISOString() ?? null,
    importPages: shop.importPages,
    importSeen: shop.importSeen,
    lastImportAt: shop.lastImportAt?.toISOString() ?? null,
    lastImportError: shop.lastImportError,
    lastImportSeen: shop.lastImportSeen,
    lastImportCreated: shop.lastImportCreated,
    lastImportRemoved: shop.lastImportRemoved,
  };
}

function shape(shop: Shop, domains: string[], stats: ShopStats | undefined, now: Date) {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    status: shop.status as ShopStatus,
    platform: shop.platform as Platform,
    captureMode: shop.captureMode as CaptureMode,
    listingKind: shop.listingKind as ListingKind,
    testUrl: shop.testUrl,
    domains: [...domains].sort(),
    values: shop.values as ShopValue[],
    importEnabled: shop.importEnabled,
    ...importStatusShape(shop, now),
    health: shopHealth({
      status: shop.status as ShopStatus,
      captureMode: shop.captureMode as CaptureMode,
      lastMonitors: stats?.lastMonitors ?? [],
      successRate7d: stats?.successRate7d ?? null,
    }),
    createdAt: shop.createdAt.toISOString(),
  };
}

const captureShape = (c: typeof schema.captures.$inferSelect) => ({
  id: c.id,
  status: c.status as CaptureStatus,
  trigger: c.trigger as CaptureTrigger,
  errorCode: c.errorCode as CaptureErrorCode | null,
  createdAt: c.createdAt.toISOString(),
});

async function domainsOf(db: Database, ids: string[]): Promise<Map<string, string[]>> {
  const rows = ids.length
    ? await db.select().from(schema.shopDomains).where(inArray(schema.shopDomains.shopId, ids))
    : [];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.shopId, [...(map.get(r.shopId) ?? []), r.domain]);
  return map;
}

async function activeShop(db: Database, id: string): Promise<Shop | null> {
  const [shop] = await db
    .select()
    .from(schema.shops)
    .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)));
  return shop ?? null;
}

export function adminShopsRoutes(deps: CatalogDeps) {
  const { db, queue } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  /** False for an unknown or merged shop. */
  const setStatus = async (id: string, status: ShopStatus) => {
    const updated = await db
      .update(schema.shops)
      .set({ status, updatedAt: now() })
      .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)))
      .returning({ id: schema.shops.id });
    return updated.length > 0;
  };

  return app
    .openapi(listRoute, async (c) => {
      const { status, mode, health } = c.req.valid("query");
      const at = now();
      const rows = await db
        .select()
        .from(schema.shops)
        .where(
          and(
            isNull(schema.shops.mergedIntoId),
            status ? eq(schema.shops.status, status) : undefined,
            mode ? eq(schema.shops.captureMode, mode) : undefined,
          ),
        );
      const ids = rows.map((s) => s.id);
      const since30 = new Date(at.getTime() - 30 * DAY_MS);
      const [domains, stats, recent, lasts] = await Promise.all([
        domainsOf(db, ids),
        loadShopStats(db, at, ids),
        ids.length
          ? db
              .select({ shopId: schema.products.shopId, n: count() })
              .from(schema.products)
              .where(and(inArray(schema.products.shopId, ids), gte(schema.products.createdAt, since30)))
              .groupBy(schema.products.shopId)
          : [],
        ids.length
          ? db.execute<{ id: string }>(sql`
              select distinct on (shop_id) id from captures
              where shop_id = any(${sql.param(ids)}::uuid[])
              order by shop_id, created_at desc, id`)
          : { rows: [] as { id: string }[] },
      ]);
      const lastRows = lasts.rows.length
        ? await db
            .select()
            .from(schema.captures)
            .where(
              inArray(
                schema.captures.id,
                lasts.rows.map((r) => r.id),
              ),
            )
        : [];
      const recentBy = new Map(recent.map((r) => [r.shopId, r.n]));
      const lastBy = new Map(lastRows.map((r) => [r.shopId, r]));
      const items = rows
        .map((shop) => {
          const last = lastBy.get(shop.id);
          return {
            ...shape(shop, domains.get(shop.id) ?? [], stats.get(shop.id), at),
            recentProducts: recentBy.get(shop.id) ?? 0,
            lastCapture: last ? captureShape(last) : null,
          };
        })
        .filter((s) => !health || s.health === health)
        .sort(
          (a, b) =>
            Number(b.status === "pending") - Number(a.status === "pending") ||
            (a.status === "pending" ? b.recentProducts - a.recentProducts : 0) ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        );
      return c.json({ shops: items }, 200);
    })
    .openapi(detailRoute, async (c) => {
      const { id } = c.req.valid("param");
      const shop = await activeShop(db, id);
      if (!shop) return c.json(notFound, 404);
      const [domains, stats, errors, monitors, featured, onSale] = await Promise.all([
        domainsOf(db, [id]),
        loadShopStats(db, now(), [id]),
        db
          .select()
          .from(schema.captures)
          .where(and(eq(schema.captures.shopId, id), eq(schema.captures.status, "failed")))
          .orderBy(sql`${schema.captures.createdAt} desc`)
          .limit(RECENT_ERRORS),
        db
          .select()
          .from(schema.captures)
          .where(
            and(
              eq(schema.captures.shopId, id),
              eq(schema.captures.trigger, "monitor"),
              inArray(schema.captures.status, ["succeeded", "failed"]),
            ),
          )
          .orderBy(sql`${schema.captures.finishedAt} desc nulls last`, desc(schema.captures.createdAt))
          .limit(1),
        featuredShopId(db),
        // « Articles dans Découvrir »: what the shop's grid shows, nothing hidden, removed or incomplete.
        db.execute<{ n: number }>(sql`
          select count(*)::int as n from products p join shops s on s.id = p.shop_id
          where p.shop_id = ${id} and ${inCatalogue}`),
      ]);
      const s = stats.get(id);
      const [lastMonitor] = monitors;
      return c.json(
        {
          ...shape(shop, domains.get(id) ?? [], s, now()),
          successRate7d: s?.successRate7d ?? null,
          lastMonitors: s?.lastMonitors ?? [],
          lastMonitor: lastMonitor ? captureShape(lastMonitor) : null,
          recentErrors: errors.map((e) => ({
            errorCode: e.errorCode as CaptureErrorCode | null,
            httpStatus: e.httpStatus,
            url: e.url,
            createdAt: e.createdAt.toISOString(),
          })),
          featured: featured === id,
          catalogueProducts: onSale.rows[0]?.n ?? 0,
        },
        200,
      );
    })
    .openapi(importStatusRoute, async (c) => {
      const { id } = c.req.valid("param");
      const shop = await activeShop(db, id);
      if (!shop) return c.json(notFound, 404);
      return c.json(importStatusShape(shop, now()), 200);
    })
    .openapi(patchRoute, async (c) => {
      const { id } = c.req.valid("param");
      const { domains: rawDomains, testUrl, ...rest } = c.req.valid("json");
      // Validated by the schema; stored in canonical form (tracking parameters dropped).
      const settings = {
        ...rest,
        ...(testUrl === undefined ? {} : { testUrl: testUrl === null ? null : canonicalizeUrl(testUrl) }),
      };
      noteAudit(c, {
        action: "shop.update",
        target: `shop:${id}`,
        details: { fields: Object.keys(c.req.valid("json")).join(",") },
      });
      let domains: string[] | undefined;
      if (rawDomains) {
        const normalised = rawDomains.map(normaliseDomain);
        if (normalised.some((d) => d === null)) return c.json(invalidRequest, 400);
        domains = [...new Set(normalised as string[])];
      }
      let outcome: Outcome;
      try {
        outcome = await db.transaction(async (tx): Promise<Outcome> => {
          const [current] = await tx
            .select()
            .from(schema.shops)
            .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)))
            .for("update");
          if (!current) return { error: "not_found" };
          if (settings.slug) {
            const [clash] = await tx
              .select({ id: schema.shops.id })
              .from(schema.shops)
              .where(and(eq(schema.shops.slug, settings.slug), ne(schema.shops.id, id)));
            if (clash) return { error: "slug_taken" };
          }
          if (domains) {
            const taken = await tx
              .select({ domain: schema.shopDomains.domain })
              .from(schema.shopDomains)
              .where(and(inArray(schema.shopDomains.domain, domains), ne(schema.shopDomains.shopId, id)));
            if (taken.length > 0) return { error: "domain_taken" };
            await tx.delete(schema.shopDomains).where(eq(schema.shopDomains.shopId, id));
            await tx.insert(schema.shopDomains).values(domains.map((domain) => ({ domain, shopId: id })));
          }
          const [updated] = await tx
            .update(schema.shops)
            .set({ ...settings, updatedAt: now() })
            .where(eq(schema.shops.id, id))
            .returning();
          if (!updated) return { error: "not_found" };
          return { shop: updated };
        });
      } catch (error) {
        // A concurrent writer took the slug or a domain between the check and the write.
        if (pgCode(error) === "23505") {
          const message = String((error as { cause?: { constraint?: string } }).cause?.constraint ?? "");
          return c.json({ error: message.includes("slug") ? "slug_taken" : "domain_taken" } as const, 409);
        }
        throw error;
      }
      if ("error" in outcome) {
        return outcome.error === "not_found" ? c.json(notFound, 404) : c.json({ error: outcome.error }, 409);
      }
      const [owned, stats] = await Promise.all([domainsOf(db, [id]), loadShopStats(db, now(), [id])]);
      return c.json(shape(outcome.shop, owned.get(id) ?? [], stats.get(id), now()), 200);
    })
    .openapi(createShopRoute, async (c) => {
      noteAudit(c, { action: "shop.create" });
      const url = canonicalizeUrl(c.req.valid("json").url);
      if (!url) return c.json({ error: "invalid_url" } as const, 400);
      const created = await createDraftShop(db, url);
      if ("taken" in created) return c.json({ error: "domain_taken", shopId: created.taken } as const, 409);
      const [capture] = await db
        .insert(schema.captures)
        .values({ shopId: created.shop.id, productId: null, url, trigger: "admin_test", status: "queued" })
        .returning();
      if (!capture) throw new Error("capture not created");
      noteAudit(c, { action: "shop.create", target: `shop:${created.shop.id}`, details: { captureId: capture.id } });
      await enqueueCapture(db, queue, "capture-admin", capture.id, now());
      return c.json({ shopId: created.shop.id, captureId: capture.id }, 201);
    })
    .openapi(mergeRoute, async (c) => {
      const { id } = c.req.valid("param");
      const { targetId } = c.req.valid("json");
      noteAudit(c, { action: "shop.merge", target: `shop:${id}`, details: { targetId } });
      if (id === targetId) return c.json({ error: "invalid_merge" } as const, 400);
      const result = await db.transaction(async (tx) => {
        // Lock both shops in a fixed order so two opposite merges cannot interleave.
        const locked = await tx
          .select()
          .from(schema.shops)
          .where(inArray(schema.shops.id, [id, targetId]))
          .orderBy(asc(schema.shops.id))
          .for("update");
        const source = locked.find((s) => s.id === id);
        const target = locked.find((s) => s.id === targetId);
        if (!source || !target) return "not_found" as const;
        if (source.mergedIntoId || target.mergedIntoId) return "invalid_merge" as const;
        await tx.update(schema.shopDomains).set({ shopId: targetId }).where(eq(schema.shopDomains.shopId, id));
        await tx.update(schema.products).set({ shopId: targetId }).where(eq(schema.products.shopId, id));
        await tx.update(schema.captures).set({ shopId: targetId }).where(eq(schema.captures.shopId, id));
        // Shops already merged into this one now point at the target.
        await tx.update(schema.shops).set({ mergedIntoId: targetId }).where(eq(schema.shops.mergedIntoId, id));
        await tx.update(schema.shops).set({ mergedIntoId: targetId, updatedAt: now() }).where(eq(schema.shops.id, id));
        return "ok" as const;
      });
      if (result === "not_found") return c.json(notFound, 404);
      if (result === "invalid_merge") return c.json({ error: "invalid_merge" } as const, 400);
      return c.json({ targetId }, 200);
    })
    .openapi(featureRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "shop.feature", target: `shop:${id}` });
      const shop = await activeShop(db, id);
      if (!shop) return c.json(notFound, 404);
      if (shop.status !== "published") return c.json({ error: "not_published" } as const, 409);
      await db.update(schema.shops).set({ featuredAt: now() }).where(eq(schema.shops.id, id));
      return c.body(null, 204);
    })
    .openapi(publishRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "shop.publish", target: `shop:${id}` });
      return (await setStatus(id, "published")) ? c.body(null, 204) : c.json(notFound, 404);
    })
    .openapi(refuseRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "shop.refuse", target: `shop:${id}` });
      return (await setStatus(id, "refused")) ? c.body(null, 204) : c.json(notFound, 404);
    })
    .openapi(importRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "shop.import", target: `shop:${id}` });
      const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, id));
      if (!shop) return c.json(notFound, 404);
      // A pending or draft shop may be imported (preview); a merged or refused one never.
      if (shop.mergedIntoId) return c.json({ error: "merged" } as const, 409);
      if (shop.status === "refused") return c.json({ error: "refused" } as const, 409);
      if (shop.platform !== "shopify") return c.json({ error: "not_shopify" } as const, 409);
      // « En attente » before the job exists, so the worker's « running » is never overwritten; an import already
      // under way keeps its state, a dead one (over 6 h) is replaced.
      const at = now();
      await db
        .update(schema.shops)
        .set({ importState: "queued", importStartedAt: at })
        .where(
          and(
            eq(schema.shops.id, id),
            sql`(${schema.shops.importState} is null or ${schema.shops.importStartedAt} is null
              or ${schema.shops.importStartedAt} < ${new Date(at.getTime() - CATALOGUE_IMPORT_STALE_MS).toISOString()})`,
          ),
        );
      let queued: boolean;
      try {
        queued = await queue.importCatalogue(id);
      } catch (error) {
        // Nothing was queued: no « En attente » left behind.
        await db
          .update(schema.shops)
          .set({ importState: null })
          .where(
            and(eq(schema.shops.id, id), eq(schema.shops.importState, "queued"), eq(schema.shops.importStartedAt, at)),
          );
        throw error;
      }
      noteAudit(c, { action: "shop.import", target: `shop:${id}`, details: { queued } });
      return c.json({ queued }, 202);
    })
    .openapi(unfeatureRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "shop.unfeature", target: `shop:${id}` });
      const [shop] = await db
        .update(schema.shops)
        .set({ featuredAt: null })
        .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)))
        .returning({ id: schema.shops.id });
      if (!shop) return c.json(notFound, 404);
      return c.body(null, 204);
    });
}
