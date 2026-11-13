import type { CatalogSource, ImportDeps, ImportOptions, ImportResult, Listed } from "./import-core";
import { runImport } from "./import-core";
import { shopifySource } from "./import-shopify";
import { createWooSource } from "./import-woocommerce";

/** The source of a platform whose catalogue can be imported (`CATALOGUE_IMPORT_PLATFORMS`); null for the others. */
function sourceFor(platform: string): CatalogSource<Listed> | null {
  if (platform === "shopify") return shopifySource as CatalogSource<Listed>;
  // Its own per import: it remembers the import's variable products.
  if (platform === "woocommerce") return createWooSource() as unknown as CatalogSource<Listed>;
  return null;
}

/**
 * The catalogue import of a shop, by its platform: Shopify (`/products.json`) or WooCommerce (Store API). Same rules
 * and the same admin tracking for both; a shop on another platform stops with `unsupported_platform`.
 */
export function importCatalog(deps: ImportDeps, shopId: string, options: ImportOptions = {}): Promise<ImportResult> {
  return runImport(
    deps,
    shopId,
    { source: sourceFor, unsupported: "unsupported_platform", recordUnsupported: true },
    options,
  );
}
