import { randomUUID } from "node:crypto";
import type pg from "pg";
import { setupValue } from "./paths";

/**
 * The shops of the capture journeys, inserted directly in the test database by the global setup. Products
 * are shared by address, so every test pastes its own address (`?variant=` is part of it, ignored by the
 * fake shop): a test never finds a page another test already captured.
 */

/** Published, automatic, Shopify: the fake shop (packages/testing) on 127.0.0.1, read by the capture worker. */
export const AUTO_SHOP = { name: "Fausse boutique", slug: "e2e-fausse-boutique", domain: "127.0.0.1" } as const;

/**
 * Published, captured by hand. A loopback name of its own (a shop domain belongs to one shop): it is never
 * fetched, the API answers « manual » without queuing a capture.
 */
export const MANUAL_SHOP = {
  name: "Boutique manuelle",
  slug: "e2e-boutique-manuelle",
  domain: "manuelle.e2e.test",
} as const;

/** Names under this suffix resolve to 127.0.0.1 for the capture worker only (capture-worker.ts), never DNS. */
export const LOOPBACK_NAME_SUFFIX = ".e2e.test";

/** The recorded MCB Paris product, as the fake shop serves it (page and `.js`). */
export const PRODUCT_PATH = "/products/produit-3679";
/** Sizes as read aloud: S is sold out in the recording (« indisponible », said to screen readers only). */
export const PRODUCT = { name: "PANTALON LEONIE", price: /^23,00\s€$/, sizes: ["S (indisponible)", "M"] } as const;

const unique = () => randomUUID().slice(0, 8);

/** A fresh address of the Shopify product on the auto shop. */
export const autoProductUrl = () => `${setupValue("E2E_FAKE_SHOP_URL")}${PRODUCT_PATH}?variant=${unique()}`;

/** A fresh product address on the manual shop. */
export const manualProductUrl = () => `http://${MANUAL_SHOP.domain}/products/robe-en-lin-${unique()}`;

/** A loopback name no shop owns yet, served by the fake shop (the admin's « Ajouter une boutique »). */
export function newShopUrl(): { host: string; url: string } {
  const host = `boutique-${unique()}${LOOPBACK_NAME_SUFFIX}`;
  const port = new URL(setupValue("E2E_FAKE_SHOP_URL")).port;
  return { host, url: `http://${host}:${port}${PRODUCT_PATH}` };
}

/** Inserts the two shops of the journeys (once, from the global setup). */
export async function seedShops(db: pg.Pool | pg.Client): Promise<void> {
  for (const [shop, mode] of [
    [AUTO_SHOP, "auto"],
    [MANUAL_SHOP, "manual"],
  ] as const) {
    const { rows } = await db.query<{ id: string }>(
      `insert into shops (name, slug, status, platform, capture_mode)
       values ($1, $2, 'published', $3, $4) returning id`,
      [shop.name, shop.slug, mode === "auto" ? "shopify" : "other", mode],
    );
    await db.query("insert into shop_domains (domain, shop_id) values ($1, $2)", [shop.domain, rows[0]?.id]);
  }
}
