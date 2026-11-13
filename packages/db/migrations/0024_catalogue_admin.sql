ALTER TABLE "shops" DROP CONSTRAINT "shops_status_check";--> statement-breakpoint
ALTER TABLE "product_reports" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_reports" ADD COLUMN "resolution" text;--> statement-breakpoint
CREATE INDEX "product_reports_open_idx" ON "product_reports" USING btree ("product_id") WHERE "product_reports"."resolved_at" IS NULL;--> statement-breakpoint
ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_resolution_check" CHECK (("product_reports"."resolved_at" IS NULL AND "product_reports"."resolution" IS NULL) OR ("product_reports"."resolved_at" IS NOT NULL AND "product_reports"."resolution" IN ('hidden', 'kept')));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_status_check" CHECK ("shops"."status" IN ('pending', 'draft', 'published', 'refused'));