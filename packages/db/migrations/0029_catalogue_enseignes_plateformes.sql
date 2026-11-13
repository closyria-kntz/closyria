ALTER TABLE "shops" DROP CONSTRAINT "shops_platform_check";--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "is_major_brand" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_platform_check" CHECK ("shops"."platform" IN ('shopify', 'woocommerce', 'prestashop', 'wix', 'squarespace', 'magento', 'other', 'unknown'));--> statement-breakpoint
-- « Grandes enseignes » of the starting shops (apps/worker/src/capture/starting-shops.ts): out of « Découvrir ». Idempotent; other shops untouched.
UPDATE "shops" SET "is_major_brand" = true, "updated_at" = now() WHERE "is_major_brand" = false AND "slug" IN ('promod', 'zalando', 'zara', 'mango', 'hm', 'sezane', 'kiabi', 'etam', 'la-redoute', 'shein', 'vinted', 'vestiaire-collective');
