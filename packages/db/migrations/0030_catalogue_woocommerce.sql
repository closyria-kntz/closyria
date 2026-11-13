ALTER TABLE "captures" DROP CONSTRAINT "captures_method_check";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variants_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_method_check" CHECK ("captures"."method" IS NULL OR "captures"."method" IN ('shopify', 'jsonld', 'opengraph', 'woocommerce'));