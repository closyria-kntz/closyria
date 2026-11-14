import { type Database, eq, schema, sql } from "@closyria/db";
import { classify, classifyCatalogue, type ExtractedProduct } from "@closyria/shared";
import { detectAlerts, type HistoryPoint } from "../alerts/detect";
import type { loadReferenceSet } from "./seed-reference";

export type Reference = Awaited<ReturnType<typeof loadReferenceSet>>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type WriteProductInput = {
  productId: string;
  product: ExtractedProduct;
  /** The address the product was read from (its path helps the rules). */
  url: string;
  listingKind: string;
  /** Undefined when the caller knows the product is admin-classified (nothing to classify). */
  reference: Reference | undefined;
  at: Date;
  /** `always` (a capture) or `on_change` (the nightly import: a row only when the price or a size changed). */
  history: "always" | "on_change";
  /** Extra columns set with the rest (the import puts a product back with `removedAt: null`). */
  extra?: Partial<typeof schema.products.$inferInsert>;
};

/** Labels in page order, first occurrence kept. */
export function uniqueSizes(sizes: ExtractedProduct["sizes"]): ExtractedProduct["sizes"] {
  const byLabel = new Map<string, ExtractedProduct["sizes"][number]>();
  for (const size of sizes) if (!byLabel.has(size.label)) byLabel.set(size.label, size);
  return [...byLabel.values()];
}

/**
 * Writes what the shop says about one product (name, prices, sizes, history, classification), inside the caller's
 * transaction; photos are copied by the caller afterwards. Same writing for a captured link and an imported catalogue.
 *
 * Classification: an admin-classified product (`classified_by = admin`) keeps everything. Otherwise the capture rules
 * fill audience, material, pattern and season, and the category and colour come from `classifyCatalogue` (product type,
 * tags, colour option, name), then the capture rules, then the previous value — unless the admin filed the category by
 * hand (`category_source = admin`), which the rules never overwrite.
 *
 * Put-online date: the shop's (`shop`) when it gives one, except over a date set by the admin; otherwise the row keeps
 * what it had (its creator set `first_seen` or left it `unknown`, see `undatedOnCreate`).
 */
export async function writeProduct(tx: Transaction, input: WriteProductInput): Promise<void> {
  const { productId, product, at } = input;
  const [current] = await tx
    .select({
      classifiedBy: schema.products.classifiedBy,
      categorySource: schema.products.categorySource,
      audience: schema.products.audience,
      childDetail: schema.products.childDetail,
      categoryId: schema.products.categoryId,
      colorId: schema.products.colorId,
      materialId: schema.products.materialId,
      patternId: schema.products.patternId,
      season: schema.products.season,
      priceCents: schema.products.priceCents,
      publishedSource: schema.products.publishedSource,
    })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .for("update");
  if (!current) return;

  const adminClassified = current.classifiedBy === "admin";
  const shopData = product.shopData ?? {};
  const reference = adminClassified ? undefined : input.reference;
  const found = reference ? classify({ name: product.name, url: input.url, shopData }, reference) : undefined;
  const filed =
    reference && current.categorySource !== "admin"
      ? classifyCatalogue(
          {
            productType: shopData.category ?? null,
            tags: shopData.tags ?? [],
            options: shopData.colors?.length ? [{ name: "Couleur", values: shopData.colors }] : [],
            name: product.name,
          },
          reference,
        )
      : undefined;

  await tx
    .update(schema.products)
    .set({
      // Admin corrections to the name and brand survive a re-capture; prices, sizes and photos always come from the shop.
      ...(adminClassified ? {} : { name: product.name, brand: product.brand ?? null }),
      description: product.description ?? null,
      currency: product.currency,
      priceCents: product.priceCents,
      compareAtCents: product.compareAtCents ?? null,
      externalId: product.externalId ?? null,
      // The shop's own date, unless the admin set one by hand; without it the date stays as it was (`first_seen`,
      // `unknown`, or a date the shop gave before): never invented here.
      ...(product.publishedAt && current.publishedSource !== "admin"
        ? { publishedAt: new Date(product.publishedAt), publishedSource: "shop" }
        : {}),
      gtin: product.gtin ?? null,
      sku: product.sku ?? null,
      shopData,
      // A field with no new match keeps its previous value; a new match overwrites it.
      ...(found
        ? {
            audience: found.audience ?? current.audience,
            childDetail: found.childDetail ?? current.childDetail,
            materialId: found.materialId ?? current.materialId,
            patternId: found.patternId ?? current.patternId,
            season: found.season ?? current.season,
          }
        : {}),
      ...(filed && found
        ? {
            categoryId: filed.categoryId ?? found.categoryId ?? current.categoryId,
            colorId: filed.colorId ?? found.colorId ?? current.colorId,
          }
        : {}),
      source: "captured",
      captureStatus: "ok",
      lastCapturedAt: at,
      updatedAt: at,
      ...input.extra,
    })
    .where(eq(schema.products.id, productId));

  const sizes = input.listingKind === "secondhand" ? [] : uniqueSizes(product.sizes);
  const previousSizes =
    input.history === "on_change"
      ? await tx
          .select({ label: schema.productSizes.label, available: schema.productSizes.available })
          .from(schema.productSizes)
          .where(eq(schema.productSizes.productId, productId))
      : [];
  await tx.delete(schema.productSizes).where(eq(schema.productSizes.productId, productId));
  if (sizes.length > 0) {
    await tx.insert(schema.productSizes).values(
      sizes.map((size, position) => ({
        productId,
        label: size.label,
        position,
        available: size.available,
        priceCents: size.priceCents ?? null,
      })),
    );
  }
  const sizeMap = Object.fromEntries(sizes.map((size) => [size.label, size.available]));
  const changed =
    current.priceCents !== product.priceCents ||
    previousSizes.length !== sizes.length ||
    previousSizes.some((s) => sizeMap[s.label] !== s.available);
  if (input.history === "always" || changed) {
    // Written with the point before it, in one statement (the insert's own row is not visible to its sub-select):
    // the alerts are the transitions between the two, none on a first write.
    const written = await tx.execute<HistoryPoint>(sql`
      with previous as (
        select price_cents as "priceCents", sizes from ${schema.productHistory}
        where product_id = ${productId} and seen_at <= ${at.toISOString()}::timestamptz
        order by seen_at desc limit 1
      ), point as (
        insert into ${schema.productHistory} (product_id, seen_at, price_cents, sizes)
        values (${productId}, ${at.toISOString()}::timestamptz, ${product.priceCents}, ${JSON.stringify(sizeMap)}::jsonb)
      )
      select "priceCents", sizes from previous`);
    const [previous] = written.rows;
    await detectAlerts(tx, productId, previous ?? null, { priceCents: product.priceCents, sizes: sizeMap }, at);
  }
}
