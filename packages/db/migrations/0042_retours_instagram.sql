ALTER TABLE "alert_events" DROP CONSTRAINT "alert_events_kind_check";--> statement-breakpoint
ALTER TABLE "alert_events" DROP CONSTRAINT "alert_events_order_check";--> statement-breakpoint
DROP INDEX "alert_events_pending_send_idx";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_not_yet_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_asked_again_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "source_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_return_reminder_idx" ON "alert_events" USING btree ("item_id") WHERE "alert_events"."kind" = 'return_reminder';--> statement-breakpoint
CREATE INDEX "items_return_deadline_idx" ON "items" USING btree ("return_deadline") WHERE "items"."return_deadline" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_events_pending_send_idx" ON "alert_events" USING btree ("send_after") WHERE "alert_events"."status" = 'pending' AND "alert_events"."kind" IN ('size_back', 'target_price', 'order_received', 'parcel_out_for_delivery', 'parcel_pickup_ready', 'parcel_delivered', 'return_reminder', 'order_received_check');--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_return_reminder_check" CHECK ("alert_events"."kind" <> 'return_reminder' OR ("alert_events"."item_id" IS NOT NULL AND "alert_events"."profile_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_kind_check" CHECK ("alert_events"."kind" IN ('size_back', 'target_price', 'price_drop', 'sale_period', 'shop_promo', 'order_received', 'parcel_out_for_delivery', 'parcel_pickup_ready', 'parcel_delivered', 'return_reminder', 'order_received_check'));--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_order_check" CHECK ("alert_events"."kind" NOT IN ('order_received', 'order_received_check') OR "alert_events"."order_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_url_check" CHECK ("items"."source_url" IS NULL OR char_length("items"."source_url") BETWEEN 1 AND 2048);--> statement-breakpoint
-- The orders validated before this migration: their last change stands for their validation (J+10 question).
UPDATE "orders" SET "confirmed_at" = "updated_at" WHERE "status" = 'confirmed' AND "confirmed_at" IS NULL;
