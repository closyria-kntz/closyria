ALTER TABLE "alert_events" DROP CONSTRAINT "alert_events_kind_check";--> statement-breakpoint
DROP INDEX "alert_events_pending_send_idx";--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "parcel_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_settings" ADD COLUMN "parcel_out_for_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parcels" ADD COLUMN "check_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_parcel_id_parcels_id_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."parcels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_parcel_kind_idx" ON "alert_events" USING btree ("parcel_id","kind") WHERE "alert_events"."parcel_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_events_pending_send_idx" ON "alert_events" USING btree ("send_after") WHERE "alert_events"."status" = 'pending' AND "alert_events"."kind" IN ('size_back', 'target_price', 'order_received', 'parcel_out_for_delivery', 'parcel_pickup_ready', 'parcel_delivered');--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_parcel_check" CHECK (NOT ("alert_events"."kind" IN ('parcel_out_for_delivery', 'parcel_pickup_ready', 'parcel_delivered')) OR ("alert_events"."parcel_id" IS NOT NULL AND "alert_events"."order_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_kind_check" CHECK ("alert_events"."kind" IN ('size_back', 'target_price', 'price_drop', 'sale_period', 'shop_promo', 'order_received', 'parcel_out_for_delivery', 'parcel_pickup_ready', 'parcel_delivered'));--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_check_failures_check" CHECK ("parcels"."check_failures" >= 0);