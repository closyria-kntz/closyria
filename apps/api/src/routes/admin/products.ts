import { and, asc, type Database, eq, inArray, schema, sql } from "@closyria/db";
import {
  ADMIN_PRODUCTS_PAGE_SIZE,
  type AdminProductDetail,
  type Audience,
  adminCatalogErrorSchema,
  adminProductDetailSchema,
  adminProductListSchema,
  adminProductPatchSchema,
  adminProductsQuerySchema,
  adminRecaptureSchema,
  type ChildDetail,
  type ClassifiedBy,
  type ProductCaptureStatus,
  type Season,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { CatalogDeps } from "../../catalog/deps";
import { enqueueCapture } from "../../catalog/enqueue";
import { catalogImageUrl } from "../../catalog/product-view";
import { decodeCursor, encodeCursor } from "./audit";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const idParam = z.object({ id: z.uuid() });

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/products",
    summary: "Product sheets with how many accounts kept each",
    description: `Newest first, ${ADMIN_PRODUCTS_PAGE_SIZE} per page. \`keptBy\` is a count of active items; who kept a sheet is never returned. \`classified=none\` means no category.`,
    request: { query: adminProductsQuerySchema },
    responses: {
      200: { description: "A page", content: { "application/json": { schema: adminProductListSchema } } },
      400: errorContent("Invalid filter or cursor"),
    },
  }),
  "admin",
);

const detailRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/products/{id}",
    summary: "A sheet in full: photos, sizes, raw shop data, dates, classification, keptBy",
    request: { params: idParam },
    responses: {
      200: { description: "The sheet", content: { "application/json": { schema: adminProductDetailSchema } } },
      404: errorContent("Unknown sheet"),
    },
  }),
  "admin",
);

const patchRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/admin/products/{id}",
    summary: "Correct a sheet; it is then classified by `admin` and the worker never reclassifies it",
    request: {
      params: idParam,
      body: { required: true, content: { "application/json": { schema: adminProductPatchSchema } } },
    },
    responses: {
      200: { description: "The sheet", content: { "application/json": { schema: adminProductDetailSchema } } },
      400: errorContent("Invalid body, or an unknown category / colour / material / pattern"),
      404: errorContent("Unknown sheet"),
    },
  }),
  "admin",
);

const recaptureRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/products/{id}/recapture",
    summary: "Read the sheet again (admin queue)",
    request: { params: idParam },
    responses: {
      202: { description: "Queued", content: { "application/json": { schema: adminRecaptureSchema } } },
      404: errorContent("Unknown sheet"),
      409: errorContent("capture_active: a capture of this sheet is queued or running"),
    },
  }),
  "admin",
);

const deleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/products/{id}",
    summary: "Delete a sheet nobody keeps, with its photos",
    description:
      "Refused while an item points to it (active or in a trash) or a capture is queued or running. Sizes, history and recent links go with it; captures stay, without the sheet.",
    request: { params: idParam },
    responses: {
      204: { description: "Deleted" },
      404: errorContent("Unknown sheet"),
      409: errorContent("kept: an item points to the sheet; capture_active: a capture is queued or running"),
    },
  }),
  "admin",
);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

const keptByOf = sql<number>`(select count(*)::int from ${schema.items} where ${schema.items.productId} = ${schema.products.id} and ${schema.items.deletedAt} is null)`;

const baseColumns = {
  id: schema.products.id,
  shopId: schema.products.shopId,
  shopName: schema.shops.name,
  name: schema.products.name,
  brand: schema.products.brand,
  currency: schema.products.currency,
  priceCents: schema.products.priceCents,
  captureStatus: schema.products.captureStatus,
  classifiedBy: schema.products.classifiedBy,
  categoryId: schema.products.categoryId,
  keptBy: keptByOf,
  createdAt: schema.products.createdAt,
};

async function loadDetail(db: Database, id: string): Promise<AdminProductDetail | null> {
  const [row] = await db
    .select({ ...baseColumns, product: schema.products })
    .from(schema.products)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(eq(schema.products.id, id));
  if (!row) return null;
  const [images, sizes] = await Promise.all([
    db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, id))
      .orderBy(asc(schema.productImages.position), asc(schema.productImages.id)),
    db
      .select()
      .from(schema.productSizes)
      .where(eq(schema.productSizes.productId, id))
      .orderBy(asc(schema.productSizes.position)),
  ]);
  const p = row.product;
  return {
    id: p.id,
    shopId: p.shopId,
    shopName: row.shopName,
    name: p.name,
    brand: p.brand,
    currency: p.currency,
    priceCents: p.priceCents,
    captureStatus: p.captureStatus as ProductCaptureStatus,
    classifiedBy: p.classifiedBy as ClassifiedBy,
    categoryId: p.categoryId,
    keptBy: row.keptBy,
    createdAt: p.createdAt.toISOString(),
    canonicalUrl: p.canonicalUrl,
    externalId: p.externalId,
    description: p.description,
    compareAtCents: p.compareAtCents,
    source: p.source,
    gtin: p.gtin,
    sku: p.sku,
    shopData: p.shopData,
    audience: p.audience as Audience | null,
    childDetail: p.childDetail as ChildDetail | null,
    colorId: p.colorId,
    materialId: p.materialId,
    patternId: p.patternId,
    season: p.season as Season | null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    lastCapturedAt: p.lastCapturedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
    hiddenAt: p.hiddenAt?.toISOString() ?? null,
    images: images.map((i) => ({ id: i.id, url: catalogImageUrl(i.id), width: i.width, height: i.height })),
    sizes: sizes.map((s) => ({ label: s.label, available: s.available, priceCents: s.priceCents })),
  };
}

export function adminProductsRoutes(deps: CatalogDeps) {
  const { db, queue } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const p = schema.products;

  return app
    .openapi(listRoute, async (c) => {
      const { q, shopId, captureStatus, classified, catalogue, cursor } = c.req.valid("query");
      const after = cursor === undefined ? null : decodeCursor(cursor);
      if (cursor !== undefined && !after) return c.json(invalidRequest, 400);
      const escaped = q?.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const rows = await db
        .select({
          ...baseColumns,
          firstImageId: sql<
            string | null
          >`(select id from ${schema.productImages} where ${schema.productImages.productId} = ${p.id} order by ${schema.productImages.position}, ${schema.productImages.id} limit 1)`,
        })
        .from(p)
        .innerJoin(schema.shops, eq(schema.shops.id, p.shopId))
        .where(
          and(
            escaped === undefined ? undefined : sql`${p.name} ilike ${`%${escaped}%`}`,
            shopId ? eq(p.shopId, shopId) : undefined,
            captureStatus ? eq(p.captureStatus, captureStatus) : undefined,
            classified === "none" ? sql`${p.categoryId} is null` : undefined,
            classified === "rule" || classified === "admin" ? eq(p.classifiedBy, classified) : undefined,
            catalogue === "hidden" ? sql`${p.hiddenAt} is not null` : undefined,
            after
              ? sql`(${p.createdAt}, ${p.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`${p.createdAt} desc`, sql`${p.id} desc`)
        .limit(ADMIN_PRODUCTS_PAGE_SIZE + 1);
      const page = rows.slice(0, ADMIN_PRODUCTS_PAGE_SIZE);
      const last = page.at(-1);
      return c.json(
        {
          products: page.map(({ firstImageId, ...r }) => ({
            ...r,
            captureStatus: r.captureStatus as ProductCaptureStatus,
            classifiedBy: r.classifiedBy as ClassifiedBy,
            imageUrl: firstImageId ? catalogImageUrl(firstImageId) : null,
            createdAt: r.createdAt.toISOString(),
          })),
          nextCursor: rows.length > ADMIN_PRODUCTS_PAGE_SIZE && last ? encodeCursor(last) : null,
        },
        200,
      );
    })
    .openapi(detailRoute, async (c) => {
      const detail = await loadDetail(db, c.req.valid("param").id);
      return detail ? c.json(detail, 200) : c.json(notFound, 404);
    })
    .openapi(patchRoute, async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      noteAudit(c, {
        action: "product.update",
        target: `product:${id}`,
        details: { fields: Object.keys(patch).join(",") },
      });
      try {
        const outcome = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(p).where(eq(p.id, id)).for("update");
          if (!current) return "not_found" as const;
          const audience = patch.audience === undefined ? current.audience : patch.audience;
          // A child detail only makes sense for the child audience.
          if (patch.childDetail && audience !== "child") return "invalid" as const;
          const childDetail =
            audience === "child" ? (patch.childDetail === undefined ? current.childDetail : patch.childDetail) : null;
          await tx
            .update(p)
            .set({ ...patch, childDetail, classifiedBy: "admin", updatedAt: now() })
            .where(eq(p.id, id));
          return "ok" as const;
        });
        if (outcome === "not_found") return c.json(notFound, 404);
        if (outcome === "invalid") return c.json(invalidRequest, 400);
      } catch (error) {
        if (pgCode(error) === "23503") return c.json(invalidRequest, 400); // unknown reference entry
        throw error;
      }
      const detail = await loadDetail(db, id);
      return detail ? c.json(detail, 200) : c.json(notFound, 404);
    })
    .openapi(recaptureRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "product.recapture", target: `product:${id}` });
      const adminId = c.get("session")?.user.id ?? null;
      const outcome = await db.transaction(async (tx) => {
        const [product] = await tx.select().from(p).where(eq(p.id, id)).for("update");
        if (!product) return "not_found" as const;
        const [active] = await tx
          .select({ id: schema.captures.id })
          .from(schema.captures)
          .where(and(eq(schema.captures.productId, id), inArray(schema.captures.status, ["queued", "running"])))
          .limit(1);
        if (active) return "capture_active" as const;
        const [capture] = await tx
          .insert(schema.captures)
          .values({
            shopId: product.shopId,
            productId: id,
            url: product.canonicalUrl,
            trigger: "user",
            requestedBy: adminId,
            status: "queued",
          })
          .returning({ id: schema.captures.id });
        if (!capture) throw new Error("capture not created");
        return capture.id;
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "capture_active") return c.json({ error: "capture_active" } as const, 409);
      await enqueueCapture(db, queue, "capture-admin", outcome, now());
      return c.json({ captureId: outcome }, 202);
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "product.delete", target: `product:${id}` });
      let outcome: "not_found" | "kept" | "capture_active" | string[];
      try {
        outcome = await db.transaction(async (tx) => {
          const [product] = await tx.select({ id: p.id }).from(p).where(eq(p.id, id)).for("update");
          if (!product) return "not_found" as const;
          const [item] = await tx
            .select({ id: schema.items.id })
            .from(schema.items)
            .where(eq(schema.items.productId, id))
            .limit(1);
          if (item) return "kept" as const;
          const [active] = await tx
            .select({ id: schema.captures.id })
            .from(schema.captures)
            .where(and(eq(schema.captures.productId, id), inArray(schema.captures.status, ["queued", "running"])))
            .limit(1);
          if (active) return "capture_active" as const;
          const images = await tx
            .select({ key: schema.productImages.key })
            .from(schema.productImages)
            .where(eq(schema.productImages.productId, id));
          await tx.delete(p).where(eq(p.id, id));
          return images.map((i) => i.key);
        });
      } catch (error) {
        // An item created in the meantime points to the sheet: the delete is refused by the foreign key.
        if (pgCode(error) === "23503") return c.json({ error: "kept" } as const, 409);
        throw error;
      }
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "kept" || outcome === "capture_active") return c.json({ error: outcome }, 409);
      // The rows are gone; a photo that fails to delete is only an orphan file, logged and left behind.
      for (const key of outcome) {
        await deps.store
          .delete(key)
          .catch((error: unknown) => console.error(`product photo ${key} not deleted`, error));
      }
      return c.body(null, 204);
    });
}
