CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"shop_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"requested_by" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"data_ready" boolean DEFAULT false NOT NULL,
	"method" text,
	"error_code" text,
	"http_status" integer,
	"duration_ms" integer,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "captures_trigger_check" CHECK ("captures"."trigger" IN ('user', 'admin_test', 'monitor')),
	CONSTRAINT "captures_status_check" CHECK ("captures"."status" IN ('queued', 'running', 'succeeded', 'failed', 'skipped_manual')),
	CONSTRAINT "captures_method_check" CHECK ("captures"."method" IS NULL OR "captures"."method" IN ('shopify', 'jsonld', 'opengraph')),
	CONSTRAINT "captures_error_code_check" CHECK ("captures"."error_code" IS NULL OR "captures"."error_code" IN ('blocked', 'timeout', 'too_large', 'forbidden_address', 'robots_disallowed', 'not_a_product', 'http_error', 'invalid_data'))
);
--> statement-breakpoint
CREATE TABLE "product_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_cents" integer NOT NULL,
	"sizes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"source_hash" text NOT NULL,
	CONSTRAINT "product_images_product_source_hash_unique" UNIQUE("product_id","source_hash"),
	CONSTRAINT "product_images_dimensions_check" CHECK ("product_images"."width" > 0 AND "product_images"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_sizes" (
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"available" boolean NOT NULL,
	"price_cents" integer,
	CONSTRAINT "product_sizes_product_label_unique" UNIQUE("product_id","label"),
	CONSTRAINT "product_sizes_label_check" CHECK (char_length("product_sizes"."label") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"brand" text,
	"description" text,
	"currency" text NOT NULL,
	"price_cents" integer NOT NULL,
	"compare_at_cents" integer,
	"source" text DEFAULT 'captured' NOT NULL,
	"capture_status" text DEFAULT 'pending' NOT NULL,
	"last_captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_canonical_url_unique" UNIQUE("canonical_url"),
	CONSTRAINT "products_source_check" CHECK ("products"."source" IN ('captured', 'manual')),
	CONSTRAINT "products_capture_status_check" CHECK ("products"."capture_status" IN ('pending', 'ok', 'failed', 'manual')),
	CONSTRAINT "products_currency_check" CHECK (char_length("products"."currency") = 3),
	CONSTRAINT "products_description_check" CHECK ("products"."description" IS NULL OR char_length("products"."description") <= 5000),
	CONSTRAINT "products_prices_check" CHECK ("products"."price_cents" >= 0 AND ("products"."compare_at_cents" IS NULL OR "products"."compare_at_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "shop_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"capture_mode" text DEFAULT 'auto' NOT NULL,
	"listing_kind" text DEFAULT 'catalog' NOT NULL,
	"test_url" text,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_slug_unique" UNIQUE("slug"),
	CONSTRAINT "shops_status_check" CHECK ("shops"."status" IN ('pending', 'draft', 'published')),
	CONSTRAINT "shops_platform_check" CHECK ("shops"."platform" IN ('shopify', 'other', 'unknown')),
	CONSTRAINT "shops_capture_mode_check" CHECK ("shops"."capture_mode" IN ('auto', 'manual')),
	CONSTRAINT "shops_listing_kind_check" CHECK ("shops"."listing_kind" IN ('catalog', 'secondhand'))
);
--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_history" ADD CONSTRAINT "product_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_domains" ADD CONSTRAINT "shop_domains_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_merged_into_id_shops_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captures_shop_created_idx" ON "captures" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "captures_status_created_idx" ON "captures" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "product_history_product_seen_idx" ON "product_history" USING btree ("product_id","seen_at");--> statement-breakpoint
CREATE INDEX "products_shop_id_idx" ON "products" USING btree ("shop_id");