CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid,
	"item_id" uuid,
	"product_id" uuid,
	"kind" text NOT NULL,
	"size_label" text,
	"price_cents" integer,
	"previous_cents" integer,
	"shop_id" uuid,
	"sale_period_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"send_after" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"digest_on" date,
	"read_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "alert_events_kind_check" CHECK ("alert_events"."kind" IN ('size_back', 'target_price', 'price_drop', 'sale_period', 'shop_promo')),
	CONSTRAINT "alert_events_status_check" CHECK ("alert_events"."status" IN ('pending', 'sent', 'digest', 'skipped')),
	CONSTRAINT "alert_events_item_check" CHECK (NOT ("alert_events"."kind" IN ('size_back', 'target_price', 'price_drop')) OR ("alert_events"."item_id" IS NOT NULL AND "alert_events"."profile_id" IS NOT NULL AND "alert_events"."product_id" IS NOT NULL)),
	CONSTRAINT "alert_events_cents_check" CHECK (("alert_events"."price_cents" IS NULL OR "alert_events"."price_cents" >= 0) AND ("alert_events"."previous_cents" IS NULL OR "alert_events"."previous_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "alert_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"size_back" boolean DEFAULT true NOT NULL,
	"target_price" boolean DEFAULT true NOT NULL,
	"digest" boolean DEFAULT true NOT NULL,
	"digest_hour" integer DEFAULT 18 NOT NULL,
	CONSTRAINT "alert_settings_digest_hour_check" CHECK ("alert_settings"."digest_hour" BETWEEN 8 AND 21)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "sale_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	CONSTRAINT "sale_periods_name_check" CHECK (char_length("sale_periods"."name") BETWEEN 1 AND 80),
	CONSTRAINT "sale_periods_dates_check" CHECK ("sale_periods"."ends_on" >= "sale_periods"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "alerts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "target_price_cents" integer;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_sale_period_id_sale_periods_id_fk" FOREIGN KEY ("sale_period_id") REFERENCES "public"."sale_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sends" ADD CONSTRAINT "alert_sends_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_user_created_idx" ON "alert_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alert_events_item_kind_idx" ON "alert_events" USING btree ("item_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "alert_events_profile_id_idx" ON "alert_events" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "alert_events_shop_id_idx" ON "alert_events" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "alert_events_sale_period_id_idx" ON "alert_events" USING btree ("sale_period_id");--> statement-breakpoint
CREATE INDEX "alert_events_digest_idx" ON "alert_events" USING btree ("user_id","digest_on") WHERE "alert_events"."digest_on" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_sends_sent_at_idx" ON "alert_sends" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "alert_sends_user_sent_idx" ON "alert_sends" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_target_price_check" CHECK ("items"."target_price_cents" IS NULL OR "items"."target_price_cents" >= 1);--> statement-breakpoint
CREATE INDEX "alert_events_pending_send_idx" ON "alert_events" USING btree ("send_after") WHERE "alert_events"."status" = 'pending' AND "alert_events"."kind" IN ('size_back', 'target_price');--> statement-breakpoint
CREATE INDEX "alert_events_digest_waiting_idx" ON "alert_events" USING btree ("digest_on") WHERE "alert_events"."status" IN ('pending', 'digest');
