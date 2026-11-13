ALTER TABLE "captures" DROP CONSTRAINT "captures_method_check";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variants_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variants_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_phase" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_hints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_method_check" CHECK ("captures"."method" IS NULL OR "captures"."method" IN ('shopify', 'jsonld', 'opengraph', 'woocommerce'));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_import_phase_check" CHECK ("shops"."import_phase" IS NULL OR "shops"."import_phase" IN ('sizes'));