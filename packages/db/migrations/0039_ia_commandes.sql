CREATE TABLE "ai_usage_months" (
	"month" text PRIMARY KEY NOT NULL,
	"cost_nano_usd" bigint DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_months_month_check" CHECK ("ai_usage_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ai_usage_months_cost_check" CHECK ("ai_usage_months"."cost_nano_usd" >= 0 AND "ai_usage_months"."calls" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" DROP CONSTRAINT "alert_events_kind_check";--> statement-breakpoint
DROP INDEX "alert_events_pending_send_idx";--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_order_id_idx" ON "alert_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "alert_events_pending_send_idx" ON "alert_events" USING btree ("send_after") WHERE "alert_events"."status" = 'pending' AND "alert_events"."kind" IN ('size_back', 'target_price', 'order_received');--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_order_check" CHECK ("alert_events"."kind" <> 'order_received' OR "alert_events"."order_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_kind_check" CHECK ("alert_events"."kind" IN ('size_back', 'target_price', 'price_drop', 'sale_period', 'shop_promo', 'order_received'));