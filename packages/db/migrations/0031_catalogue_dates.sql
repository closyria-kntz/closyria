ALTER TABLE "products" ADD COLUMN "published_source" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shop_rank" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_published_source_check" CHECK ("products"."published_source" IN ('shop', 'first_seen', 'admin', 'unknown'));--> statement-breakpoint
-- Data: a date already stored came from the shop (Shopify `published_at`, else its creation date there; a pasted
-- page's own date). The others (WooCommerce and other shops, nothing given) stay `unknown` with no date: they were on
-- sale before their shop's first import, and no date is invented for them.
UPDATE "products" SET "published_source" = 'shop' WHERE "published_at" IS NOT NULL AND "published_source" = 'unknown';
