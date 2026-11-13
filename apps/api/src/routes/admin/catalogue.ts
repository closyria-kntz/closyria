import { and, type Database, eq, isNull, ne, schema, sql } from "@closyria/db";
import {
  ADMIN_UNCLASSIFIED_LIMIT,
  adminCatalogErrorSchema,
  adminClassificationSchema,
  adminClassifiedSchema,
  adminReportListSchema,
  adminReportsResolvedSchema,
  adminUnclassifiedListSchema,
  type ReportReason,
  type ReportResolution,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { CatalogDeps } from "../../catalog/deps";
import { catalogImageUrl } from "../../catalog/product-view";
import { pgCode } from "../../pg-code";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const idParam = z.object({ id: z.uuid() });

/** Slug of the « Autres » category, when the reference lists have one: filed there means not really filed. */
const OTHERS_SLUG = "autres";

const unclassifiedRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/catalogue/unclassified",
    summary: "« À classer »: catalogue articles filed « Autres », without a category or without a colour",
    description: `Articles of shops that are published or imported, not removed nor hidden; grouped by shop and product type, ${ADMIN_UNCLASSIFIED_LIMIT} at most (\`total\` counts them all).`,
    responses: {
      200: { description: "Articles", content: { "application/json": { schema: adminUnclassifiedListSchema } } },
    },
  }),
  "admin",
);

const classifyRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/admin/products/{id}/classification",
    summary: "File an article: category and colour, set by an admin (the importer never changes them again)",
    description:
      "With `applyToShopType`, the shop's other articles of the same product type (Shopify `product_type`, kept in `shop_data.category`) get the same filing, except those an admin already filed. An article without a product type is filed alone.",
    request: {
      params: idParam,
      body: { required: true, content: { "application/json": { schema: adminClassificationSchema } } },
    },
    responses: {
      200: { description: "Filed", content: { "application/json": { schema: adminClassifiedSchema } } },
      400: errorContent("Invalid body, or an unknown category / colour"),
      404: errorContent("Unknown article"),
    },
  }),
  "admin",
);

const reportsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/catalogue/reports",
    summary: "« Signalements »: the open reports, one line per article",
    description: "Most reported first, then the latest. Who reported is never returned.",
    responses: {
      200: { description: "Reports", content: { "application/json": { schema: adminReportListSchema } } },
    },
  }),
  "admin",
);

const resolveRoute = (action: "hide" | "keep", summary: string) =>
  defineAccess(
    createRoute({
      method: "post",
      path: `/admin/products/{id}/${action}`,
      summary,
      description: "Closes the article's open reports. Nobody's wishes (`items`) are touched.",
      request: { params: idParam },
      responses: {
        200: { description: "Done", content: { "application/json": { schema: adminReportsResolvedSchema } } },
        404: errorContent("Unknown article"),
      },
    }),
    "admin",
  );
const hideRoute = resolveRoute("hide", "« Masquer du catalogue »: the article leaves the catalogue");
const keepRoute = resolveRoute("keep", "« Garder »: the article stays in the catalogue");

type UnclassifiedRow = {
  id: string;
  name: string;
  shop_id: string;
  shop_name: string;
  image_id: string | null;
  product_type: string | null;
  category_id: string | null;
  color_id: string | null;
  created_at: Date | string;
  total: number;
  [key: string]: unknown;
};

type ReportRow = {
  product_id: string;
  name: string | null;
  shop_id: string;
  shop_name: string;
  image_id: string | null;
  count: number;
  reasons: { reason: ReportReason; count: number }[];
  latest_at: Date | string;
  [key: string]: unknown;
};

const iso = (value: Date | string) => new Date(value).toISOString();

/** Closes the open reports of an article; null when the article is unknown. */
async function resolveReports(
  db: Database,
  productId: string,
  resolution: ReportResolution,
  at: Date,
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .for("update");
    if (!product) return null;
    if (resolution === "hidden") {
      await tx
        .update(schema.products)
        .set({ hiddenAt: at, updatedAt: at })
        .where(and(eq(schema.products.id, productId), isNull(schema.products.hiddenAt)));
    }
    const closed = await tx
      .update(schema.productReports)
      .set({ resolvedAt: at, resolution })
      .where(and(eq(schema.productReports.productId, productId), isNull(schema.productReports.resolvedAt)))
      .returning({ id: schema.productReports.id });
    return closed.length;
  });
}

export function adminCatalogueRoutes(deps: CatalogDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(unclassifiedRoute, async (c) => {
      const { rows } = await db.execute<UnclassifiedRow>(sql`
        select p.id, p.name, s.id as shop_id, s.name as shop_name, p.shop_data->>'category' as product_type,
               p.category_id, p.color_id, p.created_at,
               (select pi.id from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_id,
               count(*) over ()::int as total
        from products p
        join shops s on s.id = p.shop_id
        left join categories cat on cat.id = p.category_id
        where s.merged_into_id is null and (s.status = 'published' or s.import_enabled)
          and p.removed_at is null and p.hidden_at is null and p.name is not null
          and (p.category_id is null or cat.slug = ${OTHERS_SLUG} or p.color_id is null)
        order by s.name, s.id, p.shop_data->>'category' nulls last, p.created_at desc, p.id
        limit ${ADMIN_UNCLASSIFIED_LIMIT}`);
      return c.json(
        {
          products: rows.map((r) => ({
            id: r.id,
            name: r.name,
            shopId: r.shop_id,
            shopName: r.shop_name,
            imageUrl: r.image_id ? catalogImageUrl(r.image_id) : null,
            productType: r.product_type,
            categoryId: r.category_id,
            colorId: r.color_id,
            createdAt: iso(r.created_at),
          })),
          total: rows[0]?.total ?? 0,
        },
        200,
      );
    })
    .openapi(classifyRoute, async (c) => {
      const { id } = c.req.valid("param");
      const { categoryId, colorId, applyToShopType = false } = c.req.valid("json");
      noteAudit(c, { action: "product.classify", target: `product:${id}`, details: { applyToShopType } });
      const at = now();
      let updated: number | null;
      try {
        updated = await db.transaction(async (tx) => {
          const [target] = await tx
            .select({
              shopId: schema.products.shopId,
              productType: sql<string | null>`${schema.products.shopData}->>'category'`,
            })
            .from(schema.products)
            .where(eq(schema.products.id, id))
            .for("update");
          if (!target) return null;
          const filing = { categoryId, colorId, categorySource: "admin", updatedAt: at };
          await tx.update(schema.products).set(filing).where(eq(schema.products.id, id));
          if (!applyToShopType || !target.productType) return 1;
          // Same shop, same product type as read from the shop; an admin's own filing is never overwritten.
          const others = await tx
            .update(schema.products)
            .set(filing)
            .where(
              and(
                eq(schema.products.shopId, target.shopId),
                sql`${schema.products.shopData}->>'category' = ${target.productType}`,
                ne(schema.products.categorySource, "admin"),
                ne(schema.products.id, id),
              ),
            )
            .returning({ id: schema.products.id });
          return 1 + others.length;
        });
      } catch (error) {
        if (pgCode(error) === "23503") return c.json(invalidRequest, 400); // unknown category or colour
        throw error;
      }
      if (updated === null) return c.json(notFound, 404);
      noteAudit(c, { action: "product.classify", target: `product:${id}`, details: { applyToShopType, updated } });
      return c.json({ updated }, 200);
    })
    .openapi(reportsRoute, async (c) => {
      const { rows } = await db.execute<ReportRow>(sql`
        with open_reports as (
          select product_id, reason, count(*)::int as n, max(created_at) as latest
          from product_reports where resolved_at is null
          group by product_id, reason
        ), per_product as (
          select product_id, sum(n)::int as count, max(latest) as latest_at,
                 json_agg(json_build_object('reason', reason, 'count', n) order by n desc, reason) as reasons
          from open_reports group by product_id
        )
        select pp.product_id, p.name, s.id as shop_id, s.name as shop_name, pp.count, pp.reasons, pp.latest_at,
               (select pi.id from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_id
        from per_product pp
        join products p on p.id = pp.product_id
        join shops s on s.id = p.shop_id
        order by pp.count desc, pp.latest_at desc, pp.product_id`);
      return c.json(
        {
          reports: rows.map((r) => ({
            productId: r.product_id,
            name: r.name,
            shopId: r.shop_id,
            shopName: r.shop_name,
            imageUrl: r.image_id ? catalogImageUrl(r.image_id) : null,
            count: r.count,
            reasons: r.reasons,
            latestAt: iso(r.latest_at),
          })),
        },
        200,
      );
    })
    .openapi(hideRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "product.hide", target: `product:${id}` });
      const resolved = await resolveReports(db, id, "hidden", now());
      if (resolved === null) return c.json(notFound, 404);
      noteAudit(c, { action: "product.hide", target: `product:${id}`, details: { resolved } });
      return c.json({ resolved }, 200);
    })
    .openapi(keepRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "product.keep", target: `product:${id}` });
      const resolved = await resolveReports(db, id, "kept", now());
      if (resolved === null) return c.json(notFound, 404);
      noteAudit(c, { action: "product.keep", target: `product:${id}`, details: { resolved } });
      return c.json({ resolved }, 200);
    });
}
