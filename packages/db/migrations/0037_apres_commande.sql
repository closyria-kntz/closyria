CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"inbox_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_address" text NOT NULL,
	"auth_ok" boolean NOT NULL,
	"status" text NOT NULL,
	"raw_object_key" text,
	"purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "inbound_emails_status_check" CHECK ("inbound_emails"."status" IN ('ignored', 'queued', 'parsed', 'failed')),
	CONSTRAINT "inbound_emails_from_check" CHECK (char_length("inbound_emails"."from_address") BETWEEN 1 AND 320)
);
--> statement-breakpoint
CREATE TABLE "order_inboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"local_part" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_inboxes_local_part_unique" UNIQUE("local_part"),
	CONSTRAINT "order_inboxes_local_part_check" CHECK ("order_inboxes"."local_part" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid,
	"product_id" uuid,
	"name" text NOT NULL,
	"size_label" text,
	"color" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_cents" integer,
	"currency" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_name_check" CHECK (char_length("order_lines"."name") BETWEEN 1 AND 200),
	CONSTRAINT "order_lines_size_label_check" CHECK ("order_lines"."size_label" IS NULL OR char_length("order_lines"."size_label") <= 40),
	CONSTRAINT "order_lines_color_check" CHECK ("order_lines"."color" IS NULL OR char_length("order_lines"."color") <= 60),
	CONSTRAINT "order_lines_quantity_check" CHECK ("order_lines"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "order_lines_price_check" CHECK ("order_lines"."price_cents" IS NULL OR "order_lines"."price_cents" >= 0),
	CONSTRAINT "order_lines_currency_check" CHECK ("order_lines"."currency" IS NULL OR char_length("order_lines"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"shop_id" uuid,
	"external_ref" text,
	"ordered_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text NOT NULL,
	"parse_method" text NOT NULL,
	"inbound_email_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('draft', 'confirmed', 'dismissed')),
	CONSTRAINT "orders_source_check" CHECK ("orders"."source" IN ('email', 'manual', 'tracking')),
	CONSTRAINT "orders_parse_method_check" CHECK ("orders"."parse_method" IN ('known', 'ai', 'manual')),
	CONSTRAINT "orders_external_ref_check" CHECK ("orders"."external_ref" IS NULL OR char_length("orders"."external_ref") <= 64)
);
--> statement-breakpoint
CREATE TABLE "parcel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parcel_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "parcel_events_status_check" CHECK ("parcel_events"."status" IN ('pending', 'in_transit', 'out_for_delivery', 'pickup_ready', 'delivered', 'exception', 'unknown')),
	CONSTRAINT "parcel_events_label_check" CHECK (char_length("parcel_events"."label") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text,
	"tracking_number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_event_at" timestamp with time zone,
	"estimated_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"check_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcels_carrier_check" CHECK ("parcels"."carrier" IS NULL OR "parcels"."carrier" IN ('colissimo', 'lettre_suivie', 'chronopost', 'mondial_relay', 'gls', 'dpd', 'colis_prive', 'ups', 'dhl')),
	CONSTRAINT "parcels_status_check" CHECK ("parcels"."status" IN ('pending', 'in_transit', 'out_for_delivery', 'pickup_ready', 'delivered', 'exception', 'unknown')),
	CONSTRAINT "parcels_tracking_number_check" CHECK ("parcels"."tracking_number" ~ '^[0-9A-Z]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "return_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "returns_url" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "return_deadline" date;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_inbox_id_order_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."order_inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_inboxes" ADD CONSTRAINT "order_inboxes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_inbound_email_id_inbound_emails_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_events" ADD CONSTRAINT "parcel_events_parcel_id_parcels_id_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."parcels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_emails_inbox_id_idx" ON "inbound_emails" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_user_id_idx" ON "inbound_emails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_purge_idx" ON "inbound_emails" USING btree ("purge_after") WHERE "inbound_emails"."raw_object_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_inboxes_user_id_idx" ON "order_inboxes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_inboxes_user_id_active_idx" ON "order_inboxes" USING btree ("user_id") WHERE "order_inboxes"."active";--> statement-breakpoint
CREATE INDEX "order_lines_order_id_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_item_id_idx" ON "order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "orders_user_id_status_idx" ON "orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "orders_user_id_shop_ref_idx" ON "orders" USING btree ("user_id","shop_id","external_ref");--> statement-breakpoint
CREATE INDEX "orders_profile_id_idx" ON "orders" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "orders_inbound_email_id_idx" ON "orders" USING btree ("inbound_email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parcel_events_parcel_id_at_label_idx" ON "parcel_events" USING btree ("parcel_id","at","label");--> statement-breakpoint
CREATE UNIQUE INDEX "parcels_order_id_tracking_number_idx" ON "parcels" USING btree ("order_id","tracking_number");--> statement-breakpoint
CREATE INDEX "parcels_next_check_at_idx" ON "parcels" USING btree ("next_check_at") WHERE "parcels"."next_check_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_return_days_check" CHECK ("shops"."return_days" BETWEEN 0 AND 365);